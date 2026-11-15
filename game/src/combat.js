// combat.js — weapons, hitscan gunplay, grenades, reload.
// The weapon table is the game's balance sheet: damage, headshot bonus,
// fire rate, spread and recoil per weapon. Shooting is hitscan against
// body spheres, checked against wall AABBs first so cover actually works.
// Visuals and sound go out through hooks that boot.js wires up; this
// module never touches the renderer.

import { S, applyDamage, eyeHeight } from './sim.js';
import { MAP } from './mapdata.js';
import { clamp, rayAABB, raySphere, segmentBlocked } from './util.js';

export const WEAPONS = {
  p9: { name: 'P9 Sidearm', dmg: 26, head: 2.5, rof: 300, mag: 12, reserve: 48,
    spread: 0.011, moveSpread: 0.018, bloom: 0.006, recoil: 0.010, kick: 0.010,
    reloadT: 1.4, price: 0, auto: false, falloff: 45 },
  ar51: { name: 'AR-51 Rifle', dmg: 34, head: 3, rof: 105, mag: 30, reserve: 90,
    spread: 0.008, moveSpread: 0.016, bloom: 0.004, recoil: 0.014, kick: 0.013,
    reloadT: 2.1, price: 2700, auto: true, falloff: 60 },
  hornet: { name: 'Hornet-9 SMG', dmg: 25, head: 3, rof: 72, mag: 32, reserve: 96,
    spread: 0.014, moveSpread: 0.024, bloom: 0.005, recoil: 0.010, kick: 0.009,
    reloadT: 1.9, price: 1500, auto: true, falloff: 38 },
  longbow: { name: 'Longbow DMR', dmg: 88, head: 3, rof: 950, mag: 5, reserve: 20,
    spread: 0.001, moveSpread: 0.010, bloom: 0.002, recoil: 0.05, kick: 0.05,
    reloadT: 2.6, price: 4200, auto: false, falloff: 90, zoom: 2.2 },
  breacher: { name: 'Breacher Shotgun', dmg: 12, head: 2, rof: 780, mag: 6, reserve: 24,
    spread: 0.05, moveSpread: 0.03, bloom: 0.008, recoil: 0.03, kick: 0.03,
    reloadT: 2.4, price: 1800, auto: false, pellets: 8, falloff: 22 },
};

export const GRENADE_PRICE = { frag: 300, smoke: 300, flash: 200 };

// Visual/sound hooks, wired by boot.js. No-ops until then.
export const hooks = {
  tracer() {}, spark() {}, shotSound() {}, hitmark() {},
  flash() {}, explode() {}, reloadSound() {},
};
export function setCombatHooks(h) { Object.assign(hooks, h); }

export function eyePos(a) {
  return { x: a.x, y: a.y + eyeHeight(a), z: a.z };
}

// Aim direction from yaw/pitch. Yaw 0 faces +X, pitch positive looks up.
export function aimDir(a) {
  const cp = Math.cos(a.pitch);
  return {
    x: Math.cos(a.yaw) * cp,
    y: Math.sin(a.pitch),
    z: Math.sin(a.yaw) * cp,
  };
}

// Per-weapon ammo bag: switching weapons keeps each weapon's own mag and
// reserve, so a buy is never wasted by swapping.
export function initLoadout(a) {
  a.ammoBag = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
  a.weapon = 'p9';
  a.mag = WEAPONS.p9.mag; a.reserve = WEAPONS.p9.reserve;
}
export function equipWeapon(a, key) {
  if (!WEAPONS[key] || a.weapon === key) return false;
  if (a.ammoBag) a.ammoBag[a.weapon] = { mag: a.mag, reserve: a.reserve };
  else a.ammoBag = {};
  if (!a.ammoBag[key]) {
    a.ammoBag[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
  }
  a.weapon = key;
  a.mag = a.ammoBag[key].mag; a.reserve = a.ammoBag[key].reserve;
  return true;
}
export function refillWeapon(a, key) {
  if (!a.ammoBag) a.ammoBag = {};
  a.ammoBag[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
  if (a.weapon === key) { a.mag = WEAPONS[key].mag; a.reserve = WEAPONS[key].reserve; }
}

export function startReload(a) {
  const w = WEAPONS[a.weapon];
  if (a.reloading > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
  a.reloading = w.reloadT;
  hooks.reloadSound(a);
  return true;
}

// One hitscan pellet/shot. `dir` is the (already spread) unit direction.
// Returns { hit, killed, point, dist }.
function traceShot(shooter, dir) {
  const o = eyePos(shooter);
  let wallDist = Infinity;
  for (const s of MAP.solids) {
    const t = rayAABB(o.x, o.y, o.z, dir.x, dir.y, dir.z,
      { x0: s.x0, y0: 0, z0: s.z0, x1: s.x1, y1: s.h, z1: s.z1 });
    if (t < wallDist) wallDist = t;
  }
  let best = null;
  for (const a of S.actors) {
    if (!a.alive || a.team === shooter.team || a === shooter) continue;
    const headY = a.y + eyeHeight(a) - 0.05;
    const torsoY = a.y + eyeHeight(a) - 0.55;
    const th = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, a.x, headY, a.z, 0.22);
    const tt = raySphere(o.x, o.y, o.z, dir.x, dir.y, dir.z, a.x, torsoY, a.z, 0.42);
    if (th < wallDist && (!best || th < best.dist)) best = { a, dist: th, head: true };
    if (tt < wallDist && (!best || tt < best.dist)) best = { a, dist: tt, head: false };
  }
  const dist = best ? best.dist : Math.min(wallDist, 90);
  const point = { x: o.x + dir.x * dist, y: o.y + dir.y * dist, z: o.z + dir.z * dist };
  return { best, point, dist, wallDist };
}

function spreadDir(a, baseSpread) {
  // Total spread grows when moving, airborne, or firing in a burst
  // (bloom), and shrinks a lot while aiming down sights: stopping to
  // aim genuinely pays.
  const speed = Math.hypot(a.vx, a.vz);
  let sp = baseSpread * (1 + (speed / 5.2) * 2.2) + a.spread;
  if (!a.onGround) sp += 0.02;
  if (a.ads) sp *= 0.45;
  const ang = Math.random() * Math.PI * 2;
  const r = sp * Math.sqrt(Math.random());
  const d = aimDir(a);
  // Offset the direction in the plane perpendicular to the aim.
  const rx = -Math.sin(a.yaw), rz = Math.cos(a.yaw);
  return {
    x: d.x + rx * Math.cos(ang) * r,
    y: d.y + Math.sin(ang) * r,
    z: d.z + rz * Math.cos(ang) * r,
  };
}

// Fire the shooter's current weapon once (auto weapons call this every
// rof ms while the trigger is held). Returns true when a shot went out.
export function shoot(shooter) {
  if (!shooter.alive || S.phase !== 'live' || shooter.reloading > 0) return false;
  const w = WEAPONS[shooter.weapon];
  if (S.time - shooter.lastShot < w.rof / 1000) return false;
  if (shooter.mag <= 0) { startReload(shooter); return false; }
  shooter.lastShot = S.time;
  shooter.mag--;
  shooter.spread = Math.min(0.05, shooter.spread + w.bloom);
  shooter.recoil = Math.min(0.06, shooter.recoil + w.recoil);
  if (shooter.isPlayer) shooter.pitch = clamp(shooter.pitch + w.kick, -1.45, 1.45);
  const pellets = w.pellets || 1;
  let anyHit = false, anyKill = false;
  for (let p = 0; p < pellets; p++) {
    const dir = spreadDir(shooter, w.spread);
    const { best, point, dist } = traceShot(shooter, dir);
    hooks.tracer(eyePos(shooter), point, shooter.isPlayer);
    if (best) {
      const fall = 1 - 0.35 * Math.min(1, dist / w.falloff);
      const dmg = w.dmg * fall * (best.head ? w.head : 1);
      const res = applyDamage(best.a, dmg, shooter, best.head, w.name);
      anyHit = true;
      if (res.killed) anyKill = true;
      hooks.spark(point);
    } else if (dist < 90) {
      hooks.spark(point);
    }
  }
  hooks.shotSound(shooter, w);
  if (shooter.isPlayer && anyHit) hooks.hitmark(anyKill);
  // Gunfire is loud: bots within 28 m turn toward the shooter.
  for (const a of S.actors) {
    if (a.alive && !a.isPlayer && a !== shooter) {
      const d2 = (a.x - shooter.x) ** 2 + (a.z - shooter.z) ** 2;
      if (d2 < 28 * 28) { a.hearX = shooter.x; a.hearZ = shooter.z; a.hearT = S.time; }
    }
  }
  if (shooter.mag === 0) startReload(shooter);
  return true;
}

// --- grenades ---
const projectiles = [];

export function throwGrenade(a, type) {
  if (!a.alive || S.phase !== 'live' || (a.grenades[type] || 0) <= 0) return false;
  a.grenades[type]--;
  const d = aimDir(a);
  const o = eyePos(a);
  projectiles.push({
    x: o.x + d.x * 0.6, y: o.y + d.y * 0.6 - 0.1, z: o.z + d.z * 0.6,
    vx: d.x * 15, vy: d.y * 15 + 2.5, vz: d.z * 15,
    type, owner: a, ttl: 2.4, bounces: 0,
  });
  return true;
}

function explodeFrag(p) {
  hooks.explode(p);
  for (const a of S.actors) {
    if (!a.alive || a === p.owner) continue;
    const dx = a.x - p.x, dz = a.z - p.z, dy = (a.y + 1) - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 7.5) continue;
    if (segmentBlocked(p.x, p.y, p.z, a.x, a.y + 1, a.z, MAP.solids, null)) continue;
    const dmg = Math.max(15, 130 * (1 - dist / 7.5));
    applyDamage(a, dmg, p.owner, false, 'Frag');
  }
}

export function stepProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.ttl -= dt;
    p.vy -= 14 * dt;
    // Axis-separated bounce against solids and the ground.
    let nx = p.x + p.vx * dt;
    let inside = false;
    for (const s of MAP.solids) {
      if (nx > s.x0 - 0.12 && nx < s.x1 + 0.12 && p.y > 0 && p.y < s.h
        && p.z > s.z0 - 0.12 && p.z < s.z1 + 0.12) { inside = true; break; }
    }
    if (inside || nx < MAP.bounds.x0 || nx > MAP.bounds.x1) { p.vx *= -0.4; p.bounces++; }
    else p.x = nx;
    let nz = p.z + p.vz * dt;
    inside = false;
    for (const s of MAP.solids) {
      if (p.x > s.x0 - 0.12 && p.x < s.x1 + 0.12 && p.y > 0 && p.y < s.h
        && nz > s.z0 - 0.12 && nz < s.z1 + 0.12) { inside = true; break; }
    }
    if (inside || nz < MAP.bounds.z0 || nz > MAP.bounds.z1) { p.vz *= -0.4; p.bounces++; }
    else p.z = nz;
    p.y += p.vy * dt;
    if (p.y < 0.12) { p.y = 0.12; p.vy = Math.abs(p.vy) > 1.2 ? -p.vy * 0.4 : 0; p.bounces++; }
    for (const s of MAP.solids) {
      if (p.y > s.h - 0.12 && p.y < s.h + 0.12 && p.x > s.x0 && p.x < s.x1 && p.z > s.z0 && p.z < s.z1) {
        p.y = s.h + 0.12; p.vy = Math.abs(p.vy) > 1.2 ? -p.vy * 0.4 : 0; p.bounces++;
      }
    }
    if (p.ttl <= 0 || p.bounces >= 3) {
      projectiles.splice(i, 1);
      if (p.type === 'frag') explodeFrag(p);
      else if (p.type === 'smoke') S.smokes.push({ x: p.x, y: 1.4, z: p.z, r: 4.5, ttl: 15 });
      else if (p.type === 'flash') {
        // Blinded bots pause; the player's screen flash is a hook.
        for (const a of S.actors) {
          if (!a.alive) continue;
          const dx = a.x - p.x, dz = a.z - p.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > 26) continue;
          if (segmentBlocked(p.x, p.y, p.z, a.x, a.y + 1.4, a.z, MAP.solids, null)) continue;
          if (a.isPlayer) {
            const d = aimDir(a);
            const dot = (d.x * dx + d.z * dz) / Math.max(0.01, dist);
            if (dot > 0.2) hooks.flash((1 - dist / 26) * dot);
          } else {
            a.blindT = 1 + 2 * (1 - dist / 26);
          }
        }
      }
    }
  }
}

// A bot fires at a known target with skill-based aim error. Returns true
// when a shot went out.
export function botShoot(bot, target) {
  if (S.time - bot.lastShot < WEAPONS[bot.weapon].rof / 1000) return false;
  const dx = target.x - bot.x, dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz);
  const baseYaw = Math.atan2(dz, dx);
  const basePitch = Math.atan2((target.y + 1.1) - (bot.y + 1.5), dist);
  // Error grows with distance and target speed, shrinks with skill.
  const err = (0.02 + dist * 0.0016 + Math.hypot(target.vx, target.vz) * 0.012) / bot.skill;
  bot.yaw = baseYaw + (Math.random() - 0.5) * err * 2;
  bot.pitch = basePitch + (Math.random() - 0.5) * err * 2;
  return shoot(bot);
}
