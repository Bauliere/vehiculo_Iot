const SAMPLE_RATE = 16000;
const SILENCE_SAMPLES = SAMPLE_RATE * 2.5;
const PRE_ROLL_SAMPLES = SAMPLE_RATE * 0.24;
const TAIL_SAMPLES = SAMPLE_RATE * 0.16;
const MIN_VOICE_RMS = 0.012;
const MAX_RECORDING_MS = 120000;
const STARTUP_TIMEOUT_MS = 8000;
const CaptureContext = globalThis.AudioContext || globalThis.webkitAudioContext;

class Recording {
  constructor() {
    this.frames = [];
    this.samples = 0;
    this.voiceFrames = 0;
    this.firstVoice = null;
    this.lastVoice = null;
  }

  append(frame) {
    this.frames.push(frame);
    this.samples += frame.length;
    let power = 0;
    for (const sample of frame) power += sample * sample;
    const rms = Math.sqrt(power / frame.length) / 32768;
    this.voiceFrames = rms >= MIN_VOICE_RMS ? this.voiceFrames + 1 : 0;
    if (this.voiceFrames >= 2) {
      this.firstVoice ??= this.samples - frame.length * 2;
      this.lastVoice = this.samples;
    }
    return this.voiceFrames === 0 && this.lastVoice !== null && this.samples - this.lastVoice >= SILENCE_SAMPLES;
  }

  wav() {
    if (this.lastVoice === null) throw new Error('No se detectó voz. Acércate al micrófono e inténtalo de nuevo.');

    const start = Math.max(0, this.firstVoice - PRE_ROLL_SAMPLES);
    const end = Math.min(this.samples, this.lastVoice + TAIL_SAMPLES);
    const size = (end - start) * 2;
    const header = new DataView(new ArrayBuffer(44));
    header.setUint32(0, 0x52494646); // RIFF
    header.setUint32(4, 36 + size, true);
    header.setUint32(8, 0x57415645); // WAVE
    header.setUint32(12, 0x666d7420); // fmt
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true); // PCM
    header.setUint16(22, 1, true); // Mono
    header.setUint32(24, SAMPLE_RATE, true);
    header.setUint32(28, SAMPLE_RATE * 2, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    header.setUint32(36, 0x64617461); // data
    header.setUint32(40, size, true);

    const pcm = new DataView(new ArrayBuffer(size));
    let offset = 0;
    let target = 0;
    for (const frame of this.frames) {
      for (let i = Math.max(0, start - offset); i < frame.length && offset + i < end; i += 1) {
        pcm.setInt16(target, frame[i], true);
        target += 2;
      }
      offset += frame.length;
      if (offset >= end) break;
    }
    return new Blob([header, pcm], { type: 'audio/wav' });
  }
}

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',', 2)[1]);
    reader.onerror = () => reject(new Error('No se pudo leer la grabación.'));
    reader.readAsDataURL(blob);
  });
}

export class VoiceRecorder {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.supported = Boolean(globalThis.navigator?.mediaDevices?.getUserMedia &&
      CaptureContext && globalThis.AudioWorkletNode);
    this.current = null;
  }

  record() {
    if (this.current) throw new Error('Ya hay una grabación abierta.');
    const clip = { cancelled: false, stopRequested: false };
    this.current = clip;
    return this.capture(clip).finally(() => {
      clearInterval(clip.clock);
      clearTimeout(clip.limit);
      if (clip.processor) clip.processor.port.close();
      clip.source?.disconnect();
      clip.processor?.disconnect();
      clip.stream?.getTracks().forEach(track => track.stop());
      if (clip.context) void clip.context.close().catch(() => {});
      this.current = null;
      this.onUpdate(null);
    });
  }

  async capture(clip) {
    // Inicia la reanudación en el gesto, antes del diálogo de permisos del móvil.
    clip.context = new CaptureContext();
    void clip.context.resume().catch(() => {});
    clip.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    if (clip.cancelled) return null;
    // Tras el permiso, limita el tiempo de preparación y permite cerrar el chat mientras carga.
    try {
      await Promise.race([
        Promise.all([
          clip.context.resume(),
          clip.context.audioWorklet.addModule(new URL('./voice-capture-processor.js', import.meta.url)),
        ]),
        new Promise((resolve, reject) => {
          clip.finish = resolve;
          clip.limit = setTimeout(() => reject(new Error('No se pudo iniciar el micrófono. Vuelve a intentarlo.')), STARTUP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(clip.limit);
    }
    if (clip.cancelled) return null;
    if (clip.stopRequested) throw new Error('El micrófono aún no estaba listo. Vuelve a grabar.');

    const recording = new Recording();
    clip.source = clip.context.createMediaStreamSource(clip.stream);
    clip.processor = new AudioWorkletNode(clip.context, 'voice-capture', { channelCount: 1 });
    await new Promise((resolve, reject) => {
      clip.finish = resolve;
      clip.processor.onprocessorerror = () => reject(new Error('Error al grabar el audio.'));
      clip.processor.port.onmessage = ({ data }) => {
        if (!clip.stopRequested && recording.append(data)) this.stop();
      };
      for (const track of clip.stream.getAudioTracks()) {
        track.addEventListener('ended', () => reject(new Error('Se desconectó el micrófono.')), { once: true });
      }
      clip.source.connect(clip.processor);
      // El procesador deja la salida en silencio y solo envía muestras por su puerto.
      clip.processor.connect(clip.context.destination);
      this.onUpdate(0);
      const started = performance.now();
      clip.clock = setInterval(() => this.onUpdate(Math.floor((performance.now() - started) / 1000)), 250);
      clip.limit = setTimeout(() => {
        clip.tooLong = true;
        this.stop();
      }, MAX_RECORDING_MS);
    });
    if (clip.cancelled) return null;
    if (clip.tooLong) throw new Error('La grabación superó el límite de dos minutos. Graba una instrucción más corta.');
    const audio = await readBase64(recording.wav());
    return clip.cancelled ? null : { audio, mime: 'audio/wav' };
  }

  stop() {
    if (!this.current) return;
    this.current.stopRequested = true;
    this.current.finish?.();
  }

  discard() {
    if (!this.current) return;
    this.current.cancelled = true;
    this.stop();
  }
}
