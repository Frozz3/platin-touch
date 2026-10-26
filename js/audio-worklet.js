// Platin Touch – Tonausgabe (AudioWorklet). Bekommt 16-Bit-Stereo-Blöcke vom Emulator
// und spielt sie aus einem Ringpuffer ab. Läuft der Puffer leer, wird kurz Stille gespielt.
class PtAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 16384;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.read = 0;
    this.write = 0;
    this.fill = 0;
    this.vol = 1;
    this.lastL = 0;
    this.lastR = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.pcm) this.push(m.pcm);
      else if (typeof m.vol === 'number') this.vol = m.vol;
      else if (m.clear) { this.read = this.write = this.fill = 0; }
    };
    this.reportAt = 0;
  }
  push(pcm) {
    const n = pcm.length >> 1;
    // zu voll (Emulator schneller als Ausgabe): ältestes verwerfen
    const max = this.size - 1;
    for (let i = 0; i < n; i++) {
      if (this.fill >= max) { this.read = (this.read + 1) % this.size; this.fill--; }
      this.l[this.write] = pcm[i * 2] / 32768;
      this.r[this.write] = pcm[i * 2 + 1] / 32768;
      this.write = (this.write + 1) % this.size;
      this.fill++;
    }
    // Verzögerung klein halten: mehr als ~120 ms im Puffer -> auf ~60 ms kürzen
    if (this.fill > 6000) {
      const drop = this.fill - 3000;
      this.read = (this.read + drop) % this.size;
      this.fill -= drop;
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const v = this.vol;
    for (let i = 0; i < L.length; i++) {
      if (this.fill > 0) {
        this.lastL = this.l[this.read];
        this.lastR = this.r[this.read];
        this.read = (this.read + 1) % this.size;
        this.fill--;
      } else {
        // leise ausklingen statt hartem Knacken
        this.lastL *= 0.95;
        this.lastR *= 0.95;
      }
      L[i] = this.lastL * v;
      R[i] = this.lastR * v;
    }
    if (++this.reportAt >= 50) {
      this.reportAt = 0;
      this.port.postMessage({ fill: this.fill });
    }
    return true;
  }
}
registerProcessor('pt-audio', PtAudio);
