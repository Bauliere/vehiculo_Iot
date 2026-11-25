/*
  Actividad 4.3 - Maquina de carga, NodeMCU LoLin ESP-12E.
  ESP8266 core 3.1.2; WiFiManager 2.0.17; WebSockets 2.7.2;
  ArduinoJson 6.21.5 o 7.4.3. Monitor Serie: 115200.
  Version 4.3.1: estado inferido de auxiliares y renovacion de la caja.

  Lee docs/guia/DESPLEGAR_4_3.md antes de cargar.
  La copia lista para flashear requiere el encabezado privado iot43_secrets.h.
*/
#include <Arduino.h>
#if !defined(ESP8266) || !defined(ARDUINO_ESP8266_NODEMCU_ESP12E)
#error "Selecciona NodeMCU 1.0 (ESP-12E Module). Este cableado no es generico."
#endif
#include <ESP8266WiFi.h>
#include <WiFiManager.h>
#include <WebSocketsClient.h>
#include <sys/time.h>
#include <time.h>
#include <interrupts.h>
#include "configuracion.h"
#include "certificados.h"
#include "estilo_portal.h"
#include "protocolo.h"
#include "salidas_595.h"

static_assert(OE_PIN == 5, "El control OE opcional usa GPIO5 / D1.");
static_assert(NUM_REGISTROS == 1 || NUM_REGISTROS == 2, "Admite uno o dos 595.");
static_assert(SER_PIN == 14 && SRCLK_PIN == 13 && RCLK_PIN == 12,
              "Se conserva el cableado D5 datos, D7 reloj y D6 latch.");

constexpr uint32_t DATOS_MASK = 1U << SER_PIN;
constexpr uint32_t RELOJ_MASK = 1U << SRCLK_PIN;
constexpr uint32_t LATCH_MASK = 1U << RCLK_PIN;
constexpr uint32_t OE_MASK = 1U << OE_PIN;

struct Pines595 {
  static MAQUINA_INLINE void subir(uint32_t mask) { GPOS = mask; }
  static MAQUINA_INLINE void bajar(uint32_t mask) { GPOC = mask; }
  // delayMicroseconds esta en IRAM y llama al retardo ROM, sin yield/heap.
  // Un microsegundo por fase respeta holgadamente los tiempos del HC595.
  static MAQUINA_INLINE void pausa() { delayMicroseconds(1); }
};

// Se invoca desde la ISR o con InterruptLock. Un patron cero libera el 595
// aunque OE este fijo a GND y loop() este pendiente de la red.
static void IRAM_ATTR escribirPatronHardware(uint8_t patron) {
  if (!SALIDAS_FISICAS) patron = 0;
  if (CONTROL_OE_POR_D1 && !patron) GPOS = OE_MASK;
  Maquina::enviar595<Pines595>(patron, 0, NUM_REGISTROS, DATOS_MASK, RELOJ_MASK, LATCH_MASK);
  if (CONTROL_OE_POR_D1 && patron) GPOC = OE_MASK;
}

struct Salidas595 {
  static MAQUINA_INLINE void actualizar(uint8_t patron) { escribirPatronHardware(patron); }
};

// WebSockets 2.7.2 no emite un evento de usuario en connectFailedCb().
// Consultamos el error despues de loop(), antes de que se libere el transporte.
// No se modifica la biblioteca ni la verificacion del certificado.
class ClienteWssDiagnosticado : public WebSocketsClient {
 public:
  void informarFalloNuevo() {
    if (!_lastConnectionFail || _lastConnectionFail == ultimoFalloInformado_ ||
        _client.status != WSC_NOT_CONNECTED || !_client.ssl) return;
    ultimoFalloInformado_ = _lastConnectionFail;
    char detalle[120] = {};
    const int codigo = _client.ssl->getLastSSLError(detalle, sizeof(detalle));
    Serial.printf_P(PSTR("[TLS] Intento fallido. Codigo=%d | %s\n"), codigo,
        codigo ? detalle : "Sin error TLS registrado: comprobar DNS y conexion TCP");
  }
  const char* fase() const {
    switch (_client.status) {
      case WSC_CONNECTED: return "WSS establecido";
      case WSC_HEADER: return "TLS abierto; esperando respuesta WebSocket";
      case WSC_BODY: return "Respuesta HTTP sin upgrade completo";
      default: return "TCP/TLS pendiente";
    }
  }
 private:
  unsigned long ultimoFalloInformado_ = 0;
};

WiFiManager gestorWifi;
ClienteWssDiagnosticado clienteWss;
BearSSL::X509List autoridades(CERTIFICADOS_RAIZ);
WiFiEventHandler eventoCaidaWifi;
Maquina::Protocolo protocolo(ID_VEHICULO);
String nombreDispositivo;

// Timer1 libera los registros aunque una lectura TCP retenga loop().
// Con el montaje actual escribe el patron por GPIO sin D1 ni shiftOut.
Maquina::Actuacion actuacion;
volatile uint32_t redRestante = 0;
volatile bool pulsoVencido = false, redVencida = false, caidaWifi = false;
bool pulsoActivo = false, wssPreparado = false, wssConectado = false;
uint8_t direccionIndividualActiva = 0;
bool paradaLocal = false;
bool reconectarPorTrama = false;
bool wifiAnterior = false, intentandoWifi = false, relojIniciado = false;
bool botonArmado = false, botonPulsado = false, reinicioPendiente = false;
uint32_t inicioWifi = 0, ultimoIntentoWifi = 0, ultimoInforme = 0;
uint32_t inicioBoton = 0, inicioReinicio = 0, ultimoAvisoHora = 0;
uint32_t ultimoAvisoMemoria = 0;
uint32_t ultimoEstadoWss = 0;

struct AuxiliarPorToque {
  uint8_t bit;
  bool encendido;
  bool objetivo;
  uint32_t inicioTemporizado = 0;
  uint32_t duracionTemporizada = 0;
  uint32_t ultimoPulso = 0;
};

AuxiliarPorToque auxiliaresPorToque[] = {
  {Maquina::BIT_LUCES, LUCES_AL_ARRANQUE, LUCES_AL_ARRANQUE},
  {Maquina::BIT_SONIDO, SONIDO_AL_ARRANQUE, SONIDO_AL_ARRANQUE},
};
int16_t auxiliaresReportados = -1;

void IRAM_ATTR temporizadorSeguridad() {
  Maquina::tickActuacion<Salidas595>(actuacion, redRestante, pulsoVencido, redVencida);
}

void liberarSalidas(const char* motivo, bool incluirAuxiliares = true) {
  {
    esp8266::InterruptLock lock;
    if (incluirAuxiliares) actuacion.limpiar();
    else actuacion.liberarPulso();
    escribirPatronHardware(actuacion.patron());
    pulsoVencido = false;
  }
  const bool habiaPulso = pulsoActivo;
  pulsoActivo = false;
  direccionIndividualActiva = 0;
  if (habiaPulso) {
    Serial.print(F("[LIBERACION] ")); Serial.println(motivo);
  }
}

void cambiarAuxiliar(const Maquina::Decision& orden, uint8_t patron) {
  if (!AUXILIARES_MANTENIDOS) {
    auto& auxiliar = auxiliaresPorToque[patron == Maquina::BIT_LUCES ? 0 : 1];
    if (orden.auxiliar == Maquina::Auxiliar::ENCENDER) auxiliar.objetivo = true;
    else if (orden.auxiliar == Maquina::Auxiliar::APAGAR) auxiliar.objetivo = false;
    else auxiliar.objetivo = !auxiliar.objetivo;
    auxiliar.duracionTemporizada = auxiliar.objetivo ? orden.duracionAuxiliar : 0;
    auxiliar.inicioTemporizado = millis();
    return;
  }
  bool encendido = false;
  {
    esp8266::InterruptLock lock;
    if (redVencida || caidaWifi || !redRestante) return;
    const bool estabaEncendido = (actuacion.auxiliares & patron) != 0;
    encendido = orden.auxiliar == Maquina::Auxiliar::ENCENDER ||
        (orden.auxiliar != Maquina::Auxiliar::APAGAR && !estabaEncendido);
    actuacion.fijarAuxiliar(patron, encendido, orden.duracionAuxiliar);
    escribirPatronHardware(actuacion.patron());
  }
  Serial.printf_P(PSTR("[AUXILIAR] %s | salida solicitada=%s | tiempo=%lu ms (0 sin temporizador)\n"),
      Maquina::nombre(orden.codigo), encendido ? "HIGH" : "LOW",
      static_cast<unsigned long>(orden.duracionAuxiliar));
}

void atenderAuxiliares() {
  if (paradaLocal || !wssConectado || !protocolo.listo() || redVencida || caidaWifi) return;
  uint8_t estado = actuacion.auxiliares;
  if (!AUXILIARES_MANTENIDOS) {
    estado = 0;
    const uint32_t ahora = millis();
    for (auto& auxiliar : auxiliaresPorToque) {
      if (auxiliar.encendido && auxiliar.duracionTemporizada && ahora - auxiliar.inicioTemporizado >= auxiliar.duracionTemporizada) {
        auxiliar.objetivo = false;
        auxiliar.duracionTemporizada = 0;
      }
      if (auxiliar.encendido != auxiliar.objetivo &&
          ahora - auxiliar.ultimoPulso >= PULSO_INDIVIDUAL_MS + REPOSO_AUXILIAR_MS) {
        {
          esp8266::InterruptLock lock;
          if (redVencida || caidaWifi || !redRestante) return;
          actuacion.fijarAuxiliar(auxiliar.bit, true, PULSO_INDIVIDUAL_MS);
          escribirPatronHardware(actuacion.patron());
        }
        auxiliar.encendido = auxiliar.objetivo;
        auxiliar.inicioTemporizado = ahora;
        auxiliar.ultimoPulso = ahora;
        Serial.printf_P(PSTR("[AUXILIAR] %s | estado estimado=%s\n"),
            auxiliar.bit == Maquina::BIT_LUCES ? "LUCES" : "SONIDO", auxiliar.encendido ? "ON" : "OFF");
      }
      if (auxiliar.encendido) estado |= auxiliar.bit;
    }
  }
  if (!SALIDAS_FISICAS || auxiliaresReportados == estado) return;
  char mensaje[64];
  snprintf_P(mensaje, sizeof(mensaje), PSTR("{\"tipo\":\"auxiliares\",\"luces\":%s,\"sonido\":%s}"),
      (estado & Maquina::BIT_LUCES) ? "true" : "false", (estado & Maquina::BIT_SONIDO) ? "true" : "false");
  if (clienteWss.sendTXT(mensaje)) auxiliaresReportados = estado;
}

void iniciarPulso(const Maquina::Decision& orden) {
  if (paradaLocal || !wssConectado || !protocolo.listo() || redVencida || caidaWifi) return;
  const uint8_t patron = Maquina::patron(orden.codigo);
  if ((orden.codigo == 7 || orden.codigo == 8) &&
      (!AUXILIARES_MANTENIDOS || orden.demo == 0 || orden.auxiliar != Maquina::Auxiliar::PULSO)) {
    cambiarAuxiliar(orden, patron);
    return;
  }
  const bool direccionIndividual = orden.demo == 0 && orden.codigo >= 1 && orden.codigo <= 6;
  bool renovado = false;
  if (direccionIndividual && pulsoActivo && direccionIndividualActiva == orden.codigo) {
    esp8266::InterruptLock lock;
    if (!redVencida && !caidaWifi && redRestante && actuacion.pulsoRestante) {
      // Una orden nueva mantiene el mismo optoacoplador y reinicia el tiempo de corte.
      actuacion.pulsoRestante = orden.duracion;
      renovado = true;
    }
  }
  if (renovado) {
    Serial.printf_P(PSTR("[RENOVACION] %s | %lu ms\n"), Maquina::nombre(orden.codigo),
        static_cast<unsigned long>(orden.duracion));
    return;
  }
  // Liberar primero el comando anterior: avance y retroceso no se solapan.
  liberarSalidas("Transicion a una nueva orden", false);
  {
    esp8266::InterruptLock lock;
    if (redVencida || caidaWifi || !redRestante) return;
    actuacion.pulso = patron;
    actuacion.pulsoRestante = orden.duracion;
    escribirPatronHardware(actuacion.patron());
    pulsoVencido = false;
  }
  pulsoActivo = true;
  direccionIndividualActiva = direccionIndividual ? static_cast<uint8_t>(orden.codigo) : 0;
  Serial.printf("[%s] %s | codigo=%ld | patron=0x%02X | %lu ms\n",
      SALIDAS_FISICAS ? "ACTIVACION" : "PRUEBA WSS SIN MOVIMIENTO",
      Maquina::nombre(orden.codigo), static_cast<long>(orden.codigo), patron,
      static_cast<unsigned long>(orden.duracion));
}

void renovarSupervisionRed() {
  // No se borra redVencida aqui: un timeout exige una conexion nueva.
  redRestante = LIMITE_SIN_PONG_MS;
}

void informarEstado() {
  const char* salidas = !SALIDAS_FISICAS ? "DESHABILITADAS" : paradaLocal ? "PAUSA LOCAL" : "HABILITADAS";
  Serial.printf_P(PSTR("[ESTADO] WIFI=%s | WSS=%s | SALIDAS=%s | VEHICULO=%ld\n"),
      WiFi.status() == WL_CONNECTED ? "OK" : "NO", wssConectado ? "OK" : "NO",
      salidas, static_cast<long>(ID_VEHICULO));
  Serial.printf_P(PSTR("[DIAGNOSTICO] %s | JSON listo=%s | heap=%lu | bloque libre mayor=%lu\n"),
      clienteWss.fase(), protocolo.listo() ? "SI" : "NO",
      static_cast<unsigned long>(ESP.getFreeHeap()),
      static_cast<unsigned long>(ESP.getMaxFreeBlockSize()));
  const uint8_t auxiliares = actuacion.auxiliares;
  Serial.printf_P(PSTR("[AUXILIAR] Modo=%s | QC=%s | QF=%s (salidas solicitadas)\n"),
      AUXILIARES_MANTENIDOS ? "mantenido" : "pulsos", auxiliares & Maquina::BIT_LUCES ? "HIGH" : "LOW",
      auxiliares & Maquina::BIT_SONIDO ? "HIGH" : "LOW");
  const time_t ahora = time(nullptr);
  tm utc;
  gmtime_r(&ahora, &utc);
  char fecha[32];
  strftime(fecha, sizeof(fecha), "%Y-%m-%d %H:%M:%S UTC", &utc);
  Serial.print(F("[HORA] ")); Serial.println(fecha);
  ultimoEstadoWss = millis();
}

void informarWifi() {
  Serial.println(F("\n=== WIFI CONECTADO ==="));
  Serial.print(F("Dispositivo: ")); Serial.println(nombreDispositivo);
  Serial.print(F("MAC: ")); Serial.println(WiFi.macAddress());
  Serial.print(F("SSID: ")); Serial.println(WiFi.SSID());
  Serial.print(F("IPv4: ")); Serial.println(WiFi.localIP());
  Serial.print(F("Mascara: ")); Serial.println(WiFi.subnetMask());
  Serial.print(F("Puerta de enlace: ")); Serial.println(WiFi.gatewayIP());
  Serial.printf("RSSI: %ld dBm | heap libre: %lu bytes\n",
      static_cast<long>(WiFi.RSSI()), static_cast<unsigned long>(ESP.getFreeHeap()));
  informarEstado();
  ultimoInforme = millis();
}

void perderConexion(const char* motivo) {
  liberarSalidas(motivo);
  for (auto& auxiliar : auxiliaresPorToque) {
    if (!auxiliar.encendido || !auxiliar.objetivo) auxiliar.duracionTemporizada = 0;
    auxiliar.objetivo = auxiliar.encendido;
  }
  auxiliaresReportados = -1;
  protocolo.desconectar();
  redRestante = 0;
  wssConectado = false;
}

void recibirEventoWss(WStype_t tipo, uint8_t* payload, size_t length) {
  if (tipo == WStype_CONNECTED) {
    perderConexion("Nueva conexion: esperar una orden nueva");
    noInterrupts();
    redVencida = false;
    redRestante = LIMITE_SIN_PONG_MS;
    interrupts();
    wssConectado = true;
    Serial.printf("[WSS] CONECTADO por TLS a %s, vehiculo %ld.\n",
        SERVIDOR_WSS, static_cast<long>(ID_VEHICULO));
    informarEstado();
    return;
  }
  if (tipo == WStype_DISCONNECTED) {
    perderConexion("WSS desconectado");
    Serial.println(F("[WSS] DESCONECTADO. Salidas deshabilitadas; se reintentara."));
    return;
  }
  if (tipo == WStype_PONG) {
    renovarSupervisionRed();
    return;
  }
  if (tipo == WStype_PING) return; // La biblioteca responde el control de protocolo.
  if (tipo != WStype_TEXT) {
    perderConexion("Trama WSS no admitida");
    reconectarPorTrama = true;
    Serial.println(F("[ERROR] Se esperaba un mensaje JSON de texto completo."));
    return;
  }
  if (!wssConectado || redVencida || caidaWifi) return;
  renovarSupervisionRed();
  Serial.printf_P(PSTR("[WSS] Texto recibido: %u bytes\n"), static_cast<unsigned>(length));
  timeval ahora;
  gettimeofday(&ahora, nullptr);
  const int64_t microsUtc = static_cast<int64_t>(ahora.tv_sec) * 1000000 + ahora.tv_usec;
  const Maquina::Decision orden = protocolo.procesar(
      reinterpret_cast<const char*>(payload), length, microsUtc);
  switch (orden.accion) {
    case Maquina::Accion::PULSO:
      Serial.printf("[RECIBIDO] %s | demo=%ld | orden=%ld\n",
          Maquina::nombre(orden.codigo), static_cast<long>(orden.demo),
          static_cast<long>(orden.orden));
      iniciarPulso(orden);
      break;
    case Maquina::Accion::ESTADO:
    case Maquina::Accion::ABORTAR:
      liberarSalidas(orden.motivo);
      Serial.print(F("[WSS] ")); Serial.println(orden.motivo);
      break;
    case Maquina::Accion::INICIO:
    case Maquina::Accion::FIN:
    case Maquina::Accion::PARAR:
      liberarSalidas(orden.motivo, false);
      if (orden.accion == Maquina::Accion::PARAR && orden.demo == 0) paradaLocal = false;
      Serial.print(F("[WSS] ")); Serial.println(orden.motivo);
      break;
    case Maquina::Accion::ERROR:
      liberarSalidas("Evento invalido: estado seguro");
      Serial.print(F("[RECHAZADO] ")); Serial.println(orden.motivo);
      break;
    case Maquina::Accion::IGNORAR:
      Serial.print(F("[IGNORADO] ")); Serial.println(orden.motivo);
      break;
  }
}

void cerrarClienteWss(const char* motivo) {
  perderConexion(motivo);
  if (wssPreparado) clienteWss.disconnect();
  wssPreparado = false;
}

void avisarPortal(WiFiManager*) {
  cerrarClienteWss("Portal de configuracion: salidas inactivas");
  Serial.println(F("\n[CONFIGURACION] Punto de acceso disponible."));
  Serial.print(F("Red del dispositivo: ")); Serial.println(nombreDispositivo);
  Serial.println(F("Conecta el telefono y abre http://192.168.4.1"));
}

void configurarWifiManager() {
  gestorWifi.setDebugOutput(false);
  gestorWifi.setConfigPortalBlocking(false);
  gestorWifi.setConnectTimeout(INTENTO_WIFI_MS / 1000);
  gestorWifi.setSaveConnectTimeout(INTENTO_WIFI_MS / 1000);
  gestorWifi.setConnectRetries(1);
  gestorWifi.setConfigPortalTimeout(0);
  gestorWifi.setAPStaticIPConfig(IPAddress(192,168,4,1), IPAddress(192,168,4,1), IPAddress(255,255,255,0));
  gestorWifi.setHostname(nombreDispositivo.c_str());
  gestorWifi.setTitle(nombreDispositivo);
  gestorWifi.setShowPassword(false);
  gestorWifi.setShowInfoErase(false);
  gestorWifi.setShowInfoUpdate(false);
  const char* menu[] = {"wifi", "info"};
  gestorWifi.setMenu(menu, 2);
  gestorWifi.setCustomHeadElement(ESTILO_PORTAL);
  gestorWifi.setAPCallback(avisarPortal);
  gestorWifi.setSaveConfigCallback([]() {
    Serial.println(F("[CONFIGURACION] Credenciales guardadas; conexion realizada."));
  });
}

void abrirPortal() {
  if (!CLAVE_PORTAL[0] || gestorWifi.getConfigPortalActive()) return;
  cerrarClienteWss("Wi-Fi no disponible");
  gestorWifi.startConfigPortal(nombreDispositivo.c_str(), CLAVE_PORTAL);
  ultimoIntentoWifi = millis();
}

void gestionarWifi() {
  const uint32_t ahora = millis();
  if (WiFi.status() == WL_CONNECTED) {
    intentandoWifi = false;
    if (gestorWifi.getConfigPortalActive()) gestorWifi.stopConfigPortal();
    if (!wifiAnterior) {
      caidaWifi = false;
      informarWifi();
      // Configuracion asincrona de hora UTC; indispensable para validar TLS.
      configTime(0, 0, "pool.ntp.org", "time.cloudflare.com", "time.google.com");
      relojIniciado = true;
      ultimoAvisoHora = ahora - 5000;
    } else if (uint32_t(ahora - ultimoInforme) >= 30000) informarWifi();
    wifiAnterior = true;
    return;
  }
  if (wifiAnterior || caidaWifi) {
    cerrarClienteWss("Wi-Fi desconectado");
    Serial.println(F("[WIFI] Conexion perdida; recuperacion automatica."));
    wifiAnterior = false;
    caidaWifi = false;
    ultimoIntentoWifi = ahora - REINTENTO_WIFI_MS;
  }
  if (intentandoWifi) {
    if (uint32_t(ahora - inicioWifi) >= INTENTO_WIFI_MS) {
      intentandoWifi = false;
      abrirPortal();
    }
    return;
  }
  // Si el portal ya esta abierto, dejarlo activo mientras el usuario
  // configura la red. Cerrarlo al vencer REINTENTO_WIFI_MS hacia que
  // desapareciera antes de que el telefono terminara de conectarse.
  if (gestorWifi.getConfigPortalActive()) return;
  if (uint32_t(ahora - ultimoIntentoWifi) < REINTENTO_WIFI_MS) return;
  ultimoIntentoWifi = ahora;
  if (!gestorWifi.getWiFiIsSaved()) { abrirPortal(); return; }
  Serial.println(F("[WIFI] Reintentando red guardada durante 15 segundos."));
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin();
  inicioWifi = millis();
  intentandoWifi = true;
}

void gestionarWss() {
  if (!CREDENCIAL_DISPOSITIVO[0] || WiFi.status() != WL_CONNECTED ||
      gestorWifi.getConfigPortalActive() || !relojIniciado) return;
  if (time(nullptr) < 1767225600) { // 2026-01-01 UTC; no aceptar hora de fabrica.
    if (uint32_t(millis() - ultimoAvisoHora) >= 5000) {
      Serial.println(F("[HORA] Esperando NTP. WSS no se abre sin poder validar el certificado."));
      ultimoAvisoHora = millis();
    }
    return;
  }
  if (!wssPreparado) {
    // Dar margen a los buffers TLS, el JSON y el SDK en esta ESP8266.
    if (ESP.getFreeHeap() < 26000) {
      if (uint32_t(millis() - ultimoAvisoMemoria) >= 5000) {
        Serial.println(F("[MEMORIA] Falta heap para TLS; salidas inactivas."));
        ultimoAvisoMemoria = millis();
      }
      return;
    }
    liberarSalidas("Preparando conexion TLS");
    Serial.printf("[WSS] Conectando a wss://%s%s\n", SERVIDOR_WSS, RUTA_WSS);
    // CA con vida global, nombre del servidor y vigencia comprobados por BearSSL.
    // Nunca usar beginSSL() sin CA ni setInsecure().
    clienteWss.beginSslWithCA(SERVIDOR_WSS, PUERTO_WSS, RUTA_WSS, &autoridades, "");
    clienteWss.setExtraHeaders(CABECERA_DISPOSITIVO);
    clienteWss.setReconnectInterval(5000);
    clienteWss.enableHeartbeat(1500, 1000, 2);
    wssPreparado = true;
  }
  clienteWss.loop();
  clienteWss.informarFalloNuevo();
  if (!wssConectado && uint32_t(millis() - ultimoEstadoWss) >= 5000) informarEstado();
}

void borrarWifiYReiniciar() {
  if (reinicioPendiente) return;
  cerrarClienteWss("Restablecimiento Wi-Fi");
  Serial.println(F("[RESET] Borrando credenciales Wi-Fi. Suelta el pulsador."));
  gestorWifi.resetSettings();
  reinicioPendiente = true;
  inicioReinicio = millis();
}

void atenderSerie() {
  for (uint8_t n = 0; n < 8 && Serial.available() > 0; ++n) {
    const char c = Serial.read();
    if (c == 'R' || c == 'r') borrarWifiYReiniciar();
    if (c == 'P' || c == 'p') {
      paradaLocal = true;
      liberarSalidas("Parada local P");
      protocolo.cancelarLocal();
      Serial.println(F("[PARADA] Salidas en pausa. Suelta el joystick y pulsa DETENER en la web para rearmar."));
    }
    if (c == '?') informarEstado();
  }
}

void atenderBoton() {
  if (digitalRead(RESET_WIFI_PIN) == HIGH) {
    botonArmado = true; botonPulsado = false; return;
  }
  if (!botonArmado) return;
  if (!botonPulsado) {
    botonPulsado = true; inicioBoton = millis();
    Serial.println(F("[BOTON] Cinco segundos para borrar Wi-Fi."));
  } else if (uint32_t(millis() - inicioBoton) >= 5000) {
    botonArmado = false;
    borrarWifiYReiniciar();
  }
}

void atenderSeguridad() {
  if (reconectarPorTrama) {
    reconectarPorTrama = false;
    cerrarClienteWss("Reconectando despues de una trama no admitida");
  }
  if (redVencida) {
    redVencida = false;
    cerrarClienteWss("Sin respuesta WSS durante seis segundos");
    Serial.println(F("[SEGURIDAD] Timeout WSS; esperando una conexion y orden nuevas."));
  }
  if (caidaWifi) {
    caidaWifi = false;
    cerrarClienteWss("Evento de perdida de Wi-Fi");
    wifiAnterior = false;
    intentandoWifi = false;
    ultimoIntentoWifi = millis() - REINTENTO_WIFI_MS;
  }
  if (pulsoVencido) liberarSalidas("Pulso terminado por temporizador", false);
}

void setup() {
  if (CONTROL_OE_POR_D1) {
    // Solo para un montaje futuro con OE separado de GND y pull-up externo.
    digitalWrite(OE_PIN, HIGH);
    pinMode(OE_PIN, OUTPUT);
  } else pinMode(OE_PIN, INPUT); // D1 no se usa ni se conduce en el montaje actual.
  pinMode(SER_PIN, OUTPUT); pinMode(SRCLK_PIN, OUTPUT); pinMode(RCLK_PIN, OUTPUT);
  digitalWrite(SER_PIN, LOW); digitalWrite(SRCLK_PIN, LOW); digitalWrite(RCLK_PIN, LOW);
  escribirPatronHardware(0);
  timer1_isr_init();
  timer1_attachInterrupt(temporizadorSeguridad);
  timer1_enable(TIM_DIV16, TIM_EDGE, TIM_LOOP);
  timer1_write(5000); // Timer a 80 MHz / 16: 5000 ticks = 1 ms, tambien a CPU 160.
  Serial.begin(115200);
  Serial.setDebugOutput(false);
  pinMode(RESET_WIFI_PIN, INPUT_PULLUP);
  botonArmado = digitalRead(RESET_WIFI_PIN) == HIGH;
  WiFi.mode(WIFI_STA);
  uint8_t mac[6]; WiFi.macAddress(mac);
  char nombre[24];
  snprintf(nombre, sizeof(nombre), "EXCAVADORA-%02X%02X%02X", mac[3], mac[4], mac[5]);
  nombreDispositivo = nombre;
  Serial.println(F("\n=== MAQUINA DE CARGA: WIFI + WSS ==="));
  Serial.println(F("Firmware 4.3.1 | JSON " ARDUINOJSON_VERSION));
  if (!CREDENCIAL_DISPOSITIVO[0]) Serial.println(F("[WSS] Falta la credencial privada de la unidad."));
  if (!CLAVE_PORTAL[0]) Serial.println(F("[WIFI] Falta la clave privada del portal de configuracion."));
  Serial.print(F("Dispositivo: ")); Serial.println(nombreDispositivo);
  Serial.printf("Vehiculo: %ld | OE=%s | RESET WIFI=D2 | registros=%u\n",
      static_cast<long>(ID_VEHICULO), CONTROL_OE_POR_D1 ? "D1" : "GND fijo; D1 sin usar", NUM_REGISTROS);
  Serial.printf("Salidas fisicas: %s\n", SALIDAS_FISICAS ? "HABILITADAS: revisar montaje" : "DESHABILITADAS: primera prueba de red");
  Serial.println(F("115200 baudios. R: borrar Wi-Fi | P: parar | ?: estado. Movimientos desde Swagger."));
  eventoCaidaWifi = WiFi.onStationModeDisconnected([](const WiFiEventStationModeDisconnected&) {
    esp8266::InterruptLock lock;
    actuacion.limpiar();
    escribirPatronHardware(0);
    caidaWifi = true;
  });
  configurarWifiManager();
  clienteWss.onEvent(recibirEventoWss);
  Serial.println(gestorWifi.getWiFiIsSaved()
      ? F("[WIFI] Hay credenciales guardadas. Intentando conectar...")
      : F("[WIFI] Sin credenciales; se abrira el portal."));
  gestorWifi.autoConnect(nombreDispositivo.c_str(), CLAVE_PORTAL);
  ultimoIntentoWifi = millis();
  WiFi.setAutoReconnect(true);
  gestionarWifi();
}

void loop() {
  atenderSeguridad();
  atenderSerie();
  if (!reinicioPendiente) atenderBoton();
  if (!reinicioPendiente) {
    gestionarWifi();
    // Con salidas deshabilitadas antes de toda operacion del portal.
    if (gestorWifi.getConfigPortalActive()) liberarSalidas("Portal activo");
    gestorWifi.process();
    atenderSeguridad();
    gestionarWss();
    atenderSeguridad();
    atenderAuxiliares();
    atenderSerie();
    if (!reinicioPendiente) atenderBoton();
  }
  if (reinicioPendiente && uint32_t(millis() - inicioReinicio) >= 300) ESP.restart();
  yield();
}
