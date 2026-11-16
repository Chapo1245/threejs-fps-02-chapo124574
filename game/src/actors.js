// actors.js — movement physics and actor lifecycle. One place owns how bodies
// move: acceleration, friction, crouch, jump, and AABB collision. Bots and the
// human player share exactly this code, so a bot's duel is a fair duel.
import { PLAYER_RADIUS, PLAYER_HEIGHT, CROUCH_HEIGHT, EYE_STAND, EYE_CROUCH, clamp } from './state.js';
import { collideCircle } from './world.js';

const WALK_SPEED = 5.6;      // m/s sprint-ish run
const CROUCH_SPEED = 2.6;
const ADS_SPEED = 3.4;
const ACCEL = 42;            // m/s^2 — snappy but not instant (stopping to aim pays)
const FRICTION = 11;         // ground decel when no input
const AIR_ACCEL = 9;
const JUMP_VEL = 5.2;
const GRAVITY = 14;

// Move one actor for dt seconds. input: {f, s, jump, crouch, ads, sprint}
// (f/s are -1..1 strafe axes in actor space). Returns nothing; mutates actor.
export function moveActor(actor, input, dt, colliders) {
  if (!actor.alive) return;
  const speedCap = actor.crouch ? CROUCH_SPEED : input.ads ? ADS_SPEED : WALK_SPEED;
  const sy = Math.sin(actor.yaw), cy = Math.cos(actor.yaw);
  // Forward is -z rotated by yaw: forward = (-sin yaw, -cos yaw).
  const wishX = (-sy * input.f + cy * input.s) * speedCap;
  const wishZ = (-cy * input.f - sy * input.s) * speedCap;
  const accel = actor.onGround ? ACCEL : AIR_ACCEL;
  actor.vel.x += clamp(wishX - actor.vel.x, -accel * dt, accel * dt);
  actor.vel.z += clamp(wishZ - actor.vel.z, -accel * dt, accel * dt);
  if (actor.onGround && input.f === 0 && input.s === 0) {
    const fr = Math.max(0, 1 - FRICTION * dt);
    actor.vel.x *= fr; actor.vel.z *= fr;
  }
  if (input.jump && actor.onGround) { actor.onGround = false; actor.velY = JUMP_VEL; }
  if (!actor.onGround) {
    actor.velY = (actor.velY || 0) - GRAVITY * dt;
    actor.pos.y += actor.velY * dt;
    if (actor.pos.y <= 0) { actor.pos.y = 0; actor.velY = 0; actor.onGround = true; }
  }
  const solved = collideCircle(colliders, actor.pos.x + actor.vel.x * dt, actor.pos.z + actor.vel.z * dt, PLAYER_RADIUS);
  actor.pos.x = solved.x; actor.pos.z = solved.z;
  // Map bounds clamp (the perimeter walls are colliders, this is a backstop).
  actor.pos.x = clamp(actor.pos.x, -31.5, 31.5);
  actor.pos.z = clamp(actor.pos.z, -23.5, 23.5);
  const planar = Math.hypot(actor.vel.x, actor.vel.z);
  actor.moveMag = clamp(planar / WALK_SPEED, 0, 1);
  actor.crouch = !!input.crouch;
}

export function eyeHeight(actor) { return actor.crouch ? EYE_CROUCH : EYE_STAND; }
export function bodyHeight(actor) { return actor.crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT; }

// Hit test: ray origin + dir vs an actor's head sphere (r 0.22 at eye-0.12) and
// body capsule approximated by a vertical segment with radius 0.42. Returns
// {hit, head, dist} — headshots pay more (weapons.shotDamage).
export function rayHitActor(ox, oy, oz, dx, dy, dz, actor, maxDist) {
  if (!actor.alive) return { hit: false };
  const h = bodyHeight(actor);
  const headY = h - 0.14;
  const head = raySphere(ox, oy, oz, dx, dy, dz, actor.pos.x, headY, actor.pos.z, 0.24, maxDist);
  const body = rayCapsule(ox, oy, oz, dx, dy, dz, actor.pos.x, 0.25, actor.pos.z, actor.pos.x, h - 0.3, actor.pos.z, 0.44, maxDist);
  if (head.hit && (!body.hit || head.dist <= body.dist)) return { hit: true, head: true, dist: head.dist };
  if (body.hit) return { hit: true, head: false, dist: body.dist };
  return { hit: false };
}
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return { hit: false };
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return { hit: false };
  const t = tca - Math.sqrt(r * r - d2);
  return t <= maxDist ? { hit: true, dist: Math.max(0, t) } : { hit: false };
}
function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r, maxDist) {
  // Capsule with a vertical axis: closest approach of the ray to the segment.
  // Solved by sampling the segment in 5 steps — exact enough at these ranges,
  // and it keeps the hot loop allocation-free.
  let best = Infinity;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, pz = az + (bz - az) * t;
    const lx = px - ox, ly = py - oy, lz = pz - oz;
    const tca = lx * dx + ly * dy + lz * dz;
    if (tca < 0) continue;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > r * r) continue;
    const hit = tca - Math.sqrt(r * r - d2);
    if (hit < best) best = hit;
  }
  return best <= maxDist ? { hit: true, dist: Math.max(0, best) } : { hit: false };
}

// Apply damage; returns true if the hit killed. Armor absorbs half (already in
// shotDamage); armor points drain 1:1 with the absorbed part.
export function damageActor(target, dmg, from) {
  if (!target.alive) return false;
  target.hp -= dmg;
  target.lastDamageFrom = from; target.lastDamageAt = Date.now();
  if (target.armor > 0) target.armor = Math.max(0, target.armor - dmg * 0.5);
  if (target.hp <= 0) { target.hp = 0; target.alive = false; target.deaths += 1; return true; }
  return false;
}
