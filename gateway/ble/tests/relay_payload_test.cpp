#include "relay_payload.hpp"

#include <cassert>
#include <iostream>

int main() {
    using namespace thermiq;
    const ProbeAddress address{{0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff}};
    const char* uuid = "12345678-1234-4234-9234-123456789abc";
    const char* timestamp = "2026-01-01T12:00:00.123Z";
    ProbePacket packet{};
    packet.type = PacketType::Temperature;
    packet.present = 0x07;
    packet.tenths = {{1200, 624, -1, 0, 0, 0}};
    const auto body = relayPayload(address, packet, uuid, timestamp);
    assert(body.find("\"probe_id\":\"aa:bb:cc:dd:ee:ff\"") != std::string::npos);
    assert(body.find("\"probe_tip_1_temperature\":-0.1") != std::string::npos);
    assert(body.find("\"probe_tip_2_temperature\":null") != std::string::npos);

    packet.type = PacketType::Status;
    packet.batteryPercent = 92;
    packet.socCelsius = 33;
    const auto status = relayPayload(address, packet, uuid, timestamp);
    assert(status.find("\"battery_percent\":92") != std::string::npos);
    assert(status.find("ambient_temperature") == std::string::npos);
    assert(retryUpload(-1) && retryUpload(401) && retryUpload(429) && retryUpload(503));
    assert(!retryUpload(200) && !retryUpload(302) && !retryUpload(409) && !retryUpload(422));
    std::cout << body << '\n' << status << '\n';
}
