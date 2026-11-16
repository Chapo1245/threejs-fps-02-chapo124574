// weapons.js — every gun, grenade and piece of kit in the buy menu, plus the
// pure firing math (spread, recoil, damage falloff). No rendering here: combat.js
// turns a shot into a ray, bots.js asks for the same numbers for bot accuracy.
export const WEAPONS = {
  // id: {name, price, damage, headMul, rpm, mag, reserve, spread, moveSpread,
  //      recoil, zoom (ADS fov), range, auto, kick (view kick per shot)}
  sidearm: { name: 'P9 SIDEARM', price: 0, damage: 34, headMul: 2.0, rpm: 380, mag: 12, reserve: 48, spread: 0.011, moveSpread: 0.030, recoil: 0.006, zoom: 1.0, range: 42, auto: false, kick: 0.010, reload: 1.4 },
  smg: { name: 'VK-9 SMG', price: 1500, damage: 26, headMul: 1.8, rpm: 750, mag: 32, reserve: 128, spread: 0.016, moveSpread: 0.034, recoil: 0.005, zoom: 1.0, range: 34, auto: true, kick: 0.008, reload: 1.9 },
  rifle: { name: 'AR-77 RIFLE', price: 2700, damage: 33, headMul: 2.2, rpm: 600, mag: 30, reserve: 90, spread: 0.008, moveSpread: 0.026, recoil: 0.009, zoom: 1.15, range: 60, auto: true, kick: 0.014, reload: 2.2 },
  marksman: { name: 'DMR-12 MARKSMAN', price: 4200, damage: 78, headMul: 2.5, rpm: 90, mag: 10, reserve: 30, spread: 0.002, moveSpread: 0.045, recoil: 0.030, zoom: 2.2, range: 90, auto: false, kick: 0.05, reload: 2.8 },
  shotgun: { name: 'M590 BREACHER', price: 1800, damage: 13, headMul: 1.6, rpm: 70, mag: 6, reserve: 30, spread: 0.042, moveSpread: 0.05, recoil: 0.022, zoom: 1.0, range: 18, auto: false, kick: 0.035, reload: 2.6, pellets: 8 },
};

export const GRENADES = {
  frag: { name: 'FRAG GRENADE', price: 300, radius: 6.5, damage: 110, fuse: 1.6 },
  smoke: { name: 'SMOKE GRENADE', price: 300, radius: 5, duration: 14 },
  flash: { name: 'FLASHBANG', price: 200, radius: 16, duration: 2.6 },
};

export const KIT = {
  kevlar: { name: 'KEVLAR VEST', price: 650, note: 'Halves all damage taken' },
  defuseKit: { name: 'DEFUSE KIT', price: 400, note: 'Defuse in 2.5s instead of 5s' },
};

export const BUY_LIST = [
  { kind: 'weapon', id: 'smg', key: '1' },
  { kind: 'weapon', id: 'rifle', key: '2' },
  { kind: 'weapon', id: 'shotgun', key: '3' },
  { kind: 'weapon', id: 'marksman', key: '4' },
  { kind: 'grenade', id: 'frag', key: '5' },
  { kind: 'grenade', id: 'smoke', key: '6' },
  { kind: 'grenade', id: 'flash', key: '7' },
  { kind: 'kit', id: 'kevlar', key: '8' },
  { kind: 'kit', id: 'defuseKit', key: '9' },
];

// A live gun instance on an actor: ammo state + transient recoil/spread bloom.
export function makeGun(id) {
  const def = WEAPONS[id];
  return { id, def, mag: def.mag, reserve: def.reserve, reloading: 0, bloom: 0, lastShot: -99, burst: 0 };
}

// Spread in radians for a shot: base + movement + air + bloom, reduced by ADS/crouch.
// Standing still and aiming down sights is how you win a duel — by design.
export function shotSpread(gun, actor, ads) {
  const def = gun.def;
  let s = def.spread + gun.bloom;
  s += def.moveSpread * actor.moveMag;
  if (!actor.onGround) s += 0.03;
  if (actor.crouch) s *= 0.55;
  if (ads) s *= 0.55;
  return s;
}

// Damage at range with falloff and the headshot multiplier; kevlar halves it.
export function shotDamage(gun, distance, headshot, target) {
  const def = gun.def;
  let fall = 1;
  if (distance > def.range * 0.6) fall = 1 - 0.45 * ((distance - def.range * 0.6) / (def.range * 0.4));
  let dmg = def.damage * (headshot ? def.headMul : 1) * Math.max(0.55, fall);
  if (target.armor > 0) dmg *= 0.5;
  return dmg;
}

// Seconds between shots for this gun.
export function shotInterval(gun) { return 60 / gun.def.rpm; }

// Recoil: each shot adds kick to the shooter's pitch and bloom to the spread;
// bloom decays in sim.tick. Returns the pitch kick in radians.
export function applyRecoil(gun) {
  gun.bloom = Math.min(0.05, gun.bloom + gun.def.recoil * 0.55);
  return gun.def.kick;
}
export function decayBloom(gun, dt) { gun.bloom = Math.max(0, gun.bloom - dt * 0.045); }
