// rounds.js — the match clock: buy phase, live round, plant and defuse
// progress, round end (elimination, plant, defuse, timeout), economy
// awards, and the match end at 8 rounds. One function per transition;
// boot.js calls stepRounds every fixed tick.
import {
  ROUND_TIME, BUY_TIME, PLANT_TIME, DEFUSE_TIME, BOMB_TIMER,
  ROUNDS_TO_WIN, MAX_ROUNDS, ECONOMY, WEAPONS,
} from './config.js';
import { PHASE, pushEvent, awardTeam, aliveOf } from './state.js';
import { assignAttackRoute, assignDefendHold } from './bots.js';
import { giveWeapon } from './weapons.js';

/** Put every actor on its spawn point, alive, with a fresh loadout. */
export function spawnActors(S, map, rng) {
  const vSpawns = map.spawns.V;
  const jSpawns = map.spawns.J;
  let vi = 0;
  let ji = 0;
  for (const a of S.actors) {
    const sp = a.team === 'V' ? vSpawns[vi++ % vSpawns.length] : jSpawns[ji++ % jSpawns.length];
    a.x = sp[0] + (rng() - 0.5) * 0.8;
    a.z = sp[1] + (rng() - 0.5) * 0.8;
    a.y = 0;
    a.vy = 0;
    a.yaw = sp[2];
    a.pitch = 0;
    a.vx = 0;
    a.vz = 0;
    a.alive = true;
    a.hp = 100;
    a.fallen = false;
    a.planting = 0;
    a.defusing = 0;
    a.blindUntil = 0;
    a.recoilPitch = 0;
    a.bloom = 0;
    a.reloadingUntil = 0;
    a.grenades = { frag: 0, smoke: 0, flash: 0 };
    if (a.isPlayer) {
      // The player keeps what they bought; only the sidearm is guaranteed.
      if (!WEAPONS[a.weapon]) giveWeapon(a, 'p9');
      else {
        const w = WEAPONS[a.weapon];
        a.mag = w.mag;
        a.reserve = w.reserve;
      }
    } else {
      // Bots buy what they can afford: rifle when rich, SMG otherwise.
      const pick = a.money >= 2700 ? 'vk47' : a.money >= 1500 ? 'hornet' : 'p9';
      giveWeapon(a, pick);
      if (a.money >= 650 && rng() < 0.5) {
        a.money -= 650;
        a.armor = 100;
      } else {
        a.armor = 0;
      }
    }
    if (a.brain) {
      a.brain.target = null;
      a.brain.state = a.team === 'V' ? 'route' : 'hold';
      a.brain.routeIdx = 0;
      a.brain.dest = null;
      a.brain.burstLeft = 0;
      a.brain.thinkAt = 0;
    }
  }
  // Assign sites and routes: attackers split across the lanes, defenders
  // cover A, B and mid. The bomb starts with the player.
  const attackers = S.actors.filter((a) => a.team === 'V' && !a.isPlayer);
  const sites = ['A', 'A', 'B', 'B'];
  attackers.forEach((a, i) => {
    if (a.brain) a.brain.site = sites[i % sites.length];
  });
  S.player.hasBomb = true;
  S.player.brain = null;
  S.bomb.state = 'carried';
  S.bomb.site = null;
  S.bomb.timer = 0;
  S.bomb.carrierId = 'you';
  const defenders = S.actors.filter((a) => a.team === 'J');
  defenders.forEach((a, i) => {
    if (a.brain) a.brain.site = ['A', 'B', 'mid', 'A', 'B'][i % 5];
  });
  for (const a of S.actors) {
    if (!a.brain) continue;
    if (a.team === 'V') assignAttackRoute(S, map, a, rng);
    else assignDefendHold(S, map, a, rng);
  }
}

/** Start a round: buy phase first. */
export function startRound(S, map, rng) {
  spawnActors(S, map, rng);
  S.phase = PHASE.BUY;
  S.timer = BUY_TIME;
  S.buyPhase = true;
  S.bomb.state = 'carried';
  pushEvent(S, 'roundStart', { round: S.round });
}

/** The live round begins when the buy clock runs out. */
function startLive(S) {
  S.phase = PHASE.LIVE;
  S.timer = ROUND_TIME;
  S.buyPhase = false;
  pushEvent(S, 'liveStart', { round: S.round });
}

/** End the round, award money, and show the result. */
export function endRound(S, winner, reason) {
  S.phase = PHASE.ROUND_END;
  S.timer = 5;
  S.roundReason = reason;
  const loser = winner === 'V' ? 'J' : 'V';
  S.score[winner] += 1;
  S.lossStreak[winner] = 0;
  S.lossStreak[loser] += 1;
  const lossBonus = Math.min(
    ECONOMY.lossStreakMax,
    ECONOMY.lossBonus + (S.lossStreak[loser] - 1) * ECONOMY.lossStreakStep,
  );
  awardTeam(S, winner, ECONOMY.winBonus);
  awardTeam(S, loser, lossBonus);
  pushEvent(S, 'roundEnd', { winner, reason, score: { ...S.score } });
  // The bomb carrier keeps the bomb for the next round; a dropped bomb
  // returns to the player at spawn.
  if (S.bomb.state === 'dropped') {
    S.bomb.state = 'carried';
    S.bomb.carrierId = 'you';
  }
  if (S.score[winner] >= ROUNDS_TO_WIN || S.round >= MAX_ROUNDS) {
    S.phase = PHASE.MATCH_END;
    S.matchWinner = S.score.V === S.score.J ? null : S.score.V > S.score.J ? 'V' : 'J';
    pushEvent(S, 'matchEnd', { winner: S.matchWinner, score: { ...S.score } });
  }
}

/** Plant progress: any attacker standing in a site holding E (or a bot). */
function stepPlant(S, map, dt) {
  const bomb = S.bomb;
  if (bomb.state !== 'carried' && bomb.state !== 'dropped') return;
  for (const a of S.actors) {
    if (!a.alive || a.team !== 'V') continue;
    if (!a.planting) {
      a.plantProgress = 0;
      continue;
    }
    const site = Object.values(map.sites).find(
      (s) => a.x >= s.x0 && a.x <= s.x1 && a.z >= s.z0 && a.z <= s.z1,
    );
    if (!site) {
      a.planting = 0;
      a.plantProgress = 0;
      continue;
    }
    a.plantProgress = (a.plantProgress ?? 0) + dt;
    if (a.plantProgress >= PLANT_TIME) {
      bomb.state = 'planted';
      bomb.site = site === map.sites.A ? 'A' : 'B';
      bomb.x = a.x;
      bomb.z = a.z;
      bomb.timer = BOMB_TIMER;
      bomb.planterId = a.id;
      a.hasBomb = false;
      a.planting = 0;
      a.plantProgress = 0;
      a.money += ECONOMY.plantBonus;
      pushEvent(S, 'bombPlanted', { site: bomb.site, by: a.id });
    }
  }
}

/** Defuse progress: any defender standing at the bomb holding E (or a bot). */
function stepDefuse(S, dt) {
  const bomb = S.bomb;
  if (bomb.state !== 'planted') return;
  for (const a of S.actors) {
    if (!a.alive || a.team !== 'J') continue;
    if (!a.defusing) {
      a.defuseProgress = 0;
      continue;
    }
    const d = Math.hypot(a.x - bomb.x, a.z - bomb.z);
    if (d > 2.6) {
      a.defusing = 0;
      a.defuseProgress = 0;
      continue;
    }
    a.defuseProgress = (a.defuseProgress ?? 0) + dt;
    if (a.defuseProgress >= DEFUSE_TIME) {
      bomb.state = 'defused';
      a.money += ECONOMY.defuseBonus;
      pushEvent(S, 'bombDefused', { by: a.id });
      endRound(S, 'J', 'Bomb defused');
    }
  }
}

/** A teammate can pick the dropped bomb up by walking over it. */
function stepBombPickup(S, dt) {
  const bomb = S.bomb;
  if (bomb.state !== 'dropped') return;
  for (const a of S.actors) {
    if (!a.alive || a.team !== 'V') continue;
    if (Math.hypot(a.x - bomb.x, a.z - bomb.z) < 1.2) {
      a.hasBomb = true;
      bomb.state = 'carried';
      bomb.carrierId = a.id;
      pushEvent(S, 'bombPickup', { by: a.id });
      return;
    }
  }
}

/** The round clock and every end condition, run once per fixed tick. */
export function stepRounds(S, map, dt) {
  if (S.phase === PHASE.BUY) {
    S.timer -= dt;
    if (S.timer <= 0) startLive(S);
    return;
  }
  if (S.phase !== PHASE.LIVE) return;
  S.timer -= dt;
  stepPlant(S, map, dt);
  stepDefuse(S, dt);
  stepBombPickup(S, dt);
  if (S.phase !== PHASE.LIVE) return; // defuse may have ended the round
  if (S.bomb.state === 'planted') {
    S.bomb.timer -= dt;
    if (S.bomb.timer <= 0) {
      S.bomb.state = 'exploded';
      pushEvent(S, 'bombExploded', { site: S.bomb.site });
      endRound(S, 'V', 'Bomb detonated');
      return;
    }
  }
  const aliveV = aliveOf(S, 'V');
  const aliveJ = aliveOf(S, 'J');
  if (aliveV === 0 && S.bomb.state !== 'planted') {
    // With the bomb planted the round plays on: defenders must defuse it.
    endRound(S, 'J', 'Attackers eliminated');
    return;
  }
  if (aliveJ === 0) {
    endRound(S, 'V', 'Defenders eliminated');
    return;
  }
  if (S.timer <= 0) {
    // Time out: defenders win unless the bomb is ticking.
    if (S.bomb.state === 'planted') return; // the bomb timer decides
    endRound(S, 'J', 'Time expired — site held');
  }
}

/** Advance to the next round after the result screen. */
export function nextRound(S, map, rng) {
  if (S.phase === PHASE.MATCH_END) {
    S.round = 1;
    S.score.V = 0;
    S.score.J = 0;
    S.lossStreak.V = 0;
    S.lossStreak.J = 0;
    S.matchWinner = null;
    for (const a of S.actors) a.money = ECONOMY.startMoney;
  } else {
    S.round += 1;
  }
  startRound(S, map, rng);
}
