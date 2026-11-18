import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../assets/js/services/api-client.js';

let microphone;
let worklet;
let context;

class AudioContextMock {
  constructor() {
    context = this;
    this.audioWorklet = { addModule: async () => {} };
  }
  async resume() {}
  async close() { this.closed = true; }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
}

class WorkletMock {
  constructor() {
    worklet = this;
    this.port = { close: () => { this.port.onmessage = null; } };
  }
  connect() {}
  disconnect() {}
  feed(amplitude, frames) {
    const frame = new Int16Array(640).fill(amplitude);
    for (let index = 0; index < frames; index += 1) {
      this.port.onmessage?.({ data: frame });
    }
  }
}

globalThis.AudioContext = AudioContextMock;
globalThis.AudioWorkletNode = WorkletMock;
globalThis.FileReader = class {
  async readAsDataURL(blob) {
    this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
    this.onload();
  }
};
Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: {
  async getUserMedia() {
    microphone = new class extends EventTarget {
      stop() { this.stopped = true; }
    }();
    return { getAudioTracks: () => [microphone], getTracks: () => [microphone] };
  },
} });
const { VoiceRecorder } = await import('../assets/js/components/voice-recorder.js');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('espera voz y reinicia el plazo al oír otra frase antes de 2,5 segundos', async () => {
  const recorder = new VoiceRecorder(() => {});
  const clip = recorder.record();
  await nextTurn();
  worklet.feed(0, 70);
  assert.equal(recorder.current.stopRequested, false);
  worklet.feed(800, 4);
  worklet.feed(0, 62); // 2,48 s.
  assert.equal(recorder.current.stopRequested, false);
  worklet.feed(900, 4);
  worklet.feed(0, 62);
  assert.equal(recorder.current.stopRequested, false);
  worklet.feed(0, 1); // 2,52 s con bloques de 40 ms.
  const { audio, mime } = await clip;
  const wav = Buffer.from(audio, 'base64');

  assert.equal(mime, 'audio/wav');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 80 * 640 * 2); // Conserva la pausa entre frases y recorta los extremos.
  assert.equal(wav.readInt16LE(44 + 6 * 640 * 2), 800);
  assert.equal(wav.readInt16LE(44 + 72 * 640 * 2), 900);
  assert.equal(microphone.stopped, true);
  assert.equal(context.closed, true);
  assert.equal(recorder.current, null);
});

test('un toque de ruido no envía audio y cancelar libera la captura', async () => {
  const recorder = new VoiceRecorder(() => {});
  const empty = recorder.record();
  await nextTurn();
  worklet.feed(12000, 1);
  worklet.feed(0, 65);
  recorder.stop();
  await assert.rejects(empty, /No se detectó voz/);
  assert.equal(microphone.stopped, true);

  const discarded = recorder.record();
  await nextTurn();
  worklet.feed(800, 4);
  recorder.discard();
  assert.equal(await discarded, null);
  assert.equal(microphone.stopped, true);
  assert.equal(context.closed, true);
});

test('el procesador agrupa muestras a 16 kHz', async () => {
  const frames = [];
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class {
    port = { postMessage: frame => frames.push(frame) };
  };
  let Processor;
  globalThis.registerProcessor = (name, implementation) => {
    assert.equal(name, 'voice-capture');
    Processor = implementation;
  };
  await import('../assets/js/components/voice-capture-processor.js');
  const processor = new Processor();
  for (let chunk = 0; chunk < 30; chunk += 1) {
    processor.process([[new Float32Array(128).fill(0.5)]]);
  }
  assert.equal(frames.length, 2);
  assert.equal(frames[0].length, 640);
  assert.equal(frames[0][639], 16384);
});

test('la interpretación de voz conserva el diagnóstico del servidor', async () => {
  const detail = 'Gemini rechazó la grabación. Vuelve a grabar o envía la instrucción por texto.';
  const api = new ApiClient('https://example.test', { fetchImpl: async (url, request) => {
    assert.equal(url, 'https://example.test/vehiculos/1/fausto/interpretar');
    assert.deepEqual(JSON.parse(request.body), { audio: 'UklGRg==', mime: 'audio/wav' });
    return Response.json({ detail }, { status: 502 });
  } });
  api.setKey('solo-pruebas');
  await assert.rejects(api.interpretFausto(1, { audio: 'UklGRg==', mime: 'audio/wav' }), {
    status: 502, message: detail,
  });
});
