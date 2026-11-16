// render.js — three.js renderer, camera, lights hookup, bot meshes,
// first-person viewmodel gun, and the two pooled effect systems
// (tracers + impact particles). Pooled: zero allocations per shot.
// Perf: pixel ratio capped (1.75 desktop, 1.0 touch), one 1024px
// shadow map, instanced statics (see world.js), ~120 draw calls total.

import * as THREE from 'three';
import { clamp } from './state.js';

const TRACER_MAX = 10;
const PARTICLE_MAX = 160;

export class Render {
  constructor(canvas, quality, isTouch) {
    this.canvas = canvas;
    this.quality = quality;
    this.isTouch = isTouch;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.applyQuality(quality);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
    this.muzzleLight = new THREE.PointLight(0xffc27d, 0, 9, 1.8);
    this.scene.add(this.muzzleLight);
    this._initTracers();
    this._initParticles();
    this._buildViewmodel();
    this.flashT = 0;
  }

  applyQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const cap = this.isTouch ? [1.0, 1.0, 1.0, 1.0][q] : [1.75, 1.5, 1.25, 1.0][q];
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.particleScale = q >= 3 ? 0.5 : 1;
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- tracers: pooled THREE.Line segments, additive, fade in 70ms ---
  _initTracers() {
    this.tracers = [];
    for (let i = 0; i < TRACER_MAX; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;
  }

  spawnTracer(from, to, color) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % TRACER_MAX;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
    pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color || 0xffb347);
    t.line.material.opacity = 0.85;
    t.line.visible = true;
    t.life = 0.07;
  }

  updateTracers(dt) {
    for (let i = 0; i < TRACER_MAX; i++) {
      const t = this.tracers[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.line.visible = false; continue; }
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
    }
  }

  // --- particles: one THREE.Points, fixed buffer, ring allocation ---
  _initParticles() {
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(PARTICLE_MAX * 3);
    this.pVel = new Float32Array(PARTICLE_MAX * 3);
    this.pLife = new Float32Array(PARTICLE_MAX);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.14, transparent: true, opacity: 0.95, depthWrite: false });
    this.points = new THREE.Points(this.pGeo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.pCursor = 0;
    for (let i = 0; i < PARTICLE_MAX; i++) this.pPos[i * 3 + 1] = -50; // park below ground
  }

  spawnParticles(x, y, z, n, spread, up, color) {
    const count = Math.round(n * (this.particleScale || 1));
    for (let k = 0; k < count; k++) {
      const i = this.pCursor;
      this.pCursor = (this.pCursor + 1) % PARTICLE_MAX;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      const a = (k / Math.max(1, count)) * Math.PI * 2 + (i % 7) * 0.35;
      const sp = spread * (0.4 + ((i * 13) % 10) / 16);
      this.pVel[i * 3] = Math.cos(a) * sp;
      this.pVel[i * 3 + 1] = up * (0.5 + ((i * 7) % 10) / 14);
      this.pVel[i * 3 + 2] = Math.sin(a) * sp;
      this.pLife[i] = 0.35 + ((i * 11) % 10) / 40;
    }
    if (color) this.points.material.color.setHex(color);
  }

  updateParticles(dt) {
    let any = false;
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -50; continue; }
      this.pVel[i * 3 + 1] -= 9.5 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pPos[i * 3 + 1] < 0.03) { this.pPos[i * 3 + 1] = 0.03; this.pVel[i * 3 + 1] *= -0.3; }
    }
    if (any) this.pGeo.attributes.position.needsUpdate = true;
  }

  // --- bot meshes: low-poly humanoid, team-coloured, one shared geometry ---
  makeBotMesh(team) {
    const g = new THREE.Group();
    const suit = team === 'atk' ? 0x3f6d4e : 0x8a3b2e;   // green attackers, rust defenders
    const dark = 0x22262b;
    const skin = 0xc9a06a;
    const matSuit = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.85 });
    const matDark = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.9 });
    const matSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), matSuit);
    torso.position.y = 1.12; torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), matSkin);
    head.position.y = 1.62; head.castShadow = true;
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), matDark);
    helm.position.y = 1.78;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), matDark);
    legL.position.set(-0.14, 0.42, 0);
    const legR = legL.clone(); legR.position.x = 0.14;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), matSuit);
    armL.position.set(-0.36, 1.14, 0.08);
    const armR = armL.clone(); armR.position.x = 0.36;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.62), matDark);
    gun.position.set(0.18, 1.28, 0.32);
    // team stripe so bots read at combat distance, never camouflage
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.1, 0.32),
      new THREE.MeshBasicMaterial({ color: team === 'atk' ? 0x59d67a : 0xff5a3c }));
    stripe.position.y = 1.34;
    g.add(torso, head, helm, legL, legR, armL, armR, gun, stripe);
    g.userData = { head, torso, legL, legR, armL, armR, stripe };
    return g;
  }

  // Simple walk-cycle: legs/arms swing with distance travelled.
  animateBot(mesh, speed, dt, crouched) {
    const u = mesh.userData;
    const phase = (mesh.userData.phase = (mesh.userData.phase || 0) + dt * speed * 2.4);
    const amp = clamp(speed / 4.4, 0, 1) * 0.55;
    u.legL.rotation.x = Math.sin(phase) * amp;
    u.legR.rotation.x = -Math.sin(phase) * amp;
    u.armL.rotation.x = -Math.sin(phase) * amp * 0.7;
    u.armR.rotation.x = Math.sin(phase) * amp * 0.7;
    const targetY = crouched ? 0.72 : 1.0;
    mesh.scale.y += (targetY - mesh.scale.y) * Math.min(1, dt * 10);
  }

  // --- first-person viewmodel: boxy rifle that bobs, kicks, dips ---
  _buildViewmodel() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.6 });
    const mid = new THREE.MeshStandardMaterial({ color: 0x3d434d, roughness: 0.45, metalness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff8c2e, roughness: 0.5, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.46), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), mid);
    barrel.position.set(0, 0.02, -0.36);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), accent);
    tip.position.set(0, 0.02, -0.52);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.55, metalness: 0.55 }));
    mag.position.set(0, -0.12, -0.05);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.08), accent);
    grip.position.set(0, -0.1, 0.14);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.14), dark);
    stock.position.set(0, -0.01, 0.28);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.1), accent);
    sight.position.set(0, 0.09, -0.1);
    g.add(body, barrel, tip, mag, grip, stock, sight);
    g.scale.setScalar(0.85);
    g.position.set(0.3, -0.27, -0.55);
    this.viewmodel = g;
    this.vmBase = { x: 0.3, y: -0.27, z: -0.55 };
    this.vmKick = 0;
    this.vmDip = 0;
    this.camera.add(g);
    this.scene.add(this.camera);
    // Muzzle flash quad at the barrel tip.
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.muzzleQuad = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
    this.muzzleQuad.position.set(0.3, -0.23, -0.95);
    this.camera.add(this.muzzleQuad);
  }

  setViewmodel(kind) {
    // Recolour the accent parts per weapon family so the switch reads.
    const accent = kind === 'sniper' ? 0x6fb7ff : kind === 'smg' ? 0x59d67a : kind === 'shotgun' ? 0xff5a3c : 0xff8c2e;
    this.viewmodel.children.forEach((c) => {
      if (c.material && c.material.color && c.position.y < -0.09) c.material.color.setHex(accent);
    });
  }

  updateViewmodel(dt, moving, firing, reloading) {
    const t = performance.now() * 0.001;
    const bob = moving ? Math.sin(t * 9) * 0.008 : 0;
    const bobY = moving ? Math.abs(Math.cos(t * 9)) * 0.01 : 0;
    this.vmKick = Math.max(0, this.vmKick - dt * 6);
    this.vmDip = Math.max(0, this.vmDip - dt * 2.2);
    const vm = this.viewmodel;
    vm.position.set(
      this.vmBase.x + bob,
      this.vmBase.y + bobY - this.vmDip * 0.12,
      this.vmBase.z + this.vmKick * 0.09,
    );
    vm.rotation.x = this.vmKick * 0.16 + this.vmDip * 0.5;
    if (reloading) this.vmDip = Math.max(this.vmDip, 0.55);
    // Muzzle flash decay.
    this.flashT = Math.max(0, this.flashT - dt * 22);
    this.muzzleQuad.material.opacity = this.flashT > 0 ? 0.9 : 0;
    this.muzzleQuad.rotation.z = Math.random() * Math.PI;
    this.muzzleLight.intensity = this.flashT > 0 ? 2.2 : 0;
  }

  muzzleFlashAt(pos) {
    this.muzzleLight.position.copy(pos);
    this.flashT = 1;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
