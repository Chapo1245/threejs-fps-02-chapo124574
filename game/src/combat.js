// combat.js — resolving shots and grenades: ray vs walls and bodies,
// headshot bonus, armour, tracers, and what happens when someone dies.
// All hit math is 3D rays against spheres (head/body) and the map's boxes.
import { WEAPONS, GRENADES, MOVE, ECONOMY } from './config.js';
import { raySphere } from './util.js';
import { pushEvent, pushKill } from './state.js';

const BODY_R = 0.46;
const HEAD_R = 0.27;
const HEAD_Y = 1.55;
const BODY_Y = 0.95;

/** Eye position of an actor (standing or crouched). */
export function eyePos(a, out) {
  out.x = a.x;
  out.y = a.y + (a.crouch ? MOVE.eyeCrouch : MOVE.eyeStand);
  out.z = a.z;
  return out;
}

/** Muzzle position: a little forward and to the right of the eye. */
export function muzzlePos(a, out) {
  const eye = eyePos(a, out);
  const sin = Math.sin(a.yaw);
  const cos = Math.cos(a.yaw);
  out.x += -sin * 0.55 + cos * 0.22;
  out.y -= 0.12;
  out.z += -cos * 0.55 - sin * 0.22;
  return out;
}

/**
 * Resolve one hitscan pellet. Returns the hit, if any:
 *   { kind: 'wall'|'body'|'head', dist, actor?, x, y, z }
 * Walls block; the nearest body or head sphere along the ray wins.
 */
export function resolveShot(S, world, shooter, dyaw, dpitch, maxDist) {
  const eye = eyePos(shooter, { x: 0, y: 0, z: 0 });
  const yaw = shooter.yaw + dyaw;
  const pitch = shooter.pitch + dpitch + shooter.recoilPitch * 0.5;
  const dx = -Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * Math.cos(pitch);
  const wallDist = world.rayWall(eye.x, eye.y, eye.z, dx, dy, dz, maxDist);
  let best = wallDist;
  let bestHit = null;
  if (best < Infinity) {
    bestHit = {
      kind: 'wall', dist: best,
      x: eye.x + dx * best, y: eye.y + dy * best, z: eye.z + dz * best,
    };
  }
  for (const target of S.actors) {
    if (target === shooter || !target.alive) continue;
    // Friendly fire is off: teammates are never hit.
    if (target.team === shooter.team) continue;
    const ty = target.y;
    const headD = raySphere(eye.x, eye.y, eye.z, dx, dy, dz, target.x, ty + HEAD_Y, target.z, HEAD_R);
    const bodyD = raySphere(eye.x, eye.y, eye.z, dx, dy, dz, target.x, ty + BODY_Y, target.z, BODY_R);
    let d = Infinity;
    let kind = null;
    if (headD < bodyD) { d = headD; kind = 'head'; }
    else if (bodyD < Infinity) { d = bodyD; kind = 'body'; }
    if (d < best) {
      best = d;
      bestHit = {
        kind, dist: d, actor: target,
        x: eye.x + dx * d, y: eye.y + dy * d, z: eye.z + dz * d,
      };
    }
  }
  return bestHit;
}

/** Damage after range falloff; armour soaks half until it breaks. */
export function applyDamage(S, victim, raw, headshot, shooter) {
  let dmg = raw;
  if (victim.armor > 0) {
    const soaked = Math.min(victim.armor, dmg * 0.5);
    victim.armor -= soaked;
    dmg -= soaked;
  }
  victim.hp -= dmg;
  S.damageLog.push({ victim: victim.id, dmg: Math.round(dmg), headshot, at: S.time });
  if (S.damageLog.length > 40) S.damageLog.shift();
  if (victim.hp <= 0) {
    victim.hp = 0;
    killActor(S, victim, shooter, headshot);
    return true;
  }
  return false;
}

/** One actor dies: killfeed, money, bomb drop, brain cleanup. */
export function killActor(S, victim, killer, headshot) {
  if (!victim.alive) return;
  victim.alive = false;
  victim.deaths += 1;
  victim.planting = 0;
  victim.defusing = 0;
  if (killer && killer !== victim) {
    killer.kills += 1;
    killer.money += ECONOMY.killBonus;
  }
  const wname = killer ? WEAPONS[killer.weapon]?.name ?? '' : '';
  pushKill(S, killer ? killer.id : '—', victim.id, headshot, wname);
  pushEvent(S, 'kill', { killer: killer?.id ?? null, victim: victim.id, headshot });
  if (victim.hasBomb) {
    victim.hasBomb = false;
    S.bomb.state = 'dropped';
    S.bomb.x = victim.x;
    S.bomb.z = victim.z;
    S.bomb.carrierId = null;
    pushEvent(S, 'bombDropped', { x: victim.x, z: victim.z });
  }
  if (victim.brain) victim.brain.onDeath?.();
}

/**
 * Fire a full trigger pull for `shooter` (all pellets). Handles tracers,
 * hitmarkers, damage, and the noise bots hear. Returns true if any pellet
 * hit a body.
 */
export function fireShot(S, world, shooter, shot, now) {
  const w = WEAPONS[shooter.weapon];
  const mz = muzzlePos(shooter, { x: 0, y: 0, z: 0 });
  let hitAny = false;
  let headAny = false;
  for (const p of shot.pellets) {
    const hit = resolveShot(S, world, shooter, p.dyaw, p.dpitch, w.range);
    const endX = hit ? hit.x : mz.x + (-Math.sin(shooter.yaw + p.dyaw) * Math.cos(shooter.pitch + p.dpitch)) * w.range;
    const endY = hit ? hit.y : mz.y + Math.sin(shooter.pitch + p.dpitch) * w.range;
    const endZ = hit ? hit.z : mz.z + (-Math.cos(shooter.yaw + p.dyaw) * Math.cos(shooter.pitch + p.dpitch)) * w.range;
    world.spawnTracer(mz.x, mz.y, mz.z, endX, endY, endZ, w.tracer, now);
    if (!hit) continue;
    if (hit.kind === 'wall') continue;
    hitAny = true;
    if (hit.kind === 'head') headAny = true;
    const dist = hit.dist;
    const falloff = dist > w.range * 0.5 ? w.falloff : 1;
    const mult = hit.kind === 'head' ? w.headMult : 1;
    applyDamage(S, hit.actor, w.damage * falloff * mult, hit.kind === 'head', shooter);
  }
  // Gunfire is loud: every bot within earshot learns where it came from.
  S.shotNoise.push({ x: shooter.x, z: shooter.z, at: now, team: shooter.team });
  if (S.shotNoise.length > 24) S.shotNoise.shift();
  pushEvent(S, 'shot', { by: shooter.id, hit: hitAny, head: headAny });
  return { hit: hitAny, head: headAny };
}

/** Grenade flight (gravity + bounce off walls and floor) and detonation. */
export function stepGrenades(S, world, grenades, dt, now) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.vy -= 12 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    // Floor bounce.
    if (g.y < 0.12) {
      g.y = 0.12;
      g.vy = Math.abs(g.vy) * 0.35;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    // Wall bounce: sample the box the grenade is inside and reflect.
    for (const b of world.solids) {
      if (g.x > b.x0 && g.x < b.x1 && g.z > b.z0 && g.z < b.z1 && g.y < b.top) {
        const dxl = g.x - b.x0;
        const dxr = b.x1 - g.x;
        const dzl = g.z - b.z0;
        const dzr = b.z1 - g.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl || m === dxr) g.vx = -g.vx * 0.5;
        else g.vz = -g.vz * 0.5;
        g.x += g.vx * dt * 2;
        g.z += g.vz * dt * 2;
      }
    }
    const fuse = g.kind === 'frag' ? 1.6 : 1.1;
    if (now - g.at < fuse) continue;
    detonateGrenade(S, world, g, now);
    grenades.splice(i, 1);
  }
}

function detonateGrenade(S, world, g, now) {
  const def = GRENADES[g.kind];
  if (g.kind === 'frag') {
    pushEvent(S, 'explosion', { x: g.x, z: g.z });
    for (const a of S.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - g.x, a.z - g.z);
      if (d > def.radius) continue;
      // Walls shield: no damage through a solid.
      if (!world.hasLineOfSight(g.x, 0.6, g.z, a.x, 1.2, a.z, null)) continue;
      const dmg = def.damage * (1 - d / (def.radius * 1.4));
      const killer = S.actors.find((x) => x.id === g.owner);
      applyDamage(S, a, Math.max(12, dmg), false, killer ?? null);
    }
  } else if (g.kind === 'smoke') {
    S.smokes.push({ x: g.x, z: g.z, radius: def.radius, until: now + def.life });
    pushEvent(S, 'smoke', { x: g.x, z: g.z });
  } else if (g.kind === 'flash') {
    S.flashes.push({ x: g.x, y: g.y, z: g.z, at: now });
    pushEvent(S, 'flash', { x: g.x, y: g.y, z: g.z });
    for (const a of S.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - g.x, (a.y + 1.5) - g.y, a.z - g.z);
      if (d > def.radius) continue;
      if (!world.hasLineOfSight(g.x, g.y, g.z, a.x, a.y + 1.5, a.z, null)) continue;
      // Looking at the flash matters: facing away halves the blind.
      const fx = -Math.sin(a.yaw);
      const fz = -Math.cos(a.yaw);
      const tx = (g.x - a.x) / Math.max(1, d);
      const tz = (g.z - a.z) / Math.max(1, d);
      const facing = fx * tx + fz * tz;
      const dur = facing > 0.3 ? def.blind : def.blind * 0.4;
      a.blindUntil = Math.max(a.blindUntil, now + dur);
      if (a.isPlayer) pushEvent(S, 'flashed', { dur });
    }
  }
}
