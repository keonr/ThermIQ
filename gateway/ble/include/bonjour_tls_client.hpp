#pragma once

#ifdef THERMIQ_ENABLE_RELAY

#include <WiFiClientSecure.h>

namespace thermiq {

// Resolve local names separately while preserving the HTTPS peer identity.
class BonjourTlsClient : public WiFiClientSecure {
public:
    using WiFiClientSecure::connect;
    int connect(const char* host, uint16_t port, int32_t timeout) override;

private:
    bool mdnsStarted = false;
    String cachedHost;
    IPAddress cachedAddress;
    uint32_t resolvedAt = 0;
};

}  // namespace thermiq

#endif
