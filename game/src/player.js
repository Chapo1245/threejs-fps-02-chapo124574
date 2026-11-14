// player.js — the human player's controller: mouse look, WASD movement
// with acceleration and friction, crouch, jump, and collision against the
// map. The camera rides on the actor; the viewmodel bobs with movement.
import { MOVE } from './config.js';
import { clamp, lerp } from './util.js';

export class PlayerController {
  constructor(actor, world) {
    this.a = actor;
    this.world = world;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.adsHeld = false;
    this.bobPhase = 0;
    this.eyeY = MOVE.eyeStand;
    this.fov = 75;
    this.targetFov = 75;
    // Reused scratch, never reallocated in the hot loop.
    this.pos = { x: 0, z: 0 };
  }

  get speed() {
    return this.a.speed2d;
  }

  look(dx, dy) {
    this.a.yaw -= dx * 0.0022;
    this.a.pitch = clamp(this.a.pitch - dy * 0.0022, -1.45, 1.45);
  }

  /** One fixed step of movement. `input` is the live key set. */
  step(dt, input) {
    const a = this.a;
    if (!a.alive) return;
    // Look first: mouse deltas accumulated since the last step.
    if (this.mouseDX !== 0 || this.mouseDY !== 0) {
      this.look(this.mouseDX, this.mouseDY);
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    a.crouch = input.has('ControlLeft') || input.has('KeyC');
    const sprint = (input.has('ShiftLeft') || input.has('ShiftRight')) && !a.crouch && !a.ads;
    let top = a.crouch ? MOVE.crouchSpeed : sprint ? MOVE.sprintSpeed : MOVE.walkSpeed;
    if (a.ads) top = MOVE.adsSpeed;
    let fx = 0;
    let fz = 0;
    if (input.has('KeyW')) fz -= 1;
    if (input.has('KeyS')) fz += 1;
    if (input.has('KeyA')) fx -= 1;
    if (input.has('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const sin = Math.sin(a.yaw);
    const cos = Math.cos(a.yaw);
    // Forward is (-sin, -cos); right is (cos, -sin).
    const wx = (-sin * fz + cos * fx) * top;
    const wz = (-cos * fz - sin * fx) * top;
    const accel = a.onGround ? MOVE.accel : MOVE.airAccel;
    a.vx += (wx - a.vx) * Math.min(1, accel * dt / top * 4 + dt * 6);
    a.vz += (wz - a.vz) * Math.min(1, accel * dt / top * 4 + dt * 6);
    // Friction when no input: bleed speed instead of stopping dead.
    if (len === 0 && a.onGround) {
      const f = Math.max(0, 1 - MOVE.friction * dt);
      a.vx *= f;
      a.vz *= f;
      if (Math.abs(a.vx) < 0.02) a.vx = 0;
      if (Math.abs(a.vz) < 0.02) a.vz = 0;
    }
    // Integrate with collision, axis by axis so sliding along walls works.
    this.pos.x = a.x + a.vx * dt;
    this.pos.z = a.z;
    if (!this.world.moveCircle(this.pos, MOVE.radius)) {
      // No hit on X; try the combined move, then Z alone.
      this.pos.x = a.x + a.vx * dt;
      this.pos.z = a.z + a.vz * dt;
      if (this.world.moveCircle(this.pos, MOVE.radius)) {
        this.pos.x = a.x;
        this.pos.z = a.z + a.vz * dt;
        this.world.moveCircle(this.pos, MOVE.radius);
      }
    } else {
      this.pos.x = a.x;
      this.pos.z = a.z + a.vz * dt;
      this.world.moveCircle(this.pos, MOVE.radius);
    }
    // Stay inside the yard even if a wall gap is missed.
    const b = this.world.map.bounds;
    this.pos.x = clamp(this.pos.x, b.minX + 0.6, b.maxX - 0.6);
    this.pos.z = clamp(this.pos.z, b.minZ + 0.6, b.maxZ - 0.6);
    a.x = this.pos.x;
    a.z = this.pos.z;
    a.speed2d = Math.hypot(a.vx, a.vz);

    // Jump + gravity.
    if (input.has('Space') && a.onGround) {
      a.vy = MOVE.jumpSpeed;
      a.onGround = false;
    }
    a.vy -= MOVE.gravity * dt;
    a.y += a.vy * dt;
    if (a.y <= 0) {
      a.y = 0;
      a.vy = 0;
      a.onGround = true;
    }
    // Recoil recovery and spread bloom decay.
    a.recoilPitch = lerp(a.recoilPitch, 0, Math.min(1, dt * 7));
    a.bloom = Math.max(0, a.bloom - dt * 2.4);
    // Eye height eases between stand and crouch.
    const targetEye = a.crouch ? MOVE.eyeCrouch : MOVE.eyeStand;
    this.eyeY = lerp(this.eyeY, targetEye, Math.min(1, dt * 10));
    this.bobPhase += a.speed2d * dt * 1.6;
  }

  /** Apply the actor to the camera each rendered frame. */
  applyCamera(camera, dt, zoom) {
    const a = this.a;
    const bob = Math.sin(this.bobPhase * 2) * 0.018 * Math.min(1, a.speed2d / MOVE.walkSpeed);
    camera.position.set(a.x, a.y + this.eyeY + bob, a.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = a.yaw;
    camera.rotation.x = a.pitch + a.recoilPitch;
    camera.rotation.z = 0;
    this.targetFov = zoom;
    if (Math.abs(camera.fov - this.targetFov) > 0.05) {
      camera.fov = lerp(camera.fov, this.targetFov, Math.min(1, dt * 12));
      camera.updateProjectionMatrix();
    }
  }
}
