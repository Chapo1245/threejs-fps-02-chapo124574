// sim.js — the single state store and the fixed-step simulation.
// Owns: match/round state, actor movement + collision, damage, economy,
// bomb plant/defuse, killfeed. Rendering never writes here; input and bot
// AI only set intents (moveX/moveZ/yaw/planting/defusing) that step() reads.
// Imports util + mapdata only (weapons come from combat.js at call time).

import { MAP } from './mapdata.js';
import { clamp, dist2, moveCircle, mulberry32 } from './util.js';
import { WEAPONS } from './combat.js';

export const STEP = 1 / 60;
const EYE_STAND = 1.55, EYE_CROUCH = 1.1;
const RADIUS = 0.45;

export const S = {
  phase: 'menu',       // menu | buy | live | end | matchend
  phaseT: 0,
  round: 0,
  scoreA: 0,           // AZURE (attackers)
  scoreB: 0,           // RUST (defenders)
  roundTime: 100,
  targetSite: 'A',
  money: 800,
  lossStreak: 0,
  bomb: { state: 'none', site: null, x: 0, z: 0, timer: 35, carrierId: -1 },
  smokes: [],          // {x, y, z, r, ttl}
  kills: [],           // killfeed, newest last
  banner: { big: '', sub: '', cls: '' },
  winner: null,
  rng: mulberry32(20261115),
  actors: [],
  time: 0,
};

const AZURE_BOTS = ['VOLT', 'JUNO', 'MIRA', 'ORIN'];
const RUST_BOTS = ['BRICK', 'ASH', 'SLATE', 'FERN', 'COAL'];

export function eyeHeight(a) { return a.crouch ? EYE_CROUCH : EYE_STAND; }

function makeActor(id, name, team, isPlayer, x, z, yaw) {
  return {
    id, name, team, isPlayer,
    x, y: 0, z, yaw, pitch: 0,
    hp: 100, alive: true,
    weapon: 'p9', mag: 12, reserve: 48, kevlar: false, hasBomb: false,
    vx: 0, vz: 0, vy: 0, onGround: true, crouch: false,
    moveX: 0, moveZ: 0, sprint: false, ads: false,
    spread: 0, recoil: 0, lastShot: -9, reloading: 0,
    grenades: { frag: 1, smoke: 0, flash: 0 }, grenadeSel: 'frag',
    planting: false, plantT: 0, defusing: false, defuseT: 0,
    jumpQueued: false,
    // bot fields (unused for the player)
    skill: 0.8 + S.rng() * 0.35, botState: 'idle', route: [], routeIdx: 0,
    hold: null, target: null, lastSeen: -9, hearX: 0, hearZ: 0, hearT: -9,
    thinkT: 0, burstLeft: 0, fireT: 0, stuckT: 0, sideT: 0, sideDir: 1,
    aimYaw: 0, aimPitch: 0, investigateT: 0, lastPosX: 0, lastPosZ: 0,
    body: null,
  };
}

export function newMatch(seed) {
  S.rng = mulberry32(seed >>> 0 || 20261115);
  S.scoreA = 0; S.scoreB = 0; S.round = 0;
  S.money = 800; S.lossStreak = 0; S.winner = null;
  S.kills = []; S.smokes = [];
  S.bomb = { state: 'none', site: null, x: 0, z: 0, timer: 35, carrierId: -1 };
  S.actors = [];
  const az = MAP.spawns.azure, ru = MAP.spawns.rust;
  const azOff = [[0, 0], [-2, 2.4], [-2, -2.4], [1.5, 2.4], [1.5, -2.4]];
  const ruOff = [[0, 0], [-2, 2.4], [-2, -2.4], [1.5, 2.4], [1.5, -2.4]];
  S.actors.push(makeActor(0, 'YOU', 'azure', true, az.x, az.z, az.yaw));
  AZURE_BOTS.forEach((n, i) =>
    S.actors.push(makeActor(1 + i, n, 'azure', false, az.x + azOff[i + 1][0], az.z + azOff[i + 1][1], az.yaw)));
  RUST_BOTS.forEach((n, i) =>
    S.actors.push(makeActor(5 + i, n, 'rust', false, ru.x + ruOff[i][0], ru.z + ruOff[i][1], ru.yaw)));
  startRound();
}

export function player() { return S.actors[0]; }

export function aliveCount(team) {
  let n = 0;
  for (const a of S.actors) if (a.alive && a.team === team) n++;
  return n;
}

function resetActorForRound(a, spawn, off) {
  a.x = spawn.x + off[0]; a.z = spawn.z + off[1]; a.y = 0;
  a.yaw = spawn.yaw; a.pitch = 0;
  a.hp = 100; a.alive = true;
  a.vx = 0; a.vz = 0; a.vy = 0; a.onGround = true; a.crouch = false;
  a.spread = 0; a.recoil = 0; a.reloading = 0;
  a.planting = false; a.plantT = 0; a.defusing = false; a.defuseT = 0;
  a.grenades = { frag: 1, smoke: 0, flash: 0 }; a.grenadeSel = 'frag';
  a.botState = 'idle'; a.route = []; a.routeIdx = 0; a.target = null;
  a.lastSeen = -9; a.hearT = -9; a.investigateT = 0;
  // Surviving actors keep their bought weapon and kevlar; the fallen
  // respawn with the sidearm only — the round-to-round economy loop.
  // Ammo is kept per weapon in ammoBag, so swapping never wastes a buy.
  if (!a.keptWeapon || a.wasDead) {
    a.weapon = 'p9'; a.kevlar = false; a.keptWeapon = null;
    a.ammoBag = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
  }
  if (!a.ammoBag) a.ammoBag = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
  if (!a.ammoBag[a.weapon]) {
    a.ammoBag[a.weapon] = { mag: WEAPONS[a.weapon].mag, reserve: WEAPONS[a.weapon].reserve };
  }
  a.mag = a.ammoBag[a.weapon].mag; a.reserve = a.ammoBag[a.weapon].reserve;
  a.hasBomb = false;
  a.wasDead = false;
}

export function startRound() {
  S.round++;
  S.targetSite = S.rng() < 0.5 ? 'A' : 'B';
  S.phase = 'buy'; S.phaseT = 0; S.roundTime = 100;
  S.smokes = [];
  S.bomb = { state: 'none', site: null, x: 0, z: 0, timer: 35, carrierId: -1 };
  S.banner = { big: '', sub: '', cls: '' };
  const az = MAP.spawns.azure, ru = MAP.spawns.rust;
  const azOff = [[0, 0], [-2, 2.4], [-2, -2.4], [1.5, 2.4], [1.5, -2.4]];
  const ruOff = [[0, 0], [-2, 2.4], [-2, -2.4], [1.5, 2.4], [1.5, -2.4]];
  S.actors.forEach((a, i) => {
    if (a.team === 'azure') resetActorForRound(a, az, azOff[i]);
    else resetActorForRound(a, ru, ruOff[i - 5]);
  });
  // The bomb goes to a random attacker; round 1 it is the player, so the
  // first round always teaches the objective.
  const attackers = S.actors.filter((a) => a.team === 'azure');
  const carrier = S.round === 1 ? attackers[0]
    : attackers[Math.floor(S.rng() * attackers.length)];
  carrier.hasBomb = true;
  S.bomb.state = 'carried'; S.bomb.carrierId = carrier.id;
}

function startLive() {
  S.phase = 'live'; S.phaseT = 0;
}

export function addKill(a, b, weapon) {
  S.kills.push({ a: a.name, b: b.name, ta: a.team, tb: b.team, w: weapon, t: S.time });
  if (S.kills.length > 4) S.kills.shift();
}

export function applyDamage(target, dmg, attacker, isHead, weaponName) {
  if (!target.alive || S.phase !== 'live') return { killed: false };
  let d = dmg;
  if (target.kevlar) d *= 0.6;
  target.hp -= d;
  if (target.hp <= 0) {
    target.hp = 0; target.alive = false; target.wasDead = true;
    target.keptWeapon = null;
    if (attacker) {
      addKill(attacker, target, weaponName || attacker.weapon);
      if (attacker.isPlayer) S.money += 300;
    }
    if (target.hasBomb) {
      target.hasBomb = false;
      S.bomb.state = 'dropped'; S.bomb.x = target.x; S.bomb.z = target.z;
      S.bomb.carrierId = -1;
    }
    checkRoundEnd();
    return { killed: true, isHead };
  }
  return { killed: false, isHead };
}

function checkRoundEnd() {
  if (S.phase !== 'live') return;
  const aAlive = aliveCount('azure'), rAlive = aliveCount('rust');
  if (S.bomb.state === 'planted') {
    // After the plant the round only ends on detonation, defuse, or the
    // defenders all dying — attackers dying does not stop the bomb.
    if (rAlive === 0) endRound('azure', 'Defenders eliminated — bomb detonates');
    return;
  }
  if (aAlive === 0) endRound('rust', 'AZURE eliminated');
  else if (rAlive === 0) endRound('azure', 'RUST eliminated');
}

export function endRound(winner, reason) {
  if (S.phase !== 'live') return;
  S.phase = 'end'; S.phaseT = 0;
  if (winner === 'azure') {
    S.scoreA++;
    S.money += 3250; S.lossStreak = 0;
  } else {
    S.scoreB++;
    S.money += 1900 + Math.min(2, S.lossStreak) * 500;
    S.lossStreak++;
  }
  S.banner = {
    big: winner === 'azure' ? 'ROUND WON' : 'ROUND LOST',
    sub: reason + `  ·  AZURE ${S.scoreA} — ${S.scoreB} RUST`,
    cls: winner === 'azure' ? 'win' : 'lose',
  };
  for (const a of S.actors) {
    if (a.alive) a.keptWeapon = a.weapon;
    a.planting = false; a.defusing = false;
  }
  S.bomb.state = 'none';
}

function matchOver() {
  return S.scoreA >= 8 || S.scoreB >= 8 || S.round >= 15;
}

// --- economy: the buy menu spends the player's round money. ---
export function buyItem(key) {
  const p = player();
  if (S.phase !== 'buy' || !p.alive) return false;
  const w = WEAPONS[key];
  if (!w) return false;
  if (key === 'kevlar') {
    if (p.kevlar || S.money < 650) return false;
    p.kevlar = true; S.money -= 650; return true;
  }
  if (key === 'frag' || key === 'smoke' || key === 'flash') {
    const price = key === 'frag' ? 300 : key === 'smoke' ? 300 : 200;
    if (S.money < price) return false;
    p.grenades[key]++; S.money -= price; return true;
  }
  if (S.money < w.price) return false;
  if (!p.ammoBag) p.ammoBag = {};
  p.ammoBag[key] = { mag: w.mag, reserve: w.reserve };
  p.weapon = key; p.mag = w.mag; p.reserve = w.reserve;
  S.money -= w.price;
  return true;
}

function pointInSite(x, z, site) {
  return x >= site.x0 && x <= site.x1 && z >= site.z0 && z <= site.z1;
}

function stepActor(a, dt) {
  if (!a.alive) return;
  const w = WEAPONS[a.weapon];
  let speed = 5.2;
  if (a.ads) speed = 3.4;
  if (a.crouch) speed = 2.6;
  if (a.sprint && !a.ads && !a.crouch) speed = 5.9;
  if (a.planting || a.defusing) speed = 0;
  // Acceleration toward the intent velocity, friction when idle.
  const tx = a.moveX * speed, tz = a.moveZ * speed;
  const accel = a.onGround ? 42 : 12;
  a.vx += clamp(tx - a.vx, -accel * dt, accel * dt);
  a.vz += clamp(tz - a.vz, -accel * dt, accel * dt);
  if (Math.abs(a.moveX) < 0.05 && Math.abs(a.moveZ) < 0.05 && a.onGround) {
    const f = Math.max(0, 1 - 11 * dt);
    a.vx *= f; a.vz *= f;
  }
  // Jump / gravity.
  if (a.jumpQueued && a.onGround) { a.vy = 7.4; a.onGround = false; }
  a.jumpQueued = false;
  a.vy -= 22 * dt;
  a.y += a.vy * dt;
  if (a.y <= 0) { a.y = 0; a.vy = 0; a.onGround = true; }
  // Move with wall sliding, then clamp inside the map.
  const out = [0, 0];
  const [nx, nz] = moveCircle(a.x, a.z, a.vx * dt, a.vz * dt, RADIUS, MAP.solids, out);
  a.x = clamp(nx, MAP.bounds.x0 + 0.6, MAP.bounds.x1 - 0.6);
  a.z = clamp(nz, MAP.bounds.z0 + 0.6, MAP.bounds.z1 - 0.6);
  if (out[0] === 0) a.vx = 0;
  if (out[1] === 0) a.vz = 0;
  // Spread + recoil decay.
  a.spread = Math.max(0, a.spread - dt * 0.09);
  a.recoil = Math.max(0, a.recoil - dt * 0.05);
  if (a.reloading > 0) {
    a.reloading -= dt;
    if (a.reloading <= 0) {
      const need = w.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
    }
  }
  void w;
}

function stepBomb(dt) {
  const b = S.bomb;
  if (b.state === 'planted') {
    b.timer -= dt;
    if (b.timer <= 0) endRound('azure', 'Bomb detonated — Site ' + b.site + ' is gone');
    return;
  }
  if (b.state === 'dropped') {
    for (const a of S.actors) {
      if (a.alive && a.team === 'azure' && dist2(a.x, a.z, b.x, b.z) < 1.44) {
        a.hasBomb = true; b.state = 'carried'; b.carrierId = a.id;
        break;
      }
    }
  }
  // Planting: the carrier channels inside the target site.
  const carrier = S.actors.find((a) => a.id === b.carrierId);
  if (b.state === 'carried' && carrier && carrier.alive && carrier.planting) {
    const site = MAP.sites[S.targetSite];
    if (pointInSite(carrier.x, carrier.z, site)) {
      carrier.plantT += dt;
      if (carrier.plantT >= 3.5) {
        b.state = 'planted'; b.site = S.targetSite;
        b.x = carrier.x; b.z = carrier.z; b.timer = 35;
        carrier.hasBomb = false; carrier.plantT = 0; carrier.planting = false;
        if (carrier.isPlayer) S.money += 300;
      }
    } else {
      carrier.plantT = 0;
    }
  } else if (carrier) {
    carrier.plantT = 0;
  }
  // Defusing: a defender channels next to the planted bomb.
  if (b.state === 'planted') {
    for (const a of S.actors) {
      if (a.alive && a.team === 'rust' && a.defusing
        && dist2(a.x, a.z, b.x, b.z) < 2.6) {
        a.defuseT += dt;
        if (a.defuseT >= 5) {
          if (a.isPlayer) S.money += 300;
          endRound('rust', 'Bomb defused');
        }
      } else {
        a.defuseT = 0;
      }
    }
  }
}

// One fixed 60 Hz step. Bots decide inside bots.js, which runs before this
// in the boot loop; this function only integrates the world.
export function step(dt) {
  S.time += dt;
  S.phaseT += dt;
  if (S.phase === 'buy' && S.phaseT >= 12) startLive();
  else if (S.phase === 'live') {
    S.roundTime -= dt;
    if (S.roundTime <= 0 && S.bomb.state !== 'planted') {
      S.roundTime = 0;
      endRound('rust', 'Time expired — bomb never planted');
    }
  } else if (S.phase === 'end' && S.phaseT >= 5) {
    if (matchOver()) {
      S.phase = 'matchend';
      S.winner = S.scoreA > S.scoreB ? 'azure' : 'rust';
    } else {
      startRound();
    }
  }
  for (const a of S.actors) stepActor(a, dt);
  if (S.phase === 'live') stepBomb(dt);
  for (const s of S.smokes) s.ttl -= dt;
  S.smokes = S.smokes.filter((s) => s.ttl > 0);
}
