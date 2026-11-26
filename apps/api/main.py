import asyncio
import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from secrets import compare_digest
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.concurrency import run_in_threadpool

from cook_reports import cook_reports_router
from direct_ble import DirectBluetoothProvider
from equipment import EquipmentStore, equipment_router
from probes import ProbeStore, probes_router
from providers import ProviderUnavailable, SimulatedThermometerProvider
from relay import RelaySample, RelayStore, SampleConflict
from pydantic import ValidationError

from sessions import (
    ActiveSessionExists, CookSession, EquipmentNotFound, PlacementChanges,
    PlacementConflict, PlacementEvent, SessionInput, SessionNotFound, SessionStore,
)
from simulator import scenario_adapter
from telemetry import TelemetrySnapshot


def create_app(mode: str | None = None, *, scanner_factory=None) -> FastAPI:
    if mode is None:
        mode = os.getenv("THERMIQ_TELEMETRY_SOURCE", "simulator")
    if mode not in {"simulator", "ble", "ble_simulator", "ble_direct"}:
        raise ValueError("THERMIQ_TELEMETRY_SOURCE must be simulator, ble, ble_simulator or ble_direct")

    sessions = SessionStore(os.getenv("THERMIQ_SESSION_DB", "sessions.sqlite3"))
    equipment = EquipmentStore(sessions.path)
    probes = ProbeStore(sessions.path)
    direct = DirectBluetoothProvider(scanner_factory) if mode == "ble_direct" else None

    async def latest_snapshot() -> TelemetrySnapshot:
        if simulator is not None:
            snapshot = await simulator.latest_snapshot()
        elif direct is not None:
            snapshot = await direct.latest_snapshot()
        else:
            snapshot = await run_in_threadpool(store.latest_snapshot)
        return await run_in_threadpool(probes.apply, snapshot)

    async def capture():
        while True:
            try:
                session = await run_in_threadpool(sessions.active_capture, mode)
                if session is not None:
                    snapshot = await latest_snapshot()
                    if snapshot.observed_at <= datetime.now(UTC):
                        readings = [reading for reading in snapshot.readings if reading.measured_at >= session.started_at]
                        await run_in_threadpool(sessions.record, session, snapshot.model_copy(update={"readings": readings}))
            except ProviderUnavailable:
                pass
            except sqlite3.Error:
                logging.getLogger(__name__).exception("Cook session sampling failed")
            await asyncio.sleep(2)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await run_in_threadpool(sessions.initialize)
        await run_in_threadpool(equipment.initialize)
        await run_in_threadpool(probes.initialize)
        task = asyncio.create_task(capture())
        try:
            yield
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            if direct is not None:
                try:
                    await direct.stop()
                except ProviderUnavailable as error:
                    logging.getLogger(__name__).warning("%s", error)

    app = FastAPI(title="ThermIQ", lifespan=lifespan)
    app.include_router(equipment_router(equipment))
    app.include_router(probes_router(probes))
    app.include_router(cook_reports_router(sessions.path))
    token = os.getenv("THERMIQ_RELAY_TOKEN", "").encode()
    store = None
    simulator = None
    if mode == "simulator":
        scenario = scenario_adapter.validate_python(os.getenv("THERMIQ_SIMULATOR_SCENARIO", "uniform"))
        simulator = SimulatedThermometerProvider(scenario)
    elif direct is None:
        if len(token) < 32:
            raise ValueError("Set THERMIQ_RELAY_TOKEN to a random token of at least 32 bytes")
        store = RelayStore(os.getenv("THERMIQ_RELAY_DB", "relay.sqlite3"), mode == "ble_simulator")
        bearer = HTTPBearer(auto_error=False)

        async def authenticate(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
            if credentials is None or not compare_digest(credentials.credentials.encode(), token):
                raise HTTPException(401, "Invalid relay credentials", {"WWW-Authenticate": "Bearer"})

        @app.post("/api/v1/relay/readings", dependencies=[Depends(authenticate)])
        def ingest_reading(sample: RelaySample) -> dict[str, bool]:
            received_at = datetime.now(UTC)
            if sample.measured_at > received_at + timedelta(seconds=5):
                raise HTTPException(422, "Measurement time is ahead of the server clock")
            if sample.simulated != store.simulated:
                raise HTTPException(422, "Reading provenance does not match the relay mode")
            try:
                return {"stored": store.record(sample, received_at)}
            except SampleConflict as error:
                raise HTTPException(409, "Sample ID already belongs to a different reading") from error

    if direct is not None:
        async def require_dashboard(x_thermiq_local: Annotated[str | None, Header()] = None):
            if x_thermiq_local != "1":
                raise HTTPException(403, "Use the local ThermIQ dashboard to control scanning")

        @app.get("/api/v1/bluetooth/scan")
        async def scan_status():
            return direct.status()

        @app.post("/api/v1/bluetooth/scan", dependencies=[Depends(require_dashboard)])
        async def start_scan():
            try:
                await direct.start()
            except ProviderUnavailable as error:
                raise HTTPException(503, detail=str(error)) from error
            return direct.status()

        @app.delete("/api/v1/bluetooth/scan", dependencies=[Depends(require_dashboard)])
        async def stop_scan():
            try:
                await direct.stop()
            except ProviderUnavailable as error:
                raise HTTPException(503, detail=str(error)) from error
            return direct.status()

    @app.get("/api/access")
    async def access() -> dict[str, bool]:
        return {"read_only": False}

    @app.get("/api/v1/view/active-cook")
    def public_active_cook():
        return sessions.public_active_cook()

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "telemetry_source": mode}

    @app.get("/api/v1/telemetry")
    async def telemetry() -> TelemetrySnapshot:
        try:
            return await latest_snapshot()
        except ProviderUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.get("/api/v1/sessions")
    def list_sessions() -> list[CookSession]:
        return sessions.list_sessions()

    @app.post("/api/v1/sessions", status_code=201)
    def start_session(request: SessionInput) -> CookSession:
        name = request.name.strip()
        if not name:
            raise HTTPException(422, "Enter a session name")
        try:
            return sessions.start(name, request.equipment_id, mode)
        except EquipmentNotFound as error:
            raise HTTPException(404, "Equipment profile not found") from error
        except ActiveSessionExists as error:
            raise HTTPException(409, "Finish the active cook before starting another") from error

    @app.post("/api/v1/sessions/{session_id}/finish")
    def finish_session(session_id: str) -> CookSession:
        session = sessions.finish(session_id)
        if session is None:
            raise HTTPException(404, "Cook session not found")
        return session

    @app.get("/api/v1/sessions/{session_id}/placements")
    def list_placements(session_id: str) -> list[PlacementEvent]:
        try:
            return sessions.placement_events(session_id)
        except SessionNotFound as error:
            raise HTTPException(404, "Cook session not found") from error

    @app.post("/api/v1/sessions/{session_id}/placements", status_code=201)
    def record_placement(session_id: str, changes: PlacementChanges) -> PlacementEvent:
        try:
            return sessions.record_placement(session_id, changes)
        except SessionNotFound as error:
            raise HTTPException(404, "Cook session not found") from error
        except PlacementConflict as error:
            raise HTTPException(409, str(error)) from error
        except ValidationError as error:
            raise HTTPException(422, error.errors()[0]["msg"]) from error

    @app.get("/api/v1/sessions/{session_id}/history")
    def session_history(
        session_id: str, after: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=500)] = 500,
    ) -> dict:
        history = sessions.history(session_id, after, limit)
        if history is None:
            raise HTTPException(404, "Cook session not found")
        return history

    return app


app = create_app()
