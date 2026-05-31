import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ---------------------------------------------------------------------------
// Field dimensions (world units). X = left/right, Y = up, Z = depth.
// Back wall at z = -FIELD_BACK, open front edge at z = +FIELD_FRONT.
// ---------------------------------------------------------------------------
const FIELD_HALF_X = 5;       // floor spans x = [-5, 5]
const FIELD_BACK = 5;         // back wall at z = -5
const FIELD_FRONT = 2.5;      // open front edge at z = +2.5 (shallow so coins spill)
const WIN_HALF_X = 2.5;       // coins falling with |x| <= 2.5 are won, else lost
const WALL_HEIGHT = 4;

const COIN_RADIUS = 0.55;
const COIN_HEIGHT = 0.18;
const MAX_COINS = 220;

// Pusher motion
const PUSHER_DEPTH = 2;
const PUSHER_WIDTH = FIELD_HALF_X * 2 - 0.4;
const PUSHER_HEIGHT = 1.4;
const PUSHER_CENTER_Z = -2.0;
const PUSHER_AMPLITUDE = 1.5;
const PUSHER_SPEED = 1.1;     // radians/sec

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let stock = 50;     // medals available to drop
let won = 0;        // medals collected into the tray
const coins = [];   // { body, mesh }
let dropX = 0;      // current drop position (world x), driven by mouse

const stockEl = document.getElementById('stock');
const wonEl = document.getElementById('won');
const onboardEl = document.getElementById('onboard');
const toastEl = document.getElementById('toast');

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.Fog(0x0b1020, 18, 34);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 10, 11);
camera.lookAt(0, 0, -1);

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
scene.add(new THREE.HemisphereLight(0xfff2d0, 0x223052, 0.6));
const key = new THREE.DirectionalLight(0xfff0d0, 1.1);
key.position.set(6, 14, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -10; key.shadow.camera.right = 10;
key.shadow.camera.top = 12; key.shadow.camera.bottom = -8;
key.shadow.camera.near = 1; key.shadow.camera.far = 40;
scene.add(key);
const rim = new THREE.PointLight(0x66aaff, 0.8, 40);
rim.position.set(-8, 6, -6);
scene.add(rim);

// ---------------------------------------------------------------------------
// Cannon-es world
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

// ---------------------------------------------------------------------------
// Static geometry helpers
// ---------------------------------------------------------------------------
function addStaticBox(w, h, d, pos, color, opacity = 1, material = groundMat) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, metalness: 0.2, roughness: 0.7 })
  );
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
    material,
  });
  body.position.set(pos.x, pos.y, pos.z);
  world.addBody(body);
  return mesh;
}

// Floor (top surface at y = 0)
addStaticBox(FIELD_HALF_X * 2, 0.6, FIELD_BACK + FIELD_FRONT, { x: 0, y: -0.3, z: (FIELD_FRONT - FIELD_BACK) / 2 }, 0x223052);

// Back wall
addStaticBox(FIELD_HALF_X * 2, WALL_HEIGHT, 0.4, { x: 0, y: WALL_HEIGHT / 2 - 0.3, z: -FIELD_BACK }, 0x2c3a63);
// Side walls (transparent-ish glass)
addStaticBox(0.4, WALL_HEIGHT, FIELD_BACK + FIELD_FRONT, { x: -FIELD_HALF_X, y: WALL_HEIGHT / 2 - 0.3, z: (FIELD_FRONT - FIELD_BACK) / 2 }, 0x88bbff, 0.18);
addStaticBox(0.4, WALL_HEIGHT, FIELD_BACK + FIELD_FRONT, { x: FIELD_HALF_X, y: WALL_HEIGHT / 2 - 0.3, z: (FIELD_FRONT - FIELD_BACK) / 2 }, 0x88bbff, 0.18);

// Visual-only zone markers at the front edge (win center vs. lost sides)
function addZoneStripe(x, w, color) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.05, 1.2),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.5 })
  );
  m.position.set(x, 0.01, FIELD_FRONT - 0.4);
  scene.add(m);
}
addZoneStripe(0, WIN_HALF_X * 2, 0x2ecc71);                              // win (center, green)
addZoneStripe(-(WIN_HALF_X + (FIELD_HALF_X - WIN_HALF_X) / 2), FIELD_HALF_X - WIN_HALF_X, 0xff5566); // lost left
addZoneStripe((WIN_HALF_X + (FIELD_HALF_X - WIN_HALF_X) / 2), FIELD_HALF_X - WIN_HALF_X, 0xff5566);  // lost right

// ---------------------------------------------------------------------------
// Pusher (kinematic body driven by velocity)
// ---------------------------------------------------------------------------
const pusherMesh = new THREE.Mesh(
  new THREE.BoxGeometry(PUSHER_WIDTH, PUSHER_HEIGHT, PUSHER_DEPTH),
  new THREE.MeshStandardMaterial({ color: 0xc9d4ee, metalness: 0.4, roughness: 0.4 })
);
pusherMesh.castShadow = true;
pusherMesh.receiveShadow = true;
scene.add(pusherMesh);

const pusherBody = new CANNON.Body({
  type: CANNON.Body.KINEMATIC,
  shape: new CANNON.Box(new CANNON.Vec3(PUSHER_WIDTH / 2, PUSHER_HEIGHT / 2, PUSHER_DEPTH / 2)),
  material: groundMat,
});
pusherBody.position.set(0, PUSHER_HEIGHT / 2, PUSHER_CENTER_Z);
world.addBody(pusherBody);

// Drop indicator
const indicator = new THREE.Mesh(
  new THREE.CylinderGeometry(COIN_RADIUS * 1.1, COIN_RADIUS * 1.1, 0.04, 24),
  new THREE.MeshStandardMaterial({ color: 0xffd778, emissive: 0xffaa33, emissiveIntensity: 0.6, transparent: true, opacity: 0.8 })
);
indicator.position.set(0, 0.05, -1.5);
scene.add(indicator);

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------
const coinGeo = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_HEIGHT, 24);
const coinMatThree = new THREE.MeshStandardMaterial({ color: 0xffc233, metalness: 0.35, roughness: 0.45, emissive: 0x3a2600, emissiveIntensity: 0.25 });
const coinShape = new CANNON.Cylinder(COIN_RADIUS, COIN_RADIUS, COIN_HEIGHT, 16);

function spawnCoin(x, z, y = 4.5) {
  if (coins.length >= MAX_COINS) {
    // recycle the oldest coin to keep physics light
    const old = coins.shift();
    scene.remove(old.mesh);
    world.removeBody(old.body);
  }
  const mesh = new THREE.Mesh(coinGeo, coinMatThree);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 1, shape: coinShape, material: coinMat });
  body.position.set(x, y, z);
  // lay flat: cylinder axis is Y by default in cannon -> rotate so it lies flat like a coin
  body.quaternion.setFromEuler(Math.PI / 2, 0, 0);
  body.angularDamping = 0.5;
  body.linearDamping = 0.02;
  body.sleepSpeedLimit = 0.15;
  body.sleepTimeLimit = 0.4;
  world.addBody(body);

  coins.push({ body, mesh });
}

// Initial pile so there is something to push. Spread on a loose grid in front
// of the pusher and stagger heights so coins do not overlap and explode apart.
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 7; col++) {
    const x = -3.6 + col * 1.2 + (Math.random() - 0.5) * 0.2;
    const z = -0.8 + row * 0.7 + (Math.random() - 0.5) * 0.12;
    spawnCoin(x, z, 0.3 + row * 0.05);
  }
}

// ---------------------------------------------------------------------------
// Drop interaction
// ---------------------------------------------------------------------------
function dropMedal() {
  if (stock <= 0) {
    showToast('メダル切れ', '#ff8888');
    return;
  }
  stock--;
  updateHud();
  spawnCoin(dropX + (Math.random() - 0.5) * 0.2, -1.4, 5);
}

window.addEventListener('pointermove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1; // -1..1
  dropX = THREE.MathUtils.clamp(nx * (FIELD_HALF_X - 1), -(FIELD_HALF_X - 1), FIELD_HALF_X - 1);
  indicator.position.x = dropX;
});
canvas.addEventListener('pointerdown', dropMedal);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); dropMedal(); }
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function showToast(text, color) {
  toastEl.textContent = text;
  toastEl.style.color = color || '#ffe08a';
  toastEl.classList.remove('toast-show');
  void toastEl.offsetWidth; // restart animation
  toastEl.classList.add('toast-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('toast-show'), 700);
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
const WARMUP = 2.0; // seconds; ignore scoring while the initial pile settles

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  elapsed += dt;

  // Drive the kinematic pusher: set the velocity to the finite difference so
  // contacts get the correct relative velocity, then snap the position.
  const prevZ = pusherBody.position.z;
  const targetZ = PUSHER_CENTER_Z + Math.sin(elapsed * PUSHER_SPEED) * PUSHER_AMPLITUDE;
  pusherBody.velocity.set(0, 0, dt > 0 ? (targetZ - prevZ) / dt : 0);
  pusherBody.position.set(0, PUSHER_HEIGHT / 2, targetZ);

  world.step(1 / 60, dt, 3);

  // Sync meshes & detect coins that fell off the front edge.
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.mesh.position.copy(c.body.position);
    c.mesh.quaternion.copy(c.body.quaternion);

    if (c.body.position.y < -3) {
      const x = c.body.position.x;
      const z = c.body.position.z;
      // Skip scoring during the warm-up while the initial pile settles.
      if (elapsed > WARMUP) {
        if (z > 0 && Math.abs(x) <= WIN_HALF_X) {
          won++;
          stock++; // winnings return to the stock so play continues
          showToast('+1 GET!', '#2ecc71');
        } else {
          showToast('LOST', '#ff5566');
        }
      }
      scene.remove(c.mesh);
      world.removeBody(c.body);
      coins.splice(i, 1);
    }
  }

  pusherMesh.position.copy(pusherBody.position);
  pusherMesh.quaternion.copy(pusherBody.quaternion);

  updateHud();
  renderer.render(scene, camera);
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();
updateHud();
animate();
