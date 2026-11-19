// Configuración pública. Nunca pongas claves o contraseñas en este archivo.
const localApi = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname)
  && new URLSearchParams(globalThis.location.search).get('api') === 'local';
export const CONFIG = Object.freeze({
  apiBaseUrl: localApi ? 'http://127.0.0.1:8000' : 'https://vehiculo-iot.34-225-114-88.sslip.io',
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
