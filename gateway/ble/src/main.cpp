#include <Arduino.h>
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#include <algorithm>
#include <atomic>
#include <cstring>
#include <cstdio>

#ifdef THERMIQ_ENABLE_RELAY
#include <HTTPClient.h>
#include <WiFi.h>
#include "bonjour_tls_client.hpp"
#include <esp_system.h>
#include <esp_timer.h>
#include <sys/time.h>

#include "relay_config.hpp"
#include "relay_payload.hpp"
#endif

#include "cq60.hpp"

namespace {

struct ScanEvent {
    thermiq::ProbeAddress address{};
    thermiq::ProbePacket packet{};
    std::uint32_t uptimeMs{};
    int rssi{};
#ifdef THERMIQ_ENABLE_RELAY
    std::int64_t receivedUs{};
#endif
};

QueueHandle_t events = nullptr;
#ifdef THERMIQ_ENABLE_RELAY
std::atomic<unsigned> dropped{0};

bool allowSample(const ScanEvent& event) {
    struct Slot {
        thermiq::ProbeAddress address{};
        thermiq::PacketType type{};
        std::int64_t receivedUs{};
    };
    static std::array<Slot, 32> slots{};
    Slot* oldest = &slots[0];
    for (auto& slot : slots) {
        if (slot.receivedUs && slot.address == event.address && slot.type == event.packet.type) {
            const auto interval = event.packet.type == thermiq::PacketType::Temperature ? 2000000 : 15000000;
            if (event.receivedUs - slot.receivedUs < interval) return false;
            slot.receivedUs = event.receivedUs;
            return true;
        }
        if (slot.receivedUs < oldest->receivedUs) oldest = &slot;
    }
    oldest->address = event.address;
    oldest->type = event.packet.type;
    oldest->receivedUs = event.receivedUs;
    return true;
}
#endif

class Scanner : public NimBLEAdvertisedDeviceCallbacks {
    void onResult(NimBLEAdvertisedDevice* device) override {
        if (!device->haveManufacturerData()) return;

        ScanEvent event{};
        unsigned bytes[6]{};
        const auto mac = device->getAddress().toString();
        if (std::sscanf(mac.c_str(), "%2x:%2x:%2x:%2x:%2x:%2x",
                        &bytes[0], &bytes[1], &bytes[2], &bytes[3], &bytes[4], &bytes[5]) != 6) {
            return;
        }
        for (std::size_t i = 0; i < event.address.size(); ++i) {
            event.address[i] = static_cast<std::uint8_t>(bytes[i]);
        }
        for (std::size_t index = 0; index < device->getManufacturerDataCount(); ++index) {
            const auto data = device->getManufacturerData(index);
            if (!thermiq::decodeCq60(reinterpret_cast<const std::uint8_t*>(data.data()),
                                    data.size(), event.address, event.packet)) {
                continue;
            }
            event.uptimeMs = millis();
            event.rssi = device->getRSSI();
#ifdef THERMIQ_ENABLE_RELAY
            event.receivedUs = esp_timer_get_time();
            if (allowSample(event) && xQueueSend(events, &event, 0) != pdTRUE) ++dropped;
#else
            xQueueSend(events, &event, 0);
#endif
            break;
        }
    }
};

Scanner scanner;

#ifndef THERMIQ_ENABLE_RELAY
void printEvent(const ScanEvent& event) {
    const auto& a = event.address;
    const auto& packet = event.packet;
    Serial.printf("{\"probe_id\":\"%02x:%02x:%02x:%02x:%02x:%02x\","
                  "\"uptime_ms\":%lu,\"rssi_dbm\":%d,\"protocol\":\"5.%u.%u\",\"values\":{",
                  unsigned(a[0]), unsigned(a[1]), unsigned(a[2]), unsigned(a[3]),
                  unsigned(a[4]), unsigned(a[5]), static_cast<unsigned long>(event.uptimeMs),
                  event.rssi, unsigned(packet.minor), unsigned(packet.patch));

    if (packet.type == thermiq::PacketType::Temperature) {
        static const char* const channels[] = {
            "ambient_temperature", "food_temperature",
            "probe_tip_1_temperature", "probe_tip_2_temperature",
            "probe_tip_3_temperature", "probe_tip_4_temperature",
        };
        for (std::size_t i = 0; i < packet.tenths.size(); ++i) {
            Serial.printf("%s\"%s\":", i ? "," : "", channels[i]);
            if (packet.present & (1u << i)) Serial.print(packet.tenths[i] / 10.0, 1);
            else Serial.print("null");
        }
    } else {
        Serial.print("\"battery_percent\":");
        if (packet.batteryPercent >= 0) Serial.print(packet.batteryPercent);
        else Serial.print("null");
        Serial.printf(",\"soc_temperature\":%d", packet.socCelsius);
    }
    Serial.println("}}");
}

#else
std::string pending;
bool pendingSample = false;
ScanEvent sample{};
unsigned retrySeconds = 1;
std::uint32_t retryStarted = 0;
std::uint32_t retryDelay = 0;

std::string makePayload(const ScanEvent& reading, const timeval& now) {
    const std::int64_t wallUs = std::int64_t(now.tv_sec) * 1000000 + now.tv_usec;
    const auto measuredUs = wallUs - (esp_timer_get_time() - reading.receivedUs);
    const time_t seconds = measuredUs / 1000000;
    tm utc{};
    gmtime_r(&seconds, &utc);
    char date[24];
    char timestamp[32];
    strftime(date, sizeof(date), "%Y-%m-%dT%H:%M:%S", &utc);
    std::snprintf(timestamp, sizeof(timestamp), "%s.%03uZ", date,
                  static_cast<unsigned>(measuredUs % 1000000 / 1000));

    std::array<std::uint8_t, 16> random{};
    esp_fill_random(random.data(), random.size());
    random[6] = (random[6] & 0x0f) | 0x40;
    random[8] = (random[8] & 0x3f) | 0x80;
    char uuid[37];
    std::size_t offset = 0;
    for (std::size_t index = 0; index < random.size(); ++index) {
        if (index == 4 || index == 6 || index == 8 || index == 10) uuid[offset++] = '-';
        std::snprintf(uuid + offset, sizeof(uuid) - offset, "%02x", unsigned(random[index]));
        offset += 2;
    }
    return thermiq::relayPayload(reading.address, reading.packet, uuid, timestamp);
}

int sendOnce(HTTPClient& http, thermiq::BonjourTlsClient& client, const std::string& body) {
    int status = -1;
    if (http.begin(client, RELAY_URL)) {
        http.addHeader("Content-Type", "application/json");
        http.addHeader("Authorization", String("Bearer ") + RELAY_TOKEN);
        status = http.POST(body.c_str());
        if (status > 0) http.getString();
        http.end();
    }
    if (status <= 0) client.stop();
    return status;
}

int postPayload(const std::string& body) {
    static thermiq::BonjourTlsClient client;
    static HTTPClient http;
    static bool initialized = false;
    if (!initialized) {
        client.setCACert(RELAY_CA_PEM);
        client.setHandshakeTimeout(5);
        http.setReuse(true);
        http.setConnectTimeout(4000);
        http.setTimeout(4000);
        initialized = true;
    }

    const bool reused = client.connected();
    int status = sendOnce(http, client, body);
    // Reconnect once immediately if the server closed an idle keep-alive socket.
    if (status <= 0 && reused) status = sendOnce(http, client, body);
    return status;
}

bool upload() {
    if (WiFi.status() != WL_CONNECTED || millis() - retryStarted < retryDelay) return false;
    timeval now{};
    gettimeofday(&now, nullptr);
    if (now.tv_sec < 1700000000) return false;

    if (!pendingSample) {
        if (xQueueReceive(events, &sample, 0) != pdTRUE) return false;
        pending = makePayload(sample, now);
        pendingSample = true;
    }

    const int status = postPayload(pending);
    if (thermiq::retryUpload(status)) {
        retryStarted = millis();
        retryDelay = retrySeconds * 1000;
        retrySeconds = std::min(retrySeconds * 2, 30u);
        Serial.printf("{\"status\":\"upload_retry\",\"http\":%d}\n", status);
        return false;
    }
    Serial.printf("{\"status\":\"%s\",\"http\":%d}\n",
                  status >= 200 && status < 300 ? "uploaded" : "sample_rejected", status);
    pending.clear();
    pendingSample = false;
    retrySeconds = 1;
    retryDelay = 0;
    return true;
}
#endif

}  // namespace

void setup() {
    Serial.begin(115200);
#ifdef THERMIQ_ENABLE_RELAY
    if (strncmp(RELAY_URL, "https://", 8) != 0 || strlen(RELAY_TOKEN) < 32) {
        Serial.println("{\"status\":\"invalid_relay_config\"}");
        return;
    }
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    events = xQueueCreate(256, sizeof(ScanEvent));
#else
    events = xQueueCreate(32, sizeof(ScanEvent));
#endif
    if (!events) {
        Serial.println("{\"status\":\"queue_allocation_failed\"}");
        return;
    }
    NimBLEDevice::init("");
    auto* scan = NimBLEDevice::getScan();
    scan->setActiveScan(false);
    scan->setInterval(100);
    scan->setWindow(70);
    scan->setAdvertisedDeviceCallbacks(&scanner, true);
    scan->setMaxResults(0);
    const bool started = scan->start(0, nullptr, false);
    Serial.println(started ? "{\"status\":\"scanning\"}" : "{\"status\":\"scan_start_failed\"}");
}

void loop() {
#ifdef THERMIQ_ENABLE_RELAY
    bool uploaded = false;
    if (events) {
        const auto lost = dropped.exchange(0);
        if (lost) Serial.printf("{\"status\":\"queue_full\",\"dropped\":%u}\n", lost);
        uploaded = upload();
    }
    delay(uploaded && events && uxQueueMessagesWaiting(events) ? 1 : 50);
#else
    ScanEvent event{};
    if (events && xQueueReceive(events, &event, pdMS_TO_TICKS(250))) printEvent(event);
    else delay(10);
#endif
}
