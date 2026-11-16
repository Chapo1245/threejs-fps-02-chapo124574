// bots.js — the bot brain. Bots run the same movement, weapons and damage code
// as the player (actors.js / combat.js); this file only decides WHAT they do:
// routes from the nav graph, holds, vision, hearing, grenades, radio callouts.
// A bot's skill (0.35..0.8) sets its aim error, reaction time and burst length.
import { clamp, dist2, angleDiff, angleLerp } from './state.js';
import { moveActor, eyeHeight } from './actors.js';
import { fireShot, throwGrenade, tryPlant, tryDefuse, siteOf } from './combat.js';
import { losBlocked, nearestNode, findPath } from './world.js';

const VISION_RANGE = 42;      // metres — beyond this a bot cannot spot you
const VISION_FOV = 1.9;       // radians of half-angle the bot can see
const HEARING_RANGE = 30;     // gunfire heard inside this radius
const BOT_NAMES_A = ['Rook', 'Cinder', 'Moss', 'Pike', 'Wren'];
const BOT_NAMES_B = ['Holt', 'Brass', 'Slate', 'Fenn', 'Odo'];

export function makeBotTeam(state, rng) {
  // The human player is always RIVETS (attack); 4 bot teammates + 5 defenders.
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const b = state.actors[1 + i];
    b.bot.skill = 0.5 + rng() * 0.2;
    b.bot.site = rng() < 0.5 ? 'A' : 'B';
    b.bot.lane = i % 3;
  }
  for (let i = 0; i < 5; i++) {
    const b = state.actors[5 + i];
    b.bot.skill = 0.45 + rng() * 0.25;
    b.bot.site = i < 3 ? 'A' : 'B';
    b.bot.lane = i % 3;
  }
  return bots;
}

// Assign each bot a job for the round: attackers pick a site + lane, defenders
// take a hold position; the spike carrier is the highest-skill attacker.
export function assignRoundJobs(state, rng) {
  const atk = state.actors.filter(a => a.team === 'A' && a.alive);
  const def = state.actors.filter(a => a.team === 'B' && a.alive);
  state.targetSite = rng() < 0.5 ? 'A' : 'B';
  let carrier = null, bestSkill = -1;
  for (const a of atk) {
    if (a.isPlayer) continue;
    a.bot.site = Math.random() < 0.62 ? state.targetSite : (state.targetSite === 'A' ? 'B' : 'A');
    if (a.bot.skill > bestSkill) { bestSkill = a.bot.skill; carrier = a; }
  }
  const human = state.actors.find(a => a.isPlayer);
  if (human && !atk.some(a => a.hasSpike)) { /* human may pick the spike up */ }
  if (carrier) { for (const a of atk) a.hasSpike = false; carrier.hasSpike = true; }
  for (let i = 0; i < def.length; i++) {
    const b = def[i];
    const holds = state.map.holds[b.bot.site] || state.map.holds.A;
    const hold = holds[i % holds.length];
    // Walk the nav graph to the hold, then sit on it (never a straight line
    // through the buildings — that wedges bots against walls).
    b.bot.holdPos = hold;
    b.bot.state = 'route';
    b.bot.path = planRoute(state, b, hold.node);
    b.bot.node = 0;
  }
  for (const a of atk) {
    if (a.isPlayer) continue;
    a.bot.state = 'route';
    a.bot.path = planRoute(state, a, siteNode(state, a.bot.site));
    a.bot.node = 0;
  }
}
function siteNode(state, site) {
  return site === 'A' ? state.map.nodes.findIndex(n => n.x === 19 && n.z === -13)
    : state.map.nodes.findIndex(n => n.x === -19 && n.z === -13);
}
export function planRoute(state, actor, goalNode) {
  const from = nearestNode(state.map, actor.pos.x, actor.pos.z);
  return findPath(state.map, from, goalNode);
}

// --- Vision: can `bot` see `other` right now? ------------------------------
export function canSee(state, world, bot, other) {
  if (!other.alive) return false;
  const d2 = dist2(bot.pos.x, bot.pos.z, other.pos.x, other.pos.z);
  if (d2 > VISION_RANGE * VISION_RANGE) return false;
  const dx = other.pos.x - bot.pos.x, dz = other.pos.z - bot.pos.z;
  const d = Math.sqrt(d2) || 1;
  const toTarget = Math.atan2(-dx, -dz); // yaw convention: forward = (-sin, -cos)
  if (Math.abs(angleDiff(bot.yaw, toTarget)) > VISION_FOV && d > 6) return false;
  if (losBlocked(world.colliders, bot.pos.x, bot.pos.z, other.pos.x, other.pos.z)) return false;
  // Smoke blocks vision: a smoke cloud between the two hides the target.
  if (state.smokes) for (const s of state.smokes) {
    if (segmentNearPoint(bot.pos.x, bot.pos.z, other.pos.x, other.pos.z, s.x, s.z, 3.2)) return false;
  }
  // Crouching + far + still is harder to spot; moving in the open is easy.
  const spot = 0.35 + other.moveMag * 0.5 + (other.crouch ? -0.15 : 0) + (d < 12 ? 0.35 : 0);
  return Math.random() < Math.min(1, spot + bot.bot.skill * 0.3);
}
function segmentNearPoint(ax, az, bx, bz, px, pz, r) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return (cx - px) * (cx - px) + (cz - pz) * (cz - pz) < r * r;
}

// --- The tick: one bot, one fixed step. -------------------------------------
export function tickBot(state, world, bot, dt, rng) {
  const brain = bot.bot;
  if (!bot.alive || !brain) return;
  bot.flash = Math.max(0, bot.flash - dt);
  if (bot.flash > 0.4) { moveActor(bot, { f: 0, s: 0 }, dt, world.colliders); return; } // blind: freeze

  // Hearing: a loud shot nearby becomes an investigate point (bots react to
  // what they hear, not just what they see).
  for (const s of state.shots) {
    if (s.loud && dist2(bot.pos.x, bot.pos.z, s.x, s.z) < HEARING_RANGE * HEARING_RANGE) {
      if (state.time - brain.reactAt > 1.5) {
        brain.investigate = { x: s.x, z: s.z };
        brain.reactAt = state.time;
        if (brain.state === 'hold') brain.state = 'investigate';
      }
    }
  }

  // Vision scan: nearest visible enemy becomes the target.
  let target = null, targetD = Infinity;
  for (const other of state.actors) {
    if (other.team === bot.team || !other.alive) continue;
    const d = Math.sqrt(dist2(bot.pos.x, bot.pos.z, other.pos.x, other.pos.z));
    if (d < targetD && canSee(state, world, bot, other)) { target = other; targetD = d; }
  }
  if (target) { brain.target = target; brain.lastSeen = { x: target.pos.x, z: target.pos.z }; brain.lastSeenAt = state.time; }
  else if (state.time - brain.lastSeenAt > 2.5) brain.target = null;

  const bomb = state.bomb;
  // Role overrides: plant the spike, defuse it, or retake the site.
  if (bot.hasSpike && brain.state !== 'plant' && siteOf(state, bot)) brain.state = 'plant';
  if (bomb.state === 'planted' && bot.team === 'B' && brain.state !== 'defuse' && brain.state !== 'retake') {
    brain.state = 'retake';
    brain.path = planRoute(state, bot, siteNode(state, bomb.site));
    brain.node = 0;
    radio(state, bot, bomb.site === 'A' ? 'Spike down on A — retaking!' : 'Spike down on B — retaking!');
  }
  if (bomb.state === 'planted' && bot.team === 'A' && brain.state !== 'guard') {
    brain.state = 'guard';
    brain.path = planRoute(state, bot, siteNode(state, bomb.site));
    brain.node = 0;
  }

  const input = { f: 0, s: 0, jump: false, crouch: false, ads: false, sprint: false };
  if (brain.target) {
    // Engage: face the target, strafe, fire in bursts sized by skill.
    const t = brain.target;
    const wantYaw = Math.atan2(-(t.pos.x - bot.pos.x), -(t.pos.z - bot.pos.z));
    bot.yaw = angleLerp(bot.yaw, wantYaw, clamp(dt * (6 + brain.skill * 6), 0, 1));
    const d = Math.sqrt(dist2(bot.pos.x, bot.pos.z, t.pos.x, t.pos.z));
    if (state.time > brain.strafeUntil) {
      brain.strafeDir = Math.random() < 0.5 ? -1 : 1;
      brain.strafeUntil = state.time + 0.5 + Math.random() * 0.9;
      brain.crouch = Math.random() < 0.25;
    }
    input.s = brain.strafeDir * 0.6;
    input.crouch = brain.crouch && d > 10;
    input.ads = d > 14;
    // Fire in bursts: high skill = longer bursts, shorter pauses.
    const gun = bot.weapons[bot.slot];
    if (gun && gun.mag > 0 && state.time >= brain.nextShotAt) {
      if (brain.burstLeft <= 0) {
        brain.burstLeft = 2 + Math.floor(rng() * (2 + brain.skill * 5));
        brain.nextShotAt = state.time + 0.25 + rng() * 0.45 * (1 - brain.skill * 0.5);
      } else {
        const aimErr = (1 - brain.skill) * 0.05 + 0.008;
        const dir = aimAt(bot, t, aimErr);
        const res = fireShot(state, world, bot, dir.x, dir.y, dir.z, input.ads);
        brain.burstLeft -= 1;
        if (gun.mag === 0) { bot.weapons[bot.slot].reloading = gun.def.reload; }
        if (res === 'kill') radio(state, bot, 'Got one — ' + t.name + ' down.');
      }
    }
    // A bot that sees 2+ enemies grouped close may lob a frag at them.
    if (!brain.threwGrenade && bot.grenades.frag > 0 && targetD < 20 && countNearbyEnemies(state, bot, 9) >= 2) {
      throwGrenade(state, bot, 'frag');
      brain.threwGrenade = true;
      radio(state, bot, 'Frag out!');
    }
  } else {
    // No target: follow the role's movement.
    switch (brain.state) {
      case 'route': case 'retake': case 'guard': {
        followPath(state, bot, input, dt);
        break;
      }
      case 'hold': {
        // Sit on the hold, scan the lane: slow yaw sweep.
        if (brain.holdPos) {
          const n = state.map.nodes[brain.holdPos.node];
          bot.yaw = angleLerp(bot.yaw, brain.holdPos.yaw + Math.sin(state.time * 0.5 + bot.id) * 0.5, dt * 2);
          const dx = n.x - bot.pos.x, dz = n.z - bot.pos.z;
          if (dx * dx + dz * dz > 1) { input.f = 1; bot.yaw = Math.atan2(-dx, -dz); }
        } else {
          bot.yaw += dt * 0.35; // no assigned hold: keep scanning
        }
        input.crouch = Math.random() < 0.02;
        break;
      }
      case 'plant': {
        const res = tryPlant(state, bot, dt);
        if (res === 'planted') { brain.state = 'guard'; radio(state, bot, 'Spike planted — hold the site!'); }
        else if (res === false) { brain.state = 'route'; brain.path = planRoute(state, bot, siteNode(state, brain.site)); brain.node = 0; }
        break;
      }
      case 'defuse': {
        const res = tryDefuse(state, bot, dt);
        if (res === 'defused') brain.state = 'hold';
        else if (res === false) { brain.state = 'retake'; }
        break;
      }
      case 'investigate': {
        if (brain.investigate) {
          const dx = brain.investigate.x - bot.pos.x, dz = brain.investigate.z - bot.pos.z;
          if (dx * dx + dz * dz < 2.5) { brain.investigate = null; brain.state = bot.team === 'B' ? 'hold' : 'route'; }
          else { input.f = 1; bot.yaw = angleLerp(bot.yaw, Math.atan2(-dx, -dz), dt * 4); }
        }
        break;
      }
      default: followPath(state, bot, input, dt);
    }
    // Smoke the site entrance when a teammate is about to plant.
    if (bot.team === 'A' && bot.grenades.smoke > 0 && !brain.threwGrenade) {
      const planter = state.actors.find(a => a.team === 'A' && a.hasSpike && a !== bot);
      if (planter && siteOf(state, planter)) {
        const site = state.map.sites[siteOf(state, planter)];
        const d = Math.sqrt(dist2(bot.pos.x, bot.pos.z, site.x, site.z));
        if (d < 16) { throwGrenade(state, bot, 'smoke'); brain.threwGrenade = true; radio(state, bot, 'Smoking ' + siteOf(state, planter) + ' — plant now!'); }
      }
    }
  }
  // Retake arrival: start defusing when on the planted site.
  if (brain.state === 'retake' && bomb.state === 'planted' && dist2(bot.pos.x, bot.pos.z, bomb.x, bomb.z) < 2.2 * 2.2) {
    brain.state = 'defuse';
  }
  moveActor(bot, input, dt, world.colliders);
  // Stuck detection: if the bot barely moved for 2 s, re-path around the block.
  const moved = Math.hypot(bot.pos.x - (brain.stuckPos?.x ?? bot.pos.x), bot.pos.z - (brain.stuckPos?.z ?? bot.pos.z));
  if (state.time - brain.stuckAt > 2) {
    if (moved < 0.6 && (brain.state === 'route' || brain.state === 'retake' || brain.state === 'guard')) {
      const goal = brain.path[brain.path.length - 1] ?? nearestNode(state.map, bot.pos.x, bot.pos.z);
      brain.path = findPath(state.map, nearestNode(state.map, bot.pos.x, bot.pos.z), goal);
      brain.node = 0;
    }
    brain.stuckAt = state.time; brain.stuckPos = { x: bot.pos.x, z: bot.pos.z };
  }
}

function followPath(state, bot, input, dt) {
  const brain = bot.bot;
  if (!brain.path || brain.node >= brain.path.length) {
    if (brain.state === 'route') { brain.state = bot.team === 'A' ? 'hold' : 'hold'; }
    return;
  }
  const n = state.map.nodes[brain.path[brain.node]];
  const dx = n.x - bot.pos.x, dz = n.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) { brain.node += 1; return; }
  const wantYaw = Math.atan2(-dx, -dz);
  bot.yaw = angleLerp(bot.yaw, wantYaw, clamp(dt * 5, 0, 1));
  input.f = 1;
  // Crouch-walk the last stretch into a site: quieter, harder to spot.
  const site = state.map.sites[brain.site] || state.map.sites.A;
  if (bot.team === 'A' && dist2(bot.pos.x, bot.pos.z, site.x, site.z) < 100) input.crouch = true;
}

// Aim at a target with skill-based error, preferring the head at close range.
function aimAt(bot, target, err) {
  const headY = 1.55, bodyY = 0.95;
  const aimHead = Math.random() < 0.22 + bot.bot.skill * 0.25;
  const ty = aimHead ? headY : bodyY;
  const dx = target.pos.x - bot.pos.x, dy = ty - eyeHeight(bot), dz = target.pos.z - bot.pos.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  return {
    x: dx / d + (Math.random() - 0.5) * 2 * err,
    y: dy / d + (Math.random() - 0.5) * 2 * err,
    z: dz / d + (Math.random() - 0.5) * 2 * err,
  };
}

function countNearbyEnemies(state, bot, radius) {
  let n = 0;
  for (const a of state.actors) {
    if (a.team !== bot.team && a.alive && dist2(a.pos.x, a.pos.z, bot.pos.x, bot.pos.z) < radius * radius) n++;
  }
  return n;
}

function radio(state, bot, text) {
  if (state.time - bot.bot.radioAt < 4) return;
  bot.bot.radioAt = state.time;
  state.radio.push({ team: bot.team, name: bot.name, text, t: state.time });
  if (state.radio.length > 5) state.radio.shift();
}

export { BOT_NAMES_A, BOT_NAMES_B };
