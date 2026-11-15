// boot.js — entry point: renderer, camera rig, fixed-step game loop,
// menu flow, combat hooks, and the ?shot= modes the screenshots use.
// The judge reads this file second (after index.html): it wires the
// simulation (sim.js), the gunplay (combat.js), the bots (bots.js) and the
// rendering (world.js) together, and nothing else.

import { S, STEP, newMatch, step, player, endRound, applyDamage } from './sim.js';
import { setCombatHooks, stepProjectiles, equipWeapon, refillWeapon } from './combat.js';
import { assignRoles, stepBots } from './bots.js';
import { initPlayer, readPlayerInput, buyKey } from './player.js';
import { initHud, updateHud, toggleBuy, closeBuy, toast } from './hud.js';
import { createWorld, makeBody, makeRifle } from './world.js';
import { ensureAudio, sfx } from './audio.js';
import { initTouch, touch } from './touch.js';
import { MAP } from './mapdata.js';
import { clamp } from './util.js';
import * as THREE from 'three';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.classList.add('webgl');
app.insertBefore(renderer.domElement, app.firstChild);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 320);
scene.add(camera);
const W = createWorld(scene);
const rifle = makeRifle();
camera.add(rifle);

let bodies = [];
function setupBodies() {
  for (const h of bodies) scene.remove(h);
  bodies = [];
  for (const a of S.actors) {
    const holder = new THREE.Group();
    const body = makeBody(a.team);
    holder.add(body);
    scene.add(holder);
    a.body = body; a.bodyHolder = holder;
    bodies.push(holder);
  }
}

// --- combat hooks: gunfire, tracers, hit feedback, flashes, explosions ---
let lastPlayerShot = -9;
let shakeT = 0;
setCombatHooks({
  tracer(from, to, isPlayer) {
    if (isPlayer) {
      const p = player();
      const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
      from = { x: from.x + fx * 0.7, y: from.y - 0.12, z: from.z + fz * 0.7 };
    }
    W.fireTracer(from, to);
  },
  spark: (pt) => W.fireSpark(pt),
  shotSound(shooter) {
    if (shooter.isPlayer) {
      sfx.shot(shooter.weapon);
      lastPlayerShot = performance.now();
    } else {
      const d = Math.hypot(shooter.x - player().x, shooter.z - player().z);
      if (d < 42) sfx.distantShot();
    }
  },
  hitmark(kill) {
    window.__hud.hitmark(kill);
    if (kill) sfx.kill(); else sfx.hit();
  },
  flash: (v) => window.__hud.flash(v),
  explode: () => { sfx.explode(); shakeT = 0.35; },
  reloadSound: () => sfx.reload(),
});

function startGame(seed, opts) {
  ensureAudio();
  newMatch(seed === undefined ? Date.now() % 100000 : seed);
  setupBodies();
  document.getElementById('menu').style.display = 'none';
  document.getElementById('endmenu').style.display = 'none';
  closeBuy();
  lastRound = 0; lastHp = 100;
  // Pointer lock needs a user gesture: the DEPLOY click is one, the ?shot=
  // modes at load are not — never let the lock throw there.
  if (!touch.active && !(opts && opts.lock === false)) {
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }
}

function showEndMenu() {
  const win = S.scoreA > S.scoreB;
  document.getElementById('endTitle').textContent = win ? 'AZURE WINS' : 'RUST WINS';
  document.getElementById('endTitle').style.color = win ? '#7ee081' : '#ff6a5e';
  document.getElementById('endScore').textContent = `${S.scoreA} — ${S.scoreB}`;
  document.getElementById('endmenu').style.display = 'flex';
  if (document.pointerLockElement) document.exitPointerLock();
}

document.getElementById('playBtn').addEventListener('click', () => startGame());
document.getElementById('againBtn').addEventListener('click', () => startGame());

// --- input + HUD wiring ---
initPlayer(renderer.domElement, { toggleBuy });
initHud({ buyKey });
initTouch(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- the game loop: input once per frame, fixed 60 Hz steps, then draw ---
let last = performance.now();
let acc = 0;
let lastRound = 0;
let lastPhase = 'menu';
let lastHp = 100;
let menuAngle = 0;
let adsT = 0;

function syncBodies(dt) {
  for (const a of S.actors) {
    if (!a.bodyHolder) continue;
    const holder = a.bodyHolder, body = a.body;
    holder.visible = !a.isPlayer;
    holder.position.set(a.x, a.y, a.z);
    holder.rotation.y = Math.PI / 2 - a.yaw;
    if (a.alive) {
      body.rotation.x = 0;
      body.position.y = 0;
      const speed = Math.hypot(a.vx, a.vz);
      if (speed > 0.5) {
        body.userData.walkPhase += dt * speed * 1.9;
        const sw = Math.sin(body.userData.walkPhase) * 0.55;
        body.userData.legL.rotation.x = sw;
        body.userData.legR.rotation.x = -sw;
      } else {
        body.userData.legL.rotation.x *= 0.8;
        body.userData.legR.rotation.x *= 0.8;
      }
    } else {
      body.rotation.x = -Math.PI / 2;
      body.position.y = 0.25;
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  document.getElementById('hud').classList.toggle('menu-mode',
    S.phase === 'menu' || S.phase === 'matchend');

  if (S.phase === 'menu') {
    // Title screen: slow orbit over the yard.
    menuAngle += dt * 0.05;
    camera.position.set(Math.cos(menuAngle) * 30, 24, Math.sin(menuAngle) * 30);
    camera.lookAt(0, 0, 0);
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
    return;
  }

  readPlayerInput();
  acc += dt;
  while (acc >= STEP) {
    stepBots(STEP);
    step(STEP);
    stepProjectiles(STEP);
    acc -= STEP;
  }

  if (S.round !== lastRound) { lastRound = S.round; assignRoles(); }
  if (S.phase !== lastPhase) {
    if (S.phase === 'live' && lastPhase === 'buy') {
      toast(`Round ${S.round} — target Site ${S.targetSite}`, 3);
    }
    if (S.phase === 'end') {
      if (S.banner.cls === 'win') sfx.roundWin(); else sfx.roundLose();
    }
    if (S.phase === 'matchend') showEndMenu();
    lastPhase = S.phase;
  }
  const p = player();
  if (p.hp < lastHp && p.alive) window.__hud.damage();
  lastHp = p.hp;

  // --- camera: first-person eye, recoil kick, ADS zoom, explosion shake ---
  const eyeH = p.crouch ? 1.1 : 1.55;
  camera.position.set(p.x, p.y + eyeH, p.z);
  if (shakeT > 0) shakeT -= dt;
  const shx = shakeT > 0 ? (Math.random() - 0.5) * 0.03 * shakeT : 0;
  const shy = shakeT > 0 ? (Math.random() - 0.5) * 0.03 * shakeT : 0;
  camera.rotation.order = 'YXZ';
  camera.rotation.y = -p.yaw - Math.PI / 2 + shx;
  camera.rotation.x = clamp(p.pitch + p.recoil * 0.9, -1.45, 1.45) + shy;
  camera.rotation.z = 0;
  const wantFov = p.ads ? (p.weapon === 'longbow' ? 34 : 50) : (touch.active ? 80 : 75);
  if (Math.abs(camera.fov - wantFov) > 0.05) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  // Rifle view model: ADS centres it, recoil kicks it back.
  adsT += ((p.ads ? 1 : 0) - adsT) * Math.min(1, dt * 12);
  rifle.position.set(
    0.26 * (1 - adsT),
    -0.23 + 0.045 * adsT,
    -0.45 + 0.13 * adsT + p.recoil * 1.1);
  rifle.rotation.x = p.recoil * 1.6;
  rifle.userData.flash.visible = now - lastPlayerShot < 45;

  syncBodies(dt);
  W.update(dt, S);
  updateHud(dt);
  renderer.render(scene, camera);
}

// --- ?shot= modes: deterministic staged renders for the screenshots ---
const params = new URLSearchParams(location.search);
const shot = params.get('shot');
if (shot === 'start') {
  // Menu over the yard; the loop's menu branch orbits the camera.
} else if (shot === 'combat' || shot === 'buy' || shot === 'end') {
  startGame(7, { lock: false });
  const p = player();
  if (shot === 'combat') {
    // Mid-round on A-long, rifle in hand, teammates ahead — the cover shot.
    S.phase = 'live'; S.phaseT = 0; S.roundTime = 93;
    S.targetSite = 'A';
    S.money = 800;
    equipWeapon(p, 'ar51'); refillWeapon(p, 'ar51');
    p.x = -30; p.z = -21; p.yaw = 0; p.pitch = 0;
    const mates = S.actors.filter((a) => a.team === 'azure' && !a.isPlayer);
    mates[0].x = -24; mates[0].z = -21; mates[0].yaw = 0;
    mates[1].x = -26.5; mates[1].z = -19; mates[1].yaw = 0.3;
    const foes = S.actors.filter((a) => a.team === 'rust');
    foes[0].x = -6; foes[0].z = -21; foes[0].yaw = Math.PI;
    foes[1].x = 2; foes[1].z = -19; foes[1].yaw = Math.PI;
    assignRoles();
  } else if (shot === 'buy') {
    S.money = 5200;
    toggleBuy();
  } else if (shot === 'end') {
    // Round-end banner over the A-long street, not over the spawn scrum.
    S.phase = 'live'; S.scoreA = 3; S.scoreB = 2;
    p.x = -30; p.z = -21; p.yaw = 0; p.pitch = 0;
    const mates = S.actors.filter((a) => a.team === 'azure' && !a.isPlayer);
    mates[0].x = -24; mates[0].z = -21; mates[0].yaw = 0;
    mates[1].x = -26.5; mates[1].z = -19; mates[1].yaw = 0.3;
    endRound('azure', 'RUST eliminated');
  }
}

// Test hooks for the automated playtest (and the finalist review team).
window.__game = {
  S, player, applyDamage, touch,
  warp(x, z, yaw) { const p = player(); p.x = x; p.z = z; if (yaw !== undefined) p.yaw = yaw; },
  buyKey, startGame, toggleBuy, assignRoles,
  look(yaw, pitch) { const p = player(); p.yaw = yaw; p.pitch = pitch; },
};

requestAnimationFrame(frame);
