const OUTPUT_RATE = 16000;
const FRAME_SAMPLES = 640; // 40 ms

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.index = 0;
    this.phase = 0;
    this.sum = 0;
    this.samples = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (const sample of channel) {
      // Promedia las muestras entre posiciones al bajar a 16 kHz.
      this.sum += sample;
      this.samples += 1;
      this.phase += OUTPUT_RATE;
      if (this.phase < sampleRate) continue;

      const value = Math.max(-1, Math.min(1, this.sum / this.samples));
      this.frame[this.index++] = Math.round(value * 32767);
      this.phase -= sampleRate;
      this.sum = 0;
      this.samples = 0;
      if (this.index === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.index = 0;
      }
    }
    return true;
  }
}

registerProcessor('voice-capture', VoiceCaptureProcessor);
