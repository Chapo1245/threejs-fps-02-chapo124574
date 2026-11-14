// util.js — tiny math helpers, a seeded RNG, and 2D collision primitives.
// Everything here is pure and allocation-free in the hot path: callers pass
// scratch objects instead of getting fresh ones back.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}

/** Deterministic RNG (mulberry32) so a seed replays the same match. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Axis-aligned box in the XZ plane with a height: { x0, x1, z0, z1, top }. */
export function boxOverlapsCircle(b, x, z, r) {
  const cx = clamp(x, b.x0, b.x1);
  const cz = clamp(z, b.z0, b.z1);
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

/**
 * Slide a circle (x, z, radius r) out of every box it overlaps. Mutates `pos`
 * in place and reports whether any wall was touched. Boxes shorter than
 * `stepUp` are treated as low cover the circle can step over (crates).
 */
export function resolveCircle(pos, r, boxes, stepUp = 0) {
  let hit = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (stepUp > 0 && b.top <= stepUp) continue;
    if (!boxOverlapsCircle(b, pos.x, pos.z, r)) continue;
    const cx = clamp(pos.x, b.x0, b.x1);
    const cz = clamp(pos.z, b.z0, b.z1);
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 < 1e-8) {
      // Centre is inside the box: push out along the smallest penetration.
      const pl = pos.x - b.x0 + r;
      const pr = b.x1 - pos.x + r;
      const pt = pos.z - b.z0 + r;
      const pb = b.z1 - pos.z + r;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = b.x0 - r;
      else if (m === pr) pos.x = b.x1 + r;
      else if (m === pt) pos.z = b.z0 - r;
      else pos.z = b.z1 + r;
    } else {
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    }
    hit = true;
  }
  return hit;
}

/**
 * Ray (origin o, direction d, max length) against XZ boxes with a top height.
 * Returns the nearest hit distance, or Infinity. The ray is 3D; a box only
 * blocks it while the ray's height is below the box top.
 */
export function rayBoxes(ox, oy, oz, dx, dy, dz, maxDist, boxes) {
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let tmin = 0;
    let tmax = maxDist;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < b.x0 || ox > b.x1) continue;
    } else {
      let t1 = (b.x0 - ox) / dx;
      let t2 = (b.x1 - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (oz < b.z0 || oz > b.z1) continue;
    } else {
      let t1 = (b.z0 - oz) / dz;
      let t2 = (b.z1 - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (tmin < 0) continue;
    const yAt = oy + dy * tmin;
    if (yAt > b.top) continue; // ray passes over the box
    if (tmin < best) best = tmin;
  }
  return best;
}

/** Ray against a sphere; returns nearest hit distance or Infinity. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const ex = cx - ox;
  const ey = cy - oy;
  const ez = cz - oz;
  const tca = ex * dx + ey * dy + ez * dz;
  if (tca < 0) return Infinity;
  const d2 = ex * ex + ey * ey + ez * ez - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

/** 2D segment (x0,z0)-(x1,z1) vs circle (cx,cz,r): true when they touch. */
export function segmentHitsCircle(x0, z0, x1, z1, cx, cz, r) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((cx - x0) * dx + (cz - z0) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = x0 + dx * t - cx;
  const pz = z0 + dz * t - cz;
  return px * px + pz * pz < r * r;
}
