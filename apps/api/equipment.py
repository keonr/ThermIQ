import sqlite3
from contextlib import closing
from math import cos, radians, sin
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints, model_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Size = Annotated[float, Field(gt=0, le=10000)]
Coordinate = Annotated[float, Field(ge=0, le=10000)]
Angle = Annotated[float, Field(ge=0, lt=360)]


class Food(BaseModel):
    id: UUID
    name: Name
    x_mm: Coordinate
    y_mm: Coordinate
    width_mm: Size
    depth_mm: Size
    angle_deg: Angle


class ProbePlacement(BaseModel):
    probe_id: Name
    x_mm: Coordinate
    y_mm: Coordinate
    angle_deg: Angle
    insertion_mm: Size


class Layout(BaseModel):
    name: Name
    shape: Literal["rectangular", "cylindrical"]
    width_mm: Size
    depth_mm: Size
    height_mm: Size
    food: list[Food] = Field(default_factory=list, max_length=32)
    probes: list[ProbePlacement] = Field(default_factory=list, max_length=32)

    def contains(self, x: float, y: float) -> bool:
        if self.shape == "cylindrical":
            return ((2 * x / self.width_mm - 1) ** 2 + (2 * y / self.depth_mm - 1) ** 2) <= 1 + 1e-9
        return -1e-8 <= x <= self.width_mm + 1e-8 and -1e-8 <= y <= self.depth_mm + 1e-8

    @model_validator(mode="after")
    def validate_layout(self):
        if self.shape == "cylindrical" and self.width_mm != self.depth_mm:
            raise ValueError("Cylindrical chambers require equal width and depth")
        if len({item.id for item in self.food}) != len(self.food):
            raise ValueError("Food identifiers must be unique")
        if len({probe.probe_id for probe in self.probes}) != len(self.probes):
            raise ValueError("Probe identifiers must be unique")
        for item in self.food:
            angle = radians(item.angle_deg)
            for x in (-item.width_mm / 2, item.width_mm / 2):
                for y in (-item.depth_mm / 2, item.depth_mm / 2):
                    if not self.contains(item.x_mm + x * cos(angle) - y * sin(angle),
                                         item.y_mm + x * sin(angle) + y * cos(angle)):
                        raise ValueError(f"Food footprint for {item.name} extends outside the chamber")
        for probe in self.probes:
            angle = radians(probe.angle_deg)
            end_x = probe.x_mm + probe.insertion_mm * cos(angle)
            end_y = probe.y_mm + probe.insertion_mm * sin(angle)
            if not self.contains(probe.x_mm, probe.y_mm) or not self.contains(end_x, end_y):
                raise ValueError(f"Placement for {probe.probe_id} extends outside the chamber")
        return self


class EquipmentProfile(Layout):
    id: UUID


class EquipmentStore:
    def __init__(self, path: str):
        self.path = path

    def initialize(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS equipment_profiles (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    def list(self) -> list[EquipmentProfile]:
        with closing(sqlite3.connect(self.path)) as db:
            return [
                EquipmentProfile.model_validate_json(payload)
                for (payload,) in db.execute("SELECT payload FROM equipment_profiles ORDER BY rowid DESC")
            ]

    def save(self, layout: Layout, profile_id: UUID | None = None) -> EquipmentProfile:
        profile = EquipmentProfile(id=profile_id or uuid4(), **layout.model_dump())
        with closing(sqlite3.connect(self.path)) as db, db:
            values = (profile.model_dump_json(), str(profile.id))
            if profile_id is None:
                db.execute("INSERT INTO equipment_profiles(payload, id) VALUES (?, ?)", values)
            elif not db.execute("UPDATE equipment_profiles SET payload = ? WHERE id = ?", values).rowcount:
                raise HTTPException(404, "Equipment profile not found")
        return profile


def equipment_router(store: EquipmentStore) -> APIRouter:
    router = APIRouter(prefix="/api/v1/equipment", tags=["equipment"])

    @router.get("")
    def list_profiles() -> list[EquipmentProfile]:
        return store.list()

    @router.post("", status_code=201)
    def create_profile(layout: Layout) -> EquipmentProfile:
        return store.save(layout)

    @router.put("/{profile_id}")
    def update_profile(profile_id: UUID, layout: Layout) -> EquipmentProfile:
        return store.save(layout, profile_id)

    return router
