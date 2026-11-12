import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../assets/js/services/api-client.js';
import { HealthService } from '../assets/js/services/health-service.js';
import { SocketClient } from '../assets/js/services/socket-client.js';
import { Catalog, commandLabel } from '../assets/js/domain/catalog.js';
import { ApiError, validateServiceUrl } from '../assets/js/utils/errors.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const commands = [
  { id_comando: 42, id_vehiculo: 1, nombre: 'AVANZAR', codigo: 1, activo: 1 },
  { id_comando: 43, id_vehiculo: 1, nombre: 'GIRAR_IZQUIERDA', codigo: 3, activo: 1 },
  { id_comando: 90, id_vehiculo: 1, nombre: 'DETENER', codigo: 9, activo: 1 },
  { id_comando: 71, id_vehiculo: 1, nombre: 'ALTERNAR_LUCES', codigo: 7, activo: 1 },
  { id_comando: 82, id_vehiculo: 1, nombre: 'ALTERNAR_SONIDO', codigo: 8, activo: 0 },
];

test('REST utiliza los contratos reales y conserva la clave solo en memoria', async () => {
  const calls = [];
  const api = new ApiClient('https://example.test', {
    fetchImpl: async (url, options) => { calls.push({ url, options }); return json({ status: 'ok' }); },
  });
  api.setKey('  credential-for-test-only  ');
  await api.getVehicle(1);
  await api.getCommands(1);
  await api.getDemos(1);
  await api.getDemoSteps(1, 4);
  await api.move(1, 42);
  await api.startDemo(1, 4);
  await api.cancelDemo(1, 4);
  assert.deepEqual(calls.map(call => call.url), [
    '/vehiculos/1', '/vehiculos/1/comandos', '/vehiculos/1/demos',
    '/vehiculos/1/demos/4/movimientos', '/vehiculos/1/movimientos',
    '/vehiculos/1/demos/4/iniciar', '/vehiculos/1/demos/4/cancelar',
  ].map(path => `https://example.test${path}`));
  for (const call of calls.slice(0, 4)) assert.equal(call.options.headers['X-API-Key'], undefined);
  for (const call of calls.slice(4)) {
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['X-API-Key'], 'credential-for-test-only');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
  }
  assert.deepEqual(JSON.parse(calls[4].options.body), { id_comando: 42, origen: 'API' });
  assert.equal(calls[5].options.body, undefined);
  assert.equal(JSON.stringify(api).includes('credential-for-test-only'), false);
  assert.equal(new ApiClient('https://example.test').hasKey(), false);
  api.setKey('');
  assert.equal(api.hasKey(), false);
  await assert.rejects(api.move(1, 42), error => error.code === 'AUTH_REQUIRED');
  assert.equal(calls.length, 7);
});

test('IDs estrictos y rutas relativas impiden solicitudes con datos ambiguos', async () => {
  const api = new ApiClient('https://example.test', { fetchImpl: () => assert.fail('No debe enviar Fetch') });
  api.setKey('test');
  for (const id of [true, false, '1', 1.5, 0, -1, NaN, Infinity, 2147483648]) {
    assert.throws(() => api.move(id, 1), ApiError);
    assert.throws(() => api.move(1, id), ApiError);
    assert.throws(() => api.startDemo(1, id), ApiError);
  }
  for (const path of ['https://other.test', '//other.test', '/../../', '/\\other.test']) {
    await assert.rejects(api.request(path), error => error.code === 'CONFIG');
  }
  assert.throws(() => api.setKey('bad\r\nHeader: value'), ApiError);
  for (const key of ['API_CONTROL_KEY=example', 'API_ADMIN_KEY=example', '"example"', "'example'", '`example`']) {
    assert.throws(() => api.setKey(key), error => error.code === 'VALIDATION' && error.message.includes('solo el valor'));
  }
});

test('HTTPS y WSS obligatorios salvo servidor de desarrollo local', () => {
  assert.equal(validateServiceUrl('https://example.test/'), 'https://example.test');
  assert.equal(validateServiceUrl('http://localhost:5500'), 'http://localhost:5500');
  assert.equal(validateServiceUrl('ws://127.0.0.1:8000/ws/vehiculos/1', true), 'ws://127.0.0.1:8000/ws/vehiculos/1');
  for (const value of ['http://example.test', 'https://name:secret@example.test', 'https://example.test?token=x', 'https://example.test/#x']) {
    assert.throws(() => new ApiClient(value), ApiError);
  }
  assert.throws(() => new SocketClient('https://example.test/ws'), ApiError);
});

test('HTML o JSON roto no se acepta como resultado de una operación', async () => {
  const responses = [
    new Response('<html>proxy error</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('{', { headers: { 'Content-Type': 'application/json' } }),
  ];
  const api = new ApiClient('https://example.test', { fetchImpl: async () => responses.shift() });
  await assert.rejects(api.health(), error => error.code === 'INVALID_RESPONSE');
  await assert.rejects(api.health(), error => error.code === 'INVALID_RESPONSE');
});

test('Los mensajes públicos no filtran el detail privado de errores HTTP', async () => {
  const api = new ApiClient('https://example.test', {
    fetchImpl: async () => json({ detail: 'private-internal-value' }, 503),
  });
  await assert.rejects(api.rdsHealth(), error => {
    assert.equal(error.status, 503);
    assert.equal(error.diagnostic, true);
    assert.equal(error.message.includes('private-internal-value'), false);
    return true;
  });
});

test('Timeout y aborto distinguen resultado desconocido de cancelación del backend', async () => {
  const waitingFetch = async (_url, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Aborted')); return; }
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  });
  const api = new ApiClient('https://example.test', { timeoutMs: 10, fetchImpl: waitingFetch });
  await assert.rejects(api.health(), error => error.code === 'TIMEOUT');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.health({ signal: controller.signal }), error => error.code === 'ABORTED');
});

test('El catálogo resuelve IDs, filtra inactivos y ofrece únicamente comandos reales', () => {
  const catalog = new Catalog(commands);
  assert.equal(catalog.direction('forward').id_comando, 42);
  assert.equal(catalog.direction('left').id_comando, 43);
  assert.equal(catalog.direction('right'), null);
  assert.equal(catalog.get(82), null);
  assert.deepEqual(catalog.extras().map(command => command.id_comando), [71]);
  assert.equal(commandLabel(catalog.get(71)), 'Luces');
  assert.equal(catalog.all().length, 4);
  assert.throws(() => new Catalog([commands[0], commands[0]]), ApiError);
  assert.throws(() => new Catalog([{ ...commands[0], activo: true }]), ApiError);
  assert.throws(() => new Catalog([{ ...commands[0], codigo: '1' }]), ApiError);
});

test('API disponible no implica RDS disponible y un fallo de red no acusa a RDS', async () => {
  const values = [];
  const api = {
    health: async () => ({ status: 'ok', database: 'no comprobada' }),
    rdsHealth: async () => { throw new ApiError('Red no disponible', { code: 'NETWORK' }); },
  };
  const health = new HealthService(api, { onChange: value => values.push(value) });
  await health.check();
  assert.deepEqual(values.at(-1), { api: 'available', rds: 'unverified' });
  api.rdsHealth = async () => { throw new ApiError('Proxy unavailable', { status: 503 }); };
  await health.check();
  assert.equal(values.at(-1).rds, 'unverified');
  api.rdsHealth = async () => { throw new ApiError('Backend unavailable', { status: 503, diagnostic: true }); };
  await health.check();
  assert.equal(values.at(-1).rds, 'unavailable');
  api.rdsHealth = async () => ({ status: 'ok', database: 'RDS' });
  await health.check();
  assert.deepEqual(values.at(-1), { api: 'available', rds: 'available' });
});

test('HealthService evita sondeos solapados y descarta resultados después de stop', async () => {
  let resolveHealth;
  let calls = 0;
  const values = [];
  const health = new HealthService({
    health: () => { calls += 1; return new Promise(resolve => { resolveHealth = resolve; }); },
    rdsHealth: async () => ({ status: 'ok', database: 'RDS' }),
  }, { onChange: value => values.push(value) });
  const first = health.check();
  assert.equal(health.check(), first);
  await Promise.resolve();
  health.stop();
  const count = values.length;
  resolveHealth({ status: 'ok' });
  await first;
  assert.equal(calls, 1);
  assert.equal(values.length, count);
});

class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }
  addEventListener(name, listener) {
    const entries = this.listeners.get(name) ?? [];
    entries.push(listener);
    this.listeners.set(name, entries);
  }
  emit(name, data = {}) { for (const listener of this.listeners.get(name) ?? []) listener(data); }
  open() { this.readyState = 1; this.emit('open'); }
  close() { this.readyState = 3; this.emit('close'); }
}

test('WSS refleja apertura, desconexión y reconexión reales de cada sesión', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeSocket.instances = [];
  const states = [];
  const client = new SocketClient('wss://example.test/ws/vehiculos/1', {
    WebSocketImpl: FakeSocket, random: () => 0.5, onStatus: value => states.push(value),
  });
  client.start();
  assert.equal(states.at(-1), 'connecting');
  const first = FakeSocket.instances[0];
  first.open();
  assert.equal(states.at(-1), 'connected');
  first.close();
  assert.deepEqual(states.slice(-2), ['disconnected', 'reconnecting']);
  t.mock.timers.tick(999);
  assert.equal(FakeSocket.instances.length, 1);
  t.mock.timers.tick(1);
  assert.equal(FakeSocket.instances.length, 2);
  FakeSocket.instances[1].open();
  assert.equal(states.at(-1), 'connected');
  client.stop();
  t.mock.timers.tick(60000);
  assert.equal(states.at(-1), 'disconnected');
  assert.equal(FakeSocket.instances.length, 2);
});

test('WSS valida JSON y descarta mensajes de sesiones anteriores', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeSocket.instances = [];
  const events = [];
  const errors = [];
  const client = new SocketClient('wss://example.test/ws/vehiculos/1', {
    WebSocketImpl: FakeSocket, random: () => 0.5,
    onEvent: value => events.push(value), onError: value => errors.push(value),
  });
  client.start();
  const first = FakeSocket.instances[0];
  first.open();
  const state = { tipo: 'estado_inicial', id_vehiculo: 1, timestamp: '2026-11-06T00:00:00+00:00', estado: null };
  first.emit('message', { data: JSON.stringify(state) });
  first.emit('message', { data: '<html>' });
  first.emit('message', { data: JSON.stringify({ ...state, id_vehiculo: true }) });
  assert.deepEqual(events, [state]);
  assert.equal(errors.length, 2);
  first.close();
  t.mock.timers.tick(1000);
  first.emit('message', { data: JSON.stringify(state) });
  assert.equal(events.length, 1);
  client.stop();
});
