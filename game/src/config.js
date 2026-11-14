// config.js — every tunable number in one place: tick, rounds, economy,
// weapons, movement, bot behaviour. Nothing here imports three.js.

export const TICK = 1 / 60; // fixed simulation step
export const ROUND_TIME = 100; // seconds of live play per round
export const BUY_TIME = 15; // seconds of buy phase
export const PLANT_TIME = 3; // seconds holding E to plant
export const DEFUSE_TIME = 5; // seconds holding E to defuse
export const BOMB_TIMER = 35; // seconds from plant to detonation
export const ROUNDS_TO_WIN = 8;
export const MAX_ROUNDS = 15;
export const TEAM_SIZE = 5; // player + 4 bots vs 5 bots

export const ECONOMY = {
  startMoney: 800,
  winBonus: 3250,
  lossBonus: 1900,
  lossStreakStep: 500,
  lossStreakMax: 3400,
  killBonus: 300,
  plantBonus: 300,
  defuseBonus: 300,
  armorPrice: 650,
};

// Weapons. damage = body damage at close range; headMult multiplies on a
// head hit; spread is degrees of half-angle; recoil is view kick in degrees.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, slot: 1, auto: false,
    damage: 34, headMult: 3, range: 55, falloff: 0.55,
    mag: 12, reserve: 36, interval: 0.32, reload: 1.4,
    spread: 0.9, moveSpread: 1.6, airSpread: 5, adsSpread: 0.35,
    recoil: 0.55, bloom: 0.35, zoom: 1.0, pellets: 1, tracer: 0xffd166,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', price: 2700, slot: 1, auto: true,
    damage: 33, headMult: 3, range: 90, falloff: 0.6,
    mag: 30, reserve: 90, interval: 0.1, reload: 2.2,
    spread: 0.7, moveSpread: 2.4, airSpread: 6, adsSpread: 0.3,
    recoil: 0.9, bloom: 0.5, zoom: 1.35, pellets: 1, tracer: 0xffe08a,
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', price: 1500, slot: 1, auto: true,
    damage: 26, headMult: 3, range: 45, falloff: 0.5,
    mag: 32, reserve: 96, interval: 0.075, reload: 1.9,
    spread: 1.1, moveSpread: 2.0, airSpread: 5, adsSpread: 0.35,
    recoil: 0.5, bloom: 0.4, zoom: 1.15, pellets: 1, tracer: 0x9fd8ff,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', price: 3200, slot: 1, auto: false,
    damage: 88, headMult: 3.5, range: 140, falloff: 0.8,
    mag: 10, reserve: 30, interval: 0.9, reload: 2.8,
    spread: 0.25, moveSpread: 4.5, airSpread: 8, adsSpread: 0.12,
    recoil: 2.6, bloom: 1.4, zoom: 2.4, pellets: 1, tracer: 0xffffff,
  },
  breacher: {
    id: 'breacher', name: 'Breacher Shotgun', price: 1100, slot: 1, auto: false,
    damage: 14, headMult: 2, range: 22, falloff: 0.35,
    mag: 6, reserve: 24, interval: 0.8, reload: 2.6,
    spread: 3.2, moveSpread: 3.5, airSpread: 6, adsSpread: 0.5,
    recoil: 2.2, bloom: 1.2, zoom: 1.0, pellets: 8, tracer: 0xffb36b,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, key: '4', radius: 7, damage: 95 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, key: '5', radius: 5.5, life: 14 },
  flash: { id: 'flash', name: 'Flashbang', price: 200, key: '6', radius: 16, blind: 2.6 },
};

export const MOVE = {
  walkSpeed: 4.3,
  sprintSpeed: 5.7,
  crouchSpeed: 2.2,
  adsSpeed: 3.1,
  accel: 42,
  friction: 11,
  airAccel: 8,
  jumpSpeed: 5.4,
  gravity: 14.5,
  radius: 0.38,
  eyeStand: 1.62,
  eyeCrouch: 1.08,
  eyeHeight: 1.7, // body height for hit tests
};

// Bot tuning. Two profiles ship: HOLD (patient, angle-holding defenders)
// and PUSH (fast, lane-rushing attackers). The match default is HOLD for
// defenders and PUSH for attackers; ?ai=hold|push forces one for testing.
export const BOT = {
  reactionMin: 0.32,
  reactionMax: 0.65,
  aimErrorBase: 1.6, // degrees of aim error at 10 m
  aimErrorPerMetre: 0.05,
  burstMin: 3,
  burstMax: 6,
  burstPauseMin: 0.5,
  burstPauseMax: 1.1,
  hearRadius: 42, // gunshots heard this far away
  seeRange: 62,
  fovCos: 0.42, // cos of half the field of view (~65 deg)
  walkSpeed: 3.6,
  runSpeed: 4.6,
  holdTimeMin: 4,
  holdTimeMax: 9,
};

// Dusk palette for Yard 7: rust containers, cold blue ground, amber lights.
export const PALETTE = {
  sky: 0x2b3247,
  fog: 0x2b3247,
  ground: 0x3a4150,
  groundLine: 0x2c3240,
  wall: 0x4a4f5c,
  wallDark: 0x333845,
  containerRust: 0xb4552d,
  containerTeal: 0x2e7f7a,
  containerBlue: 0x35598c,
  containerOchre: 0xc98a2e,
  crate: 0x8a6b42,
  barrel: 0x7a3b2e,
  crane: 0xd8a13c,
  siteA: 0xffb454,
  siteB: 0x6ea8ff,
  vanguard: 0x3b82f6,
  jackal: 0xf59e0b,
  lamp: 0xffc978,
};
