// hud.js — every DOM readout of the game: score bar, timer, health,
// ammo, money, killfeed, crosshair, banners, buy menu, and the circular
// minimap (streets + sites + live dots). Writes only change when values
// change, so the HUD costs almost nothing per frame.

import { S, player } from './sim.js';
import { WEAPONS } from './combat.js';
import { MAP } from './mapdata.js';
import { segmentBlocked } from './util.js';

const $ = (id) => document.getElementById(id);
const cache = {};
function setText(id, v) {
  if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; }
}
function setHtml(id, v) {
  if (cache[id] !== v) { cache[id] = v; $(id).innerHTML = v; }
}

let buyOpen = false;
let flashV = 0, dmgV = 0, hitT = 0, toastT = 0;
let spotted = {}; // enemy id -> time until which it shows on the minimap

const BUY_ITEMS = [
  { key: 'ar51', name: 'AR-51 Rifle', desc: 'Auto rifle. 34 dmg, 3x headshot. The all-rounder.', price: 2700 },
  { key: 'hornet', name: 'Hornet-9 SMG', desc: 'Fast SMG. 25 dmg, close quarters shredder.', price: 1500 },
  { key: 'longbow', name: 'Longbow DMR', desc: '88 dmg per shot. One tap at range, slow to cycle.', price: 4200 },
  { key: 'breacher', name: 'Breacher Shotgun', desc: '8 pellets, 12 dmg each. Devastating up close.', price: 1800 },
  { key: 'frag', name: 'Frag Grenade', desc: 'Bounces, then bursts: up to 130 damage in 7 m.', price: 300 },
  { key: 'smoke', name: 'Smoke Grenade', desc: '15 s smoke wall. Blocks sight — bots included.', price: 300 },
  { key: 'flash', name: 'Flash Grenade', desc: 'Blinds anyone looking at it. Bots freeze too.', price: 200 },
  { key: 'kevlar', name: 'Kevlar Vest', desc: 'Takes 40% off every hit. Survive one more duel.', price: 650 },
];

export function isBuyOpen() { return buyOpen; }

export function initHud(ui) {
  const grid = $('buygrid');
  BUY_ITEMS.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'buyitem';
    d.innerHTML = `<span class="key">${i + 1}</span><div class="nm">${it.name}</div>` +
      `<div class="ds">${it.desc}</div><div class="pr">$${it.price}</div>`;
    d.addEventListener('click', () => {
      if (ui.buyKey(it.key)) updateBuyMoney();
    });
    grid.appendChild(d);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && buyOpen) toggleBuy();
    if (buyOpen && /^Digit[1-8]$/.test(e.code)) {
      const it = BUY_ITEMS[Number(e.code.slice(5)) - 1];
      if (it && ui.buyKey(it.key)) updateBuyMoney();
    }
  });
  window.__hud = { toggleBuy, toast, flash: (v) => { flashV = Math.max(flashV, v); },
    damage: () => { dmgV = 1; }, hitmark: (kill) => { hitT = 0.25; $('hitmark').classList.toggle('kill', kill); } };
}

export function toggleBuy() {
  if (S.phase !== 'buy') { closeBuy(); return; }
  buyOpen = !buyOpen;
  $('buymenu').style.display = buyOpen ? 'flex' : 'none';
  if (buyOpen) {
    updateBuyMoney();
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
export function closeBuy() {
  buyOpen = false;
  $('buymenu').style.display = 'none';
}
function updateBuyMoney() { setText('buyMoney', `You have $${S.money}`); }

export function toast(text, secs) {
  setText('toast', text);
  toastT = secs || 2.5;
}

// --- minimap: static base (streets + sites) drawn once, dots per frame ---
let mapBase = null;
function buildMapBase() {
  const c = document.createElement('canvas');
  c.width = 392; c.height = 392;
  const g = c.getContext('2d');
  const b = MAP.bounds;
  const sx = (x) => (x - b.x0) / (b.x1 - b.x0) * 392;
  const sz = (z) => (z - b.z0) / (b.z1 - b.z0) * 392;
  g.fillStyle = '#14181f'; g.fillRect(0, 0, 392, 392);
  // Streets: light asphalt over the dark base.
  g.fillStyle = '#3d434c';
  g.fillRect(sx(-40), sz(-26), sx(40) - sx(-40), sz(-16) - sz(-26)); // A-long
  g.fillRect(sx(-40), sz(16), sx(40) - sx(-40), sz(26) - sz(16));   // B-long
  g.fillRect(sx(-42), sz(-5), sx(42) - sx(-42), sz(5) - sz(-5));     // mid
  g.fillRect(sx(-18), sz(-27), sx(-8) - sx(-18), sz(27) - sz(-27)); // west cross
  g.fillRect(sx(8), sz(-27), sx(18) - sx(8), sz(27) - sz(-27));     // east cross
  g.fillRect(sx(24), sz(-26), sx(40) - sx(24), sz(-12) - sz(-26));  // site A yard
  g.fillRect(sx(24), sz(12), sx(40) - sx(24), sz(26) - sz(12));     // site B plaza
  // Buildings as darker blocks.
  g.fillStyle = '#232830';
  for (const s of MAP.solids) {
    if (s.kind !== 'brick') continue;
    g.fillRect(sx(s.x0), sz(s.z0), sx(s.x1) - sx(s.x0), sz(s.z1) - sz(s.z0));
  }
  // Sites.
  for (const [k, site] of Object.entries(MAP.sites)) {
    g.strokeStyle = k === 'A' ? '#ffb35c' : '#7db8ff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(sx((site.x0 + site.x1) / 2), sz((site.z0 + site.z1) / 2), 16, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 15px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(k, sx((site.x0 + site.x1) / 2), sz((site.z0 + site.z1) / 2));
  }
  mapBase = c;
}

function drawMinimap() {
  const cv = $('minimap');
  const g = cv.getContext('2d');
  if (!mapBase) buildMapBase();
  const b = MAP.bounds;
  const sx = (x) => (x - b.x0) / (b.x1 - b.x0) * 392;
  const sz = (z) => (z - b.z0) / (b.z1 - b.z0) * 392;
  g.clearRect(0, 0, 392, 392);
  g.drawImage(mapBase, 0, 0);
  const p = player();
  // Enemies spotted by the player show for 3 s after last sighting.
  for (const a of S.actors) {
    if (!a.alive || a.team === p.team) continue;
    if (a.id in spotted && S.time < spotted[a.id]) continue;
    const seen = !segmentBlocked(p.x, p.y + 1.5, p.z, a.x, a.y + 1, a.z, MAP.solids, null);
    if (seen) spotted[a.id] = S.time + 3;
  }
  for (const a of S.actors) {
    if (!a.alive) continue;
    const x = sx(a.x), y = sz(a.z);
    if (a.isPlayer) {
      g.save();
      g.translate(x, y); g.rotate(-a.yaw + Math.PI / 2);
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(-6, 7); g.closePath(); g.fill();
      g.restore();
    } else if (a.team === 'azure') {
      g.fillStyle = '#5aa2ff';
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    } else if (S.time < (spotted[a.id] || 0)) {
      g.fillStyle = '#ff5a4e';
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    }
  }
  // Bomb: orange diamond when planted or dropped.
  if (S.bomb.state === 'planted' || S.bomb.state === 'dropped') {
    g.fillStyle = '#ffb35c';
    const x = sx(S.bomb.x), y = sz(S.bomb.z);
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
    g.fillRect(-5, -5, 10, 10); g.restore();
  }
}

export function updateHud(dt) {
  const p = player();
  // Score + timer.
  setText('scoreAn', String(S.scoreA));
  setText('scoreBn', String(S.scoreB));
  let t = 0;
  if (S.phase === 'buy') t = Math.max(0, 12 - S.phaseT);
  else if (S.phase === 'live') t = S.bomb.state === 'planted' ? S.bomb.timer : Math.max(0, S.roundTime);
  else t = Math.max(0, S.roundTime);
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  setText('timer', `${mm}:${String(ss).padStart(2, '0')}`);
  $('timer').classList.toggle('low', t < 10 && S.phase === 'live');
  setText('roundinfo', `ROUND ${Math.max(1, S.round)} · SITE ${S.targetSite}`);
  setHtml('objline', S.bomb.state === 'planted'
    ? `Bomb planted at <b>Site ${S.bomb.site}</b> — defend it`
    : `Round ${Math.max(1, S.round)} — target <b>Site ${S.targetSite}</b>`);

  // Health / ammo / money.
  const hp = Math.max(0, Math.ceil(p.hp));
  $('hpbar').style.width = hp + '%';
  $('hpbar').classList.toggle('hurt', hp <= 35);
  setHtml('hpnum', `${hp} <small>HP</small>`);
  const w = WEAPONS[p.weapon];
  setHtml('mag', `${p.mag} <small>/ ${p.reserve}</small>`);
  setText('weapon', w.name + (p.reloading > 0 ? ' — reloading…' : ''));
  setText('money', `$${S.money}`);
  $('bombtag').style.display = p.hasBomb ? 'block' : 'none';
  // Slots: 1 sidearm, 2 primary, 3 grenade, 4 kevlar.
  const slots = document.querySelectorAll('#slots .slot');
  const hasPrimary = p.weapon !== 'p9' || (p.ammoBag && Object.keys(p.ammoBag).some((k) => k !== 'p9'));
  const hasNade = (p.grenades.frag || 0) + (p.grenades.smoke || 0) + (p.grenades.flash || 0) > 0;
  slots[0].classList.toggle('on', p.weapon === 'p9');
  slots[1].classList.toggle('on', p.weapon !== 'p9');
  slots[1].style.opacity = hasPrimary ? 1 : 0.35;
  slots[2].classList.toggle('on', hasNade);
  slots[3].classList.toggle('on', p.kevlar);

  // Crosshair gap follows spread + recoil.
  const gap = 7 + p.spread * 260 + p.recoil * 260;
  $('chL').style.right = gap + 'px'; $('chR').style.left = gap + 'px';
  $('chT').style.bottom = gap + 'px'; $('chB').style.top = gap + 'px';
  $('cross').style.opacity = (S.phase === 'live' && p.alive) ? 1 : 0;

  // Killfeed.
  setHtml('killfeed', S.kills.slice(-4).map((k) =>
    `<div><span class="${k.ta === 'azure' ? 'ka' : 'kb'}">${k.a}</span> ` +
    `<span class="kw">× ${k.w}</span> <span class="${k.tb === 'azure' ? 'ka' : 'kb'}">${k.b}</span></div>`).join(''));

  // Banner / plant bar / bomb warning.
  const banner = $('banner');
  if (S.phase === 'end' && S.banner.big) {
    banner.style.display = 'block';
    setText('bannerBig', S.banner.big);
    $('bannerBig').className = 'big ' + S.banner.cls;
    setText('bannerSub', S.banner.sub);
  } else {
    banner.style.display = 'none';
  }
  const planting = p.planting || p.defusing;
  $('plantbar').style.display = planting ? 'block' : 'none';
  if (planting) {
    setText('plantLbl', p.planting ? 'PLANTING…' : 'DEFUSING…');
    $('plantFill').style.width = ((p.planting ? p.plantT / 3.5 : p.defuseT / 5) * 100) + '%';
  }
  $('bombwarn').style.display = S.bomb.state === 'planted' ? 'block' : 'none';

  // Flash + damage overlays decay.
  if (flashV > 0) { flashV = Math.max(0, flashV - dt * 1.4); $('flash').style.opacity = flashV; }
  if (dmgV > 0) { dmgV = Math.max(0, dmgV - dt * 1.8); $('dmg').style.opacity = dmgV; }
  if (hitT > 0) {
    hitT -= dt;
    $('hitmark').style.opacity = Math.max(0, hitT / 0.25);
  }
  if (toastT > 0) {
    toastT -= dt;
    if (toastT <= 0) setText('toast', '');
  }
  drawMinimap();
}
