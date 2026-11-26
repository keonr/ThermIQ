#include "cq60.hpp"

#include <algorithm>

namespace thermiq {

bool decodeCq60(const std::uint8_t* data, std::size_t size,
                const ProbeAddress& address, ProbePacket& output) {
    if (!data || size < 4 || size > 20 || data[0] != 0xcd || data[1] != 0x05 ||
        (data[3] >> 4) != 5) {
        return false;
    }

    ProbePacket packet{};
    packet.minor = data[3] & 0x0f;
    packet.patch = data[2] >> 4;
    switch (data[2] & 0x0f) {
    case 1:
        if (size < 16) return false;
        packet.type = PacketType::Temperature;
        for (std::size_t i = 0; i < packet.tenths.size(); ++i) {
            const auto offset = 4 + i * 2;
            int raw = static_cast<int>(data[offset]) | (static_cast<int>(data[offset + 1]) << 8);
            if (raw >= 32768) raw -= 65536;
            if (raw >= 32000) continue;
            if (raw < -400 || raw > 6000) return false;
            packet.tenths[i] = raw;
            packet.present |= (1u << i);
        }
        break;
    case 3:
        if (size < 12 || !std::equal(address.begin(), address.end(), data + 4)) return false;
        packet.type = PacketType::Status;
        if (data[10] <= 100) packet.batteryPercent = data[10];
        packet.socCelsius = data[11];
        break;
    default:
        return false;
    }
    output = packet;
    return true;
}

}  // namespace thermiq
