// hud.js — the DOM layer: health/ammo/timer/score, the killfeed, the
// crosshair, the buy menu, the round/match screens, and a 2D minimap.
// It only reads state and writes DOM; it never touches the simulation.
import { WEAPONS, GRENADES, PLANT_TIME, DEFUSE_TIME, BOMB_TIMER } from './config.js';
import { buyOptions } from './weapons.js';
import { PHASE } from './state.js';

const $ = (id) => document.getElementById(id);

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor(S, map) {
    this.S = S;
    this.map = map;
    this.hitAt = 0;
    this.bannerUntil = 0;
    this.mm = $('minimap').getContext('2d');
    this.mmW = 150;
    this.mmH = 112;
  }

  showHud(on) {
    $('hud').classList.toggle('on', on);
  }

  show(id, on) {
    $(id).classList.toggle('on', on);
  }

  /** One frame of HUD updates (cheap DOM writes, only when changed). */
  update(now, spreadDeg) {
    const S = this.S;
    const p = S.player;
    if (!p) return;
    $('healthnum').textContent = String(Math.ceil(p.hp));
    $('healthfill').style.width = `${Math.max(0, p.hp)}%`;
    $('healthfill').style.background = p.hp > 50 ? '#58d68d' : p.hp > 25 ? '#ffb454' : '#ff5d5d';
    $('armorfill').style.width = `${Math.max(0, p.armor)}%`;
    $('money').innerHTML = `$${p.money} <small>· buy with B</small>`;
    $('scoreV').textContent = String(S.score.V);
    $('scoreJ').textContent = String(S.score.J);
    const aliveV = S.actors.filter((a) => a.team === 'V' && a.alive).length;
    const aliveJ = S.actors.filter((a) => a.team === 'J' && a.alive).length;
    $('alive').textContent = `${aliveV}v${aliveJ}`;
    const timer = $('timer');
    timer.textContent = fmtTime(S.timer);
    timer.classList.toggle('low', S.phase === PHASE.LIVE && S.timer < 15);
    const w = WEAPONS[p.weapon];
    $('weaponname').textContent = w.name;
    const reloading = now < p.reloadingUntil;
    $('ammo').innerHTML = reloading
      ? '—— <small>reloading</small>'
      : `${p.mag} <small>/ ${p.reserve}</small>`;
    $('grenades').textContent =
      `Frag ${p.grenades.frag} · Smoke ${p.grenades.smoke} · Flash ${p.grenades.flash}` +
      (p.hasBomb ? ' · BOMB — plant at A or B (hold E)' : '');
    // Bomb status bar.
    const bs = $('bombstatus');
    if (S.bomb.state === 'planted') {
      bs.classList.add('on');
      $('bombsite').textContent = S.bomb.site;
      $('bombfill').style.width = `${(S.bomb.timer / BOMB_TIMER) * 100}%`;
    } else {
      bs.classList.remove('on');
    }
    // Crosshair gap grows with spread; hidden while a menu is open.
    const ch = $('crosshair');
    const gap = 4 + spreadDeg * 2.2;
    const len = 9;
    ch.innerHTML =
      `<span class="l" style="left:-${gap + len}px;top:-1px;width:${len}px;height:2px"></span>` +
      `<span class="l" style="left:${gap}px;top:-1px;width:${len}px;height:2px"></span>` +
      `<span class="l" style="left:-1px;top:-${gap + len}px;width:2px;height:${len}px"></span>` +
      `<span class="l" style="left:-1px;top:${gap}px;width:2px;height:${len}px"></span>` +
      `<span class="dot"></span>`;
    // Hitmarker fades after 130 ms.
    $('hitmarker').style.display = now - this.hitAt < 0.13 ? 'block' : 'none';
    // Banner fades after its time.
    $('banner').style.display = now < this.bannerUntil ? 'block' : 'none';
    // Low-health vignette.
    $('vignette').style.opacity = p.hp < 35 && p.alive ? String(0.35 + (35 - p.hp) / 60) : '0';
    // Flash overlay.
    const flashLeft = p.blindUntil - now;
    $('flash').style.opacity = flashLeft > 0 ? String(Math.min(1, flashLeft)) : '0';
    // Plant / defuse prompt.
    const pr = $('prompt');
    if (S.phase === PHASE.LIVE && p.alive) {
      if (p.planting > 0) {
        pr.classList.add('on');
        pr.textContent = `Planting… ${Math.ceil(((p.plantProgress ?? 0) / PLANT_TIME) * 100)}%`;
      } else if (p.defusing > 0) {
        pr.classList.add('on');
        pr.textContent = `Defusing… ${Math.ceil(((p.defuseProgress ?? 0) / DEFUSE_TIME) * 100)}%`;
      } else if (p.hasBomb && this.inSite(p)) {
        pr.classList.add('on');
        pr.textContent = 'Hold E to plant the bomb';
      } else if (S.bomb.state === 'planted' && Math.hypot(p.x - S.bomb.x, p.z - S.bomb.z) < 2.6) {
        pr.classList.add('on');
        pr.textContent = 'Hold E to defuse the bomb';
      } else if (S.bomb.state === 'dropped' && Math.hypot(p.x - S.bomb.x, p.z - S.bomb.z) < 3) {
        pr.classList.add('on');
        pr.textContent = 'Bomb dropped here — walk over it to pick it up';
      } else {
        pr.classList.remove('on');
      }
    } else {
      pr.classList.remove('on');
    }
    this.drawKillfeed();
    this.drawMinimap();
  }

  inSite(p) {
    return Object.values(this.map.sites).some(
      (s) => p.x >= s.x0 && p.x <= s.x1 && p.z >= s.z0 && p.z <= s.z1,
    );
  }

  drawKillfeed() {
    const el = $('killfeed');
    el.innerHTML = this.S.killfeed
      .map((k) => {
        const kc = this.S.actors.find((a) => a.id === k.killer)?.team === 'V' ? 'kf-v' : 'kf-j';
        const vc = this.S.actors.find((a) => a.id === k.victim)?.team === 'V' ? 'kf-v' : 'kf-j';
        return `<div><span class="${kc}">${k.killer}</span> ${k.headshot ? '<span class="kf-head">◎</span> ' : ''}${k.weaponName} <span class="${vc}">${k.victim}</span></div>`;
      })
      .join('');
  }

  drawMinimap() {
    const g = this.mm;
    const b = this.map.bounds;
    const sx = this.mmW / (b.maxX - b.minX);
    const sz = this.mmH / (b.maxZ - b.minZ);
    const X = (x) => (x - b.minX) * sx;
    const Z = (z) => (z - b.minZ) * sz;
    g.clearRect(0, 0, this.mmW, this.mmH);
    g.fillStyle = 'rgba(20,26,38,0.9)';
    g.fillRect(0, 0, this.mmW, this.mmH);
    // Walls.
    g.fillStyle = '#5a6274';
    for (const s of this.map.solids) {
      if (s.top < 2) continue;
      g.fillRect(X(s.x0), Z(s.z0), (s.x1 - s.x0) * sx, (s.z1 - s.z0) * sz);
    }
    // Sites.
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const [key, s] of Object.entries(this.map.sites)) {
      g.fillStyle = key === 'A' ? '#ffb454' : '#6ea8ff';
      g.fillText(key, X(s.cx), Z(s.cz) + 4);
    }
    // Bomb.
    if (this.S.bomb.state === 'planted' || this.S.bomb.state === 'dropped') {
      g.fillStyle = '#ff5d5d';
      g.beginPath();
      g.arc(X(this.S.bomb.x), Z(this.S.bomb.z), 4, 0, Math.PI * 2);
      g.fill();
    }
    // Actors: triangles for the player, dots for the rest.
    for (const a of this.S.actors) {
      if (!a.alive) continue;
      g.fillStyle = a.team === 'V' ? '#6ea8ff' : '#ffb454';
      if (a.isPlayer) {
        const px = X(a.x);
        const pz = Z(a.z);
        g.save();
        g.translate(px, pz);
        g.rotate(Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw)) + Math.PI / 2);
        g.beginPath();
        g.moveTo(0, -6);
        g.lineTo(4, 5);
        g.lineTo(-4, 5);
        g.closePath();
        g.fill();
        g.restore();
      } else {
        g.beginPath();
        g.arc(X(a.x), Z(a.z), 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  banner(html, now, dur = 2.6) {
    $('banner').innerHTML = html;
    this.bannerUntil = now + dur;
  }

  hitmark(headshot, now) {
    this.hitAt = now;
    $('hitmarker').className = headshot ? 'head' : '';
    $('hitmarker').id = 'hitmarker';
  }

  /** Build the buy menu for the player's current money and loadout. */
  openBuy() {
    const grid = $('buygrid');
    const p = this.S.player;
    $('buyMoney').textContent = `$${p.money}`;
    grid.innerHTML = '';
    buyOptions(p).forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'buyitem' + (item.owned ? ' owned' : '') + (!item.afford && !item.owned ? ' poor' : '');
      div.innerHTML = `${i + 1}. ${item.name}<b>$${item.price}</b>`;
      div.onclick = () => this.buyClicked(item.id);
      grid.appendChild(div);
    });
    this.show('buy', true);
  }

  buyClicked(id) {
    // Filled in by boot.js (it owns the purchase call + sound).
    if (this.onBuy) this.onBuy(id);
    this.openBuy();
  }

  closeBuy() {
    this.show('buy', false);
  }

  showRoundEnd(winner, reason, scores, kills) {
    $('reTitle').textContent = winner === 'V' ? 'Round won — VANGUARD takes it' : 'Round lost — JACKALS take it';
    $('reSub').textContent = reason;
    $('scores').innerHTML = kills
      .map((k) => `<div class="row"><span>${k.id} ${k.team === 'V' ? '(VANGUARD)' : '(JACKALS)'}</span><span>${k.kills} kills · ${k.deaths} deaths</span></div>`)
      .join('');
    this.show('roundEnd', true);
  }

  showMatchEnd(winner, scores, kills) {
    $('meTitle').textContent =
      winner === null ? 'Match drawn' : winner === 'V' ? 'MATCH WON — VANGUARD takes Yard 7' : 'MATCH LOST — JACKALS take Yard 7';
    $('meSub').textContent = `Final score: VANGUARD ${scores.V} — ${scores.J} JACKALS. First to 8.`;
    $('scores2').innerHTML = kills
      .map((k) => `<div class="row"><span>${k.id} ${k.team === 'V' ? '(VANGUARD)' : '(JACKALS)'}</span><span>${k.kills} kills · ${k.deaths} deaths</span></div>`)
      .join('');
    this.show('matchEnd', true);
  }
}
