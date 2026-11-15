// bots.js — the nine AI teammates and opponents.
// Bots think at 10 Hz and steer every step. They follow waypoint routes
// (BFS over the map graph), hold sites, react to sight and sound, plant
// and defuse the bomb, and fight in bursts with skill-based aim error.
// Decisions live here; movement integration lives in sim.js.

import { S, aliveCount, eyeHeight } from './sim.js';
import { MAP, bfsPath, nearestNode } from './mapdata.js';
import { botShoot, equipWeapon, refillWeapon } from './combat.js';
import { angleDiff, clamp, dist2, segmentBlocked } from './util.js';

const THINK_HZ = 0.1;

// Assign routes and holds at the start of a round. Attackers split across
// lanes toward the target site; defenders hold both sites plus mid.
export function assignRoles() {
  const target = S.targetSite;
  const attackers = S.actors.filter((a) => a.team === 'azure' && !a.isPlayer);
  const defenders = S.actors.filter((a) => a.team === 'rust');
  const laneRoutes = target === 'A'
    ? ['A', 'A', 'Amid', 'Bmid']
    : ['B', 'B', 'Bmid', 'Amid'];
  attackers.forEach((b, i) => {
    const key = laneRoutes[i % laneRoutes.length];
    b.route = [...MAP.routes[key]];
    b.routeIdx = 0;
    b.botState = 'route';
    buyBotWeapon(b);
  });
  const holds = [...MAP.holds.A, ...MAP.holds.B, ...MAP.holds.mid];
  defenders.forEach((b, i) => {
    b.hold = holds[i % holds.length];
    b.route = [];
    b.botState = 'hold';
    buyBotWeapon(b);
    if (S.rng() < 0.5) b.kevlar = true;
  });
}

function buyBotWeapon(b) {
  const r = S.rng();
  const key = r < 0.55 ? 'ar51' : r < 0.8 ? 'hornet' : 'longbow';
  equipWeapon(b, key);
  refillWeapon(b, key);
}

// Nearest waypoint route from the bot's position to a waypoint id.
function routeTo(b, nodeId) {
  const from = nearestNode(b.x, b.z);
  const path = bfsPath(from, nodeId);
  if (!path) return false;
  b.route = path; b.routeIdx = 0;
  return true;
}

function canSee(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const dist2v = dx * dx + dz * dz;
  if (dist2v > 48 * 48) return false;
  const eyeY = a.y + eyeHeight(a);
  const chestY = b.y + eyeHeight(b) - 0.55;
  return !segmentBlocked(a.x, eyeY, a.z, b.x, chestY, b.z, MAP.solids,
    S.smokes.map((s) => ({ x: s.x, y: s.y, z: s.z, r: s.r })));
}

function visibleEnemy(b) {
  let best = null, bd = Infinity;
  for (const a of S.actors) {
    if (!a.alive || a.team === b.team) continue;
    const dx = a.x - b.x, dz = a.z - b.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bd) continue;
    const want = Math.atan2(dz, dx);
    if (Math.abs(angleDiff(want, b.yaw)) > 1.15) continue; // ~132 deg FOV
    if (!canSee(b, a)) continue;
    best = a; bd = d2;
  }
  return best;
}

function think(b, dt) {
  b.thinkT -= dt;
  if (b.thinkT > 0) return;
  b.thinkT = THINK_HZ;
  if (b.blindT > 0) { b.moveX = 0; b.moveZ = 0; return; }
  const enemy = visibleEnemy(b);
  if (enemy) {
    b.target = enemy; b.lastSeen = S.time;
    b.botState = 'engage';
    return;
  }
  // Lost the target a moment ago: keep facing the last seen spot.
  if (b.target && S.time - b.lastSeen < 1.2) { b.botState = 'engage'; return; }
  b.target = null;

  const bomb = S.bomb;
  if (bomb.state === 'planted') {
    if (b.team === 'rust') {
      // Retake: converge on the planted site and defuse when close.
      if (dist2(b.x, b.z, bomb.x, bomb.z) < 2.6) {
        b.botState = 'defuse';
        b.defusing = true;
        b.moveX = 0; b.moveZ = 0;
        return;
      }
      b.defusing = false;
      const node = b.team === 'rust'
        ? nearestNode(bomb.x, bomb.z) : 0;
      if (!b.route.length || b.routeIdx >= b.route.length) {
        routeTo(b, bomb.site === 'A' ? 12 : 18);
        b.botState = 'retake';
      }
      return;
    }
    // Attackers defend the planted bomb from nearby cover.
    if (!b.hold) {
      b.hold = [clamp(bomb.x + (S.rng() - 0.5) * 6, 24, 40),
        clamp(bomb.z + (S.rng() - 0.5) * 6, -26, 26), S.rng() * 6.28];
    }
    b.botState = 'hold';
    return;
  }
  b.defusing = false;

  if (b.team === 'azure') {
    if (b.hasBomb) {
      // The carrier pushes to the target site, then plants.
      const site = MAP.sites[S.targetSite];
      if (b.x >= site.x0 && b.x <= site.x1 && b.z >= site.z0 && b.z <= site.z1) {
        const near = S.actors.some((a) => a.alive && a.team === 'rust'
          && dist2(a.x, a.z, b.x, b.z) < 12 * 12);
        if (!near || S.roundTime < 25) {
          b.botState = 'plant';
          b.planting = true;
          b.moveX = 0; b.moveZ = 0;
          return;
        }
      }
      b.planting = false;
      if (!b.route.length) {
        const key = S.targetSite === 'A' ? 'A' : 'B';
        b.route = [...MAP.routes[key]];
        b.routeIdx = 0;
      }
      b.botState = 'route';
      return;
    }
    // Non-carriers follow their lane, then hold near the site.
    if (b.routeIdx < b.route.length) { b.botState = 'route'; return; }
    b.botState = 'hold';
    if (!b.hold) {
      const site = MAP.sites[S.targetSite];
      b.hold = [site.x0 + S.rng() * 8, site.z0 + S.rng() * 6, S.rng() * 6.28];
    }
    return;
  }

  // Defenders: walk to the hold point, then scan.
  if (b.hold) {
    const d2 = dist2(b.x, b.z, b.hold[0], b.hold[1]);
    if (d2 > 1.2) {
      if (!b.route.length) routeTo(b, nearestNode(b.hold[0], b.hold[1]));
      b.botState = 'route';
      return;
    }
    b.botState = 'hold';
    return;
  }

  // Heard a shot recently: investigate it.
  if (S.time - b.hearT < 3) {
    b.botState = 'investigate';
    if (!b.route.length) routeTo(b, nearestNode(b.hearX, b.hearZ));
  }
}

function steer(b, dt) {
  if (b.blindT > 0) { b.blindT -= dt; b.moveX = 0; b.moveZ = 0; return; }
  let tx = null, tz = null, faceYaw = null;
  if (b.botState === 'engage' && b.target && b.target.alive) {
    const t = b.target;
    faceYaw = Math.atan2(t.z - b.z, t.x - b.x);
    // Strafe sideways while fighting, changing direction every second.
    b.strafeT = (b.strafeT || 0) - dt;
    if (b.strafeT <= 0) { b.strafeT = 0.8 + S.rng() * 0.7; b.strafeDir = S.rng() < 0.5 ? -1 : 1; }
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    const fwd = d > 14 ? 1 : d < 6 ? -0.6 : 0;
    const fx = Math.cos(faceYaw), fz = Math.sin(faceYaw);
    tx = fx * fwd * 0.7 + -fz * (b.strafeDir || 1) * 0.7;
    tz = fz * fwd * 0.7 + fx * (b.strafeDir || 1) * 0.7;
    // Fire in bursts with pauses.
    b.fireT -= dt;
    if (b.fireT <= 0) {
      if (b.burstLeft > 0) {
        if (botShoot(b, t)) b.burstLeft--;
        b.fireT = 0.12;
      } else {
        b.burstLeft = 3 + Math.floor(S.rng() * 3);
        b.fireT = 0.5 + S.rng() * 0.6;
      }
    }
  } else if (b.botState === 'route' && b.route.length && b.routeIdx < b.route.length) {
    const [wx, wz] = MAP.waypoints[b.route[b.routeIdx]];
    const dx = wx - b.x, dz = wz - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) { b.routeIdx++; b.stuckT = 0; }
    else {
      tx = dx / d; tz = dz / d;
      faceYaw = Math.atan2(dz, dx);
    }
  } else if (b.botState === 'hold' && b.hold) {
    const dx = b.hold[0] - b.x, dz = b.hold[1] - b.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.2) { tx = dx / d; tz = dz / d; faceYaw = Math.atan2(dz, dx); }
    else {
      // Scan: slow sweep across the hold yaw.
      faceYaw = b.hold[2] + Math.sin(S.time * 0.45 + b.id) * 0.9;
      tx = 0; tz = 0;
    }
  } else if (b.botState === 'investigate') {
    const dx = b.hearX - b.x, dz = b.hearZ - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) { b.botState = 'hold'; b.hold = [b.x, b.z, b.yaw]; }
    else if (b.route.length && b.routeIdx < b.route.length) {
      const [wx, wz] = MAP.waypoints[b.route[b.routeIdx]];
      const wdx = wx - b.x, wdz = wz - b.z;
      const wd = Math.hypot(wdx, wdz);
      if (wd < 0.9) b.routeIdx++;
      else { tx = wdx / wd; tz = wdz / wd; faceYaw = Math.atan2(wdz, wdx); }
    }
  }
  // Stuck detection: no progress while trying to move -> sidestep.
  if (tx !== null && tz !== null && (tx !== 0 || tz !== 0)) {
    const moved = Math.hypot(b.x - b.lastPosX, b.z - b.lastPosZ);
    if (moved < 0.02) {
      b.stuckT += dt;
      if (b.stuckT > 1.2) {
        b.sideT = 0.7; b.sideDir = (b.sideDir || 1) * -1; b.stuckT = 0;
      }
    } else b.stuckT = 0;
    b.lastPosX = b.x; b.lastPosZ = b.z;
    if (b.sideT > 0) {
      b.sideT -= dt;
      const px = -tz * b.sideDir, pz = tx * b.sideDir;
      tx = px; tz = pz;
    }
    b.moveX = tx; b.moveZ = tz;
  } else {
    b.moveX = 0; b.moveZ = 0;
  }
  if (faceYaw !== null) {
    b.yaw += angleDiff(faceYaw, b.yaw) * Math.min(1, dt * 8);
  }
}

export function stepBots(dt) {
  if (S.phase !== 'live' && S.phase !== 'buy') return;
  for (const b of S.actors) {
    if (b.isPlayer || !b.alive) continue;
    if (S.phase === 'buy') { b.moveX = 0; b.moveZ = 0; continue; }
    think(b, dt);
    steer(b, dt);
  }
}
