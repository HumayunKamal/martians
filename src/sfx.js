// Procedural sound effects using the Web Audio API. No audio files needed.
// Browsers only allow audio after a click, so main.js calls init() from the Start button.

let ac = null, master = null, whiteBuf = null, ready = false, muted = false;
const wind = {}, rumble = {}, hum = {};

function makeWhite(seconds = 2) {
  const len = ac.sampleRate * seconds;
  const b = ac.createBuffer(1, len, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function makeBrown(seconds = 4) {
  const len = ac.sampleRate * seconds;
  const b = ac.createBuffer(1, len, ac.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return b;
}

function loopSource(buf) {
  const s = ac.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start();
  return s;
}

export function init() {
  if (ready) { if (ac.state === 'suspended') ac.resume(); return; }
  ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();

  master = ac.createGain();
  master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ac.destination);

  whiteBuf = makeWhite(2);
  const brown = makeBrown(4);

  // Wind: band-passed brown noise with slow gusts
  wind.filter = ac.createBiquadFilter();
  wind.filter.type = 'bandpass';
  wind.filter.frequency.value = 450;
  wind.filter.Q.value = 0.6;
  wind.gain = ac.createGain();
  wind.gain.gain.value = 0;
  loopSource(brown).connect(wind.filter);
  wind.filter.connect(wind.gain);
  wind.gain.connect(master);

  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 140;
  lfo.connect(lfoGain);
  lfoGain.connect(wind.filter.frequency);
  lfo.start();

  // Storm rumble: low-passed brown noise
  rumble.filter = ac.createBiquadFilter();
  rumble.filter.type = 'lowpass';
  rumble.filter.frequency.value = 110;
  rumble.gain = ac.createGain();
  rumble.gain.gain.value = 0;
  loopSource(brown).connect(rumble.filter);
  rumble.filter.connect(rumble.gain);
  rumble.gain.connect(master);

  // Habitat hum (life support)
  hum.filter = ac.createBiquadFilter();
  hum.filter.type = 'lowpass';
  hum.filter.frequency.value = 170;
  hum.gain = ac.createGain();
  hum.gain.gain.value = 0;
  const o1 = ac.createOscillator();
  o1.type = 'sawtooth';
  o1.frequency.value = 55;
  const o2 = ac.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = 110.4;
  o1.connect(hum.filter);
  o2.connect(hum.filter);
  hum.filter.connect(hum.gain);
  hum.gain.connect(master);
  o1.start();
  o2.start();

  ready = true;
}

// Called ~10x per second. storm: 0..1, inside: 0 (outdoors) .. 1 (inside the habitat)
export function update(storm, inside) {
  if (!ready) return;
  const t = ac.currentTime;
  wind.gain.gain.setTargetAtTime((0.1 + storm * 0.5) * (1 - inside * 0.75), t, 0.3);
  wind.filter.frequency.setTargetAtTime(380 + storm * 650 - inside * 180, t, 0.3);
  rumble.gain.gain.setTargetAtTime(storm * 0.4 * (1 - inside * 0.4), t, 0.4);
  hum.gain.gain.setTargetAtTime(0.012 + inside * 0.05, t, 0.5);
}

export function toggleMute() {
  muted = !muted;
  if (ready) master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.05);
  return muted;
}

/* ---------- one-shot helpers ---------- */
function tone({ f = 440, f2 = null, dur = 0.15, type = 'sine', vol = 0.2, delay = 0 }) {
  if (!ready) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function burst({ dur = 0.2, f = 2000, f2 = null, q = 1, vol = 0.3, type = 'bandpass', delay = 0 }) {
  if (!ready) return;
  const t = ac.currentTime + delay;
  const s = ac.createBufferSource();
  s.buffer = whiteBuf;
  const fl = ac.createBiquadFilter();
  fl.type = type;
  fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl);
  fl.connect(g);
  g.connect(master);
  s.start(t, Math.random() * 1.5, dur + 0.05);
}

/* ---------- named sound effects ---------- */
export const ping = () => {                      // new location label appears
  tone({ f: 880, dur: 0.25, vol: 0.09 });
  tone({ f: 1320, dur: 0.35, vol: 0.07, delay: 0.09 });
};
export const whoosh = () => burst({ dur: 1.6, f: 250, f2: 3000, q: 0.8, vol: 0.35 });   // mission start
export const beacon = (v = 1) => tone({ f: 1250, dur: 0.07, type: 'square', vol: 0.05 * v });
export const click = () => tone({ f: 900, f2: 400, dur: 0.06, type: 'triangle', vol: 0.18 });
export const tick = () => tone({ f: 1000, dur: 0.05, vol: 0.12 });
export const tickUrgent = () => tone({ f: 760, dur: 0.12, type: 'square', vol: 0.12 });
export const confirm = () => {
  tone({ f: 520, dur: 0.12, vol: 0.15 });
  tone({ f: 780, dur: 0.2, vol: 0.15, delay: 0.1 });
};
export const zap = () => {                       // electrical flicker
  burst({ dur: 0.12, f: 3500, type: 'highpass', q: 0.7, vol: 0.3 });
  tone({ f: 120, f2: 40, dur: 0.18, type: 'sawtooth', vol: 0.15 });
};
export const thud = () => {                      // storm hits
  tone({ f: 70, f2: 28, dur: 0.9, vol: 0.45 });
  burst({ dur: 0.8, f: 400, type: 'lowpass', q: 0.5, vol: 0.4 });
};
export const alarm = (n = 6) => {
  for (let i = 0; i < n; i++) {
    tone({ f: 880, dur: 0.18, type: 'square', vol: 0.06, delay: i * 0.42 });
    tone({ f: 660, dur: 0.18, type: 'square', vol: 0.06, delay: i * 0.42 + 0.21 });
  }
};
