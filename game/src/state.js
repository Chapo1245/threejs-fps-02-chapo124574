// state.js — one central store for the whole game. No imports.
// Every module reads and writes this single object; nothing else holds
// long-lived game state. Helpers here are pure and allocation-free.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

// Deterministic shuffle with an injected rng (no Math.random in sim).
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Fresh state for one match. Call resetMatch() between matches.
export function createState(seed) {
  return {
    seed: seed >>> 0,
    rng: mulberry32(seed >>> 0),
    time: 0,            // sim time, seconds (fixed step)
    tick: 0,
    mode: 'menu',       // menu | buy | play | roundEnd | matchEnd | paused
    variant: 'slagworks',
    difficulty: 'normal',
    round: 1,
    maxRounds: 9,
    winTarget: 5,
    score: { atk: 0, def: 0 },
    phase: 'buy',       // buy | live | planted | over
    phaseT: 0,          // seconds left in current phase
    buyTime: 12,
    roundTime: 100,
    bombTime: 35,
    plantTime: 3,
    defuseTime: 5,
    bomb: { planted: false, site: null, x: 0, z: 0, t: 0, planter: null, defuser: null, defuseT: 0 },
    money: 800,
    lossStreak: 0,
    kills: 0,
    deaths: 0,
    player: null,       // filled by player.js
    bots: [],           // filled by bots.js
    smokes: [],         // {x,y,z,r,t}
    grenades: [],       // live grenade entities
    events: [],         // kill feed entries {text, kind, t}
    lastKillFeed: 0,
    stats: { shots: 0, hits: 0, headshots: 0 },
    roundKills: 0,
    matchWinner: null,
    spectate: 0,
    paused: false,
    // perf / quality, owned by main.js
    quality: 0,         // 0 best .. 3 lowest
    isTouch: false,
    fpsEMA: 60,
    // transient per-frame flags (reset each tick by main.js)
    flash: 0,           // damage vignette 0..1
    hitmark: 0,         // hitmarker timer
    hitmarkKill: false,
    damageDir: -1,      // radians, direction damage came from, -1 none
    banner: null,       // {title, sub, kind, t}
    shake: 0,
  };
}

export function resetMatch(S, seed) {
  const fresh = createState(seed);
  // keep perf fields
  fresh.quality = S.quality; fresh.isTouch = S.isTouch; fresh.fpsEMA = S.fpsEMA;
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, fresh);
}

// Round banner helper — HUD reads S.banner.
export function setBanner(S, title, sub, kind) {
  S.banner = { title, sub: sub || '', kind: kind || 'info', t: 2.6 };
}

// Kill feed helper — newest first, capped by hud.js.
export function pushEvent(S, text, kind) {
  S.events.unshift({ text, kind: kind || 'info', t: S.time });
  if (S.events.length > 6) S.events.length = 6;
}
