#pragma once
#include <ArduinoJson.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <initializer_list>

namespace Maquina {
enum class Accion { IGNORAR, ESTADO, INICIO, PULSO, PARAR, FIN, ERROR, ABORTAR };
enum class Auxiliar { PULSO, ENCENDER, APAGAR, ALTERNAR };
struct Decision {
  Accion accion = Accion::IGNORAR;
  int32_t codigo = 0;
  uint32_t duracion = 0;
  int32_t demo = 0;
  int32_t orden = 0;
  const char* motivo = "Evento ignorado";
  Auxiliar auxiliar = Auxiliar::PULSO;
  uint32_t duracionAuxiliar = 0;
};

inline uint8_t patron(int32_t codigo) {
  // El codigo JSON NO es la posicion fisica del bit.
  switch (codigo) {
    case 1: return 0x01; // W, QA, avanzar.
    case 2: return 0x02; // A, QB, retroceder.
    case 3: return 0x40; // S, QG, izquierda.
    case 4: return 0x80; // D, QH, derecha.
    case 5: return 0x08; // G, QD, subir caja.
    case 6: return 0x10; // X, QE, bajar caja.
    case 7: return 0x04; // F, QC, alternar luces.
    case 8: return 0x20; // Z, QF, alternar sonido.
    default: return 0x00;
  }
}

inline const char* nombre(int32_t codigo) {
  switch (codigo) {
    case 1: return "AVANZAR";
    case 2: return "RETROCEDER";
    case 3: return "GIRAR_IZQUIERDA";
    case 4: return "GIRAR_DERECHA";
    case 5: return "SUBIR_CAJA";
    case 6: return "BAJAR_CAJA";
    case 7: return "ALTERNAR_LUCES";
    case 8: return "ALTERNAR_SONIDO";
    case 9: return "DETENER";
    default: return "DESCONOCIDO";
  }
}

inline bool entero(JsonVariantConst v, int32_t& out) {
  // Rechaza true/false, 1.0, "1", null y numeros fuera de INT32.
  if (v.is<bool>() || !v.is<int32_t>()) return false;
  out = v.as<int32_t>();
  return true;
}

inline int digitos(const char* s, size_t n) {
  int v = 0;
  for (size_t i = 0; i < n; ++i) {
    if (s[i] < '0' || s[i] > '9') return -1;
    v = v * 10 + s[i] - '0';
  }
  return v;
}

// ISO UTC de Python: 2026-11-04T13:00:00.123456+00:00 o terminacion Z.
// Conversion civil a epoch sin depender de la zona horaria del ordenador.
inline bool timestampUtc(const char* s, int64_t& us) {
  if (!s) return false;
  const size_t length = strlen(s);
  if (length < 20 || length > 32 || s[4] != '-' || s[7] != '-' ||
      s[10] != 'T' || s[13] != ':' || s[16] != ':') return false;
  int y = digitos(s, 4), m = digitos(s + 5, 2), d = digitos(s + 8, 2);
  int h = digitos(s + 11, 2), min = digitos(s + 14, 2), sec = digitos(s + 17, 2);
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || h < 0 || h > 23 ||
      min < 0 || min > 59 || sec < 0 || sec > 59) return false;
  const int daysInMonth[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  const bool leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
  if (d < 1 || d > daysInMonth[m - 1] + (m == 2 && leap ? 1 : 0)) return false;
  size_t p = 19;
  int fraction = 0, count = 0;
  if (s[p] == '.') {
    ++p;
    while (p < length && s[p] >= '0' && s[p] <= '9') {
      if (++count > 6) return false;
      fraction = fraction * 10 + s[p++] - '0';
    }
    if (!count) return false;
  }
  if (strcmp(s + p, "Z") != 0 && strcmp(s + p, "+00:00") != 0) return false;
  while (count++ < 6) fraction *= 10;
  y -= m <= 2;
  const int era = y / 400;
  const unsigned yearOfEra = static_cast<unsigned>(y - era * 400);
  const unsigned dayOfYear = (153U * static_cast<unsigned>(m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
  const int64_t days = static_cast<int64_t>(era) * 146097 + dayOfEra - 719468;
  us = ((days * 24 + h) * 3600 + min * 60 + sec) * 1000000 + fraction;
  return true;
}

class Protocolo {
 public:
  explicit Protocolo(int32_t vehiculo) : vehiculo_(vehiculo) {
    for (const char* key : {"tipo", "id_vehiculo", "codigo", "comando", "timestamp",
                            "id_demo", "orden", "duracion_ms", "total_movimientos",
                            "auxiliar", "duracion_auxiliar_ms"}) filtro_[key] = true;
#if ARDUINOJSON_VERSION_MAJOR == 7
    // El filtro es permanente: devolver al heap la reserva que no se utiliza.
    filtro_.shrinkToFit();
#endif
  }
  void desconectar() { listo_ = false; demo_ = 0; orden_ = 0; total_ = 0; }
  bool listo() const { return listo_; }
  bool demoActiva() const { return demo_ > 0; }
  void cancelarLocal() { demo_ = 0; orden_ = 0; total_ = 0; }

  Decision procesar(const char* raw, size_t length, int64_t ahoraUs) {
    if (!raw || !length || length > 4096) return error("Tamano de mensaje invalido");
    documento_.clear();
    const auto failed = deserializeJson(documento_, raw, length,
        DeserializationOption::Filter(filtro_), DeserializationOption::NestingLimit(5));
    if (failed || !documento_.is<JsonObject>()) return error("JSON invalido");
    const JsonObjectConst obj = documento_.as<JsonObjectConst>();
    int32_t vid = 0;
    if (!entero(obj["id_vehiculo"], vid) || vid < 1) return error("ID de vehiculo invalido");
    if (vid != vehiculo_) return ignorar("Evento de otro vehiculo");
    const char* tipo = obj["tipo"].as<const char*>();
    if (!tipo) return error("Falta el tipo de evento");
    const bool inicial = strcmp(tipo, "estado_inicial") == 0;
    const bool individual = strcmp(tipo, "movimiento_individual") == 0;
    const bool inicio = strcmp(tipo, "demo_inicio") == 0;
    const bool paso = strcmp(tipo, "demo_movimiento") == 0;
    const bool fin = strcmp(tipo, "demo_fin") == 0;
    const bool cancelacion = strcmp(tipo, "demo_cancelada") == 0;
    const bool fallo = strcmp(tipo, "demo_error") == 0;
    if (!inicial && !individual && !inicio && !paso && !fin && !cancelacion && !fallo)
      return ignorar("Tipo de evento no ejecutable");
    int64_t stamp = 0;
    if (!timestampUtc(obj["timestamp"].as<const char*>(), stamp)) return error("Timestamp UTC invalido");
    // Cinco segundos de tolerancia para reloj/red; nunca reproducir una cola vieja.
    if (ahoraUs <= 0 || stamp < ahoraUs - 5000000LL || stamp > ahoraUs + 5000000LL)
      return error("Evento antiguo o relojes sin sincronizar");
    if (inicial) {
      if (listo_) return ignorar("Estado inicial repetido; no es una orden");
      fronteraConexion_ = stamp;
      listo_ = true;
      cancelarLocal();
      return {Accion::ESTADO, 0, 0, 0, 0, "Estado inicial recibido; no se ejecuta"};
    }
    if (!listo_) return ignorar("Esperando estado inicial de esta conexion");
    if (stamp <= fronteraConexion_ || stamp <= ultimoEvento_)
      return ignorar("Evento duplicado o anterior a la conexion");
    int32_t idDemo = 0;
    if (!individual && (!entero(obj["id_demo"], idDemo) || idDemo < 1)) return error("ID de DEMO invalido");
    if (inicio) {
      int32_t total = 0;
      if (!entero(obj["total_movimientos"], total) || total < 1) return error("Total de pasos invalido");
      ultimoEvento_ = stamp; demo_ = idDemo; orden_ = 0; total_ = total;
      return {Accion::INICIO, 0, 0, idDemo, 0, "Nueva DEMO del servidor"};
    }
    if (fin || cancelacion || fallo) {
      if (demo_ != idDemo) return ignorar("Fin de una DEMO no iniciada en esta conexion");
      ultimoEvento_ = stamp;
      cancelarLocal();
      return {fin ? Accion::FIN : Accion::ABORTAR, 9, 0, idDemo, 0,
              fallo ? "DEMO terminada por error" : cancelacion ? "DEMO cancelada" : "DEMO finalizada"};
    }
    int32_t codigo = 0;
    if (!entero(obj["codigo"], codigo) || codigo < 1 || codigo > 9) return error("Codigo entero desconocido");
    const char* comando = obj["comando"].as<const char*>();
    if (!comando || strcmp(comando, nombre(codigo)) != 0) return error("Nombre y codigo no coinciden con el catalogo fisico");
    int32_t duracion = 500, orden = 0;
    if (paso) {
      if (demo_ != idDemo) return ignorar("Paso de una DEMO anterior; esperar un nuevo inicio");
      if (!entero(obj["orden"], orden) || orden != orden_ + 1 || orden > total_)
        return error("Secuencia incompleta o desordenada; DEMO detenida localmente");
      if (!entero(obj["duracion_ms"], duracion) || duracion < 1 || duracion > 60000)
        return error("Duracion entera fuera de 1 a 60000 ms");
      orden_ = orden;
    } else if (demo_ && codigo != 9) {
      return error("Movimiento individual incompatible con DEMO activa");
    }
    Auxiliar auxiliar = Auxiliar::PULSO;
    int32_t duracionAuxiliar = 0;
    const JsonVariantConst modo = obj["auxiliar"];
    const JsonVariantConst tiempo = obj["duracion_auxiliar_ms"];
    if (!modo.isUnbound() || !tiempo.isUnbound()) {
      const char* operacion = modo.as<const char*>();
      if (!paso || (codigo != 7 && codigo != 8) || !operacion ||
          !entero(tiempo, duracionAuxiliar) || duracionAuxiliar < 0 ||
          duracionAuxiliar > 10000 || (duracionAuxiliar && duracionAuxiliar != duracion))
        return error("Auxiliar o duracion del auxiliar invalida");
      if (strcmp(operacion, "encender") == 0) auxiliar = Auxiliar::ENCENDER;
      else if (!duracionAuxiliar && strcmp(operacion, "apagar") == 0) auxiliar = Auxiliar::APAGAR;
      else if (!duracionAuxiliar && strcmp(operacion, "alternar") == 0) auxiliar = Auxiliar::ALTERNAR;
      else return error("Accion auxiliar invalida");
    }
    ultimoEvento_ = stamp;
    if (codigo == 9) {
      if (individual) cancelarLocal();
      return {Accion::PARAR, 9, 0, idDemo, orden, "DETENER: liberar pulsaciones"};
    }
    return {Accion::PULSO, codigo, static_cast<uint32_t>(duracion), idDemo, orden,
            "Orden nueva validada", auxiliar, static_cast<uint32_t>(duracionAuxiliar)};
  }

 private:
  Decision ignorar(const char* reason) const { return {Accion::IGNORAR, 0, 0, 0, 0, reason}; }
  Decision error(const char* reason) { cancelarLocal(); return {Accion::ERROR, 0, 0, 0, 0, reason}; }
  int32_t vehiculo_, demo_ = 0, orden_ = 0, total_ = 0;
  int64_t fronteraConexion_ = 0, ultimoEvento_ = 0;
  bool listo_ = false;
#if ARDUINOJSON_VERSION_MAJOR == 7
  JsonDocument documento_;
  JsonDocument filtro_;
#elif ARDUINOJSON_VERSION_MAJOR == 6
  StaticJsonDocument<1536> documento_;
  StaticJsonDocument<448> filtro_;
#else
#error "Usar ArduinoJson 6.21.5 o 7.4.3, versiones verificadas del protocolo."
#endif
};
} // namespace Maquina
