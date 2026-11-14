// bots.js — bot brains. A bot is a small state machine over the map's
// waypoint graph:
//
//   route      follow a lane route toward a site
//   hold       sit at a hold waypoint and watch an angle
//   engage     an enemy is visible: aim, burst fire, strafe
//   investigate gunfire was heard: walk to where it came from
//   plant      the carrier stands in the site, planting
//   defuse     a defender stands at the planted bomb, defusing
//   defend     after the plant, attackers hold the site
//   retreat    hurt and alone: fall back to the nearest hold
//
// Perception is line of sight + field of view + range, with smoke
// blocking sight; hearing is the shot-noise list combat.js keeps.
// Bots shoot through the same fireWeapon/fireShot path as the player,
// so their recoil, spread and ammo rules are identical.
import { BOT, WEAPONS } from './config.js';
import { clamp, wrapAngle } from './util.js';
import { fireWeapon, startReload, tickReload, currentSpread } from './weapons.js';
import { fireShot } from './combat.js';

function wpById(map, id) {
  return map.waypoints.find((w) => w.id === id);
}

/**
 * Shortest waypoint path from (fromX, fromZ) to (toX, toZ): the nearest
 * waypoint to each end, then breadth-first search over the graph's links.
 * Returns a list of points ending at the exact target, so a bot can walk
 * around walls instead of pushing straight into them (the old defuse
 * behaviour: walk at the bomb through a warehouse wall forever).
 */
export function findPath(map, fromX, fromZ, toX, toZ) {
  const wps = map.waypoints;
  const nearest = (x, z) => {
    let best = null;
    let bd = Infinity;
    for (const w of wps) {
      const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  };
  const start = nearest(fromX, fromZ);
  const goal = nearest(toX, toZ);
  if (!start || !goal) return [{ x: toX, z: toZ }];
  const prev = new Map([[start.id, null]]);
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === goal.id) break;
    const w = wpById(map, id);
    if (!w) continue;
    for (const nb of w.links) {
      if (!prev.has(nb)) {
        prev.set(nb, id);
        queue.push(nb);
      }
    }
  }
  if (!prev.has(goal.id)) return [{ x: toX, z: toZ }];
  const ids = [];
  let cur = goal.id;
  while (cur !== null) {
    ids.unshift(cur);
    cur = prev.get(cur);
  }
  const pts = ids.map((id) => {
    const w = wpById(map, id);
    return { x: w.x, z: w.z };
  });
  pts.push({ x: toX, z: toZ });
  return pts;
}

/** Walk a bot along its cached path to (tx, tz); rebuilds when the target moves. */
function moveAlongPath(S, world, bot, map, tx, tz, speed, dt) {
  const b = bot.brain;
  if (!b.path || b.pathTx !== tx || b.pathTz !== tz) {
    b.path = findPath(map, bot.x, bot.z, tx, tz);
    b.pathIdx = 0;
    b.pathTx = tx;
    b.pathTz = tz;
  }
  while (b.pathIdx < b.path.length) {
    const p = b.path[b.pathIdx];
    if (Math.hypot(bot.x - p.x, bot.z - p.z) < 1.4) {
      b.pathIdx += 1;
      continue;
    }
    return steer(S, world, bot, p.x, p.z, speed, dt);
  }
  return true;
}

/** Fresh brain for a bot actor. */
export function makeBrain(actor, profile, site) {
  return {
    profile, // 'hold' | 'push'
    site, // assigned site 'A' | 'B' | 'mid'
    state: 'route',
    route: [],
    routeIdx: 0,
    target: null,
    lastKnown: null,
    holdWp: null,
    holdUntil: 0,
    dest: null, // {x, z} current steering target
    reactionUntil: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    nextShotAt: 0,
    thinkAt: 0,
    stuckAt: 0,
    stuckX: 0,
    stuckZ: 0,
    strafeDir: 1,
    strafeUntil: 0,
    onDeath: null,
  };
}

/** Pick a lane route for an attacker bot, biased by its site assignment. */
export function assignAttackRoute(S, map, bot, rng) {
  const b = bot.brain;
  const roll = rng();
  if (bot.hasBomb) {
    // The carrier takes the safest lane to its site.
    b.route = b.site === 'B' ? map.routes.blong : map.routes.along;
  } else if (roll < 0.4) {
    b.route = b.site === 'B' ? map.routes.midB : map.routes.mid;
  } else {
    b.route = b.site === 'B' ? map.routes.blong : map.routes.along;
  }
  b.routeIdx = 1; // index 0 is the spawn waypoint we already stand on
  b.state = 'route';
  b.dest = null;
}

/** Assign a defender its hold waypoint. */
export function assignDefendHold(S, map, bot, rng) {
  const b = bot.brain;
  const holds = map.holds[b.site] ?? map.holds.mid;
  b.holdWp = holds[Math.floor(rng() * holds.length)];
  b.state = 'hold';
  b.holdUntil = S.time + BOT.holdTimeMin + rng() * (BOT.holdTimeMax - BOT.holdTimeMin);
  b.dest = null;
}

/** Can this bot see that actor right now? */
export function canSee(S, world, bot, foe, now) {
  const dx = foe.x - bot.x;
  const dz = foe.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > BOT.seeRange) return false;
  if (dist < 0.5) return true;
  // Field of view: the foe must be roughly ahead of the bot's facing.
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  if ((dx * fx + dz * fz) / dist < BOT.fovCos) return false;
  const eyeY = bot.y + (bot.crouch ? 1.08 : 1.62);
  const foeY = foe.y + 1.2;
  if (!world.hasLineOfSight(bot.x, eyeY, bot.z, foe.x, foeY, foe.z, S.smokes)) return false;
  // A crouched foe behind low cover is harder to spot past 25 m.
  if (foe.crouch && dist > 25) return false;
  return true;
}

/** The nearest visible enemy, or null. */
function nearestVisible(S, world, bot, now) {
  let best = null;
  let bestD = Infinity;
  for (const foe of S.actors) {
    if (!foe.alive || foe.team === bot.team) continue;
    const d = Math.hypot(foe.x - bot.x, foe.z - bot.z);
    if (d >= bestD) continue;
    if (canSee(S, world, bot, foe, now)) {
      best = foe;
      bestD = d;
    }
  }
  return best;
}

/** Latest enemy gunfire this bot could have heard. */
function heardNoise(S, bot, now) {
  let best = null;
  for (const n of S.shotNoise) {
    if (n.team === bot.team) continue;
    if (now - n.at > 2.5) continue;
    const d = Math.hypot(n.x - bot.x, n.z - bot.z);
    if (d > BOT.hearRadius) continue;
    if (!best || n.at > best.at) best = n;
  }
  return best;
}

/** Steer toward (tx, tz) at `speed`, sliding along walls. */
function steer(S, world, bot, tx, tz, speed, dt) {
  const b = bot.brain;
  let dx = tx - bot.x;
  let dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.15) return true;
  if (S.time < (b.sidestepUntil ?? 0)) {
    // Wall-following: walk perpendicular to the blocked direction until
    // the bot rounds the corner it was stuck on.
    const inv = 1 / dist;
    const s = b.sidestepDir || 1;
    const px = -dz * inv * s;
    const pz = dx * inv * s;
    dx = px;
    dz = pz;
  }
  const wantYaw = Math.atan2(-dx, -dz);
  // Turn toward the target, capped so bots swing their aim like people.
  const diff = wrapAngle(wantYaw - bot.yaw);
  const turn = clamp(diff, -3.2 * dt, 3.2 * dt);
  bot.yaw += turn;
  const step = Math.min(dist, speed * dt);
  const nx = bot.x + -Math.sin(bot.yaw) * step;
  const nz = bot.z + -Math.cos(bot.yaw) * step;
  const pos = { x: nx, z: nz };
  world.moveCircle(pos, 0.38);
  bot.x = pos.x;
  bot.z = pos.z;
  bot.speed2d = speed;
  // Stuck detection: barely moving while trying to.
  const moved = Math.hypot(bot.x - b.stuckX, bot.z - b.stuckZ);
  if (moved < 0.05) {
    if (S.time - b.stuckAt > 2.5) {
      b.stuckAt = S.time;
      b.stuckX = bot.x;
      b.stuckZ = bot.z;
      // Sidestep along the wall for a moment, alternating sides so a bot
      // that picked the wrong way tries the other one next time.
      b.sidestepUntil = S.time + 1.2;
      b.sidestepDir = -(b.sidestepDir || 1);
      return 'stuck';
    }
  } else {
    b.stuckAt = S.time;
    b.stuckX = bot.x;
    b.stuckZ = bot.z;
  }
  return false;
}

/** Aim the bot's yaw/pitch at a point, with skill-based error. */
function aimAt(bot, tx, ty, tz, errDeg, rng) {
  const dx = tx - bot.x;
  const dy = ty - (bot.y + 1.5);
  const dz = tz - bot.z;
  const dist = Math.hypot(dx, dy, dz);
  const err = ((errDeg * Math.PI) / 180) * (rng() + rng() - 1);
  const errP = ((errDeg * 0.7 * Math.PI) / 180) * (rng() + rng() - 1);
  const wantYaw = Math.atan2(-dx, -dz) + err;
  const wantPitch = Math.asin(clamp(dy / Math.max(0.01, dist), -1, 1)) + errP;
  bot.yaw += clamp(wrapAngle(wantYaw - bot.yaw), -3.6 / 60, 3.6 / 60);
  bot.pitch = clamp(bot.pitch + clamp(wantPitch - bot.pitch, -2.4 / 60, 2.4 / 60), -1.2, 1.2);
}

/** One think tick (every 0.15 s): perception + state transitions. */
export function thinkBot(S, world, bot, map, now, rng) {
  const b = bot.brain;
  if (!bot.alive) return;
  if (now < b.thinkAt) return;
  b.thinkAt = now + 0.15;

  // --- perception -------------------------------------------------------
  const seen = nearestVisible(S, world, bot, now);
  if (seen) {
    const dist = Math.hypot(seen.x - bot.x, seen.z - bot.z);
    // When the bomb is ticking, a defender's job is the bomb, not a
    // distant duel: ignore enemies beyond 12 m while the timer runs low,
    // and never interrupt a defuse already in progress.
    const bombUrgent = S.bomb.state === 'planted' && bot.team === 'J' && S.bomb.timer < 25;
    const midDefuse = (bot.defuseProgress ?? 0) > 0;
    if (!bombUrgent || dist < 12 || midDefuse) {
      if (b.target !== seen) {
        // First sight: a human reaction delay before the first shot.
        b.reactionUntil = now + BOT.reactionMin + rng() * (BOT.reactionMax - BOT.reactionMin);
        b.target = seen;
        b.lastKnown = { x: seen.x, z: seen.z, at: now };
      } else {
        b.lastKnown = { x: seen.x, z: seen.z, at: now };
      }
    } else {
      b.target = null;
    }
  } else if (b.target) {
    // Lost sight: keep the last known spot briefly, then give up.
    if (!b.lastKnown || now - b.lastKnown.at > 1.2) b.target = null;
  }

  // --- state transitions -------------------------------------------------
  // A visible enemy always wins: fight first, then go back to the objective.
  if (b.target) {
    b.state = 'engage';
    return;
  }

  if (S.bomb.state === 'planted') {
    if (bot.team === 'J') {
      b.state = 'defuse';
      b.dest = { x: S.bomb.x, z: S.bomb.z };
    } else if (b.state !== 'defend' || !b.dest) {
      b.state = 'defend';
      const site = map.sites[S.bomb.site];
      b.dest = { x: site.cx + (rng() - 0.5) * 6, z: site.cz + (rng() - 0.5) * 4 };
    }
    return;
  }

  if (bot.team === 'V') {
    if (bot.hasBomb && S.bomb.state === 'carried') {
      const site = map.sites[b.site] ?? map.sites.A;
      const inSite = bot.x >= site.x0 && bot.x <= site.x1 && bot.z >= site.z0 && bot.z <= site.z1;
      if (inSite && aliveOfTeam(S, 'J') > 0) {
        b.state = 'plant';
        b.dest = { x: bot.x, z: bot.z };
        return;
      }
      if (b.state !== 'route') assignAttackRoute(S, map, bot, rng);
      return;
    }
    // Escort: follow the carrier's route a few steps behind.
    if (b.state !== 'route') assignAttackRoute(S, map, bot, rng);
    return;
  }

  // Defenders: hold, or investigate a noise near their post. (A 'mid'
  // defender has no site rectangle, so proximity is measured from the
  // hold waypoint instead of a site box.)
  const noise = heardNoise(S, bot, now);
  if (noise && b.state !== 'investigate') {
    const wp = b.holdWp ? wpById(map, b.holdWp) : null;
    const site = map.sites[b.site];
    const nearSite = wp
      ? Math.hypot(noise.x - wp.x, noise.z - wp.z) < 16
      : site
        ? noise.x >= site.x0 - 8 && noise.x <= site.x1 + 8 && noise.z >= site.z0 - 8 && noise.z <= site.z1 + 8
        : false;
    if (nearSite) {
      b.state = 'investigate';
      b.dest = { x: noise.x, z: noise.z };
      b.holdUntil = now + 4;
      return;
    }
  }
  if (b.state === 'investigate' && now > b.holdUntil) {
    assignDefendHold(S, map, bot, rng);
    return;
  }
  if (b.state !== 'hold' && b.state !== 'investigate') {
    assignDefendHold(S, map, bot, rng);
  }
}

function aliveOfTeam(S, team) {
  let n = 0;
  for (const a of S.actors) if (a.team === team && a.alive) n++;
  return n;
}

/** One fixed step for a bot: move, aim, shoot, plant, defuse. */
export function stepBot(S, world, bot, map, dt, now, rng) {
  const b = bot.brain;
  if (!bot.alive) return;
  thinkBot(S, world, bot, map, now, rng);
  tickReload(bot, now);
  bot.ads = false;

  // --- engage: stand, aim, burst fire ------------------------------------
  if (b.state === 'engage') {
    if (!b.target || !b.target.alive) {
      b.target = null;
      b.state = bot.team === 'V' ? 'route' : 'hold';
      return;
    }
    const foe = b.target;
    const dist = Math.hypot(foe.x - bot.x, foe.z - bot.z);
    const errDeg = BOT.aimErrorBase + dist * BOT.aimErrorPerMetre + (foe.speed2d > 2 ? 1.4 : 0);
    const aimY = foe.y + (foe.crouch ? 1.15 : 1.45);
    aimAt(bot, foe.x, aimY, foe.z, errDeg, rng);
    // Strafe a little so fights move instead of standing still.
    if (now > b.strafeUntil) {
      b.strafeDir = rng() < 0.5 ? -1 : 1;
      b.strafeUntil = now + 0.7 + rng() * 0.9;
    }
    if (dist > 14) {
      steer(S, world, bot, foe.x, foe.z, BOT.walkSpeed, dt);
    } else if (dist < 5) {
      steer(S, world, bot, bot.x + (bot.x - foe.x), bot.z + (bot.z - foe.z), BOT.walkSpeed, dt);
    } else {
      const sx = bot.x + Math.cos(bot.yaw) * b.strafeDir * 0.8;
      const sz = bot.z - Math.sin(bot.yaw) * b.strafeDir * 0.8;
      const pos = { x: sx, z: sz };
      world.moveCircle(pos, 0.38);
      bot.x = pos.x;
      bot.z = pos.z;
    }
    // Burst fire once the reaction delay has passed.
    if (now >= b.reactionUntil && now >= b.nextShotAt) {
      if (b.burstLeft <= 0) {
        if (now >= b.burstPauseUntil) {
          b.burstLeft = BOT.burstMin + Math.floor(rng() * (BOT.burstMax - BOT.burstMin + 1));
        }
      } else if (bot.mag > 0) {
        const shot = fireWeapon(bot, now, rng);
        if (shot.ok) {
          fireShot(S, world, bot, shot, now);
          b.burstLeft -= 1;
          b.nextShotAt = now + WEAPONS[bot.weapon].interval;
        }
      } else {
        startReload(bot, now);
        b.burstLeft = 0;
        b.burstPauseUntil = now + 1.2;
      }
    }
    return;
  }

  // --- plant / defuse ------------------------------------------------------
  if (b.state === 'plant') {
    bot.planting = 1;
    bot.speed2d = 0;
    return;
  }
  if (b.state === 'defuse') {
    const d = Math.hypot(bot.x - S.bomb.x, bot.z - S.bomb.z);
    if (d < 2.6) {
      bot.defusing = 1;
      bot.speed2d = 0;
      return;
    }
    moveAlongPath(S, world, bot, map, S.bomb.x, S.bomb.z, BOT.runSpeed, dt);
    return;
  }

  // --- movement states ------------------------------------------------------
  bot.planting = 0;
  bot.defusing = 0;
  if (b.state === 'route') {
    const wp = wpById(map, b.route[b.routeIdx]);
    if (!wp) {
      // Route done: attackers hold at the site, defenders re-hold.
      if (bot.team === 'V') {
        const site = map.sites[b.site] ?? map.sites.A;
        b.state = 'hold';
        b.dest = { x: site.cx, z: site.cz };
        b.holdUntil = now + 6;
      } else {
        assignDefendHold(S, map, bot, rng);
      }
      return;
    }
    const arrived = steer(S, world, bot, wp.x, wp.z, BOT.runSpeed, dt);
    if (arrived === true || Math.hypot(bot.x - wp.x, bot.z - wp.z) < 1.3) {
      b.routeIdx += 1;
    } else if (arrived === 'stuck') {
      b.routeIdx += 1;
    }
    return;
  }
  if (b.state === 'investigate' && b.dest) {
    const arrived = moveAlongPath(S, world, bot, map, b.dest.x, b.dest.z, BOT.runSpeed, dt);
    if (arrived === true) {
      b.state = 'hold';
      b.holdUntil = now + 2;
    }
    return;
  }
  if (b.state === 'defend' && b.dest) {
    const d = Math.hypot(bot.x - b.dest.x, bot.z - b.dest.z);
    if (d > 1.5) moveAlongPath(S, world, bot, map, b.dest.x, b.dest.z, BOT.walkSpeed, dt);
    else {
      bot.speed2d = 0;
      // Watch the likely entry: face the site centre's far edge.
      bot.yaw += wrapAngle(Math.atan2(-(b.dest.x - bot.x), -(b.dest.z - bot.z)) - bot.yaw) * 0.05;
    }
    return;
  }
  if (b.state === 'hold') {
    const wp = b.holdWp ? wpById(map, b.holdWp) : null;
    if (wp) {
      const d = Math.hypot(bot.x - wp.x, bot.z - wp.z);
      if (d > 1.2) {
        steer(S, world, bot, wp.x, wp.z, BOT.walkSpeed, dt);
        return;
      }
    }
    bot.speed2d = 0;
    // Scan: slowly sweep the yaw across the angle the hold covers.
    bot.yaw += Math.sin(now * 0.35 + bot.id.charCodeAt(0)) * 0.006;
    if (bot.team === 'V' && now > b.holdUntil) {
      // Attackers who waited too long push on.
      assignAttackRoute(S, map, bot, rng);
    }
    return;
  }
  bot.speed2d = 0;
}

/** Sync a bot actor to its three.js mesh (called every rendered frame). */
export function syncBotMesh(bot, now) {
  const m = bot.mesh;
  if (!m) return;
  if (!bot.alive) {
    // Fallen: lie flat where they dropped, once.
    if (!bot.fallen) {
      bot.fallen = true;
      m.group.rotation.set(-Math.PI / 2, 0, 0);
      m.group.position.set(bot.x, 0.28, bot.z);
    }
    return;
  }
  m.group.visible = true;
  m.group.rotation.set(0, bot.yaw + Math.PI, 0);
  m.group.position.set(bot.x, bot.y, bot.z);
  // Crouch: squash the figure a little.
  const s = bot.crouch ? 0.72 : 1;
  m.group.scale.set(1, s, 1);
}
