#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace thermiq {

using ProbeAddress = std::array<std::uint8_t, 6>;

enum class PacketType { Temperature, Status };

struct ProbePacket {
    PacketType type{};
    std::uint8_t minor{};
    std::uint8_t patch{};
    // Celsius in tenths, in order: ambient, food core, shaft 1–4.
    std::array<int, 6> tenths{};
    std::uint8_t present{};
    int batteryPercent{-1};
    int socCelsius{};
};

// Manufacturer data includes the two-byte little-endian company ID.
bool decodeCq60(const std::uint8_t* data, std::size_t size,
                const ProbeAddress& address, ProbePacket& output);

}  // namespace thermiq
