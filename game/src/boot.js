// boot.js — entry point. Wires the renderer, input, the fixed-step loop
// and the shot modes together. The simulation runs at a fixed 60 Hz and
// never allocates in its hot loops; rendering reads the state each frame.
//
// URL parameters (for testing and screenshots):
//   ?shot=start|play|buy|end   stage a moment for a screenshot
//   ?seed=N                    deterministic RNG seed (default 1)
//   ?ai=hold|push|mixed        bot profile override (default mixed)
import * as THREE from 'three';
import { TICK, WEAPONS, MOVE } from './config.js';
import { MAP } from './map.js';
import { createState, resetMatch, PHASE } from './state.js';
import { buildWorld } from './world.js';
import { PlayerController } from './player.js';
import { makeBrain } from './bots.js';
import { stepBot, syncBotMesh } from './bots.js';
import { startRound, stepRounds, nextRound } from './rounds.js';
import { fireWeapon, startReload, tickReload, currentSpread, giveWeapon, buyItem, throwGrenade } from './weapons.js';
import { fireShot, stepGrenades } from './combat.js';
import { Hud } from './hud.js';
import { SoundBank } from './audio.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 1) || 1;
const SHOT = params.get('shot') ?? '';
const AI_PROFILE = params.get('ai') ?? 'mixed';

const map = MAP;
const S = createState(SEED);
S.aiProfile = AI_PROFILE;

// --- renderer / scene ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 220);
const world = buildWorld(scene, map);

const hud = new Hud(S, map);
const sounds = new SoundBank();
const player = new PlayerController(null, world);

// --- match setup -----------------------------------------------------------
function buildActors() {
  resetMatch(S);
  // Brains for every bot: attackers push, defenders hold; ?ai forces one.
  for (const a of S.actors) {
    if (a.isPlayer) continue;
    const profile = AI_PROFILE === 'mixed' ? (a.team === 'V' ? 'push' : 'hold') : AI_PROFILE;
    a.brain = makeBrain(a, profile, a.team === 'V' ? 'A' : 'mid');
    a.mesh = world.createBotMesh(a.team);
    a.fallen = false;
  }
  player.a = S.player;
  S.player.ammoStore = { p9: { mag: 12, reserve: 36 } };
  S.player.owned = ['p9'];
  startRound(S, map, S.rng);
}

buildActors();

// Viewmodel gun, parented to the camera.
const viewmodel = world.createViewmodel();
camera.add(viewmodel);
scene.add(camera);

// Bomb prop: a small case with a blinking light, shown when planted/dropped.
const bombGroup = new THREE.Group();
const bombCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.28, 0.34),
  new THREE.MeshLambertMaterial({ color: 0x22262e }),
);
bombCase.castShadow = true;
bombGroup.add(bombCase);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xff2d2d }),
);
bombLight.position.set(0, 0.2, 0);
bombGroup.add(bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

// Grenade + smoke meshes, keyed by the live object (no per-frame search).
const grenadeMeshes = new Map();
const smokeMeshes = new Map();
const grenadeGeo = new THREE.SphereGeometry(0.12, 10, 8);
const grenadeMat = new THREE.MeshLambertMaterial({ color: 0x2e3430 });
const smokeGeo = new THREE.SphereGeometry(1, 14, 10);
const smokeMat = new THREE.MeshLambertMaterial({ color: 0x9aa2b0, transparent: true, opacity: 0.42, depthWrite: false });

// --- input -----------------------------------------------------------------
const keys = new Set();
let locked = false;
let dragging = false;
let firing = false;
let firePressed = false; // edge trigger for semi-auto weapons
let adsHeld = false;
let selectedGrenade = 'frag';
let matchStarted = false;

addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyB') toggleBuy();
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'Digit1') selectWeaponSlot(1);
  if (e.code === 'Digit2') selectWeaponSlot(2);
  if (e.code === 'Digit4') selectedGrenade = 'frag';
  if (e.code === 'Digit5') selectedGrenade = 'smoke';
  if (e.code === 'Digit6') selectedGrenade = 'flash';
  if (e.code === 'KeyQ') {
    selectedGrenade = selectedGrenade === 'frag' ? 'smoke' : selectedGrenade === 'smoke' ? 'flash' : 'frag';
  }
  if (e.code === 'KeyG') throwSelectedGrenade();
  if (e.code === 'Escape') hud.closeBuy();
  // Buy menu number keys.
  if ($('buy').classList.contains('on') && /^Digit[1-9]$/.test(e.code)) {
    const idx = Number(e.code.slice(5)) - 1;
    const items = document.querySelectorAll('#buygrid .buyitem');
    if (items[idx]) items[idx].click();
  }
});

addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

renderer.domElement.addEventListener('mousedown', (e) => {
  sounds.ensure();
  if (S.phase !== PHASE.LIVE && S.phase !== PHASE.BUY) return;
  if (!locked) {
    renderer.domElement.requestPointerLock();
    dragging = true;
    return;
  }
  if (e.button === 0) {
    firing = true;
    firePressed = true;
  } else if (e.button === 2) {
    adsHeld = true;
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
  if (e.button === 2) adsHeld = false;
  dragging = false;
});
addEventListener('mousemove', (e) => {
  if (locked) {
    player.mouseDX += e.movementX;
    player.mouseDY += e.movementY;
  } else if (dragging) {
    player.mouseDX += e.movementX;
    player.mouseDY += e.movementY;
  }
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && matchStarted && S.phase === PHASE.LIVE) {
    // Paused: show the menu overlay; play resumes without resetting.
    $('menu').classList.add('on');
    $('playBtn').textContent = 'RESUME';
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- buttons ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);

$('playBtn').onclick = () => {
  sounds.ensure();
  if (!matchStarted) {
    matchStarted = true;
    $('menu').classList.remove('on');
    hud.showHud(true);
    startRound(S, map, S.rng);
  } else {
    $('menu').classList.remove('on');
  }
  renderer.domElement.requestPointerLock();
};
$('buyClose').onclick = () => {
  hud.closeBuy();
  renderer.domElement.requestPointerLock();
};
$('nextBtn').onclick = () => {
  $('roundEnd').classList.remove('on');
  nextRound(S, map, S.rng);
  renderer.domElement.requestPointerLock();
};
$('againBtn').onclick = () => {
  $('matchEnd').classList.remove('on');
  nextRound(S, map, S.rng);
  renderer.domElement.requestPointerLock();
};

hud.onBuy = (id) => {
  if (buyItem(S.player, id)) {
    sounds.buy();
    if (WEAPONS[id]) {
      S.player.ammoStore[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      if (!S.player.owned.includes(id)) S.player.owned.push(id);
    }
  } else {
    sounds.tone(220, 0.08, 'square', 0.15);
  }
};

// --- player actions ----------------------------------------------------------
function saveAmmo(a) {
  a.ammoStore[a.weapon] = { mag: a.mag, reserve: a.reserve };
}

function selectWeaponSlot(slot) {
  const p = S.player;
  if (!p.alive || S.phase !== PHASE.LIVE) return;
  if (slot === 1) {
    // Primary: the most recent non-sidearm owned weapon.
    const prim = [...p.owned].reverse().find((id) => id !== 'p9');
    if (prim) switchToWeapon(prim);
  } else if (slot === 2) {
    switchToWeapon('p9');
  }
}

function switchToWeapon(id) {
  const p = S.player;
  if (p.weapon === id) return;
  saveAmmo(p);
  const saved = p.ammoStore[id];
  if (saved) {
    p.weapon = id;
    p.mag = saved.mag;
    p.reserve = saved.reserve;
    p.reloadingUntil = 0;
  } else {
    giveWeapon(p, id);
  }
  sounds.click();
}

function tryReload() {
  const p = S.player;
  if (p.alive && S.phase === PHASE.LIVE && startReload(p, S.time)) sounds.reload();
}

function toggleBuy() {
  if (S.phase !== PHASE.BUY) return;
  if ($('buy').classList.contains('on')) {
    hud.closeBuy();
  } else {
    hud.openBuy();
  }
}

function throwSelectedGrenade() {
  const p = S.player;
  if (!p.alive || S.phase !== PHASE.LIVE) return;
  const g = throwGrenade(p, selectedGrenade, S.time);
  if (!g) return;
  liveGrenades.push(g);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.set(g.x, g.y, g.z);
  scene.add(mesh);
  grenadeMeshes.set(g, mesh);
  sounds.tone(700, 0.06, 'square', 0.15);
}

const liveGrenades = [];

// --- shot staging (deterministic screenshots) -------------------------------
function stageShot() {
  if (!SHOT) return; // plain load: the menu stays up, the match starts on click
  if (SHOT === 'start') {
    // Menu over the yard from the attacker spawn, looking up mid.
    S.phase = PHASE.MENU;
    S.player.x = -21;
    S.player.z = 19;
    S.player.yaw = 0;
    S.player.pitch = 0.02;
    return;
  }
  matchStarted = true;
  $('menu').classList.remove('on');
  hud.showHud(true);
  if (SHOT === 'play') {
    // Mid-fight on A-long: the player rounds the corner at two defenders
    // holding the site, a teammate pushing mid behind them.
    startRound(S, map, S.rng);
    S.phase = PHASE.LIVE;
    S.timer = 78;
    const p = S.player;
    p.x = -27;
    p.z = 2;
    p.yaw = -0.51;
    p.pitch = 0.01;
    giveWeapon(p, 'vk47');
    p.money = 1250;
    const jacks = S.actors.filter((a) => a.team === 'J');
    jacks[0].x = -24; jacks[0].z = -6; jacks[0].yaw = Math.PI - 0.5;
    jacks[1].x = -20; jacks[1].z = -8; jacks[1].yaw = Math.PI + 0.4;
    jacks[2].x = 0; jacks[2].z = -8; jacks[2].yaw = Math.PI;
    jacks[3].x = 20; jacks[3].z = -14; jacks[3].yaw = Math.PI;
    jacks[4].x = 5; jacks[4].z = -18; jacks[4].yaw = Math.PI;
    const mates = S.actors.filter((a) => a.team === 'V' && !a.isPlayer);
    mates[0].x = -2; mates[0].z = 8; mates[0].yaw = 0;
    mates[1].x = -24; mates[1].z = 12; mates[1].yaw = 0;
    mates[2].x = 20; mates[2].z = 10; mates[2].yaw = 0.3;
    mates[3].x = -14; mates[3].z = 16; mates[3].yaw = 0;
    return;
  }
  if (SHOT === 'buy') {
    // Buy phase with the menu open and a full wallet.
    S.player.money = 5200;
    hud.openBuy();
    S.player.x = -21;
    S.player.z = 19;
    S.player.yaw = 0;
    return;
  }
  if (SHOT === 'end') {
    // Round just won by elimination, 3–2, with the result panel up.
    // The scoreboard has to agree with the result: every defender is dead.
    S.phase = PHASE.ROUND_END;
    S.score.V = 3;
    S.score.J = 2;
    S.roundReason = 'Defenders eliminated';
    S.player.x = -22;
    S.player.z = -14;
    S.player.yaw = 0.6;
    S.player.kills = 3;
    const mates = S.actors.filter((a) => a.team === 'V' && !a.isPlayer);
    mates[0].kills = 2;
    mates[1].kills = 1;
    for (const a of S.actors) {
      if (a.team !== 'J') continue;
      a.alive = false;
      a.hp = 0;
      a.deaths = 1;
      a.fallen = true;
      if (a.mesh) {
        a.mesh.group.rotation.set(-Math.PI / 2, 0, 0);
        a.mesh.group.position.set(a.x, 0.28, a.z);
      }
    }
    const kills = [...S.actors].sort((a, b) => b.kills - a.kills).map((a) => ({
      id: a.id, team: a.team, kills: a.kills, deaths: a.deaths,
    }));
    hud.showRoundEnd('V', S.roundReason, S.score, kills);
    return;
  }
}

stageShot();

// --- simulation ---------------------------------------------------------------
let prevPhase = S.phase;

function tryFire(p) {
  const shot = fireWeapon(p, S.time, S.rng);
  if (!shot.ok) return;
  const res = fireShot(S, world, p, shot, S.time);
  sounds.shot(p.weapon === 'longbow' || p.weapon === 'breacher');
  if (res.hit) {
    hud.hitmark(res.head, S.time);
    sounds.hit();
  }
}

function simStep(dt) {
  S.time += dt;
  if (S.phase === PHASE.MENU) return;
  const p = S.player;

  if ((S.phase === PHASE.LIVE || S.phase === PHASE.BUY) && p.alive) {
    player.step(dt, keys);
    p.ads = adsHeld && S.phase === PHASE.LIVE;
    if (S.phase === PHASE.LIVE) {
      const w = WEAPONS[p.weapon];
      if (firing && w.auto) tryFire(p);
      else if (firePressed && !w.auto) tryFire(p);
      if (firing && p.mag === 0) tryReload();
      if (tickReload(p, S.time)) sounds.click();
    }
    // Plant: hold E in a site while carrying the bomb.
    p.planting = 0;
    if (keys.has('KeyE') && p.hasBomb && S.bomb.state === 'carried' && hud.inSite(p)) {
      p.planting = 1;
    }
  }
  firePressed = false;

  // Bots only act once the round is live: during the buy phase they hold
  // their spawn, and after the round they stand down.
  if (S.phase === PHASE.LIVE) {
    for (const a of S.actors) {
      if (!a.isPlayer) stepBot(S, world, a, map, dt, S.time, S.rng);
    }
  }
  stepGrenades(S, world, liveGrenades, dt, S.time);
  stepRounds(S, map, dt);
  for (let i = S.smokes.length - 1; i >= 0; i--) {
    if (S.time > S.smokes[i].until) S.smokes.splice(i, 1);
  }

  // Phase transitions: result screens and sounds.
  if (S.phase !== prevPhase) {
    if (S.phase === PHASE.ROUND_END) {
      document.exitPointerLock?.();
      const kills = [...S.actors]
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
        .map((a) => ({ id: a.id, team: a.team, kills: a.kills, deaths: a.deaths }));
      // The winner is whoever leads after this round (the 'roundEnd' event
      // carries the sound); the panel shows the current standings.
      const lastWinner = S.events.filter((e) => e.type === 'roundEnd').at(-1)?.data.winner ?? 'V';
      hud.showRoundEnd(lastWinner, S.roundReason, S.score, kills);
    } else if (S.phase === PHASE.MATCH_END) {
      document.exitPointerLock?.();
      const kills = [...S.actors]
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
        .map((a) => ({ id: a.id, team: a.team, kills: a.kills, deaths: a.deaths }));
      hud.showMatchEnd(S.matchWinner, S.score, kills);
      if (S.matchWinner === 'V') sounds.roundWin();
      else sounds.roundLose();
    } else if (S.phase === PHASE.LIVE) {
      hud.banner('GO — plant the bomb at A or B', S.time, 2.2);
    } else if (S.phase === PHASE.BUY) {
      hud.banner(`ROUND ${S.round} — buy phase, press B to shop`, S.time, 2.6);
    }
    prevPhase = S.phase;
  }
}

// --- events: sounds and banners for things the sim reports --------------------
let eventCursor = 0;

function drainEvents() {
  while (eventCursor < S.events.length) {
    const e = S.events[eventCursor++];
    const d = e.data;
    if (e.type === 'shot' && d.by !== 'you') {
      const shooter = S.actors.find((a) => a.id === d.by);
      if (shooter && Math.hypot(shooter.x - S.player.x, shooter.z - S.player.z) < 45) {
        sounds.shot(false);
      }
    } else if (e.type === 'kill' && d.killer === 'you') {
      sounds.kill();
    } else if (e.type === 'bombPlanted') {
      sounds.plantBeep();
      hud.banner(`BOMB PLANTED — site ${d.site}`, S.time, 3);
    } else if (e.type === 'bombExploded') {
      sounds.explosion();
      hud.banner('BOMB DETONATED', S.time, 3);
    } else if (e.type === 'bombDefused') {
      hud.banner('BOMB DEFUSED', S.time, 3);
    } else if (e.type === 'bombDropped') {
      hud.banner('Bomb dropped — a teammate can pick it up', S.time, 2.4);
    } else if (e.type === 'bombPickup') {
      hud.banner(`${d.by} picked up the bomb`, S.time, 2);
    } else if (e.type === 'roundEnd') {
      if (d.winner === 'V') sounds.roundWin();
      else sounds.roundLose();
    }
  }
}

// --- render -------------------------------------------------------------------
function syncGrenadeMeshes() {
  for (const [g, mesh] of grenadeMeshes) {
    if (!liveGrenades.includes(g)) {
      scene.remove(mesh);
      grenadeMeshes.delete(g);
    } else {
      mesh.position.set(g.x, g.y, g.z);
    }
  }
}

function syncSmokeMeshes() {
  for (const [s, mesh] of smokeMeshes) {
    if (!S.smokes.includes(s)) {
      scene.remove(mesh);
      smokeMeshes.delete(s);
    }
  }
  for (const s of S.smokes) {
    if (!smokeMeshes.has(s)) {
      const mesh = new THREE.Mesh(smokeGeo, smokeMat);
      mesh.position.set(s.x, 1.1, s.z);
      mesh.scale.setScalar(s.radius);
      scene.add(mesh);
      smokeMeshes.set(s, mesh);
    }
  }
}

function render(dt) {
  const p = S.player;
  if (S.phase === PHASE.MENU) {
    // Slow establishing pan over the yard behind the menu.
    const t = S.time * 0.08;
    camera.position.set(-21 + Math.sin(t) * 4, 3.2, 21);
    camera.lookAt(-12 + Math.cos(t) * 4, 1.4, -8);
    camera.fov = 70;
    camera.updateProjectionMatrix();
  } else {
    const zoom = p.ads ? 75 / WEAPONS[p.weapon].zoom : 75;
    player.applyCamera(camera, dt, zoom);
    // Viewmodel kick and bob.
    viewmodel.rotation.x = p.recoilPitch * 0.9;
    viewmodel.position.y = -0.24 + Math.sin(player.bobPhase * 2) * 0.006 * Math.min(1, p.speed2d / MOVE.walkSpeed);
  }
  for (const a of S.actors) {
    if (!a.isPlayer) syncBotMesh(a, S.time);
  }
  // Bomb prop.
  const bomb = S.bomb;
  if (bomb.state === 'planted' || bomb.state === 'dropped') {
    bombGroup.visible = true;
    bombGroup.position.set(bomb.x, 0.2, bomb.z);
    bombLight.visible = bomb.state === 'planted' ? (S.time * 2) % 1 < 0.55 : true;
  } else {
    bombGroup.visible = false;
  }
  world.updateTracers(S.time);
  syncGrenadeMeshes();
  syncSmokeMeshes();
  drainEvents();
  if (S.phase !== PHASE.MENU) hud.update(S.time, currentSpread(p));
  renderer.render(scene, camera);
}

// --- main loop: fixed 60 Hz sim, render every animation frame -----------------
let last = performance.now();
let acc = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  let dt = (nowMs - last) / 1000;
  last = nowMs;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let steps = 0;
  while (acc >= TICK && steps < 5) {
    simStep(TICK);
    acc -= TICK;
    steps++;
  }
  if (steps === 5) acc = 0;
  render(dt);
}

requestAnimationFrame(frame);

// Debug/testing handle: lets a play-test script inspect live state
// (phase, actors, bomb) without touching the game itself.
window.__ember = { S, map, player, world, hud };
