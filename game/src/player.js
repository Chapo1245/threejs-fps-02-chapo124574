// player.js — human input: keyboard + mouse on desktop, virtual joystick
// + touch buttons on touch devices. Reads raw events, writes intents onto
// the player actor (moveX/moveZ in world space, yaw/pitch, firing, sprint,
// planting/defusing, reload/buy/grenade queues). The simulation reads the
// intents; this module never moves the actor itself.

import { S, player, buyItem } from './sim.js';
import { WEAPONS, equipWeapon, refillWeapon, shoot, startReload, throwGrenade } from './combat.js';
import { touch } from './touch.js';
import { isBuyOpen } from './hud.js';
import { MAP } from './mapdata.js';

const keys = {};
let mouseDX = 0, mouseDY = 0;
let firing = false, adsHeld = false;
let prevFire = false;
let ui = null;

export function initPlayer(canvas, uiHooks) {
  ui = uiHooks;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    // With the buy menu open, number keys buy items (hud.js handles them).
    if (isBuyOpen() && /^Digit[1-8]$/.test(e.code)) return;
    if (e.code === 'KeyR') startReload(player());
    if (e.code === 'KeyB') ui.toggleBuy();
    if (e.code === 'KeyG') cycleGrenade();
    if (e.code === 'Digit1') equipSlot(0);
    if (e.code === 'Digit2') equipSlot(1);
    if (e.code === 'Digit3') cycleGrenadeType();
    if (e.code === 'Space') { player().jumpQueued = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  canvas.addEventListener('click', () => {
    if (!touch.active && S.phase !== 'menu' && document.pointerLockElement !== canvas) {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      mouseDX += e.movementX; mouseDY += e.movementY;
    }
  });
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) firing = true;
    if (e.button === 2) adsHeld = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) adsHeld = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) { firing = false; adsHeld = false; }
  });
}

// Owned weapon slots: 1 = sidearm, 2 = primary. Buying a primary replaces
// the one in slot 2 (Counter-Strike style).
function ownedSlots() {
  const p = player();
  const slots = ['p9'];
  if (p.weapon !== 'p9') slots.push(p.weapon);
  else if (p.ammoBag) {
    for (const k of Object.keys(p.ammoBag)) if (k !== 'p9') slots.push(k);
  }
  return slots;
}
function equipSlot(i) {
  const slots = ownedSlots();
  if (slots[i]) equipWeapon(player(), slots[i]);
}
function cycleGrenade() {
  const p = player();
  const types = ['frag', 'smoke', 'flash'];
  const cur = types.indexOf(p.grenadeSel);
  for (let n = 1; n <= 3; n++) {
    const t = types[(cur + n) % 3];
    if ((p.grenades[t] || 0) > 0) { p.grenadeSel = t; return; }
  }
}
function cycleGrenadeType() { cycleGrenade(); }

// Called once per rendered frame, before the fixed-step simulation.
export function readPlayerInput() {
  const p = player();
  if (!p.alive || S.phase === 'menu' || S.phase === 'matchend') {
    p.moveX = 0; p.moveZ = 0;
    return;
  }
  // --- look ---
  const sens = 0.0023;
  p.yaw -= mouseDX * sens;
  p.pitch -= mouseDY * sens;
  mouseDX = 0; mouseDY = 0;
  if (touch.active) {
    p.yaw -= touch.lookDX * 0.0042;
    p.pitch -= touch.lookDY * 0.0042;
    touch.lookDX = 0; touch.lookDY = 0;
  }
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));

  // --- move: keyboard, or the touch joystick when it is held ---
  let iy = 0, ix = 0;
  if (keys.KeyW || keys.ArrowUp) iy += 1;
  if (keys.KeyS || keys.ArrowDown) iy -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (touch.active && Math.hypot(touch.moveX, touch.moveY) > 0.12) {
    ix = touch.moveX;
    iy = -touch.moveY; // joystick up = forward
  }
  const len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; }
  const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
  const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
  p.moveX = fx * iy + rx * ix;
  p.moveZ = fz * iy + rz * ix;

  p.sprint = !!(keys.ShiftLeft || keys.ShiftRight) || touch.sprint;
  p.crouch = !!(keys.KeyC || keys.ControlLeft);
  p.ads = adsHeld && !touch.active;
  if (touch.jumpQueued) { p.jumpQueued = true; touch.jumpQueued = false; }
  if (touch.reloadQueued) { startReload(p); touch.reloadQueued = false; }
  if (touch.buyQueued) { ui.toggleBuy(); touch.buyQueued = false; }
  if (touch.grenadeQueued) { throwGrenade(p, p.grenadeSel); touch.grenadeQueued = false; }

  // --- fire: mouse held, or the touch FIRE button held ---
  const wantFire = firing || touch.firing;
  const w = WEAPONS[p.weapon];
  if (wantFire && S.phase === 'live') {
    if (w.auto) shoot(p);
    else if (!prevFire) shoot(p);
  }
  prevFire = wantFire;

  // --- plant / defuse: hold E, or hold the touch INTERACT button ---
  const interact = !!(keys.KeyE) || touch.interact;
  p.planting = false; p.defusing = false;
  if (interact && S.phase === 'live') {
    if (p.hasBomb) {
      const site = MAP.sites[S.targetSite];
      if (p.x >= site.x0 && p.x <= site.x1 && p.z >= site.z0 && p.z <= site.z1) {
        p.planting = true;
      }
    } else if (S.bomb.state === 'planted') {
      const d2 = (p.x - S.bomb.x) ** 2 + (p.z - S.bomb.z) ** 2;
      if (d2 < 2.6) p.defusing = true;
    }
  }
}

// The buy menu calls this when the player clicks an item.
export function buyKey(key) {
  const p = player();
  if (key === 'kevlar' || key === 'frag' || key === 'smoke' || key === 'flash') {
    return buyItem(key);
  }
  const ok = buyItem(key);
  if (ok) {
    equipWeapon(p, key);
    refillWeapon(p, key);
  }
  return ok;
}
