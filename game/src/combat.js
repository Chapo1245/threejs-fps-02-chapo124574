// combat.js — shooting resolution, grenades, and the spike (bomb). The sim calls
// fireShot() for the player and for bots; everything a bullet does lives here:
// spread ray, wall block, head/body hits, tracers, damage, kill credit.
import { BOMB_TIME, PLANT_TIME, DEFUSE_TIME, clamp, dist2 } from './state.js';
import { GRENADES, shotSpread, shotDamage, shotInterval, applyRecoil } from './weapons.js';
import { rayHitActor, damageActor, eyeHeight } from './actors.js';
import { losBlocked } from './world.js';

// Fire one trigger pull from `shooter` toward (dirX, dirY, dirZ). Consumes ammo,
// spawns a tracer event, and resolves every pellet. Returns 'hit' | 'kill' | 'miss'.
export function fireShot(state, world, shooter, dirX, dirY, dirZ, ads) {
  const gun = shooter.weapons[shooter.slot];
  if (!gun || gun.reloading > 0 || gun.mag <= 0) return 'dry';
  const now = state.time;
  if (now - gun.lastShot < shotInterval(gun) - 1e-6) return 'wait';
  gun.lastShot = now;
  gun.mag -= 1;
  const def = gun.def;
  const ox = shooter.pos.x, oy = eyeHeight(shooter), oz = shooter.pos.z;
  const pellets = def.pellets || 1;
  let outcome = 'miss';
  // Spread is applied per pellet around the aim ray; u and v are the two
  // perpendicular axes (u = aim x up, v = u x aim), so offsets stay on-sphere.
  const len = Math.hypot(dirX, dirY, dirZ) || 1;
  const bx = dirX / len, by = dirY / len, bz = dirZ / len;
  for (let p = 0; p < pellets; p++) {
    const spread = shotSpread(gun, shooter, ads);
    const rx = (Math.random() - 0.5) * 2 * spread, ry = (Math.random() - 0.5) * 2 * spread;
    const ux = -bz, uy = 0, uz = bx, ul = Math.hypot(ux, uz) || 1;
    const vx = uy * bz - uz * by, vy = uz * bx - ux * bz, vz = ux * by - uy * bx;
    let dx = bx + (ux / ul) * rx + vx * ry, dy = by + vy * ry, dz = bz + (uz / ul) * rx + vz * ry;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const hit = resolveRay(state, world, shooter, ox, oy, oz, dx, dy, dz, def.range);
    if (hit === 'kill') outcome = 'kill';
    else if (hit === 'hit' && outcome !== 'kill') outcome = 'hit';
  }
  // Recoil kicks the shooter's view; bloom widens the next shots.
  const kick = applyRecoil(gun);
  shooter.pitch = clamp(shooter.pitch + kick, -1.45, 1.45);
  state.shots.push({ x: ox, z: oz, loud: def.damage >= 30 });
  state.events.push({ type: 'shot', x: ox, y: oy, z: oz, dx: bx, dy: by, dz: bz, gun: gun.id, shooter });
  return outcome;
}

// One ray against walls (range-capped by first wall hit) and actors.
function resolveRay(state, world, shooter, ox, oy, oz, dx, dy, dz, maxRange) {
  // Wall range: walk the ray in 0.5 m steps against colliders (cheap, exact
  // enough for a 60 m map; keeps the hot path free of a BVH).
  let wallDist = maxRange;
  for (let d = 0.5; d < maxRange; d += 0.5) {
    const px = ox + dx * d, pz = oz + dz * d;
    const py = oy + dy * d;
    if (py < 0 || py > 12) { wallDist = d; break; }
    if (pointInWall(world.colliders, px, pz, py)) { wallDist = d; break; }
  }
  let best = null, bestDist = wallDist;
  for (const target of state.actors) {
    if (target === shooter || !target.alive) continue;
    if (target.team === shooter.team) continue;
    const r = rayHitActor(ox, oy, oz, dx, dy, dz, target, wallDist);
    if (r.hit && r.dist < bestDist) { best = { target, head: r.head, dist: r.dist }; bestDist = r.dist; }
  }
  state.events.push({ type: 'tracer', x: ox, y: oy, z: oz, ex: ox + dx * bestDist, ey: oy + dy * bestDist, ez: oz + dz * bestDist });
  if (!best) {
    state.events.push({ type: 'impact', x: ox + dx * bestDist, y: oy + dy * bestDist, z: oz + dz * bestDist });
    return 'miss';
  }
  const dmg = shotDamage(shooter.weapons[shooter.slot], best.dist, best.head, best.target);
  const killed = damageActor(best.target, dmg, shooter);
  state.events.push({ type: 'hit', shooter, target: best.target, head: best.head, killed, dmg });
  if (killed) {
    shooter.kills += 1;
    state.events.push({ type: 'kill', killer: shooter, victim: best.target, head: best.head });
  }
  return killed ? 'kill' : 'hit';
}
function pointInWall(colliders, x, z, y) {
  for (const c of colliders) if (y < c.h && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return true;
  return false;
}

export function startReload(shooter) {
  const gun = shooter.weapons[shooter.slot];
  if (!gun || gun.reloading > 0 || gun.mag >= gun.def.mag || gun.reserve <= 0) return false;
  gun.reloading = gun.def.reload;
  return true;
}
export function tickReload(shooter, dt) {
  const gun = shooter.weapons[shooter.slot];
  if (!gun || gun.reloading <= 0) return;
  gun.reloading -= dt;
  if (gun.reloading <= 0) {
    const need = gun.def.mag - gun.mag;
    const take = Math.min(need, gun.reserve);
    gun.mag += take; gun.reserve -= take;
  }
}

// --- Grenades ---------------------------------------------------------------
export function throwGrenade(state, thrower, kind) {
  if ((thrower.grenades[kind] || 0) <= 0) return false;
  thrower.grenades[kind] -= 1;
  const yaw = thrower.yaw, pitch = thrower.pitch;
  const def = GRENADES[kind];
  const speed = 13;
  state.grenades = state.grenades || [];
  state.grenades.push({
    kind, x: thrower.pos.x, y: eyeHeight(thrower) - 0.2, z: thrower.pos.z,
    vx: -Math.sin(yaw) * Math.cos(pitch) * speed, vy: -Math.sin(pitch) * speed + 3.5,
    vz: -Math.cos(yaw) * Math.cos(pitch) * speed, t: 0, fuse: def.fuse || 1.4, thrower,
  });
  state.events.push({ type: 'throw', actor: thrower, kind });
  return true;
}

export function tickGrenades(state, world, dt) {
  if (!state.grenades) return;
  for (const g of state.grenades) {
    if (g.done) continue;
    g.t += dt;
    g.vy -= 12 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y <= 0.12) { g.y = 0.12; g.vy = -g.vy * 0.35; g.vx *= 0.7; g.vz *= 0.7; }
    // Bounce off walls (cheap: clamp + damp).
    for (const c of world.colliders) {
      if (g.y < c.h && g.x > c.minX - 0.15 && g.x < c.maxX + 0.15 && g.z > c.minZ - 0.15 && g.z < c.maxZ + 0.15) {
        if (Math.abs(g.x - c.minX) < 0.3 || Math.abs(g.x - c.maxX) < 0.3) g.vx = -g.vx * 0.5;
        if (Math.abs(g.z - c.minZ) < 0.3 || Math.abs(g.z - c.maxZ) < 0.3) g.vz = -g.vz * 0.5;
      }
    }
    if (g.t >= g.fuse) { g.done = true; detonate(state, world, g); }
  }
  state.grenades = state.grenades.filter(g => !g.done || (g.kind === 'smoke' && g.t < g.fuse + GRENADES.smoke.duration));
}

function detonate(state, world, g) {
  if (g.kind === 'frag') {
    state.events.push({ type: 'explosion', x: g.x, y: g.y, z: g.z });
    for (const a of state.actors) {
      if (!a.alive) continue;
      const d2 = dist2(a.pos.x, a.pos.z, g.x, g.z) + (a.pos.y - g.y) * (a.pos.y - g.y);
      const d = Math.sqrt(d2);
      if (d < GRENADES.frag.radius) {
        const blocked = losBlocked(world.colliders, a.pos.x, a.pos.z, g.x, g.z);
        if (blocked) continue;
        const dmg = GRENADES.frag.damage * (1 - d / GRENADES.frag.radius) * (a === g.thrower ? 0.5 : 1);
        const killed = damageActor(a, dmg, g.thrower);
        if (killed) { g.thrower.kills += 1; state.events.push({ type: 'kill', killer: g.thrower, victim: a, head: false }); }
        state.events.push({ type: 'hit', shooter: g.thrower, target: a, head: false, killed, dmg });
      }
    }
  } else if (g.kind === 'smoke') {
    state.events.push({ type: 'smoke', x: g.x, y: g.y, z: g.z });
    state.smokes = state.smokes || [];
    state.smokes.push({ x: g.x, z: g.z, t: 0 });
  } else if (g.kind === 'flash') {
    state.events.push({ type: 'flash', x: g.x, y: g.y, z: g.z });
    for (const a of state.actors) {
      if (!a.alive) continue;
      const d = Math.sqrt(dist2(a.pos.x, a.pos.z, g.x, g.z));
      if (d > GRENADES.flash.radius) continue;
      if (losBlocked(world.colliders, a.pos.x, a.pos.z, g.x, g.z)) continue;
      // Facing the flash matters: looking away halves the blind.
      const dx = g.x - a.pos.x, dz = g.z - a.pos.z;
      const facing = (-Math.sin(a.yaw) * dx + -Math.cos(a.yaw) * dz) / (d || 1);
      a.flash = Math.max(a.flash, GRENADES.flash.duration * (facing > 0.2 ? 1 : 0.45) * (1 - d / (GRENADES.flash.radius * 1.6)));
    }
  }
}

// --- Spike (bomb) -----------------------------------------------------------
// Plant: carrier holds E inside a site for PLANT_TIME. Defuse: defender holds E
// next to the planted spike for DEFUSE_TIME (2.5 s with a kit).
export function tickBomb(state, dt) {
  const bomb = state.bomb;
  if (bomb.state === 'planted') {
    bomb.timer -= dt;
    if (bomb.timer <= 0) { bomb.state = 'detonated'; state.events.push({ type: 'explosion', x: bomb.x, y: bomb.y, z: bomb.z, big: true }); }
  }
  if (bomb.state === 'carried') {
    const carrier = state.actors.find(a => a.hasSpike && a.alive);
    if (carrier) { bomb.x = carrier.pos.x; bomb.z = carrier.pos.z; }
  }
  // Progress bars tick down when the holder walks away or dies.
  for (const a of state.actors) {
    if (a.planting > 0 && (!a.alive || !inSite(state, a))) a.planting = 0;
    if (a.defusing > 0 && (!a.alive || bomb.state !== 'planted' || dist2(a.pos.x, a.pos.z, bomb.x, bomb.z) > 2.2 * 2.2)) a.defusing = 0;
  }
}
export function inSite(state, actor) {
  for (const site of Object.values(state.map.sites)) {
    if (dist2(actor.pos.x, actor.pos.z, site.x, site.z) <= site.r * site.r) return true;
  }
  return false;
}
export function siteOf(state, actor) {
  for (const [key, site] of Object.entries(state.map.sites)) {
    if (dist2(actor.pos.x, actor.pos.z, site.x, site.z) <= site.r * site.r) return key;
  }
  return null;
}
export function tryPlant(state, actor, dt) {
  const bomb = state.bomb;
  if (bomb.state !== 'carried' || !actor.hasSpike || actor.team !== 'A') return false;
  const site = siteOf(state, actor);
  if (!site) return false;
  actor.planting += dt;
  if (actor.planting >= PLANT_TIME) {
    bomb.state = 'planted'; bomb.site = site; bomb.timer = BOMB_TIME;
    bomb.x = actor.pos.x; bomb.z = actor.pos.z; bomb.planter = actor;
    actor.hasSpike = false; actor.planting = 0;
    state.events.push({ type: 'planted', site, actor });
    return 'planted';
  }
  return 'planting';
}
export function tryDefuse(state, actor, dt) {
  const bomb = state.bomb;
  if (bomb.state !== 'planted' || actor.team !== 'B') return false;
  if (dist2(actor.pos.x, actor.pos.z, bomb.x, bomb.z) > 2.2 * 2.2) return false;
  const need = actor.hasKit ? DEFUSE_TIME / 2 : DEFUSE_TIME;
  actor.defusing += dt;
  if (actor.defusing >= need) {
    bomb.state = 'defused'; actor.defusing = 0;
    state.events.push({ type: 'defused', actor });
    return 'defused';
  }
  return 'defusing';
}
