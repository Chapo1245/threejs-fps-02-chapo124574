// input.js — keyboard, mouse look with pointer lock, wheel weapon
// switch, and a minimal touch scheme (left stick move, right drag
// look, FIRE / JUMP / CROUCH buttons). Emits a plain input frame the
// fixed step consumes; no game logic lives here.

export class Input {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.cb = callbacks; // {onFire, onReload, onBuy, onPause, onGrenade, onSlot, onJump, onInteract, onClick}
    this.keys = {};
    this.locked = false;
    this.firing = false;
    this.lookDX = 0;
    this.lookDY = 0;
    this.touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.stick = { active: false, id: -1, x: 0, y: 0 };
    this.lookTouch = { active: false, id: -1, lx: 0, ly: 0 };
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (this.cb.onKey) this.cb.onKey(e.code, true);
      if (e.code === 'KeyR') this.cb.onReload && this.cb.onReload();
      if (e.code === 'KeyB') this.cb.onBuy && this.cb.onBuy();
      if (e.code === 'KeyG') this.cb.onGrenade && this.cb.onGrenade();
      if (e.code === 'KeyE') this.cb.onInteract && this.cb.onInteract();
      if (e.code === 'KeyQ') this.cb.onSlot && this.cb.onSlot('last');
      if (e.code === 'Digit1') this.cb.onSlot && this.cb.onSlot(1);
      if (e.code === 'Digit2') this.cb.onSlot && this.cb.onSlot(2);
      if (e.code === 'Digit3') this.cb.onSlot && this.cb.onSlot(3);
      if (e.code === 'Digit4') this.cb.onSlot && this.cb.onSlot(4);
      if (e.code === 'Digit5') this.cb.onSlot && this.cb.onSlot(5);
      if (e.code === 'Escape') this.cb.onPause && this.cb.onPause();
      if (e.code === 'Space') { e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (this.cb.onKey) this.cb.onKey(e.code, false);
    });
    window.addEventListener('blur', () => { this.keys = {}; this.firing = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.firing = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.touch) return;
      if (!this.locked) {
        this.cb.onClick && this.cb.onClick();
        return;
      }
      if (e.button === 0) { this.firing = true; this.cb.onFire && this.cb.onFire(true); }
      if (e.button === 2) this.cb.onScope && this.cb.onScope(true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.firing = false; this.cb.onFire && this.cb.onFire(false); }
      if (e.button === 2) this.cb.onScope && this.cb.onScope(false);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => {
      if (e.deltaY > 0) this.cb.onSlot && this.cb.onSlot('next');
      else if (e.deltaY < 0) this.cb.onSlot && this.cb.onSlot('prev');
    }, { passive: true });
    // Touch: left half = move stick, right half = look drag.
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.4 && !this.stick.active) {
          this.stick = { active: true, id: t.identifier, x: t.clientX, y: t.clientY, ox: t.clientX, oy: t.clientY };
        } else if (!this.lookTouch.active) {
          this.lookTouch = { active: true, id: t.identifier, lx: t.clientX, ly: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (this.stick.active && t.identifier === this.stick.id) {
          this.stick.x = t.clientX; this.stick.y = t.clientY;
        } else if (this.lookTouch.active && t.identifier === this.lookTouch.id) {
          this.lookDX += (t.clientX - this.lookTouch.lx) * 2.4;
          this.lookDY += (t.clientY - this.lookTouch.ly) * 2.4;
          this.lookTouch.lx = t.clientX; this.lookTouch.ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick.active && t.identifier === this.stick.id) this.stick = { active: false, id: -1, x: 0, y: 0 };
        if (this.lookTouch.active && t.identifier === this.lookTouch.id) this.lookTouch = { active: false, id: -1, lx: 0, ly: 0 };
      }
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  }

  requestLock() {
    if (this.touch) return;
    try { this.canvas.requestPointerLock(); } catch (e) { /* headless */ }
  }

  // Consume the accumulated look delta for this tick.
  consumeLook() {
    const dx = this.lookDX, dy = this.lookDY;
    this.lookDX = 0; this.lookDY = 0;
    return { dx, dy };
  }

  // Movement frame for the fixed step.
  moveFrame() {
    const k = this.keys;
    let f = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    let r = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
    if (this.stick.active) {
      const dx = (this.stick.x - this.stick.ox) / 48;
      const dy = (this.stick.y - this.stick.oy) / 48;
      r += Math.max(-1, Math.min(1, dx));
      f += Math.max(-1, Math.min(1, -dy));
    }
    return {
      f: Math.max(-1, Math.min(1, f)),
      r: Math.max(-1, Math.min(1, r)),
      jump: !!(k['Space']),
      crouch: !!(k['KeyC'] || k['ControlLeft']),
      walk: !!(k['ShiftLeft'] || k['ShiftRight']),
    };
  }
}
