const FORMATS = [
  ['audio/webm;codecs=opus', 'audio/webm'],
  ['audio/mp4', 'audio/m4a'],
  ['audio/ogg;codecs=opus', 'audio/ogg'],
];

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
    const clip = { cancelled: false };
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
    const [mimeType, mime] = this.format;
    const recorder = new MediaRecorder(clip.stream, { mimeType, audioBitsPerSecond: 48000 });
    clip.recorder = recorder;
    const chunks = [];
    const audio = await new Promise((resolve, reject) => {
      recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener('error', () => reject(new Error('Error al grabar el audio.')), { once: true });
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
      recorder.start();
      const started = performance.now();
      this.onUpdate(0);
      clip.clock = setInterval(() => this.onUpdate(Math.floor((performance.now() - started) / 1000)), 250);
      clip.limit = setTimeout(() => this.stop(), 15000);
    });
    if (clip.cancelled) return null;
    if (audio.size === 0 || audio.size > 768 * 1024) throw new Error('Graba una instrucción corta e inténtalo de nuevo.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',', 2)[1]);
      reader.onerror = () => reject(new Error('No se pudo leer la grabación.'));
      reader.readAsDataURL(audio);
    });
    return clip.cancelled ? null : { audio: data, mime };
  }

  stop() {
    if (this.current?.recorder?.state === 'recording') this.current.recorder.stop();
  }

  discard() {
    if (!this.current) return;
    this.current.cancelled = true;
    this.stop();
  }
}
