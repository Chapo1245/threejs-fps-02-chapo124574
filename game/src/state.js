// state.js — the single store. Every module reads and writes this one object;
// nothing else keeps authoritative game state. Fixed-step sim ticks it at 60 Hz.
export const TICK = 1 / 60;
export const ROUND_TARGET = 5;      // first to 5 rounds wins the match
export const ROUND_TIME = 100;      // seconds of live play per round
export const BUY_TIME = 12;         // seconds of freeze / buy phase
export const BOMB_TIME = 35;        // seconds from plant to detonation
export const PLANT_TIME = 3.2;      // seconds holding E to plant
export const DEFUSE_TIME = 5.0;     // seconds holding E to defuse (2.5 with kit)
export const PLAYER_RADIUS = 0.42;
export const PLAYER_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;

// Economy (dollars). All awards are paid by sim.award(), never inline.
export const ECO = {
  start: 800, kill: 300, win: 3250, loss: 1900, lossStreak: 500,
  plant: 300, defuse: 300, assist: 100,
};

export function makeActor(id, name, team, isPlayer, x, z, yaw) {
  return {
    id, name, team, isPlayer,
    pos: { x, z, y: 0 }, vel: { x: 0, z: 0 }, yaw, pitch: 0,
    hp: 100, armor: 0, alive: true, crouch: false, onGround: true,
    weapons: [], slot: 0, grenades: { frag: 0, smoke: 0, flash: 0 },
    selectedGrenade: 'frag', kills: 0, deaths: 0, money: ECO.start,
    hasKit: false, hasSpike: false, planting: 0, defusing: 0,
    flash: 0,            // seconds of flash blindness remaining
    moveMag: 0,          // 0..1 how much the actor is moving (drives spread)
    lastDamageFrom: null, lastDamageAt: 0,
    // bot brain (unused by the human player)
    bot: isPlayer ? null : {
      skill: 0.5, state: 'route', node: 0, path: [], holdUntil: 0,
      target: null, lastSeen: null, lastSeenAt: -99, burstLeft: 0,
      nextShotAt: 0, strafeDir: 1, strafeUntil: 0, threwGrenade: false,
      site: 'A', lane: 0, radioAt: 0, investigate: null, reactAt: 0,
      aimErr: 0.05, holdPos: null, plantSite: null, stuckAt: 0, stuckPos: null,
    },
  };
}

export function createState(mapDef) {
  return {
    map: mapDef,
    phase: 'menu',        // menu | buy | live | roundEnd | matchEnd
    phaseT: 0,            // seconds in the current phase
    round: 1,
    score: { A: 0, B: 0 },
    lossStreak: { A: 0, B: 0 },
    roundTime: ROUND_TIME,
    targetSite: 'A',
    bomb: { state: 'carried', x: 0, z: 0, site: null, timer: 0, planter: null, defuser: null, progress: 0 },
    actors: [],
    events: [],           // transient sim events consumed by hud/audio/render each tick
    feed: [],             // killfeed lines {a, b, aTeam, bTeam, text, t}
    radio: [],            // bot radio callouts {team, text, t}
    shots: [],            // gunfire sound events {x, z, loud} for bot hearing
    time: 0,              // total sim seconds
    tickCount: 0,
    winner: null,         // 'A' | 'B' when the match ends
    roundWinner: null,
    roundReason: '',
    muted: false,
    demo: null,           // ?demo=combat|buy|plant|score — arranges a scene for screenshots
  };
}

// Small helpers shared by every module (no allocations in hot paths beyond these).
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
// Deterministic per-round pseudo-random stream (seeded from round + map) so bot
// behaviour is stable for a given round; rendering never consumes it.
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
