import gsap from 'gsap';

export const mission = {
  loaded: false,
  error: null,
  active: false,
  done: false,
  meta: null,
  days: [],
  events: [],
  map: null,
  idx: 0,
  day: null,
  tau: 0,        // 880 nm, measured by Curiosity
  tau440: null,  // 440 nm, measured by Curiosity
  globalDust: null,
  galeDust: null,
  solarPct: 100,
  seen: [],
};

export async function loadMission() {
  mission.loaded = false;
  mission.error = null;
  mission.days = [];
  mission.map = null;

  try {
    const r = await fetch('/data/storm2018.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);

    const j = await r.json();
    if (!Array.isArray(j.days) || j.days.length === 0) {
      throw new Error('The JSON file has no daily records.');
    }

    j.days.forEach((d, i) => {
      if (typeof d.tau !== 'number' || !Number.isFinite(d.tau) || d.tau < 0) {
        throw new Error(`Invalid tau value in daily record ${i + 1}`);
      }
    });

    mission.meta = j.meta || null;
    mission.days = j.days;
    mission.events = j.events || [];
    mission.map = j.map || null;
    mission.loaded = true;

    console.log('Mission data loaded:', mission.days.length, 'sols',
      mission.days[0].sol, '-', mission.days[mission.days.length - 1].sol);
  } catch (e) {
    mission.error = String(e);
    mission.loaded = false;
    console.error('NASA mission data could not be loaded:', e);
  }
}

export function startReplay({ onTick, onDone, secondsPerSol = 1.2 } = {}) {
  if (!mission.loaded || mission.days.length === 0) {
    console.warn('Mission data is not loaded yet.');
    return;
  }

  const n = mission.days.length;
  const p = { i: 0 };
  let last = -1;

  mission.active = true;
  mission.done = false;

  const step = () => {
    const i = Math.min(n - 1, Math.floor(p.i));
    if (i === last) return;
    last = i;

    const d = mission.days[i];
    mission.idx = i;
    mission.day = d;
    mission.tau = d.tau;
    mission.tau440 = d.tau440 ?? null;
    mission.globalDust = d.globalDust ?? null;
    mission.galeDust = d.galeDust ?? null;

    // Direct sunlight reaching the surface for this optical depth.
    mission.solarPct = 100 * Math.exp(-d.tau);

    mission.seen = mission.days.slice(0, i + 1);

    if (onTick) onTick(mission);
  };

  gsap.to(p, {
    i: n - 1,
    duration: Math.max(0.1, (n - 1) * secondsPerSol),
    ease: 'none',
    onUpdate: step,
    onComplete: () => {
      step();
      mission.done = true;
      mission.active = false;
      if (onDone) onDone(mission);
    },
  });

  step(); // show the first measurement immediately
}