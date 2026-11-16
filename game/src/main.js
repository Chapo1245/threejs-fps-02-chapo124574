// main.js — boot, fixed-step loop, round state machine, damage hooks.
// The simulation runs at a fixed 60 Hz, apart from rendering; the
// renderer only reads state. Adaptive quality drops pixel ratio, then
// particle counts, when heavy firefights cost frames — the "macet" fix:
// tracers and particles are pooled, the map is instanced, shadows are
// decided once at boot (never toggled mid-fight: that recompiles every
// material), and nothing is allocated per frame in the hot loop.

import * as THREE from 'three';
import { createState, resetMatch, setBanner, pushEvent, clamp } from './state.js';
import { VARIANTS, VARIANT_ORDER, DEFAULT_VARIANT, ATK_NAMES, DEF_NAMES, ECONOMY, WEAPONS } from './config.js';
import { LAYOUTS } from './layouts.js';
import { World } from './world.js';
import { Render } from './render.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Combat } from './combat.js';
import { Bots } from './bots.js';
import { HUD } from './hud.js';
import { makeLoadout, initAmmo, currentWeapon, switchSlot, startReload, tickLoadout, tryFire, currentSpread, buyItem, throwGrenade } from './weapons.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1', 10) || 1;

const canvas = document.getElementById('game');
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

const S = createState(SEED);
S.isTouch = isTouch;
S.atkNames = ATK_NAMES;
S.defNames = DEF_NAMES;
S.variant = params.get('variant') || DEFAULT_VARIANT;
S.variantCfg = VARIANTS[S.variant];
S.shotEvents = [];
S.targets = [];
S.channel = null;
S.bombCarrier = 'player';
S.buyOpen = false;

const sfx = new Sfx();
const render = new Render(canvas, isTouch ? 1 : 0, isTouch);
render.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', () => render.resize(window.innerWidth, window.innerHeight));

let world = null;
let player = null;
let bots = null;
let combat = null;
let hud = null;
let input = null;
let loadout = null;

// Reusable target descriptors (built once, updated in place).
const playerTarget = { ref: null, team: 'atk', x: 0, z: 0, y: 0, hw: 0.34, alive: true };
const botTargets = [];
for (let i = 0; i < 9; i++) botTargets.push({ ref: null, team: 'atk', x: 0, z: 0, y: 0, hw: 0.34, alive: true });

function buildWorld(variantId) {
  const cfg = VARIANTS[variantId];
  const layout = LAYOUTS[cfg.layout];
  if (world) world.dispose();
  world = new World(render.scene, layout, cfg.palette, cfg.sun, cfg.hemi, !S.isTouch);
  S.roundTime = cfg.roundTime;
  if (hud) { hud.layout = layout; hud.world = world; }
  return layout;
}

function buildGame() {
  const layout = buildWorld(S.variant);
  player = new Player(world, layout.spawns.atk[0]);
  playerTarget.ref = player;
  loadout = makeLoadout('rifle');
  initAmmo(loadout);
  combat = new Combat(S, world, render, sfx, hooks);
  bots = new Bots(S, world, render, sfx, combat, hooks);
  for (let i = 0; i < 9; i++) botTargets[i].ref = bots.list[i] || null;
  if (!hud) {
    hud = new HUD(S, layout);
    hud.onBuyItem = (id) => {
      if (buyItem(S, loadout, player, id)) { sfx.buy(); render.setViewmodel(loadout.primary); }
      else sfx.denied();
    };
    const pickMap = (id) => {
      S.variant = id;
      S.variantCfg = VARIANTS[id];
      sfx.click();
      buildWorld(id);
      player = new Player(world, world.layout.spawns.atk[0]);
      playerTarget.ref = player;
      hud.setMapButtons(VARIANT_ORDER.map((v) => VARIANTS[v]), S.variant, pickMap);
    };
    hud.setMapButtons(VARIANT_ORDER.map((id) => VARIANTS[id]), S.variant, pickMap);
  } else {
    hud.layout = layout;
  }
  hud.world = world;
  if (!input) {
    input = new Input(canvas, {
      onClick: () => {
        // Lock the pointer only while actually playing; during the buy
        // phase the mouse must stay free for the shop buttons.
        if (S.mode === 'play') { sfx.ensure(); input.requestLock(); }
      },
      onFire: (down) => {
        if (down && loadout.slot === 3) { throwSelectedGrenade(); return; }
        if (down && currentWeapon(loadout) && !currentWeapon(loadout).auto) doShot();
      },
      onReload: () => { if (player.alive) startReload(loadout, sfx); },
      onBuy: () => {
        if (S.phase === 'buy') { S.buyOpen = !S.buyOpen; sfx.click(); }
      },
      onGrenade: () => {
        loadout.grenadeSel = loadout.grenadeSel === 'frag' ? 'smoke' : 'frag';
        if (loadout.slot !== 3) switchSlot(loadout, 3);
        sfx.click();
      },
      onSlot: (slot) => {
        const w = switchSlot(loadout, slot);
        if (w) { render.setViewmodel(w.id); sfx.click(); }
      },
      onScope: (down) => {
        const w = currentWeapon(loadout);
        if (w && w.id === 'sniper') {
          loadout.scoped = down;
          render.camera.fov = down ? 78 / w.zoom : 78;
          render.camera.updateProjectionMatrix();
        }
      },
      onInteract: () => {},
      onPause: () => {
        if (S.mode === 'play' || S.mode === 'buy') togglePause();
      },
    });
  }
  // Targets list (reused objects).
  S.targets.length = 0;
  S.targets.push(playerTarget);
  for (let i = 0; i < 9; i++) S.targets.push(botTargets[i]);
}

// --- damage hooks -----------------------------------------------------
const hooks = {
  onDamage(target, dmg, head, shooter) {
    if (target === player) {
      const dealt = player.damage(dmg);
      S.flash = 0.9;
      const sx = shooter.pos ? shooter.pos.x : shooter.x;
      const sz = shooter.pos ? shooter.pos.z : shooter.z;
      const ang = Math.atan2(sx - player.pos.x, sz - player.pos.z) - player.yaw;
      S.damageDir = ang;
      sfx.hurt();
      if (!player.alive) playerDied(shooter);
      return !player.alive;
    }
    // Bot target.
    let remaining = dmg;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, dmg * 0.5);
      target.armor -= absorbed;
      remaining -= absorbed;
    }
    target.hp -= remaining;
    if (target.hp <= 0) {
      target.hp = 0;
      botDied(target, shooter, head);
      return true;
    }
    return false;
  },
  onChannelDone(bot, kind) {
    if (kind === 'plant') {
      const site = S.planSite;
      const L = world.layout.sites[site];
      S.bomb = { planted: true, site, x: L.x, z: L.z, t: S.bombTime, planter: bot, defuser: null, defuseT: 0 };
      S.phase = 'planted';
      S.phaseT = S.bombTime;
      world.setBombVisible(L.x, L.z, true);
      setBanner(S, 'CHARGE PLANTED — SITE ' + site, 'Defend it until it blows', 'good');
      pushEvent(S, 'Charge planted at site ' + site, 'good');
      S.money += ECONOMY.plant;
      sfx.plantBeep();
    } else if (kind === 'defuse') {
      endRound('def', 'CHARGE DEFUSED');
    }
  },
};

function playerDied(shooter) {
  S.deaths += 1;
  const name = shooter.name || 'Enemy';
  pushEvent(S, name + ' ▸ You', 'bad');
  if (S.bombCarrier === 'player') transferCarrier();
  if (document.pointerLockElement) document.exitPointerLock();
}

function transferCarrier() {
  const alive = S.bots.filter((b) => b.alive && b.team === 'atk');
  if (alive.length) {
    let best = alive[0], bd = Infinity;
    for (const b of alive) {
      const d = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    S.bombCarrier = best;
    best.isCarrier = true;
    pushEvent(S, best.name + ' picks up the charge', 'info');
  } else {
    S.bombCarrier = null;
  }
}

function botDied(bot, shooter, head) {
  bot.alive = false;
  bot.fallT = 3;
  bot.channel = null;
  if (bot.isCarrier) { bot.isCarrier = false; transferCarrier(); }
  const wname = shooter === player ? (currentWeapon(loadout) || { name: '' }).name : (currentWeapon(bot.loadout) || { name: '' }).name;
  const sname = shooter === player ? 'You' : (shooter.name || 'Enemy');
  pushEvent(S, sname + ' ▸ ' + bot.name + (head ? '  · HEADSHOT' : ''), shooter === player ? 'good' : 'bad');
  if (shooter === player) {
    S.kills += 1;
    S.roundKills += 1;
    S.money += ECONOMY.kill;
    S.hitmarkKill = true;
  }
  checkAliveWin();
}

function checkAliveWin() {
  if (S.mode !== 'play' || S.phase === 'over') return;
  const atkAlive = S.bots.filter((b) => b.alive && b.team === 'atk').length + (player.alive ? 1 : 0);
  const defAlive = S.bots.filter((b) => b.alive && b.team === 'def').length;
  if (S.bomb.planted) {
    if (defAlive === 0) endRound('atk', 'SITE CLEARED — CHARGE BLOWS');
    return;
  }
  if (atkAlive === 0) endRound('def', 'SQUAD ELIMINATED');
  else if (defAlive === 0) endRound('atk', 'SITE CLEARED');
}

function endRound(winner, reason) {
  if (S.phase === 'over') return;
  S.phase = 'over';
  S.mode = 'roundEnd';
  S.phaseT = 4.5;
  S.score[winner] += 1;
  const won = winner === 'atk';
  if (won) {
    S.money += ECONOMY.win;
    S.lossStreak = 0;
    sfx.roundWin();
  } else {
    S.money += ECONOMY.lossBase + Math.min(S.lossStreak, 3) * ECONOMY.lossStep;
    S.lossStreak += 1;
    sfx.roundLose();
  }
  setBanner(S, won ? 'ROUND WON — ' + reason : 'ROUND LOST — ' + reason, 'Score ' + S.score.atk + ' — ' + S.score.def, won ? 'good' : 'bad');
  if (document.pointerLockElement) document.exitPointerLock();
}

function startRound() {
  const layout = world.layout;
  const planSite = S.rng() < 0.55 ? 'A' : 'B';
  S.planSite = planSite;
  S.bomb = { planted: false, site: null, x: 0, z: 0, t: 0, planter: null, defuser: null, defuseT: 0 };
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.shotEvents.length = 0;
  S.channel = null;
  S.roundKills = 0;
  S.bombCarrier = 'player';
  S.buyOpen = true;
  world.setBombVisible(0, 0, false);
  player.reset(layout.spawns.atk[0]);
  bots.spawnRound(planSite);
  for (let i = 0; i < 9; i++) botTargets[i].ref = bots.list[i];
  S.phase = 'buy';
  S.phaseT = S.buyTime;
  S.mode = 'buy';
  setBanner(S, 'ROUND ' + S.round + ' — BUY PHASE', 'Plan: push site ' + planSite + ' · B opens the shop', 'info');
}

function startMatch() {
  // resetMatch rebuilds the state object in place; keep the menu picks.
  const keepVariant = S.variant;
  const keepDiff = S.difficulty;
  resetMatch(S, SEED + 11);
  S.variant = keepVariant;
  S.difficulty = keepDiff;
  S.variantCfg = VARIANTS[S.variant];
  S.atkNames = ATK_NAMES;
  S.defNames = DEF_NAMES;
  S.shotEvents = [];
  S.targets = [];
  S.channel = null;
  S.bombCarrier = 'player';
  S.buyOpen = false;
  buildWorld(S.variant);
  player = new Player(world, world.layout.spawns.atk[0]);
  playerTarget.ref = player;
  loadout = makeLoadout('rifle');
  initAmmo(loadout);
  // Reuse the Bots instance (it owns the 9 meshes); re-point the world.
  if (combat) combat.world = world;
  else combat = new Combat(S, world, render, sfx, hooks);
  if (bots) { bots.world = world; bots.combat = combat; }
  else bots = new Bots(S, world, render, sfx, combat, hooks);
  for (let i = 0; i < 9; i++) botTargets[i].ref = bots.list[i];
  S.targets.push(playerTarget);
  for (let i = 0; i < 9; i++) S.targets.push(botTargets[i]);
  hud.layout = world.layout;
  hud.showMenu(false);
  hud.showMatchEnd(false);
  hud.showPause(false);
  S.money = ECONOMY.startMoney;
  startRound();
  sfx.ensure();
  // No pointer lock here: the buy menu must stay clickable with the
  // mouse. The player locks the pointer by clicking the game canvas
  // once the round goes live (see input onClick).
}

function togglePause() {
  S.paused = !S.paused;
  hud.showPause(S.paused);
  if (!S.paused) input.requestLock();
  else if (document.pointerLockElement) document.exitPointerLock();
}

// --- shooting ---------------------------------------------------------
const _eye = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };

function doShot() {
  if (!player.alive || (S.mode !== 'play' && S.mode !== 'buy')) return;
  const w = currentWeapon(loadout);
  if (!w) return;
  const res = tryFire(loadout, w, sfx);
  if (res !== 'fired') {
    if (res === 'dry') startReload(loadout, sfx);
    return;
  }
  player.eyePos(_eye);
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
  _dir.x = -sy * cp;
  _dir.y = sp;
  _dir.z = -cy * cp;
  const spread = currentSpread(w, player.moveMag, !player.onGround, loadout.bloom, loadout.scoped);
  const result = combat.fire(player, _eye, _dir, w, spread, S.rng, true);
  // Recoil: pitch kicks up, yaw drifts a touch.
  player.pitch = clamp(player.pitch + w.recoil * (0.6 + loadout.bloom * 0.6), -1.5, 1.5);
  player.yaw += (S.rng() - 0.5) * w.recoil * 0.5;
  render.vmKick = 1;
  render.muzzleFlashAt({ x: _eye.x + _dir.x * 0.6, y: _eye.y + _dir.y * 0.6 - 0.15, z: _eye.z + _dir.z * 0.6 });
  S.shotEvents.push({ x: player.pos.x, z: player.pos.z, team: 'atk', t: S.time });
  if (result.hit) {
    S.hitmark = 0.3;
    S.hitmarkKill = result.kill;
    if (result.head) sfx.headshot(); else sfx.hit();
    if (result.kill) sfx.kill();
  }
}

function throwSelectedGrenade() {
  if (!player.alive || S.mode !== 'play') return;
  const kind = loadout.grenadeSel;
  const g = throwGrenade(loadout, kind);
  if (!g) { sfx.denied(); return; }
  player.eyePos(_eye);
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  _dir.x = -Math.sin(player.yaw) * cp;
  _dir.y = sp + 0.25;
  _dir.z = -Math.cos(player.yaw) * cp;
  combat.throwGrenadeEntity(player, _eye, _dir, kind);
}

// --- fixed-step tick --------------------------------------------------
function tick(dt) {
  S.time += dt;
  S.tick += 1;
  if (S.banner && S.banner.t > 0) S.banner.t -= dt;
  S.flash = Math.max(0, S.flash - dt * 1.8);
  S.hitmark = Math.max(0, S.hitmark - dt);
  if (S.flash < 0.25) S.damageDir = -1;
  S.shake = Math.max(0, S.shake - dt * 1.4);
  // Prune old shot events (hearing memory).
  while (S.shotEvents.length && S.time - S.shotEvents[0].t > 2) S.shotEvents.shift();

  if (S.mode === 'menu' || S.mode === 'matchEnd' || S.paused) return;

  // Update target descriptors (reused objects).
  playerTarget.x = player.pos.x; playerTarget.z = player.pos.z;
  playerTarget.alive = player.alive;
  for (let i = 0; i < 9; i++) {
    const b = bots.list[i];
    const tg = botTargets[i];
    tg.x = b.pos.x; tg.z = b.pos.z; tg.alive = b.alive; tg.team = b.team;
  }

  // Phase timers.
  if (S.mode === 'buy') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      S.mode = 'play';
      S.phase = 'live';
      S.phaseT = S.roundTime;
      S.buyOpen = false;
      setBanner(S, 'ROUND ' + S.round + ' — GO', 'Plant the charge at site ' + S.planSite, 'info');
    }
  } else if (S.mode === 'play') {
    S.phaseT -= dt;
    if (S.phase === 'planted') {
      // Accelerating bomb beeps.
      if (Math.floor(S.phaseT * 2) !== Math.floor((S.phaseT + dt) * 2)) sfx.bombBeep();
      if (S.phaseT <= 0) {
        world.setBombVisible(0, 0, false);
        endRound('atk', 'CHARGE DETONATED');
        return;
      }
    } else if (S.phaseT <= 0) {
      endRound('def', 'TIME EXPIRED');
      return;
    }
  } else if (S.mode === 'roundEnd') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      if (S.score.atk >= S.winTarget || S.score.def >= S.winTarget || S.round >= S.maxRounds) {
        S.mode = 'matchEnd';
        S.matchWinner = S.score.atk > S.score.def ? 'atk' : 'def';
        hud.showMatchEnd(true, S.matchWinner, S.score);
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        S.round += 1;
        startRound();
      }
      return;
    }
  }

  // Player movement + look (buy and play).
  if ((S.mode === 'buy' || S.mode === 'play') && player.alive) {
    const look = input.consumeLook();
    player.yaw -= look.dx * 0.0022;
    player.pitch = clamp(player.pitch - look.dy * 0.0022, -1.5, 1.5);
    const frame = input.moveFrame();
    const stepped = player.step(dt, frame);
    if (stepped) sfx.step();
    tickLoadout(loadout, dt);
    if (input.firing) {
      const w = currentWeapon(loadout);
      if (w && w.auto) doShot();
    }
    // Plant channel: hold E inside a site while carrying the charge.
    if (S.bombCarrier === 'player' && S.phase === 'live' && input.keys['KeyE']) {
      const L = world.layout;
      const site = inSite(player.pos, L.sites.A) ? 'A' : inSite(player.pos, L.sites.B) ? 'B' : null;
      if (site) {
        if (!S.channel) { S.channel = { kind: 'plant', t: 0, dur: S.plantTime }; sfx.plantStart(); }
        S.channel.t += dt;
        if (S.channel.t >= S.channel.dur) {
          S.channel = null;
          const s = world.layout.sites[site];
          S.bomb = { planted: true, site, x: s.x, z: s.z, t: S.bombTime, planter: player, defuser: null, defuseT: 0 };
          S.phase = 'planted';
          S.phaseT = S.bombTime;
          world.setBombVisible(s.x, s.z, true);
          setBanner(S, 'CHARGE PLANTED — SITE ' + site, 'Defend it until it blows', 'good');
          pushEvent(S, 'You planted the charge at site ' + site, 'good');
          S.money += ECONOMY.plant;
          sfx.plantBeep();
        }
      } else S.channel = null;
    } else S.channel = null;
  } else if (!player.alive) {
    input.consumeLook();
  }

  // Bots fight only once the round is live.
  if ((S.mode === 'play') && (S.phase === 'live' || S.phase === 'planted')) {
    bots.update(dt);
  }
  combat.stepGrenades(dt);

  // Camera follows the player, or a teammate while spectating.
  if (player.alive) {
    render.camera.position.set(player.pos.x, player.eye, player.pos.z);
    render.camera.rotation.y = player.yaw + (S.shake > 0 ? (S.rng() - 0.5) * S.shake * 0.03 : 0);
    render.camera.rotation.x = player.pitch + (S.shake > 0 ? (S.rng() - 0.5) * S.shake * 0.03 : 0);
  } else {
    const alive = S.bots.filter((b) => b.alive);
    const spec = alive.length ? alive[S.spectate % alive.length] : null;
    if (spec) {
      render.camera.position.set(spec.pos.x, 1.55, spec.pos.z);
      render.camera.rotation.y = spec.yaw;
      render.camera.rotation.x = 0;
    }
  }
}

function inSite(pos, site) {
  const dx = pos.x - site.x, dz = pos.z - site.z;
  return dx * dx + dz * dz < site.r * site.r;
}

// --- render frame -----------------------------------------------------
let lastT = performance.now();
let acc = 0;
let fpsEMA = 60;
let qualityT = 0;
let goodT = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.25) dt = 0.25;
  fpsEMA = fpsEMA * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  // Adaptive quality: heavy firefights drop a level, calm play recovers.
  qualityT += dt;
  if (qualityT > 2) {
    qualityT = 0;
    if (fpsEMA < 45 && S.quality < 3) {
      S.quality += 1;
      render.applyQuality(S.quality);
      goodT = 0;
    } else if (fpsEMA > 58 && S.quality > 0) {
      goodT += 2;
      if (goodT >= 8) {
        S.quality -= 1;
        render.applyQuality(S.quality);
        goodT = 0;
      }
    } else goodT = 0;
  }
  if (!S.paused) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      tick(STEP);
      acc -= STEP;
      steps += 1;
    }
    if (steps === 4) acc = 0;
  }
  // Per-frame visuals.
  const moving = player && player.alive && player.moveMag > 0.15;
  render.updateViewmodel(dt, moving, input ? input.firing : false, !!(loadout && loadout.reloading));
  render.updateTracers(dt);
  render.updateParticles(dt);
  if (world) {
    const pulse = 0.55 + Math.sin(now * 0.003) * 0.2;
    if (world.siteMeshes.A) world.siteMeshes.A.material.opacity = pulse;
    if (world.siteMeshes.B) world.siteMeshes.B.material.opacity = pulse;
  }
  if (hud && player && loadout) hud.update(player, loadout, dt);
  render.render();
}

// --- boot -------------------------------------------------------------
buildGame();
hud.showMenu(true); // menu up, HUD hidden behind it on first load
// Warm up the one-shot effect programs (tracer / particles / muzzle
// flash) while the menu is up: their first render compiles shaders,
// and that hitch must not land on the first shots of a round.
render.spawnTracer({ x: 0, y: -50, z: 0 }, { x: 0, y: -50, z: 0 }, 0xffb347);
render.spawnParticles(0, -50, 0, 4, 1, 1, 0xffc46b);
render.muzzleFlashAt({ x: 0, y: -50, z: 0 });
render.render();
document.querySelectorAll('.diff-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    S.difficulty = btn.dataset.diff;
    document.querySelectorAll('.diff-btn').forEach((b) => b.classList.toggle('sel', b === btn));
    sfx.click();
  });
});
document.getElementById('start-btn').addEventListener('click', () => { sfx.ensure(); startMatch(); });
document.getElementById('resume-btn').addEventListener('click', () => togglePause());
document.getElementById('rematch-btn').addEventListener('click', () => { startMatch(); });
document.getElementById('menu-btn').addEventListener('click', () => {
  S.mode = 'menu';
  hud.showMatchEnd(false);
  hud.showMenu(true);
  if (document.pointerLockElement) document.exitPointerLock();
});
document.getElementById('fire-btn').addEventListener('touchstart', (e) => { e.preventDefault(); input.firing = true; if (loadout.slot === 3) throwSelectedGrenade(); else if (currentWeapon(loadout) && !currentWeapon(loadout).auto) doShot(); }, { passive: false });
document.getElementById('fire-btn').addEventListener('touchend', () => { input.firing = false; });
document.getElementById('jump-btn').addEventListener('touchstart', (e) => { e.preventDefault(); input.keys['Space'] = true; }, { passive: false });
document.getElementById('jump-btn').addEventListener('touchend', () => { input.keys['Space'] = false; });
document.getElementById('crouch-btn').addEventListener('touchstart', (e) => { e.preventDefault(); input.keys['KeyC'] = true; }, { passive: false });
document.getElementById('crouch-btn').addEventListener('touchend', () => { input.keys['KeyC'] = false; });
if (isTouch) document.body.classList.add('touch');

// Staged states for real-render screenshots (?shot=start|play|buy|end).
function stageShot(kind) {
  if (kind === 'play') {
    startMatch();
    // Skip the buy phase: straight into live combat, player mid-map.
    S.mode = 'play'; S.phase = 'live'; S.phaseT = 62; S.buyOpen = false;
    S.banner = null; // no buy-phase banner over the combat shot
    player.pos.x = 0; player.pos.z = 12; player.yaw = 0.12; player.pitch = 0;
    // Two defenders visible ahead, one teammate beside the player.
    const defs = bots.list.filter((b) => b.team === 'def');
    defs[0].pos.x = -3; defs[0].pos.z = -6; defs[0].yaw = Math.PI;
    defs[1].pos.x = 5; defs[1].pos.z = -10; defs[1].yaw = Math.PI;
    const atk = bots.list.filter((b) => b.team === 'atk');
    atk[0].pos.x = -2.5; atk[0].pos.z = 10; atk[0].yaw = 0;
    loadout.ammo.rifle.mag = 24;
    S.money = 3250;
    hud.showMenu(false);
  } else if (kind === 'buy') {
    startMatch();
    S.money = 5400;
    hud.showMenu(false);
  } else if (kind === 'end') {
    startMatch();
    S.mode = 'play'; S.phase = 'planted'; S.phaseT = 12; S.buyOpen = false;
    S.score = { atk: 3, def: 2 };
    S.round = 6;
    const L = world.layout.sites.B;
    S.bomb = { planted: true, site: 'B', x: L.x, z: L.z, t: 12, planter: player, defuser: null, defuseT: 0 };
    world.setBombVisible(L.x, L.z, true);
    player.pos.x = 14; player.pos.z = 8; player.yaw = -0.5; player.pitch = 0;
    const defs = bots.list.filter((b) => b.team === 'def');
    defs[0].pos.x = 18; defs[0].pos.z = 14; defs[0].yaw = Math.PI * 0.75;
    setBanner(S, 'CHARGE PLANTED — SITE B', 'Defend it until it blows', 'good');
    pushEvent(S, 'You planted the charge at site B', 'good');
    pushEvent(S, 'You ▸ Rust', 'good');
    hud.showMenu(false);
  }
}

const shotKind = params.get('shot');
if (shotKind) stageShot(shotKind);

// Debug handle for play-testing (and the finalist review).
window.__ember = {
  S, version: '3-slagworks',
  startMatch, player: () => player, bots: () => bots,
  state: () => ({ mode: S.mode, phase: S.phase, score: S.score, hp: player.hp, money: S.money }),
  fire: () => doShot(),
  loadout: () => loadout,
  // Advance the fixed-step simulation manually (deterministic
  // play-testing; the live game never calls this).
  step: (n) => { for (let i = 0; i < (n || 1); i++) tick(STEP); },
  look: (dx, dy) => {
    player.yaw -= dx * 0.0022;
    player.pitch = clamp(player.pitch - dy * 0.0022, -1.5, 1.5);
  },
  warp: (x, z, yaw) => { player.pos.x = x; player.pos.z = z; if (yaw !== undefined) player.yaw = yaw; },
};

requestAnimationFrame(frame);
