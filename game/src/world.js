// world.js — builds the three.js scene for one layout and owns all
// spatial queries: AABB collision, line of sight, waypoint routes.
// Static geometry goes into two InstancedMeshes (walls, crates) so the
// whole map costs a handful of draw calls. No per-frame allocation:
// every query reuses module-level scratch values.

import * as THREE from 'three';
import { COLOR_KEYS } from './layouts.js';

// 2D segment vs AABB slab test. Returns true when the segment crosses
// the box (in XZ) and the box is tall enough to block the sight line.
function segmentHitsBox(x0, z0, x1, z1, b, eyeLo) {
  if (b.h < eyeLo) return false; // low cover never blocks sight
  const dx = x1 - x0, dz = z1 - z0;
  let t0 = 0, t1 = 1;
  const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2;
  const bz0 = b.z - b.d / 2, bz1 = b.z + b.d / 2;
  if (Math.abs(dx) < 1e-9) { if (x0 < bx0 || x0 > bx1) return false; }
  else {
    let ta = (bx0 - x0) / dx, tb = (bx1 - x0) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (z0 < bz0 || z0 > bz1) return false; }
  else {
    let ta = (bz0 - z0) / dz, tb = (bz1 - z0) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

export class World {
  // shadowsOn is decided once at boot (off on touch): toggling a light's
  // castShadow at runtime recompiles every material — a visible hitch
  // mid-fight. Adaptive quality only ever changes pixel ratio + particles.
  constructor(scene, layout, palette, sun, hemi, shadowsOn) {
    this.layout = layout;
    this.bounds = layout.bounds;
    this.colliders = [];
    for (const w of layout.walls) this.colliders.push(w);
    for (const c of layout.crates) this.colliders.push(c);
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // Ground: one big plane with a subtle grid texture painted by canvas.
    const groundTex = this._groundTexture(palette.ground);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(layout.bounds.x * 2 + 4, layout.bounds.z * 2 + 4),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.94, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Static boxes as instanced meshes — one per material family.
    this._instanced(layout.walls, 0.85, 0.12, true);
    this._instanced(layout.crates, 0.9, 0.08, false);

    // Site markers: flat rings + floating letter boards.
    this.siteMeshes = {};
    for (const key of ['A', 'B']) {
      const s = layout.sites[key];
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(s.r - 0.35, s.r, 40),
        new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xff8c2e : 0x4fc3ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.x, 0.06, s.z);
      this.group.add(ring);
      const board = this._letterBoard(key, key === 'A' ? '#ff8c2e' : '#4fc3ff');
      board.position.set(s.x, 3.4, s.z);
      this.group.add(board);
      this.siteMeshes[key] = ring;
    }

    // Bomb prop (hidden until planted).
    const bombGeo = new THREE.BoxGeometry(0.55, 0.35, 0.4);
    this.bombMesh = new THREE.Mesh(bombGeo, new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.4, metalness: 0.7, emissive: 0xcc2200, emissiveIntensity: 0.4 }));
    this.bombMesh.visible = false;
    this.bombMesh.castShadow = true;
    this.group.add(this.bombMesh);

    // Lights: hemisphere + one shadow-casting sun + warm lamps.
    const hemiLight = new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity);
    scene.add(hemiLight);
    this.sun = new THREE.DirectionalLight(sun.color, sun.intensity);
    this.sun.position.set(sun.pos[0], sun.pos[1], sun.pos[2]);
    this.sun.target.position.set(0, 0, 0);
    const R = Math.max(layout.bounds.x, layout.bounds.z);
    this.sun.shadow.camera.left = -R - 6; this.sun.shadow.camera.right = R + 6;
    this.sun.shadow.camera.top = R + 6; this.sun.shadow.camera.bottom = -R - 6;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0006;
    this.sun.castShadow = shadowsOn;
    scene.add(this.sun); scene.add(this.sun.target);
    this.lamps = [];
    for (const l of layout.lamps) {
      const pl = new THREE.PointLight(l.color, l.i, 26, 1.6);
      pl.position.set(l.x, l.y, l.z);
      scene.add(pl);
      this.lamps.push(pl);
    }
    // Fog + background from the palette.
    scene.background = new THREE.Color(palette.sky);
    scene.fog = new THREE.Fog(palette.fog, 45, 130);
  }

  _groundTexture(base) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#' + base.toString(16).padStart(6, '0');
    g.fillRect(0, 0, 256, 256);
    // speckle + panel seams, deterministic pattern (fixed loop, no RNG)
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
    }
    for (let i = 0; i < 220; i++) {
      const x = (i * 37) % 256, y = (i * 91) % 256;
      g.fillStyle = i % 3 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
      g.fillRect(x, y, 3, 3);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 6);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _instanced(boxes, roughness, metalness, castShadow) {
    if (!boxes.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness, metalness });
    const mesh = new THREE.InstancedMesh(geo, mat, boxes.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    boxes.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.h / 2, b.z);
      mesh.setMatrixAt(i, m);
      col.setHex(COLOR_KEYS[b.c] || 0x888888);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  _letterBoard(letter, colorCss) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(10,12,14,0.82)';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = colorCss; g.lineWidth = 6;
    g.strokeRect(5, 5, 118, 118);
    g.fillStyle = colorCss;
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, 64, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    );
    return mesh;
  }

  // Circle (XZ) vs AABBs. Moves the circle out along the smallest
  // penetration axis; returns true if any push happened.
  collideCircle(p, r) {
    let hit = false;
    for (let i = 0; i < this.colliders.length; i++) {
      const b = this.colliders[i];
      if (p.y > b.h) continue; // feet above the box top top
      const bx0 = b.x - b.w / 2 - r, bx1 = b.x + b.w / 2 + r;
      const bz0 = b.z - b.d / 2 - r, bz1 = b.z + b.d / 2 + r;
      if (p.x < bx0 || p.x > bx1 || p.z < bz0 || p.z > bz1) continue;
      // inside expanded box: push out on the shallowest axis
      const dxl = p.x - bx0, dxr = bx1 - p.x;
      const dzl = p.z - bz0, dzr = bz1 - p.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) p.x = bx0;
      else if (m === dxr) p.x = bx1;
      else if (m === dzl) p.z = bz0;
      else p.z = bz1;
      hit = true;
    }
    // Outer bounds clamp.
    const bx = this.bounds.x - 0.4, bz = this.bounds.z - 0.4;
    if (p.x < -bx) { p.x = -bx; hit = true; }
    if (p.x > bx) { p.x = bx; hit = true; }
    if (p.z < -bz) { p.z = -bz; hit = true; }
    if (p.z > bz) { p.z = bz; hit = true; }
    return hit;
  }

  // Line of sight between two eye positions, blocked by tall boxes and
  // by active smoke spheres (smokes: [{x,y,z,r}]).
  hasLOS(ax, ay, az, bx, by, bz, smokes) {
    const eyeLo = Math.min(ay, by) - 0.15;
    for (let i = 0; i < this.colliders.length; i++) {
      if (segmentHitsBox(ax, az, bx, bz, this.colliders[i], eyeLo)) return false;
    }
    if (smokes) {
      for (let i = 0; i < smokes.length; i++) {
        const s = smokes[i];
        if (this._segSphere(ax, ay, az, bx, by, bz, s.x, s.y, s.z, s.r)) return false;
      }
    }
    return true;
  }

  _segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = len2 === 0 ? 0 : ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
    return px * px + py * py + pz * pz < r * r;
  }

  // Nearest waypoint node id to a position.
  nearestNode(x, z) {
    const nodes = this.layout.nodes;
    let best = 0, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i][0] - x, dz = nodes[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  nodePos(id, out) {
    const n = this.layout.nodes[id];
    out.x = n[0]; out.z = n[1];
    return out;
  }

  setBombVisible(x, z, visible) {
    this.bombMesh.visible = visible;
    if (visible) this.bombMesh.position.set(x, 0.18, z);
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
