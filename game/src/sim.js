// sim.js — the fixed-step simulation. One tick() per 1/60 s, called by boot.js's
// accumulator. Owns phases (menu/buy/live/roundEnd/matchEnd), round flow, the
// economy, spawning, and the per-tick ordering: input -> bots -> combat ->
// grenades -> bomb -> win checks -> events drain.
import { TICK, ROUND_TARGET, ROUND_TIME, BUY_TIME, ECO, createState, makeActor, makeRng } from './state.js';
import { WEAPONS, GRENADES, makeGun } from './weapons.js';
import { moveActor } from './actors.js';
import { tickGrenades, tickBomb, tryPlant, tryDefuse, startReload, tickReload } from './combat.js';
import { tickBot, assignRoundJobs, makeBotTeam, BOT_NAMES_A, BOT_NAMES_B } from './bots.js';

export function newMatch(mapDef, demo) {
  const state = createState(mapDef);
  state.demo = demo || null;
  // Roster: index 0 is the human (RIVETS attacker); 1-4 bot attackers; 5-9 defenders.
  const namesA = ['You', ...BOT_NAMES_A.slice(0, 4)];
  state.actors.push(makeActor(0, 'You', 'A', true, 0, 20, Math.PI));
  for (let i = 0; i < 4; i++) state.actors.push(makeActor(1 + i, BOT_NAMES_A[i], 'A', false, 0, 20, Math.PI));
  for (let i = 0; i < 5; i++) state.actors.push(makeActor(5 + i, BOT_NAMES_B[i], 'B', false, 0, -19, 0));
  makeBotTeam(state, makeRng(1337));
  return state;
}

export function startRound(state, world) {
  const rng = makeRng(1000 + state.round * 77);
  state.phase = 'buy'; state.phaseT = 0; state.roundTime = ROUND_TIME;
  state.bomb = { state: 'carried', x: 0, z: 0, site: null, timer: 0, planter: null, defuser: null, progress: 0 };
  state.grenades = []; state.smokes = []; state.shots = [];
  state.roundWinner = null; state.roundReason = '';
  // Spawn + reset every actor; keep money, weapons and grenades between rounds.
  for (const a of state.actors) {
    const spawn = state.map.spawns[a.team][a.id % 5];
    a.pos.x = spawn.x; a.pos.z = spawn.z; a.pos.y = 0;
    a.yaw = spawn.yaw; a.pitch = 0; a.vel.x = 0; a.vel.z = 0;
    a.hp = 100; a.alive = true; a.crouch = false; a.flash = 0;
    a.planting = 0; a.defusing = 0; a.hasSpike = false;
    if (a.weapons.length === 0) {
      a.weapons = [makeGun('sidearm'), makeGun('rifle')];
      a.slot = 1; a.grenades = { frag: 1, smoke: 0, flash: 0 };
    } else {
      for (const g of a.weapons) { g.mag = g.def.mag; g.reserve = g.def.reserve; g.reloading = 0; g.bloom = 0; }
    }
    if (a.bot) { a.bot.state = 'route'; a.bot.target = null; a.bot.path = []; a.bot.threwGrenade = false; }
  }
  assignRoundJobs(state, rng);
  botBuy(state);
  state.events.push({ type: 'roundStart', round: state.round, site: state.targetSite });
}

// Buy one item for an actor (player via menu, bots auto-buy at round start).
export function buyItem(state, actor, kind, id) {
  if (state.phase !== 'buy') return false;
  if (kind === 'weapon') {
    const def = WEAPONS[id];
    if (!def || actor.money < def.price) return false;
    if (actor.weapons.some(g => g.id === id)) return false;
    actor.money -= def.price;
    actor.weapons.push(makeGun(id));
    actor.slot = actor.weapons.length - 1;
    return true;
  }
  if (kind === 'grenade') {
    const def = GRENADES[id];
    if (!def || actor.money < def.price || actor.grenades[id] >= 2) return false;
    actor.money -= def.price; actor.grenades[id] += 1;
    return true;
  }
  if (kind === 'kit') {
    if (id === 'kevlar') {
      if (actor.money < 650 || actor.armor >= 100) return false;
      actor.money -= 650; actor.armor = 100; return true;
    }
    if (id === 'defuseKit') {
      if (actor.money < 400 || actor.hasKit) return false;
      actor.money -= 400; actor.hasKit = true; return true;
    }
  }
  return false;
}

// Bots spend their money simply: rifle if they can afford it, kevlar, a frag.
export function botBuy(state) {
  for (const a of state.actors) {
    if (a.isPlayer || !a.alive) continue;
    if (!a.weapons.some(g => g.id === 'rifle') && a.money >= 2700) buyItem(state, a, 'weapon', 'rifle');
    else if (!a.weapons.some(g => g.id === 'smg') && a.money >= 1500) buyItem(state, a, 'weapon', 'smg');
    if (a.money >= 650 && a.armor < 50) buyItem(state, a, 'kit', 'kevlar');
    if (a.money >= 300 && a.grenades.frag < 1) buyItem(state, a, 'grenade', 'frag');
    if (a.team === 'B' && a.money >= 400 && !a.hasKit) buyItem(state, a, 'kit', 'defuseKit');
  }
}

export function award(state, actor, amount, why) {
  actor.money += amount;
  state.events.push({ type: 'award', actor, amount, why });
}

// --- Win checks --------------------------------------------------------------
function aliveCount(state, team) {
  return state.actors.filter(a => a.team === team && a.alive).length;
}

function endRound(state, winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd'; state.phaseT = 0;
  state.roundWinner = winner; state.roundReason = reason;
  state.score[winner] += 1;
  const loser = winner === 'A' ? 'B' : 'A';
  // Economy: winners +$3,250, losers +$1,900 (+$500 per consecutive loss).
  state.lossStreak[loser] += 1; state.lossStreak[winner] = 0;
  for (const a of state.actors) {
    if (a.team === winner) award(state, a, ECO.win, 'round win');
    else award(state, a, ECO.loss + ECO.lossStreak * Math.min(2, state.lossStreak[loser] - 1), 'round loss');
  }
  if (state.score[winner] >= ROUND_TARGET) {
    state.phase = 'matchEnd'; state.winner = winner;
    state.events.push({ type: 'matchEnd', winner });
  } else {
    state.events.push({ type: 'roundEnd', winner, reason });
  }
}

function checkRoundEnd(state) {
  if (state.phase !== 'live') return;
  const bomb = state.bomb;
  if (bomb.state === 'detonated') { endRound(state, 'A', 'Spike detonated — the yard is gone'); return; }
  if (bomb.state === 'defused') { endRound(state, 'B', 'Spike defused — site held'); return; }
  const aAlive = aliveCount(state, 'A'), bAlive = aliveCount(state, 'B');
  if (bAlive === 0 && bomb.state !== 'planted') { endRound(state, 'A', 'All Wardens eliminated'); return; }
  if (aAlive === 0) {
    if (bomb.state === 'planted') return; // defenders must still defuse
    endRound(state, 'B', 'All Rivets eliminated');
    return;
  }
  if (state.roundTime <= 0) {
    if (bomb.state === 'planted') return; // play out the fuse
    endRound(state, 'B', 'Time expired — defenders hold the yard');
  }
}

// --- The tick ----------------------------------------------------------------
export function tick(state, world, input, dt) {
  state.time += dt; state.tickCount += 1;
  state.phaseT += dt;
  if (state.phase === 'menu') return;
  if (state.phase === 'buy') {
    if (state.phaseT >= BUY_TIME) { state.phase = 'live'; state.phaseT = 0; state.events.push({ type: 'live' }); }
    return;
  }
  if (state.phase === 'roundEnd') {
    if (state.phaseT >= 4.5) { state.round += 1; startRound(state, world); }
    return;
  }
  if (state.phase === 'matchEnd') return;
  // --- live ---
  state.roundTime -= dt;
  if (state.roundTime <= 0) state.roundTime = 0;

  // Player input -> movement (input.js builds this object each frame).
  const player = state.actors[0];
  if (player.alive && input) {
    moveActor(player, input.move, dt, world.colliders);
    player.yaw = input.yaw; player.pitch = input.pitch;
    if (input.plant) {
      if (player.hasSpike) tryPlant(state, player, dt);
      else tryDefuse(state, player, dt);
    } else { player.planting = 0; player.defusing = 0; }
    tickReload(player, dt);
    if (player.flash > 0) player.flash = Math.max(0, player.flash - dt);
  }
  // Bots.
  const rng = makeRng(state.tickCount * 31 + 7);
  for (const a of state.actors) {
    if (!a.isPlayer) tickBot(state, world, a, dt, rng);
    if (a.alive) tickReload(a, dt);
  }
  // Grenades + bomb.
  tickGrenades(state, world, dt);
  if (state.smokes) {
    for (const s of state.smokes) s.t += dt;
    state.smokes = state.smokes.filter(s => s.t < GRENADES.smoke.duration);
  }
  tickBomb(state, dt);
  // Kill economy: credit $300 the moment a kill event lands. Snapshot first:
  // award() appends 'award' events to the same array we are reading.
  const landed = state.events.slice();
  for (const e of landed) {
    if (e.type === 'kill' && e.killer) award(state, e.killer, ECO.kill, 'elimination');
    if (e.type === 'planted') award(state, e.actor, ECO.plant, 'spike planted');
    if (e.type === 'defused') award(state, e.actor, ECO.defuse, 'spike defused');
  }
  checkRoundEnd(state);
  // Hearing events are consumed by this tick's bots; drop them now.
  state.shots = [];
}
