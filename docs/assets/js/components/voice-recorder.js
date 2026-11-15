const FORMATS = [
  ['audio/webm;codecs=opus', 'audio/webm'],
  ['audio/mp4', 'audio/m4a'],
  ['audio/ogg;codecs=opus', 'audio/ogg'],
];
const MAX_AUDIO_BYTES = 768 * 1024;
const MAX_RECORDING_MS = 120000;

export class VoiceRecorder {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.format = typeof MediaRecorder !== 'undefined' &&
      FORMATS.find(([type]) => MediaRecorder.isTypeSupported(type));
    this.supported = Boolean(navigator.mediaDevices?.getUserMedia && this.format);
    this.current = null;
  }

  record() {
    if (this.current) throw new Error('Ya hay una grabación abierta.');
    const clip = { cancelled: false, stopRequested: false };
    this.current = clip;
    return this.capture(clip).finally(() => {
      clearInterval(clip.clock);
      clearTimeout(clip.limit);
      clip.stream?.getTracks().forEach(track => track.stop());
      this.current = null;
      this.onUpdate(null);
    });
  }

  async capture(clip) {
    clip.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (clip.cancelled) return null;
    if (clip.stopRequested) throw new Error('El micrófono aún no estaba listo. Vuelve a grabar.');
    const [mimeType, mime] = this.format;
    const recorder = new MediaRecorder(clip.stream, { mimeType, audioBitsPerSecond: 48000 });
    clip.recorder = recorder;
    const chunks = [];
    let bytes = 0;
    const audio = await new Promise((resolve, reject) => {
      recorder.addEventListener('dataavailable', event => {
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) {
          clip.tooLong = true;
          this.stop();
        } else if (event.data.size && !clip.tooLong) chunks.push(event.data);
      });
      recorder.addEventListener('error', () => reject(new Error('Error al grabar el audio.')), { once: true });
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
      recorder.start(500);
      const started = performance.now();
      this.onUpdate(0);
      clip.clock = setInterval(() => this.onUpdate(Math.floor((performance.now() - started) / 1000)), 250);
      clip.limit = setTimeout(() => {
        clip.tooLong = true;
        this.stop();
      }, MAX_RECORDING_MS);
    });
    if (clip.cancelled) return null;
    if (clip.tooLong) throw new Error('La grabación superó el límite. Graba una instrucción más corta.');
    if (audio.size === 0) throw new Error('No se capturó audio. Inténtalo de nuevo.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',', 2)[1]);
      reader.onerror = () => reject(new Error('No se pudo leer la grabación.'));
      reader.readAsDataURL(audio);
    });
    return clip.cancelled ? null : { audio: data, mime };
  }

  stop() {
    if (!this.current) return;
    this.current.stopRequested = true;
    if (this.current.recorder?.state === 'recording') this.current.recorder.stop();
  }

  discard() {
    if (!this.current) return;
    this.current.cancelled = true;
    this.stop();
  }
}
