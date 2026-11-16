// player.js — first-person movement: acceleration, friction, crouch,
// jump, gravity, and AABB collision. Fixed step only; no rendering.
// Stopping to aim pays: spread grows with speed (see weapons.js).

import { clamp } from './state.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.08;
const RADIUS = 0.38;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.6;
const ACCEL = 42;
const FRICTION = 11;
const JUMP_VEL = 5.4;
const GRAVITY = 14.5;

export class Player {
  constructor(world, spawn) {
    this.world = world;
    this.pos = { x: spawn.x, y: 0, z: spawn.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.crouched = false;
    this.onGround = true;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.eye = EYE_STAND;
    this.moveMag = 0;   // 0..1, how hard the player is moving (drives spread)
    this.stepAcc = 0;
  }

  reset(spawn) {
    this.pos.x = spawn.x; this.pos.y = 0; this.pos.z = spawn.z;
    this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
    this.yaw = spawn.yaw; this.pitch = 0;
    this.crouched = false; this.onGround = true;
    this.hp = 100; this.armor = 0; this.alive = true;
    this.eye = EYE_STAND;
  }

  eyePos(out) {
    out.x = this.pos.x; out.y = this.eye; out.z = this.pos.z;
    return out;
  }

  // input: {f, b, l, r, jump, crouch, walk} in -1..1 / booleans
  step(dt, input) {
    if (!this.alive) return;
    const targetEye = this.crouched ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);
    const speed = this.crouched ? CROUCH_SPEED : WALK_SPEED;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward is -Z rotated by yaw; right is +X rotated by yaw.
    let mx = (-sin) * input.f + cos * input.r;
    let mz = (-cos) * input.f + (-sin) * input.r;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const wish = input.walk ? 0.45 : 1;
    const tx = mx * speed * wish, tz = mz * speed * wish;
    // Accelerate toward wish velocity; friction when no input.
    const k = ml > 0.01 ? ACCEL * dt : FRICTION * dt;
    this.vel.x += clamp(tx - this.vel.x, -k, k);
    this.vel.z += clamp(tz - this.vel.z, -k, k);
    if (ml <= 0.01) {
      // extra damping so stopping is crisp
      this.vel.x *= Math.max(0, 1 - FRICTION * dt * 0.6);
      this.vel.z *= Math.max(0, 1 - FRICTION * dt * 0.6);
    }
    if (input.jump && this.onGround) {
      this.vel.y = JUMP_VEL;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    this.world.collideCircle(this.pos, RADIUS);
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.moveMag = clamp(planar / WALK_SPEED, 0, 1);
    this.stepAcc += planar * dt;
    if (this.stepAcc > 2.2 && this.onGround && planar > 1) {
      this.stepAcc = 0;
      return true; // footstep tick
    }
    return false;
  }

  // Damage with armor absorbing half until it breaks.
  damage(amount) {
    if (!this.alive) return 0;
    let remaining = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.5);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    this.hp -= remaining;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return remaining;
  }

  heal(amount) {
    this.hp = Math.min(100, this.hp + amount);
  }
}
