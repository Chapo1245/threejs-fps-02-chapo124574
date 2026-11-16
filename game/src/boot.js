// boot.js — entry point. Wires input (pointer lock, keys), runs the loop:
// fixed-step sim ticks at 60 Hz (accumulator, max 3 steps) + one render per
// frame. Drains sim events to HUD / audio / visuals, then clears them.
import { MAP } from './maps.js';
import { TICK, ROUND_TIME } from './state.js';
import { buildWorld } from './world.js';
import { newMatch, startRound, tick, buyItem, botBuy } from './sim.js';
import { createRenderer, renderFrame, consumeVisualEvents, resizeRenderer } from './render.js';
import { createHud, updateHud, pushFeed, pushRadio, showBanner, showToast, showHitmarker, fillScoreboard, setMenuVisible } from './hud.js';
import { ensureAudio, playEvent, playReload, playClick, playStep } from './audio.js';
import { fireShot, startReload, throwGrenade } from './combat.js';
import { BUY_LIST } from './weapons.js';

const keys = {};
let demoMode = null;

export function startGame(appEl) {
  const params = new URLSearchParams(location.search);
  demoMode = params.get('demo');
  const state = newMatch(MAP, demoMode);
  const renderer = createRenderer(appEl, state);
  const world = buildWorld(renderer.scene, MAP);
  const hud = createHud(appEl, state, {
    play: () => startPlaying(),
    buy: (kind, id) => {
      const player = state.actors[0];
      if (buyItem(state, player, kind, id)) { playClick(); }
    },
  });

  const player = state.actors[0];
  const input = {
    move: { f: 0, s: 0, jump: false, crouch: false, ads: false },
    yaw: 0, pitch: 0, plant: false,
  };
  let locked = false, lastStepAt = 0, accumulator = 0, lastT = performance.now();
  let muzzleAt = 0;

  function startPlaying() {
    ensureAudio();
    setMenuVisible(hud, false);
    if (state.phase === 'menu') {
      state.phase = 'buy'; state.phaseT = 0;
      startRound(state, world);
      botBuy(state);
      showBanner(hud, 'ROUND 1', 'Plant the spike at Site ' + state.targetSite + ' — first to 5', '#5eead4');
      applyDemo(demoMode);
      // Sync AFTER applyDemo: a demo may reposition/rotate the player, and
      // the tick overwrites player.yaw from input every step.
      input.yaw = player.yaw; input.pitch = player.pitch;
    }
    renderer.renderer.domElement.requestPointerLock?.();
  }

  // Demo scenes for screenshots (?demo=combat|buy|plant|score): arrange the
  // round deterministically, then let the real sim + renderer run it.
  function applyDemo(mode) {
    if (!mode) return;
    state.phase = 'live'; state.phaseT = 0; state.roundTime = ROUND_TIME;
    const rng = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(42);
    if (mode === 'combat') {
      // A-long push: player looks north up the lane at Site A, a teammate
      // ahead-left, three defenders around the site and its kiln.
      state.targetSite = 'A';
      player.pos.x = 12; player.pos.z = 12; player.yaw = -0.32; player.pitch = -0.06;
      const foes = state.actors.filter(a => a.team === 'B');
      foes[0].pos.x = 19; foes[0].pos.z = -9; foes[0].yaw = Math.PI;
      foes[1].pos.x = 14; foes[1].pos.z = -11; foes[1].yaw = Math.PI * 0.8;
      foes[2].pos.x = 21; foes[2].pos.z = -4; foes[2].yaw = Math.PI * 1.2;
      const mates = state.actors.filter(a => a.team === 'A' && !a.isPlayer);
      mates[0].pos.x = 10; mates[0].pos.z = 8; mates[0].yaw = -0.2;
      mates[1].pos.x = 15; mates[1].pos.z = 9; mates[1].yaw = -0.4;
      mates[2].pos.x = 8; mates[2].pos.z = 15; mates[2].yaw = 0;
      mates[3].pos.x = 16; mates[3].pos.z = 15; mates[3].yaw = -0.3;
    } else if (mode === 'buy') {
      state.phase = 'buy'; state.phaseT = 0; player.money = 5400;
      hud.buyOpen = true;
    } else if (mode === 'plant') {
      // Stand on Site A looking back down the approach lane (yaw 2.7 faces
      // south-west): the site ring at the player's feet, the lane, the crates
      // and the defenders pushing in all read in one frame.
      state.targetSite = 'A';
      player.pos.x = 19; player.pos.z = -13; player.yaw = 2.7; player.pitch = -0.06;
      player.hasSpike = true;
      player.armor = 100; // demo staging: bought kevlar, survives the retake
      state.actors.filter(a => a.team === 'A').forEach(a => { a.hasSpike = false; });
      player.hasSpike = true;
      // Defenders pushing down the approach lane, low skill so the plant
      // can finish on the slow software renderer.
      const foes = state.actors.filter(a => a.team === 'B');
      foes[0].pos.x = 12; foes[0].pos.z = -4; foes[0].bot.skill = 0.08;
      foes[1].pos.x = 24; foes[1].pos.z = -4; foes[1].bot.skill = 0.08;
    } else if (mode === 'score') {
      state.phase = 'roundEnd'; state.phaseT = 0;
      state.score.A = 3; state.score.B = 2; state.round = 6;
      state.actors[0].kills = 7; state.actors[0].deaths = 2; state.actors[0].money = 4650;
      state.actors[1].kills = 5; state.actors[5].kills = 6;
      hud.boardOpen = true;
    }
  }

  // --- Input ---------------------------------------------------------------
  const canvas = renderer.renderer.domElement;
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', e => {
    if (!locked) return;
    input.yaw -= e.movementX * 0.0021;
    input.pitch -= e.movementY * 0.0021;
    input.pitch = Math.max(-1.45, Math.min(1.45, input.pitch));
    player.yaw = input.yaw; player.pitch = input.pitch;
  });
  canvas.addEventListener('click', () => {
    if (state.phase === 'menu') return;
    if (!locked) canvas.requestPointerLock?.();
  });
  document.addEventListener('mousedown', e => {
    if (!locked || state.phase !== 'live') return;
    if (e.button === 0) tryFire(true);
    if (e.button === 2) input.move.ads = true;
  });
  document.addEventListener('mouseup', e => { if (e.button === 2) input.move.ads = false; });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Tab') { e.preventDefault(); hud.boardOpen = true; fillScoreboard(hud, state); }
    if (e.code === 'KeyB' && state.phase === 'buy') { hud.buyOpen = !hud.buyOpen; playClick(); }
    if (e.code === 'KeyR') { if (startReload(player)) playReload(); }
    if (e.code === 'KeyQ') { doThrow(); }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      const idx = Number(e.code.slice(-1)) - 1;
      if (player.weapons[idx]) { player.slot = idx; playClick(); }
    }
    if (hud.buyOpen && state.phase === 'buy') {
      const item = BUY_LIST.find(b => b.key === e.key);
      if (item) buyItem(state, player, item.kind, item.id);
    }
    if (e.code === 'KeyE') input.plant = true;
    if (e.code === 'Space') { input.move.jump = true; e.preventDefault(); }
  });
  document.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'Tab') hud.boardOpen = false;
    if (e.code === 'KeyE') input.plant = false;
    if (e.code === 'Space') input.move.jump = false;
  });
  window.addEventListener('resize', () => resizeRenderer(renderer, appEl));

  function aimDir() {
    const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
    return { x: -Math.sin(player.yaw) * cp, y: sp, z: -Math.cos(player.yaw) * cp };
  }
  function tryFire(held) {
    const gun = player.weapons[player.slot];
    if (!gun || gun.mag <= 0) { if (gun && gun.reserve > 0) startReload(player); return; }
    const d = aimDir();
    const res = fireShot(state, world, player, d.x, d.y, d.z, input.move.ads);
    if (res === 'hit' || res === 'kill') { /* hitmarker comes via event drain */ }
    muzzleAt = performance.now();
    renderer.muzzle.intensity = 14;
    if (res === 'dry') startReload(player);
  }
  function doThrow() {
    const kind = player.selectedGrenade;
    if (throwGrenade(state, player, kind)) playClick();
    else showToast(hud, 'No ' + kind + ' grenades — buy more with B');
  }

  // Hold-to-fire for automatic weapons.
  let mouseDown = false;
  document.addEventListener('mousedown', e => { if (e.button === 0) mouseDown = true; });
  document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });

  // --- Event drain: sim events -> audio / HUD / visuals, then cleared. -----
  function drainEvents() {
    for (const e of state.events) {
      playEvent(e);
      if (e.type === 'kill') { pushFeed(hud, e); if (e.killer === player) showHitmarker(hud, true); }
      if (e.type === 'hit' && e.shooter === player) showHitmarker(hud, false);
      if (e.type === 'roundStart') showBanner(hud, 'ROUND ' + e.round, 'Target: Site ' + e.site + ' — first to 5', '#fff');
      if (e.type === 'live') showToast(hud, 'Round live — good luck');
      if (e.type === 'roundEnd') {
        const win = e.winner === 'A';
        showBanner(hud, win ? 'RIVETS WIN THE ROUND' : 'WARDENS WIN THE ROUND', e.reason, win ? '#5eead4' : '#fbbf24');
      }
      if (e.type === 'matchEnd') {
        const win = e.winner === 'A';
        showBanner(hud, win ? 'RIVETS TAKE THE YARD' : 'WARDENS TAKE THE YARD', win ? 'Copperline is yours — $400 pace' : 'The yard holds. Run it back.', win ? '#5eead4' : '#fbbf24');
      }
      if (e.type === 'planted') { showBanner(hud, 'SPIKE PLANTED — ' + e.site, e.actor.name + ' planted the spike. Defenders: retake or lose the round.', '#fca5a5'); }
      if (e.type === 'defused') showBanner(hud, 'SPIKE DEFUSED', e.actor.name + ' saved the site.', '#fbbf24');
      if (e.type === 'award' && e.actor === player) showToast(hud, '+' + e.amount + ' — ' + e.why);
    }
    for (const r of state.radio) pushRadio(hud, r);
    state.radio = [];
    consumeVisualEvents(renderer, state);
    state.events = [];
  }

  // --- Main loop ------------------------------------------------------------
  function frame(now) {
    requestAnimationFrame(frame);
    const dtMs = Math.min(100, now - lastT); lastT = now;
    const dt = dtMs / 1000;
    // Movement keys -> input (read every frame, consumed by the fixed steps).
    input.move.f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    input.move.s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    input.move.crouch = !!(keys.KeyC || keys.ControlLeft);
    input.move.jump = !!keys.Space;
    if (mouseDown && locked && state.phase === 'live') {
      const gun = player.weapons[player.slot];
      if (gun && gun.def.auto) tryFire(true);
    }
    player.ads = input.move.ads;
    if (state.phase === 'live' || state.phase === 'buy' || state.phase === 'roundEnd' || state.phase === 'matchEnd') {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= TICK && steps < 3) { tick(state, world, input, TICK); accumulator -= TICK; steps += 1; }
      if (steps === 3) accumulator = 0; // drop backlog rather than spiral
    }
    drainEvents();
    updateHud(hud, state, player);
    renderFrame(renderer, state, player, dt, now / 1000);
    // Footstep ticks while moving.
    if (player.moveMag > 0.4 && state.phase === 'live' && now - lastStepAt > 420 / Math.max(0.4, player.moveMag)) {
      lastStepAt = now; playStep();
    }
  }
  // Test hook (also used by the screenshot harness): the live state plus the
  // two actions a headless browser cannot do through pointer lock.
  window.__game = {
    state, player, world,
    fire: () => tryFire(true),
    throwGrenade: kind => throwGrenade(state, player, kind || player.selectedGrenade),
    buy: (kind, id) => buyItem(state, player, kind, id),
  };
  // Keep the menu scene alive behind the overlay (camera drifts over the yard).
  state.phase = 'menu';
  player.pos.x = 0; player.pos.z = 18; player.yaw = 0; player.pitch = -0.04;
  requestAnimationFrame(frame);
}
