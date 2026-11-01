// game.js  (v3 - HD rendering, bigger world, varied track, 5 themes, tuned corner drifting)

/* ============================ A. HOW TO MODIFY ============================
 * Zoom / UI size / camera / quality defaults -> B. CONFIG and B1. QUALITY
 * Drift handling (grip, steering)            -> B2. PHYSICS
 * Cars + unlock scores                       -> C. CARS
 * Difficulty tiers + track section weights   -> D. LEVELS
 * Visual themes (colours, pattern, scenery)  -> D2. THEMES
 * Cheats / debug / hooks                     -> E. MODS & HOOKS
 * Controls: hold mouse/touch/Space/ArrowUp = steer RIGHT (+u); release = steer LEFT (+v).
 * P/Esc pause, M mute, Q graphics quality, Left/Right arrows change car (start screen).
 * ======================================================================== */

/* ================================ B. CONFIG ============================== */
const CONFIG = {
  title: "DRIFT CLONE", startText: "TAP TO START", retryText: "TAP TO RETRY",
  tilesAcross: 8,         // world zoom: tiles across min(width, 0.75*height). Smaller = bigger car/road (6-12)
  uiScale: 1.25,          // overall interface size multiplier (0.8-1.6)
  thickness: 0.9,         // road slab depth (tiles)
  fallTime: 1.0, edgeForgiveness: 0, firstSegment: 8,
  lookAhead: 45, lookBehind: 22,
  speedEase: 3, cameraEase: 6, bgEase: 3,
  fixedStep: 1 / 120, maxFrame: 0.1, retryDelay: 0.4,
  carScreenY: 0.68,       // car vertical screen position (fraction of height)
  themeLength: 100,       // tiles travelled per visual theme
  themeBlend: 30,         // tiles over which one theme cross-fades into the next
  minSegmentWidthRatio: 1.3, // shortest allowed straight = roadWidth * this (fairness floor)
  minSegmentSpeedTime: 0.45, // ...or speed * this many seconds, whichever is larger
  defaultQuality: 2,      // index into QUALITY (0 LOW .. 3 ULTRA)
  dynamicResolution: true,// lower render scale automatically if FPS drops
  storageKey: "driftclone.save"
};

/* ============================ B1. QUALITY PRESETS ========================= */
// dprCap = max device-pixel-ratio used; maxPixels = max canvas pixels (8.9M allows 3840x2160).
const QUALITY = [
  { name: "LOW",    dprCap: 1,   maxPixels: 1.3e6, glow: false, soft: false, smoke: 0.5, scenery: false },
  { name: "MEDIUM", dprCap: 1.5, maxPixels: 3.7e6, glow: false, soft: true,  smoke: 1,   scenery: true },
  { name: "HIGH",   dprCap: 2,   maxPixels: 5.5e6, glow: true,  soft: true,  smoke: 1,   scenery: true },
  { name: "ULTRA",  dprCap: 3,   maxPixels: 8.9e6, glow: true,  soft: true,  smoke: 2,   scenery: true }
];

/* =============================== B2. PHYSICS ============================== */
// Heading = damped spring toward the steer target. Velocity chases the heading with limited grip.
// The velocity lag is what makes the car overshoot a corner if you turn late (slides wide)
// and carve across the corner if you turn early (cuts inside). Lower lateralGrip = bigger slides.
const PHYSICS = {
  steerStiffness: 140, steerDamping: 20, maxTurnRate: 9,
  lateralGrip: 6.5,        // 1/s. Slide length ~ speed / lateralGrip tiles (3 = icy, 12 = on rails)
  driftSkidAngle: 0.10, driftSmokeAngle: 0.30, // slip angles (rad) for tyre marks / smoke
  bodyRoll: 0.35, gravity: 22, airDrag: 0.4
};

/* ================================= C. CARS ================================ */
const CARS = [
  { name: "Red Racer", bodyColor: "#e63946", roofColor: "#f1faee", length: 1.0, width: 0.6,  unlockScore: 0 },
  { name: "Blue Bolt", bodyColor: "#3a86ff", roofColor: "#caf0f8", length: 1.1, width: 0.6,  unlockScore: 60 },
  { name: "Lime Dart", bodyColor: "#80ed99", roofColor: "#22577a", length: 0.9, width: 0.55, unlockScore: 150 },
  { name: "Gold Rush", bodyColor: "#ffbe0b", roofColor: "#3d405b", length: 1.0, width: 0.65, unlockScore: 300 }
];
const SELECTED_CAR = 0;

/* ================================ D. LEVELS =============================== */
// Difficulty tiers (by tiles travelled). mix = relative weights of each track section type.
// Section types: straight, long, zigzag, wide, narrow (see F3).
const LEVELS = [
  { name: "Warm-up", startScore: 0,   roadWidth: 2.4, segMin: 3,   segMax: 9, speed: 3.5, mix: { straight: 3, long: 3, zigzag: 0, wide: 2, narrow: 0 } },
  { name: "Cruise",  startScore: 40,  roadWidth: 2.1, segMin: 2.5, segMax: 7, speed: 4.5, mix: { straight: 3, long: 2, zigzag: 1, wide: 1, narrow: 1 } },
  { name: "Hustle",  startScore: 120, roadWidth: 1.9, segMin: 2,   segMax: 6, speed: 5.5, mix: { straight: 2, long: 1, zigzag: 3, wide: 1, narrow: 2 } },
  { name: "Insane",  startScore: 250, roadWidth: 1.7, segMin: 1.8, segMax: 5, speed: 6.5, mix: { straight: 1, long: 1, zigzag: 4, wide: 0, narrow: 3 } }
];
const SECTION_WIDTH = { straight: 1, long: 1, zigzag: 1, wide: 1.3, narrow: 0.8 }; // width multipliers

/* ================================ D2. THEMES ============================== */
// Original themes. pattern: "stripes" or "checker". scenery: sun | clouds | stars. glow: neon road edges.
const THEMES = [
  { name: "Classic Arcade", bgTop: "#ff7a18", bgBottom: "#ffc371", tileA: "#2fbf71", tileB: "#f4fff8", side: "#1d7a49", edge: "#ffffff", pattern: "stripes", scenery: "sun",    glow: false },
  { name: "Sky World",      bgTop: "#3b9cff", bgBottom: "#c9ecff", tileA: "#e8f6ff", tileB: "#9fd2ff", side: "#4f8fd0", edge: "#ffffff", pattern: "checker", scenery: "clouds", glow: false },
  { name: "Neon World",     bgTop: "#07001a", bgBottom: "#35107a", tileA: "#1a1240", tileB: "#2c1b70", side: "#150b3a", edge: "#00f5ff", pattern: "checker", scenery: "stars",  glow: true },
  { name: "Sunset World",   bgTop: "#6a2cf0", bgBottom: "#ff9a3c", tileA: "#ffb36b", tileB: "#ff7e5f", side: "#8e3b6b", edge: "#fff1c9", pattern: "stripes", scenery: "sun",    glow: false },
  { name: "Night World",    bgTop: "#02030f", bgBottom: "#142044", tileA: "#59678a", tileB: "#8fa0c2", side: "#2a3350", edge: "#cfd8ff", pattern: "checker", scenery: "stars",  glow: false }
];

/* ============================= E. MODS & HOOKS ============================ */
const MODS = { godMode: false, scoreMultiplier: 1, timeScale: 1, skidMarks: true, skidLife: 1.8, showDebug: false };
function onStart() {}
function onTurn(dir) {}
function onScore(n) {}
function onLevelChange(level) {}
function onGameOver(score) {}

/* ======================= F1. STATE, UTILITIES, STORAGE ==================== */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false }); // opaque canvas = faster compositing
const HALF_PI = Math.PI / 2;
const view = { s: 60, ox: 0, oy: 0 };
const bg = { top: [0, 0, 0], bot: [0, 0, 0] };
const input = { ptrs: new Set(), space: false, held: false, ignore: false };
let W = 0, H = 0, dpr = 1, ui = 1, dynScale = 1, slowTime = 0, fastTime = 0;
let state = "START";   // START | PLAYING | PAUSED | FALLING | GAME_OVER
let carIdx = SELECTED_CAR % CARS.length;
let car, segs, parts, pending, level, score = 0, fallT = 0;
let clock = 0, overAt = 0, fps = 60, last = 0, accumulator = 0, buttons = [], camU = 0, camV = 0;
const save = { best: 0, car: carIdx, sound: true, quality: CONFIG.defaultQuality };

function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgb(a) { return "rgb(" + a.map(Math.round).join(",") + ")"; }
function shade(c, f) { return rgb(c.map(x => x * f)); }
function getLevelIndex(tiles) { for (let i = LEVELS.length - 1; i > 0; i--) if (tiles >= LEVELS[i].startScore) return i; return 0; }
function getLevel(tiles) { return LEVELS[getLevelIndex(tiles)]; }
function isUnlocked(i) { return save.best >= CARS[i].unlockScore; }
function loadSave() { // tolerant of missing, corrupt or old-format data
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG.storageKey) || localStorage.getItem("driftclone.best") || "null");
    if (typeof raw === "number") save.best = raw | 0;
    else if (raw && typeof raw === "object") {
      save.best = Math.max(0, raw.best | 0); save.sound = raw.sound !== false;
      if (raw.car >= 0 && raw.car < CARS.length) save.car = raw.car | 0;
      if (raw.quality >= 0 && raw.quality < QUALITY.length) save.quality = raw.quality | 0;
    }
  } catch (e) {}
  carIdx = isUnlocked(save.car) ? save.car : 0;
}
function writeSave() { try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(save)); } catch (e) {} }

/* ================================ F2. AUDIO =============================== */
let audioCtx = null;
function beep(freq, dur, type, vol, slideTo) {
  if (!save.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
    o.type = type || "square"; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur);
  } catch (e) {}
}
function toggleSound() { save.sound = !save.sound; writeSave(); beep(660, 0.08); }

/* ================================ F2b. THEMES ============================= */
// themeAt(distance) cross-fades palette colours between consecutive themes over CONFIG.themeBlend tiles.
const PAL_KEYS = ["bgTop", "bgBottom", "tileA", "tileB", "side", "edge"];
THEMES.forEach(t => { t.rgb = {}; PAL_KEYS.forEach(k => t.rgb[k] = hex(t[k])); });
function themeAt(dist) {
  const L = CONFIG.themeLength, B = CONFIG.themeBlend, n = THEMES.length;
  const i = Math.floor(dist / L) % n, f = dist % L, t = clamp((f - (L - B)) / B, 0, 1);
  const A = THEMES[i], N = THEMES[(i + 1) % n], pal = {};
  PAL_KEYS.forEach(k => pal[k] = A.rgb[k].map((c, j) => c + (N.rgb[k][j] - c) * t));
  return { a: A, b: N, t, pal, main: t < 0.5 ? A : N };
}

/* =========================== F3. TRACK GENERATOR ========================== */
// Road = chain of rectangles in (u,v) space; even segments run +u (RIGHT), odd run +v (LEFT).
// The generator queues "sections" (small recipes) chosen by tier weights, so layouts vary:
//   straight: one medium run | long: one long run | zigzag: 3-6 shortest legal runs
//   wide / narrow: 2-3 runs with 1.3x / 0.8x road width.
// FAIRNESS: every run is at least max(width * minSegmentWidthRatio, speed * minSegmentSpeedTime)
// so a corner never arrives faster than the steering + grip response (~speed/lateralGrip) allows.
function pickSection(lv) {
  const keys = Object.keys(lv.mix), total = keys.reduce((s, k) => s + lv.mix[k], 0);
  let r = Math.random() * total;
  for (const k of keys) { r -= lv.mix[k]; if (r < 0) return k; }
  return "straight";
}
function buildSection(kind, lv) { // returns [{len, wMul}]
  const n = kind === "zigzag" ? 3 + Math.floor(Math.random() * 4) : kind === "wide" || kind === "narrow" ? 2 + Math.floor(Math.random() * 2) : 1;
  const list = [];
  for (let i = 0; i < n; i++) {
    const len = kind === "long" ? rand(lv.segMax, lv.segMax * 1.6) : kind === "zigzag" ? 0 : rand(lv.segMin, lv.segMax);
    list.push({ len, wMul: SECTION_WIDTH[kind] });
  }
  return list;
}
function addSegment() {
  const p = segs[segs.length - 1];
  const dir = p ? 1 - p.dir : 1;
  const u0 = p ? p.endU : 0, v0 = p ? p.endV : 0, dist = Math.floor(u0 + v0);
  const lv = getLevel(dist);
  let len = CONFIG.firstSegment, wMul = 1;
  if (p) {
    if (!pending.length) pending = buildSection(pickSection(lv), lv);
    const piece = pending.shift(); len = piece.len; wMul = piece.wMul;
  }
  const w = lv.roadWidth * wMul;
  if (p) len = Math.max(len, w * CONFIG.minSegmentWidthRatio, lv.speed * CONFIG.minSegmentSpeedTime);
  const h = w / 2, endU = u0 + (dir === 0 ? len : 0), endV = v0 + (dir === 1 ? len : 0);
  const th = themeAt(dist), pal = th.pal;
  segs.push({
    dir, w, endU, endV, minU: u0 - h, maxU: endU + h, minV: v0 - h, maxV: endV + h,
    pattern: th.main.pattern, glow: th.main.glow,
    colors: { tileA: rgb(pal.tileA), tileB: rgb(pal.tileB), edge: rgb(pal.edge),
      sideA0: shade(pal.side, 0.8), sideA1: shade(pal.side, 0.45), sideB0: shade(pal.side, 1.05), sideB1: shade(pal.side, 0.62) }
  });
}
function updateTrack() {
  const p = car.u + car.v;
  let l = segs[segs.length - 1];
  while (l.endU + l.endV < p + CONFIG.lookAhead) { addSegment(); l = segs[segs.length - 1]; }
  while (segs.length > 2 && segs[0].endU + segs[0].endV + segs[0].w < p - CONFIG.lookBehind) segs.shift();
}
// Collision uses the SAME rectangles that are drawn, so the visible road and the support area always match.
// Adjacent rectangles overlap by a full corner square, so junctions have no gaps and no dead zones.
function onRoad(u, v) {
  const e = CONFIG.edgeForgiveness;
  for (let i = 0; i < segs.length; i++) { const s = segs[i]; if (u >= s.minU - e && u <= s.maxU + e && v >= s.minV - e && v <= s.maxV + e) return true; }
  return false;
}

/* ===================== F4. STATE MACHINE (start/pause/over) =============== */
function reset() {
  segs = []; parts = []; pending = []; addSegment();
  level = getLevel(0);
  const sp = level.speed;
  car = { u: 0, v: 0, h: 0, vh: 0, dir: 1, ang: HALF_PI, angVel: 0, vu: 0, vv: sp, speed: sp, tilt: 0, tdir: 1, skidT: 0, slip: 0, prevMark: [null, null] };
  camU = 0; camV = 0; score = 0; updateTrack();
}
function cycleCar(step) {
  carIdx = (carIdx + step + CARS.length) % CARS.length;
  if (isUnlocked(carIdx)) { save.car = carIdx; writeSave(); }
  beep(520, 0.06);
}
function cycleQuality() { save.quality = (save.quality + 1) % QUALITY.length; dynScale = 1; writeSave(); resize(); beep(600, 0.06); }
function startGame() {
  if (!isUnlocked(carIdx)) { beep(150, 0.15, "sawtooth"); return; }
  if (state === "GAME_OVER") reset();
  state = "PLAYING"; input.ignore = true; beep(440, 0.12, "square", 0.05, 880); onStart();
}
function setPaused(p) {
  if (p && state === "PLAYING") { state = "PAUSED"; accumulator = 0; }
  else if (!p && state === "PAUSED") { state = "PLAYING"; input.ignore = true; }
}
function toMenu() { state = "START"; reset(); }
function gameOver() {
  state = "GAME_OVER"; overAt = clock; car.newBest = false;
  if (score > save.best) { save.best = score; car.newBest = true; }
  writeSave(); beep(300, 0.5, "sawtooth", 0.06, 60); onGameOver(score);
}

/* ================================ F5. INPUT =============================== */
function syncHeld() { input.held = input.ptrs.size > 0 || input.space; if (!input.held) input.ignore = false; }
function press(x, y) { // true if the press hit a UI button (so it must not steer)
  for (const b of buttons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return true; }
  if (state === "START") startGame();
  else if (state === "PAUSED") setPaused(false);
  else if (state === "GAME_OVER" && clock - overAt >= CONFIG.retryDelay) startGame();
  return false;
}
canvas.addEventListener("pointerdown", e => {
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  input.ptrs.add(e.pointerId);
  const was = state, consumed = press(e.clientX, e.clientY);
  if (consumed || was !== state) input.ignore = true;
  syncHeld();
});
function pointerUp(e) { input.ptrs.delete(e.pointerId); syncHeld(); }
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);
window.addEventListener("blur", () => { input.ptrs.clear(); input.space = false; syncHeld(); setPaused(true); });
document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });
window.addEventListener("keydown", e => {
  if (e.code === "KeyP" || e.code === "Escape") { if (!e.repeat) setPaused(state === "PLAYING"); return; }
  if (e.code === "KeyM") { if (!e.repeat) toggleSound(); return; }
  if (e.code === "KeyQ") { if (!e.repeat) cycleQuality(); return; }
  if (state === "START" && !e.repeat && (e.code === "ArrowLeft" || e.code === "ArrowRight")) { cycleCar(e.code === "ArrowRight" ? 1 : -1); return; }
  if (e.code !== "Space" && e.code !== "ArrowUp") return;
  e.preventDefault();
  if (e.repeat || input.space) return;
  const was = state;
  input.space = true; press(-1, -1);
  if (was !== state) input.ignore = true;
  syncHeld();
});
window.addEventListener("keyup", e => {
  if (e.code !== "Space" && e.code !== "ArrowUp") return;
  e.preventDefault(); input.space = false; syncHeld();
});

/* ============================== F6. SIMULATION ============================ */
function advance(d) { car.u += car.vu * d; car.v += car.vv * d; }
function spawnTrail(c, slip) { // continuous twin tyre lines (each mark remembers its previous point) + smoke
  const fu = Math.cos(car.ang), fv = Math.sin(car.ang), Q = QUALITY[save.quality];
  [-1, 1].forEach((k, i) => {
    const u = car.u - fu * c.length * 0.3 - fv * k * c.width * 0.42, v = car.v - fv * c.length * 0.3 + fu * k * c.width * 0.42, pm = car.prevMark[i];
    if (MODS.skidMarks) parts.push({ kind: 0, u, v, pu: pm ? pm[0] : u, pv: pm ? pm[1] : v, life: MODS.skidLife, max: MODS.skidLife });
    car.prevMark[i] = [u, v];
    if (slip > PHYSICS.driftSmokeAngle) for (let n = 0; n < Math.ceil(Q.smoke); n++) {
      const L = rand(0.5, 0.9);
      parts.push({ kind: 1, u: u + rand(-0.08, 0.08), v: v + rand(-0.08, 0.08), h: 0.08, vh: rand(0.5, 1.1), du: rand(-0.4, 0.4) - fu * 0.3, dv: rand(-0.4, 0.4) - fv * 0.3, r: rand(0.14, 0.24), life: L, max: L });
    }
  });
}
function stepPhysics(dt) { // ONE fixed step; all maths is dt-scaled (frame-rate independent)
  const c = CARS[carIdx], P = PHYSICS;
  if (state === "PLAYING") {
    const want = input.held && !input.ignore ? 0 : 1;
    if (want !== car.dir) { car.dir = want; beep(want ? 300 : 360, 0.05, "triangle", 0.04); onTurn(want === 0 ? "RIGHT" : "LEFT"); }
    const lv = getLevel(Math.floor(car.u + car.v));
    if (lv !== level) { level = lv; beep(700, 0.25, "square", 0.04, 1200); onLevelChange(lv); }
    car.speed += (lv.speed - car.speed) * (1 - Math.exp(-CONFIG.speedEase * dt));
    const target = car.dir === 0 ? 0 : HALF_PI;
    car.angVel += (P.steerStiffness * (target - car.ang) - P.steerDamping * car.angVel) * dt;
    car.angVel = clamp(car.angVel, -P.maxTurnRate, P.maxTurnRate);
    car.ang += car.angVel * dt;
    const k = 1 - Math.exp(-P.lateralGrip * dt); // velocity chases heading: this lag IS the drift
    car.vu += (Math.cos(car.ang) * car.speed - car.vu) * k;
    car.vv += (Math.sin(car.ang) * car.speed - car.vv) * k;
    advance(dt);
    const hu = Math.cos(car.ang), hv = Math.sin(car.ang);
    car.slip = Math.abs(Math.atan2(hu * car.vv - hv * car.vu, hu * car.vu + hv * car.vv));
    car.tilt = -car.angVel * P.bodyRoll * 0.1;
    car.skidT -= dt;
    if (car.slip > P.driftSkidAngle) { if (car.skidT <= 0) { spawnTrail(c, car.slip); car.skidT = 0.016; } }
    else car.prevMark = [null, null];
    const s = Math.floor(Math.floor(car.u + car.v) * MODS.scoreMultiplier);
    if (s !== score) { score = s; onScore(s); }
    if (!MODS.godMode && !onRoad(car.u, car.v)) { state = "FALLING"; fallT = 0; car.tdir = car.vu > car.vv ? -1 : 1; beep(500, 0.4, "sine", 0.05, 120); }
    updateTrack();
  } else if (state === "FALLING") {
    fallT += dt; car.vh -= P.gravity * dt; car.h += car.vh * dt; car.tilt += car.tdir * 3 * dt;
    const drag = Math.exp(-P.airDrag * dt); car.vu *= drag; car.vv *= drag;
    advance(dt);
    if (fallT >= CONFIG.fallTime) gameOver();
  }
}
function update(realDt) {
  if (state !== "PAUSED") {
    accumulator += realDt * MODS.timeScale;
    while (accumulator >= CONFIG.fixedStep) { stepPhysics(CONFIG.fixedStep); accumulator -= CONFIG.fixedStep; }
    for (const p of parts) { p.life -= realDt; if (p.kind === 1) { p.h += p.vh * realDt; p.u += p.du * realDt; p.v += p.dv * realDt; } }
    parts = parts.filter(p => p.life > 0); // expired particles removed every frame (no leaks)
  }
  const ck = 1 - Math.exp(-CONFIG.cameraEase * realDt);
  camU += (car.u - camU) * ck; camV += (car.v - camV) * ck;
  const th = themeAt(Math.max(0, Math.floor(car.u + car.v))), k = 1 - Math.exp(-CONFIG.bgEase * realDt);
  for (let i = 0; i < 3; i++) { bg.top[i] += (th.pal.bgTop[i] - bg.top[i]) * k; bg.bot[i] += (th.pal.bgBottom[i] - bg.bot[i]) * k; }
}

/* ============================== F7. RENDERING ============================= */
function project(u, v, h) { return [view.ox + (u - v) * view.s, view.oy - (u + v) * view.s / 2 - h * view.s]; }
function poly(pts, col, dark) {
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 0.7; ctx.lineJoin = "round"; ctx.stroke(); // hides hairline seams between polygons
  if (dark) { ctx.fillStyle = "rgba(0,0,0," + dark + ")"; ctx.fill(); }
}
function polyGrad(pts, c0, c1, y0, y1) { // side face with a vertical gradient (cheap ambient occlusion toward the base)
  const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, c0); g.addColorStop(1, c1);
  poly(pts, g, 0);
}
function drawSegment(s) {
  const P = project, t = CONFIG.thickness * view.s, C = s.colors;
  const a = P(s.minU, s.minV, 0), b = P(s.maxU, s.minV, 0), c = P(s.maxU, s.maxV, 0), d = P(s.minU, s.maxV, 0);
  if (c[1] > H + t || a[1] + t < 0 || d[0] > W || b[0] < 0) return;
  const dn = p => [p[0], p[1] + t];
  polyGrad([a, b, dn(b), dn(a)], C.sideA0, C.sideA1, a[1], a[1] + t);
  polyGrad([a, d, dn(d), dn(a)], C.sideB0, C.sideB1, a[1], a[1] + t);
  poly([a, b, c, d], C.tileA, 0);
  const alongU = s.dir === 0, lo = alongU ? s.minU : s.minV, hi = alongU ? s.maxU : s.maxV;
  const clo = alongU ? s.minV : s.minU, chi = alongU ? s.maxV : s.maxU;
  const cell = (x0, x1, y0, y1) => { // (x = along axis, y = across axis)
    const q = alongU ? [P(x0, y0, 0), P(x1, y0, 0), P(x1, y1, 0), P(x0, y1, 0)] : [P(y0, x0, 0), P(y1, x0, 0), P(y1, x1, 0), P(y0, x1, 0)];
    if (q[2][1] > H || q[0][1] < 0 || q[1][0] < 0 || q[3][0] > W) return;
    poly(q, C.tileB, 0);
  };
  for (let i = Math.floor(lo); i < hi; i++) {
    const x0 = Math.max(i, lo), x1 = Math.min(i + 1, hi);
    if (s.pattern === "stripes") { if (i & 1) cell(x0, x1, clo, chi); }
    else for (let j = Math.floor(clo); j < chi; j++) if ((i + j) & 1) cell(x0, x1, Math.max(j, clo), Math.min(j + 1, chi));
  }
  // Edge highlights on the two camera-facing edges only. The other two are covered by the neighbouring
  // segment (drawn later, nearer the camera), which keeps corner junctions clean.
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = C.edge; ctx.lineWidth = view.s * 0.07;
  if (s.glow && QUALITY[save.quality].glow) { ctx.shadowColor = C.edge; ctx.shadowBlur = view.s * 0.45; }
  ctx.beginPath(); ctx.moveTo(d[0], d[1]); ctx.lineTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.shadowBlur = 0;
}
function drawParticles() { // tyre marks lie on the road; smoke rises, grows and fades
  ctx.lineCap = "round";
  for (const p of parts) {
    if (p.kind === 0) {
      const q0 = project(p.pu, p.pv, 0), q1 = project(p.u, p.v, 0);
      ctx.strokeStyle = "rgba(10,10,20," + 0.45 * p.life / p.max + ")"; ctx.lineWidth = view.s * 0.1;
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
    } else {
      const q = project(p.u, p.v, p.h), f = p.life / p.max;
      ctx.fillStyle = "rgba(245,245,255," + 0.4 * f + ")";
      ctx.beginPath(); ctx.arc(q[0], q[1], view.s * p.r * (1 + 1.6 * (1 - f)), 0, 6.3); ctx.fill();
    }
  }
}
function drawBox(cu, cv, h0, h1, th, len, wid, col, lean, topCol) { // oriented 3D box: far faces first, top last
  const c = Math.cos(th), n = Math.sin(th), hl = len / 2, hw = wid / 2;
  const cor = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(k => [cu + k[0] * c - k[1] * n, cv + k[0] * n + k[1] * c]);
  const pt = (p, h) => { const q = project(p[0], p[1], h); return [q[0] + lean * (h - car.h) * view.s, q[1]]; };
  const faces = cor.map((p, i) => {
    const q = cor[(i + 1) % 4], mu = (p[0] + q[0]) / 2 - cu, mv = (p[1] + q[1]) / 2 - cv;
    return { p, q, d: p[0] + p[1] + q[0] + q[1], k: (mu - mv) / (Math.hypot(mu, mv) * 1.414) };
  }).sort((x, y) => y.d - x.d);
  for (const f of faces) poly([pt(f.p, h0), pt(f.q, h0), pt(f.q, h1), pt(f.p, h1)], col, 0.22 + 0.2 * f.k);
  poly(cor.map(p => pt(p, h1)), topCol || col, 0);
}
function flatShadow(cu, cv, th, len, wid, alpha) {
  const c = Math.cos(th), n = Math.sin(th), hl = len / 2, hw = wid / 2;
  ctx.fillStyle = "rgba(0,0,0," + alpha + ")";
  ctx.beginPath();
  [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].forEach((k, i) => { const q = project(cu + k[0] * c - k[1] * n, cv + k[0] * n + k[1] * c, 0); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
  ctx.closePath(); ctx.fill();
}
function drawCar(c, cu, cv, ch, ang, tilt) { // soft shadow, wheels, chassis, body, glass cabin, lights, spoiler
  const fu = Math.cos(ang), fv = Math.sin(ang), L = c.length, Wd = c.width, bh = Wd * 0.6, bodyY = ch + 0.2;
  if (onRoad(cu, cv)) {
    const fade = 1 / (1 + Math.max(0, ch) * 3);
    if (QUALITY[save.quality].soft) for (let i = 3; i >= 1; i--) flatShadow(cu, cv, ang, L * (1 + i * 0.07), Wd * (1.05 + i * 0.1), 0.09 * fade);
    else flatShadow(cu, cv, ang, L * 1.1, Wd * 1.1, 0.25 * fade);
  }
  const wheels = [];
  for (const a of [1, -1]) for (const b of [1, -1]) {
    const u = cu + fu * a * L * 0.3 - fv * b * Wd * 0.5, v = cv + fv * a * L * 0.3 + fu * b * Wd * 0.5;
    wheels.push({ u, v, y: project(u, v, ch)[1] });
  }
  wheels.sort((p, q) => p.y - q.y);
  const wheel = w => { drawBox(w.u, w.v, ch, ch + 0.26, ang, L * 0.26, Wd * 0.2, "#1b1b22", tilt); drawBox(w.u, w.v, ch + 0.07, ch + 0.19, ang, L * 0.12, Wd * 0.21, "#9aa0b0", tilt); };
  wheel(wheels[0]); wheel(wheels[1]);
  drawBox(cu, cv, ch + 0.08, bodyY, ang, L * 0.98, Wd * 0.86, "#23232b", tilt);
  drawBox(cu, cv, bodyY, bodyY + bh, ang, L, Wd * 0.92, c.bodyColor, tilt);
  drawBox(cu - fu * L * 0.08, cv - fv * L * 0.08, bodyY + bh, bodyY + bh * 1.75, ang, L * 0.5, Wd * 0.74, "#16324f", tilt, c.roofColor);
  wheel(wheels[2]); wheel(wheels[3]);
  for (const k of [-1, 1]) {
    drawBox(cu + fu * L * 0.5 - fv * k * Wd * 0.3, cv + fv * L * 0.5 + fu * k * Wd * 0.3, bodyY + bh * 0.3, bodyY + bh * 0.7, ang, L * 0.05, Wd * 0.18, "#fff3b0", tilt);
    drawBox(cu - fu * L * 0.5 - fv * k * Wd * 0.3, cv - fv * L * 0.5 + fu * k * Wd * 0.3, bodyY + bh * 0.3, bodyY + bh * 0.7, ang, L * 0.05, Wd * 0.18, "#ff3b3b", tilt);
  }
  drawBox(cu - fu * L * 0.46, cv - fv * L * 0.46, bodyY + bh, bodyY + bh * 1.35, ang, L * 0.1, Wd * 0.92, "#23232b", tilt);
}
const SCENERY = {
  sun(a) { const x = W * 0.72, y = H * 0.28, r = ui * 18, g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.4);
    g.addColorStop(0, "rgba(255,244,210," + 0.95 * a + ")"); g.addColorStop(0.35, "rgba(255,200,120," + 0.5 * a + ")"); g.addColorStop(1, "rgba(255,160,80,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, 6.3); ctx.fill(); },
  clouds(a, px) { ctx.fillStyle = "rgba(255,255,255," + 0.8 * a + ")"; const span = W * 1.4;
    for (let i = 0; i < 7; i++) {
      const x = (((hash(i) * span - px * (0.3 + hash(i + 9) * 0.4) - clock * ui * 0.8) % span) + span) % span - W * 0.2, y = H * (0.06 + hash(i + 3) * 0.45), r = ui * (5 + hash(i + 5) * 6);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.arc(x + r * 0.9, y + r * 0.1, r * 0.8, 0, 6.3); ctx.arc(x - r * 0.9, y + r * 0.15, r * 0.7, 0, 6.3); ctx.fill();
    } },
  stars(a, px) { for (let i = 0; i < 60; i++) {
      const x = (((hash(i) * W - px * (0.05 + hash(i + 50) * 0.1)) % W) + W) % W, y = hash(i + 100) * H * 0.75, tw = 0.5 + 0.5 * Math.sin(clock * 2 + i);
      ctx.fillStyle = "rgba(255,255,255," + a * tw * 0.9 + ")"; ctx.beginPath(); ctx.arc(x, y, ui * (0.2 + hash(i + 200) * 0.4), 0, 6.3); ctx.fill();
    } }
};
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function drawScenery(th) {
  if (!QUALITY[save.quality].scenery) return;
  const px = (camU - camV) * view.s;
  if (th.a.scenery === th.b.scenery) SCENERY[th.a.scenery](1, px);
  else { SCENERY[th.a.scenery](1 - th.t, px); SCENERY[th.b.scenery](th.t, px); }
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function setFont(size) { ctx.font = "800 " + size + "px system-ui,-apple-system,'Segoe UI',sans-serif"; }
function label(str, x, y, size, col, align) {
  setFont(size); ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = size * 0.16; ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.strokeText(str, x, y); ctx.fillStyle = col || "#fff"; ctx.fillText(str, x, y);
}
function button(str, x, y, w, h, fn) {
  rr(x, y, w, h, h * 0.3); ctx.fillStyle = "rgba(15,15,40,0.55)"; ctx.fill();
  ctx.lineWidth = Math.max(1.5, h * 0.04); ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.stroke();
  label(str, x + w / 2, y + h / 2, h * 0.48); buttons.push({ x, y, w, h, fn });
}
function drawHUD() {
  const cx = W / 2, pulse = 0.65 + 0.35 * Math.sin(clock * 5), bw = ui * 26, bh = ui * 10, m = ui * 3;
  buttons = [];
  const side = () => { button("SOUND " + (save.sound ? "ON" : "OFF"), W - bw - m, m, bw, bh, toggleSound); button("GFX " + QUALITY[save.quality].name, W - bw - m, m + bh * 1.2, bw, bh, cycleQuality); };
  if (state === "START") {
    label(CONFIG.title, cx, H * 0.12, ui * 10.5);
    const c = CARS[carIdx], ok = isUnlocked(carIdx), top = H * 0.2;
    button("<", cx - ui * 38, top, bh, bh, () => cycleCar(-1));
    button(">", cx + ui * 38 - bh, top, bh, bh, () => cycleCar(1));
    label(c.name, cx, top + bh / 2, ui * 7);
    label(ok ? "Best  " + save.best : "LOCKED - reach " + c.unlockScore + " (best " + save.best + ")", cx, top + bh * 1.5, ui * 4.6, ok ? "#fff" : "#ffd166");
    side(); ctx.globalAlpha = ok ? pulse : 0.4; label(ok ? CONFIG.startText : "CHOOSE ANOTHER CAR", cx, H * 0.91, ui * 7); ctx.globalAlpha = 1;
  } else if (state === "PAUSED") {
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    label("PAUSED", cx, H * 0.24, ui * 13);
    const y0 = H * 0.36, bw2 = ui * 50;
    button("RESUME", cx - bw2 / 2, y0, bw2, bh, () => setPaused(false));
    button("RESTART", cx - bw2 / 2, y0 + bh * 1.3, bw2, bh, () => { reset(); state = "PLAYING"; input.ignore = true; });
    button("MENU", cx - bw2 / 2, y0 + bh * 2.6, bw2, bh, toMenu);
    side();
  } else if (state === "GAME_OVER") {
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, W, H);
    label("GAME OVER", cx, H * 0.24, ui * 12);
    label("Score  " + score, cx, H * 0.38, ui * 11);
    label(car.newBest ? "NEW BEST!" : "Best  " + save.best, cx, H * 0.49, ui * 8, car.newBest ? "#ffd166" : "#fff");
    const fresh = CARS.filter(k => k.unlockScore > 0 && save.best >= k.unlockScore && save.best - score < k.unlockScore && car.newBest);
    if (fresh.length) label("Unlocked: " + fresh.map(k => k.name).join(", "), cx, H * 0.57, ui * 5, "#80ed99");
    button("MENU", cx - ui * 20, H * 0.64, ui * 40, bh, toMenu);
    ctx.globalAlpha = clock - overAt >= CONFIG.retryDelay ? pulse : 0.3; label(CONFIG.retryText, cx, H * 0.9, ui * 7); ctx.globalAlpha = 1;
  } else {
    label(String(score), cx, H * 0.09, ui * 17);
    label("BEST " + save.best, cx, H * 0.09 + ui * 11, ui * 4.5);
    if (state === "PLAYING") button("II", m, m, bh, bh, () => setPaused(true));
  }
  if (MODS.showDebug) {
    const p = project(car.u, car.v, car.h);
    ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 6.3); ctx.fill();
    ["FPS " + Math.round(fps) + "  " + state + "  render " + canvas.width + "x" + canvas.height + " (x" + dpr.toFixed(2) + ")",
     "speed " + Math.hypot(car.vu, car.vv).toFixed(2) + "  heading " + car.ang.toFixed(2) + "  slip " + car.slip.toFixed(2),
     "onRoad " + onRoad(car.u, car.v) + "  segs " + segs.length + "  tier " + level.name + "  theme " + themeAt(Math.floor(car.u + car.v)).main.name,
     "particles " + parts.length].forEach((t, i) => label(t, 8, 16 + i * 17, 13, "#0f0", "left"));
  }
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const th = themeAt(Math.max(0, Math.floor(camU + camV)));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(bg.top)); g.addColorStop(1, rgb(bg.bot));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  drawScenery(th);
  view.ox = W / 2 - (camU - camV) * view.s;
  view.oy = H * CONFIG.carScreenY + (camU + camV) * view.s / 2;
  for (let i = segs.length - 1; i >= 0; i--) drawSegment(segs[i]);
  drawParticles(); drawCar(CARS[carIdx], car.u, car.v, car.h, car.ang, car.tilt); drawHUD();
}

/* ============================== F8. MAIN LOOP ============================= */
// HD rendering: the canvas backing store = CSS size x dpr, where dpr = min(device ratio, preset cap) x dynScale,
// further reduced if it would exceed the preset's maxPixels. Drawing is vector (paths + text), so it is re-rasterised
// at the full backing resolution every frame - nothing is upscaled. Canvas paths are anti-aliased by the browser.
function resize() {
  const Q = QUALITY[save.quality];
  W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, Q.dprCap) * dynScale;
  const px = W * H * dpr * dpr; if (px > Q.maxPixels) dpr *= Math.sqrt(Q.maxPixels / px);
  dpr = Math.max(dpr, 0.5);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ui = Math.min(W, H * 0.62) / 100 * CONFIG.uiScale;
  view.s = Math.min(W, H * 0.75) / CONFIG.tilesAcross;
}
function adaptResolution(real) { // dynamic resolution scaling
  if (!CONFIG.dynamicResolution || real >= CONFIG.maxFrame) return;
  if (fps < 45) { slowTime += real; fastTime = 0; } else if (fps > 57) { fastTime += real; slowTime = 0; } else { slowTime = fastTime = 0; }
  if (slowTime > 1.5 && dynScale > 0.6) { dynScale *= 0.85; slowTime = 0; resize(); }
  else if (fastTime > 6 && dynScale < 1) { dynScale = Math.min(1, dynScale * 1.15); fastTime = 0; resize(); }
}
function loop(t) {
  const real = Math.max(0, Math.min((t - last) / 1000, CONFIG.maxFrame)); last = t;
  if (real > 0) fps += (1 / real - fps) * 0.1;
  adaptResolution(real);
  clock += real; update(real); draw();
  requestAnimationFrame(loop);
}

/* ================================ F9. BOOT ================================ */
loadSave(); resize(); reset();
{ const th = themeAt(0); bg.top = th.pal.bgTop.slice(); bg.bot = th.pal.bgBottom.slice(); }
window.addEventListener("resize", resize);
requestAnimationFrame(t => { last = t; loop(t); });
