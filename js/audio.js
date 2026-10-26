// Platin Touch – Ton. Der Emulator liefert 16-Bit-Stereo; hier wird es abgespielt.
// iOS erlaubt Ton erst nach einer Berührung: unlock() wird beim ersten Antippen aufgerufen.

export class Audio {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.fallback = null; // ScriptProcessor, falls AudioWorklet fehlt
    this.queue = [];
    this.queued = 0;
    this.vol = 0.8;
    this.ready = false;
    this.sampleRate = 48000;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive', sampleRate: 48000 });
    } catch (e) {
      this.ctx = new AC();
    }
    this.sampleRate = this.ctx.sampleRate;
    try {
      if (!this.ctx.audioWorklet) throw new Error('kein AudioWorklet');
      await this.ctx.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, 'pt-audio', { numberOfInputs: 0, outputChannelCount: [2] });
      this.node.connect(this.ctx.destination);
      this.node.port.postMessage({ vol: this.vol });
    } catch (e) {
      this._initFallback();
    }
    this.ready = true;
  }

  _initFallback() {
    const sp = this.ctx.createScriptProcessor(2048, 0, 2);
    let cur = null, pos = 0;
    sp.onaudioprocess = (ev) => {
      const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1);
      for (let i = 0; i < L.length; i++) {
        if (!cur || pos >= cur.length) {
          cur = this.queue.shift() || null;
          pos = 0;
          if (cur) this.queued -= cur.length >> 1;
        }
        if (cur) {
          L[i] = (cur[pos] / 32768) * this.vol;
          R[i] = (cur[pos + 1] / 32768) * this.vol;
          pos += 2;
        } else {
          L[i] = R[i] = 0;
        }
      }
    };
    sp.connect(this.ctx.destination);
    this.fallback = sp;
  }

  unlock() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  push(pcm) {
    this.pushed = (this.pushed || 0) + 1;
    if (!this.ready) return;
    if (this.node) {
      this.node.port.postMessage({ pcm }, [pcm.buffer]);
    } else if (this.fallback) {
      this.queue.push(pcm);
      this.queued += pcm.length >> 1;
      while (this.queued > 9600 && this.queue.length > 1) this.queued -= this.queue.shift().length >> 1;
    }
  }

  clear() {
    if (this.node) this.node.port.postMessage({ clear: true });
    this.queue = [];
    this.queued = 0;
  }

  setVolume(v) {
    this.vol = Math.max(0, Math.min(1, v));
    if (this.node) this.node.port.postMessage({ vol: this.vol });
  }
}
