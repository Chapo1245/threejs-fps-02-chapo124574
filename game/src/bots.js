// bots.js — bot AI: waypoint routes, hold positions, vision cones,
// hearing, burst fire, bomb plant / defuse / retake.
// Bots share what they see (lastKnown) with a 1s delay, react after a
// human-like delay, and fire the same combat.fire path as the player,
// so bot accuracy is honest, not scripted damage.

import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { clamp } from './state.js';
import { makeLoadout, initAmmo, currentWeapon, tickLoadout, tryFire, startReload, currentSpread } from './weapons.js';

const BOT_SPEED = 4.3;
const SCAN_INTERVAL = 0.14;
const VIEW_DIST = 48;
const FOV_COS = 0.45; // ~63 deg half-angle

const _v = { x: 0, z: 0 };

export class Bots {
  constructor(S, world, render, sfx, combat, hooks) {
    this.S = S;
    this.world = world;
    this.render = render;
    this.sfx = sfx;
    this.combat = combat;
    this.hooks = hooks;
    this.list = [];
  }

  spawnRound(planSite, difficulty) {
    const S = this.S;
    const layout = this.world.layout;
    const variant = S.variantCfg;
    // Reuse meshes across rounds; create once.
    if (this.list.length === 0) {
      for (let i = 0; i < 9; i++) {
        const team = i < 4 ? 'atk' : 'def';
        const mesh = this.render.makeBotMesh(team);
        this.render.scene.add(mesh);
        this.list.push({ mesh, team, id: i });
      }
    }
    const atkGuns = ['rifle', 'rifle', 'smg', 'shotgun'];
    const defGuns = ['rifle', 'rifle', 'sniper', 'smg', 'rifle'];
    const atkRoutes = planSite === 'A'
      ? ['atkA', 'atkMid', 'atkB', 'atkA']
      : ['atkB', 'atkMid', 'atkA', 'atkB'];
    const defHolds = ['defA', 'defB', 'defMid', 'defA', 'defB'];
    S.bots = this.list;
    for (let i = 0; i < 9; i++) {
      const b = this.list[i];
      const isAtk = i < 4;
      const spawn = isAtk ? layout.spawns.atk[i + 1] : layout.spawns.def[i - 4];
      b.name = isAtk ? S.atkNames[i] : S.defNames[i - 4];
      b.pos = { x: spawn.x, y: 0, z: spawn.z };
      b.vel = { x: 0, z: 0 };
      b.yaw = spawn.yaw;
      b.hp = 100; b.armor = isAtk ? 0 : 25;
      b.alive = true;
      b.loadout = makeLoadout(isAtk ? atkGuns[i] : defGuns[i - 4]);
      initAmmo(b.loadout);
      for (const k of Object.keys(b.loadout.ammo)) b.loadout.ammo[k].reserve = 999;
      b.role = isAtk ? atkRoutes[i] : defHolds[i - 4];
      b.route = layout.routes[b.role].slice();
      b.routeIdx = 0;
      b.state = 'move';
      b.target = null;
      b.lastSeen = null;
      b.lastKnownShared = null;
      b.reactT = 0;
      b.scanT = 0.1 + i * 0.02;
      b.burstLeft = 0;
      b.burstPause = 0;
      b.fireT = 0;
      b.strafeDir = 1;
      b.strafeT = 0;
      b.holdNode = null;
      b.isCarrier = false;
      b.channel = null; // {kind:'plant'|'defuse', t, dur}
      b.hearT = -99;
      // Difficulty scales the variant's bot profile per bot.
      const dm = S.difficulty === 'hard' ? { r: 0.85, a: 1.12 } : S.difficulty === 'easy' ? { r: 1.3, a: 0.85 } : { r: 1, a: 1 };
      b.skill = {
        reaction: variant.bot.reaction * dm.r,
        accuracy: clamp(variant.bot.accuracy * dm.a, 0.1, 0.9),
        aggression: variant.bot.aggression,
        holdBias: variant.bot.holdBias,
      };
      b.aimErr = 0;
      b.mesh.visible = true;
      b.mesh.rotation.set(0, b.yaw, 0);
      b.mesh.position.set(b.pos.x, 0, b.pos.z);
      b.mesh.scale.set(1, 1, 1);
      b.fallT = 0;
    }
    // Attackers pick a site plan; defenders spread to holds.
    S.planSite = planSite;
  }

  // One bot's scan: nearest visible enemy, plus hearing.
  _scan(b, dt) {
    const S = this.S;
    b.scanT -= dt;
    if (b.scanT > 0) return;
    b.scanT = SCAN_INTERVAL;
    const eyeY = 1.55;
    let best = null, bestD = Infinity;
    for (let i = 0; i < S.targets.length; i++) {
      const tg = S.targets[i];
      if (!tg.alive || tg.team === b.team) continue;
      const dx = tg.x - b.pos.x, dz = tg.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > VIEW_DIST || d < 0.4) continue;
      if (d > 3) {
        // FOV check against facing.
        const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
        if ((dx * fx + dz * fz) / d < FOV_COS) continue;
      }
      if (!this.world.hasLOS(b.pos.x, eyeY, b.pos.z, tg.x, 1.45, tg.z, S.smokes)) continue;
      if (d < bestD) { bestD = d; best = tg; }
    }
    if (best) {
      if (b.target !== best.ref) {
        // First sight: reaction delay before the first shot.
        b.reactT = b.skill.reaction * (0.8 + S.rng() * 0.5);
        b.burstLeft = 0; b.burstPause = 0;
      }
      b.target = best.ref;
      b.lastSeen = { x: best.x, z: best.z, t: S.time };
      b.lastKnownShared = { x: best.x, z: best.z, t: S.time };
    } else {
      b.target = null;
    }
    // Hearing: enemy shots within 28m reveal a position (no exact aim).
    for (let i = 0; i < S.shotEvents.length; i++) {
      const ev = S.shotEvents[i];
      if (ev.t <= b.hearT || ev.team === b.team) continue;
      const d = Math.hypot(ev.x - b.pos.x, ev.z - b.pos.z);
      if (d < 28) {
        b.hearT = ev.t;
        b.lastSeen = { x: ev.x + (S.rng() - 0.5) * 4, z: ev.z + (S.rng() - 0.5) * 4, t: S.time };
      }
    }
  }

  update(dt) {
    const S = this.S;
    for (const b of this.list) {
      if (!b.alive) {
        if (b.fallT > 0) {
          b.fallT -= dt;
          b.mesh.rotation.x = Math.min(Math.PI / 2, b.mesh.rotation.x + dt * 5);
          if (b.fallT <= 0) b.mesh.visible = false;
        }
        continue;
      }
      this._scan(b, dt);
      tickLoadout(b.loadout, dt);
      // Channel (plant/defuse): stand still, abort if an enemy is close.
      if (b.channel) {
        const ch = b.channel;
        ch.t += dt;
        let near = false;
        if (b.target && b.target.alive) {
          const tx = b.target.pos ? b.target.pos.x : b.target.x;
          const tz = b.target.pos ? b.target.pos.z : b.target.z;
          near = Math.hypot(tx - b.pos.x, tz - b.pos.z) < 8;
        }
        if (near) { b.channel = null; }
        else if (ch.t >= ch.dur) {
          this.hooks.onChannelDone(b, ch.kind);
          b.channel = null;
        }
        this._faceTarget(b, dt);
        this._syncMesh(b, dt, 0);
        continue;
      }
      if (b.target && b.target.alive) {
        this._engage(b, dt);
      } else {
        this._objective(b, dt);
      }
      this._syncMesh(b, dt, Math.hypot(b.vel.x, b.vel.z));
    }
  }

  _faceTarget(b, dt) {
    if (!b.target) return;
    const tx = b.target.pos ? b.target.pos.x : b.target.x;
    const tz = b.target.pos ? b.target.pos.z : b.target.z;
    const want = Math.atan2(-(tx - b.pos.x), -(tz - b.pos.z));
    let d = want - b.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    b.yaw += clamp(d, -dt * 7, dt * 7);
  }

  _engage(b, dt) {
    const S = this.S;
    const t = b.target;
    const tx = t.pos ? t.pos.x : t.x;
    const tz = t.pos ? t.pos.z : t.z;
    const dist = Math.hypot(tx - b.pos.x, tz - b.pos.z);
    this._faceTarget(b, dt);
    // Strafe while fighting; close distance if far, hold if close.
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeDir = S.rng() < 0.5 ? -1 : 1; b.strafeT = 0.5 + S.rng() * 0.6; }
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    let mx = 0, mz = 0;
    if (dist > 14) { mx = fx; mz = fz; }
    else if (dist < 5) { mx = -fx * 0.5; mz = -fz * 0.5; }
    mx += -fz * b.strafeDir * 0.7; mz += fx * b.strafeDir * 0.7;
    this._move(b, mx, mz, dt, BOT_SPEED * 0.55);
    // Burst fire after the reaction delay.
    b.reactT -= dt;
    if (b.reactT > 0) return;
    const w = currentWeapon(b.loadout);
    if (!w) return;
    b.burstPause -= dt;
    if (b.burstLeft <= 0 && b.burstPause <= 0) {
      b.burstLeft = 3 + ((S.rng() * 3) | 0);
      b.burstPause = 0.55 + S.rng() * 0.55;
    }
    b.fireT -= dt;
    if (b.burstLeft > 0 && b.fireT <= 0) {
      b.fireT = w.interval * (1 + (1 - b.skill.accuracy) * 0.6);
      const res = tryFire(b.loadout, w, null);
      if (res === 'fired') {
        b.burstLeft -= 1;
        // Aim at chest, sometimes head, with skill-based error.
        const head = S.rng() < 0.14;
        const aimY = head ? 1.62 : 1.1;
        const err = (1 - b.skill.accuracy) * 0.055 + dist * 0.0009 + (t.moveMag || 0) * 0.02;
        const dx = tx - b.pos.x, dy = aimY - 1.55, dz = tz - b.pos.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const spread = currentSpread(w, 0.4, false, b.loadout.bloom, false) + err;
        const origin = { x: b.pos.x, y: 1.55, z: b.pos.z };
        const dir = { x: dx / len, y: dy / len, z: dz / len };
        this.combat.fire(b, origin, dir, w, spread, S.rng, false);
        this.render.muzzleFlashAt(origin);
      } else if (res === 'dry') {
        // Bot reloads on empty.
        startReload(b.loadout, null);
      }
    }
  }

  _objective(b, dt) {
    const S = this.S;
    const layout = this.world.layout;
    // Bomb planted: attackers defend the site, defenders retake.
    if (S.bomb.planted) {
      if (b.team === 'def') {
        const site = layout.sites[S.bomb.site];
        const d = Math.hypot(site.x - b.pos.x, site.z - b.pos.z);
        if (d < 2.2) {
          if (!b.channel) {
            b.channel = { kind: 'defuse', t: 0, dur: S.defuseTime };
            this.sfx.defuseBeep();
          }
          return;
        }
        this._followRoute(b, layout.routes[S.bomb.site === 'A' ? 'retakeA' : 'retakeB'], dt);
        return;
      }
      // Attackers: hold near the planted site.
      const site = layout.sites[S.bomb.site];
      const d = Math.hypot(site.x - b.pos.x, site.z - b.pos.z);
      if (d > 6) { this._steerTo(b, site.x, site.z, dt, BOT_SPEED * 0.8); return; }
      this._holdScan(b, dt);
      return;
    }
    if (b.team === 'atk') {
      // Carrier plants when it reaches its site.
      if (b.isCarrier) {
        const site = layout.sites[S.planSite];
        const d = Math.hypot(site.x - b.pos.x, site.z - b.pos.z);
        if (d < site.r * 0.7) {
          if (!b.channel) {
            b.channel = { kind: 'plant', t: 0, dur: S.plantTime };
            this.sfx.plantStart();
          }
          return;
        }
      }
      this._followRoute(b, b.route, dt);
      return;
    }
    // Defenders: walk to hold, then scan.
    if (b.holdNode !== null) { this._holdScan(b, dt); return; }
    this._followRoute(b, b.route, dt);
  }

  _holdScan(b, dt) {
    // Slowly sweep the view; move to investigate lastSeen if fresh.
    const S = this.S;
    if (b.lastSeen && S.time - b.lastSeen.t < 6 && b.team === 'def') {
      const d = Math.hypot(b.lastSeen.x - b.pos.x, b.lastSeen.z - b.pos.z);
      if (d > 4) { this._steerTo(b, b.lastSeen.x, b.lastSeen.z, dt, BOT_SPEED * 0.7); return; }
    }
    b.yaw += dt * 0.35 * Math.sin(S.time * 0.5 + b.id);
    this._move(b, 0, 0, dt, 0);
  }

  _followRoute(b, route, dt) {
    if (!route || route.length === 0) { this._holdScan(b, dt); return; }
    if (b.routeIdx >= route.length) {
      // End of route: hold here and scan.
      b.holdNode = route[route.length - 1];
      this._holdScan(b, dt);
      return;
    }
    const node = route[b.routeIdx];
    this.world.nodePos(node, _v);
    const d = Math.hypot(_v.x - b.pos.x, _v.z - b.pos.z);
    if (d < 1.4) { b.routeIdx += 1; return; }
    this._steerTo(b, _v.x, _v.z, dt, BOT_SPEED);
  }

  _steerTo(b, x, z, dt, speed) {
    const dx = x - b.pos.x, dz = z - b.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    this._move(b, dx / len, dz / len, dt, speed);
    const want = Math.atan2(-dx, -dz);
    let d = want - b.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    b.yaw += clamp(d, -dt * 6, dt * 6);
  }

  _move(b, mx, mz, dt, speed) {
    const len = Math.hypot(mx, mz);
    if (len > 0.01) { mx /= len; mz /= len; }
    const k = Math.min(1, dt * 8);
    b.vel.x += (mx * speed - b.vel.x) * k;
    b.vel.z += (mz * speed - b.vel.z) * k;
    b.pos.x += b.vel.x * dt;
    b.pos.z += b.vel.z * dt;
    this.world.collideCircle(b.pos, 0.38);
  }

  _syncMesh(b, dt, speed) {
    const m = b.mesh;
    m.position.set(b.pos.x, 0, b.pos.z);
    m.rotation.y = b.yaw;
    this.render.animateBot(m, speed, dt, !!b.channel);
  }
}

// Bots keep their meshes across rounds; spawnRound only re-places them.
