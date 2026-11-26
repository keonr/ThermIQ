#pragma once

#include <string>

#include "cq60.hpp"

namespace thermiq {

std::string probeId(const ProbeAddress& address);
std::string relayPayload(const ProbeAddress& address, const ProbePacket& packet,
                         const char* uuid, const char* measuredAt);
bool retryUpload(int status);

}  // namespace thermiq
