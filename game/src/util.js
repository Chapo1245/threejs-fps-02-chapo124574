// util.js — small pure math helpers shared by the simulation.
// No imports. Every function here is allocation-free in its hot path:
// callers pass in scratch objects where a result is needed per frame.

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

// Deterministic seeded RNG (mulberry32). The game uses it for bot skill,
// round targets and cosmetic variation so a ?shot= render is reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Move a circle (x, z, radius r) by (dx, dz) against axis-aligned solids
// {x0, z0, x1, z1}. Axis-separated so the circle slides along walls.
// Returns [nx, nz] and writes the actually-moved deltas into `out` [mx, mz].
export function moveCircle(x, z, dx, dz, r, solids, out) {
  let nx = x + dx;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (z + r > s.z0 && z - r < s.z1 && nx + r > s.x0 && nx - r < s.x1) {
      if (dx > 0) nx = s.x0 - r; else if (dx < 0) nx = s.x1 + r;
    }
  }
  let nz = z + dz;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (nx + r > s.x0 && nx - r < s.x1 && nz + r > s.z0 && nz - r < s.z1) {
      if (dz > 0) nz = s.z0 - r; else if (dz < 0) nz = s.z1 + r;
    }
  }
  out[0] = nx - x; out[1] = nz - z;
  return [nx, nz];
}

// Ray vs an AABB {x0,y0,z0,x1,y1,z1} by the slab method.
// Returns the entry distance along the ray, or Infinity when it misses.
export function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [b.x0, b.y0, b.z0], mx = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Ray vs a sphere. Returns the nearest positive distance, or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Is the segment (a -> b) blocked by any solid? Solids are {x0,z0,x1,z1,h}
// (ground y0 = 0, top y1 = h). Optional `spheres` are {x,y,z,r} smoke
// clouds, which block sight the same way.
export function segmentBlocked(ax, ay, az, bx, by, bz, solids, spheres) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  const ix = dx / len, iy = dy / len, iz = dz / len;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    const t = rayAABB(ax, ay, az, ix, iy, iz,
      { x0: s.x0, y0: 0, z0: s.z0, x1: s.x1, y1: s.h, z1: s.z1 });
    if (t < len) return true;
  }
  if (spheres) {
    for (let i = 0; i < spheres.length; i++) {
      const s = spheres[i];
      if (raySphere(ax, ay, az, ix, iy, iz, s.x, s.y, s.z, s.r) < len) return true;
    }
  }
  return false;
}

// Yaw (radians, 0 = facing -Z... we use 0 = facing +X) helpers.
export function yawToDir(yaw) { return [Math.cos(yaw), Math.sin(yaw)]; }
export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
