#include "bonjour_tls_client.hpp"

#ifdef THERMIQ_ENABLE_RELAY

#include <ESPmDNS.h>
#include <cstdio>

namespace thermiq {

int BonjourTlsClient::connect(const char* host, uint16_t port, int32_t timeout) {
    const String original(host);
    String normalized = original;
    normalized.toLowerCase();
    if (!normalized.endsWith(".local")) {
        return WiFiClientSecure::connect(host, port, timeout);
    }

    const String label = original.substring(0, original.length() - 6);
    if (label.isEmpty() || label.indexOf('.') >= 0) return 0;
    if (!mdnsStarted) {
        char relayName[32];
        std::snprintf(relayName, sizeof(relayName), "thermiq-atom-%08lx",
                      static_cast<unsigned long>(ESP.getEfuseMac() >> 16));
        mdnsStarted = MDNS.begin(relayName);
        if (!mdnsStarted) {
            Serial.println("{\"status\":\"bonjour_init_failed\"}");
            return 0;
        }
    }

    if (cachedHost != normalized || millis() - resolvedAt >= 60000) {
        cachedAddress = MDNS.queryHost(label, 2000);
        if (cachedAddress == IPAddress(0, 0, 0, 0)) {
            cachedHost.clear();
            Serial.println("{\"status\":\"bonjour_lookup_failed\"}");
            return 0;
        }
        resolvedAt = millis();
        cachedHost = normalized;
    }

    _timeout = timeout;
    // The Arduino ESP32 overload connects to the resolved IP but supplies
    // the original hostname to Mbed TLS for SNI and certificate verification.
    const int connected = WiFiClientSecure::connect(cachedAddress, port, host, _CA_cert, _cert, _private_key);
    if (!connected) cachedHost.clear();
    return connected;
}

}  // namespace thermiq

#endif
