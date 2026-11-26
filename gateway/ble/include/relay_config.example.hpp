#pragma once

constexpr char WIFI_SSID[] = "your-2.4ghz-network";
constexpr char WIFI_PASSWORD[] = "your-wifi-password";
constexpr char RELAY_URL[] = "https://thermiq.example.net/api/v1/relay/readings";
constexpr char RELAY_TOKEN[] = "replace-with-the-same-token-as-the-ThermIQ-server";
constexpr char RELAY_CA_PEM[] = R"PEM(
-----BEGIN CERTIFICATE-----
replace with the CA certificate that signed your ThermIQ server certificate
-----END CERTIFICATE-----
)PEM";
