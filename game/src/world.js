// world.js — builds the three.js scene from a map definition and owns every
// spatial query the sim needs: AABB collision, line-of-sight, nav-graph BFS.
// Rendering of actors/effects lives in render.js; this file only builds statics.
import * as THREE from 'three';

// One reusable box geometry; per-box meshes share it (few dozen boxes, cheap).
const BOX = new THREE.BoxGeometry(1, 1, 1);
const BARREL = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 10);
const LAMP_POLE = new THREE.CylinderGeometry(0.07, 0.09, 4.4, 6);
const LAMP_HEAD = new THREE.BoxGeometry(0.7, 0.22, 0.34);
const PIPE = new THREE.CylinderGeometry(0.16, 0.16, 1, 8);

export function buildWorld(scene, map) {
  const pal = map.palette;
  const mats = {};
  for (const [k, v] of Object.entries(pal)) mats[k] = new THREE.MeshStandardMaterial({ color: v, roughness: 0.92, metalness: 0.04 });
  mats.copper.metalness = 0.55; mats.copper.roughness = 0.45;
  mats.copperDark.metalness = 0.5; mats.copperDark.roughness = 0.5;
  mats.pipe.metalness = 0.6; mats.pipe.roughness = 0.4;
  mats.lamp = new THREE.MeshStandardMaterial({ color: 0xf5d76e, emissive: 0xcf9f2e, emissiveIntensity: 0.9 });

  // Sky, fog, lights — decided once at boot, never toggled at runtime.
  scene.background = new THREE.Color(pal.sky);
  scene.fog = new THREE.Fog(pal.fog, 55, 130);
  const hemi = new THREE.HemisphereLight(map.hemi.sky, map.hemi.ground, map.hemi.intensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(map.sun.color, map.sun.intensity);
  sun.position.set(...map.sun.pos);
  sun.castShadow = map.sun.shadow;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 120; sun.shadow.bias = -0.0004;
  }
  scene.add(sun);

  // Ground: big slab + canal strip + site paint rings.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.size.w + 4, map.size.d + 4),
    new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 0.96 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  if (map.canal) {
    const c = map.canal;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(c.x1 - c.x0, c.z1 - c.z0),
      new THREE.MeshStandardMaterial({ color: pal.canal, roughness: 0.25, metalness: 0.35 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set((c.x0 + c.x1) / 2, 0.02, (c.z0 + c.z1) / 2);
    scene.add(water);
  }
  for (const [key, site] of Object.entries(map.sites)) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: pal[site.color], transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(site.r - 0.4, 32),
      new THREE.MeshBasicMaterial({ color: pal[site.color], transparent: true, opacity: 0.10, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(site.x, 0.025, site.z);
    scene.add(disc);
  }

  // Solid boxes: mesh + collision AABB. Boxes stacked on the same footprint
  // (roof caps, container stacks) merge into one collider up to the top box,
  // so a bullet over a low box cannot pass through the stack above it.
  const colliderMap = new Map();
  for (const b of map.boxes) {
    const m = new THREE.Mesh(BOX, mats[b.c] || mats.wall);
    m.position.set(b.x, (b.y || 0) + b.h / 2, b.z);
    m.scale.set(b.w, b.h, b.d);
    m.castShadow = b.h > 2; m.receiveShadow = true;
    scene.add(m);
    const key = b.x + ',' + b.z + ',' + b.w + ',' + b.d;
    const top = (b.y || 0) + b.h;
    const prev = colliderMap.get(key);
    if (!prev || top > prev.h) {
      colliderMap.set(key, { minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: top });
    }
  }
  const colliders = [...colliderMap.values()];
  // Props.
  for (const p of map.props) {
    if (p.kind === 'barrel') {
      const m = new THREE.Mesh(BARREL, mats[p.c] || mats.rust);
      m.position.set(p.x, 0.53, p.z); m.castShadow = true; scene.add(m);
      colliders.push({ minX: p.x - 0.42, maxX: p.x + 0.42, minZ: p.z - 0.42, maxZ: p.z + 0.42, h: 1.05 });
    } else if (p.kind === 'lamp') {
      const pole = new THREE.Mesh(LAMP_POLE, mats.wallDark);
      pole.position.set(p.x, 2.2, p.z); scene.add(pole);
      const head = new THREE.Mesh(LAMP_HEAD, mats.lamp);
      head.position.set(p.x, 4.5, p.z); scene.add(head);
      const glow = new THREE.PointLight(0xffd98a, 6, 12, 1.6);
      glow.position.set(p.x, 4.3, p.z); scene.add(glow);
    } else if (p.kind === 'pipe') {
      const m = new THREE.Mesh(PIPE, mats.pipe);
      m.rotation.z = Math.PI / 2; m.scale.y = p.w || 4;
      m.position.set(p.x, 3.4, p.z); scene.add(m);
    }
  }
  return { colliders, mats, sun };
}

// --- Collision: circle (actor) vs AABBs, resolved axis by axis. -------------
export function collideCircle(colliders, x, z, r) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r; z = nz + (dz / d) * r;
    } else if (d2 <= 1e-8) {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = x - c.minX, pr = c.maxX - x, pt = z - c.minZ, pb = c.maxZ - z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = c.minX - r; else if (m === pr) x = c.maxX + r;
      else if (m === pt) z = c.minZ - r; else z = c.maxZ + r;
    }
  }
  return { x, z };
}

export function pointBlocked(colliders, x, z) {
  for (const c of colliders) if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return true;
  return false;
}

// --- Line of sight: 2D segment vs AABB walls (h >= 1.6 blocks sight). -------
export function losBlocked(colliders, ax, az, bx, bz) {
  for (const c of colliders) {
    if (c.h < 1.6) continue;
    if (segmentHitsAABB(ax, az, bx, bz, c)) return true;
  }
  return false;
}
function segmentHitsAABB(ax, az, bx, bz, c) {
  const dx = bx - ax, dz = bz - az;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) { if (ax < c.minX || ax > c.maxX) return false; }
  else {
    let t1 = (c.minX - ax) / dx, t2 = (c.maxX - ax) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < c.minZ || az > c.maxZ) return false; }
  else {
    let t1 = (c.minZ - az) / dz, t2 = (c.maxZ - az) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// --- Nav graph: BFS shortest path between node indices. ---------------------
export function findPath(map, from, to) {
  if (from === to) return [to];
  const prev = new Array(map.nodes.length).fill(-1);
  const queue = [from]; prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const [a, b] of map.links) {
      const nxt = a === cur ? b : b === cur ? a : -1;
      if (nxt >= 0 && prev[nxt] === -1) {
        prev[nxt] = cur;
        if (nxt === to) {
          const path = [to]; let n = to;
          while (n !== from) { n = prev[n]; path.unshift(n); }
          return path;
        }
        queue.push(nxt);
      }
    }
  }
  return [to];
}

export function nearestNode(map, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < map.nodes.length; i++) {
    const n = map.nodes[i];
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
