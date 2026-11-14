// state.js — the one state store. Every module reads and writes this
// object and nothing else holds match state, so a round can reset by
// rebuilding the pieces below instead of chasing references.
//
// Teams: 'V' (VANGUARD, the player, attackers, carries the bomb) and
// 'J' (JACKALS, defenders). An actor is the player or one bot:
//   { id, team, isPlayer, alive, hp, armor, x, z, y, vy, yaw, pitch,
//     crouch, onGround, speed2d, weapon, mag, reserve, grenades,
//     money, kills, deaths, planted, blindUntil, ... }
import { ECONOMY, ROUND_TIME, BUY_TIME, TEAM_SIZE } from './config.js';
import { makeRng } from './util.js';

export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  LIVE: 'live',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

/** Build a fresh actor. Bots get their loadout from rounds.js. */
export function makeActor(id, team, isPlayer) {
  return {
    id, team, isPlayer,
    alive: true, hp: 100, armor: 0,
    x: 0, z: 0, y: 0, vy: 0, yaw: 0, pitch: 0,
    crouch: false, onGround: true,
    vx: 0, vz: 0, speed2d: 0,
    weapon: 'p9', mag: 12, reserve: 36,
    grenades: { frag: 0, smoke: 0, flash: 0 },
    money: ECONOMY.startMoney,
    kills: 0, deaths: 0, assists: 0,
    // gunplay state
    recoilPitch: 0, bloom: 0, lastShot: -9, reloadingUntil: 0,
    ads: false, spreadNow: 1,
    // bot brain (unused by the player)
    brain: null,
    // bomb
    hasBomb: false, planting: 0, defusing: 0,
    blindUntil: 0, flashFace: 0,
    // per-frame render scratch, reused, never reallocated
    mesh: null, headMesh: null, muzzleX: 0, muzzleY: 0, muzzleZ: 0,
  };
}

/** The whole match. `events` is a small ring of things the HUD/audio read. */
export function createState(seed) {
  return {
    seed,
    rng: makeRng(seed),
    phase: PHASE.MENU,
    round: 1,
    score: { V: 0, J: 0 },
    lossStreak: { V: 0, J: 0 },
    timer: BUY_TIME,
    buyPhase: true,
    actors: [],
    player: null,
    bomb: {
      state: 'carried', // carried | planted | dropped | exploded | defused
      site: null, x: 0, z: 0, timer: 0, carrierId: null, planterId: null,
    },
    killfeed: [],
    events: [],
    banner: null,
    roundReason: '',
    matchWinner: null,
    time: 0,
    shotNoise: [], // {x, z, at} — gunfire bots can hear
    smokes: [], // {x, z, until, mesh}
    flashes: [], // {x, y, z, at}
    tracers: [], // render pool, filled by combat.js
    damageLog: [],
    aiProfile: 'mixed',
  };
}

/** Push a HUD/audio event (capped so the list never grows unbounded). */
export function pushEvent(S, type, data) {
  S.events.push({ type, data, at: S.time });
  if (S.events.length > 64) S.events.splice(0, S.events.length - 64);
}

/** Push a killfeed line, newest first, capped at 6. */
export function pushKill(S, killer, victim, headshot, weaponName) {
  S.killfeed.unshift({ killer, victim, headshot, weaponName, at: S.time });
  if (S.killfeed.length > 6) S.killfeed.length = 6;
}

/** All living actors of a team. */
export function aliveOf(S, team) {
  let n = 0;
  for (const a of S.actors) if (a.team === team && a.alive) n++;
  return n;
}

/** Award money to every living-or-dead actor of a team (buy phase uses it). */
export function awardTeam(S, team, amount) {
  for (const a of S.actors) if (a.team === team) a.money += amount;
}

/** A fresh match: reset scores, round, money, and rebuild the actors. */
export function resetMatch(S) {
  S.round = 1;
  S.score.V = 0;
  S.score.J = 0;
  S.lossStreak.V = 0;
  S.lossStreak.J = 0;
  S.matchWinner = null;
  S.killfeed.length = 0;
  S.events.length = 0;
  S.bomb.state = 'carried';
  S.bomb.site = null;
  S.actors.length = 0;
  const names = ['you', 'mateo', 'kestrel', 'rook', 'sage'];
  const foes = ['bramble', 'dusk', 'ferro', 'nix', 'vale'];
  S.player = makeActor('you', 'V', true);
  S.actors.push(S.player);
  for (let i = 1; i < TEAM_SIZE; i++) S.actors.push(makeActor(names[i], 'V', false));
  for (let i = 0; i < TEAM_SIZE; i++) S.actors.push(makeActor(foes[i], 'J', false));
  S.bomb.carrierId = 'you';
  S.player.hasBomb = true;
}
