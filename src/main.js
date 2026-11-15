import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import gsap from 'gsap';
import { getStorm, fallback } from './storm.js';
import * as sfx from './sfx.js';
import { buildHabitat } from './habitat.js';
import { startReplay, loadMission, mission } from './replay.js';

const lowEnd = matchMedia('(pointer: coarse)').matches;

/* ========== 1. RENDERER, SCENE, CAMERA ========== */
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc58a5a, 0.007);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance'
});

renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

document.body.appendChild(renderer.domElement);

/* ========== 1b. POST-PROCESSING ========== */
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  type: THREE.HalfFloatType,
  samples: lowEnd ? 0 : 2,
});

const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.45,
  0.6,
  0.9
);

composer.addPass(bloom);

const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    storm: { value: 0 },
    alarm: { value: 0 },
    pulse: { value: 0 }
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float storm;
    uniform float alarm;
    uniform float pulse;
    varying vec2 vUv;

    float rand(vec2 c) {
      return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      float vig = 1.0 - smoothstep(0.25, 0.9, length(vUv - 0.5));
      c.rgb *= mix(0.5, 1.0, vig);

      c.rgb *= mix(vec3(1.0), vec3(1.08, 0.96, 0.84), 0.5 + storm * 0.5);

      // emergency: red wash that breathes with the siren
      c.rgb = mix(c.rgb, c.rgb * vec3(1.6, 0.28, 0.22), alarm * (0.55 + 0.35 * pulse));
      c.rgb += vec3(0.55, 0.0, 0.0) * (1.0 - vig) * alarm * pulse;

      c.rgb += (rand(vUv * vec2(1920.0, 1080.0) + time) - 0.5) * 0.03;

      gl_FragColor = c;
    }
  `,
});

composer.addPass(grade);
composer.addPass(new OutputPass());

/* ========== 2. LIGHTS ========== */
const hemi = new THREE.HemisphereLight(0xe0a77a, 0x4a2412, 0.6);
scene.add(hemi);

const SUN_BASE = 3.2;

const sun = new THREE.DirectionalLight(0xffe2c0, SUN_BASE);
sun.position.set(-45, 16, -40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;

Object.assign(sun.shadow.camera, {
  left: -45,
  right: 45,
  top: 45,
  bottom: -45,
  near: 1,
  far: 160
});

scene.add(sun);

const lampK = { k: 1 };

const lamp = new THREE.PointLight(0xffe0b0, 25, 14);
lamp.position.set(0, 4, 0);
scene.add(lamp);

const spill = new THREE.SpotLight(0xffb27a, 60, 20, 0.7, 0.6, 1.5);
spill.position.set(0.5, 3, 9);
spill.target.position.set(0, 0.4, -1);

scene.add(spill, spill.target);

lamp.color.set(0xbfeee4);
lamp.position.set(0, 4.6, 0);

spill.position.set(0, 4.5, 15);
spill.target.position.set(0, 1.5, 7.5);

/* ========== 2b. SKY + ENVIRONMENT REFLECTIONS ========== */
const calmFog = new THREE.Color(0xc58a5a);
const stormFog = new THREE.Color(0x6a3a1e);

const skyUniforms = {
  top: { value: new THREE.Color(0x7a5f58) },
  horizon: { value: calmFog.clone() },
  stormColor: { value: stormFog.clone() },
  sunDir: { value: sun.position.clone().normalize() },
  sunGlow: { value: new THREE.Color(0x9fc4ff) },
  storm: { value: 0 },
};

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(450, 32, 16),

  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms,

    vertexShader: `
      varying vec3 vDir;

      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,

    fragmentShader: `
      varying vec3 vDir;

      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 stormColor;
      uniform vec3 sunDir;
      uniform vec3 sunGlow;
      uniform float storm;

      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);

        vec3 col = mix(horizon, top, pow(h, 0.45));

        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);

        col += sunGlow * pow(s, 10.0) * 0.35;
        col += vec3(1.0, 0.95, 0.85) * pow(s, 700.0) * 4.0;

        col = mix(col, stormColor, storm * 0.9);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);

sky.renderOrder = -1;
scene.add(sky);

const envScene = new THREE.Scene();
envScene.add(sky.clone());

const pmrem = new THREE.PMREMGenerator(renderer);

scene.environment = pmrem.fromScene(envScene, 0.04, 0.1, 1000).texture;
scene.environmentIntensity = 0.7;

/* ========== 3. TERRAIN + ROCKS ========== */
const tex = new THREE.TextureLoader().load('/tex/mars.jpg');

tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.repeat.set(6, 6);
tex.colorSpace = THREE.SRGBColorSpace;
tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const sstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

const heightAt = (x, z) => {
  const flat = sstep(34, 70, Math.hypot(x, z));

  return (
    Math.sin(x * 0.05) * Math.cos(z * 0.04) * 3 +
    Math.sin(x * 0.21 + z * 0.17) * 0.4
  ) * flat;
};

const segs = lowEnd ? 90 : 140;

const tGeo = new THREE.PlaneGeometry(400, 400, segs, segs);
tGeo.rotateX(-Math.PI / 2);

const tp = tGeo.attributes.position;

for (let i = 0; i < tp.count; i++) {
  tp.setY(i, heightAt(tp.getX(i), tp.getZ(i)));
}

tGeo.computeVertexNormals();

function makeNoiseTex(size = 512) {
  const c = document.createElement('canvas');

  c.width = c.height = size;

  const g = c.getContext('2d');

  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);

  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(80 + Math.random() * 100);

    g.fillStyle = `rgba(${v},${v},${v},0.25)`;

    g.beginPath();
    g.arc(
      Math.random() * size,
      Math.random() * size,
      1 + Math.random() * 6,
      0,
      Math.PI * 2
    );

    g.fill();
  }

  const t = new THREE.CanvasTexture(c);

  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(70, 70);
  t.anisotropy = 8;

  return t;
}

const ground = new THREE.Mesh(
  tGeo,

  new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 1,
    bumpMap: makeNoiseTex(),
    bumpScale: 1.5
  })
);

ground.receiveShadow = true;
scene.add(ground);

const ROCKS = 250;

const rocks = new THREE.InstancedMesh(
  new THREE.DodecahedronGeometry(1, 0),
  new THREE.MeshStandardMaterial({
    color: 0x7a4a30,
    roughness: 1
  }),
  ROCKS
);

const dummy = new THREE.Object3D();

// keep-out zones [x, z, radius]: no rocks here
const NO_ROCK = [
  [0, 0, 8],        // habitat dome
  [0, 8, 5],        // airlock + steps
  [10.6, -1.5, 5],  // lab pod + tunnel
  [16, 22, 6.5],    // landing pad (Ingenuity)
  [-11, 11, 8],     // solar field
  [-14, -6, 4],     // comm dish
  [8, -9, 3],       // weather mast
  [13, -8, 5],      // supply depot
  [9, 10, 4.5],     // Curiosity rover
];

const blocked = (x, z, s) =>
  NO_ROCK.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br + s);

for (let i = 0; i < ROCKS; i++) {
  const s = 0.2 + Math.random() * 1.2;

  let x, z;
  let tries = 0;

  do {
    const a = Math.random() * Math.PI * 2;
    const r = 14 + Math.random() * 90;

    x = Math.cos(a) * r;
    z = Math.sin(a) * r;

    tries++;
  } while (blocked(x, z, s) && tries < 60);

  dummy.position.set(x, heightAt(x, z) + s * 0.25, z);

  dummy.rotation.set(
    Math.random() * 3,
    Math.random() * 3,
    Math.random() * 3
  );

  dummy.scale.set(s, s * 0.7, s);
  dummy.updateMatrix();

  rocks.setMatrixAt(i, dummy.matrix);
}

rocks.castShadow = true;
rocks.receiveShadow = true;
scene.add(rocks);

/* ========== 4+5. HABITAT ========== */
const habitat = buildHabitat(scene);

habitat.onDoor = () => sfx.whoosh();

const drawPanel = habitat.drawPanel;

/* ========== 6. DUST ========== */
function makeDot() {
  const c = document.createElement('canvas');

  c.width = c.height = 64;

  const g = c.getContext('2d');

  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);

  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');

  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);

  return new THREE.CanvasTexture(c);
}

const dot = makeDot();

const N = lowEnd ? 1200 : 2500;

const dpos = new Float32Array(N * 3);

for (let i = 0; i < N; i++) {
  dpos[i * 3] = (Math.random() - 0.5) * 160;
  dpos[i * 3 + 1] = Math.random() * 25;
  dpos[i * 3 + 2] = (Math.random() - 0.5) * 160;
}

const dgeo = new THREE.BufferGeometry();

dgeo.setAttribute(
  'position',
  new THREE.BufferAttribute(dpos, 3)
);

const dmat = new THREE.PointsMaterial({
  map: dot,
  color: 0xd9a070,
  size: 0.7,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
});

const dustPoints = new THREE.Points(dgeo, dmat);

dustPoints.frustumCulled = false;
scene.add(dustPoints);

const DV = 400;

const dvPos = new Float32Array(DV * 3);

const dvGeo = new THREE.BufferGeometry();

dvGeo.setAttribute(
  'position',
  new THREE.BufferAttribute(dvPos, 3)
);

const devil = new THREE.Points(
  dvGeo,

  new THREE.PointsMaterial({
    map: dot,
    color: 0xc98c5c,
    size: 1.0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  })
);

devil.frustumCulled = false;

const devilMat = devil.material;
scene.add(devil);

const devilState = { x: -60, z: -30 };

function updateDevil(time, dt) {
  devilState.x += dt * 3;
  devilState.z += dt * 1.2;

  if (devilState.x > 90) {
    devilState.x = -90;
    devilState.z = -60 + Math.random() * 40;
  }

  for (let i = 0; i < DV; i++) {
    const h = (i / DV) * 14;
    const r = 0.4 + h * 0.18;
    const a = time * 3 + i * 1.2 + h * 0.5;

    dvPos[i * 3] = devilState.x + Math.cos(a) * r;
    dvPos[i * 3 + 1] = h;
    dvPos[i * 3 + 2] = devilState.z + Math.sin(a) * r;
  }

  dvGeo.attributes.position.needsUpdate = true;
}

/* ========== 6b. ADAPTIVE QUALITY ========== */
let quality = lowEnd ? 1 : 2;

function setQuality(q) {
  quality = q;

  const pr = [0.85, 1, 1.25][q];

  renderer.setPixelRatio(Math.min(devicePixelRatio, pr));
  renderer.setSize(innerWidth, innerHeight);

  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);

  bloom.enabled = q >= 1;
  bloom.strength = q === 2 ? 0.45 : 0.3;

  devil.visible = q >= 1;
  dmat.size = q === 0 ? 0.5 : 0.7;

  console.info('Quality level:', q);
}

setQuality(quality);

/* ========== 7. MODEL LOADER ========== */
const loader = new GLTFLoader();

const draco = new DRACOLoader();

draco.setDecoderPath('/draco/');

loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);

function loadModel(
  url,
  { size = 3, pos = [0, 0, 0], rotX = 0, rotY = 0 } = {}
) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,

      (g) => {
        const m = g.scene;

        m.rotation.set(rotX, rotY, 0);

        const box = new THREE.Box3().setFromObject(m);

        const dim = box.getSize(new THREE.Vector3());

        m.scale.setScalar(
          size / Math.max(dim.x, dim.y, dim.z)
        );

        box.setFromObject(m);

        const c = box.getCenter(new THREE.Vector3());

        m.position.set(
          pos[0] - c.x,
          pos[1] - box.min.y,
          pos[2] - c.z
        );

        m.traverse(o => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });

        scene.add(m);

        resolve(m);
      },

      undefined,

      reject
    );
  });
}

/* ========== 7b. OUTPOST PROPS ========== */
const metal = new THREE.MeshStandardMaterial({
  color: 0x9aa0a6,
  metalness: 0.6,
  roughness: 0.45
});

const darkMetal = new THREE.MeshStandardMaterial({
  color: 0x3c4046,
  metalness: 0.5,
  roughness: 0.6
});

const panelMat = new THREE.MeshStandardMaterial({
  color: 0x1b2a4a,
  metalness: 0.8,
  roughness: 0.25,
  emissive: 0x0a1630,
  emissiveIntensity: 1,
});

function addShadow(o) {
  o.traverse(c => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });

  return o;
}

function makeSolarField(cx, cz, rows = 2, cols = 4) {
  const g = new THREE.Group();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const unit = new THREE.Group();

      const stand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8),
        darkMetal
      );

      stand.position.y = 0.55;

      const pan = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.06, 1.4),
        panelMat
      );

      pan.position.y = 1.15;
      pan.rotation.x = -0.6;

      unit.add(stand, pan);
      unit.position.set(c * 2.6, 0, r * 2.4);

      g.add(unit);
    }
  }

  g.position.set(cx, 0, cz);

  scene.add(addShadow(g));
}

makeSolarField(-16, 10);

function makeDish(x, z) {
  const g = new THREE.Group();

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 3.5, 12),
    metal
  );

  mast.position.y = 1.75;

  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(
      1.4,
      24,
      12,
      0,
      Math.PI * 2,
      0,
      Math.PI / 3
    ),

    new THREE.MeshStandardMaterial({
      color: 0xe8e8e8,
      metalness: 0.4,
      roughness: 0.4,
      side: THREE.DoubleSide
    })
  );

  dish.position.y = 3.6;
  dish.rotation.x = -Math.PI / 2.6;
  dish.rotation.z = 0.5;

  const feed = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6),
    darkMetal
  );

  feed.position.set(0.2, 4.2, -0.7);
  feed.rotation.x = -0.9;

  g.add(mast, dish, feed);
  g.position.set(x, 0, z);

  scene.add(addShadow(g));
}

makeDish(-14, -6);

const cups = new THREE.Group();

function makeWeatherMast(x, z) {
  const g = new THREE.Group();

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 3, 8),
    metal
  );

  pole.position.y = 1.5;

  for (let i = 0; i < 3; i++) {
    const ang = (i * Math.PI * 2) / 3;

    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6),
      darkMetal
    );

    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = ang;

    arm.position.set(
      Math.cos(ang) * 0.25,
      0,
      Math.sin(ang) * -0.25
    );

    const cup = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      metal
    );

    cup.position.set(
      Math.cos(ang) * 0.5,
      0,
      Math.sin(ang) * -0.5
    );

    cups.add(arm, cup);
  }

  cups.position.y = 3.1;

  g.add(pole, cups);
  g.position.set(x, 0, z);

  scene.add(addShadow(g));
}

makeWeatherMast(8, -9);

let beacon;

function makePad(x, z) {
  const g = new THREE.Group();

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, 0.12, 40),

    new THREE.MeshStandardMaterial({
      color: 0x555a60,
      roughness: 0.9
    })
  );

  pad.position.y = 0.06;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.3, 3.6, 40),

    new THREE.MeshBasicMaterial({
      color: 0xffd23f,
      side: THREE.DoubleSide
    })
  );

  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.13;

  g.add(pad, ring);

  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 6),
      darkMetal
    );

    post.position.set(
      Math.cos(a) * 3.8,
      0.5,
      Math.sin(a) * 3.8
    );

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),

      new THREE.MeshBasicMaterial({
        color: 0xff3b30
      })
    );

    bulb.position.set(
      Math.cos(a) * 3.8,
      1.05,
      Math.sin(a) * 3.8
    );

    g.add(post, bulb);

    if (i === 0) beacon = bulb;
  }

  g.position.set(x, 0, z);

  scene.add(addShadow(g));
}

makePad(16, 22);

function makeSupplies(x, z) {
  const g = new THREE.Group();

  const crateMat = new THREE.MeshStandardMaterial({
    color: 0x8a7a5a,
    roughness: 0.8
  });

  [
    [0, 0.5, 0, 1, 1, 1],
    [1.1, 0.4, 0.3, 0.8, 0.8, 0.8],
    [0.3, 1.3, 0.1, 0.8, 0.7, 0.8],
    [-1.4, 0.5, 0.6, 1.2, 1, 1],
  ].forEach(([px, py, pz, sx, sy, sz]) => {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      crateMat
    );

    b.position.set(px, py, pz);
    b.rotation.y = Math.random();

    g.add(b);
  });

  for (let i = 0; i < 2; i++) {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 2.2, 20),

      new THREE.MeshStandardMaterial({
        color: 0xd8d8d8,
        metalness: 0.5,
        roughness: 0.4
      })
    );

    tank.rotation.z = Math.PI / 2;
    tank.position.set(2.5, 0.7, -1.5 + i * 1.6);

    g.add(tank);
  }

  g.position.set(x, 0, z);

  scene.add(addShadow(g));
}

makeSupplies(12, -8);

function makeCable(from, to, sag = 0.4) {
  const mid = from.clone().lerp(to, 0.5);

  mid.y -= sag;

  const curve = new THREE.QuadraticBezierCurve3(from, mid, to);

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 30, 0.05, 6),

    new THREE.MeshStandardMaterial({
      color: 0x111111
    })
  );

  tube.castShadow = true;

  scene.add(tube);
}

makeCable(
  new THREE.Vector3(-12, 0.1, 10),
  new THREE.Vector3(-5.5, 0.4, 2),
  0
);

makeCable(
  new THREE.Vector3(-14, 0.1, -5),
  new THREE.Vector3(-5.2, 0.4, -1.5),
  0
);

/* ========== 7c. NASA MODELS + DUST COATING ========== */
const dustTargets = [];

const dustCol = new THREE.Color(0xb5693a);

function collectDustTargets() {
  scene.traverse(o => {
    if (!o.isMesh || o === ground || !o.material?.isMeshStandardMaterial) {
      return;
    }

    for (let p = o; p; p = p.parent) {
      if (p.userData.noDust) return;
    }

    dustTargets.push({
      m: o.material,
      base: o.material.color.clone()
    });
  });
}

let astro = null;

async function loadModels() {
  // the ORDER matters: results[2] below must stay the astronaut
  const jobs = [
    loadModel('/models/curiosity.glb', {
      size: 4,
      pos: [9, 0, 10],
      rotY: -0.8
    }),

    loadModel('/models/ingenuity.glb', {
      size: 2.8,              // was 1.4: bigger, but still fits inside the pad ring (try 2.4 or 3.2)
      pos: [16, 0.12, 22],
      rotY: 0.5
    }),

    loadModel('/models/astronaut.glb', {
      size: 1.8,
      pos: [0, 0.5, -2.6],
      rotX: 1.05,
      rotY: Math.PI
    }),
  ];

  const results = await Promise.allSettled(jobs);

  if (results[2].status === 'fulfilled') {
    astro = results[2].value;
  }

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn('Model', i, 'failed:', r.reason);
    }
  });

  collectDustTargets();

  renderer.shadowMap.needsUpdate = true;
}

const modelsReady = loadModels();

/* ========== 8. STORM SYSTEM ========== */
let stormData = fallback;

getStorm().then(s => {
  stormData = s;
});

const storm = { t: 0 };
let alarmFired = false;

/* ========== 8b. EMERGENCY MODE ========== */
const emerg = { k: 0 };       // 0 = calm, 1 = full red alert
const impact = { v: 0 };      // short shock when the alarm starts
const lampCalm = new THREE.Color(0xbfeee4);
const spillCalm = new THREE.Color(0xffb27a);
const alertRed = new THREE.Color(0xff2418);
let alarmLoop = null;
const battery = { v: 100 };   // habitat battery %
let decided = false;          // true once the player has chosen
let decideTimer = null;
let calmOverride = false;   // true after a good ending: the storm is allowed to pass
const oxygen = { v: 100 };    // habitat oxygen %

// snapshots of the real 3D scene, used as pictures on the success card
const snaps = [];
let snapReq = false;
const snap = () => { snapReq = true; };

const emStyle = document.createElement('style');
emStyle.textContent = `
@keyframes emPulse { 0%,100% { opacity: .2 } 50% { opacity: 1 } }
@keyframes emBlink { 0%,49% { opacity: 1 } 50%,100% { opacity: .2 } }
#emVig { position:fixed; inset:0; pointer-events:none; z-index:90; display:none;
  box-shadow: inset 0 0 170px 45px rgba(255,20,10,.8); animation: emPulse 1s ease-in-out infinite; }
#emBanner { position:fixed; top:6%; left:50%; transform:translateX(-50%); z-index:95; pointer-events:none;
  display:none; text-align:center; font-family:monospace; color:#fff; background:rgba(150,0,0,.75);
  border:2px solid #ff4a3a; padding:12px 28px; border-radius:6px; letter-spacing:.15em; }
#emBanner b { display:block; font-size:28px; animation: emBlink 1s steps(1) infinite; }
#emBanner span { font-size:13px; opacity:.9; }
`;
document.head.appendChild(emStyle);

const emVig = document.createElement('div');
emVig.id = 'emVig';
const emBanner = document.createElement('div');
emBanner.id = 'emBanner';
emBanner.innerHTML = '<b>⚠ EMERGENCY</b><span id="emSub"></span>';
document.body.append(emVig, emBanner);
const emSub = emBanner.querySelector('#emSub');

/* ----- "what is happening?" explainer ----- */
const emExplainStyle = document.createElement('style');
emExplainStyle.textContent = `
#emExplain { position:fixed; bottom:12%; left:50%; transform:translateX(-50%); z-index:94;
  pointer-events:none; display:none; max-width:min(560px,90vw); text-align:center;
  font-family:monospace; color:#d8fff6; background:rgba(4,20,28,.82);
  border:2px solid #4ff0d8; border-radius:8px; padding:12px 20px; line-height:1.45; }
#emExplain b { display:block; color:#7fe3ff; letter-spacing:.12em; margin-bottom:4px; }
`;
document.head.appendChild(emExplainStyle);

/* ----- "what happens next / what to do" guide ----- */
const emGuideStyle = document.createElement('style');
emGuideStyle.textContent = `
#emGuide { position:fixed; top:22%; left:16px; z-index:93; pointer-events:none; display:none;
  width:min(300px,40vw); font-family:monospace; font-size:13px; color:#ffe9e5;
  background:rgba(60,6,4,.82); border:2px solid #ff4a3a; border-radius:8px;
  padding:12px 14px; line-height:1.4; }
#emGuide b { display:block; letter-spacing:.12em; color:#ffb3a8; margin:10px 0 4px; }
#emGuide b:first-child { margin-top:0; }
#emGuide ol { margin:0; padding-left:18px; }
#emGuide li { margin-bottom:4px; }
#emGuide .sun { margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,74,58,.5); color:#fff; }
@media (max-width:700px) { #emGuide { font-size:11px; top:18%; } }
`;
document.head.appendChild(emGuideStyle);

const emGuide = document.createElement('div');
emGuide.id = 'emGuide';
emGuide.innerHTML = `
<b>⚠ WHAT HAPPENS NEXT</b>
<ol>
  <li>The dust blocks the sun, so the solar panels make less power.</li>
  <li>The battery will run low. Lights, air machines and the radio all need power.</li>
  <li>If the power runs out, the habitat gets cold and the air stops.</li>
</ol>
<b>WHAT TO DO</b>
<ol>
  <li>Think about which things we really need to stay alive.</li>
  <li>Stay inside. Going out in the storm is dangerous.</li>
  <li>Read the options on the right, tap one to learn what it does, then press CONFIRM.</li>
</ol>
<div class="sun">Sunlight now: <span id="emGuideSun">--</span></div>
`;
document.body.appendChild(emGuide);
const emGuideSun = emGuide.querySelector('#emGuideSun');

const emExplain = document.createElement('div');
emExplain.id = 'emExplain';
document.body.appendChild(emExplain);

// where each screen is + what to tell the player (keep the words simple)
const EXPLAIN = [
  { p: new THREE.Vector3(0, 2.15, -5.62), title: 'DUST STORM',
    text: 'Each dot is a real measurement of how dusty the air is. When the number (TAU) goes up, the sky gets darker.' },
  { p: new THREE.Vector3(-2.45, 2.0, -5.0), title: 'SUNLIGHT',
    text: 'Dust blocks the sun. Less sunlight means the solar panels make less power, so the battery drains.' },
  { p: new THREE.Vector3(2.45, 2.0, -5.0), title: 'DATA SOURCE',
    text: 'This data is real. It was measured by NASA\'s Curiosity rover on Mars.' },
];

const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
let explainIdx = -2;

function updateExplain() {
  let idx = -1;

  if (alarmFired && look.enabled && !decided) {
    camera.getWorldDirection(_dir);
    let bestAngle = 0.35; // about 20 degrees: how close the player must look

    EXPLAIN.forEach((e, i) => {
      const a = _dir.angleTo(_to.copy(e.p).sub(camera.position));
      if (a < bestAngle) { bestAngle = a; idx = i; }
    });
  } else {
    idx = -3; // hidden
  }

  if (idx === explainIdx) return;
  explainIdx = idx;

  if (idx === -3) {
    emExplain.style.display = 'none';
  } else if (idx === -1) {
    emExplain.innerHTML =
      '<b>⚠ WHAT IS HAPPENING?</b>A dust storm is covering the sun. Look at the screens (or press 1, 2, 3) to find out more, then choose an action on the right.';
    emExplain.style.display = 'block';
  } else {
    emExplain.innerHTML = `<b>${EXPLAIN[idx].title}</b>${EXPLAIN[idx].text}`;
    emExplain.style.display = 'block';
  }
}

function resetEmergency() {
  clearInterval(alarmLoop);
  alarmLoop = null;
  emerg.k = 0;
  emVig.style.display = 'none';
  emBanner.style.display = 'none';
  emExplain.style.display = 'none';
  explainIdx = -2;
  emGuide.style.display = 'none';
  clearInterval(decideTimer);
  decideTimer = null;
  decided = false;
  battery.v = 100;
  oxygen.v = 100;
  calmOverride = false;
  renderer.toneMappingExposure = 0.85;
  emO2.style.display = 'none';
  emEnd.style.display = 'none';
  emConsole.style.display = 'none';

  // blackout HUD + snapshots
  if (oxyTween) { oxyTween.kill(); oxyTween = null; }
  gsap.killTweensOf(hud);
  hudOn = false;
  hud.style.display = 'none';
  hud.style.opacity = 0;
  hudO2.style.opacity = 1;
  emConsole.style.zIndex = '';
  snaps.length = 0;
  snapReq = false;
}

function triggerAlarm() {
  if (alarmFired) return;
  alarmFired = true;

  // show the "what happens next" guide shortly after the alarm starts
  setTimeout(() => {
    if (alarmFired) emGuide.style.display = 'block';
  }, 1800);

  // 1) power glitch
  gsap.to(lampK, { k: 0.15, duration: 0.08, repeat: 7, yoyo: true, ease: 'none', onRepeat: sfx.zap });
  sfx.zap();
  sfx.thud();

  // 2) impact shake
  impact.v = 1;
  gsap.to(impact, { v: 0, duration: 1.4, ease: 'power2.out' });

  // 3) red alert rises after the glitch, siren repeats until the player decides
  gsap.to(emerg, { k: 1, duration: 1.2, delay: 0.7, ease: 'power2.in' });
  emVig.style.display = 'block';
  emBanner.style.display = 'block';
  setTimeout(() => sfx.alarm(6), 900);
  alarmLoop = setInterval(() => sfx.alarm(3), 6000);

  // 3b) voice-over: the habitat AI announces the storm with the real numbers, the astronaut reacts
  setTimeout(() => {
    if (!alarmFired || decided) return;
    speakSys(sysAlarmParts());
    say('astro_4');
  }, 2200);

  // 4) battery drops
  battery.v = 100;
  gsap.to(battery, { v: 40, duration: 3, onUpdate: () => drawPanel(Math.round(battery.v)) });

  setTimeout(showDecision, 3500);
}

/* ========== 9. CINEMATIC TOUR ========== */
const SHOTS = [
  [-40, 14, 52, -10, 2, 8],
  [-24, 5, 34, -14, 1.5, 11],
  [-8, 2.0, 19, -13, 1.3, 11.5],
  [-22, 2.2, 19.5, -13, 1.3, 11],
  [-30, 3.5, 6, -14, 3, -6],
  [-28, 4, -10, -14, 3.5, -6],
  [-16, 5, -22, -14, 3.2, -6],
  [0, 5, -24, 0, 2.5, -2],
  [10, 3.5, -20, 11, 1.2, -8],
  [24, 3, -6, 11, 1.5, -8],
  [24, 2.6, 6, 9, 1.2, 10],
  [15.5, 2.0, 16.5, 9, 1.2, 10],
  [26, 3, 26, 16, 1, 22],
  [10, 2.6, 32, 16, 0.8, 22],
  [6, 2.3, 21, 0, 1.8, 6],
  [1.2, 1.9, 12, 0, 1.6, 6],
  [0, 1.75, 5.5, 0, 1.4, -2],
  [0, 1.7, 1.5, 0, 1.6, -4],
  [0, 1.55, -1.9, 0, 2.1, -5.3],
];

const camPath = new THREE.CatmullRomCurve3(
  SHOTS.map(s => new THREE.Vector3(s[0], s[1], s[2])),
  false,
  'centripetal'
);

const lookPath = new THREE.CatmullRomCurve3(
  SHOTS.map(s => new THREE.Vector3(s[3], s[4], s[5])),
  false,
  'centripetal'
);

const camBase = new THREE.Vector3();
const lookBase = new THREE.Vector3();
const lookCur = new THREE.Vector3();

function sampleTour(u) {
  const t = camPath.getUtoTmapping(u);

  camPath.getPoint(t, camBase);
  lookPath.getPoint(t, lookBase);
}

sampleTour(0);

lookCur.copy(lookBase);

let tourActive = false;

const prog = { t: 0 };

const tour = gsap.to(prog, {
  t: 1,
  duration: 46,
  ease: 'sine.inOut',
  paused: true,

  onUpdate: () => sampleTour(prog.t),

  onComplete: enterDome,
});

/* ----- FADE + ASTRONAUT WAKE-UP ----- */
const fade = document.createElement('div');
fade.style.cssText =
  'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:100';
document.body.appendChild(fade);

const UP = new THREE.Vector3(0, 1, 0);
const look = { enabled: false, yaw: 0, pitch: 0, tyaw: 0, tpitch: 0 };

addEventListener('pointermove', e => {
  if (!look.enabled) return;
  const nx = (e.clientX / innerWidth) * 2 - 1;
  const ny = (e.clientY / innerHeight) * 2 - 1;
  look.tyaw = -nx * 0.7;     // mouse right -> look right
  look.tpitch = -ny * 0.4;   // mouse up -> look up
});

let entered = false;

function enterDome() {
  if (entered) return;
  entered = true;
  tourActive = false;
  capEl.classList.remove('show');

  // 1) fade to black as we pass through the airlock
  gsap.to(fade, {
    opacity: 1,
    duration: 0.9,
    ease: 'power2.in',
    onComplete: () => {
      tour.pause();
      sfx.thud();
      if (astro) astro.visible = false;

      // 2) jump to the astronaut's eyes, hidden by the black screen
      camBase.set(0, 1.55, -1.9);
      lookBase.set(0, 5.2, -2.0);          // staring at the ceiling
      lookCur.copy(lookBase);

      wakeSequence();
    },
  });
}

function wakeSequence() {
  const el = renderer.domElement;
  const blur = { px: 14 };
  const setBlur = () => {
    el.style.filter = blur.px > 0.1 ? `blur(${blur.px}px)` : '';
  };
  setBlur();

  const tl = gsap.timeline({
    onComplete: () => {
      look.enabled = true;   // player can now look around with the mouse
      wakeUp();              // alarm, storm, then the decision buttons
    },
  });

  // eyes open: slow half-blink, close, then fully open
  tl.to(fade, { opacity: 0.35, duration: 1.4, ease: 'sine.inOut' }, 0.5)
    .to(fade, { opacity: 1, duration: 0.25 })
    .to(fade, { opacity: 0, duration: 1.6, ease: 'sine.out' })
    .to(blur, { px: 0, duration: 2.5, ease: 'sine.out', onUpdate: setBlur }, '<');

  // head movement: sit up out of the recline so the screens are in clear view
  const g = { ease: 'sine.inOut' };
  const soft = { ease: 'power2.inOut' };

  tl.call(() => say('astro_1'), null, '-=0.8')
    .to(camBase, { x: 0, y: 1.75, z: -2.35, duration: 2.4, ...g }, '-=0.6')   // sit up and lean toward the desk
    .to(lookBase, { x: 0, y: 2.15, z: -5.6, duration: 2.0, ...g }, '<')       // eyes on the big centre screen
    .to(lookBase, { x: 0, y: 0.7, z: -3.2, duration: 1.3, ...g }, '+=0.9')    // look down at his hands
    .call(() => say('astro_2'))

    /* ---- hands: a tired, shaky, human moment ---- */
    // 1) hands drift up into view, left one slightly ahead of the right
    .to(handPose, { kL: 1, duration: 1.5, ...soft }, '<')
    .to(handPose, { kR: 1, duration: 1.6, ...soft }, '<0.22')
    // 2) he stares at them, trembling hard
    .to(handPose, { trem: 1, duration: 0.01 }, '<')
    // 3) slow clench into a loose fist, fingers closing one after another
    .to(handPose, { flex: 1, duration: 1.5, ease: 'power2.inOut' }, '+=0.35')
    // 4) hold the squeeze for a moment, then let go halfway (not fully open)
    .to(handPose, { flex: 0.3, duration: 1.8, ease: 'sine.inOut' }, '+=0.45')
    // 5) "breathe": hands lift a little on the inhale, sink on the exhale, tremor calms down
    .to(handPose, { breath: 1, duration: 1.7, ease: 'sine.inOut' }, '+=0.1')
    .to(handPose, { trem: 0.25, duration: 3.2, ease: 'sine.out' }, '<')
    .to(handPose, { breath: 0, duration: 2.2, ease: 'sine.inOut' })
    .to(handPose, { flex: 0, duration: 1.4, ease: 'sine.inOut' }, '<0.3')
    // 6) lower the hands, right first, then left
    .to(handPose, { kR: 0, duration: 1.2, ...soft }, '+=0.3')
    .to(handPose, { kL: 0, duration: 1.3, ...soft }, '<0.18')
    .to(handPose, { trem: 1, duration: 0.01 })
    /* ---- end hands ---- */

    .call(() => say('astro_3'))
    .to(lookBase, { x: -2.6, y: 2.0, z: -5.0, duration: 1.4, ...g }, '+=0.3') // left screen
    .to(lookBase, { x: 2.6, y: 2.0, z: -5.0, duration: 1.8, ...g }, '+=0.2')  // right screen
    .to(lookBase, { x: 0, y: 2.15, z: -5.6, duration: 1.3, ...g }, '+=0.2');  // back to centre
}

/* ----- LOCATION CAPTIONS ----- */
const POIS = [
  {
    name: 'SOLAR ARRAY',
    sub: 'Primary power · 8 panels',
    v: new THREE.Vector3(-12, 1, 11),
    r: 14
  },

  {
    name: 'COMM DISH',
    sub: 'Link to Mission Control',
    v: new THREE.Vector3(-14, 3, -6),
    r: 13
  },

  {
    name: 'SUPPLY DEPOT',
    sub: 'Water, fuel and spare parts',
    v: new THREE.Vector3(12, 1, -8),
    r: 13
  },

  {
    name: 'CURIOSITY ROVER',
    sub: 'Surface transport and sample run',
    v: new THREE.Vector3(9, 1, 10),
    r: 11
  },

  {
    name: 'LANDING PAD',
    sub: 'Ingenuity helicopter on standby',
    v: new THREE.Vector3(16, 1, 22),
    r: 11
  },

  {
    name: 'HABITAT',
    sub: 'Crew quarters and life support',
    v: new THREE.Vector3(0, 2, 0),
    r: 9
  },
];

const capEl = document.getElementById('caption');

let capIdx = -1;

function updateCaption() {
  let best = -1;
  let bd = 1e9;

  for (let i = 0; i < POIS.length; i++) {
    const d = camera.position.distanceTo(POIS[i].v);

    if (d < POIS[i].r && d < bd) {
      bd = d;
      best = i;
    }
  }

  if (best === capIdx) return;

  capIdx = best;

  if (best < 0) {
    capEl.classList.remove('show');
  } else {
    capEl.innerHTML =
      `<b>${POIS[best].name}</b><span>${POIS[best].sub}</span>`;

    capEl.classList.add('show');

    sfx.ping();
  }
}

/* ----- START SCREEN ----- */
const startEl = document.getElementById('start');
const startBtn = document.getElementById('startBtn');
const fsHint = document.getElementById('fsHint');   // "Press F for fullscreen" (defined in index.html)

const missionReady = loadMission();

Promise.all([modelsReady, missionReady]).then(() => {
  renderer.compile(scene, camera);

  startBtn.disabled = false;
  startBtn.textContent = '▶ Begin mission';

  // assets are loaded: show the fullscreen hint under the button
  if (fsHint) fsHint.style.opacity = 1;
});

startBtn.onclick = () => {
  sfx.init();
  sfx.whoosh();

  renderer.shadowMap.needsUpdate = true;

  startEl.style.opacity = 0;

  setTimeout(() => {
    startEl.style.display = 'none';
  }, 800);

  tourActive = true;

  tour.play();
};

/* ----- FULLSCREEN (F key, or click on the hint) ----- */
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.documentElement.requestFullscreen?.().catch(err =>
      console.warn('Fullscreen failed:', err)
    );
  }
}

if (fsHint) fsHint.onclick = toggleFullscreen;

addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    toggleFullscreen();
  }
});

addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'm') {
    sfx.toggleMute();
  }
});

// keys 1 / 2 / 3: glance at the left, centre and right monitors
const GLANCE = { Digit1: [-2.6, 2.0, -5.0], Digit2: [0, 2.15, -5.6], Digit3: [2.6, 2.0, -5.0] };

addEventListener('keydown', e => {
  const t = GLANCE[e.code];
  if (t && look.enabled) {
    gsap.to(lookBase, { x: t[0], y: t[1], z: t[2], duration: 0.7, ease: 'sine.inOut', overwrite: true });
  }
});

/* ----- WAKE UP ----- */
function wakeUp() {
  if (astro) astro.visible = false;

  tourActive = false;
  capEl.classList.remove('show');

  // Reset the alarm and the red alert for this replay.
  alarmFired = false;
  resetEmergency();

  // If the data file is missing, continue with the alarm.
  if (!mission.loaded) {
    triggerAlarm();
    return;
  }

  // Replay the actual daily Mars dust measurements.
  startReplay({
    onTick: m => {
      lastTick = m;
      if (calmOverride) return;

      const target = THREE.MathUtils.clamp(
        (m.tau - 1.5) / 6.5,
        0,
        1
      );

      // Smooth visual transition only.
      gsap.to(storm, {
        t: target,
        duration: 0.8,
        overwrite: true
      });

      // The measured tau value triggers the alarm.
      if (m.tau >= 2.5) {
        triggerAlarm();
      }

      // Live numbers on the emergency banner.
      if (alarmFired && !decided) {
        emSub.textContent =
          `DUST STORM · TAU ${m.tau.toFixed(1)} · SUNLIGHT ${m.solarPct.toFixed(m.solarPct < 1 ? 2 : 0)}%`;

        emGuideSun.textContent =
          `${m.solarPct.toFixed(m.solarPct < 1 ? 2 : 0)}%`;
      }
    },
  });
}

/* ========== 9b. ASTRONAUT: GLOVED HANDS + SPOKEN LINES ========== */
scene.add(camera);   // lets us attach the first-person hands to the camera

/* ----- spoken lines -----
   say('astro_1') first tries a recorded file  /public/audio/astro_1.mp3  (best: real emotion).
   If the file does not exist it speaks with the best browser voice.

   Per-phrase options:
     t          text
     rate       speaking speed   (below 1 = slower, more tired)
     pitch      voice pitch      (below 1 = lower, heavier)
     vol        volume
     pause      silence after the phrase, in ms
     sighBefore breath-out sigh before speaking
     inhaleBefore  quick breath-in before speaking
     breathAfter   long slow breath-out after speaking                          */
const SPEAK = true;   // false = subtitles only

const LINES = {
  astro_1: [
    { t: 'Hhh…',                                rate: 0.6,  pitch: 0.74, vol: 0.55, pause: 900, sighBefore: true },
    { t: 'Ugh.',                                rate: 0.66, pitch: 0.78, vol: 0.85, pause: 1000 },
    { t: 'What a hell of a day… yesterday.',    rate: 0.78, pitch: 0.84, vol: 0.95, pause: 0 },
  ],
  astro_2: [
    { t: 'My hands…',                           rate: 0.74, pitch: 0.9,  vol: 0.9,  pause: 900 },
    { t: 'they are still shaking.',             rate: 0.8,  pitch: 0.88, vol: 0.9,  pause: 1300 },
    { t: 'Okay.',                               rate: 0.7,  pitch: 0.82, vol: 0.85, pause: 500, inhaleBefore: true },
    { t: 'Breathe.',                            rate: 0.62, pitch: 0.8,  vol: 0.85, pause: 1000, breathAfter: true },
    { t: 'You\'re okay.',                       rate: 0.8,  pitch: 0.92, vol: 0.95, pause: 350 },
    { t: 'You\'re fine.',                       rate: 0.84, pitch: 0.96, vol: 0.98, pause: 0 },
  ],
  astro_3: [
    { t: 'Right.',                              rate: 0.9,  pitch: 0.96, vol: 1,    pause: 600 },
    { t: 'Let\'s see… what the screens are saying.', rate: 0.98, pitch: 1.02, vol: 1, pause: 0 },
  ],
};

/* ----- HABITAT AI voice-over: ties the whole flow together ----- */
let lastTick = null;   // latest measured storm values, set by the replay

LINES.astro_4 = [
  { t: 'Oh no…',                 rate: 0.72, pitch: 0.82, vol: 0.9,  pause: 700, inhaleBefore: true },
  { t: 'not now. Not like this.', rate: 0.8,  pitch: 0.86, vol: 0.95, pause: 0 },
];

function sysAlarmParts() {
  const m = lastTick;
  const pct = m ? (m.solarPct < 1 ? m.solarPct.toFixed(2) : Math.round(m.solarPct)) : null;

  return [
    { t: 'Warning.',                         rate: 0.9,  pitch: 0.85, vol: 1, pause: 600 },
    { t: 'Dust storm detected.',             rate: 0.92, pitch: 0.88, vol: 1, pause: 700 },
    { t: m ? `Atmospheric opacity, tau ${m.tau.toFixed(1)}.` : 'Atmospheric opacity critical.',
                                             rate: 0.92, pitch: 0.88, vol: 1, pause: 600 },
    { t: m ? `Solar output down to ${pct} percent.` : 'Solar output dropping.',
                                             rate: 0.92, pitch: 0.88, vol: 1, pause: 600 },
    { t: 'Battery reserves falling. Commander, action required.',
                                             rate: 0.9,  pitch: 0.86, vol: 1, pause: 0 },
  ];
}

const speakSys = parts => say('sys', { parts, who: 'HABITAT AI', role: 'sys' });

const speechStyle = document.createElement('style');
speechStyle.textContent = `
#emSpeech { position:fixed; bottom:15%; left:50%; transform:translateX(-50%); z-index:97;
  max-width:min(760px,86vw); text-align:center; pointer-events:none; opacity:0; transition:opacity .3s;
  font-family:Georgia,serif; font-style:italic; font-size:clamp(18px,2.4vw,26px); line-height:1.35;
  color:#fff; background:rgba(0,0,0,.62); padding:12px 26px 14px; border-radius:10px;
  border:1px solid rgba(255,255,255,.18); text-shadow:0 0 6px #000; }
#emSpeech .who { display:block; font-family:monospace; font-style:normal; font-size:11px;
  letter-spacing:.2em; color:#7fe3ff; margin-bottom:4px; }
`;
document.head.appendChild(speechStyle);

const speechEl = document.createElement('div');
speechEl.id = 'emSpeech';
document.body.appendChild(speechEl);

let voices = [];
const chosenByRole = {};   // must be declared BEFORE loadVoices() runs below
let voiceMuted = false;
let currentAudio = null;
let breathCtx = null;
const speechQueue = [];
let talking = false;
let speechGen = 0;         // bumps every time the speech is cleared, so old lines stop themselves

if ('speechSynthesis' in window) {
  const loadVoices = () => {
    voices = speechSynthesis.getVoices();
    for (const k in chosenByRole) delete chosenByRole[k];
  };
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

// stop everything that is being said or waiting to be said (used when the player decides)
function clearSpeech() {
  speechGen++;
  speechQueue.length = 0;
  talking = false;
  speechEl.style.opacity = 0;

  if ('speechSynthesis' in window) speechSynthesis.cancel();

  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio = null;
  }
}

// choose the most natural-sounding English voice: male for the astronaut, female/neutral for the habitat AI
function pickVoice(role = 'astro') {
  if (chosenByRole[role]) return chosenByRole[role];

  const en = voices.filter(v => /^en/i.test(v.lang));
  if (!en.length) return null;

  const FEMALE = /female|zira|samantha|susan|hazel|aria|jenny|sara|karen|moira|tessa|fiona|victoria|allison|ava|nicky|kate|serena/i;

  const score = v => {
    let s = 0;
    if (role === 'sys') {
      if (FEMALE.test(v.name)) s += 7;
      if (/google uk english female/i.test(v.name)) s += 2;
    }
    if (/natural|neural|online/i.test(v.name)) s += 8;
    if (/premium|enhanced|siri/i.test(v.name)) s += 5;
    if (/microsoft (guy|ryan|davis|christopher|eric|andrew|brian|roger|steffan)/i.test(v.name)) s += 5;
    if (/google uk english male|google us english/i.test(v.name)) s += 3;
    if (/daniel|alex|aaron|arthur|oliver|reed|rishi|gordon|evan|nathan|tom\b|ryan|james|\bmale\b/i.test(v.name)) s += 3;
    if (role !== 'sys' && FEMALE.test(v.name)) s -= 4;
    if (/en-US|en-GB/i.test(v.lang)) s += 1;
    if (/espeak|compact|fred|albert|bad news|bells|boing|bubbles|cellos|junior|kathy|organ|ralph|trinoids|whisper|zarvox|good news|hysterical/i.test(v.name)) s -= 10;
    return s;
  };

  const ranked = en.slice().sort((a, b) => score(b) - score(a));
  chosenByRole[role] = (role === 'mc' ? ranked[1] : ranked[0]) || ranked[0];
  return chosenByRole[role];
}

// breathing sounds made from shaped, filtered noise.
//   'out' = tired sigh / exhale, 'in' = quick inhale
function breath(dur = 0.9, vol = 0.14, type = 'out') {
  if (voiceMuted) return;

  try {
    breathCtx = breathCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = breathCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);

    let lp = 0;

    for (let i = 0; i < n; i++) {
      const x = i / n;
      const env = type === 'in'
        ? Math.pow(Math.sin(Math.PI * Math.pow(x, 0.7)), 1.5)
        : Math.pow(Math.sin(Math.PI * Math.pow(x, 1.6)), 1.2);

      lp += ((Math.random() * 2 - 1) - lp) * 0.35;
      d[i] = lp * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;

    const t0 = ctx.currentTime;

    if (type === 'in') {
      f.frequency.setValueAtTime(550, t0);
      f.frequency.linearRampToValueAtTime(1500, t0 + dur);
    } else {
      f.frequency.setValueAtTime(1400, t0);
      f.frequency.exponentialRampToValueAtTime(480, t0 + dur);
    }

    const g = ctx.createGain();
    g.gain.value = vol * (0.9 + Math.random() * 0.2);

    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start();
  } catch (err) {
    console.warn('breath failed', err);
  }
}

addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'm') return;

  voiceMuted = !voiceMuted;

  if (voiceMuted) {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (currentAudio) currentAudio.pause();
  }
});

// say('astro_1')                      -> astronaut line from LINES
// say('sys', { parts, who, role })    -> custom parts, e.g. the habitat AI
function say(key, opts = {}) {
  speechQueue.push({
    key,
    parts: opts.parts || null,
    who: opts.who || 'ASTRONAUT',
    role: opts.role || 'astro',
  });

  if (!talking) nextLine();
}

// small random wobble so repeated takes never sound robotic
const wob = (v, amt) => v * (1 - amt + Math.random() * amt * 2);

function nextLine() {
  const item = speechQueue.shift();

  if (!item) {
    talking = false;
    speechEl.style.opacity = 0;
    return;
  }

  const myGen = speechGen;   // if clearSpeech() runs later, this line goes silent
  const stale = () => myGen !== speechGen;

  const { key, who, role } = item;

  talking = true;
  speechEl.style.opacity = 0;   // stays hidden until the voice really starts

  const parts = item.parts || LINES[key] || [{ t: String(key), rate: 0.9, pitch: 1, vol: 1, pause: 0 }];
  const allText = parts.map(p => p.t).join(' ');

  const showSub = txt => {
    if (stale()) return;
    speechEl.innerHTML = `<span class="who">${who}</span>“${txt}”`;
    speechEl.style.opacity = 1;
  };

  let done = false;
  let fellBack = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    if (stale()) return;
    setTimeout(nextLine, 500);
  };

  const guard = setTimeout(finish, 30000);   // never get stuck

  // browser voice, phrase by phrase
  const speakParts = () => {
    if (fellBack || done || stale()) return;
    fellBack = true;

    if (!SPEAK || voiceMuted || !('speechSynthesis' in window)) {
      showSub(allText);
      setTimeout(finish, Math.max(1800, allText.length * 70));
      return;
    }

    speechSynthesis.cancel();

    const voice = pickVoice(role);
    let i = 0;

    const next = () => {
      if (done || stale()) return;
      if (i >= parts.length) { finish(); return; }

      const idx = i++;
      const p = parts[idx];

      // pre-speech breathing: a tired sigh, or a quick breath in
      let lead = 0;
      if (p.sighBefore)   { breath(1.0, 0.16, 'out'); lead = 700; }
      if (p.inhaleBefore) { breath(0.6, 0.13, 'in');  lead = 500; }

      const speak = () => {
        if (done || stale()) return;

        const u = new SpeechSynthesisUtterance(p.t);

        if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'en-US'; }

        u.rate = Math.min(Math.max(wob(p.rate, 0.04), 0.1), 2);
        u.pitch = Math.min(Math.max(wob(p.pitch, 0.035), 0), 2);
        u.volume = Math.min(wob(p.vol, 0.05), 1);

        let started = false;
        let ended = false;

        const begin = () => {
          if (started || stale()) return;
          started = true;
          showSub(parts.slice(0, idx + 1).map(x => x.t).join(' '));   // subtitle appears as the phrase starts
        };

        const end = () => {
          if (ended || stale()) return;
          ended = true;
          if (p.breathAfter) breath(1.3, 0.15, 'out');

          // a human never waits exactly the same time: vary each pause a little
          const gap = (p.pause || 0) * (0.85 + Math.random() * 0.3);
          setTimeout(next, gap);
        };

        u.onstart = begin;
        u.onend = end;
        u.onerror = end;

        window.__astroUtter = u;   // keep a reference so the browser does not drop it
        speechSynthesis.speak(u);

        setTimeout(begin, 1500);   // safety, in case onstart never fires
      };

      if (lead) setTimeout(speak, lead); else speak();
    };

    setTimeout(next, 150);
  };

  // recorded file first (lines with custom parts have no file, they are spoken with the browser voice)
  if (SPEAK && !voiceMuted && !item.parts) {
    const a = new Audio(`/audio/${key}.mp3`);
    currentAudio = a;

    a.onplaying = () => { fellBack = true; showSub(allText); };   // subtitle appears when the sound starts
    a.onended = finish;
    a.onerror = speakParts;                                       // file missing -> browser voice
    a.play().catch(speakParts);
  } else {
    speakParts();
  }
}

/* ----- first-person hands: astronaut gloves (palms up) ----- */
const handPose = { kL: 0, kR: 0, flex: 0, trem: 1, breath: 0 };

function makeGloveTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;

  const g = c.getContext('2d');

  g.fillStyle = '#e6e9ec';
  g.fillRect(0, 0, 64, 64);

  g.strokeStyle = 'rgba(140,150,160,0.35)';
  g.lineWidth = 1;

  for (let i = 0; i < 64; i += 4) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeRubberTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;

  const g = c.getContext('2d');

  g.fillStyle = '#2a2f34';
  g.fillRect(0, 0, 64, 64);

  g.strokeStyle = '#444c54';
  g.lineWidth = 2;

  for (let i = -64; i < 128; i += 10) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
    g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const gloveMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeGloveTex(), roughness: 0.9, metalness: 0, emissive: 0x1b2024 });
const rubberMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeRubberTex(), roughness: 0.95, metalness: 0, emissive: 0x0a0c0e });
const ringMat = new THREE.MeshStandardMaterial({ color: 0xaab4ba, metalness: 0.85, roughness: 0.3 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xe8ecee, roughness: 0.8, metalness: 0, emissive: 0x2a3438 });
const cuffBand = new THREE.MeshStandardMaterial({ color: 0xe0661f, roughness: 0.5, emissive: 0x3a1a08 });

// a chunky glove finger: three stiff sections with a rubber tip
function addFinger(hand, curls, x, lens, r, spread, fi) {
  const base = new THREE.Group();
  base.position.set(x, 0, -0.05);
  base.rotation.y = spread;
  hand.add(base);

  let parent = base;
  const MAX = [0.8, 1.05, 0.7];   // gloves are stiff, so they bend less than bare fingers

  lens.forEach((L, i) => {
    const joint = new THREE.Group();
    if (i > 0) joint.position.z = -lens[i - 1];
    parent.add(joint);

    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r * (1 - i * 0.06), L, 4, 10), gloveMat);
    seg.rotation.x = Math.PI / 2;
    seg.position.z = -L / 2;
    joint.add(seg);

    if (i === lens.length - 1) {   // rubber fingertip
      const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.9, 12, 10), rubberMat);
      tip.position.z = -L - r * 0.4;
      joint.add(tip);
    }

    curls.push({ pivot: joint, max: MAX[i] || 0.7, fi, j: i });
    parent = joint;
  });
}

function makeHand(side) {   // side: -1 = left hand, +1 = right hand
  const hand = new THREE.Group();
  const curls = [];

  // padded palm with a rubber grip patch
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.098, 0.04, 0.105, 3, 0.016), gloveMat);
  hand.add(palm);

  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.008, 0.082, 2, 0.003), rubberMat);
  grip.position.set(0, 0.022, -0.004);
  hand.add(grip);

  // thumb pad
  const thenar = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), gloveMat);
  thenar.scale.set(0.032, 0.02, 0.045);
  // m is the inner direction for this hand (left hand: +x, right hand: -x)
  const m = -side;

  thenar.position.set(-m * 0.033, 0.006, 0.014);
  hand.add(thenar);

  // four fingers, outer (little) to inner (index)
  const defs = [
    [0.030, 0.019, 0.017],   // little
    [0.040, 0.026, 0.021],   // ring
    [0.045, 0.028, 0.022],   // middle
    [0.040, 0.025, 0.020],   // index
  ];

  defs.forEach((lens, i) => {
    addFinger(hand, curls, m * (0.034 - i * 0.0225), lens, 0.0115, -m * (0.10 - i * 0.035), i);
  });

  // thumb: two sections, points toward the middle of the body
  const tBase = new THREE.Group();
  tBase.position.set(-m * 0.05, 0, -0.012);
  tBase.rotation.set(0.15, m * 0.55, 0);
  hand.add(tBase);

  let tp = tBase;

  [0.034, 0.028].forEach((L, i) => {
    const joint = new THREE.Group();
    if (i > 0) joint.position.z = -0.034;
    tp.add(joint);

    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0135 - i * 0.001, L, 4, 10), gloveMat);
    seg.rotation.x = Math.PI / 2;
    seg.position.z = -L / 2;
    joint.add(seg);

    if (i === 1) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 12, 10), rubberMat);
      tip.position.z = -L - 0.005;
      joint.add(tip);
    }

    curls.push({ pivot: joint, max: i ? 0.7 : 0.45, fi: 4, j: i });
    tp = joint;
  });

  // glove cuff, metal wrist ring, orange stripe and white suit sleeve
  const gaunt = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.046, 0.04, 18), gloveMat);
  gaunt.rotation.x = Math.PI / 2;
  gaunt.position.z = 0.065;
  hand.add(gaunt);

  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 24), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.1;
  hand.add(ring);

  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 24), cuffBand);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.z = 0.122;
  hand.add(stripe);

  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.06, 0.3, 20), sleeveMat);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.27;
  hand.add(sleeve);

  hand.rotation.set(0.7, side * 0.15, 0);   // palms up, tilted toward the face, slightly inward
  hand.userData.side = side;
  hand.userData.curls = curls;

  return hand;
}

const hands = new THREE.Group();
hands.userData.noDust = true;

const handL = makeHand(-1);
const handR = makeHand(1);

hands.add(handL, handR);
hands.visible = false;
camera.add(hands);

// small warm light so the gloves are clearly lit even in the dim dome
const handLight = new THREE.PointLight(0xfff0e0, 0, 3);
handLight.position.set(0, 0.12, 0.1);
camera.add(handLight);

const clamp01 = v => Math.min(Math.max(v, 0), 1);

function updateHands(time) {
  const kMax = Math.max(handPose.kL, handPose.kR);

  hands.visible = kMax > 0.01;
  handLight.intensity = 0.8 * kMax;

  if (!hands.visible) return;

  const trem = 0.0042 * handPose.trem * (1 - handPose.flex * 0.45);

  const lift = handPose.breath * 0.02;

  [handL, handR].forEach((h, i) => {
    const s = h.userData.side;
    const k = i === 0 ? handPose.kL : handPose.kR;
    const ph = i * 1.9;   // each hand shakes on its own rhythm

    const tx = (Math.sin(time * 26 + ph) + 0.5 * Math.sin(time * 43 + ph * 2.1)) * trem;
    const ty = (Math.sin(time * 31 + ph * 1.3) + 0.5 * Math.sin(time * 47 + ph)) * trem;
    const tz = Math.sin(time * 22 + ph * 0.7) * trem * 0.5;

    const swayX = Math.sin(time * 0.9 + ph) * 0.004;
    const swayY = Math.sin(time * 1.3 + ph * 0.6) * 0.005;

    h.position.set(
      s * (0.105 - handPose.flex * 0.014) + swayX + tx,
      -0.5 + k * 0.36 + swayY + lift + ty,
      -0.42 + (1 - k) * 0.07 + handPose.flex * 0.012 + tz
    );

    h.rotation.set(
      0.42 + k * 0.3 - handPose.flex * 0.08 + Math.sin(time * 27 + ph) * trem * 4,
      s * (0.15 - handPose.flex * 0.07),
      -s * handPose.flex * 0.1 + Math.sin(time * 24 + ph * 1.2) * trem * 3
    );

    for (const c of h.userData.curls) {
      const lag = c.fi * 0.09 + c.j * 0.04;
      const f = clamp01((handPose.flex - lag) / (1 - 0.4));
      const eased = f * f * (3 - 2 * f);
      const twitch = Math.sin(time * 19 + c.fi * 1.7 + ph) * 0.03 * handPose.trem;

      c.pivot.rotation.x = c.max * (0.15 + 0.85 * eased) + twitch;
    }
  });
}

/* ========== 10. DECISION UI ========== */
const DECIDE_SECONDS = 45;   // time the player has to decide AFTER the reading time (change freely)

/* Only ONE option is correct: "Cut non-essential power".
   Every option has its own voice lines (astroVoice + sysVoice) that play the moment it is confirmed. */
const V = (t, rate = 0.92, pitch = 0.9, pause = 500) => ({ t, rate, pitch, vol: 1, pause });

const OPTIONS = [
  {
    id: 'rover', icon: '🚙', label: 'Send rover to recharge',
    does: 'Drives the rover out to a clear spot to charge from the sun.',
    good: 'Could give the rover some power.',
    risk: 'The sky is full of dust, so there is almost no sunlight. Driving in a storm is dangerous.',
    outcome: 'fail', end: 3, failSecs: 10, score: 15,
    result: 'The rover found almost no sunlight. Driving used even more power and the habitat battery kept falling.',
    lesson: 'The problem is missing sunlight, so going out to look for it does not help. Cut what you do not need instead.',
    story: [
      'The rover rolled out into the storm, looking for a patch of sunlight that did not exist.',
      'It used more power than it could ever collect, and the habitat battery fell faster than before.',
      'By the time the commander understood, there was no power left to call it back.',
    ],
    astroVoice: [V('Sending the rover out…', 0.85, 0.88, 600), V('maybe it can find some sun.', 0.85, 0.88, 0)],
    sysVoice: [V('Rover deployed.', 0.92, 0.88, 500), V('Warning. Solar input near zero. Battery draining fast.', 0.92, 0.86, 0)],
  },
  {
    id: 'shelter', icon: '🛡️', label: 'Go to shelter mode',
    does: 'Seals the habitat and keeps every system running at full power for safety.',
    good: 'The crew is sealed in, safe from the dust outside.',
    risk: 'Nothing is switched off, so the battery keeps draining at the same fast rate.',
    outcome: 'fail', end: 8, failSecs: 12, score: 40,
    result: 'The habitat was sealed, but every machine kept pulling full power. The battery emptied and the air machines stopped.',
    lesson: 'Being sealed in is not enough. The battery is the problem, so you must cut the power you do not need.',
    story: [
      'The commander sealed the habitat and felt safe behind the thick walls.',
      'But the lab, the lights and the plant lamps all kept running. The battery kept falling.',
      'Hours later the power died, and the air machines went quiet inside the sealed room.',
    ],
    astroVoice: [V('Sealing the habitat.', 0.85, 0.88, 500), V('Shelter mode. We should be safe in here.', 0.85, 0.9, 0)],
    sysVoice: [V('Shelter mode active.', 0.92, 0.88, 500), V('Warning. All systems still at full power. Battery depleting.', 0.92, 0.86, 0)],
  },
  {
    id: 'cut', icon: '🔌', label: 'Cut non-essential power',
    does: 'Switches off lab machines, extra lights and the plant lamps. Air, heat and the radio stay on.',
    good: 'Saves a lot of power right away and keeps the air machines running.',
    risk: 'Plants and experiments pause for a while.',
    outcome: 'success', end: 45, score: 100,
    result: 'Only the things that keep you alive stayed on. The battery slowed down, the air machines kept running and the oxygen recovered.',
    lesson: 'Best choice. When power is low, switch off everything you do not need to stay alive. A dust storm can last for weeks.',
    story: [
      'The commander switched off the lab, the extra lights and the plant lamps. Only air, heat and the radio stayed on.',
      'Outside, the dust kept swirling for many hours. Inside, the battery drained slowly and the air kept flowing.',
      'Slowly the sky cleared. The panels began to catch the sun again, and Mission Control called with good news: the crew was safe.',
    ],
    astroVoice: [V('Cutting the extra power.', 0.9, 0.92, 500), V('Lab off. Plant lamps off. Keep the air running.', 0.92, 0.94, 0)],
    sysVoice: [V('Non-essential systems offline.', 0.92, 0.9, 500), V('Power draw reduced. Oxygen recovering.', 0.92, 0.9, 0)],
  },
  {
    id: 'call', icon: '📡', label: 'Call Mission Control',
    does: 'Radios Mission Control on Earth and asks what to do.',
    good: 'Experts can give advice.',
    risk: 'Messages take several minutes to travel between Mars and Earth, and the radio uses power.',
    outcome: 'fail', end: 6, failSecs: 11, score: 30,
    result: 'Mission Control answered after a long wait: "Cut the non-essential power." By then the battery was almost empty.',
    lesson: 'Asking for help is smart, but on Mars the answer is slow. Act first, then call.',
    story: [
      'The commander called Earth and waited for an answer.',
      'The message took minutes to arrive, and the answer took minutes to come back. The radio used power the whole time.',
      'Mission Control said "cut the non-essential power", but by then there was not enough power left to do it.',
    ],
    astroVoice: [V('Mission Control, this is the habitat.', 0.88, 0.9, 500), V('Requesting advice. Please respond.', 0.88, 0.9, 0)],
    sysVoice: [V('Transmission sent.', 0.92, 0.88, 500), V('Reply will take several minutes. Radio is drawing power.', 0.92, 0.86, 0)],
  },
  {
    id: 'wait', icon: '⏳', label: 'Wait it out',
    does: 'Does nothing and hopes the storm ends soon.',
    good: 'Nothing is switched off.',
    risk: 'Everything keeps using power while the sun is blocked.',
    outcome: 'fail', end: 0, failSecs: 9, score: 5,
    result: 'The battery ran out. The lights went off, the heater stopped and the oxygen machines went quiet.',
    lesson: 'Not choosing is also a choice, and here it is the worst one.',
    story: [
      'The commander waited, hoping the storm would end soon.',
      'It did not. Every system kept running while the sun stayed hidden behind the dust.',
      'One by one the lights went out.',
    ],
    astroVoice: [V('Maybe it will pass…', 0.75, 0.84, 700), V('Let\'s just wait.', 0.8, 0.86, 0)],
    sysVoice: [V('No action taken.', 0.92, 0.86, 500), V('All systems at full load. Battery depleting.', 0.92, 0.86, 0)],
  },
];

// used when the countdown reaches zero: always a FAIL
const TIMEOUT_PICK = {
  id: 'timeout', icon: '⏱️', label: 'No decision made',
  outcome: 'fail', end: 0, failSecs: 9, score: 0,
  result: 'The time ran out. No action was taken, and everything kept draining the battery.',
  lesson: 'In an emergency, a slow decision is the same as a wrong decision. Read fast, decide fast.',
  story: [
    'The commander froze while the clock ran down.',
    'No order was given. The systems kept burning power, and the storm kept blocking the sun.',
    'Then the lights went out.',
  ],
  astroVoice: [V('I… I can\'t think…', 0.7, 0.8, 600), V('I\'m too slow.', 0.72, 0.82, 0)],
  sysVoice: [V('No decision received.', 0.9, 0.84, 500), V('All systems at full load.', 0.9, 0.84, 0)],
};

const emConsoleStyle = document.createElement('style');
emConsoleStyle.textContent = `
@keyframes emSlide { from { transform:translateX(40px); opacity:0 } to { transform:none; opacity:1 } }
@keyframes emGlow { 0%,100% { box-shadow:0 0 0 rgba(79,240,216,0) } 50% { box-shadow:0 0 26px rgba(79,240,216,.85) } }
#emConsole { position:fixed; top:16%; right:16px; z-index:96; display:none; width:min(380px,46vw);
  max-height:76vh; overflow:auto; font-family:monospace; font-size:13px; color:#d8fff6;
  background:rgba(4,20,28,.92); border:2px solid #4ff0d8; border-radius:10px; padding:14px 16px;
  line-height:1.4; animation: emSlide .5s ease-out, emGlow 1.4s ease-in-out 3; }
#emConsole h3 { margin:0 0 8px; font-size:16px; letter-spacing:.12em; color:#7fe3ff; }
#emConsole .row { display:flex; justify-content:space-between; gap:8px; font-size:12px; color:#9fe8ff; margin-bottom:8px; }
#emConsole .opt { display:block; width:100%; text-align:left; margin:6px 0; padding:9px 11px; font:inherit;
  color:#d8fff6; background:rgba(79,240,216,.08); border:1px solid #2b7a8a; border-radius:8px; cursor:pointer; }
#emConsole .opt:hover { background:rgba(79,240,216,.2); }
#emConsole .opt.sel { border-color:#4ff0d8; background:rgba(79,240,216,.3); }
#emConsole .info { margin:8px 0; padding:9px 11px; font-size:12.5px; background:rgba(0,0,0,.35);
  border-left:3px solid #4ff0d8; border-radius:4px; }
#emConsole .g { color:#5dff9a; }
#emConsole .r { color:#ff8a6b; }
#emConsole .go { display:block; width:100%; margin-top:8px; padding:11px; font:inherit; font-weight:bold;
  letter-spacing:.15em; color:#04141c; background:#4ff0d8; border:0; border-radius:8px; cursor:pointer; }
#emConsole .go:disabled { opacity:.35; cursor:not-allowed; }
@media (max-width:700px) { #emConsole { font-size:11px; width:52vw; top:14%; } }
`;
document.head.appendChild(emConsoleStyle);

const emConsole = document.createElement('div');
emConsole.id = 'emConsole';
document.body.appendChild(emConsole);

/* ========== 10b. TIMER BAR + END CARD STYLES ========== */
const BRIEF_SECONDS = 15;   // reading time BEFORE the countdown starts (the player can look around and learn)

const o2Style = document.createElement('style');
o2Style.textContent = `
#emO2 { display:none !important; }

#emConsole .tbar { height:8px; margin:6px 0 10px; background:rgba(255,255,255,.12); }
#emConsole .tbar i { display:block; height:100%; width:100%; background:#7fe3ff; transition:width 1s linear; }
#emConsole .tbar i.run { background:#ff4a3a; }

@keyframes emEndIn { from { opacity:0; transform:scale(.96) } to { opacity:1; transform:none } }
#emEnd { position:fixed; inset:0; z-index:120; display:none; align-items:center; justify-content:center; padding:16px; }
#emEnd .card { width:min(580px,92vw); max-height:90vh; overflow:auto; font-family:monospace; color:#e8fff8; line-height:1.45;
  background:rgba(4,12,16,.92); border:2px solid var(--c); padding:22px 24px; animation: emEndIn 1s ease-out; }
#emEnd h2 { margin:0 0 6px; font-size:clamp(22px,4vw,32px); letter-spacing:.14em; color:var(--c); }
#emEnd .sub { margin-bottom:12px; }
#emEnd .stats { display:flex; flex-wrap:wrap; gap:6px 18px; margin:10px 0; padding:8px 0; border-top:1px solid var(--c); border-bottom:1px solid var(--c); }
#emEnd .box { margin:10px 0; padding:9px 11px; background:rgba(0,0,0,.4); border-left:3px solid var(--c); font-size:13px; }
#emEnd .r { color:#ff8a6b; }
#emEnd button { display:block; width:100%; margin-top:12px; padding:12px; font:inherit; font-weight:bold; letter-spacing:.2em;
  color:#04141c; background:var(--c); border:0; cursor:pointer; }
`;
document.head.appendChild(o2Style);

// kept only so older references keep working (never shown)
const emO2 = document.createElement('div');
emO2.id = 'emO2';
document.body.appendChild(emO2);

const emEnd = document.createElement('div');
emEnd.id = 'emEnd';
document.body.appendChild(emEnd);

LINES.astro_fail1 = [
  { t: 'Oxygen…',                 rate: 0.7,  pitch: 0.8,  vol: 0.9,  pause: 800 },
  { t: 'it\'s dropping.',          rate: 0.75, pitch: 0.82, vol: 0.9,  pause: 0 },
];
LINES.astro_fail2 = [
  { t: 'Mission control…',        rate: 0.55, pitch: 0.74, vol: 0.7,  pause: 1100 },
  { t: 'do you… copy…',           rate: 0.45, pitch: 0.7,  vol: 0.55, pause: 0 },
];
LINES.astro_ok = [
  { t: 'Hhh…',                    rate: 0.6,  pitch: 0.78, vol: 0.5,  pause: 800, sighBefore: true },
  { t: 'We made it.',             rate: 0.82, pitch: 0.9,  vol: 1,    pause: 700 },
  { t: 'We actually made it.',    rate: 0.88, pitch: 0.96, vol: 1,    pause: 0 },
];

const MC_OK = [
  { t: 'Habitat, this is Mission Control.', rate: 1.0, pitch: 0.9, vol: 1, pause: 500 },
  { t: 'We read you loud and clear.',       rate: 1.0, pitch: 0.9, vol: 1, pause: 500 },
  { t: 'Good work, commander.',             rate: 0.95, pitch: 0.92, vol: 1, pause: 0 },
];

/* ========== 10c. BLACKOUT HUD (big vertical oxygen on the left) ========== */
const hudStyle = document.createElement('style');
hudStyle.textContent = `
#emHud { position:fixed; inset:0; z-index:99; background:#000; opacity:0; display:none; pointer-events:none; }
#emHud .o2 { position:absolute; left:5vw; top:7vh; bottom:7vh; width:min(170px,24vw);
  display:flex; flex-direction:column; align-items:center; font-family:monospace; color:#d8fff6; }
#emHud .lbl { letter-spacing:.3em; font-size:clamp(13px,2vw,18px); color:#7fe3ff; }
#emHud .pct { font-size:clamp(40px,8vw,84px); font-weight:bold; line-height:1.1; margin:6px 0 12px; }
#emHud .tube { flex:1; width:clamp(54px,9vw,90px); border:3px solid #4ff0d8; background:rgba(255,255,255,.06);
  position:relative; overflow:hidden; }
#emHud .tube i { position:absolute; left:0; right:0; bottom:0; height:100%; background:#4ff0d8;
  box-shadow:0 0 30px rgba(79,240,216,.6); }
#emHud .o2.low .lbl, #emHud .o2.low .pct { color:#ff6a5a; animation: emBlink .7s steps(1) infinite; }
#emHud .o2.low .tube { border-color:#ff4a3a; }
#emHud .o2.low .tube i { background:#ff4a3a; box-shadow:0 0 30px rgba(255,74,58,.7); }
#emSpeech { z-index:130 !important; }
#emEnd .pics { display:flex; gap:8px; margin:12px 0; }
#emEnd .pics img { flex:1; min-width:0; height:96px; object-fit:cover; border:1px solid var(--c); }
#emEnd .story p { margin:0 0 8px; }
`;
document.head.appendChild(hudStyle);

const hud = document.createElement('div');
hud.id = 'emHud';
hud.innerHTML = `<div class="o2" id="hudO2">
  <div class="lbl">OXYGEN</div>
  <div class="pct" id="hudPct">100%</div>
  <div class="tube"><i id="hudFill"></i></div>
</div>`;
document.body.appendChild(hud);

const hudO2 = hud.querySelector('#hudO2');
const hudPct = hud.querySelector('#hudPct');
const hudFill = hud.querySelector('#hudFill');

let hudOn = false;
let oxyTween = null;
const OXY_AT_DEADLINE = 30;   // oxygen % left if the timer reaches zero

function drawO2() {
  const v = Math.max(0, Math.round(oxygen.v));
  hudPct.textContent = v + '%';
  hudFill.style.height = v + '%';
  hudO2.classList.toggle('low', v < 40);
}

// the screen goes dark: only the oxygen (left) and the actions (right) remain
function startBlackout(drain = true) {
  if (hudOn) return;
  hudOn = true;

  look.enabled = false;               // also hides the screen explainer
  emGuide.style.display = 'none';
  emBanner.style.display = 'none';
  emVig.style.display = 'none';
  emExplain.style.display = 'none';

  oxygen.v = 100;
  drawO2();
  hudO2.style.opacity = 1;

  hud.style.display = 'block';
  gsap.fromTo(hud, { opacity: 0 }, { opacity: 0.97, duration: 1 });
  emConsole.style.zIndex = 101;       // keep the actions above the black screen

  if (drain) {
    oxyTween = gsap.to(oxygen, {
      v: OXY_AT_DEADLINE,
      duration: DECIDE_SECONDS,
      ease: 'none',
      onUpdate: drawO2,
    });
  }
}

// the lights blink: the black screen dips so the dark red room shows through for a moment
function flickerHud() {
  const f = gsap.timeline();

  [0.5, 0.97, 0.7, 0.97, 0.35, 0.97, 0.2, 0.97].forEach(v => {
    f.to(hud, {
      opacity: v,
      duration: 0.06 + Math.random() * 0.12,
      ease: 'none',
      onStart: () => { if (v < 0.4) sfx.zap(); },
    });
  });

  return f;
}

/* ========== 10d. DECISION FLOW ========== */
function showDecision() {
  if (decided) return;

  let selected = null;
  let phase = 'brief';          // 'brief' = read and learn (no pressure), 'run' = blackout + countdown
  let left = BRIEF_SECONDS;

  sfx.ping();

  // restart the slide-in + glow animation so the player notices the panel
  emConsole.style.display = 'block';
  emConsole.style.animation = 'none';
  void emConsole.offsetWidth;
  emConsole.style.animation = '';

  emConsole.innerHTML = `
    <h3>⚡ ACTION REQUIRED</h3>
    <div class="row"><span>BATTERY <b id="emBatt">${Math.round(battery.v)}%</b></span><span><span id="emPhase">READ FIRST</span> <b id="emTime">${left}</b>s</span></div>
    <div class="tbar"><i id="emBar"></i></div>
    <div>Power is dropping. You are the commander.<br>
      <b>1.</b> Look at the screens and read the guide. The countdown has not started yet.<br>
      <b>2.</b> When the timer ends the screen goes dark and oxygen starts to fall.<br>
      <b>3.</b> Tap an option to read what it does, then press CONFIRM.</div>
    <div id="emOpts"></div>
    <div class="info" id="emInfo">Tap an option above to see what it does.</div>
    <button class="go" id="emGo" disabled>CONFIRM</button>`;

  const optsEl = emConsole.querySelector('#emOpts');
  const infoEl = emConsole.querySelector('#emInfo');
  const goEl = emConsole.querySelector('#emGo');
  const timeEl = emConsole.querySelector('#emTime');
  const phaseEl = emConsole.querySelector('#emPhase');
  const barEl = emConsole.querySelector('#emBar');

  OPTIONS.forEach(o => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.textContent = `${o.icon}  ${o.label}`;

    b.onclick = () => {
      sfx.click();
      selected = o;

      optsEl.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');

      infoEl.innerHTML =
        `<div>${o.does}</div><div class="g">＋ ${o.good}</div><div class="r">− ${o.risk}</div>`;

      goEl.disabled = false;
    };

    optsEl.appendChild(b);
  });

  goEl.onclick = () => {
    if (!selected) return;
    clearInterval(decideTimer);
    sfx.click();
    resolveChoice(selected);
  };

  decideTimer = setInterval(() => {
    left--;

    if (phase === 'brief') {
      timeEl.textContent = left;
      barEl.style.width = (left / BRIEF_SECONDS * 100) + '%';

      if (left <= 0) {
        // reading time is over: blackout + the real countdown starts now
        phase = 'run';
        left = DECIDE_SECONDS;
        phaseEl.textContent = 'DECIDE';
        timeEl.textContent = left;
        barEl.classList.add('run');
        barEl.style.transition = 'none';
        barEl.style.width = '100%';
        void barEl.offsetWidth;
        barEl.style.transition = '';

        startBlackout(true);

        sfx.ping();
        sfx.zap();
        speakSys([
          { t: 'Power failing. Oxygen is dropping.', rate: 0.92, pitch: 0.88, vol: 1, pause: 400 },
          { t: `You have ${DECIDE_SECONDS} seconds.`, rate: 0.92, pitch: 0.88, vol: 1, pause: 0 },
        ]);
      }
      return;
    }

    timeEl.textContent = left;
    barEl.style.width = (left / DECIDE_SECONDS * 100) + '%';

    if (left === 10) {
      speakSys([{ t: 'Ten seconds, commander.', rate: 0.95, pitch: 0.86, vol: 1, pause: 0 }]);
    }

    if (left <= 10) {
      if (left <= 3) sfx.tickUrgent(); else sfx.tick();
    }

    if (left <= 0) {
      clearInterval(decideTimer);
      resolveChoice(null);   // time ran out -> always a FAIL
    }
  }, 1000);
}

function resolveChoice(o) {
  clearInterval(decideTimer);
  decideTimer = null;

  // The siren stops once the decision is made.
  clearInterval(alarmLoop);
  alarmLoop = null;

  decided = true;

  const timedOut = !o;
  const pick = o || TIMEOUT_PICK;

  // the countdown drain stops; the ending takes over the oxygen
  if (oxyTween) { oxyTween.kill(); oxyTween = null; }

  sfx.confirm();
  emGuide.style.display = 'none';

  // stop every old line (the alarm talk, "ten seconds"...) and play the voice of THIS choice
  clearSpeech();
  say('pick', { parts: pick.astroVoice, who: 'ASTRONAUT', role: 'astro' });
  speakSys(pick.sysVoice);

  emConsole.innerHTML = `
    <h3>⏳ ${pick.label.toUpperCase()}</h3>
    <div class="row"><span>BATTERY <b id="emBatt">${Math.round(battery.v)}%</b></span></div>
    ${timedOut ? '<div class="r">TIME IS UP. No decision was made.</div>' : ''}
    <div class="info">Applying your choice and watching what happens...</div>`;

  const battEl = emConsole.querySelector('#emBatt');

  if (timedOut) sfx.zap();

  gsap.to(battery, {
    v: pick.end,
    duration: pick.outcome === 'success' ? 3 : Math.min(pick.failSecs || 6, 8),
    ease: 'power1.inOut',
    onUpdate: () => {
      drawPanel(Math.round(battery.v));
      battEl.textContent = Math.round(battery.v) + '%';
    },
  });

  if (pick.outcome === 'success') successSequence(pick, timedOut);
  else failSequence(pick, timedOut);
}

/* ========== 10e. ENDINGS ==========
   success -> oxygen RISES back to 100, cut to an outside view, the storm clears, story card with pictures
   fail    -> oxygen falls to 0, lights blink, everything fades to black, "ASTRONAUT NOT SAVED"   */
function flicker(steps) {
  const f = gsap.timeline();

  steps.forEach(v => {
    f.to(lampK, {
      k: v,
      duration: 0.05 + Math.random() * 0.15,
      ease: 'none',
      onStart: () => { if (v < 0.2) sfx.zap(); },
    });
  });

  return f;
}

function failSequence(pick, timedOut) {
  // if the player decided during the reading time, the blackout has not started yet: start it now
  if (!hudOn) startBlackout(false);

  const secs = pick.failSecs || 9;

  emConsole.style.zIndex = 101;

  // tired, shallow breaths while the air runs thin
  for (let i = 0; i < Math.max(3, Math.floor(secs / 2)); i++) {
    gsap.delayedCall(1.5 + i * 2.0 + Math.random() * 0.6, () => breath(0.5, 0.2, 'in'));
  }

  const tl = gsap.timeline({ onComplete: () => showEndCard(pick, timedOut) });

  tl.to(oxygen, { v: 0, duration: secs, ease: 'none', onUpdate: drawO2 }, 0)
    .add(flickerHud(), 1)
    .add(flicker([0.1, 0.8, 0.05, 0.6, 0.1]), 1)
    .call(() => {
      speakSys([
        { t: 'Warning.', rate: 0.9, pitch: 0.85, vol: 1, pause: 500 },
        { t: 'Oxygen levels falling.', rate: 0.9, pitch: 0.85, vol: 1, pause: 0 },
      ]);
      say('astro_fail1');
    }, null, 3.5)
    .add(flickerHud(), Math.max(3, secs * 0.6))
    .add(flicker([0.05, 0.5, 0, 0.35, 0, 0.2, 0]), Math.max(3, secs * 0.6))
    .call(() => say('astro_fail2'), null, Math.max(5.5, secs - 2.5))
    .call(() => speakSys([
      { t: 'Oxygen depleted.', rate: 0.85, pitch: 0.8, vol: 1, pause: 700 },
      { t: 'Life signs lost.', rate: 0.85, pitch: 0.8, vol: 1, pause: 0 },
    ]), null, secs)
    .to(lampK, { k: 0, duration: 2, ease: 'power2.in' }, secs)
    .to(hud, { opacity: 1, duration: 1.5, ease: 'power2.in' }, secs)
    .to(hudO2, { opacity: 0, duration: 1.5 }, secs)
    .to({}, { duration: 3 }, secs + 0.5);
}

function successSequence(pick, timedOut) {
  calmOverride = true;   // the replay stops driving the storm: it passes

  // make sure the oxygen gauge is on screen so the player SEES it rising
  if (!hudOn) startBlackout(false);

  emConsole.style.zIndex = 101;

  const tl = gsap.timeline({ onComplete: () => showEndCard(pick, timedOut) });

  // 1) the red alert calms down and the lights come back
  tl.to(emerg, { k: 0, duration: 4, ease: 'sine.inOut' }, 0)
    .to(lampK, { k: 1, duration: 2 }, 0);

  // 2) oxygen RISES back to 100 on the dark screen
  //    (if the player decided very early, it first dips a little, then rises, so the climb is always visible)
  let t0 = 0;

  if (oxygen.v > 60) {
    tl.to(oxygen, { v: 45, duration: 1.5, ease: 'power1.out', onUpdate: drawO2 }, 0);
    t0 = 1.5;
  }

  tl.to(oxygen, { v: 100, duration: 6, ease: 'sine.out', onUpdate: drawO2 }, t0);

  // 3) cut to black, then to an outside view of the base
  tl.call(() => { emConsole.style.display = 'none'; }, null, 8)
    .to(fade, { opacity: 1, duration: 0.8, ease: 'power2.in' }, 8.2)
    .call(() => {
      hud.style.display = 'none';
      hud.style.opacity = 0;
      emVig.style.display = 'none';
      emBanner.style.display = 'none';

      emerg.k = 0;
      lampK.k = 1;

      camBase.set(-32, 6, 30);
      lookBase.set(0, 2.5, 0);
      lookCur.copy(lookBase);
    }, null, 9.1)
    .to(fade, { opacity: 0, duration: 1.2, ease: 'sine.out' }, 9.3)
    .call(snap, null, 9.8)                                                   // picture 1: storm still thick

    // 4) the storm clears and the camera drifts around the base
    .to(storm, { t: 0.05, duration: 10, ease: 'sine.inOut', overwrite: true }, 9.3)
    .to(camBase, { x: -18, y: 4, z: 22, duration: 11, ease: 'sine.inOut' }, 9.3)
    .call(() => say('astro_ok'), null, 10)
    .call(() => { sfx.ping(); say('mc', { parts: MC_OK, who: 'MISSION CONTROL', role: 'mc' }); }, null, 12)
    .call(snap, null, 14)                                                    // picture 2: dust thinning
    .call(snap, null, 19.5)                                                  // picture 3: clear sky
    .to({}, { duration: 1.5 }, 19.5);
}

function showEndCard(pick, timedOut) {
  emConsole.style.display = 'none';
  emGuide.style.display = 'none';
  emBanner.style.display = 'none';
  emVig.style.display = 'none';
  look.enabled = false;

  const ok = pick.outcome === 'success';
  const c = ok ? '#5dff9a' : '#ff4a3a';

  const best = OPTIONS.find(x => x.outcome === 'success');

  const others = OPTIONS
    .filter(x => x.id !== pick.id)
    .map(x => `• ${x.label}: ${x.score}/100`)
    .join('<br>');

  const story = pick.story.map(p => `<p>${p}</p>`).join('');

  let pics = '';

  if (ok) {
    const list = snaps.slice(-3);
    while (list.length < 3) list.push('/tex/mars.jpg');   // fallback picture if a snapshot failed
    pics = `<div class="pics">${list.map(src => `<img src="${src}" alt="Mars">`).join('')}</div>`;
  }

  emEnd.style.background = ok ? 'rgba(0,10,8,.7)' : '#000';
  emEnd.style.setProperty('--c', c);

  emEnd.innerHTML = `
    <div class="card">
      <h2>${ok ? '✅ ASTRONAUT SAVED' : '❌ ASTRONAUT NOT SAVED'}</h2>
      <div class="sub">${ok
        ? 'The storm passed, the power held and the air kept flowing. The commander is safe.'
        : 'The oxygen ran out. Mission Control lost contact with the habitat. The astronaut was not saved.'}</div>
      ${pics}
      <div class="box story">${story}</div>
      ${timedOut ? '<div class="r">Time ran out, so no action was taken.</div>' : ''}
      <div class="stats">
        <span>CHOICE: <b>${pick.label}</b></span>
        <span>BATTERY: <b>${pick.end}%</b></span>
        <span>OXYGEN: <b>${Math.max(0, Math.round(oxygen.v))}%</b></span>
        <span>SCORE: <b>${pick.score}/100</b></span>
      </div>
      <div class="box">${pick.result}</div>
      <div class="box"><b>What to learn:</b> ${pick.lesson}</div>
      ${!ok ? `<div class="box"><b>The right choice:</b> ${best.label}. ${best.does}</div>` : ''}
      <div class="box"><b>Other choices:</b><br>${others}</div>
      <button id="emAgain">TRY AGAIN</button>
    </div>`;

  emEnd.style.display = 'flex';
  sfx.confirm();

  emEnd.querySelector('#emAgain').onclick = () => location.reload();
}

/* ========== 11. RENDER LOOP + RESIZE ========== */
let last = performance.now();
let time = 0;
let inside = 0;
let sfxTimer = 0;
let beaconOn = false;
let lastDustK = -1;

let fpsAcc = 0;
let fpsFrames = 0;
let lowCount = 0;

const beaconPos = new THREE.Vector3(16, 1, 22);

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);

  last = now;
  time += dt;

  // Siren breathing, shared by lights and the post-processing pass.
  const pulse = 0.5 + 0.5 * Math.sin(time * 5);

  // Drifting dust.
  const arr = dgeo.attributes.position.array;

  const wind = 1 + storm.t * 14;

  for (let i = 0; i < N; i++) {
    arr[i * 3] += dt * wind;

    if (arr[i * 3] > 80) {
      arr[i * 3] = -80;
    }
  }

  dgeo.attributes.position.needsUpdate = true;

  if (devil.visible) {
    updateDevil(time, dt);
  }

  // Storm look.
  scene.fog.density = 0.007 + storm.t * 0.05;

  scene.fog.color.lerpColors(
    calmFog,
    stormFog,
    storm.t
  );

  skyUniforms.storm.value = storm.t;

  sun.intensity =
    SUN_BASE * (1 - storm.t * stormData.sunlightDropPct / 100);

  hemi.intensity = 0.6 * (1 - storm.t * 0.4);

  // no outdoor dust inside the dome
  dmat.opacity = (0.25 + storm.t * 0.35) * (1 - inside);
  dustPoints.visible = inside < 0.98;
  devilMat.opacity = 0.18 * (1 - inside);

  // Props.
  cups.rotation.y += dt * (2 + storm.t * 18);

  const bOn = Math.sin(time * 4) > 0;

  if (beacon) {
    beacon.visible = bOn;
  }

  if (bOn && !beaconOn) {
    const d = camera.position.distanceTo(beaconPos);

    sfx.beacon(Math.max(0, 1 - d / 40));
  }

  beaconOn = bOn;

  panelMat.emissiveIntensity = 1 - storm.t * 0.9;

  habitat.update(time, dt, camera, storm.t, emerg.k);

  // Interior lamp + spill light shift from teal to red in an emergency.
  lamp.color.lerpColors(lampCalm, alertRed, emerg.k);
  spill.color.lerpColors(spillCalm, alertRed, emerg.k);

  lamp.intensity =
    25 * lampK.k *
    (1 - storm.t * 0.25 + (Math.random() - 0.5) * 0.1 * storm.t) *
    (1 + emerg.k * (pulse - 0.5) * 0.9);

  // Dust coating.
  const dustK = storm.t * 0.35;

  if (Math.abs(dustK - lastDustK) > 0.002) {
    for (const d of dustTargets) {
      d.m.color.lerpColors(d.base, dustCol, dustK);
    }

    lastDustK = dustK;
  }

  // Camera.
  const sh = 0.003 + storm.t * 0.015 + emerg.k * 0.006 + impact.v * 0.06;

  const cx = camBase.x + Math.sin(time * 1.7) * sh;
  const cz = camBase.z + Math.cos(time * 1.3) * sh;

  const cy = Math.max(
    camBase.y + Math.sin(time * 2.3) * sh * 1.4,
    heightAt(cx, cz) + 1.0
  );

  camera.position.set(cx, cy, cz);

  lookCur.lerp(
    lookBase,
    1 - Math.exp(-dt * 5)
  );

  camera.lookAt(
    lookCur.x + Math.sin(time * 0.9) * sh * 2,
    lookCur.y,
    lookCur.z
  );

  // player look-around (only after the wake-up finishes)
  const k = 1 - Math.exp(-dt * 4);
  look.yaw += (look.tyaw - look.yaw) * k;
  look.pitch += (look.tpitch - look.pitch) * k;

  if (look.enabled) {
    camera.rotateOnWorldAxis(UP, look.yaw);
    camera.rotateX(look.pitch);
  }

  // emergency explainer: shows what the screen the player is looking at means
  updateExplain();
  updateHands(time);

  sky.position.copy(camera.position);

  // Captions and audio.
  if (tourActive) {
    updateCaption();

    // camera has passed through the airlock -> start the fade
    if (!entered && camera.position.z < 4.2 &&
        Math.hypot(camera.position.x, camera.position.z) < 5.4) {
      enterDome();
    }
  }

  const insideTarget =
    (Math.hypot(camera.position.x, camera.position.z) < 5.2 &&
     camera.position.y < 4) ? 1 : 0;

  inside += (insideTarget - inside) * Math.min(1, dt * 2);

  sfxTimer += dt;

  if (sfxTimer > 0.1) {
    sfx.update(storm.t, inside);
    sfxTimer = 0;
  }

  // Automatic quality adjustment.
  if (tourActive || storm.t > 0) {
    fpsAcc += dt;
    fpsFrames++;

    if (fpsAcc >= 1.5) {
      const fps = fpsFrames / fpsAcc;

      console.info('FPS', fps.toFixed(0));

      if (fps < 38 && quality > 0) {
        if (++lowCount >= 2) {
          setQuality(quality - 1);
          lowCount = 0;
        }
      } else {
        lowCount = 0;
      }

      fpsAcc = 0;
      fpsFrames = 0;
    }
  }

  grade.uniforms.time.value = time;
  grade.uniforms.storm.value = storm.t;
  grade.uniforms.alarm.value = emerg.k;
  grade.uniforms.pulse.value = pulse;

  composer.render();

  // take a picture of the real scene right after it is drawn (used on the success card)
  if (snapReq) {
    snapReq = false;
    try {
      snaps.push(renderer.domElement.toDataURL('image/jpeg', 0.7));
    } catch (err) {
      console.warn('snapshot failed', err);
    }
  }
});

/* ----- RESIZE (also runs when fullscreen starts or ends) ----- */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});