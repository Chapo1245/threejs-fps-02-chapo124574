// audio.js — every sound is synthesised with WebAudio: no audio assets, no
// network, nothing to ship. Nodes are created once and reused; the context is
// created on the first user gesture and guarded while suspended.
let ctx = null, master = null, noiseBuf = null;

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
  return ctx;
}

function noise(dur, filterFreq, type, gain, when = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}
function tone(freq, dur, type, gain, slideTo, when = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// One entry point: the sim's events drive every sound, so audio always agrees
// with what the player sees.
export function playEvent(e) {
  if (!ctx || ctx.state !== 'running') return;
  switch (e.type) {
    case 'shot': {
      const heavy = e.gun === 'marksman' || e.gun === 'shotgun';
      noise(heavy ? 0.22 : 0.11, heavy ? 900 : 2400, 'lowpass', heavy ? 0.5 : 0.32);
      tone(heavy ? 110 : 190, 0.08, 'square', 0.10, 55);
      break;
    }
    case 'hit': tone(e.head ? 1400 : 1050, 0.05, 'square', 0.10); break;
    case 'explosion': noise(e.big ? 1.4 : 0.9, 320, 'lowpass', 0.8); tone(70, e.big ? 1.1 : 0.7, 'sine', 0.55, 28); break;
    case 'planted': tone(880, 0.12, 'square', 0.14); tone(880, 0.12, 'square', 0.14, null, 0.16); break;
    case 'defused': tone(660, 0.12, 'sine', 0.16); tone(990, 0.2, 'sine', 0.16, null, 0.14); break;
    case 'roundEnd': {
      const win = e.winner === 'A';
      tone(win ? 523 : 392, 0.16, 'triangle', 0.18);
      tone(win ? 659 : 330, 0.16, 'triangle', 0.18, null, 0.16);
      tone(win ? 784 : 262, 0.3, 'triangle', 0.18, null, 0.32);
      break;
    }
    case 'live': tone(440, 0.09, 'square', 0.10); tone(660, 0.12, 'square', 0.10, null, 0.1); break;
    case 'throw': noise(0.15, 1200, 'bandpass', 0.12); break;
    case 'award': tone(1320, 0.05, 'sine', 0.06); break;
    default: break;
  }
}

export function playReload() { noise(0.07, 3000, 'highpass', 0.10); noise(0.07, 3000, 'highpass', 0.10, 0.18); }
export function playClick() { tone(900, 0.04, 'square', 0.07); }
export function playStep() { noise(0.05, 500, 'lowpass', 0.05); }
