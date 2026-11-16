// audio.js — all sound is synthesized with WebAudio. No audio files,
// no network, no per-frame allocation (one reusable noise buffer).
// A shot is a filtered noise burst + a low thump; everything else is a
// short oscillator/noise envelope. Master gain ducks during explosions.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
    this.lastStep = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { return false; }
  }

  _noise(dur, freq, q, gain, when) {
    // Never build nodes while the context is suspended (no user gesture
    // yet, or headless): scheduled sources never end there, so they pile
    // up in the audio graph forever and the GC pauses grow with play.
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + (when || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.onended = () => { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, type, gain, slideTo, when) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + (when || 0);
    const o = this.ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
    o.start(t); o.stop(t + dur + 0.02);
  }

  shot(kind, dist) {
    if (!this.ensure()) return;
    const att = dist === undefined ? 1 : Math.max(0.12, 1 - dist / 55);
    if (kind === 'rifle') { this._noise(0.09, 900, 0.8, 0.55 * att); this._tone(160, 0.08, 'square', 0.25 * att, 60); }
    else if (kind === 'smg') { this._noise(0.06, 1400, 1, 0.4 * att); this._tone(220, 0.05, 'square', 0.16 * att, 90); }
    else if (kind === 'shotgun') { this._noise(0.16, 500, 0.6, 0.7 * att); this._tone(110, 0.14, 'square', 0.3 * att, 45); }
    else if (kind === 'sniper') { this._noise(0.22, 700, 0.7, 0.8 * att); this._tone(90, 0.2, 'square', 0.35 * att, 40); }
    else { this._noise(0.07, 1100, 1, 0.45 * att); this._tone(190, 0.06, 'square', 0.2 * att, 70); }
  }

  dryFire() { this._tone(1400, 0.03, 'square', 0.08); }
  reload() { this._tone(500, 0.04, 'square', 0.12); this._tone(700, 0.04, 'square', 0.12, null, 0.18); }
  hit() { this._tone(1800, 0.05, 'sine', 0.22, 1400); }
  headshot() { this._tone(2400, 0.07, 'sine', 0.25, 1800); }
  kill() { this._tone(660, 0.09, 'sine', 0.25, 990); this._tone(990, 0.12, 'sine', 0.2, 1320, 0.07); }
  hurt() { this._noise(0.12, 300, 0.7, 0.4); this._tone(90, 0.15, 'sawtooth', 0.2, 50); }
  step() {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this.lastStep < 240) return;
    this.lastStep = now;
    this._noise(0.05, 320, 1, 0.07);
  }
  plantBeep() { this._tone(880, 0.08, 'sine', 0.22); }
  defuseBeep() { this._tone(1170, 0.08, 'sine', 0.22); }
  bombBeep() { this._tone(1500, 0.06, 'square', 0.14); }
  explosion() {
    if (!this.ensure()) return;
    this._noise(0.9, 160, 0.5, 1.0);
    this._tone(55, 0.8, 'sine', 0.7, 28);
    this._noise(0.3, 2400, 0.6, 0.3);
  }
  grenadePin() { this._tone(900, 0.04, 'square', 0.15); }
  throwWhoosh() { this._noise(0.18, 700, 2, 0.15); }
  roundWin() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.22, null, i * 0.12)); }
  roundLose() { [392, 330, 262].forEach((f, i) => this._tone(f, 0.25, 'triangle', 0.2, null, i * 0.13)); }
  buy() { this._tone(980, 0.06, 'sine', 0.18); this._tone(1318, 0.09, 'sine', 0.18, null, 0.06); }
  click() { this._tone(1200, 0.03, 'square', 0.1); }
  denied() { this._tone(220, 0.12, 'square', 0.16, 160); }
  plantStart() { this._tone(440, 0.15, 'sine', 0.2, 880); }
}
