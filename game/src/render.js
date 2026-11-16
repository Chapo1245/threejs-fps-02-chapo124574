// render.js — turns state into pixels, and nothing else. No game logic here:
// every frame it syncs meshes from state (actors, tracers, particles, smoke,
// the spike) and positions the camera at the player's eye with recoil + bob.
// Pooled tracers/particles: zero per-frame allocation in the hot loop.
import * as THREE from 'three';
import { eyeHeight } from './actors.js';

const MAX_TRACERS = 10;
const MAX_PARTICLES = 160;
const MAX_SMOKE = 8;

function makeHumanoid(teamColor) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.9 });
  const vest = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.75 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), vest);
  torso.position.y = 1.05; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.52; head.castShadow = true; g.add(head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), dark);
  helmet.position.y = 1.66; g.add(helmet);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.72, 0.22), suit);
  legL.position.set(-0.14, 0.36, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.55, 0.18), suit);
  armL.position.set(-0.34, 1.08, 0.12); armL.rotation.x = -0.9; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.34; g.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), dark);
  gun.position.set(0.2, 1.12, 0.42); g.add(gun);
  g.userData = { legL, legR, armL, armR, head };
  return g;
}

function makeViewmodel() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.55, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2f7f7a, roughness: 0.5, metalness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e5436, roughness: 0.85 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), body);
  g.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 8), body);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.46); g.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.12), accent);
  mag.position.set(0, -0.14, -0.05); mag.rotation.x = 0.25; g.add(mag);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.22), wood);
  stock.position.set(0, 0, 0.4); g.add(stock);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.1), accent);
  sight.position.set(0, 0.1, -0.1); g.add(sight);
  return g;
}

export function createRenderer(appEl, state) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setSize(appEl.clientWidth, appEl.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'webgl';
  appEl.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(74, appEl.clientWidth / appEl.clientHeight, 0.08, 220);
  scene.add(camera); // camera-attached viewmodel + flash light need the camera in the scene

  const viewmodel = makeViewmodel();
  viewmodel.scale.setScalar(0.8);
  viewmodel.position.set(0.24, -0.26, -0.5);
  camera.add(viewmodel);
  const muzzle = new THREE.PointLight(0xffc266, 0, 9, 1.8);
  muzzle.position.set(0.26, -0.18, -0.9);
  camera.add(muzzle);

  // Actor meshes, keyed by actor id.
  const actorMeshes = new Map();
  for (const a of state.actors) {
    const mesh = makeHumanoid(a.team === 'A' ? 0x14b8a6 : 0xd97706);
    mesh.visible = false;
    scene.add(mesh);
    actorMeshes.set(a.id, mesh);
  }
  // The spike: small blinking box, visible when planted or carried (on carrier's back).
  const spike = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.4, metalness: 0.6, emissive: 0xef4444, emissiveIntensity: 0.4 }));
  spike.visible = false; scene.add(spike);
  const spikeLight = new THREE.PointLight(0xef4444, 0, 7, 1.5);
  scene.add(spikeLight);

  // Pooled tracers: thin stretched boxes, reused in order.
  const tracers = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85 });
  for (let i = 0; i < MAX_TRACERS; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat);
    m.visible = false; scene.add(m); tracers.push({ mesh: m, life: 0 });
  }
  // Pooled impact particles: small points cloud, one geometry, positions rewritten.
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pVel = new Float32Array(MAX_PARTICLES * 3);
  const pLife = new Float32Array(MAX_PARTICLES);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xd8c49a, size: 0.09, transparent: true, opacity: 0.95 }));
  points.frustumCulled = false; scene.add(points);
  let pCursor = 0;
  // Pooled smoke puffs: sprite planes with a radial-gradient canvas texture.
  const smokeTex = makeSmokeTexture();
  const smokes = [];
  for (let i = 0; i < MAX_SMOKE; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false; scene.add(m); smokes.push({ mesh: m, life: 0, max: 1 });
  }
  return { renderer, scene, camera, viewmodel, muzzle, actorMeshes, spike, spikeLight, tracers, points, pPos, pVel, pLife, pCursor, smokes };
}

function makeSmokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(225,228,230,0.85)');
  grad.addColorStop(0.6, 'rgba(210,214,216,0.45)');
  grad.addColorStop(1, 'rgba(210,214,216,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function spawnTracer(r, e) {
  let slot = r.tracers.find(t => t.life <= 0) || r.tracers[0];
  const dx = e.ex - e.x, dy = e.ey - e.y, dz = e.ez - e.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  slot.mesh.visible = true;
  slot.mesh.position.set((e.x + e.ex) / 2, (e.y + e.ey) / 2, (e.z + e.ez) / 2);
  slot.mesh.scale.set(1, 1, len);
  slot.mesh.lookAt(e.ex, e.ey, e.ez);
  slot.life = 0.07;
}
function spawnImpact(r, x, y, z) {
  for (let n = 0; n < 10; n++) {
    const i = r.pCursor; r.pCursor = (r.pCursor + 1) % MAX_PARTICLES;
    r.pPos[i * 3] = x; r.pPos[i * 3 + 1] = y; r.pPos[i * 3 + 2] = z;
    r.pVel[i * 3] = (Math.random() - 0.5) * 3.2;
    r.pVel[i * 3 + 1] = Math.random() * 2.6 + 0.4;
    r.pVel[i * 3 + 2] = (Math.random() - 0.5) * 3.2;
    r.pLife[i] = 0.5;
  }
  r.points.geometry.attributes.position.needsUpdate = true;
}

// Consume this frame's sim events that have a visual (audio/hud drain theirs).
export function consumeVisualEvents(r, state) {
  for (const e of state.events) {
    if (e.type === 'tracer') spawnTracer(r, e);
    else if (e.type === 'impact') spawnImpact(r, e.x, e.y, e.z);
    else if (e.type === 'explosion') {
      spawnImpact(r, e.x, e.y + 0.4, e.z);
      spawnImpact(r, e.x, e.y + 0.9, e.z);
      r.muzzle.intensity = 0;
    } else if (e.type === 'smoke') {
      const slot = r.smokes.find(s => s.life <= 0) || r.smokes[0];
      slot.mesh.visible = true;
      slot.mesh.position.set(e.x, e.y + 1.2, e.z);
      slot.life = 14; slot.max = 14;
    }
  }
}

// Per-frame sync: actors, spike, camera, pools.
export function renderFrame(r, state, player, dt, time) {
  const cam = r.camera;
  // Camera: player eye + recoil pitch + walk bob + ADS zoom.
  const gun = player.weapons[player.slot];
  const ads = player.ads && gun && gun.def.zoom > 1;
  const targetFov = ads ? 74 / gun.def.zoom : 74;
  if (Math.abs(cam.fov - targetFov) > 0.1) { cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix(); }
  const bob = player.moveMag * (player.onGround ? 0.028 : 0);
  const bobT = time * (player.crouch ? 6 : 9);
  cam.position.set(player.pos.x, eyeHeight(player) + Math.sin(bobT) * bob, player.pos.z);
  cam.rotation.order = 'YXZ';
  cam.rotation.y = player.yaw;
  cam.rotation.x = player.pitch + Math.sin(bobT * 0.5) * bob * 0.4;
  cam.rotation.z = Math.cos(bobT) * bob * 0.25;
  // Viewmodel: recoil kick + reload dip + ADS centre.
  const vm = r.viewmodel;
  const kick = gun ? gun.bloom * 6 : 0;
  const adsX = ads ? 0 : 0.24, adsY = ads ? -0.185 : -0.26;
  vm.position.x += (adsX - vm.position.x) * Math.min(1, dt * 12);
  vm.position.y += (adsY - vm.position.y) * Math.min(1, dt * 12);
  vm.position.z = -0.5 + kick + (gun && gun.reloading > 0 ? 0.16 : 0);
  vm.rotation.x = kick * 1.4;
  r.muzzle.intensity = Math.max(0, r.muzzle.intensity - dt * 60);

  // Actors: position, yaw, walk-cycle legs, death = fall + fade out.
  for (const a of state.actors) {
    const mesh = r.actorMeshes.get(a.id);
    if (!mesh) continue;
    if (a.isPlayer) { mesh.visible = false; continue; }
    if (!a.alive) {
      mesh.visible = mesh.userData.fallT === undefined || mesh.userData.fallT < 0.6;
      if (mesh.visible) {
        mesh.userData.fallT = (mesh.userData.fallT || 0) + dt;
        mesh.rotation.x = Math.min(Math.PI / 2, (mesh.userData.fallT || 0) * 4);
        mesh.position.y = -0.3;
      }
      continue;
    }
    mesh.userData.fallT = 0;
    mesh.visible = true;
    mesh.position.set(a.pos.x, a.pos.y, a.pos.z);
    mesh.rotation.y = a.yaw + Math.PI; // model faces +z; yaw 0 faces -z
    const swing = a.moveMag * Math.sin(time * 11 + a.id * 2) * 0.55;
    mesh.userData.legL.rotation.x = swing;
    mesh.userData.legR.rotation.x = -swing;
    mesh.userData.armL.rotation.x = -0.9 - swing * 0.3;
    const scaleY = a.crouch ? 0.72 : 1;
    mesh.scale.y += (scaleY - mesh.scale.y) * Math.min(1, dt * 10);
  }
  // Spike.
  const bomb = state.bomb;
  if (bomb.state === 'planted') {
    r.spike.visible = true;
    r.spike.position.set(bomb.x, 0.12, bomb.z);
    r.spike.rotation.y = time * 0.5;
    r.spikeLight.position.set(bomb.x, 0.8, bomb.z);
    r.spikeLight.intensity = 2 + Math.sin(time * 9) * 1.6;
  } else {
    const carrier = state.actors.find(a => a.hasSpike && a.alive && !a.isPlayer);
    if (carrier) {
      r.spike.visible = true;
      r.spike.position.set(carrier.pos.x, 1.35, carrier.pos.z);
      r.spike.rotation.y = carrier.yaw;
      r.spikeLight.intensity = 0;
    } else r.spike.visible = false;
  }
  // Pools decay.
  for (const t of r.tracers) { if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.mesh.visible = false; } }
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (r.pLife[i] > 0) {
      r.pLife[i] -= dt;
      r.pPos[i * 3] += r.pVel[i * 3] * dt;
      r.pPos[i * 3 + 1] += r.pVel[i * 3 + 1] * dt;
      r.pPos[i * 3 + 2] += r.pVel[i * 3 + 2] * dt;
      r.pVel[i * 3 + 1] -= 6 * dt;
      if (r.pLife[i] <= 0) { r.pPos[i * 3 + 1] = -50; }
    }
  }
  r.points.geometry.attributes.position.needsUpdate = true;
  for (const s of r.smokes) {
    if (s.life > 0) {
      s.life -= dt;
      s.mesh.material.opacity = Math.min(0.85, s.life / 2) * (s.life > s.max - 1 ? (s.max - s.life) : 1);
      s.mesh.lookAt(cam.position);
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
  r.renderer.render(r.scene, cam);
}

export function resizeRenderer(r, appEl) {
  r.camera.aspect = appEl.clientWidth / appEl.clientHeight;
  r.camera.updateProjectionMatrix();
  r.renderer.setSize(appEl.clientWidth, appEl.clientHeight);
}
