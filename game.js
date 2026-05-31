import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ---------------------------------------------------------------------------
// Field dimensions (world units). X = left/right, Y = up, Z = depth.
// ---------------------------------------------------------------------------
const FIELD_HALF_X = 5;
const FIELD_BACK = 5;
const FIELD_FRONT = 2.5;      // open front edge (shallow so coins spill)
const WIN_HALF_X = 2.5;
const WALL_HEIGHT = 2.0;

const COIN_RADIUS = 0.55;
const COIN_HEIGHT = 0.18;
const MAX_COINS = 220;

const PUSHER_DEPTH = 2;
const PUSHER_WIDTH = FIELD_HALF_X * 2 - 0.4;
const PUSHER_HEIGHT = 1.4;
const PUSHER_CENTER_Z = -2.0;
const PUSHER_AMPLITUDE = 1.5;
const PUSHER_SPEED = 1.1;

const CYAN = 0x00eaff;
const MAGENTA = 0xff2bd6;
const LIME = 0x39ff88;
const GOLD = 0xffc233;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let stock = 50;
let won = 0;
const coins = [];
let dropX = 0;

const stockEl = document.getElementById('stock');
const wonEl = document.getElementById('won');
const onboardEl = document.getElementById('onboard');
const toastEl = document.getElementById('toast');

// ---------------------------------------------------------------------------
// Renderer + composer (bloom)
// ---------------------------------------------------------------------------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060f);
scene.fog = new THREE.Fog(0x04060f, 16, 32);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3.8, 9.8, 12.2);
camera.lookAt(0, 0.1, -1.0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Higher threshold so only the bright neon emissives bloom (not the lit deck).
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 0.92);
composer.addPass(bloom);

// ---------------------------------------------------------------------------
// Lighting (dim, neon-tinted)
// ---------------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
scene.add(new THREE.HemisphereLight(0xbfe9ff, 0x101830, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(4, 12, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -9; key.shadow.camera.right = 9;
key.shadow.camera.top = 10; key.shadow.camera.bottom = -8;
key.shadow.camera.near = 1; key.shadow.camera.far = 36;
scene.add(key);
const cyanLight = new THREE.PointLight(CYAN, 0.6, 30); cyanLight.position.set(-7, 4, 2); scene.add(cyanLight);
const magLight = new THREE.PointLight(MAGENTA, 0.6, 30); magLight.position.set(7, 4, 2); scene.add(magLight);

// ---------------------------------------------------------------------------
// Physics world
// ---------------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 12;
world.defaultContactMaterial.friction = 0.35;
world.defaultContactMaterial.restitution = 0.02;

const groundMat = new CANNON.Material('ground');
const coinMat = new CANNON.Material('coin');
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, coinMat, { friction: 0.45, restitution: 0.03 }));
world.addContactMaterial(new CANNON.ContactMaterial(coinMat, coinMat, { friction: 0.28, restitution: 0.02 }));

function addCollider(w, h, d, pos) {
  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
    material: groundMat,
  });
  body.position.set(pos.x, pos.y, pos.z);
  world.addBody(body);
}

// ---------------------------------------------------------------------------
// Neon helpers
// ---------------------------------------------------------------------------
function neonBar(w, h, d, pos, color) {
  // Emissive-bright bar that blooms. MeshStandard with strong emissive keeps a
  // little shading while still glowing through the bloom pass.
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x111418, emissive: color, emissiveIntensity: 2.4, roughness: 0.4 })
  );
  mesh.position.set(pos.x, pos.y, pos.z);
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Cabinet
// ---------------------------------------------------------------------------
const deckMat = new THREE.MeshStandardMaterial({ color: 0xaebdd8, metalness: 0.1, roughness: 0.6 });
const deck = new THREE.Mesh(new THREE.BoxGeometry(FIELD_HALF_X * 2, 0.6, FIELD_BACK + FIELD_FRONT), deckMat);
deck.position.set(0, -0.3, (FIELD_FRONT - FIELD_BACK) / 2);
deck.receiveShadow = true;
scene.add(deck);
addCollider(FIELD_HALF_X * 2, 0.6, FIELD_BACK + FIELD_FRONT, { x: 0, y: -0.3, z: (FIELD_FRONT - FIELD_BACK) / 2 });

// Dark glass side / back walls (physics + subtle mesh)
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1430, metalness: 0.3, roughness: 0.3, transparent: true, opacity: 0.45 });
function wall(w, h, d, pos) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
  m.position.set(pos.x, pos.y, pos.z);
  scene.add(m);
  addCollider(w, h, d, pos);
}
const midZ = (FIELD_FRONT - FIELD_BACK) / 2;
wall(FIELD_HALF_X * 2, WALL_HEIGHT, 0.3, { x: 0, y: WALL_HEIGHT / 2 - 0.3, z: -FIELD_BACK });          // back
wall(0.3, WALL_HEIGHT, FIELD_BACK + FIELD_FRONT, { x: -FIELD_HALF_X, y: WALL_HEIGHT / 2 - 0.3, z: midZ }); // left
wall(0.3, WALL_HEIGHT, FIELD_BACK + FIELD_FRONT, { x: FIELD_HALF_X, y: WALL_HEIGHT / 2 - 0.3, z: midZ });  // right

// Neon edge rails (cyan left, magenta right, cyan back)
const railY = WALL_HEIGHT - 0.3 + 0.05;
neonBar(0.14, 0.14, FIELD_BACK + FIELD_FRONT, { x: -FIELD_HALF_X, y: railY, z: midZ }, CYAN);
neonBar(0.14, 0.14, FIELD_BACK + FIELD_FRONT, { x: FIELD_HALF_X, y: railY, z: midZ }, MAGENTA);
neonBar(FIELD_HALF_X * 2, 0.14, 0.14, { x: 0, y: railY, z: -FIELD_BACK }, CYAN);
// Front edge neon lips (cyan win center, magenta lost sides) sit at floor level
neonBar(WIN_HALF_X * 2, 0.1, 0.12, { x: 0, y: 0.02, z: FIELD_FRONT }, LIME);
neonBar(FIELD_HALF_X - WIN_HALF_X, 0.1, 0.12, { x: -(WIN_HALF_X + (FIELD_HALF_X - WIN_HALF_X) / 2), y: 0.02, z: FIELD_FRONT }, MAGENTA);
neonBar(FIELD_HALF_X - WIN_HALF_X, 0.1, 0.12, { x: (WIN_HALF_X + (FIELD_HALF_X - WIN_HALF_X) / 2), y: 0.02, z: FIELD_FRONT }, MAGENTA);

// Glowing win-zone strip on the deck (pulses)
const winZone = new THREE.Mesh(
  new THREE.PlaneGeometry(WIN_HALF_X * 2, 1.4),
  new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
);
winZone.rotation.x = -Math.PI / 2;
winZone.position.set(0, 0.02, FIELD_FRONT - 0.7);
scene.add(winZone);

// ---------------------------------------------------------------------------
// Back title + neon rings
// ---------------------------------------------------------------------------
function makeTitleTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = '900 110px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // outer glow
  ctx.shadowColor = '#00eaff';
  ctx.shadowBlur = 40;
  ctx.fillStyle = '#bff6ff';
  ctx.fillText('NEON MEDAL PUSHER', 512, 130);
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#00eaff';
  ctx.strokeText('NEON MEDAL PUSHER', 512, 130);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
const title = new THREE.Mesh(
  new THREE.PlaneGeometry(8.6, 2.15),
  new THREE.MeshBasicMaterial({ map: makeTitleTexture(), transparent: true, depthWrite: false })
);
title.position.set(0, 3.05, -5.05);
scene.add(title);

function neonRing(x, color) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.11, 16, 48),
    new THREE.MeshStandardMaterial({ color: 0x111418, emissive: color, emissiveIntensity: 2.6, roughness: 0.4 })
  );
  ring.position.set(x, 1.7, -4.75);
  ring.rotation.x = -0.35;
  scene.add(ring);
  return ring;
}
const ringL = neonRing(-2.3, CYAN);
const ringR = neonRing(2.3, MAGENTA);

// ---------------------------------------------------------------------------
// Pusher (light body + neon front trim)
// ---------------------------------------------------------------------------
const pusher = new THREE.Group();
const pusherBox = new THREE.Mesh(
  new THREE.BoxGeometry(PUSHER_WIDTH, PUSHER_HEIGHT, PUSHER_DEPTH),
  new THREE.MeshStandardMaterial({ color: 0xdfe6f2, metalness: 0.35, roughness: 0.4 })
);
pusherBox.castShadow = true;
pusherBox.receiveShadow = true;
pusher.add(pusherBox);
const pusherTrim = new THREE.Mesh(
  new THREE.BoxGeometry(PUSHER_WIDTH, 0.12, 0.12),
  new THREE.MeshStandardMaterial({ color: 0x111418, emissive: CYAN, emissiveIntensity: 2.4, roughness: 0.4 })
);
pusherTrim.position.set(0, PUSHER_HEIGHT / 2, PUSHER_DEPTH / 2);
pusher.add(pusherTrim);
scene.add(pusher);

const pusherBody = new CANNON.Body({
  type: CANNON.Body.KINEMATIC,
  shape: new CANNON.Box(new CANNON.Vec3(PUSHER_WIDTH / 2, PUSHER_HEIGHT / 2, PUSHER_DEPTH / 2)),
  material: groundMat,
});
pusherBody.position.set(0, PUSHER_HEIGHT / 2, PUSHER_CENTER_Z);
world.addBody(pusherBody);

// Drop indicator
const indicator = new THREE.Mesh(
  new THREE.CylinderGeometry(COIN_RADIUS * 1.15, COIN_RADIUS * 1.15, 0.04, 24),
  new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
);
indicator.position.set(0, 0.06, -1.4);
scene.add(indicator);

// ---------------------------------------------------------------------------
// Coins (gold cylinder with an embossed star on the caps)
// ---------------------------------------------------------------------------
function makeStarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 110, 20, 128, 128, 130);
  g.addColorStop(0, '#fff1bf');
  g.addColorStop(0.5, '#ffce4d');
  g.addColorStop(1, '#c8841f');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(128, 128, 126, 0, Math.PI * 2); ctx.fill();
  // rim
  ctx.lineWidth = 12; ctx.strokeStyle = '#a9690f';
  ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.stroke();
  // star
  const spikes = 5, outer = 64, inner = 27, cx = 128, cy = 132;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#8a5510';
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
const starTex = makeStarTexture();
const coinSideMat = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.75, roughness: 0.3, emissive: 0x4a2f00, emissiveIntensity: 0.3 });
const coinCapMat = new THREE.MeshStandardMaterial({ map: starTex, metalness: 0.55, roughness: 0.35, emissive: 0x3a2600, emissiveIntensity: 0.25 });
const coinMats = [coinSideMat, coinCapMat, coinCapMat]; // [lateral, top, bottom]
const coinGeo = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_HEIGHT, 28);
const coinShape = new CANNON.Cylinder(COIN_RADIUS, COIN_RADIUS, COIN_HEIGHT, 16);

function spawnCoin(x, z, y = 4.5) {
  if (coins.length >= MAX_COINS) {
    const old = coins.shift();
    scene.remove(old.mesh);
    world.removeBody(old.body);
  }
  const mesh = new THREE.Mesh(coinGeo, coinMats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 1, shape: coinShape, material: coinMat });
  body.position.set(x, y, z);
  body.quaternion.setFromEuler(Math.PI / 2, Math.random() * Math.PI * 2, 0);
  body.angularDamping = 0.5;
  body.linearDamping = 0.02;
  body.sleepSpeedLimit = 0.15;
  body.sleepTimeLimit = 0.4;
  world.addBody(body);

  coins.push({ body, mesh });
}

// Initial pile in front of the pusher.
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 7; col++) {
    const x = -3.6 + col * 1.2 + (Math.random() - 0.5) * 0.2;
    const z = -0.8 + row * 0.7 + (Math.random() - 0.5) * 0.12;
    spawnCoin(x, z, 0.3 + row * 0.05);
  }
}

// ---------------------------------------------------------------------------
// Sparkle particles (pool of additive sprites)
// ---------------------------------------------------------------------------
function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const sparkTex = makeSparkTexture();
const SPARKS = [];
for (let i = 0; i < 140; i++) {
  const mat = new THREE.SpriteMaterial({ map: sparkTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.visible = false;
  s.scale.setScalar(0.4);
  scene.add(s);
  SPARKS.push({ sprite: s, vel: new THREE.Vector3(), life: 0, maxLife: 1 });
}
function burst(pos, color, count = 18) {
  let made = 0;
  for (const p of SPARKS) {
    if (p.life > 0) continue;
    p.sprite.position.copy(pos);
    p.sprite.material.color.setHex(color);
    p.vel.set((Math.random() - 0.5) * 4, 2 + Math.random() * 3.5, (Math.random() - 0.5) * 4);
    p.maxLife = 0.5 + Math.random() * 0.5;
    p.life = p.maxLife;
    p.sprite.visible = true;
    if (++made >= count) break;
  }
}
function updateSparks(dt) {
  for (const p of SPARKS) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.sprite.visible = false; continue; }
    p.vel.y -= 9 * dt;
    p.sprite.position.addScaledVector(p.vel, dt);
    const t = p.life / p.maxLife;
    p.sprite.material.opacity = t;
    p.sprite.scale.setScalar(0.25 + t * 0.55);
  }
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
function dropMedal() {
  if (stock <= 0) { showToast('メダル切れ', '#ff6b6b'); return; }
  stock--;
  updateHud();
  spawnCoin(dropX + (Math.random() - 0.5) * 0.2, -1.4, 5);
}

window.addEventListener('pointermove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  dropX = THREE.MathUtils.clamp(nx * (FIELD_HALF_X - 1), -(FIELD_HALF_X - 1), FIELD_HALF_X - 1);
  indicator.position.x = dropX;
});
canvas.addEventListener('pointerdown', dropMedal);
document.getElementById('dropBtn').addEventListener('click', (e) => { e.stopPropagation(); dropMedal(); });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); dropMedal(); } });

// ---------------------------------------------------------------------------
// Toast + HUD
// ---------------------------------------------------------------------------
let toastTimer = null;
function showToast(text, color) {
  toastEl.textContent = text;
  toastEl.style.color = color || '#ffe08a';
  toastEl.style.textShadow = `0 0 24px ${color || '#ffe08a'}`;
  toastEl.classList.remove('toast-show');
  void toastEl.offsetWidth;
  toastEl.classList.add('toast-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('toast-show'), 760);
}
function updateHud() {
  stockEl.textContent = stock;
  wonEl.textContent = won;
  onboardEl.textContent = coins.length;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;
let accumulator = 0;
const FIXED = 1 / 60;       // physics runs at a fixed 60 Hz regardless of fps
const WARMUP = 2.0;

function stepPhysics() {
  elapsed += FIXED;
  // Kinematic pusher: move smoothly and impart velocity so it pushes coins.
  const prevZ = pusherBody.position.z;
  const targetZ = PUSHER_CENTER_Z + Math.sin(elapsed * PUSHER_SPEED) * PUSHER_AMPLITUDE;
  pusherBody.velocity.set(0, 0, (targetZ - prevZ) / FIXED);
  pusherBody.position.set(0, PUSHER_HEIGHT / 2, targetZ);
  world.step(FIXED, FIXED, 1);
}

function animate() {
  requestAnimationFrame(animate);
  const frame = Math.min(clock.getDelta(), 0.1); // clamp long stalls (e.g. tab unfocus)
  accumulator += frame;
  let steps = 0;
  while (accumulator >= FIXED && steps < 6) {
    stepPhysics();
    accumulator -= FIXED;
    steps++;
  }

  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.mesh.position.copy(c.body.position);
    c.mesh.quaternion.copy(c.body.quaternion);

    if (c.body.position.y < -3) {
      const x = c.body.position.x, z = c.body.position.z;
      if (elapsed > WARMUP) {
        if (z > 0 && Math.abs(x) <= WIN_HALF_X) {
          won++; stock++;
          showToast('+1 GET!', '#39ff88');
          burst(new THREE.Vector3(x, 0.2, FIELD_FRONT - 0.2), LIME, 22);
        } else {
          showToast('LOST', '#ff2bd6');
          burst(new THREE.Vector3(x, 0.2, FIELD_FRONT - 0.2), MAGENTA, 12);
        }
      }
      scene.remove(c.mesh);
      world.removeBody(c.body);
      coins.splice(i, 1);
    }
  }

  pusher.position.copy(pusherBody.position);

  // Animated flourishes
  ringL.rotation.z += frame * 0.8;
  ringR.rotation.z -= frame * 0.8;
  const pulse = 0.4 + Math.sin(elapsed * 3) * 0.18;
  winZone.material.opacity = pulse;
  indicator.material.opacity = 0.45 + Math.sin(elapsed * 6) * 0.15;

  updateSparks(frame);
  updateHud();
  composer.render();
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();
updateHud();
animate();
