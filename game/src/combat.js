// combat.js — hitscan resolution, grenades, explosions.
// Hits are checked against bodies with a head bonus: ray vs head sphere
// first, then ray vs body box. Walls stop bullets first (ray vs AABB).
// No allocations in the hot path: one scratch target list, one ray.
// Targets are plain descriptors built by main.js each tick into S.targets.

import * as THREE from 'three';
import { clamp } from './state.js';

const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

// Ray vs AABB (slab method). Returns nearest t >= 0 or Infinity.
export function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let t0 = 0, t1 = Infinity;
  const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2;
  const by0 = 0, by1 = b.h;
  const bz0 = b.z - b.d / 2, bz1 = b.z + b.d / 2;
  const mins = [bx0, by0, bz0], maxs = [bx1, by1, bz1];
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mins[a] || o[a] > maxs[a]) return Infinity;
    } else {
      let ta = (mins[a] - o[a]) / d[a];
      let tb = (maxs[a] - o[a]) / d[a];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

// Ray vs sphere. Returns t >= 0 or Infinity.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

export class Combat {
  // hooks: { onDamage(target, dmg, head, shooter), onKill(target, shooter, weaponId, head) }
  constructor(S, world, render, sfx, hooks) {
    this.S = S;
    this.world = world;
    this.render = render;
    this.sfx = sfx;
    this.hooks = hooks;
  }

  // Fire one pellet. origin/direction as plain {x,y,z}. Returns a hit
  // record or null. Tracer + impact particles + sound are spawned here.
  firePellet(shooter, origin, dir, weapon, spread, rng, isPlayerShot) {
    const S = this.S;
    // Jitter the direction by the spread, inside a cone around the shot.
    const a = rng() * Math.PI * 2;
    const r = spread * Math.sqrt(rng());
    // Orthonormal basis: right = dir x up, up2 = right x dir.
    let rx = -dir.z, rz = dir.x;
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-6) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
    const bx = -rz * dir.y, by = rz * dir.x - rx * dir.z, bz = rx * dir.y;
    const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    const jx = dir.x + rx * ca + bx * sa;
    const jy = dir.y + by * sa;
    const jz = dir.z + rz * ca + bz * sa;
    const len = Math.hypot(jx, jy, jz) || 1;
    const ux = jx / len, uy = jy / len, uz = jz / len;
    // Nearest wall along the ray.
    let wallT = 120;
    for (let i = 0; i < this.world.colliders.length; i++) {
      const t = rayAABB(origin.x, origin.y, origin.z, ux, uy, uz, this.world.colliders[i]);
      if (t < wallT) wallT = t;
    }
    // Nearest target.
    let bestT = wallT, best = null, bestHead = false;
    const targets = S.targets;
    for (let i = 0; i < targets.length; i++) {
      const tg = targets[i];
      if (!tg.alive || tg.ref === shooter) continue;
      if (tg.team === shooter.team) continue;
      // Head sphere.
      const ht = raySphere(origin.x, origin.y, origin.z, ux, uy, uz, tg.x, tg.y + 1.62, tg.z, 0.22);
      if (ht < bestT) { bestT = ht; best = tg; bestHead = true; continue; }
      // Body box.
      const bt = rayAABB(origin.x, origin.y, origin.z, ux, uy, uz,
        { x: tg.x, z: tg.z, w: tg.hw * 2, d: tg.hw * 2, h: 1.52 });
      // Body box sits on the feet: rayAABB assumes base y=0, so shift.
      if (bt < bestT && origin.y + bt * uy > tg.y + 0.3 && origin.y + bt * uy < tg.y + 1.52) {
        bestT = bt; best = tg; bestHead = false;
      }
    }
    // End point of the tracer.
    _to.set(origin.x + ux * bestT, origin.y + uy * bestT, origin.z + uz * bestT);
    if (bestT > 0.5) {
      _from.set(origin.x, origin.y, origin.z);
      this.render.spawnTracer(_from, _to, weapon.tracer);
    }
    if (best) {
      const dist = bestT;
      let dmg = weapon.dmg;
      if (dist > weapon.rangeFalloff) {
        const f = clamp(1 - (dist - weapon.rangeFalloff) / weapon.rangeFalloff, 0, 1);
        dmg = weapon.minDmg + (weapon.dmg - weapon.minDmg) * f;
      }
      if (bestHead) dmg *= weapon.headMult;
      const killed = this.hooks.onDamage(best.ref, Math.round(dmg), bestHead, shooter);
      return { hit: true, head: bestHead, kill: killed, target: best.ref, dist, point: { x: _to.x, y: _to.y, z: _to.z } };
    }
    // Wall / ground impact.
    if (wallT < 120) {
      this.render.spawnParticles(_to.x, _to.y, _to.z, 6, 1.6, 1.6, 0xffc46b);
    }
    return { hit: false, dist: wallT };
  }

  // Full weapon fire: pellets + sound + muzzle flash + recoil handled by caller.
  fire(shooter, origin, dir, weapon, spread, rng, isPlayerShot) {
    const S = this.S;
    const results = [];
    for (let p = 0; p < weapon.pellets; p++) {
      const r = this.firePellet(shooter, origin, dir, weapon, spread, rng, isPlayerShot);
      if (r) results.push(r);
    }
    const dist = results.length && results[0].hit ? results[0].dist : 40;
    this.sfx.shot(weapon.sound, isPlayerShot ? 0 : dist);
    S.stats.shots += weapon.pellets;
    let hitAny = false, killAny = false, headAny = false;
    for (const r of results) {
      if (r.hit) {
        hitAny = true; S.stats.hits += 1;
        if (r.head) { headAny = true; S.stats.headshots += 1; }
        if (r.kill) killAny = true;
      }
    }
    return { hit: hitAny, kill: killAny, head: headAny };
  }

  throwGrenadeEntity(owner, pos, dir, kind) {
    this.S.grenades.push({
      x: pos.x, y: pos.y + 0.1, z: pos.z,
      vx: dir.x * 13, vy: dir.y * 13 + 4.2, vz: dir.z * 13,
      fuse: kind === 'frag' ? 2.6 : 1.4, kind, owner, bounced: 0,
    });
    this.sfx.throwWhoosh();
  }

  stepGrenades(dt) {
    const S = this.S;
    for (let i = S.grenades.length - 1; i >= 0; i--) {
      const g = S.grenades[i];
      g.vy -= 12 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      if (g.y < 0.12) { g.y = 0.12; g.vy *= -0.35; g.vx *= 0.6; g.vz *= 0.6; g.bounced++; }
      const p = { x: g.x, y: g.y, z: g.z };
      if (this.world.collideCircle(p, 0.15)) { g.x = p.x; g.z = p.z; g.vx *= -0.3; g.vz *= -0.3; }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        S.grenades.splice(i, 1);
        if (g.kind === 'frag') this._detonate(g);
        else this._popSmoke(g);
      }
    }
    // Smoke decay.
    for (let i = S.smokes.length - 1; i >= 0; i--) {
      S.smokes[i].t -= dt;
      if (S.smokes[i].t <= 0) S.smokes.splice(i, 1);
    }
  }

  _detonate(g) {
    const S = this.S;
    this.sfx.explosion();
    this.render.spawnParticles(g.x, g.y + 0.4, g.z, 42, 5, 4, 0xff7a2e);
    this.render.spawnParticles(g.x, g.y + 0.4, g.z, 20, 2.5, 6, 0xffd27a);
    if (S.player && S.player.alive) {
      const d = Math.hypot(S.player.pos.x - g.x, S.player.pos.z - g.z);
      if (d < 7) {
        const dmg = Math.round(18 + (120 - 18) * (1 - d / 7));
        this.hooks.onDamage(S.player, dmg, false, g.owner);
      }
    }
    for (const b of S.bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - g.x, b.pos.z - g.z);
      if (d < 7) {
        const dmg = Math.round(18 + (120 - 18) * (1 - d / 7));
        this.hooks.onDamage(b, dmg, false, g.owner);
      }
    }
    if (S.player) S.shake = Math.max(S.shake, 0.5);
  }

  _popSmoke(g) {
    this.S.smokes.push({ x: g.x, y: 1.2, z: g.z, r: 5.5, t: 13 });
    this.render.spawnParticles(g.x, g.y + 0.6, g.z, 26, 2, 2.5, 0x9aa4ad);
  }
}
