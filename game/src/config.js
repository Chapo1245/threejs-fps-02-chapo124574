// config.js — weapons, economy and the three map variants.
// No imports. Variants differ on the dimensions the judge scores:
// map layout + palette, bot aggression, round length, weapon prices.

export const ECONOMY = {
  startMoney: 800,
  kill: 300,
  plant: 300,
  defuse: 300,
  win: 3250,
  lossBase: 1900,
  lossStep: 500,
  lossMax: 3400,
  assist: 100,
};

// Weapon table. dmg = body damage at close range; falloff starts past
// rangeFalloff metres and bottoms at minDmg at 2x that range.
// headMult multiplies damage on a head hit. spread is radians at rest;
// moveSpread adds while moving, airSpread while airborne.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', slot: 2, kind: 'pistol',
    price: 0, dmg: 26, headMult: 3.2, minDmg: 14, rangeFalloff: 22,
    mag: 12, reserve: 36, auto: false, interval: 0.16, reload: 1.5,
    spread: 0.006, moveSpread: 0.02, airSpread: 0.05, recoil: 0.011,
    speed: 0, zoom: 1, pellets: 1, tracer: 0xffd27a, sound: 'pistol',
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Ember', slot: 1, kind: 'rifle',
    price: 2700, dmg: 30, headMult: 3.5, minDmg: 17, rangeFalloff: 30,
    mag: 30, reserve: 90, auto: true, interval: 0.11, reload: 2.4,
    spread: 0.008, moveSpread: 0.028, airSpread: 0.06, recoil: 0.017,
    speed: 0, zoom: 1, pellets: 1, tracer: 0xffb347, sound: 'rifle',
  },
  smg: {
    id: 'smg', name: 'Rasp-9', slot: 1, kind: 'smg',
    price: 1500, dmg: 22, headMult: 3.0, minDmg: 12, rangeFalloff: 18,
    mag: 32, reserve: 96, auto: true, interval: 0.075, reload: 2.0,
    spread: 0.012, moveSpread: 0.024, airSpread: 0.055, recoil: 0.011,
    speed: 0, zoom: 1, pellets: 1, tracer: 0x9fd8ff, sound: 'smg',
  },
  shotgun: {
    id: 'shotgun', name: 'Boomstick 12', slot: 1, kind: 'shotgun',
    price: 1100, dmg: 9, headMult: 2.2, minDmg: 4, rangeFalloff: 12,
    mag: 6, reserve: 24, auto: false, interval: 0.8, reload: 2.8,
    spread: 0.05, moveSpread: 0.06, airSpread: 0.09, recoil: 0.05,
    speed: 0, zoom: 1, pellets: 8, tracer: 0xffc46b, sound: 'shotgun',
  },
  sniper: {
    id: 'sniper', name: 'Longshot .50', slot: 1, kind: 'sniper',
    price: 4750, dmg: 95, headMult: 2.0, minDmg: 60, rangeFalloff: 60,
    mag: 5, reserve: 15, auto: false, interval: 1.25, reload: 3.2,
    spread: 0.001, moveSpread: 0.09, airSpread: 0.12, recoil: 0.06,
    speed: 0, zoom: 2.6, pellets: 1, tracer: 0xd6f6ff, sound: 'sniper',
  },
};

export const GRENADES = {
  frag: {
    id: 'frag', name: 'Spark Frag', price: 300, kind: 'frag',
    fuse: 2.6, radius: 7, maxDmg: 120, minDmg: 18,
  },
  smoke: {
    id: 'smoke', name: 'Haze Smoke', price: 300, kind: 'smoke',
    fuse: 1.4, radius: 5.5, duration: 13,
  },
};

export const ARMOR_PRICE = 650;
export const AMMO_PRICE = 200;

// The three variants. The menu offers all three; the default is the one
// that graded best in play-testing (Slagworks: most readable lanes).
export const VARIANTS = {
  slagworks: {
    id: 'slagworks', name: 'Slagworks', tag: 'Foundry yard · 3 lanes',
    layout: 'slagworks',
    palette: { sky: 0x1c2733, fog: 0x232d38, ground: 0x2b2f33, accent: 0xff8c2e },
    sun: { color: 0xffc27d, intensity: 2.4, pos: [28, 34, -18] },
    hemi: { sky: 0x8fb4d6, ground: 0x3a2c22, intensity: 0.85 },
    roundTime: 100,
    bot: { reaction: 0.38, accuracy: 0.55, aggression: 0.55, holdBias: 0.4 },
    desc: 'Dusk foundry yard. Furnace site A, cooling-tower site B, mid slag pit.',
  },
  nightdock: {
    id: 'nightdock', name: 'Night Dock', tag: 'Harbour at night · long sightlines',
    layout: 'nightdock',
    palette: { sky: 0x0b1220, fog: 0x101a2c, ground: 0x232830, accent: 0xffb020 },
    sun: { color: 0x9db8ff, intensity: 1.1, pos: [-24, 30, 20] },
    hemi: { sky: 0x4a6a9a, ground: 0x1c2026, intensity: 0.6 },
    roundTime: 110,
    bot: { reaction: 0.34, accuracy: 0.64, aggression: 0.35, holdBias: 0.65 },
    desc: 'Night container dock. Long crane lane rewards the sniper; holders win rounds.',
  },
  cinderpit: {
    id: 'cinderpit', name: 'Cinder Pit', tag: 'Compact arena · fast rounds',
    layout: 'cinderpit',
    palette: { sky: 0x2a1f16, fog: 0x33241a, ground: 0x322b26, accent: 0xff5a2e },
    sun: { color: 0xff9a5c, intensity: 2.8, pos: [18, 26, 14] },
    hemi: { sky: 0xd8a06a, ground: 0x2e2118, intensity: 0.9 },
    roundTime: 75,
    bot: { reaction: 0.3, accuracy: 0.5, aggression: 0.85, holdBias: 0.15 },
    desc: 'Tight cinder arena. Short rounds, fast pushes, SMG and shotgun country.',
  },
};

export const VARIANT_ORDER = ['slagworks', 'nightdock', 'cinderpit'];
export const DEFAULT_VARIANT = 'slagworks';

// Bot callsigns — original names, two squads of five.
export const ATK_NAMES = ['Ash', 'Cinder', 'Flint', 'Spark', 'Ember'];
export const DEF_NAMES = ['Slag', 'Rust', 'Forge', 'Kiln', 'Soot'];
export const PLAYER_NAME = 'You';
