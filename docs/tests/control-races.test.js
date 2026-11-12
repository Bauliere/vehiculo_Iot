import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlController } from '../assets/js/controllers/control-controller.js';
import { ControlState } from '../assets/js/state/control-state.js';
import { Catalog } from '../assets/js/domain/catalog.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const demoStart = id => ({
  tipo: 'demo_inicio', id_vehiculo: 1, id_demo: id, total_movimientos: 7,
  timestamp: new Date().toISOString(),
});
function setup() {
  const calls = [];
  const api = {
    hasKey: () => true,
    move: async (vehicle, command) => { calls.push(`move:${command}`); return { id_vehiculo: vehicle, id_comando: command }; },
    startDemo: async (vehicle, demo) => ({ id_vehiculo: vehicle, id_demo: demo }),
    cancelDemo: async (vehicle, demo) => { calls.push(`cancel:${demo}`); return { id_vehiculo: vehicle, id_demo: demo }; },
  };
  const state = new ControlState();
  const catalog = new Catalog([
    { id_comando: 1, id_vehiculo: 1, nombre: 'AVANZAR', codigo: 1, activo: 1 },
    { id_comando: 9, id_vehiculo: 1, nombre: 'DETENER', codigo: 9, activo: 1 },
  ]);
  return { calls, api, state, control: new ControlController(api, 1, catalog, state) };
}

test('un inicio propio rechazado no borra una DEMO externa conocida por WSS', async () => {
  const pending = deferred();
  const { api, control, state, calls } = setup();
  api.startDemo = () => pending.promise;
  const ownStart = control.startDemo(1);
  control.handleEvent(demoStart(4));
  assert.equal(control.demoId, 4);
  pending.reject(Object.assign(new Error('Ya hay otra DEMO'), { status: 409 }));
  await ownStart;
  assert.equal(control.demoId, 4);
  assert.notEqual(state.value.phase, 'idle');
  control.requestCommand(1);
  clearTimeout(control.timer);
  await control.drain();
  assert.deepEqual(calls, []);
  await control.stop();
  assert.deepEqual(calls, ['cancel:4', 'move:9']);
});

test('DETENER conserva la prioridad si una DEMO externa empieza durante su POST', async () => {
  const pendingStop = deferred();
  const { api, control, state, calls } = setup();
  const originalMove = api.move;
  let first = true;
  api.move = (vehicle, command) => {
    if (first) { first = false; calls.push('move-pending:9'); return pendingStop.promise; }
    return originalMove(vehicle, command);
  };
  const stopping = control.stop();
  await tick();
  control.handleEvent(demoStart(4));
  assert.equal(state.value.phase, 'stopping');
  pendingStop.reject(Object.assign(new Error('Hay una DEMO activa'), { status: 409 }));
  assert.equal(await stopping, true);
  assert.deepEqual(calls, ['move-pending:9', 'cancel:4', 'move:9']);
  assert.equal(control.demoId, null);
  assert.equal(state.value.requested, 'DETENER');
  assert.equal(state.value.phase, 'idle');
});
