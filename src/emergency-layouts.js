/* emergency-layouts.js
   Alternative "messy but simple" looks for the emergency UI.
   It only restyles the elements main.js already creates
   (#emVig #emBanner #emGuide #emExplain #emConsole), so no game logic changes.

   Layouts:  'tape'      hazard tape + taped paper note + chunky yellow console
             'scatter'   tilted, glitchy screens + console as a bottom bar
             'terminal'  amber log on the left, full-height console drawer, scrolling ticker
             'classic'   your current look

   Usage in main.js (top, with the other imports):
       import { initLayouts } from './emergency-layouts.js';
   and once, anywhere near the end of the file:
       initLayouts('tape');
   Try them live:  press L to cycle, or open the page with ?layout=scatter                      */

const LAYOUTS = ['tape', 'scatter', 'terminal', 'classic'];

const CSS = `
/* shared: jitter + glitch used by all the messy layouts */
@keyframes emJit   { 0%,100% { translate: 0 0 } 20% { translate: 1px -1px } 40% { translate: -2px 1px } 60% { translate: 2px 2px } 80% { translate: -1px -2px } }
@keyframes emGlitch{ 0%,92%,100% { transform: translate(0,0) skewX(0) } 93% { transform: translate(-6px,1px) skewX(-8deg) } 96% { transform: translate(5px,-1px) skewX(6deg) } }
@keyframes emTick  { from { transform: translateX(0) } to { transform: translateX(-50%) } }

#emTicker { display:none; }

/* =========================================================
   A) TAPE: hazard-tape banner, taped paper note, chunky console
   ========================================================= */
body.emL-tape #emBanner {
  top:0; left:0; right:0; width:auto; transform:none; border:0; border-radius:0; padding:12px 0 14px;
  background: repeating-linear-gradient(-45deg, #ffd400 0 24px, #111 24px 48px);
  box-shadow: 0 6px 0 #000, 0 10px 30px rgba(0,0,0,.6);
}
body.emL-tape #emBanner b {
  display:block; width:fit-content; margin:0 auto; padding:2px 22px; font-size:28px;
  background:#111; color:#ffd400; animation: emBlink 1s steps(1) infinite, emGlitch 3.5s infinite;
}
body.emL-tape #emBanner span {
  display:block; width:fit-content; margin:6px auto 0; padding:3px 14px; background:#111; color:#fff; font-size:13px;
}

body.emL-tape #emGuide {
  top:20%; left:22px; width:min(290px,38vw); transform:rotate(-2.4deg);
  background:#f2e6c4; color:#2a1a0a; border:0; border-radius:2px; font-family:'Courier New',monospace;
  box-shadow: 6px 8px 0 rgba(0,0,0,.45); padding:22px 16px 14px;
}
body.emL-tape #emGuide::before {
  content:''; position:absolute; top:-12px; left:50%; width:96px; height:26px; transform:translateX(-50%) rotate(3deg);
  background:rgba(255,230,120,.75); box-shadow:0 1px 3px rgba(0,0,0,.4);
}
body.emL-tape #emGuide b { color:#b00000; text-decoration:underline wavy #b00000; text-underline-offset:3px; }
body.emL-tape #emGuide .sun { color:#2a1a0a; border-top:2px dashed #b00000; font-weight:bold; }

body.emL-tape #emExplain {
  bottom:5%; border:0; border-radius:0; background:#111; color:#ffd400; transform:translateX(-50%) rotate(.8deg);
  border-left:10px solid #ffd400; text-align:left; box-shadow:5px 5px 0 #000;
}
body.emL-tape #emExplain b { color:#fff; }

body.emL-tape #emConsole {
  top:19%; right:18px; border:3px solid #ffd400; border-radius:0; background:#0b0b0b; color:#fff; transform:rotate(1.2deg);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 22px), calc(100% - 22px) 100%, 0 100%);
  box-shadow:none; animation: emSlide .5s ease-out;
}
body.emL-tape #emConsole h3 { color:#ffd400; background:#000; margin:-14px -16px 10px; padding:10px 16px; letter-spacing:.2em; }
body.emL-tape #emConsole .row { color:#ffd400; }
body.emL-tape #emConsole .opt {
  border:0; border-left:8px solid #ffd400; border-radius:0; background:#1a1a1a; color:#fff; text-transform:uppercase; letter-spacing:.06em;
}
body.emL-tape #emConsole .opt:nth-child(odd)  { transform:rotate(-.5deg); }
body.emL-tape #emConsole .opt:nth-child(even) { transform:rotate(.4deg) translateX(4px); }
body.emL-tape #emConsole .opt:hover { background:#2a2400; }
body.emL-tape #emConsole .opt.sel   { background:#ffd400; color:#000; border-left-color:#ff2418; }
body.emL-tape #emConsole .info { background:#000; border-left:4px solid #ff2418; }
body.emL-tape #emConsole .go { background:#ffd400; color:#000; border-radius:0; letter-spacing:.3em; }

/* =========================================================
   B) SCATTER: tilted glitchy screens, console as a bottom bar
   ========================================================= */
body.emL-scatter #emBanner {
  top:14px; left:14px; transform:rotate(-2deg); text-align:left; border-radius:0; border:0; background:#e0120a; padding:8px 20px;
  box-shadow:6px 6px 0 #000; animation: emGlitch 4s infinite;
}
body.emL-scatter #emBanner b { font-size:24px; }

body.emL-scatter #emGuide {
  top:30%; left:14px; width:min(270px,36vw); transform:rotate(1.6deg); border-radius:0; border:2px solid #ff4a3a;
  background:repeating-linear-gradient(0deg, rgba(0,0,0,.55) 0 2px, rgba(40,0,0,.55) 2px 4px);
  box-shadow:-6px 6px 0 rgba(0,0,0,.6); animation: emJit .35s steps(2) infinite;
}
body.emL-scatter #emExplain {
  bottom:auto; top:14px; left:auto; right:14px; transform:rotate(1.4deg); text-align:left; width:min(330px,40vw); border-radius:0;
  background:rgba(0,0,0,.85); border:2px dashed #4ff0d8;
}
body.emL-scatter #emConsole {
  top:auto; bottom:0; left:0; right:0; width:auto; max-height:44vh; border-radius:0; border:0; border-top:4px solid #4ff0d8;
  background:rgba(2,10,14,.95); animation: emSlide .5s ease-out;
}
body.emL-scatter #emConsole #emOpts { display:flex; flex-wrap:wrap; gap:8px; }
body.emL-scatter #emConsole .opt { flex:1 1 30%; margin:0; text-align:center; border-radius:0; }
body.emL-scatter #emConsole .opt:nth-child(odd)  { transform:rotate(-.6deg); }
body.emL-scatter #emConsole .opt:nth-child(even) { transform:rotate(.6deg); }
body.emL-scatter #emConsole .go { border-radius:0; }

/* =========================================================
   C) TERMINAL: amber log on the left, console drawer, ticker
   ========================================================= */
body.emL-terminal #emBanner {
  top:0; left:0; transform:none; text-align:left; border-radius:0; border:0; border-left:12px solid #ffb000; background:rgba(0,0,0,.88);
  color:#ffb000; padding:10px 24px 10px 16px; letter-spacing:.1em;
}
body.emL-terminal #emBanner b { font-size:22px; }
body.emL-terminal #emBanner b::before { content:'!! '; }

body.emL-terminal #emGuide {
  top:16%; left:0; width:min(320px,42vw); border:0; border-radius:0; border-left:12px solid #ffb000; background:rgba(0,0,0,.82); color:#ffb000;
}
body.emL-terminal #emGuide ol { list-style:none; padding-left:0; }
body.emL-terminal #emGuide li::before { content:'> '; }
body.emL-terminal #emGuide b { color:#fff; }
body.emL-terminal #emGuide .sun { color:#ffb000; border-top:1px solid #ffb000; }

body.emL-terminal #emExplain {
  left:0; bottom:44px; transform:none; text-align:left; border-radius:0; border:0; border-left:12px solid #4ff0d8; width:min(520px,60vw);
}
body.emL-terminal #emConsole {
  top:0; bottom:0; right:0; width:min(390px,46vw); max-height:none; border-radius:0; border:0; border-left:6px solid #ffb000;
  background:rgba(0,0,0,.94); color:#ffb000; padding-top:60px; animation: emSlide .5s ease-out;
}
body.emL-terminal #emConsole h3 { color:#fff; }
body.emL-terminal #emConsole .row { color:#ffb000; }
body.emL-terminal #emConsole .opt { color:#ffb000; border:1px solid #ffb000; border-radius:0; background:transparent; }
body.emL-terminal #emConsole .opt:hover { background:rgba(255,176,0,.15); }
body.emL-terminal #emConsole .opt.sel { background:#ffb000; color:#000; }
body.emL-terminal #emConsole .info { border-left-color:#ffb000; }
body.emL-terminal #emConsole .go { background:#ffb000; border-radius:0; }

#emTicker {
  position:fixed; left:0; right:0; bottom:0; z-index:98; overflow:hidden; white-space:nowrap; pointer-events:none;
  background:#ffb000; color:#000; font:bold 14px monospace; padding:6px 0; letter-spacing:.2em;
}
#emTicker span { display:inline-block; animation: emTick 14s linear infinite; }
body.emL-terminal #emBanner[style*="display: block"] ~ #emTicker { display:block; }

@media (max-width:700px) {
  body.emL-scatter #emConsole #emOpts .opt { flex-basis:46%; }
  body.emL-terminal #emConsole { width:56vw; }
}
`;

let styleEl = null;
let current = 'classic';

export function applyLayout(name) {
  if (!LAYOUTS.includes(name)) name = 'tape';
  current = name;

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    // ticker for the terminal layout (shown only while the alarm banner is visible)
    const t = document.createElement('div');
    t.id = 'emTicker';
    const msg = '⚠ DUST STORM ⚠ POWER LOW ⚠ STAY INSIDE ⚠ SAVE POWER ⚠ CHOOSE NOW ';
    t.innerHTML = `<span>${msg.repeat(6)}</span>`;
    document.body.appendChild(t);
  }

  LAYOUTS.forEach(l => document.body.classList.remove('emL-' + l));
  if (name !== 'classic') document.body.classList.add('emL-' + name);
}

export function initLayouts(def = 'tape') {
  const fromUrl = new URLSearchParams(location.search).get('layout');
  applyLayout(fromUrl || def);

  addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'l') return;
    applyLayout(LAYOUTS[(LAYOUTS.indexOf(current) + 1) % LAYOUTS.length]);
  });
}
