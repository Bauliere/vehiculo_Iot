import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlFeedback } from '../assets/js/components/control-feedback.js';

test('los auxiliares conservan la última orden y sólo se apagan al vencer un tiempo explícito', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const light = { dataset: {}, setAttribute() {}, querySelector: () => null };
  const feedback = new ControlFeedback({
    querySelector: selector => selector.includes('ALTERNAR_LUCES') ? light : null,
    getElementById: () => ({ dataset: {} }),
  }, 1);
  let second = 0;
  function send(tipo, fields = {}) {
    const finish = tipo === 'demo_fin';
    const timestamp = new Date(Date.UTC(2026, 10, 18, 10, 0, second++)).toISOString();
    const command = finish ? 'DETENER' : 'ALTERNAR_LUCES';
    const code = finish ? 9 : 7;
    feedback.handleEvent({
      tipo, id_vehiculo: 1, timestamp, id_demo: 1, id_comando: code, codigo: code, comando: command,
      estado: { id_vehiculo: 1, vehiculo: 'Máquina de carga', id_comando: code, codigo: code,
        comando: command, conectado: 1, fecha_actualizacion: timestamp },
      ...fields,
    });
  }

  send('demo_movimiento', { auxiliar: 'encender', duracion_auxiliar_ms: 0 });
  send('demo_movimiento', { auxiliar: 'encender', duracion_auxiliar_ms: 0 });
  send('demo_fin');
  t.mock.timers.tick(2000);
  assert.equal(light.dataset.toggle, 'on');

  send('demo_movimiento', { auxiliar: 'apagar', duracion_auxiliar_ms: 0 });
  assert.equal(light.dataset.toggle, 'off');

  send('demo_movimiento', { auxiliar: 'encender', duracion_auxiliar_ms: 1250 });
  t.mock.timers.tick(1249);
  assert.equal(light.dataset.toggle, 'on');
  t.mock.timers.tick(1);
  assert.equal(light.dataset.toggle, 'off');

  send('movimiento_individual');
  assert.equal(light.dataset.toggle, 'on');
  send('demo_movimiento');
  assert.equal(light.dataset.toggle, 'on');
  feedback.stop();
});
