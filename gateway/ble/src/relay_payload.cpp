#include "relay_payload.hpp"

#include <cstdio>

namespace thermiq {

std::string probeId(const ProbeAddress& address) {
    char id[18];
    std::snprintf(id, sizeof(id), "%02x:%02x:%02x:%02x:%02x:%02x",
                  unsigned(address[0]), unsigned(address[1]), unsigned(address[2]),
                  unsigned(address[3]), unsigned(address[4]), unsigned(address[5]));
    return id;
}

std::string relayPayload(const ProbeAddress& address, const ProbePacket& packet,
                         const char* uuid, const char* measuredAt) {
    std::string json = "{\"sample_id\":\"" + std::string(uuid)
        + "\",\"probe_id\":\"" + probeId(address)
        + "\",\"measured_at\":\"" + measuredAt + "\",\"values\":{";
    if (packet.type == PacketType::Temperature) {
        static const char* const channels[] = {
            "ambient_temperature", "food_temperature", "probe_tip_1_temperature",
            "probe_tip_2_temperature", "probe_tip_3_temperature", "probe_tip_4_temperature",
        };
        for (std::size_t i = 0; i < packet.tenths.size(); ++i) {
            if (i) json += ',';
            json += std::string("\"") + channels[i] + "\":";
            if (!(packet.present & (1u << i))) {
                json += "null";
                continue;
            }
            const int value = packet.tenths[i];
            const int magnitude = value < 0 ? -value : value;
            if (value < 0) json += '-';
            json += std::to_string(magnitude / 10) + "." + std::to_string(magnitude % 10);
        }
    } else {
        json += "\"battery_percent\":";
        json += packet.batteryPercent < 0 ? "null" : std::to_string(packet.batteryPercent);
        json += ",\"soc_temperature\":" + std::to_string(packet.socCelsius);
    }
    return json + "}}";
}

bool retryUpload(int status) {
    return status <= 0 || status == 401 || status == 403 || status == 408
        || status == 425 || status == 429 || status >= 500;
}

}  // namespace thermiq
