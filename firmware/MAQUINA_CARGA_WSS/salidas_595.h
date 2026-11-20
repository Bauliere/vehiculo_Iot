#pragma once
#include <stdint.h>

// Algoritmo compartido por la ESP y las pruebas nativas. El llamador protege
// las transmisiones frente a interrupciones. Pines no necesita memoria ni IO
// de alto nivel: subir(mask), bajar(mask), pausa() y, para tick, actualizar().
#if defined(__GNUC__)
#define MAQUINA_INLINE inline __attribute__((always_inline))
#else
#define MAQUINA_INLINE inline
#endif

namespace Maquina {
template<class Pines>
MAQUINA_INLINE void enviar595(uint8_t primero, uint8_t segundo, uint8_t cantidad,
                              uint32_t datos, uint32_t reloj, uint32_t latch) {
  Pines::bajar(latch | reloj);
  const uint16_t trama = (static_cast<uint16_t>(segundo) << 8) | primero;
  const int bits = cantidad == 2 ? 16 : 8;
  for (int bit = bits - 1; bit >= 0; --bit) {
    if ((trama >> bit) & 1U) Pines::subir(datos);
    else Pines::bajar(datos);
    Pines::pausa(); // Dato estable antes del flanco ascendente.
    Pines::subir(reloj);
    Pines::pausa();
    Pines::bajar(reloj);
    Pines::pausa();
  }
  Pines::subir(latch);
  Pines::pausa();
}

constexpr uint8_t BIT_LUCES = 0x04;  // QC.
constexpr uint8_t BIT_SONIDO = 0x20; // QF.

struct Actuacion {
  volatile uint8_t pulso = 0;
  volatile uint8_t auxiliares = 0;
  volatile uint32_t pulsoRestante = 0;
  volatile uint32_t lucesRestantes = 0;
  volatile uint32_t sonidoRestante = 0;

  MAQUINA_INLINE uint8_t patron() const { return pulso | auxiliares; }

  MAQUINA_INLINE void liberarPulso() {
    pulso = 0;
    pulsoRestante = 0;
  }

  MAQUINA_INLINE void limpiar() {
    liberarPulso();
    auxiliares = 0;
    lucesRestantes = 0;
    sonidoRestante = 0;
  }

  MAQUINA_INLINE void fijarAuxiliar(uint8_t bit, bool encendido, uint32_t tiempo) {
    if (encendido) auxiliares |= bit;
    else auxiliares &= ~bit;
    if (bit == BIT_LUCES) lucesRestantes = encendido ? tiempo : 0;
    else sonidoRestante = encendido ? tiempo : 0;
  }
};

// La ISR escribe cuando vence un plazo. Evita Serial, red y memoria dinamica.
template<class Salida>
MAQUINA_INLINE void tickActuacion(Actuacion& salidas,
    volatile uint32_t& red, volatile bool& finPulso, volatile bool& finRed) {
  if (red && --red == 0) {
    finRed = true;
    if (salidas.pulsoRestante == 1) finPulso = true;
    salidas.limpiar();
    Salida::actualizar(0);
    return;
  }
  bool cambio = false;
  if (salidas.pulsoRestante && --salidas.pulsoRestante == 0) {
    salidas.pulso = 0;
    finPulso = true;
    cambio = true;
  }
  if (salidas.lucesRestantes && --salidas.lucesRestantes == 0) {
    salidas.auxiliares &= ~BIT_LUCES;
    cambio = true;
  }
  if (salidas.sonidoRestante && --salidas.sonidoRestante == 0) {
    salidas.auxiliares &= ~BIT_SONIDO;
    cambio = true;
  }
  if (cambio) Salida::actualizar(salidas.patron());
}
} // namespace Maquina
