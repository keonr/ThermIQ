#include "cq60.hpp"

#include <algorithm>
#include <cassert>

int main() {
    using thermiq::decodeCq60;
    const thermiq::ProbeAddress probe{{0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff}};
    thermiq::ProbePacket packet{};
    // 120.0°C ambient, 62.4°C core, -5.0°C shaft 1, missing shaft 2.
    const std::array<std::uint8_t, 18> valid{{
        0xcd, 0x05, 0x21, 0x51, 0xb0, 0x04, 0x70, 0x02,
        0xce, 0xff, 0xff, 0x7f, 0x91, 0x02, 0x92, 0x02, 0x00, 0x00,
    }};
    assert(decodeCq60(valid.data(), valid.size(), probe, packet));
    assert(packet.type == thermiq::PacketType::Temperature);
    assert(packet.minor == 1 && packet.patch == 2);
    assert(packet.present == 0x37);
    assert(packet.tenths[0] == 1200 && packet.tenths[1] == 624 && packet.tenths[2] == -50);
    assert(packet.tenths[4] == 657 && packet.tenths[5] == 658);
    assert(!decodeCq60(valid.data(), 15, probe, packet));
    assert(!decodeCq60(nullptr, 20, probe, packet));

    auto invalid = valid;
    invalid[0] = 0x00;
    assert(!decodeCq60(invalid.data(), invalid.size(), probe, packet));
    invalid = valid;
    invalid[3] = 0x41;
    assert(!decodeCq60(invalid.data(), invalid.size(), probe, packet));
    invalid = valid;
    invalid[5] = 0x40;
    assert(!decodeCq60(invalid.data(), invalid.size(), probe, packet));
    std::array<std::uint8_t, 22> hub{};
    std::copy(valid.begin(), valid.end(), hub.begin());
    assert(!decodeCq60(hub.data(), hub.size(), probe, packet));

    std::array<std::uint8_t, 12> status{{
        0xcd, 0x05, 0x03, 0x50, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 88, 34,
    }};
    assert(decodeCq60(status.data(), status.size(), probe, packet));
    assert(packet.type == thermiq::PacketType::Status);
    assert(packet.batteryPercent == 88 && packet.socCelsius == 34);
    status[10] = 255;
    assert(decodeCq60(status.data(), status.size(), probe, packet));
    assert(packet.batteryPercent == -1);
    status[4] = 0xbb;
    assert(!decodeCq60(status.data(), status.size(), probe, packet));
}
