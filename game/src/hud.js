// hud.js — all DOM HUD: health/ammo/timer/score, crosshair, hitmarker,
// kill feed, minimap, buy menu, banners, menus. Updates are cached so
// a value is only written to the DOM when it changes.

import { SHOP } from './weapons.js';
import { clamp } from './state.js';

function $(id) { return document.getElementById(id); }

export class HUD {
  constructor(S, layout) {
    this.S = S;
    this.layout = layout;
    this.world = null;   // set by main.js once the World exists
    this._player = null;
    this.cache = {};
    this.minimap = $('minimap');
    this.mm = this.minimap ? this.minimap.getContext('2d') : null;
    this.mmT = 0;
    this.feedT = 0;
    this._buildBuyMenu();
    this._bindMenuButtons();
  }

  _set(id, text) {
    if (this.cache[id] !== text) {
      this.cache[id] = text;
      const el = $(id);
      if (el) el.textContent = text;
    }
  }

  _show(id, on) {
    const key = 'show:' + id;
    if (this.cache[key] !== on) {
      this.cache[key] = on;
      const el = $(id);
      if (el) el.style.display = on ? '' : 'none';
    }
  }

  _buildBuyMenu() {
    const root = $('buy-items');
    if (!root) return;
    const groups = {};
    for (const item of SHOP) (groups[item.group] = groups[item.group] || []).push(item);
    let html = '';
    for (const g of Object.keys(groups)) {
      html += '<div class="buy-group"><div class="buy-group-title">' + g + '</div>';
      for (const it of groups[g]) {
        html += '<button class="buy-item" data-buy="' + it.id + '"><span class="buy-key">' + it.key + '</span><span class="buy-label">' + it.label + '</span><span class="buy-price">$' + it.price + '</span></button>';
      }
      html += '</div>';
    }
    root.innerHTML = html;
  }

  _bindMenuButtons() {
    const root = $('buy-items');
    if (root) root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-buy]');
      if (btn && this.onBuyItem) this.onBuyItem(btn.dataset.buy);
    });
  }

  // Called every render frame with the live game objects.
  update(player, loadout, dt) {
    const S = this.S;
    this._player = player;
    // Top bar.
    this._set('score-atk', String(S.score.atk));
    this._set('score-def', String(S.score.def));
    this._set('round-label', 'ROUND ' + S.round + ' / ' + S.maxRounds);
    const t = Math.max(0, Math.ceil(S.phaseT));
    this._set('timer', S.phase === 'buy' ? 'BUY ' + t : (S.bomb.planted ? 'BOMB ' + t : t + 's'));
    const timerEl = $('timer');
    if (timerEl) timerEl.classList.toggle('urgent', S.phaseT <= 10 && S.phase === 'live');
    // Health / armor / money.
    this._set('hp-num', String(Math.ceil(player.hp)));
    const hpFill = $('hp-fill');
    if (hpFill) {
      const w = clamp(player.hp, 0, 100) + '%';
      if (this.cache['hp-w'] !== w) { this.cache['hp-w'] = w; hpFill.style.width = w; }
      hpFill.style.background = player.hp > 50 ? '#59d67a' : player.hp > 25 ? '#ffb020' : '#ff5a3c';
    }
    this._set('armor-num', String(Math.ceil(player.armor)));
    this._set('money', '$' + S.money);
    this._set('kills', 'K ' + S.kills + ' · D ' + S.deaths);
    // Weapon + ammo.
    const w = loadout.slot === 3 ? null : (loadout.slot === 2 ? { id: 'pistol', name: 'P9 Sidearm' } : null);
    const cur = w || this._currentWeapon(loadout);
    if (cur) {
      const a = loadout.ammo[cur.id];
      this._set('weapon-name', cur.name);
      this._set('ammo-mag', loadout.reloading ? '--' : String(a.mag));
      this._set('ammo-reserve', '/ ' + a.reserve);
      this._set('ammo-state', loadout.reloading ? 'RELOADING' : (a.mag === 0 ? 'EMPTY — R TO RELOAD' : ''));
    }
    this._set('grenades', 'FRAG ' + loadout.grenades.frag + ' · SMOKE ' + loadout.grenades.smoke + (loadout.slot === 3 ? '  [G TO SWITCH]' : ''));
    // Objective line.
    const obj = S.bomb.planted
      ? 'BOMB PLANTED AT SITE ' + S.bomb.site + ' — DEFEND IT'
      : 'PLANT THE CHARGE AT SITE A OR B — ' + (S.bombCarrier === 'player' ? 'YOU CARRY THE CHARGE' : 'TEAMMATE CARRIES IT');
    this._set('objective', obj);
    // Crosshair spread.
    const ch = $('crosshair');
    if (ch) {
      const spreadPx = 5 + (this._spreadPx || 5);
      if (this.cache['ch'] !== spreadPx) {
        this.cache['ch'] = spreadPx;
        ch.style.setProperty('--gap', spreadPx + 'px');
      }
    }
    // Hitmarker.
    const hm = $('hitmarker');
    if (hm) {
      const show = S.hitmark > 0;
      if (this.cache['hm'] !== show) { this.cache['hm'] = show; hm.style.opacity = show ? '1' : '0'; }
      hm.classList.toggle('kill', S.hitmarkKill);
    }
    // Damage vignette + direction.
    const vg = $('damage-vignette');
    if (vg) {
      const o = clamp(S.flash, 0, 1);
      if (this.cache['vg'] !== o) { this.cache['vg'] = o; vg.style.opacity = String(o); }
    }
    const di = $('damage-dir');
    if (di) {
      const show = S.damageDir >= 0 && S.flash > 0.25;
      if (this.cache['di'] !== show) { this.cache['di'] = show; di.style.opacity = show ? '1' : '0'; }
      if (show) di.style.transform = 'translate(-50%,-50%) rotate(' + S.damageDir + 'rad)';
    }
    // Kill feed.
    this._renderFeed();
    // Crosshair hides while shopping — you are not aiming at the menu.
    const buyOpenEarly = S.mode === 'buy' || S.buyOpen;
    this._show('crosshair', !buyOpenEarly);
    // Banner — hidden while the buy menu is open, so the two never
    // print on top of each other.
    const banner = $('banner');
    if (banner) {
      const b = S.banner;
      if (b && b.t > 0 && !buyOpenEarly) {
        if (this.cache['bn'] !== b.title) {
          this.cache['bn'] = b.title;
          $('banner-title').textContent = b.title;
          $('banner-sub').textContent = b.sub;
          banner.className = 'banner show ' + b.kind;
        }
      } else if (this.cache['bn'] !== '') {
        this.cache['bn'] = '';
        banner.className = 'banner';
      }
    }
    // Plant / defuse progress.
    const prog = $('channel');
    if (prog) {
      const ch2 = S.channel;
      const show = !!ch2;
      if (this.cache['ch-show'] !== show) { this.cache['ch-show'] = show; prog.style.display = show ? '' : 'none'; }
      if (show) {
        $('channel-label').textContent = ch2.kind === 'plant' ? 'PLANTING CHARGE…' : 'DEFUSING…';
        const fill = $('channel-fill');
        const w2 = Math.round((ch2.t / ch2.dur) * 100) + '%';
        if (this.cache['ch-w'] !== w2) { this.cache['ch-w'] = w2; fill.style.width = w2; }
      }
    }
    // Buy menu visibility + affordability.
    const buyOpen = buyOpenEarly;
    this._show('buy-menu', buyOpen);
    if (buyOpen) {
      this._set('buy-money', 'FUNDS: $' + S.money);
      const items = document.querySelectorAll('[data-buy]');
      for (const el of items) {
        const item = SHOP.find((s) => s.id === el.dataset.buy);
        const afford = S.money >= item.price;
        if (el.dataset.afford !== String(afford)) {
          el.dataset.afford = String(afford);
          el.classList.toggle('cant', !afford);
        }
      }
    }
    // Spectate label when dead.
    this._show('spectate', !player.alive && S.mode === 'play');
    if (!player.alive && S.mode === 'play') {
      const alive = S.bots.filter((b) => b.alive);
      const spec = alive.length ? alive[S.spectate % alive.length] : null;
      this._set('spectate-name', spec ? 'SPECTATING ' + spec.name + ' — ROUND CONTINUES' : 'NO TEAMMATES LEFT');
    }
    // Minimap at ~10 Hz.
    this.mmT -= dt;
    if (this.mmT <= 0) { this.mmT = 0.1; this._drawMinimap(player); }
  }

  _currentWeapon(loadout) {
    if (loadout.slot === 2) return { id: 'pistol', name: 'P9 Sidearm' };
    const map = { rifle: 'VK-47 Ember', smg: 'Rasp-9', shotgun: 'Boomstick 12', sniper: 'Longshot .50' };
    return { id: loadout.primary, name: map[loadout.primary] || 'VK-47 Ember' };
  }

  _renderFeed() {
    const el = $('killfeed');
    if (!el) return;
    const key = this.S.events.map((e) => e.text + e.t).join('|');
    if (this.cache['feed'] === key) return;
    this.cache['feed'] = key;
    el.innerHTML = this.S.events.map((e) => '<div class="feed-line ' + e.kind + '">' + e.text + '</div>').join('');
  }

  _drawMinimap(player) {
    const g = this.mm;
    if (!g) return;
    const L = this.layout;
    const W = this.minimap.width, H = this.minimap.height;
    const sx = W / (L.bounds.x * 2 + 6), sz = H / (L.bounds.z * 2 + 6);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(8,12,16,0.72)';
    g.fillRect(0, 0, W, H);
    const px = (x) => (x + L.bounds.x + 3) * sx;
    const pz = (z) => (z + L.bounds.z + 3) * sz;
    // Walls.
    g.fillStyle = '#5a6672';
    for (const b of L.walls) g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * sx, b.d * sz);
    g.fillStyle = '#8a6a3a';
    for (const b of L.crates) g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * sx, b.d * sz);
    // Sites.
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const k of ['A', 'B']) {
      const s = L.sites[k];
      g.fillStyle = k === 'A' ? '#ff8c2e' : '#4fc3ff';
      g.beginPath(); g.arc(px(s.x), pz(s.z), 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0b0e11';
      g.fillText(k, px(s.x), pz(s.z) + 0.5);
    }
    // Bomb.
    if (this.S.bomb.planted) {
      g.fillStyle = '#ff2e1e';
      g.beginPath(); g.arc(px(this.S.bomb.x), pz(this.S.bomb.z), 4, 0, Math.PI * 2); g.fill();
    }
    // Teammates (green) always; enemies (red) only when the player
    // actually has line of sight — no wallhack radar.
    for (const b of this.S.bots) {
      if (!b.alive) continue;
      if (b.team === 'def' && this.world && this._player) {
        if (!this.world.hasLOS(this._player.pos.x, 1.6, this._player.pos.z, b.pos.x, 1.45, b.pos.z, this.S.smokes)) continue;
      }
      g.fillStyle = b.team === 'atk' ? '#59d67a' : '#ff5a3c';
      g.beginPath(); g.arc(px(b.pos.x), pz(b.pos.z), 3.2, 0, Math.PI * 2); g.fill();
    }
    // Player arrow.
    const ang = -player.yaw;
    g.save();
    g.translate(px(player.pos.x), pz(player.pos.z));
    g.rotate(ang);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath(); g.fill();
    g.restore();
  }

  // Screens: menu / pause / match end.
  showMenu(show) {
    this._show('menu-screen', show);
    this._show('hud', !show);
  }
  showPause(show) { this._show('pause-screen', show); }
  showMatchEnd(show, winner, score) {
    this._show('match-screen', show);
    if (show) {
      $('match-title').textContent = winner === 'atk' ? 'EMBER CREW WINS THE MATCH' : 'SLAG WARDENS WIN THE MATCH';
      $('match-sub').textContent = 'Final score ' + score.atk + ' — ' + score.def + ' · ' + this.S.kills + ' kills · ' + Math.round((this.S.stats.hits / Math.max(1, this.S.stats.shots)) * 100) + '% accuracy';
    }
  }
  setMapButtons(variants, current, onPick) {
    const root = $('map-pick');
    if (!root) return;
    root.innerHTML = variants.map((v) =>
      '<button class="map-btn' + (v.id === current ? ' sel' : '') + '" data-map="' + v.id + '"><b>' + v.name + '</b><span>' + v.tag + '</span><i>' + v.desc + '</i></button>').join('');
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-map]');
      if (btn) onPick(btn.dataset.map);
    });
  }
}
