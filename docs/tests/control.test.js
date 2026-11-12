import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlController } from '../assets/js/controllers/control-controller.js';
import { ControlState } from '../assets/js/state/control-state.js';
import { Catalog } from '../assets/js/domain/catalog.js';

const names = ['AVANZAR','RETROCEDER','GIRAR_IZQUIERDA','GIRAR_DERECHA','SUBIR_CAJA','BAJAR_CAJA','ALTERNAR_LUCES','ALTERNAR_SONIDO','DETENER'];
const commands = names.map((nombre, index) => ({ nombre, id_comando: index + 1, codigo: index + 1, id_vehiculo: 1, activo: 1 }));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
function setup(overrides = {}) {
  const calls = [];
  const api = { hasKey: () => true,
    move: async (v,c) => { calls.push(`move:${c}`); return {id_vehiculo:v,id_comando:c}; },
    startDemo: async (v,d) => { calls.push(`start:${d}`); return {id_vehiculo:v,id_demo:d}; },
    cancelDemo: async (v,d) => { calls.push(`cancel:${d}`); return {id_vehiculo:v,id_demo:d}; }, ...overrides };
  const state = new ControlState();
  return { calls, api, state, control: new ControlController(api, 1, new Catalog(commands), state) };
}
function send(control, id) { control.requestCommand(id); clearTimeout(control.timer); return control.drain(); }

test('arrastre rápido conserva la última dirección y no envía una cola obsoleta', async () => {
  const {control,calls} = setup();
  control.requestCommand(1); control.requestCommand(3); control.requestCommand(4);
  clearTimeout(control.timer);
  await control.drain();
  assert.deepEqual(calls, ['move:4']);
});
test('DETENER descarta una dirección aún no enviada', async () => {
  const {control,calls} = setup();
  control.requestCommand(1);
  await control.stop();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.deepEqual(calls, ['move:9']);
});
test('DETENER se envía sin esperar movimiento pendiente y se reafirma al resolverlo', async () => {
  const pending = deferred();
  const {control,calls,api,state} = setup();
  const defaultMove = api.move;
  api.move = (v,c) => c === 1 ? (calls.push('move:1'),pending.promise) : defaultMove(v,c);
  const first = send(control,1);
  const stop = control.stop();
  await tick();
  assert.deepEqual(calls, ['move:1','move:9']);
  pending.resolve({id_vehiculo:1,id_comando:1});
  await Promise.all([first,stop]);
  assert.deepEqual(calls, ['move:1','move:9','move:9']);
  assert.equal(state.value.requested,'DETENER');
  assert.equal(state.value.phase,'idle');
});
test('cancelar mientras el inicio está pendiente vuelve a cancelar después del HTTP 202', async () => {
  const start = deferred();
  const {control,calls,api,state} = setup();
  api.startDemo = () => {calls.push('start:4'); return start.promise;};
  const running = control.startDemo(4);
  const stopping = control.stop();
  await tick();
  assert.ok(calls.includes('cancel:4'));
  start.resolve({id_vehiculo:1,id_demo:4});
  await Promise.all([running,stopping]);
  assert.deepEqual(calls, ['start:4','cancel:4','move:9','cancel:4','move:9']);
  assert.equal(control.demoId,null);
  assert.equal(state.value.requested,'DETENER');
});
test('no admite dos DEMO ni movimientos manuales durante una DEMO', async () => {
  const {control,calls} = setup();
  await control.startDemo(1);
  await control.startDemo(1);
  await send(control,1);
  assert.deepEqual(calls,['start:1']);
});
test('estado inicial y eventos de otro vehículo no generan órdenes ni confirmación falsa', async () => {
  const {control,calls,state} = setup();
  control.handleEvent({tipo:'estado_inicial',id_vehiculo:1,timestamp:new Date().toISOString(),codigo:1});
  control.handleEvent({tipo:'demo_inicio',id_vehiculo:2,id_demo:9,timestamp:new Date().toISOString()});
  assert.equal(control.demoId,null);
  assert.deepEqual(calls,[]);
  assert.equal(state.value.event,'Sin evento de acción');
});
test('HTTP exitoso no se confunde con un evento, y solo corresponde el comando correcto', async () => {
  const {control,state} = setup();
  await send(control,1);
  assert.equal(state.value.event,'Esperando evento');
  const stamp = new Date().toISOString();
  control.handleEvent({tipo:'movimiento_individual',id_vehiculo:1,id_comando:2,codigo:2,comando:'RETROCEDER',timestamp:stamp});
  assert.equal(state.value.event,'Esperando evento');
  control.handleEvent({tipo:'movimiento_individual',id_vehiculo:1,id_comando:1,codigo:1,comando:'AVANZAR',timestamp:stamp});
  assert.match(state.value.event,/Avanzar/);
});
test('una orden nueva idéntica puede enviarse después de la anterior', async () => {
  const {control,calls} = setup();
  await send(control,7); await send(control,7);
  assert.deepEqual(calls,['move:7','move:7']);
});
test('fallo de parada bloquea nuevas órdenes hasta confirmar otra parada', async () => {
  const {control,api,state,calls} = setup();
  const defaultMove = api.move;
  api.move = async () => { throw new Error('Fallo de red'); };
  assert.equal(await control.stop(),false);
  assert.equal(state.value.phase,'uncertain');
  api.move = defaultMove;
  await send(control,1);
  assert.deepEqual(calls,[]);
  assert.equal(await control.stop(),true);
  await send(control,1);
  assert.deepEqual(calls,['move:9','move:1']);
});
test('un 409 de DEMO externa cancela la selección antes de reintentar DETENER', async () => {
  const {control,api,calls} = setup();
  const defaultMove=api.move;
  let first=true;
  api.move=async(v,c)=>{ if(first){first=false;calls.push('conflict');throw Object.assign(new Error('DEMO activa'),{status:409});} return defaultMove(v,c); };
  control.selectedDemoId=4;
  assert.equal(await control.stop(),true);
  assert.deepEqual(calls,['conflict','cancel:4','move:9']);
});

test('401 y 403 en DETENER explican la credencial rechazada y permiten recuperar con otra parada', async () => {
  for (const status of [401, 403]) {
    const { control, api, state, calls } = setup();
    const originalMove = api.move;
    api.move = async () => { throw Object.assign(new Error('Credencial rechazada'), { status }); };
    assert.equal(await control.stop(), false);
    assert.equal(state.value.authError, status);
    assert.equal(state.value.phase, 'uncertain');
    assert.match(state.value.message, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(state.value.message, /Revisa conexión/);
    // Sustituir la clave no ejecuta ni repite un movimiento.
    state.update({ authError: null });
    await send(control, 1);
    assert.deepEqual(calls, []);
    api.move = originalMove;
    assert.equal(await control.stop(), true);
    assert.equal(state.value.authError, null);
    assert.equal(state.value.phase, 'idle');
    assert.deepEqual(calls, ['move:9']);
  }
});

test('un evento final de DEMO no desbloquea una parada que la API rechazó', async () => {
  const { control, api, state } = setup();
  control.demoId = 4;
  api.cancelDemo = async () => { throw Object.assign(new Error('Clave rechazada'), { status: 401 }); };
  await control.stop();
  control.handleEvent({ tipo: 'demo_fin', id_vehiculo: 1, id_demo: 4, timestamp: new Date().toISOString() });
  assert.equal(state.value.phase, 'uncertain');
  assert.equal(state.value.authError, 401);
});

test('la clave se valida con la respuesta de una orden, no con consultas ni eventos WSS', async () => {
  const response = deferred();
  const { control, api, state } = setup({
    getVehicle: async () => ({ id_vehiculo: 1 }),
    move: async () => response.promise,
  });
  assert.equal(state.value.authValidated, false);
  await api.getVehicle(1);
  control.handleEvent({ tipo: 'estado_inicial', id_vehiculo: 1, timestamp: new Date().toISOString(), codigo: 9 });
  assert.equal(state.value.authValidated, false);
  const moving = send(control, 1);
  control.handleEvent({ tipo: 'movimiento_individual', id_vehiculo: 1, id_comando: 1,
    codigo: 1, comando: 'AVANZAR', timestamp: new Date().toISOString() });
  assert.match(state.value.event, /Avanzar/);
  assert.equal(state.value.authValidated, false);
  response.resolve({ id_vehiculo: 1, id_comando: 1 });
  await moving;
  assert.equal(state.value.authValidated, true);
});

test('un rechazo de autorización invalida una clave aceptada anteriormente', async () => {
  for (const status of [401, 403]) {
    const { control, api, state } = setup();
    await control.stop();
    assert.equal(state.value.authValidated, true);
    api.move = async () => { throw Object.assign(new Error('Clave rechazada'), { status }); };
    assert.equal(await control.stop(), false);
    assert.equal(state.value.authValidated, false);
    assert.equal(state.value.authError, status);
    assert.equal(state.value.phase, 'uncertain');
  }
});

test('solo una respuesta coherente de DEMO puede validar la clave', async () => {
  const accepted = setup();
  await accepted.control.startDemo(1);
  assert.equal(accepted.state.value.authValidated, true);
  const mismatch = setup({ startDemo: async () => ({ id_vehiculo: 2, id_demo: 1 }) });
  await mismatch.control.startDemo(1);
  assert.equal(mismatch.state.value.authValidated, false);
});
