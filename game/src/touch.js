// touch.js — PUBG-Mobile-style touch controls.
// Virtual floating joystick (left half), drag-to-aim (right half), FIRE
// hold button plus reload / buy / plant-defuse / sprint / jump / grenade
// buttons. The UI only exists on touch devices; on desktop this module
// is inert and the keyboard+mouse flow is untouched. No dependencies.

export const touch = {
  active: false,
  moveX: 0, moveY: 0,       // joystick vector, -1..1 (x strafe, y forward)
  lookDX: 0, lookDY: 0,     // aim deltas, consumed by player.js each frame
  firing: false,
  sprint: false,            // toggle
  interact: false,          // hold (plant / defuse)
  reloadQueued: false,
  buyQueued: false,
  jumpQueued: false,
  grenadeQueued: false,
};

const JOY_R = 55;

export function initTouch(canvas) {
  touch.active = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!touch.active) return;
  document.body.classList.add('touch');
  const ui = document.getElementById('touch-ui');
  if (!ui) return;

  // --- floating joystick (left zone) ---
  const zone = document.getElementById('joy-zone');
  const base = document.getElementById('joy-base');
  const knob = document.getElementById('joy-knob');
  let joyId = null, ox = 0, oy = 0;
  const joyStart = (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joyId = t.identifier; ox = t.clientX; oy = t.clientY;
    base.style.display = 'block';
    base.style.left = ox + 'px'; base.style.top = oy + 'px';
    knob.style.transform = 'translate(-50%,-50%)';
  };
  const joyMove = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      let dx = t.clientX - ox, dy = t.clientY - oy;
      const len = Math.hypot(dx, dy);
      if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      touch.moveX = dx / JOY_R;
      touch.moveY = dy / JOY_R;
    }
  };
  const joyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null;
      touch.moveX = 0; touch.moveY = 0;
      base.style.display = 'none';
    }
  };
  zone.addEventListener('touchstart', joyStart, { passive: false });
  zone.addEventListener('touchmove', joyMove, { passive: false });
  zone.addEventListener('touchend', joyEnd);
  zone.addEventListener('touchcancel', joyEnd);

  // --- drag-to-aim on the right half (the game canvas) ---
  let aimId = null, lastX = 0, lastY = 0;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (t.clientX < window.innerWidth * 0.45) return;
    if (aimId !== null) return;
    aimId = t.identifier; lastX = t.clientX; lastY = t.clientY;
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== aimId) continue;
      touch.lookDX += t.clientX - lastX;
      touch.lookDY += t.clientY - lastY;
      lastX = t.clientX; lastY = t.clientY;
      e.preventDefault();
    }
  }, { passive: false });
  const aimEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === aimId) aimId = null;
    }
  };
  canvas.addEventListener('touchend', aimEnd);
  canvas.addEventListener('touchcancel', aimEnd);

  // --- buttons ---
  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(el); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); if (off) off(el); }, { passive: false });
    el.addEventListener('touchcancel', () => { if (off) off(el); });
  };
  const tap = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(el); }, { passive: false });
  };
  hold('btn-fire', () => { touch.firing = true; }, () => { touch.firing = false; });
  hold('btn-interact', () => { touch.interact = true; }, () => { touch.interact = false; });
  tap('btn-reload', () => { touch.reloadQueued = true; });
  tap('btn-buy', () => { touch.buyQueued = true; });
  tap('btn-jump', () => { touch.jumpQueued = true; });
  tap('btn-grenade', () => { touch.grenadeQueued = true; });
  tap('btn-sprint', (el) => {
    touch.sprint = !touch.sprint;
    el.classList.toggle('on', touch.sprint);
  });
}
