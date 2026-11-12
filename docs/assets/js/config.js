// Configuración pública. Nunca pongas claves o contraseñas en este archivo.
export const CONFIG = Object.freeze({
  apiBaseUrl: 'https://vehiculo-iot.34-225-114-88.sslip.io',
  vehicleId: 1,
  author: 'Amador Ramírez Jesús Gabriel',
  teacher: 'Víctor Manuel Pinedo Fernández',
  subject: 'Soluciones IoT',
  year: 2026,
  requestTimeoutMs: 8000,
  healthIntervalMs: 20000,
});

export function socketUrl(config = CONFIG) {
  const url = new URL(config.apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/ws/vehiculos/${config.vehicleId}`;
  return url.href;
}
