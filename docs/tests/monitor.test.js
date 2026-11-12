import test from 'node:test';
import assert from 'node:assert/strict';
import { MonitorController } from '../assets/js/controllers/monitor-controller.js';
import { MonitorView } from '../assets/js/components/monitor-view.js';
import { normalizeHistory, normalizeState, normalizeEvent, parseServerTime, formatServerTime } from '../assets/js/domain/monitor-data.js';
import { ApiClient } from '../assets/js/services/api-client.js';

const state = (command = 'DETENER', time = '2026-11-11T18:00:00', id = 9) => ({
  id_vehiculo: 1, vehiculo: 'Máquina de carga', id_comando: id, comando: command,
  codigo: id, conectado: 0, fecha_actualizacion: time,
});
const record = (id, time = '2026-11-11T18:00:00', extra = {}) => ({
  id_historial: id, id_vehiculo: 1, comando: 'AVANZAR', codigo: 1,
  fecha_hora: time, origen: 'API', ...extra,
});
const movement = (time = '2026-11-11T18:00:01.123+00:00', extra = {}) => ({
  tipo: 'movimiento_individual', id_vehiculo: 1, id_comando: 1, comando: 'AVANZAR', codigo: 1,
  timestamp: time, estado: state('AVANZAR', '2026-11-11T18:00:01', 1), ...extra,
});
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const fakeApi = () => ({ getState: async () => state(), getHistory: async () => [record(1)] });

test('Las fechas SQL UTC se convierten a México sin depender de la zona del navegador', () => {
  assert.equal(parseServerTime('2026-11-11T18:00:00'), parseServerTime('2026-11-11T18:00:00+00:00'));
  assert.equal(parseServerTime('2026-11-11T18:00:00.123456+00:00'), Date.parse('2026-11-11T18:00:00.123Z'));
  assert.equal(formatServerTime('2026-11-11T18:00:00').time, '12:00:00');
  assert.equal(formatServerTime(null).date, 'Sin fecha');
  assert.equal(parseServerTime('2026-02-31T18:00:00'), null);
  assert.equal(parseServerTime('2026-11-11'), null);
});

test('Historial filtra vehículo y DEMO, deduplica, ordena por fecha/ID y limita diez sin cambiar la entrada', () => {
  const input = Array.from({ length: 12 }, (_, i) => record(i + 1));
  input.push(record(12), record(70, '2026-11-12T18:00:00', { origen: ' demo ' }),
    record(80, '2026-11-12T18:00:00', { id_vehiculo: 2 }), record(60, '2026-11-10T18:00:00'));
  const before = JSON.stringify(input);
  const result = normalizeHistory(input, 1);
  assert.deepEqual(result.map(row => row.id), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => normalizeHistory({ historial: input }, 1));
  assert.throws(() => normalizeHistory([record(true)], 1));
  assert.throws(() => normalizeState({ ...state(), id_vehiculo: 2 }, 1));
});

test('El último estado conserva fechas ausentes y comandos borrados sin inventar información', () => {
  const result = normalizeState({ ...state(), comando: null, id_comando: null, codigo: null, fecha_actualizacion: null }, 1);
  assert.equal(result.label, 'Sin movimientos');
  assert.equal(result.epoch, null);
  assert.equal(normalizeHistory([record(1, null, { comando: null })], 1)[0].label, 'Comando no disponible');
});

test('Los GET de monitoreo usan rutas existentes, no mandan clave ni escriben', async () => {
  const calls = [];
  const api = new ApiClient('https://example.test', { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response('null', { headers: { 'Content-Type': 'application/json' } });
  } });
  api.setKey('fixture-not-a-real-key');
  await api.getState(1);
  await api.getHistory(1);
  assert.deepEqual(calls.map(call => call.url), ['https://example.test/vehiculos/1/estado', 'https://example.test/vehiculos/1/historial']);
  assert.ok(calls.every(call => call.options.method === 'GET' && !call.options.headers['X-API-Key']));
});

test('La carga inicial consulta estado e historial, también sin WSS disponible', async () => {
  const monitor = new MonitorController(fakeApi(), 1);
  await monitor.start();
  assert.equal(monitor.value.latest.command, 'DETENER');
  assert.equal(monitor.value.latest.source, 'REST');
  assert.equal(monitor.value.records[0].id, 1);
  assert.equal(monitor.value.historyStatus, 'ready');
  assert.equal(monitor.value.socket, 'connecting');
  monitor.stop();
});

test('Una orden externa actualiza el panel por WSS y obtiene únicamente filas persistidas por REST', async () => {
  let count = 0;
  const api = fakeApi();
  api.getHistory = async () => { count++; return count === 1 ? [record(1)] : [record(2), record(1)]; };
  const monitor = new MonitorController(api, 1, { debounceMs: 0 });
  await monitor.start();
  monitor.handleEvent(movement());
  assert.equal(monitor.value.latest.command, 'AVANZAR');
  assert.deepEqual(monitor.value.records.map(row => row.id), [1]);
  await tick();
  assert.deepEqual(monitor.value.records.map(row => row.id), [2, 1]);
  assert.equal(count, 2);
  monitor.stop();
});

test('Los pasos de DEMO cambian el estado y no añaden filas ni solicitan historial', async () => {
  let count = 0;
  const api = fakeApi();
  api.getHistory = async () => { count++; return [record(1)]; };
  const monitor = new MonitorController(api, 1, { debounceMs: 0 });
  await monitor.start();
  monitor.handleEvent(movement(undefined, { tipo: 'demo_movimiento', id_demo: 4, orden: 1 }));
  await tick();
  assert.equal(monitor.value.latest.source, 'DEMO · WSS');
  assert.equal(monitor.value.latest.demoId, 4);
  assert.equal(count, 1);
  assert.deepEqual(monitor.value.records.map(row => row.id), [1]);
  monitor.stop();
});

test('Se ignoran duplicados, eventos atrasados, ajenos e incoherentes', async () => {
  let count = 0;
  const api = fakeApi();
  api.getHistory = async () => { count++; return []; };
  const monitor = new MonitorController(api, 1, { debounceMs: 0 });
  await monitor.start();
  const event = movement();
  monitor.handleEvent(event);
  monitor.handleEvent(event);
  monitor.handleEvent(movement('2026-11-11T17:00:00Z'));
  monitor.handleEvent(movement(undefined, { id_vehiculo: 2 }));
  monitor.handleEvent(movement(undefined, { codigo: 3 }));
  await tick();
  assert.equal(count, 2);
  assert.equal(monitor.value.latest.command, 'AVANZAR');
  assert.equal(normalizeEvent({ ...event, estado: undefined }, 1), null);
  monitor.stop();
});

test('Una respuesta REST que empezó antes del evento no sobrescribe el último movimiento WSS', async () => {
  const pending = deferred();
  const api = fakeApi();
  api.getState = () => pending.promise;
  const monitor = new MonitorController(api, 1, { debounceMs: 0 });
  const ready = monitor.start();
  monitor.handleEvent(movement());
  pending.resolve(state());
  await ready;
  assert.equal(monitor.value.latest.command, 'AVANZAR');
  assert.equal(monitor.value.stateStatus, 'ready');
  monitor.stop();
});

test('Un historial en vuelo se descarta tras otro movimiento y se reconcilia sin consultas paralelas', async () => {
  const pending = deferred();
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const api = fakeApi();
  api.getHistory = async () => {
    calls++; active++; maximum = Math.max(maximum, active);
    const result = calls === 1 ? await pending.promise : [record(2), record(1)];
    active--; return result;
  };
  const monitor = new MonitorController(api, 1, { debounceMs: 0 });
  const ready = monitor.start();
  monitor.handleEvent(movement());
  await tick();
  pending.resolve([record(1)]);
  await ready;
  assert.equal(maximum, 1);
  assert.equal(calls, 2);
  assert.deepEqual(monitor.value.records.map(row => row.id), [2, 1]);
  monitor.stop();
});

test('Reconectar WSS recupera ambos recursos sin polling ni crear otra conexión', async () => {
  let states = 0;
  let histories = 0;
  const api = { getState: async () => { states++; return state(); }, getHistory: async () => { histories++; return []; } };
  const monitor = new MonitorController(api, 1, { debounceMs: 0 });
  await monitor.start();
  monitor.socketStatus('connected');
  await tick();
  const base = histories;
  monitor.socketStatus('connected');
  await tick();
  assert.equal(histories, base);
  monitor.socketStatus('reconnecting');
  monitor.socketStatus('connected');
  await tick();
  assert.equal(histories, base + 1);
  assert.equal(states, histories);
  monitor.stop();
});

test('Al fallar una lectura se conserva el dato anterior como conocido y stop descarta respuestas tardías', async () => {
  const api = fakeApi();
  const monitor = new MonitorController(api, 1);
  await monitor.start();
  api.getHistory = async () => { throw new Error('Sin conexión'); };
  await monitor.refresh();
  assert.equal(monitor.value.historyStatus, 'error');
  assert.equal(monitor.value.historyError, 'Sin conexión');
  assert.equal(monitor.value.records[0].id, 1);
  const pending = deferred();
  api.getState = () => pending.promise;
  const last = monitor.refresh();
  monitor.stop();
  pending.resolve(state('RETROCEDER', '2026-11-11T19:00:00', 2));
  await last;
  assert.equal(monitor.value.latest.command, 'DETENER');
});

test('estado_inicial no reinterpreta su timestamp como una nueva ejecución ni retrocede el estado', async () => {
  const monitor = new MonitorController(fakeApi(), 1, { debounceMs: 0 });
  await monitor.start();
  monitor.handleEvent(movement());
  monitor.handleEvent({ tipo: 'estado_inicial', id_vehiculo: 1,
    timestamp: '2026-11-11T18:00:03+00:00', estado: state() });
  assert.equal(monitor.value.latest.command, 'AVANZAR');
  assert.equal(monitor.value.latest.epoch, parseServerTime('2026-11-11T18:00:01'));
  monitor.stop();
});

class FakeNode {
  constructor() { this.children = []; this.dataset = {}; this.textContent = ''; }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
}
test('Paginación móvil deja accesibles los diez registros y renderiza nombres externos como texto', () => {
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, new FakeNode()); return nodes.get(id); },
    createElement() { return new FakeNode(); } };
  const view = new MonitorView(document, { pageSize: 3 });
  const rows = normalizeHistory(Array.from({ length: 10 }, (_, i) => record(i + 1, undefined,
    { comando: '<img src=x onerror=alert(1)>' })), 1);
  view.render({ latest: normalizeState(state(), 1), records: rows, socket: 'connected', stateStatus: 'ready', historyStatus: 'ready' });
  const body = nodes.get('monitor-history-body');
  assert.equal(body.children.length, 3);
  assert.equal(body.children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(nodes.get('history-page').textContent, '1 / 4');
  view.go(1); view.go(1); view.go(1);
  assert.equal(nodes.get('history-page').textContent, '4 / 4');
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].children[0].textContent, '10');
  assert.equal(nodes.get('history-next').disabled, true);
  view.setPageSize(10);
  assert.equal(body.children.length, 10);
  assert.equal(view.snapshot.records.length, 10);
});
