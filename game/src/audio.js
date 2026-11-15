// audio.js — every sound is synthesized with WebAudio: no audio files,
// no network, nothing to download. A single shared context is created on
// the first user gesture; every call before that is a silent no-op.

let ctx = null;
let master = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}

function tone(freq, dur, type, vol, slideTo) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol, freq) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = freq || 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

export const sfx = {
  shot(key) {
    if (key === 'longbow') { noise(0.22, 0.5, 900); tone(140, 0.16, 'sawtooth', 0.25, 55); }
    else if (key === 'breacher') { noise(0.28, 0.6, 700); tone(110, 0.2, 'sawtooth', 0.3, 45); }
    else if (key === 'p9') { noise(0.09, 0.35, 2400); tone(220, 0.07, 'square', 0.16, 90); }
    else { noise(0.11, 0.4, 1600); tone(180, 0.08, 'square', 0.2, 70); }
  },
  distantShot() { noise(0.1, 0.1, 900); },
  hit() { tone(1200, 0.05, 'sine', 0.25); },
  kill() { tone(660, 0.09, 'sine', 0.3); setTimeout(() => tone(990, 0.12, 'sine', 0.3), 80); },
  reload() { tone(500, 0.05, 'square', 0.14); setTimeout(() => tone(700, 0.05, 'square', 0.14), 180); },
  dryFire() { tone(900, 0.04, 'square', 0.12); },
  plantBeep() { tone(880, 0.12, 'sine', 0.3); },
  explode() { noise(0.7, 0.8, 320); tone(70, 0.6, 'sine', 0.5, 30); },
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'sine', 0.28), i * 130)); },
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sine', 0.26), i * 150)); },
  buy() { tone(980, 0.07, 'sine', 0.22); setTimeout(() => tone(1318, 0.09, 'sine', 0.22), 70); },
  step() { noise(0.04, 0.05, 500); },
};
