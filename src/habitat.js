// src/habitat.js — sealed dome: airlock entry, teal/green/blue lived-in interior, sleep chair + big screens
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mission } from './replay.js';

const R = 6, RI = 5.9, H = 3.2, SQ = 0.55, GAP = 0.32;

/* ---------- helpers ---------- */
let seed = 1337;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const RB = (w, h, d, r = 0.03) =>
  new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, Math.min(r, Math.min(w, h, d) / 2 - 0.0005)));
const CYL = (r, h, s = 16) => new THREE.CylinderGeometry(r, r, h, s);
const CAP = (r, len, s = 12) => new THREE.CapsuleGeometry(r, len, 6, s);
const TOR = (r, t, s = 20, a = Math.PI * 2) => new THREE.TorusGeometry(r, t, 8, s, a);
const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// mk(parent, geometry, material, x, y, z, rotY, rotX, rotZ)
function mk(parent, geo, mat, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// Group on the inner wall at angle th (0 = door side, PI = back). Local +z faces the room centre.
function onWall(parent, th, r = 5.7) {
  const g = new THREE.Group();
  g.position.set(Math.sin(th) * r, 0, Math.cos(th) * r);
  g.rotation.y = th + Math.PI;
  parent.add(g);
  return g;
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

const hullTex = (base, repeat) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 2 + Math.random() * 14);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (const [x, y] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
}, repeat);

// Merge static meshes that share a material (huge draw-call saving). userData.keep = true skips a mesh.
function mergeStatic(root, { cast = false } = {}) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.keep) return;
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(o);
  });
  for (const [mat, meshes] of buckets) {
    const geos = meshes.map(m => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.clearGroups();
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) { console.warn('habitat: merge failed for one material, leaving its meshes unmerged'); continue; }
    meshes.forEach(m => m.removeFromParent());
    const out = new THREE.Mesh(merged, mat);
    out.castShadow = cast;
    out.receiveShadow = true;
    root.add(out);
  }
}

/* ---------- screen drawings (all scale with canvas width) ---------- */
const bg = (g, w, h, c = '#04141c') => { g.fillStyle = c; g.fillRect(0, 0, w, h); };
const txt = (g, s, x, y, px, col = '#7fe3ff') => { g.fillStyle = col; g.font = `bold ${px}px monospace`; g.fillText(s, x, y); };
const INK = '#7fe3ff', GOOD = '#5dff9a', WARN = '#ff6b4a', DIM = '#2b7a8a';

function drawSolar(g, w, h, t, s) {
  const u = w / 256; bg(g, w, h);
  txt(g, 'SUNLIGHT AT SURFACE', 10 * u, 22 * u, 13 * u);
  if (!mission.day) { txt(g, 'STANDBY', 14 * u, 90 * u, 28 * u, INK); return; }
  const p = mission.solarPct;
  txt(g, (p < 1 ? p.toFixed(2) : p.toFixed(0)) + '%', 14 * u, 90 * u, 44 * u, p < 10 ? WARN : GOOD);
  txt(g, 'DIRECT BEAM, COMPUTED FROM TAU', 10 * u, 112 * u, 9 * u, DIM);
  txt(g, 'TAU ' + mission.tau.toFixed(2), 10 * u, h - 10 * u, 16 * u);
}
function drawWave(g, w, h, t, s) {
  const u = w / 256; bg(g, w, h);
  txt(g, 'LIFE SUPPORT', 10 * u, 24 * u, 17 * u);
  g.strokeStyle = '#5dff9a'; g.lineWidth = 2 * u; g.beginPath();
  for (let x = 0; x < w; x++) {
    const y = h * 0.55 + Math.sin(x * 0.07 / u + t * 3) * 16 * u * (1 + s) + Math.sin(x * 0.23 / u + t) * 6 * u;
    x ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  txt(g, 'O2 20.9%  CO2 0.04%', 10 * u, h - 10 * u, 13 * u);
}
function drawComms(g, w, h, t, s) {
  const u = w / 256; bg(g, w, h);
  txt(g, 'DATA SOURCE', 10 * u, 22 * u, 13 * u);
  if (mission.error) { txt(g, 'NO DATA FILE', 10 * u, 70 * u, 18 * u, WARN); return; }
  if (!mission.day) { txt(g, 'AWAITING LINK', 10 * u, 70 * u, 16 * u); return; }
  const d = mission.day;
  txt(g, 'NASA CURIOSITY (MSL)', 10 * u, 48 * u, 11 * u, GOOD);
  txt(g, 'MASTCAM SUN IMAGING', 10 * u, 66 * u, 11 * u);
  txt(g, `SOL ${d.sol}: ${d.n} OBSERVATION${d.n > 1 ? 'S' : ''}`, 10 * u, 84 * u, 11 * u);
  if (d.tau440 != null) txt(g, `440NM TAU ${d.tau440.toFixed(2)}`, 10 * u, 102 * u, 11 * u);
  const ev = (mission.events || []).filter(e => e.sol <= d.sol).pop();
  if (ev) txt(g, ev.text, 10 * u, h - 10 * u, 8 * u, DIM);
}
function drawRadar(g, w, h, t, s) {
  const u = w / 256; bg(g, w, h);
  txt(g, 'DUST TRACKER', 10 * u, 24 * u, 17 * u);
  const cx = w / 2, cy = h / 2 + 12 * u, r = h * 0.36;
  g.strokeStyle = '#1e6a7a'; g.lineWidth = 1;
  for (const k of [1, 0.66, 0.33]) { g.beginPath(); g.arc(cx, cy, r * k, 0, 7); g.stroke(); }
  g.strokeStyle = '#7fe3ff'; g.beginPath(); g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(t * 2) * r, cy + Math.sin(t * 2) * r); g.stroke();
  g.fillStyle = 'rgba(255,140,60,0.5)';
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4, d = r * (0.2 + 0.8 * ((i * 0.37) % 1)) * (0.3 + s);
    g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, (4 + s * 8) * u, 0, 7); g.fill();
  }
}
function drawLog(g, w, h, t, s) {
  const u = w / 256; bg(g, w, h);
  txt(g, 'MISSION LOG', 10 * u, 24 * u, 17 * u);
  if (!mission.day) { txt(g, '> awaiting telemetry', 10 * u, 52 * u, 11 * u); return; }
  const d = mission.day;
  const ev = (mission.events || []).filter(e => e.sol <= d.sol).pop();
  [`SOL ${d.sol}  LS ${d.ls}`, `> 880NM TAU ${d.tau.toFixed(2)}`,
   d.tau440 != null ? `> 440NM TAU ${d.tau440.toFixed(2)}` : '> 440NM NO DATA',
   d.tau >= 2.5 ? '> STORM ALERT' : '> dust opacity rising']
    .forEach((l, i) => txt(g, l, 10 * u, (52 + i * 22) * u, 11 * u, i === 3 && d.tau >= 2.5 ? WARN : INK));
  if (ev) txt(g, ev.text, 10 * u, (52 + 4 * 22) * u, 8 * u, DIM);
}
function drawStorm(g, w, h, t, s) {      // big centre screen
  const u = w / 256; bg(g, w, h, '#03141a');
  g.strokeStyle = 'rgba(80,230,210,0.14)'; g.lineWidth = 1;
  for (let x = 0; x < w; x += 16 * u) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 16 * u) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  txt(g, 'GALE CRATER DUST OPACITY', 10 * u, 20 * u, 13 * u);

  if (mission.error) { txt(g, 'NO DATA FILE', 10 * u, h / 2, 18 * u, WARN); return; }
  if (!mission.day) { txt(g, 'AWAITING TELEMETRY', 10 * u, h / 2, 16 * u, DIM); return; }

  const days = mission.days, n = days.length;
  const s0 = days[0].sol, s1 = days[n - 1].sol;
  const maxTau = Math.max(1, Math.ceil(Math.max(...days.map(d => d.tau))));
  const cx = 14 * u, cy = 30 * u, cw = w - 28 * u, ch = h * 0.42;
  const X = sol => cx + ((sol - s0) / Math.max(1, s1 - s0)) * cw;
  const Y = v => cy + ch - (v / maxTau) * ch;

  g.strokeStyle = '#1e6a7a'; g.strokeRect(cx, cy, cw, ch);
  txt(g, String(maxTau), 2 * u, cy + 8 * u, 8 * u, DIM);
  txt(g, '0', 4 * u, cy + ch, 8 * u, DIM);
  txt(g, 'SOL ' + s0, cx, cy + ch + 11 * u, 8 * u, DIM);
  txt(g, 'SOL ' + s1, cx + cw - 44 * u, cy + ch + 11 * u, 8 * u, DIM);

  // only real measured points, no connecting line
  mission.seen.forEach((d, i) => {
    const cur = i === mission.idx;
    g.fillStyle = cur ? '#ffffff' : d.tau > 4 ? '#ff8c3c' : INK;
    g.beginPath(); g.arc(X(d.sol), Y(d.tau), (cur ? 3.5 : 2.2) * u, 0, 7); g.fill();
  });

  const d = mission.day;
  txt(g, 'TAU ' + d.tau.toFixed(2), w - 132 * u, h - 14 * u, 26 * u, d.tau > 4 ? WARN : GOOD);
  txt(g, `SOL ${d.sol}  ~${d.date}`, 14 * u, h - 14 * u, 11 * u);
  txt(g, 'NASA MSL MASTCAM 880 NM · LEMMON 2023', 14 * u, h - 3 * u, 7 * u, DIM);
}

/* =====================================================================
   buildHabitat(scene) -> { group, drawPanel, update, leds, onDoor }
   update(time, dt, camera, stormT, emerg)  emerg: 0 = calm ... 1 = full red alert
   ===================================================================== */
export function buildHabitat(scene) {
  const habitat = new THREE.Group();
  const exterior = new THREE.Group();
  const interior = new THREE.Group();
  interior.userData.noDust = true;
  habitat.add(exterior, interior);
  scene.add(habitat);

  const envTex = scene.environment;   // interior uses a weak env so outdoor sky light doesn't leak in
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3, ...o });
  const Mi = (color, o = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.6, metalness: 0.3, emissive: 0x03181a, envMap: envTex, envMapIntensity: 0.12, ...o,
  });
  const glow = (hex, k = 1.8) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });

  /* ---------- exterior materials ---------- */
  const mHull = M(0xffffff, { map: hullTex('#dcd8d0', [14, 1.2]), roughness: 0.55, metalness: 0.25 });
  const mDome = M(0xffffff, { map: hullTex('#e4e0d8', [14, 3]), roughness: 0.5, metalness: 0.25 });
  const mPod = M(0xffffff, { map: hullTex('#d6d3cc', [6, 2]), roughness: 0.55, metalness: 0.25 });
  const mAccent = M(0xe0661f, { roughness: 0.5 });
  const mDarkX = M(0x3a3f45, { roughness: 0.7, metalness: 0.5 });
  const mMetalX = M(0x9aa0a6, { metalness: 0.7, roughness: 0.4 });
  const mCaution = M(0xffd23f, { roughness: 0.6, metalness: 0.1 });
  const mDoor = M(0xffffff, { map: hullTex('#c9ced1', [1, 1.6]), roughness: 0.45, metalness: 0.5 });
  const mGlassX = M(0x0b2b33, { roughness: 0.1, metalness: 0.9 });
  const mLampX = glow(0xfff1d0, 1.5);
  const mPorth = glow(0x7dffe0, 1.6);
  const mLedR = glow(0xff3b30, 1.5);
  const mGlowT = glow(0x4ff0d8, 1.6);
  const mLampC = glow(0xd8fff6, 1.5);

  /* ---------- interior materials (teal / slate palette) ---------- */
  const mInnerWall = Mi(0xffffff, { map: hullTex('#6f8f96', [14, 1.2]), roughness: 0.8, metalness: 0.2, side: THREE.BackSide });
  const mInnerDome = Mi(0xffffff, { map: hullTex('#86a8ac', [14, 3]), roughness: 0.8, metalness: 0.2, side: THREE.BackSide });
  const mFloor = Mi(0xffffff, {
    map: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#1f2a30'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#33444c'; g.lineWidth = 2;
      for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      g.fillStyle = 'rgba(120,200,190,0.10)';
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { g.fillRect(x + 6, y + 6, 20, 2); g.fillRect(x + 6, y + 12, 20, 2); g.fillRect(x + 6, y + 18, 20, 2); }
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.14})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    }, [8, 8]), roughness: 0.55, metalness: 0.6,
  });
  const mRug = Mi(0xffffff, {
    map: canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = '#16363a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1f5a5a'; g.fillRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#16363a'; for (let i = 0; i < 8; i++) g.fillRect(14, 20 + i * 28, w - 28, 6);
    }), roughness: 1, metalness: 0,
  });
  const mDark = Mi(0x20282e, { roughness: 0.5, metalness: 0.6 });
  const mMetal = Mi(0x9aa6ad, { roughness: 0.35, metalness: 0.8 });
  const mPlastic = Mi(0xd5dadb, { roughness: 0.6, metalness: 0.05 });
  const mSeat = Mi(0x1f2c36, { roughness: 0.75, metalness: 0.05 });
  const mSeatAcc = Mi(0x2a8f86, { roughness: 0.7, metalness: 0.05 });
  const mCrate = Mi(0x7d7a58, { roughness: 0.9, metalness: 0.05 });
  const mCrate2 = Mi(0x3f6d7a, { roughness: 0.9, metalness: 0.05 });
  const mOrange = Mi(0xe0661f, { roughness: 0.5 });
  const mSuit = Mi(0xe8ecee, { roughness: 0.8, metalness: 0 });
  const mGold = Mi(0xd9a441, { roughness: 0.25, metalness: 0.9 });
  const mTankBlue = Mi(0x2f78c4, { roughness: 0.35, metalness: 0.6 });
  const mTankGreen = Mi(0x2f9e63, { roughness: 0.35, metalness: 0.6 });
  const mTankYel = Mi(0xe0b13a, { roughness: 0.35, metalness: 0.6 });
  const mTankGray = Mi(0xaab4ba, { roughness: 0.35, metalness: 0.7 });
  const mLeaf = Mi(0x3fae5e, { roughness: 1, metalness: 0, emissive: 0x0b3a1a });
  const mSoil = Mi(0x2a1d14, { roughness: 1, metalness: 0 });
  const mCable = Mi(0x0d0f10, { roughness: 0.8, metalness: 0 });
  const mCableT = Mi(0x2a8f86, { roughness: 0.8, metalness: 0 });
  const gT = glow(0x4ff0d8), gG = glow(0x6bff9c), gB = glow(0x56b6ff), gR = glow(0xff3b30, 1.5), gA = glow(0xffb000, 1.5);
  const gGrow = glow(0x9dffb4, 2.2);
  const mCeil = glow(0xe6fff8, 1.5);
  const ceilBase = mCeil.color.clone();

  /* ---------- emergency colours (remember the calm look, lerp to red) ---------- */
  const RED = new THREE.Color(0xff2a1a);
  const REDGLOW = RED.clone().multiplyScalar(1.8);
  const base = {
    gT: gT.color.clone(), gG: gG.color.clone(), gB: gB.color.clone(),
    sg: new THREE.Color(0x58b8ff), hy: new THREE.Color(0x7dff9a),
  };

  /* ---------- reusable realistic parts ---------- */
  const tankGeo = lathe([[0, 0], [0.17, 0], [0.19, 0.02], [0.19, 0.68], [0.17, 0.8], [0.1, 0.88], [0.05, 0.91], [0.05, 0.96], [0, 0.96]]);
  const canGeo = lathe([[0, 0], [0.1, 0], [0.11, 0.02], [0.11, 0.26], [0.09, 0.29], [0.09, 0.33], [0, 0.33]], 20);
  const mugGeo = lathe([[0, 0], [0.045, 0], [0.045, 0.095], [0.039, 0.095], [0.039, 0.008], [0, 0.008]], 18);
  const potGeo = lathe([[0, 0], [0.06, 0], [0.08, 0.1], [0.07, 0.1], [0.05, 0.01], [0, 0.01]], 16);
  function makeTank(parent, x, y, z, mat, band = mOrange, sc = 1) {
    const t = new THREE.Group(); t.position.set(x, y, z); t.scale.setScalar(sc); parent.add(t);
    mk(t, tankGeo, mat);
    mk(t, CYL(0.192, 0.1, 24), band, 0, 0.55, 0);
    mk(t, CYL(0.04, 0.1, 10), mMetal, 0, 1.0, 0);
    mk(t, TOR(0.07, 0.012, 16), mDark, 0, 1.06, 0, 0, Math.PI / 2);   // handwheel
    return t;
  }

  /* =================== EXTERIOR =================== */
  const wall = (r, h, mat, y) =>
    mk(exterior, new THREE.CylinderGeometry(r, r, h, 64, 1, true, GAP, Math.PI * 2 - 2 * GAP), mat, 0, y, 0);
  wall(R, H, mHull, H / 2);
  wall(R + 0.06, 0.5, mDarkX, 0.25);      // kick plate
  wall(R + 0.04, 0.3, mAccent, 2.55);     // accent band

  const dome = mk(exterior, new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), mDome, 0, H, 0);
  dome.scale.y = SQ;
  for (let i = 0; i < 8; i++) {
    const rib = mk(exterior, TOR(R + 0.04, 0.07, 48, Math.PI), mDarkX, 0, H, 0, (i * Math.PI) / 8);
    rib.scale.y = SQ;
  }

  // roof: collar, mast with ring and blinking tip, vents
  const topY = H + R * SQ;
  mk(exterior, CYL(0.9, 0.35, 24), mDarkX, 0, topY, 0);
  mk(exterior, CYL(0.04, 2.4, 8), mMetalX, 0, topY + 1.2, 0);
  mk(exterior, TOR(0.35, 0.03, 20), mMetalX, 0, topY + 1.6, 0, 0, Math.PI / 2);
  const mastTip = mk(exterior, new THREE.SphereGeometry(0.1, 10, 8), mLedR, 0, topY + 2.45, 0);
  mastTip.userData.keep = true;
  for (const x of [-1.6, 1.6]) mk(exterior, CYL(0.25, 0.3, 14), mDarkX, x, 6.4, 0.4);

  // glowing portholes
  for (const th of [0.9, -0.9, 1.5, -1.5, 2.8, -2.8]) {
    const g = new THREE.Group();
    g.position.set(Math.sin(th) * (R + 0.03), 1.95, Math.cos(th) * (R + 0.03));
    g.rotation.y = th; exterior.add(g);
    mk(g, TOR(0.3, 0.06, 24), mDarkX);
    mk(g, new THREE.CircleGeometry(0.28, 24), mPorth, 0, 0, 0.005);
  }

  // ----- airlock vestibule (the only way in) -----
  for (const s of [-1, 1]) {
    mk(exterior, RB(1.86, 3.1, 2.0, 0.08), mHull, s * 2.77, 1.55, 6.5);                // wing blocks (hold the door panels)
    mk(exterior, RB(1.7, 0.14, 0.04, 0.02), mAccent, s * 2.77, 0.9, 7.52);
    mk(exterior, RB(0.9, 0.12, 0.03, 0.02), mCaution, s * 2.77, 2.4, 7.52);
    mk(exterior, BOX3(0.03, 2.9, 0.03), mGlowT, s * 1.83, 1.55, 7.45);                   // jamb light
    const f = new THREE.Group(); f.position.set(s * 3.3, 3.0, 7.56); exterior.add(f);  // floodlights
    mk(f, RB(0.4, 0.22, 0.25, 0.04), mDarkX);
    mk(f, RB(0.34, 0.16, 0.02, 0.01), mLampX, 0, 0, 0.14);
  }
  function BOX3(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
  mk(exterior, RB(7.4, 0.5, 2.0, 0.1), mDarkX, 0, 3.35, 6.5);                          // roof slab
  mk(exterior, RB(3.7, 0.06, 2.0, 0.02), mDarkX, 0, 0.03, 6.5);                        // passage floor
  mk(exterior, RB(2.6, 0.04, 0.12, 0.015), mLampC, 0, 3.08, 6.1);                      // passage ceiling lights
  mk(exterior, RB(2.6, 0.04, 0.12, 0.015), mLampC, 0, 3.08, 7.0);
  mk(exterior, RB(3.8, 0.14, 1.0, 0.04), mDarkX, 0, 0.07, 8.0);                         // steps
  mk(exterior, RB(3.8, 0.07, 0.8, 0.03), mDarkX, 0, 0.035, 8.7);
  const signTex = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#0d1418'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7dffe0'; g.font = 'bold 34px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('OUTPOST ALPHA · AIRLOCK', w / 2, h / 2);
  });
  mk(exterior, new THREE.PlaneGeometry(3.4, 0.4), new THREE.MeshBasicMaterial({ map: signTex }), 0, 3.35, 7.52);

  // door panels slide sideways into the wing blocks
  const doorL = new THREE.Group(), doorR = new THREE.Group();
  doorL.position.set(-0.92, 0, 7.35); doorR.position.set(0.92, 0, 7.35);
  exterior.add(doorL, doorR);
  for (const [d, s] of [[doorL, -1], [doorR, 1]]) {
    [
      mk(d, RB(1.84, 3.0, 0.14, 0.05), mDoor, 0, 1.55, 0),
      mk(d, RB(0.55, 0.55, 0.04, 0.05), mGlassX, -s * 0.35, 2.0, 0.075),
      mk(d, BOX3(0.03, 2.7, 0.03), mGlowT, -s * 0.9, 1.55, 0.08),
      mk(d, RB(1.6, 0.1, 0.02, 0.01), mCaution, 0, 0.35, 0.075),
      mk(d, CAP(0.025, 0.5), mDarkX, -s * 0.7, 1.1, 0.12),
    ].forEach(p => { p.userData.keep = true; });
  }
  const doorLamp = mk(exterior, new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30 }), 0, 3.72, 7.2);
  doorLamp.userData.keep = true;

  // side lab pod + tunnel (matches the sealed hatch inside)
  mk(exterior, CAP(1.4, 2.6, 24), mPod, 10.6, 1.5, -1.5, 0, 0, Math.PI / 2);
  mk(exterior, CYL(1.43, 0.35, 24), mAccent, 10.6, 1.5, -1.5, 0, 0, Math.PI / 2);
  mk(exterior, RB(5, 0.12, 0.8, 0.04), mDarkX, 10.6, 0.06, -1.5);
  for (const x of [9.75, 11.45]) {
    mk(exterior, CYL(0.26, 0.1, 18), mPorth, x, 1.6, -0.08, 0, Math.PI / 2);
    mk(exterior, TOR(0.3, 0.05, 18), mDarkX, x, 1.6, -0.06);
  }
  mk(exterior, CYL(0.75, 2.9, 20), mMetalX, 7.2, 1.1, -1.5, 0, 0, Math.PI / 2);
  for (const x of [6.5, 7.2, 7.9]) mk(exterior, TOR(0.76, 0.05, 24), mDarkX, x, 1.1, -1.5, Math.PI / 2);
  mk(exterior, CYL(0.04, 1.2, 8), mMetalX, 11.4, 3.5, -1.5);
  mk(exterior, new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), mMetalX, 11.4, 4.05, -1.5, 0, 0.6);

  /* =================== INTERIOR SHELL =================== */
  mk(interior, new THREE.CylinderGeometry(RI, RI, H, 64, 1, true, GAP, Math.PI * 2 - 2 * GAP), mInnerWall, 0, H / 2, 0);
  const innerDome = mk(interior, new THREE.SphereGeometry(RI, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), mInnerDome, 0, H, 0);
  innerDome.scale.y = SQ;
  mk(interior, new THREE.CircleGeometry(RI - 0.02, 64), mFloor, 0, 0.02, 0, 0, -Math.PI / 2);
  mk(interior, new THREE.PlaneGeometry(3.4, 5.4), mRug, 0, 0.035, -1.2, 0, -Math.PI / 2);

  const arc = (r, y, t0, t1, n = 48) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; pts.push(new THREE.Vector3(Math.sin(t) * r, y, Math.cos(t) * r)); }
    return new THREE.CatmullRomCurve3(pts);
  };
  const tube = (curve, r, mat, seg = 80) => mk(interior, new THREE.TubeGeometry(curve, seg, r, 6, false), mat);
  const A0 = 0.5, A1 = Math.PI * 2 - 0.5;           // arcs skip the door gap

  tube(arc(5.84, 0.07, A0, A1), 0.05, mMetal);                       // baseboard conduit
  tube(arc(5.5, 0.04, A0 + 0.1, A1 - 0.1), 0.03, gG);                // green floor strip
  tube(arc(5.84, 1.25, A0, A1), 0.02, gT);                           // teal wall strip
  tube(arc(5.8, 2.7, A0, A1), 0.07, mMetal);                         // pipe ring 1
  tube(arc(5.8, 2.9, A0, A1), 0.05, mTankBlue);                      // pipe ring 2 (coolant)
  mk(interior, TOR(4.0, 0.05, 64), mCeil, 0, 5.5, 0, 0, Math.PI / 2);   // ceiling ring lights
  mk(interior, TOR(2.2, 0.04, 48), gT, 0, 6.15, 0, 0, Math.PI / 2);
  mk(interior, CYL(0.6, 0.08, 24), mCeil, 0, 6.38, 0);
  for (let i = 0; i < 14; i++) {                                     // wall ribs with LED tips
    const th = 0.1 + i * (Math.PI * 2 / 14);
    const d = Math.atan2(Math.sin(th), Math.cos(th));
    if (Math.abs(d) < 0.6) continue;
    mk(interior, RB(0.12, 3.1, 0.1, 0.03), mDark, Math.sin(th) * 5.84, 1.55, Math.cos(th) * 5.84, th + Math.PI);
    mk(interior, new THREE.SphereGeometry(0.03, 8, 6), i % 2 ? gT : gG, Math.sin(th) * 5.78, 2.4, Math.cos(th) * 5.78);
  }
  for (const th of [1.2, 2.1, -1.4, -2.0, 3.0]) {                    // pipe valve wheels
    const g = onWall(interior, th, 5.74);
    mk(g, TOR(0.12, 0.018, 16), mOrange, 0, 2.7, 0.04);
    mk(g, CYL(0.03, 0.12, 8), mMetal, 0, 2.7, 0.02, 0, Math.PI / 2);
  }

  /* =================== SLEEP CHAIR (reclined lounger, head toward the door) =================== */
  const lounge = new THREE.Group();
  lounge.position.set(0, 0.85, -2.5);
  lounge.rotation.x = -0.5;
  interior.add(lounge);
  mk(lounge, RB(0.8, 0.14, 2.1, 0.06), mSeat);
  for (const s of [-1, 1]) {
    mk(lounge, RB(0.1, 0.17, 2.0, 0.05), mSeat, s * 0.43, 0.06, 0);                  // side bolsters
    mk(lounge, RB(0.025, 0.025, 1.9, 0.01), gT, s * 0.39, 0.085, 0);                 // teal piping
    mk(lounge, RB(0.1, 0.07, 0.75, 0.03), mDark, s * 0.52, 0.2, 0.15);              // armrest
    mk(lounge, CYL(0.02, 0.16, 8), mMetal, s * 0.52, 0.11, 0.15);
    mk(lounge, RB(0.07, 0.015, 0.2, 0.006), gG, s * 0.52, 0.24, 0.05);              // control pad
    mk(lounge, RB(0.045, 0.4, 0.02, 0.01), mOrange, s * 0.43, -0.2, -0.35);         // loose harness strap
  }
  mk(lounge, RB(0.56, 0.1, 0.45, 0.04), mSeatAcc, 0, 0.1, 0.45);                     // lumbar pad
  mk(lounge, CAP(0.16, 0.38), mSeat, 0, 0.17, 0.92, 0, 0, Math.PI / 2);              // head pillow
  mk(lounge, RB(0.7, 0.06, 0.3, 0.03), mDark, 0, -0.02, -1.15);                      // foot plate
  mk(interior, lathe([[0, 0], [0.55, 0], [0.58, 0.03], [0.55, 0.07], [0.25, 0.12], [0.1, 0.3], [0.08, 0.78], [0, 0.78]], 28), mDark, 0, 0, -2.5);
  mk(interior, RB(0.5, 0.08, 0.9, 0.03), mMetal, 0, 0.8, -2.5, 0, -0.5);             // mount bracket
  mk(interior, CYL(0.03, 0.7, 10), mMetal, 0, 0.45, -3.0, 0, -0.6);                  // hydraulic piston
  mk(interior, RB(1.0, 0.04, 0.55, 0.02), mCableT, 0.9, 0.05, -1.7, 0.4);            // blanket dropped on the floor

  /* =================== BIG SCREEN WALL + CONSOLE (back) =================== */
  const screens = [];
  function makeScreen(parent, x, y, z, ry, w, h, draw, px = 256) {
    const cv = document.createElement('canvas');
    cv.width = px; cv.height = Math.round(px * h / w);
    const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const grp = new THREE.Group();
    grp.position.set(x, y, z); grp.rotation.y = ry;
    parent.add(grp);
    mk(grp, RB(w + 0.1, h + 0.1, 0.06, 0.03), mDark, 0, 0, -0.04);
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
    screens.push({ g, tex, w: cv.width, h: cv.height, draw });
    draw(g, cv.width, cv.height, 0, 0); tex.needsUpdate = true;
    return grp;
  }
  makeScreen(interior, 0, 2.15, -5.62, 0, 3.0, 1.7, drawStorm, 512);
  makeScreen(interior, -2.45, 2.0, -5.0, 0.45, 1.9, 1.1, drawSolar, 384);
  makeScreen(interior, 2.45, 2.0, -5.0, -0.45, 1.9, 1.1, drawComms, 384);
  mk(interior, RB(3.2, 0.03, 0.04, 0.012), gB, 0, 1.24, -5.6);                       // blue under-glow
  for (const x of [-1.5, 1.5]) mk(interior, RB(0.1, 0.5, 0.12, 0.03), mDark, x, 2.15, -5.78);   // mounts

  const DT = 0.99;                                                                     // desk top surface height
  mk(interior, RB(4.4, 0.08, 0.95, 0.04), mMetal, 0, 0.95, -4.35);
  for (const s of [-1, 1]) mk(interior, RB(0.08, 0.92, 0.9, 0.03), mDark, s * 2.15, 0.46, -4.35);
  mk(interior, RB(4.2, 0.7, 0.05, 0.02), mDark, 0, 0.5, -4.78);
  mk(interior, RB(1.0, 0.6, 0.8, 0.04), mDark, -1.5, 0.35, -4.35);                    // drawer unit
  mk(interior, RB(0.3, 0.03, 0.03, 0.012), mMetal, -1.5, 0.45, -3.94);
  makeScreen(interior, -1.2, 1.35, -4.65, 0.2, 0.8, 0.5, drawRadar);
  makeScreen(interior, 1.2, 1.35, -4.65, -0.2, 0.8, 0.5, drawWave);
  for (const x of [-1.2, 1.2]) mk(interior, CYL(0.04, 0.28, 10), mDark, x, 1.12, -4.66);
  const cp = new THREE.Group(); cp.position.set(0, 1.04, -4.08); cp.rotation.x = -0.35; interior.add(cp);   // slanted control panel
  mk(cp, RB(3.0, 0.05, 0.5, 0.02), mDark);
  const btnMats = [gT, gG, gA, gR, gB];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++)
    mk(cp, CYL(0.016, 0.014, 10), btnMats[(r * 3 + c * 2) % 5], -1.2 + c * 0.27, 0.035, -0.15 + r * 0.14);
  for (let i = 0; i < 4; i++) mk(cp, RB(0.05, 0.05, 0.12, 0.012), mMetal, -1.2 + i * 0.12, 0.04, 0.2);
  // desk clutter
  mk(interior, RB(0.45, 0.02, 0.16, 0.008), mDark, -0.2, DT + 0.01, -4.55, 0.1);        // keyboard
  mk(interior, new THREE.PlaneGeometry(0.42, 0.13), new THREE.MeshBasicMaterial({
    map: canvasTex(128, 40, (g, w, h) => {
      g.fillStyle = '#0a1418'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#3bd9c4';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) g.fillRect(3 + c * 8.8, 3 + r * 9, 6, 6);
    }),
  }), -0.2, DT + 0.022, -4.55, 0.1, -Math.PI / 2);
  mk(interior, mugGeo, mPlastic, 1.65, DT, -4.6);
  mk(interior, TOR(0.03, 0.007, 12, Math.PI), mPlastic, 1.7, DT + 0.05, -4.6, 0, 0, -Math.PI / 2);
  mk(interior, RB(0.22, 0.012, 0.16, 0.008), mDark, 0.8, DT + 0.006, -4.5, 0.4);        // tablet
  mk(interior, new THREE.PlaneGeometry(0.19, 0.13), gB, 0.8, DT + 0.013, -4.5, 0.4, -Math.PI / 2);
  mk(interior, potGeo, mCrate, 1.95, DT, -4.8);                                         // desk plant
  for (let i = 0; i < 4; i++) {
    const lf = mk(interior, new THREE.IcosahedronGeometry(0.06, 1), mLeaf, 1.95 + (rand() - 0.5) * 0.08, DT + 0.15 + i * 0.03, -4.8 + (rand() - 0.5) * 0.08);
    lf.scale.set(1, 0.7, 1);
  }
  mk(interior, RB(0.3, 0.05, 0.2, 0.012), mCrate2, -0.9, DT + 0.025, -4.7, -0.2);       // data cases
  mk(interior, RB(0.28, 0.04, 0.2, 0.012), mOrange, -0.88, DT + 0.07, -4.7, 0.3);
  mk(interior, CAP(0.008, 0.12, 6), mDark, -0.55, DT + 0.01, -4.45, 0.6, 0, Math.PI / 2);   // pen
  for (const [x, y, c] of [[-1.4, 2.65, 0xffe066], [1.2, 1.55, 0x7dffa0], [1.45, 2.8, 0xffe066]])
    mk(interior, new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: c }), x, y, -5.55, 0.08 * (x > 0 ? -1 : 1));  // sticky notes
  { // office stool, left at an angle
    const c = new THREE.Group(); c.position.set(-2.4, 0, -2.4); c.rotation.y = 0.7; interior.add(c);
    mk(c, CYL(0.3, 0.05, 6), mDark, 0, 0.06, 0);
    mk(c, CYL(0.035, 0.4, 8), mMetal, 0, 0.28, 0);
    mk(c, RB(0.45, 0.08, 0.45, 0.04), mSeat, 0, 0.52, 0);
  }

  /* =================== LIFE SUPPORT RACK (front right) =================== */
  { const g = onWall(interior, 1.0, 5.62);
    mk(g, RB(3.0, 2.4, 0.1, 0.04), mDark, 0, 1.2, 0);
    [[-1.05, mTankBlue, mCrate], [-0.5, mTankGreen, mOrange], [0.05, mTankYel, mDark]].forEach(([x, mat, band]) => {
      makeTank(g, x, 0.02, 0.38, mat, band);
      for (const y of [0.3, 0.7]) mk(g, TOR(0.205, 0.022, 20), mDark, x, y, 0.38, 0, Math.PI / 2);   // straps
      mk(g, CYL(0.025, 0.55, 8), mMetal, x, 1.28, 0.38);                                              // pipe to manifold
      mk(g, CYL(0.07, 0.03, 18), mDark, x, 1.12, 0.52, 0, Math.PI / 2);                               // gauge
      mk(g, new THREE.CircleGeometry(0.058, 18), gG, x, 1.12, 0.536);
    });
    mk(g, CYL(0.05, 2.8, 12), mMetal, 0, 1.58, 0.38, 0, 0, Math.PI / 2);                               // manifold
    mk(g, RB(1.0, 1.5, 0.5, 0.05), mPlastic, 1.0, 0.75, 0.3);                                          // scrubber
    for (let i = 0; i < 5; i++) mk(g, RB(0.8, 0.03, 0.02, 0.008), mDark, 1.0, 0.9 + i * 0.14, 0.56);
    mk(g, TOR(0.2, 0.02, 20), mDark, 1.0, 0.45, 0.56);
    mk(g, new THREE.CircleGeometry(0.18, 20), mDark, 1.0, 0.45, 0.555);
    for (let i = 0; i < 4; i++) mk(g, RB(0.34, 0.03, 0.01, 0.004), mMetal, 1.0, 0.45, 0.565, 0, 0, i * Math.PI / 4);
    mk(g, new THREE.SphereGeometry(0.03, 8, 8), gG, 1.35, 1.38, 0.56);
    makeScreen(g, 1.0, 1.85, 0.08, 0, 0.8, 0.4, drawWave);
    const tt = makeTank(g, 0.6, 0.2, 1.3, mTankGray, mOrange); tt.rotation.set(0, 0.5, Math.PI / 2);    // toppled tank
    const hp = []; for (let i = 0; i <= 50; i++) { const a = i * 0.38; hp.push(new THREE.Vector3(-0.9 + Math.cos(a) * (0.12 + i * 0.004), 0.04 + i * 0.002, 1.2 + Math.sin(a) * (0.12 + i * 0.004))); }
    mk(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), 120, 0.03, 6), mCableT);               // loose hose coil
  }

  /* =================== HYDROPONICS (green corner, left) =================== */
  const hydroLight = new THREE.PointLight(0x7dff9a, 9, 6.5);
  hydroLight.position.set(Math.sin(-1.75) * 5.0, 1.6, Math.cos(-1.75) * 5.0);
  { const g = onWall(interior, -1.75, 5.62);
    for (const x of [-0.95, 0.95]) for (const z of [0.08, 0.5]) mk(g, CYL(0.03, 2.4, 8), mMetal, x, 1.2, z);
    [0.45, 1.1, 1.75].forEach(y => {
      mk(g, RB(2.0, 0.1, 0.62, 0.04), mPlastic, 0, y, 0.29);
      mk(g, RB(1.8, 0.05, 0.42, 0.02), mSoil, 0, y + 0.06, 0.29);
      for (let i = 0; i < 12; i++) {
        const lf = mk(g, new THREE.IcosahedronGeometry(0.07 + rand() * 0.04, 1), mLeaf,
          -0.8 + i * 0.145 + (rand() - 0.5) * 0.04, y + 0.15 + rand() * 0.05, 0.17 + rand() * 0.24);
        lf.scale.set(1, 0.7 + rand() * 0.5, 0.9);
      }
      mk(g, RB(1.9, 0.035, 0.12, 0.012), gGrow, 0, y + 0.52, 0.29);                // grow-light bar
    });
    mk(g, CYL(0.025, 2.2, 8), mTankBlue, 1.08, 1.2, 0.3);                         // water line
    mk(g, RB(0.3, 0.25, 0.25, 0.04), mDark, 1.08, 0.25, 0.35);                     // pump
  }

  /* =================== SHELVES (back right) =================== */
  { const g = onWall(interior, 2.45, 5.62);
    for (const x of [-0.95, 0.95]) for (const z of [0.1, 0.5]) mk(g, CYL(0.025, 2.2, 8), mMetal, x, 1.1, z);
    for (const y of [0.35, 0.95, 1.55, 2.15]) mk(g, RB(2.0, 0.04, 0.55, 0.015), mMetal, 0, y, 0.3);
    const caseAt = (x, y, w, h, d, mat) => {
      mk(g, RB(w, h, d, 0.05), mat, x, y + 0.02 + h / 2, 0.3, (rand() - 0.5) * 0.3);
      for (const s of [-1, 1]) mk(g, RB(0.07, 0.04, 0.02, 0.01), mDark, x + s * w * 0.28, y + 0.02 + h * 0.6, 0.3 + d / 2);
    };
    caseAt(-0.55, 0.35, 0.6, 0.4, 0.4, mCrate); caseAt(0.15, 0.35, 0.5, 0.35, 0.4, mCrate2); caseAt(0.7, 0.35, 0.35, 0.3, 0.35, mOrange);
    caseAt(-0.6, 0.95, 0.5, 0.3, 0.4, mPlastic); caseAt(0.15, 0.95, 0.6, 0.45, 0.4, mCrate);
    [-0.7, -0.4, -0.1, 0.2, 0.5, 0.8].forEach((x, i) => mk(g, canGeo, i % 2 ? mTankGray : mTankBlue, x, 1.57, 0.3));
    [-0.6, -0.2, 0.2, 0.6].forEach((x, i) => mk(g, canGeo, [mTankGreen, mOrange, mTankYel, mTankGray][i], x, 2.17, 0.3));
    mk(g, RB(0.5, 0.3, 0.4, 0.05), mCrate, 0.45, 0.17, 1.0, 0.7, 0, 0.15);          // fallen crate
  }

  /* =================== LOCKERS + EVA SUIT (back left) =================== */
  { const g = onWall(interior, -2.4, 5.62);
    for (const x of [-0.4, 0.4]) {
      mk(g, RB(0.7, 2.1, 0.5, 0.04), mMetal, x, 1.05, 0.3);
      for (let i = 0; i < 5; i++) mk(g, RB(0.4, 0.02, 0.01, 0.005), mDark, x, 1.85 - i * 0.06, 0.56);
      mk(g, RB(0.04, 0.3, 0.04, 0.012), mDark, x + (x < 0 ? 0.25 : -0.25), 1.0, 0.58);
    }
    const s = new THREE.Group(); s.position.set(1.25, 0, 0.35); g.add(s);
    mk(s, CAP(0.25, 0.55), mSuit, 0, 1.25, 0);
    mk(s, new THREE.SphereGeometry(0.24, 18, 14), mSuit, 0, 1.85, 0);
    const v = mk(s, new THREE.SphereGeometry(0.17, 16, 12), mGold, 0, 1.85, 0.12); v.scale.z = 0.7;
    mk(s, CAP(0.09, 0.5), mSuit, -0.36, 1.2, 0, 0, 0, 0.2);
    mk(s, CAP(0.09, 0.5), mSuit, 0.36, 1.2, 0, 0, 0, -0.2);
    mk(s, CAP(0.11, 0.7), mSuit, -0.14, 0.45, 0);
    mk(s, CAP(0.11, 0.7), mSuit, 0.14, 0.45, 0);
    mk(s, RB(0.4, 0.5, 0.2, 0.05), mMetal, 0, 1.3, -0.25);
    mk(s, RB(0.2, 0.08, 0.3, 0.03), mDark, -0.14, 0.05, 0.05);
    mk(s, RB(0.2, 0.08, 0.3, 0.03), mDark, 0.14, 0.05, 0.05);
  }

  /* =================== GALLEY (front left) =================== */
  { const g = onWall(interior, -1.0, 5.5);
    mk(g, RB(2.2, 0.9, 0.6, 0.04), mPlastic, 0, 0.45, 0.35);
    mk(g, RB(2.3, 0.05, 0.65, 0.02), mMetal, 0, 0.925, 0.35);
    mk(g, RB(0.6, 0.02, 0.4, 0.01), mDark, -0.6, 0.955, 0.35);
    mk(g, CYL(0.015, 0.25, 8), mMetal, -0.6, 1.06, 0.12);
    mk(g, RB(0.6, 0.38, 0.45, 0.05), mDark, 0.55, 1.15, 0.3);
    mk(g, RB(0.45, 0.25, 0.02, 0.01), mGlassX, 0.55, 1.15, 0.53);
    mk(g, mugGeo, mOrange, 0.1, 0.95, 0.5);
    mk(g, mugGeo, mPlastic, 0.2, 0.95, 0.3);
    mk(g, RB(0.18, 0.04, 0.12, 0.015), mCrate, -0.1, 0.97, 0.45, 0.4);
    mk(g, RB(0.18, 0.04, 0.12, 0.015), mTankBlue, 0.0, 0.97, 0.25, -0.3);
    mk(g, RB(2.2, 0.04, 0.3, 0.015), mMetal, 0, 1.75, 0.2);
    for (let i = 0; i < 6; i++) mk(g, canGeo, i % 2 ? mTankYel : mTankGray, -0.8 + i * 0.3, 1.77, 0.2).scale.setScalar(0.7);
  }

  /* =================== WALL DISPLAYS NEAR THE ENTRANCE =================== */
  const panelCv = document.createElement('canvas');
  panelCv.width = 512; panelCv.height = 256;
  const pctx = panelCv.getContext('2d');
  const panelTex = new THREE.CanvasTexture(panelCv);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  function drawPanel(batt) {
    pctx.fillStyle = '#06121a'; pctx.fillRect(0, 0, 512, 256);
    pctx.fillStyle = '#7fe3ff'; pctx.font = 'bold 34px monospace'; pctx.fillText('HABITAT POWER', 24, 56);
    pctx.strokeStyle = '#7fe3ff'; pctx.strokeRect(24, 100, 464, 60);
    pctx.fillStyle = batt < 50 ? '#ff6b4a' : '#5dff9a'; pctx.fillRect(28, 104, 456 * batt / 100, 52);
    pctx.fillStyle = '#7fe3ff'; pctx.fillText(batt + '%', 24, 220);
    panelTex.needsUpdate = true;
  }
  drawPanel(100);
  const leds = [];
  { const g = onWall(interior, -0.62, 5.78);
    mk(g, RB(2.6, 1.3, 0.06, 0.03), mDark, 0, 1.75, 0);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: panelTex, toneMapped: false }));
    face.position.set(0, 1.75, 0.04); g.add(face);
    [gG, gA, gR].forEach((m, i) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), m);
      s.position.set(-0.3 + i * 0.3, 1.03, 0.05); s.userData.keep = true; g.add(s); leds.push(s);
    });
    mk(g, RB(2.4, 0.9, 0.45, 0.05), mDark, 0, 0.45, 0.28);
    for (let i = 0; i < 8; i++) mk(g, CYL(0.025, 0.02, 8), btnMats[i % 5], -0.9 + i * 0.26, 0.91, 0.3);
  }
  { const g = onWall(interior, 0.62, 5.78);
    makeScreen(g, 0, 1.9, 0.03, 0, 1.6, 0.9, drawLog, 384);
    mk(g, RB(1.7, 0.7, 0.4, 0.05), mDark, 0, 0.35, 0.22);
  }

  /* =================== SEALED HATCH TO THE LAB POD (right wall) =================== */
  { const g = onWall(interior, 1.83, 5.84);
    mk(g, CYL(0.75, 0.1, 24), mMetal, 0, 1.1, 0.05, 0, Math.PI / 2);
    mk(g, TOR(0.75, 0.07, 28), mOrange, 0, 1.1, 0.1);
    mk(g, TOR(0.25, 0.03, 18), mDark, 0, 1.1, 0.18);
    for (let i = 0; i < 4; i++) mk(g, RB(0.5, 0.03, 0.03, 0.01), mDark, 0, 1.1, 0.18, 0, 0, (i * Math.PI) / 4);
    mk(g, new THREE.SphereGeometry(0.05, 8, 8), gR, 0.55, 1.75, 0.14);
  }

  /* =================== FLOOR MESS + CABLES =================== */
  (function scatter() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.25, envMap: envTex, envMapIntensity: 0.12 });
    const palette = [0xd8dcd8, 0x2f8f86, 0x2f6fa8, 0xd9a441, 0x5a6870, 0x45b06a, 0xc0452e, 0x9fb0b8];
    const cases = [], bottles = [], cans = [], pads = [];
    for (let tries = 0, n = 0; n < 64 && tries < 1500; tries++) {
      const a = rand() * Math.PI * 2, r = 1.8 + rand() * 3.4;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (Math.abs(x) < 1.3 && z > -4.2 && z < -1.1) continue;     // chair
      if (z < -3.5 && Math.abs(x) < 3.0) continue;                  // desk
      if (Math.abs(x) < 1.0 && z > 1.0) continue;                   // entry lane
      const c = palette[(rand() * palette.length) | 0], k = rand(); n++;
      if (k < 0.25) { const h = 0.1 + rand() * 0.2; cases.push({ x, y: 0.04 + h / 2, z, sx: 0.25 + rand() * 0.3, sy: h, sz: 0.2 + rand() * 0.2, ry: rand() * 6, c }); }
      else if (k < 0.5) bottles.push({ x, y: 0.09, z, sx: 1, sy: 1, sz: 1, ry: rand() * 6, rz: Math.PI / 2, c });
      else if (k < 0.75) cans.push({ x, y: 0.11, z, sx: 1, sy: 1, sz: 1, ry: rand() * 6, c });
      else pads.push({ x, y: 0.05, z, sx: 0.28, sy: 0.02, sz: 0.2, ry: rand() * 6, c });
    }
    const o = new THREE.Object3D(), col = new THREE.Color();
    const inst = (geo, list) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        o.position.set(it.x, it.y, it.z); o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0); o.scale.set(it.sx, it.sy, it.sz); o.updateMatrix();
        im.setMatrixAt(i, o.matrix); im.setColorAt(i, col.setHex(it.c));
      });
      im.receiveShadow = true; im.frustumCulled = false;
      interior.add(im);
    };
    inst(RB(1, 1, 1, 0.15), cases); inst(CAP(0.04, 0.14, 8), bottles); inst(CYL(0.06, 0.14, 12), cans); inst(RB(1, 1, 1, 0.15), pads);
  })();

  const cable = (pts, mat = mCable, r = 0.035) =>
    mk(interior, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 64, r, 6), mat);
  cable([[-1.8, 0.5, -4.8], [-3.0, 0.05, -4.6], [-4.2, 0.05, -3.0], [-5.0, 0.05, -1.5]]);
  cable([[1.6, 0.9, -4.7], [2.4, 0.04, -4.2], [3.3, 0.04, -2.6], [4.6, 0.04, -1.0]], mCableT);
  cable([[0.3, 0.04, -3.6], [0.1, 0.04, -1.5], [0.9, 0.04, 0.5], [2.5, 0.04, 2.0], [4.0, 0.04, 2.8]]);

  /* =================== LIGHTS =================== */
  const alarmBulb = mk(interior, new THREE.SphereGeometry(0.15, 12, 8), gR, 0, 5.3, 3.5);
  alarmBulb.userData.keep = true;
  const alarmLight = new THREE.PointLight(0xff3b30, 0, 9); alarmLight.position.set(0, 5.0, 3.0);
  const screenGlow = new THREE.PointLight(0x58b8ff, 14, 8); screenGlow.position.set(0, 2.0, -3.6);
  habitat.add(alarmLight, screenGlow, hydroLight);

  /* ---------- bake static geometry ---------- */
  mergeStatic(exterior, { cast: true });
  mergeStatic(interior);

  /* ---------- per-frame update ---------- */
  const api = { group: habitat, drawPanel, leds, onDoor: null, update };
  const doorC = new THREE.Vector3(0, 1.6, 7.4);
  let openAmt = 0, lastTgt = 0, acc = 0;
  function update(time, dt, camera, stormT, emerg = 0) {
    // airlock door: opens as the camera approaches, closes once it is inside
    const tgt = (camera.position.z > 4.4 && camera.position.distanceTo(doorC) < 15) ? 1 : 0;
    if (tgt !== lastTgt) { lastTgt = tgt; if (api.onDoor) api.onDoor(!!tgt); }
    openAmt += (tgt - openAmt) * Math.min(1, dt * 2.2);
    doorL.position.x = -0.92 - 1.84 * openAmt;
    doorR.position.x = 0.92 + 1.84 * openAmt;
    doorLamp.material.color.setHex(openAmt > 0.5 ? 0x5dff9a : 0xff3b30);

    mastTip.visible = Math.sin(time * 2.5) > 0;

    const pulse = Math.sin(time * 5) > 0;            // hard on/off blink
    const soft = 0.5 + 0.5 * Math.sin(time * 5);     // smooth breathing
    const alarm = emerg > 0.05;
    leds[2].visible = alarm ? Math.sin(time * 6) > 0 : true;
    alarmBulb.visible = alarm && pulse;

    // sweeping red beacon
    alarmLight.position.set(Math.sin(time * 3) * 3.5, 5.0, Math.cos(time * 3) * 3.5);
    alarmLight.intensity = emerg * (pulse ? 45 : 10);

    // every room light shifts from teal/green/blue to red
    screenGlow.color.copy(base.sg).lerp(RED, emerg);
    screenGlow.intensity = 14 * (1 - stormT * 0.35 + (Math.random() - 0.5) * 0.2 * stormT) * (1 + emerg * (soft - 0.5));
    hydroLight.color.copy(base.hy).lerp(RED, emerg);
    hydroLight.intensity = 9 * (1 - stormT * 0.5);
    gT.color.copy(base.gT).lerp(REDGLOW, emerg);
    gG.color.copy(base.gG).lerp(REDGLOW, emerg);
    gB.color.copy(base.gB).lerp(REDGLOW, emerg);
    mCeil.color.copy(ceilBase).lerp(REDGLOW, emerg * 0.9)
      .multiplyScalar((1 - stormT * 0.45 * (0.6 + 0.4 * Math.random())) * (1 - emerg * 0.35 * (1 - soft)));

    acc += dt;                                       // monitors refresh ~4 fps, only when near
    if (acc > 0.25 && camera.position.lengthSq() < 900) {
      acc = 0;
      for (const s of screens) {
        s.draw(s.g, s.w, s.h, time, stormT);
        if (emerg > 0.05) {                          // flashing red frame on every monitor
          s.g.fillStyle = `rgba(255,30,20,${(pulse ? 0.22 : 0.08) * emerg})`;
          s.g.fillRect(0, 0, s.w, s.h);
          s.g.strokeStyle = pulse ? '#ff3b30' : '#7a1a14';
          s.g.lineWidth = Math.max(3, s.w / 64);
          s.g.strokeRect(0, 0, s.w, s.h);
        }
        s.tex.needsUpdate = true;
      }
    }
  }
  return api;
}
