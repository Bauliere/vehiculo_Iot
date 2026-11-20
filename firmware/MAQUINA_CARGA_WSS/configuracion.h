#pragma once
#include <stdint.h>

#if __has_include("iot43_secrets.h")
#include "iot43_secrets.h"
#endif
#ifndef IOT43_DEVICE_KEY
#define IOT43_DEVICE_KEY ""
#endif
#ifndef IOT43_PORTAL_PASSWORD
#define IOT43_PORTAL_PASSWORD ""
#endif

// Prueba fisica solicitada: conservar el cableado que ya funciona por Serial.
// Antes de encender carro/control, esperar Wi-Fi + WSS + JSON listo.
#ifndef MAQUINA_SALIDAS_FISICAS
#define MAQUINA_SALIDAS_FISICAS 1
#endif
constexpr bool SALIDAS_FISICAS = MAQUINA_SALIDAS_FISICAS != 0;
#ifndef MAQUINA_CONTROL_OE
#define MAQUINA_CONTROL_OE 0
#endif
// 0 = OE del registro sigue a GND; D1 queda como entrada, sin utilizar.
// 1 = futuro OE por D1 con pull-up, SOLO despues de separar OE de GND.
constexpr bool CONTROL_OE_POR_D1 = MAQUINA_CONTROL_OE != 0;
#ifndef MAQUINA_AUXILIARES_MANTENIDOS
#define MAQUINA_AUXILIARES_MANTENIDOS 1
#endif
// 1 para el control que apaga luces o sonido al soltar el boton.
// 0 restaura un pulso si el propio control alterna con cada pulsacion.
constexpr bool AUXILIARES_MANTENIDOS = MAQUINA_AUXILIARES_MANTENIDOS != 0;
constexpr int32_t ID_VEHICULO = 1;
constexpr char SERVIDOR_WSS[] = "vehiculo-iot.34-225-114-88.sslip.io";
constexpr uint16_t PUERTO_WSS = 443;
constexpr char RUTA_WSS[] = "/ws/vehiculos/1";
constexpr char CREDENCIAL_DISPOSITIVO[] = IOT43_DEVICE_KEY;
constexpr char CABECERA_DISPOSITIVO[] = "X-Device-Key: " IOT43_DEVICE_KEY;
constexpr char CLAVE_PORTAL[] = IOT43_PORTAL_PASSWORD;
static_assert(sizeof(CREDENCIAL_DISPOSITIVO) == 1 ||
    (sizeof(CREDENCIAL_DISPOSITIVO) == 46 && CREDENCIAL_DISPOSITIVO[0] == 'd' && CREDENCIAL_DISPOSITIVO[1] == '_'),
    "Configura la credencial de dispositivo emitida para la unidad.");
static_assert(sizeof(CLAVE_PORTAL) == 1 || (sizeof(CLAVE_PORTAL) >= 9 && sizeof(CLAVE_PORTAL) <= 64),
    "La clave privada del portal Wi-Fi debe tener 8 a 63 caracteres.");

constexpr uint8_t SER_PIN = 14;    // D5 -> SER/pata 14 del PRIMER 595.
constexpr uint8_t SRCLK_PIN = 13;  // D7 -> SRCLK/pata 11 de ambos 595.
constexpr uint8_t RCLK_PIN = 12;   // D6 -> RCLK/pata 12 de ambos 595.
constexpr uint8_t OE_PIN = 5;      // D1 reservado; NO se utiliza con CONTROL_OE=0.
constexpr uint8_t RESET_WIFI_PIN = 4; // D2 -> pulsador a GND durante 5 s.
constexpr uint8_t NUM_REGISTROS = 1; // Montaje actual confirmado por el alumno.
constexpr uint32_t PULSO_INDIVIDUAL_MS = 500;
constexpr uint32_t MAX_DURACION_MS = 60000;
constexpr uint32_t LIMITE_SIN_PONG_MS = 6000;
constexpr uint32_t INTENTO_WIFI_MS = 15000;
constexpr uint32_t REINTENTO_WIFI_MS = 60000;
