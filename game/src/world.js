// world.js — builds the visible Brickline district from mapdata and keeps
// the per-frame visuals (bodies, tracers, smoke, bomb, rifle) in sync with
// the simulation state. The simulation owns all game data; this module only
// draws it. All art is procedural: canvas textures and styled geometry.

import * as THREE from 'three';
import { MAP } from './mapdata.js';
import { mulberry32 } from './util.js';

const BRICK_TONES = [
  { base: '#a85a38', mortar: '#7c4230', dark: '#8a4527' },
  { base: '#96402e', mortar: '#6e2f22', dark: '#7a3222' },
  { base: '#b57a44', mortar: '#8a5c31', dark: '#96683a' },
  { base: '#8a4a34', mortar: '#653626', dark: '#743c2a' },
];
const CONTAINER_COLORS = ['#2e5f8a', '#a85a28', '#2e7a6a', '#7a7a3a'];

function canvasTex(w, h, draw, rx, ry) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx || 1, ry || 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function brickTexture(tone) {
  const t = BRICK_TONES[tone];
  const rnd = mulberry32(100 + tone * 17);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = t.mortar; g.fillRect(0, 0, w, h);
    const bh = 16, bw = 42;
    for (let y = 0; y < h; y += bh) {
      const off = (y / bh) % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w + bw; x += bw) {
        const v = 0.86 + rnd() * 0.28;
        g.fillStyle = shade(t.base, v);
        g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
        if (rnd() < 0.12) { g.fillStyle = t.dark; g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2); }
      }
    }
  }, 1, 1);
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

function asphaltTexture() {
  const rnd = mulberry32(42);
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#3b3b3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    for (let i = 0; i < 9; i++) {
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.fillRect(rnd() * w, 0, 20 + rnd() * 50, h);
    }
  }, 10, 8);
}

function containerTexture(tone) {
  const rnd = mulberry32(300 + tone * 13);
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = CONTAINER_COLORS[tone]; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 5, h);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 5, 0, 2, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    if (rnd() < 1) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.font = 'bold 20px Arial'; g.fillText('BRICKLINE', 14, 34); }
  }, 1, 1);
}

function crosswalkTexture() {
  return canvasTex(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(240,240,235,0.85)';
    for (let x = 8; x < w; x += 36) g.fillRect(x, 6, 18, h - 12);
  }, 1, 1);
}

// One blocky humanoid. Head and torso refs are kept for hit tests and for
// the minimap arrow. Team colours: azure blue / rust amber, spiky hair
// like the reference bots, backpack and a held gun box.
export function makeBody(team) {
  const g = new THREE.Group();
  const main = team === 'azure' ? 0x2f7fe0 : 0xe8862e;
  const dark = team === 'azure' ? 0x1d4e8a : 0x8a4a12;
  const skin = 0xc9a184;
  const hair = team === 'azure' ? 0x2a2118 : 0xd8b25e;
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w, h, d, c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z); g.add(m); return m;
  };
  const legL = box(0.22, 0.72, 0.24, 0x2e2a26, -0.14, 0.36, 0);
  const legR = box(0.22, 0.72, 0.24, 0x2e2a26, 0.14, 0.36, 0);
  const torso = box(0.62, 0.68, 0.36, main, 0, 1.08, 0);
  box(0.66, 0.3, 0.4, dark, 0, 1.14, 0); // vest
  box(0.3, 0.44, 0.14, 0x3a2f26, 0, 1.1, -0.26); // backpack
  const head = box(0.34, 0.34, 0.34, skin, 0, 1.62, 0);
  box(0.36, 0.1, 0.36, hair, 0, 1.82, 0); // hair cap
  box(0.1, 0.22, 0.1, hair, -0.1, 1.92, 0); // spikes
  box(0.1, 0.28, 0.1, hair, 0.08, 1.95, -0.04);
  box(0.08, 0.2, 0.08, hair, 0.16, 1.9, 0.06);
  const armL = box(0.16, 0.55, 0.18, main, -0.4, 1.12, 0.12);
  const armR = box(0.16, 0.55, 0.18, main, 0.4, 1.12, 0.12);
  const gun = box(0.09, 0.14, 0.85, 0x1c1e22, 0.12, 1.18, 0.45);
  armL.rotation.x = -0.9; armR.rotation.x = -0.9;
  gun.rotation.x = 0.12;
  g.userData = { head, torso, legL, legR, armL, armR, gun, walkPhase: 0 };
  return g;
}

// First-person rifle view model, attached to the camera.
export function makeRifle() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const dark = mat(0x4a4e57), mid = mat(0x6b707a), accent = mat(0x8a6a3a);
  const box = (w, h, d, m, x, y, z) => {
    const q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    q.position.set(x, y, z); g.add(q); return q;
  };
  box(0.09, 0.13, 0.62, dark, 0, 0, -0.1);          // receiver
  box(0.05, 0.05, 0.5, mid, 0, 0.02, -0.55);        // barrel
  box(0.07, 0.09, 0.1, accent, 0, 0.1, -0.12);      // scope
  box(0.06, 0.2, 0.1, dark, 0, -0.14, 0.02);        // magazine
  box(0.08, 0.1, 0.3, dark, 0, -0.02, 0.28);        // stock
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  flash.position.set(0, 0.02, -0.82); flash.visible = false;
  g.add(flash);
  g.position.set(0.26, -0.23, -0.45);
  g.userData.flash = flash;
  return g;
}

export function createWorld(scene) {
  scene.background = new THREE.Color(0xf0c184);
  scene.fog = new THREE.Fog(0xeab27c, 55, 155);
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x8a6a52, 0.85));
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.35);
  sun.position.set(-40, 30, -18);
  scene.add(sun);

  // --- ground: asphalt + painted road markings ---
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(88, 64),
    new THREE.MeshLambertMaterial({ map: asphaltTexture() }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const yellow = new THREE.MeshLambertMaterial({ color: 0xc9a227 });
  const white = new THREE.MeshLambertMaterial({ color: 0xd8d8d2 });
  const mark = (w, d, x, z, m) => {
    const q = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), m);
    q.position.set(x, 0.011, z); scene.add(q);
  };
  for (const z of [-21, 0, 21]) {
    mark(80, 0.14, 0, z - 0.32, yellow); mark(80, 0.14, 0, z + 0.32, yellow);
  }
  const cwTex = crosswalkTexture();
  for (const [x, z] of [[-13, -21], [13, -21], [-13, 21], [13, 21], [-13, 0], [13, 0]]) {
    const cw = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4),
      new THREE.MeshLambertMaterial({ map: cwTex, transparent: true }));
    cw.rotation.x = -Math.PI / 2; cw.rotation.z = Math.PI / 2;
    cw.position.set(x, 0.012, z); scene.add(cw);
  }

  // --- buildings: brick boxes with cloned brick textures + roof caps ---
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a3a30 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x241a14 });
  const brickTexes = [0, 1, 2, 3].map(brickTexture);
  const winDark = [];
  const winLit = [];
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3(1, 1, 1);
  const rndWin = mulberry32(99);
  for (const s of MAP.solids) {
    if (s.kind !== 'brick') continue;
    const w = s.x1 - s.x0, d = s.z1 - s.z0;
    const tex = brickTexes[s.tone].clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 9)), Math.max(1, Math.round(s.h / 9)));
    const side = new THREE.MeshLambertMaterial({ map: tex });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, s.h, d),
      [side, side, roofMat, darkMat, side, side]);
    mesh.position.set((s.x0 + s.x1) / 2, s.h / 2, (s.z0 + s.z1) / 2);
    scene.add(mesh);
    // Windows: grids on all four faces, lit ones sprinkled in.
    const faces = [
      { n: 0, len: d, at: (t) => [s.x0 - 0.02, t, s.z0], ry: -Math.PI / 2, axis: 'z' },
      { n: 1, len: d, at: (t) => [s.x1 + 0.02, t, s.z0], ry: Math.PI / 2, axis: 'z' },
      { n: 2, len: w, at: (t) => [s.x0, t, s.z0 - 0.02], ry: Math.PI, axis: 'x' },
      { n: 3, len: w, at: (t) => [s.x0, t, s.z1 + 0.02], ry: 0, axis: 'x' },
    ];
    for (const f of faces) {
      for (let y = 2.4; y + 1.8 < s.h - 0.4; y += 3) {
        for (let t = 1.8; t + 1.4 < f.len - 0.6; t += 3) {
          const [px, , pz] = f.at(t);
          const x = f.axis === 'z' ? px : px + t;
          const z = f.axis === 'z' ? pz + t : pz;
          tmpE.set(0, f.ry, 0); tmpQ.setFromEuler(tmpE);
          tmpV.set(x, y + 0.9, z);
          tmpM.compose(tmpV, tmpQ, tmpS);
          (rndWin() < 0.16 ? winLit : winDark).push(tmpM.clone());
        }
      }
    }
  }
  const winGeo = new THREE.PlaneGeometry(1.4, 1.8);
  const mkInst = (list, mat) => {
    const im = new THREE.InstancedMesh(winGeo, mat, Math.max(1, list.length));
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return im;
  };
  mkInst(winDark, new THREE.MeshLambertMaterial({ color: 0x1a2430 }));
  mkInst(winLit, new THREE.MeshBasicMaterial({ color: 0xffc06a }));

  // --- containers, crates, barrels, van, crane ---
  const contTexes = [0, 1, 2, 3].map(containerTexture);
  for (const s of MAP.solids) {
    if (s.kind === 'brick') continue;
    const w = s.x1 - s.x0, d = s.z1 - s.z0;
    let mat;
    if (s.kind === 'container') {
      const tex = contTexes[s.tone].clone(); tex.needsUpdate = true;
      mat = new THREE.MeshLambertMaterial({ map: tex });
    } else if (s.kind === 'crate') {
      mat = new THREE.MeshLambertMaterial({ color: s.tone % 2 ? 0x8a6a3a : 0x6a5a3a });
    } else if (s.kind === 'barrel') {
      mat = new THREE.MeshLambertMaterial({ color: ['#7a3a2a', '#3a5a7a', '#5a7a3a', '#8a7a2a'][s.tone] });
    } else if (s.kind === 'van') {
      mat = new THREE.MeshLambertMaterial({ color: 0x5a6a72 });
    } else { // crane leg
      mat = new THREE.MeshLambertMaterial({ color: 0xb0702a });
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, s.h, d), mat);
    mesh.position.set((s.x0 + s.x1) / 2, s.h / 2, (s.z0 + s.z1) / 2);
    scene.add(mesh);
    if (s.kind === 'van') {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.9),
        new THREE.MeshLambertMaterial({ color: 0x3a4a52 }));
      cab.position.set(s.x1 - 0.4, s.h + 0.4, (s.z0 + s.z1) / 2);
      scene.add(cab);
    }
  }
  // Crane jib across site A + counterweight box.
  const jib = MAP.craneJib;
  const jibMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, jib.z1 - jib.z0 + 4),
    new THREE.MeshLambertMaterial({ color: 0xb0702a }));
  jibMesh.position.set(jib.x0, jib.y, (jib.z0 + jib.z1) / 2);
  scene.add(jibMesh);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.9),
    new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
  hook.position.set(jib.x0, jib.y - 3.4, jib.z0 + 3);
  scene.add(hook);

  // --- lamps (pole + warm head) and planters ---
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const [x, z] of MAP.lamps) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5.4, 0.14), poleMat);
    pole.position.set(x, 2.7, z); scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), lampHeadMat);
    head.position.set(x, 5.5, z); scene.add(head);
  }
  const planterMat = new THREE.MeshLambertMaterial({ color: 0x6a5a48 });
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x4a6a3a });
  for (const [x, z] of MAP.planters) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 1.1), planterMat);
    p.position.set(x, 0.28, z); scene.add(p);
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.9), bushMat);
    b.position.set(x, 0.75, z); scene.add(b);
  }

  // --- bomb mesh (hidden until planted) ---
  const bomb = new THREE.Group();
  const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x1c1e22 }));
  bomb.add(bombBody);
  const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  bombLight.position.set(0, 0.22, 0);
  bomb.add(bombLight);
  bomb.visible = false;
  scene.add(bomb);

  // --- pooled tracers + impact sparks (no per-frame allocation) ---
  const tracers = [];
  for (let i = 0; i < 10; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, ttl: 0 });
  }
  const sparks = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0 }));
    scene.add(m);
    sparks.push({ mesh: m, ttl: 0 });
  }
  // --- pooled smoke spheres (rendered from sim state) ---
  const smokeMeshes = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xb8b8b8, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    smokeMeshes.push(m);
  }
  let tracerIdx = 0, sparkIdx = 0;

  return {
    bomb, bombLight, tracers, sparks, smokeMeshes,
    fireTracer(from, to) {
      const t = tracers[tracerIdx]; tracerIdx = (tracerIdx + 1) % tracers.length;
      const p = t.line.geometry.attributes.position.array;
      p[0] = from.x; p[1] = from.y; p[2] = from.z;
      p[3] = to.x; p[4] = to.y; p[5] = to.z;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.material.opacity = 0.95;
      t.ttl = 0.07;
    },
    fireSpark(at) {
      const s = sparks[sparkIdx]; sparkIdx = (sparkIdx + 1) % sparks.length;
      s.mesh.position.set(at.x, at.y, at.z);
      s.mesh.material.opacity = 1;
      s.mesh.scale.setScalar(1);
      s.ttl = 0.18;
    },
    update(dt, S) {
      for (const t of tracers) {
        if (t.ttl > 0) {
          t.ttl -= dt;
          t.line.material.opacity = Math.max(0, t.ttl / 0.07) * 0.95;
        }
      }
      for (const s of sparks) {
        if (s.ttl > 0) {
          s.ttl -= dt;
          s.mesh.material.opacity = Math.max(0, s.ttl / 0.18);
          s.mesh.scale.setScalar(1 + (0.18 - s.ttl) * 6);
        }
      }
      // Bomb: blink faster as the timer runs down.
      if (S.bomb.state === 'planted') {
        bomb.visible = true;
        bomb.position.set(S.bomb.x, 0.18, S.bomb.z);
        const rate = S.bomb.timer < 10 ? 10 : 3;
        bombLight.material.color.setHex(Math.sin(performance.now() / 1000 * rate * Math.PI) > 0 ? 0xff2a1a : 0x550000);
      } else {
        bomb.visible = false;
      }
      // Smoke clouds from sim state.
      smokeMeshes.forEach((m, i) => {
        const s = S.smokes[i];
        if (s && s.ttl > 0) {
          m.visible = true;
          m.position.set(s.x, s.y, s.z);
          m.scale.setScalar(s.r);
          m.material.opacity = 0.5 * Math.min(1, s.ttl / 2);
        } else {
          m.visible = false;
        }
      });
    },
  };
}
