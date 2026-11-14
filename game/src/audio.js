// audio.js — every sound is synthesized with WebAudio: filtered noise
// bursts for shots, short oscillator blips for UI and the bomb. No audio
// files, no network. Created lazily on the first user gesture (browsers
// block audio before interaction) and safe to call before that.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  /** A burst of noise through a low-pass filter: a gunshot. */
  shot(big) {
    if (!this.ensure() || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(big ? 900 : 2400, t);
    filt.frequency.exponentialRampToValueAtTime(220, t + 0.12);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(big ? 0.9 : 0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (big ? 0.28 : 0.12));
    src.connect(filt).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
  }

  /** A short tone: UI clicks, beeps, round jingles. */
  tone(freq, dur, type = 'sine', vol = 0.25, when = 0) {
    if (!this.ensure() || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  click() { this.tone(1400, 0.05, 'square', 0.12); }
  hit() { this.tone(1900, 0.06, 'sine', 0.3); }
  kill() { this.tone(660, 0.09, 'triangle', 0.3); this.tone(990, 0.12, 'triangle', 0.25, 0.07); }
  reload() { this.tone(900, 0.05, 'square', 0.14); this.tone(620, 0.05, 'square', 0.14, 0.16); }
  plantBeep() { this.tone(1150, 0.09, 'square', 0.2); }
  buy() { this.tone(520, 0.07, 'triangle', 0.25); this.tone(780, 0.1, 'triangle', 0.22, 0.06); }
  roundWin() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.25, i * 0.11)); }
  roundLose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.22, i * 0.12)); }

  /** A low boom for the bomb: noise plus a falling sine. */
  explosion() {
    if (!this.ensure() || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.exponentialRampToValueAtTime(60, t + 0.9);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    src.connect(filt).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 1.0);
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.8);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.9);
  }
}
