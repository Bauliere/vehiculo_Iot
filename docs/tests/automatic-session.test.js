import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../assets/js/services/api-client.js';

const token = version => `sesion-temporal-sin-valor-real-${version}-1234567890`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Acceso automático comparte la sesión y nunca obtiene la clave maestra', async () => {
  const calls = [];
  const api = new ApiClient('https://api.example.test', { automaticVehicleId: 1, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return json({ token: token(1), expires_in: 900, id_vehiculo: 1 });
  } });
  await Promise.all([api.connectControl(), api.connectControl()]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://api.example.test/control/sesion');
  assert.equal(calls[0][1].headers['X-API-Key'], undefined);
  assert.equal(api.hasKey(), true);
  await api.connectControl();
  assert.equal(calls.length, 1);
});

test('Un 401 renueva la sesión una sola vez y repite solamente la orden rechazada', async () => {
  let sessions = 0, posts = 0;
  const keys = [];
  const api = new ApiClient('https://api.example.test', { automaticVehicleId: 1, fetchImpl: async (url, options) => {
    if (url.endsWith('/control/sesion')) return json({ token: token(++sessions), expires_in: 900, id_vehiculo: 1 });
    posts++;
    keys.push(options.headers['X-API-Key']);
    return posts === 1 ? json({ detail: 'Caducada' }, 401) : json({ id_vehiculo: 1, id_comando: 9 });
  } });
  await api.move(1, 9);
  assert.equal(sessions, 2);
  assert.equal(posts, 2);
  assert.deepEqual(keys, [token(1), token(2)]);
});

test('No repite un movimiento por un 500 ni reutiliza una sesión de otro vehículo', async () => {
  let posts = 0;
  const api = new ApiClient('https://api.example.test', { automaticVehicleId: 1, fetchImpl: async url => {
    if (url.endsWith('/control/sesion')) return json({ token: token(1), expires_in: 900, id_vehiculo: 1 });
    posts++;
    return json({ detail: 'Error' }, 500);
  } });
  await assert.rejects(api.move(1, 1), error => error.status === 500);
  assert.equal(posts, 1);
  const wrong = new ApiClient('https://api.example.test', { automaticVehicleId: 1, fetchImpl: async () =>
    json({ token: token(1), expires_in: 900, id_vehiculo: 2 }) });
  await assert.rejects(wrong.connectControl(), /sesión de control válida/);
  assert.equal(wrong.hasKey(), false);
});
