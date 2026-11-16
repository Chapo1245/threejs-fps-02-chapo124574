// weapons.js — the arsenal: firing, recoil, spread, reload, ammo,
// grenades, and the buy shop. Pure-ish logic: it owns weapon state
// per fighter (player or bot) and asks combat.js to resolve shots.
// Stopping to aim pays: spread = base + move * speed + air, and
// recoil blooms with consecutive shots, recovering when you pause.

import { WEAPONS, GRENADES, ARMOR_PRICE, AMMO_PRICE } from './config.js';
import { clamp } from './state.js';

export function makeLoadout(startWeapon) {
  return {
    primary: startWeapon || 'rifle',
    secondary: 'pistol',
    slot: 1,            // 1 primary, 2 pistol, 3 grenade
    lastSlot: 2,
    grenades: { frag: 0, smoke: 0 },
    grenadeSel: 'frag',
    ammo: {},           // id -> {mag, reserve}
    cooldown: 0,
    reloadT: 0,
    reloading: null,
    bloom: 0,           // recoil bloom 0..1
    scoped: false,
    throwT: 0,
  };
}

export function initAmmo(loadout) {
  for (const id of ['pistol', 'rifle', 'smg', 'shotgun', 'sniper']) {
    const w = WEAPONS[id];
    loadout.ammo[id] = { mag: w.mag, reserve: w.reserve };
  }
}

export function currentWeapon(loadout) {
  if (loadout.slot === 2) return WEAPONS.pistol;
  if (loadout.slot === 3) return null;
  return WEAPONS[loadout.primary] || WEAPONS.pistol;
}

export function switchSlot(loadout, slot) {
  if (slot === 'last') {
    const t = loadout.slot; loadout.slot = loadout.lastSlot; loadout.lastSlot = t;
  } else if (slot === 'next' || slot === 'prev') {
    const order = [1, 2, 3];
    let i = order.indexOf(loadout.slot);
    i = (i + (slot === 'next' ? 1 : order.length - 1)) % order.length;
    loadout.lastSlot = loadout.slot;
    loadout.slot = order[i];
  } else if (slot >= 1 && slot <= 3) {
    if (slot !== loadout.slot) { loadout.lastSlot = loadout.slot; loadout.slot = slot; }
  }
  loadout.reloading = null; loadout.reloadT = 0;
  loadout.scoped = false;
  return currentWeapon(loadout);
}

// Spread in radians for this fighter right now.
export function currentSpread(w, moveMag, airborne, bloom, scoped) {
  let s = w.spread + w.moveSpread * moveMag + (airborne ? w.airSpread : 0);
  s += bloom * 0.02;
  if (scoped) s *= 0.25;
  return s;
}

export function tickLoadout(loadout, dt) {
  loadout.cooldown = Math.max(0, loadout.cooldown - dt);
  loadout.throwT = Math.max(0, loadout.throwT - dt);
  loadout.bloom = Math.max(0, loadout.bloom - dt * 1.6);
  if (loadout.reloading) {
    loadout.reloadT -= dt;
    if (loadout.reloadT <= 0) {
      const w = WEAPONS[loadout.reloading];
      const a = loadout.ammo[loadout.reloading];
      const need = w.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
      loadout.reloading = null;
    }
  }
}

export function startReload(loadout, sfx) {
  const w = currentWeapon(loadout);
  if (!w || loadout.reloading) return false;
  const a = loadout.ammo[w.id];
  if (a.mag >= w.mag || a.reserve <= 0) return false;
  loadout.reloading = w.id;
  loadout.reloadT = w.reload;
  if (sfx) sfx.reload();
  return true;
}

// Returns 'fired' | 'dry' | 'reload' | 'cool' | 'throw' | null.
export function tryFire(loadout, w, sfx) {
  if (!w) return null;
  if (loadout.cooldown > 0 || loadout.reloading) return 'cool';
  const a = loadout.ammo[w.id];
  if (a.mag <= 0) {
    loadout.cooldown = 0.25;
    if (sfx) sfx.dryFire();
    return 'dry';
  }
  a.mag -= 1;
  loadout.cooldown = w.interval;
  loadout.bloom = clamp(loadout.bloom + (w.kind === 'sniper' ? 0.9 : w.kind === 'shotgun' ? 0.7 : 0.22), 0, 1);
  return 'fired';
}

export function throwGrenade(loadout, kind) {
  if (loadout.grenades[kind] <= 0 || loadout.throwT > 0) return null;
  loadout.grenades[kind] -= 1;
  loadout.throwT = 0.6;
  return GRENADES[kind];
}

// --- Buy shop ---------------------------------------------------------
// items: id -> {label, price, group}. Groups keep each decision point
// at four options or fewer (≤4 visible choices per group).
export const SHOP = [
  { id: 'rifle', label: 'VK-47 Ember — Rifle', price: 2700, group: 'Rifles', key: '1' },
  { id: 'smg', label: 'Rasp-9 — SMG', price: 1500, group: 'Rifles', key: '2' },
  { id: 'shotgun', label: 'Boomstick 12', price: 1100, group: 'Rifles', key: '3' },
  { id: 'sniper', label: 'Longshot .50', price: 4750, group: 'Rifles', key: '4' },
  { id: 'frag', label: 'Spark Frag', price: 300, group: 'Utility', key: '5' },
  { id: 'smoke', label: 'Haze Smoke', price: 300, group: 'Utility', key: '6' },
  { id: 'armor', label: 'Vest + Helmet (100)', price: ARMOR_PRICE, group: 'Utility', key: '7' },
  { id: 'ammo', label: 'Refill reserve ammo', price: AMMO_PRICE, group: 'Utility', key: '8' },
];

export function buyItem(S, loadout, player, id) {
  const item = SHOP.find((s) => s.id === id);
  if (!item || S.money < item.price) return false;
  if (id === 'armor') {
    if (player.armor >= 100) return false;
    player.armor = 100;
  } else if (id === 'ammo') {
    for (const wid of Object.keys(loadout.ammo)) {
      loadout.ammo[wid].reserve = WEAPONS[wid].reserve;
    }
  } else if (id === 'frag' || id === 'smoke') {
    if (loadout.grenades[id] >= 2) return false;
    loadout.grenades[id] += 1;
  } else {
    loadout.primary = id;
    loadout.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    loadout.slot = 1;
  }
  S.money -= item.price;
  return true;
}
