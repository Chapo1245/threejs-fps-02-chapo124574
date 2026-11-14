// world.js — builds the three.js scene from map data and answers the
// spatial questions the simulation asks: can this circle move here, does
// this ray hit a wall first, can A see B. All collision uses the map's
// own boxes (util.js), never the rendered meshes, so sim and render agree.
import * as THREE from 'three';
import { PALETTE } from './config.js';
import { rayBoxes, resolveCircle, segmentHitsCircle } from './util.js';

const tmpV = new THREE.Vector3();

/** A speckled asphalt texture drawn once on a canvas — no image assets. */
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a4150';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5200; i++) {
    const v = 40 + Math.random() * 34;
    g.fillStyle = `rgb(${v},${v + 4},${v + 12})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Faded lane paint: a centre line and two edge dashes.
  g.strokeStyle = 'rgba(255, 200, 90, 0.35)';
  g.lineWidth = 4;
  g.setLineDash([26, 22]);
  g.beginPath();
  g.moveTo(256, 0);
  g.lineTo(256, 512);
  g.stroke();
  g.strokeStyle = 'rgba(230, 235, 245, 0.22)';
  g.beginPath();
  g.moveTo(60, 0);
  g.lineTo(60, 512);
  g.moveTo(452, 0);
  g.lineTo(452, 512);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A flat letter plate ("A" / "B") painted on the ground at a bomb site. */
function sitePlate(letter, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 108, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = color;
  g.font = 'bold 150px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 136);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  return mesh;
}

/** Build the whole scene for one map. Returns the spatial query handle. */
export function buildWorld(scene, map) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 45, 130);

  const hemi = new THREE.HemisphereLight(0x8a94b8, 0x2a2118, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 1.9);
  sun.position.set(-30, 38, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  const lampA = new THREE.PointLight(PALETTE.lamp, 22, 26, 1.8);
  lampA.position.set(map.sites.A.cx, 5, map.sites.A.cz);
  scene.add(lampA);
  const lampB = new THREE.PointLight(0x9fc4ff, 18, 26, 1.8);
  lampB.position.set(map.sites.B.cx, 5, map.sites.B.cz);
  scene.add(lampB);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 70),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const matCache = new Map();
  const matFor = (color) => {
    let m = matCache.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      matCache.set(color, m);
    }
    return m;
  };

  // Solids: one mesh each (boxes, or cylinders for barrels).
  for (const s of map.solids) {
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    let mesh;
    if (s.shape === 'cyl') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, s.top, 14), matFor(s.color));
      mesh.position.set((s.x0 + s.x1) / 2, s.top / 2, (s.z0 + s.z1) / 2);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, s.top, d), matFor(s.color));
      mesh.position.set((s.x0 + s.x1) / 2, s.top / 2, (s.z0 + s.z1) / 2);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Decor: crane gantry over site A, lamps, site plates.
  for (const d of map.decor) {
    if (d.kind === 'crane') {
      const legMat = matFor(PALETTE.crane);
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, d.height, 0.8), legMat);
        leg.position.set(d.x + sx * d.span / 2, d.height / 2, d.z);
        leg.castShadow = true;
        scene.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(d.span + 1.6, 0.9, 1.1), legMat);
      beam.position.set(d.x, d.height + 0.4, d.z);
      beam.castShadow = true;
      scene.add(beam);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.2), matFor(0x333845));
      hook.position.set(d.x + 2, d.height - 1.2, d.z);
      scene.add(hook);
    } else if (d.kind === 'lamp') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, d.h, 8), matFor(0x22262e));
      pole.position.set(d.x, d.h / 2, d.z);
      scene.add(pole);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 10, 8),
        new THREE.MeshBasicMaterial({ color: PALETTE.lamp }),
      );
      bulb.position.set(d.x, d.h, d.z);
      scene.add(bulb);
    } else if (d.kind === 'sitemark') {
      const site = map.sites[d.site];
      const plate = sitePlate(d.site, d.site === 'A' ? '#ffb454' : '#6ea8ff');
      plate.position.set(site.cx, 0.03, site.cz);
      scene.add(plate);
    }
  }

  return new World(map, scene);
}

export class World {
  constructor(map, scene) {
    this.map = map;
    this.scene = scene;
    this.solids = map.solids;
    // Tracer pool: 24 reusable line segments, no allocation while firing.
    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, until: 0 });
    }
    this.tracerNext = 0;
  }

  /** Move a circle with collision; pos {x, z} is mutated. Returns wall hit. */
  moveCircle(pos, r) {
    return resolveCircle(pos, r, this.solids);
  }

  /** Distance to the nearest wall along a ray, or Infinity. */
  rayWall(ox, oy, oz, dx, dy, dz, maxDist) {
    return rayBoxes(ox, oy, oz, dx, dy, dz, maxDist, this.solids);
  }

  /** True when nothing solid blocks the segment between two points. */
  hasLineOfSight(ax, ay, az, bx, by, bz, smokes) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    const hit = rayBoxes(ax, ay, az, dx / len, dy / len, dz / len, len, this.solids);
    if (hit < len - 0.05) return false;
    if (smokes) {
      for (const s of smokes) {
        // A smoke cloud blocks sight when the segment passes its sphere.
        const cx = s.x - ax;
        const cz = s.z - az;
        const t = Math.max(0, Math.min(1, (cx * dx + cz * dz) / (len * len)));
        const px = ax + dx * t - s.x;
        const pz = az + dz * t - s.z;
        const py = ay + dy * t - 1.0;
        if (px * px + pz * pz < s.radius * s.radius && py < 2.2) return false;
      }
    }
    return true;
  }

  /** Does the 2D segment cross a smoke cloud? (for bot hearing/sight) */
  segmentBlockedBySmoke(x0, z0, x1, z1, smokes) {
    for (const s of smokes) {
      if (segmentHitsCircle(x0, z0, x1, z1, s.x, s.z, s.radius)) return true;
    }
    return false;
  }

  /** Fire a short-lived tracer from muzzle to impact point. */
  spawnTracer(x0, y0, z0, x1, y1, z1, color, now) {
    const t = this.tracers[this.tracerNext];
    this.tracerNext = (this.tracerNext + 1) % this.tracers.length;
    const p = t.line.geometry.attributes.position.array;
    p[0] = x0; p[1] = y0; p[2] = z0;
    p[3] = x1; p[4] = y1; p[5] = z1;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.until = now + 0.09;
  }

  updateTracers(now) {
    for (const t of this.tracers) {
      if (t.until > 0 && now >= t.until) {
        t.line.material.opacity = 0;
        t.until = 0;
      }
    }
  }

  /** A bot body: capsule-ish figure in team colours, head separate for hits. */
  createBotMesh(team) {
    const group = new THREE.Group();
    const bodyColor = team === 'V' ? PALETTE.vanguard : PALETTE.jackal;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 1.05, 10),
      new THREE.MeshLambertMaterial({ color: bodyColor }),
    );
    body.position.y = 0.85;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xd8b48f }),
    );
    head.position.y = 1.55;
    head.castShadow = true;
    group.add(head);
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.1, 0.12),
      new THREE.MeshLambertMaterial({ color: 0x14181f }),
    );
    visor.position.set(0, 1.56, 0.22);
    group.add(visor);
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.14, 0.85),
      new THREE.MeshLambertMaterial({ color: 0x1c2027 }),
    );
    gun.position.set(0.3, 1.15, 0.35);
    group.add(gun);
    // A small team-coloured shoulder light so teams read at a glance.
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: bodyColor }),
    );
    dot.position.set(0, 1.28, -0.36);
    group.add(dot);
    this.scene.add(group);
    return { group, head };
  }

  /** The player's viewmodel gun, parented to the camera. */
  createViewmodel() {
    const group = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c2027 });
    const accent = new THREE.MeshLambertMaterial({ color: 0x8a6b42 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.55), dark);
    barrel.position.set(0, -0.02, -0.3);
    group.add(barrel);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.34), accent);
    body.position.set(0, -0.03, 0.02);
    group.add(body);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.1), dark);
    grip.position.set(0, -0.14, 0.08);
    grip.rotation.x = 0.35;
    group.add(grip);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.12), dark);
    sight.position.set(0, 0.07, -0.05);
    group.add(sight);
    group.position.set(0.28, -0.24, -0.45);
    return group;
  }
}
