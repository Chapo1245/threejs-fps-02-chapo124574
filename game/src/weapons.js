// weapons.js — everything about shooting: the spread model, recoil,
// reload, and grenade throws. Hit detection itself lives in combat.js;
// this module decides WHEN a shot happens and WHAT it costs.
import { WEAPONS, GRENADES, MOVE } from './config.js';
import { clamp } from './util.js';

/** The weapon an actor currently holds, with its live ammo. */
export function weaponOf(actor) {
  return WEAPONS[actor.weapon];
}

/** Current spread in degrees, before the shot's random roll. */
export function currentSpread(actor) {
  const w = weaponOf(actor);
  let s = w.spread;
  if (actor.ads) s *= w.adsSpread;
  // Moving punishes accuracy; airborne punishes it much more.
  const moveFrac = clamp(actor.speed2d / MOVE.walkSpeed, 0, 1.4);
  s += w.moveSpread * moveFrac;
  if (!actor.onGround) s += w.airSpread;
  s += actor.bloom;
  return s;
}

/** Can this actor fire right now? (Cooldown, ammo, reloading, blind.) */
export function canFire(actor, now) {
  if (!actor.alive) return false;
  if (now < actor.reloadingUntil) return false;
  if (now - actor.lastShot < weaponOf(actor).interval) return false;
  if (actor.mag <= 0) return false;
  if (now < actor.blindUntil) return false;
  return true;
}

/** Start a reload; the mag refills when the timer expires (see tickReload). */
export function startReload(actor, now) {
  const w = weaponOf(actor);
  if (actor.mag >= w.mag || actor.reserve <= 0) return false;
  if (now < actor.reloadingUntil) return false;
  actor.reloadingUntil = now + w.reload;
  return true;
}

/** Complete a pending reload. Call every tick. */
export function tickReload(actor, now) {
  if (actor.reloadingUntil > 0 && now >= actor.reloadingUntil) {
    const w = weaponOf(actor);
    const need = w.mag - actor.mag;
    const take = Math.min(need, actor.reserve);
    actor.mag += take;
    actor.reserve -= take;
    actor.reloadingUntil = 0;
    return true;
  }
  return false;
}

/**
 * Fire one trigger pull. Consumes ammo, applies recoil + bloom, and returns
 * the shot description the caller resolves (spread roll happens here so the
 * sim and the tracer agree): { ok, pellets, spreadDeg, origin }.
 * The caller supplies the muzzle origin; direction comes from the actor's
 * yaw/pitch plus a random cone offset per pellet.
 */
export function fireWeapon(actor, now, rng) {
  if (!canFire(actor, now)) return { ok: false };
  const w = weaponOf(actor);
  actor.mag -= 1;
  actor.lastShot = now;
  actor.recoilPitch += (w.recoil * Math.PI) / 180;
  actor.bloom = Math.min(4.5, actor.bloom + w.bloom);
  const spreadDeg = currentSpread(actor);
  const pellets = [];
  for (let i = 0; i < w.pellets; i++) {
    // Uniform random point in a disc of radius spreadDeg (degrees).
    const r = spreadDeg * Math.sqrt(rng());
    const t = rng() * Math.PI * 2;
    pellets.push({ dyaw: (r * Math.cos(t) * Math.PI) / 180, dpitch: (r * Math.sin(t) * Math.PI) / 180 });
  }
  return { ok: true, pellets, spreadDeg };
}

/** Give an actor a full loadout for a weapon id (buy / round start). */
export function giveWeapon(actor, weaponId) {
  const w = WEAPONS[weaponId];
  actor.weapon = weaponId;
  actor.mag = w.mag;
  actor.reserve = w.reserve;
  actor.reloadingUntil = 0;
  actor.bloom = 0;
}

/** Throw a grenade: returns its flight params, or null when none carried. */
export function throwGrenade(actor, kind, now) {
  if (!GRENADES[kind]) return null;
  if ((actor.grenades[kind] ?? 0) <= 0) return null;
  actor.grenades[kind] -= 1;
  const yaw = actor.yaw;
  const pitch = actor.pitch;
  // Lob forward from the hand, slightly up; speed scales with aim.
  const speed = 13 + Math.max(0, -pitch) * 4;
  return {
    kind,
    x: actor.x - Math.sin(yaw) * 0.5,
    y: actor.y + 1.35,
    z: actor.z - Math.cos(yaw) * 0.5,
    vx: -Math.sin(yaw) * Math.cos(pitch) * speed,
    vy: Math.sin(pitch) * speed + 2.2,
    vz: -Math.cos(yaw) * Math.cos(pitch) * speed,
    at: now,
    owner: actor.id,
    team: actor.team,
  };
}

/** What the buy menu offers right now, with affordability. */
export function buyOptions(actor) {
  const items = [];
  for (const w of Object.values(WEAPONS)) {
    if (w.id === 'p9') continue;
    items.push({ kind: 'weapon', id: w.id, name: w.name, price: w.price, owned: actor.weapon === w.id, afford: actor.money >= w.price });
  }
  for (const g of Object.values(GRENADES)) {
    items.push({ kind: 'grenade', id: g.id, name: g.name, price: g.price, owned: false, afford: actor.money >= g.price });
  }
  items.push({ kind: 'armor', id: 'armor', name: 'Kevlar Vest', price: 650, owned: actor.armor > 0, afford: actor.money >= 650 });
  return items;
}

/** Buy one item; returns true when the purchase went through. */
export function buyItem(actor, id) {
  if (id === 'armor') {
    if (actor.armor > 0 || actor.money < 650) return false;
    actor.money -= 650;
    actor.armor = 100;
    return true;
  }
  const w = WEAPONS[id];
  if (w) {
    if (actor.money < w.price) return false;
    actor.money -= w.price;
    giveWeapon(actor, id);
    return true;
  }
  const g = GRENADES[id];
  if (g) {
    if (actor.money < g.price) return false;
    actor.money -= g.price;
    actor.grenades[g.id] = (actor.grenades[g.id] ?? 0) + 1;
    return true;
  }
  return false;
}
