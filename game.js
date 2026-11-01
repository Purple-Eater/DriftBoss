// game.js  (v2 - drift physics rebuild; sections A-F kept, F is now split into F1-F9)

/* ============================ A. HOW TO MODIFY ============================
 * 1. Game feel (zoom, camera, forgiveness)        -> B. CONFIG
 * 2. Drift handling (grip, steering, momentum)     -> B2. PHYSICS (all in one object)
 * 3. Cars, colours, unlock scores                  -> C. CARS  (handling is identical for all cars)
 * 4. Difficulty tiers and palettes                 -> D. LEVELS (keep startScore ascending, segMin >= roadWidth)
 * 5. Cheats, debug view, hooks                     -> E. MODS & HOOKS
 * 6. Engine sections F1-F9 can be edited, but read their header comments first.
 * Controls: hold mouse/touch/Space/ArrowUp = steer RIGHT(+u); release = steer LEFT(+v).
 *           P or Esc = pause, M = mute, Left/Right arrows = change car on start screen.
 * ======================================================================== */

/* ================================ B. CONFIG ============================== */
const CONFIG = {
  title: "DRIFT CLONE", startText: "TAP TO START", retryText: "TAP TO RETRY",
  tilesAcross: 12,        // tiles across screen width; smaller = zoomed in (8-18)
  thickness: 0.6,         // road slab depth (tiles)
  fallTime: 1.0,          // seconds falling before GAME_OVER
  edgeForgiveness: 0,     // extra grace past road edge (tiles, 0-0.5)
  firstSegment: 8,        // length of first road piece (tiles)
  lookAhead: 45, lookBehind: 20, // road generated ahead / kept behind (tiles of travel)
  speedEase: 3,           // how fast speed follows tier speed (1/s)
  bgEase: 2,              // background colour blend rate (1/s)
  cameraEase: 6,          // camera follow smoothing (1/s, higher = tighter)
  fixedStep: 1 / 120,     // physics timestep (s). Simulation is identical on every machine.
  maxFrame: 0.1,          // longest real frame fed to the accumulator (s)
  retryDelay: 0.4,        // taps ignored after game over (s)
  carScreenY: 0.7,        // car vertical screen position (fraction of height)
  storageKey: "driftclone.save"
};

/* =============================== B2. PHYSICS ============================== */
// Model: the car has a HEADING (ang) that swings toward the steering target, and a VELOCITY vector
// that chases the heading direction with limited grip. Lower grip = longer slides.
const PHYSICS = {
  steerStiffness: 140,   // spring pulling heading to target (1/s^2). Higher = snappier turn-in
  steerDamping: 20,      // damps heading spin (1/s). Lower = more overshoot wobble
  maxTurnRate: 9,        // max heading angular speed (rad/s)
  lateralGrip: 7,        // how fast velocity aligns with heading (1/s). 3 = icy, 12 = on rails
  driftSkidAngle: 0.10,  // slip angle (rad) above which tyre marks appear
  driftSmokeAngle: 0.30, // slip angle (rad) above which smoke appears
  bodyRoll: 0.35,        // visual lean per rad/s of turn rate (cosmetic)
  gravity: 22,           // fall acceleration (tiles/s^2)
  airDrag: 0.4           // horizontal speed loss while falling (1/s)
};

/* ================================= C. CARS ================================ */
// unlockScore = best score needed to unlock (Drift Boss unlocks by points; exact values here are my own).
const CARS = [
  { name: "Red Racer", bodyColor: "#e63946", roofColor: "#f1faee", length: 1.0, width: 0.6,  unlockScore: 0 },
  { name: "Blue Bolt", bodyColor: "#3a86ff", roofColor: "#caf0f8", length: 1.1, width: 0.6,  unlockScore: 60 },
  { name: "Lime Dart", bodyColor: "#80ed99", roofColor: "#22577a", length: 0.9, width: 0.55, unlockScore: 150 },
  { name: "Gold Rush", bodyColor: "#ffbe0b", roofColor: "#3d405b", length: 1.0, width: 0.65, unlockScore: 300 }
];
const SELECTED_CAR = 0;

/* ================================ D. LEVELS =============================== */
const LEVELS = [
  { name: "Warm-up", startScore: 0,   roadWidth: 2.2, segMin: 3,   segMax: 9, speed: 3.5,
    colors: { bgTop: "#1b1f4b", bgBottom: "#6a4c93", tileA: "#ff9f1c", tileB: "#ffbf69", side: "#a85d12" } },
  { name: "Cruise",  startScore: 40,  roadWidth: 1.9, segMin: 2.5, segMax: 7, speed: 4.5,
    colors: { bgTop: "#0b3d4a", bgBottom: "#2a9d8f", tileA: "#48cae4", tileB: "#90e0ef", side: "#0077b6" } },
  { name: "Hustle",  startScore: 120, roadWidth: 1.7, segMin: 2,   segMax: 6, speed: 5.5,
    colors: { bgTop: "#3a0ca3", bgBottom: "#f72585", tileA: "#ff5d8f", tileB: "#ff85a1", side: "#8e2461" } },
  { name: "Insane",  startScore: 250, roadWidth: 1.5, segMin: 1.7, segMax: 5, speed: 6.5,
    colors: { bgTop: "#02010a", bgBottom: "#3d0c4e", tileA: "#e5e5e5", tileB: "#8d99ae", side: "#2b2d42" } }
];

/* ============================= E. MODS & HOOKS ============================ */
const MODS = { godMode: false, scoreMultiplier: 1, timeScale: 1, skidMarks: true, skidLife: 1.5, showDebug: false };
function onStart() {}
function onTurn(dir) {}
function onScore(n) {}
function onLevelChange(level) {}
function onGameOver(score) {}

/* ======================= F1. STATE, UTILITIES, STORAGE ==================== */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const HALF_PI = Math.PI / 2;
const view = { s: 30, ox: 0, oy: 0 };
const bg = { top: [0, 0, 0], bot: [0, 0, 0] };
const input = { ptrs: new Set(), space: false, held: false, ignore: false };
let W = 0, H = 0, dpr = 1, ui = 1;
let state = "START";   // START | PLAYING | PAUSED | FALLING | GAME_OVER
let carIdx = SELECTED_CAR % CARS.length;
let car, segs, parts, level, score = 0, fallT = 0;
let clock = 0, overAt = 0, fps = 60, last = 0, accumulator = 0, buttons = [], camU = 0, camV = 0;
const save = { best: 0, car: carIdx, sound: true };

function rand(a, b) { return a + Math.random() * (b - a); }
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgb(a) { return "rgb(" + a.map(Math.round).join(",") + ")"; }
function getLevel(tiles) { for (let i = LEVELS.length - 1; i > 0; i--) if (tiles >= LEVELS[i].startScore) return LEVELS[i]; return LEVELS[0]; }
function isUnlocked(i) { return save.best >= CARS[i].unlockScore; }
function loadSave() { // tolerant of missing, corrupt or old-format (plain number) data
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG.storageKey) || localStorage.getItem("driftclone.best") || "null");
    if (typeof raw === "number") save.best = raw | 0;
    else if (raw && typeof raw === "object") {
      save.best = Math.max(0, raw.best | 0); save.sound = raw.sound !== false;
      if (raw.car >= 0 && raw.car < CARS.length) save.car = raw.car | 0;
    }
  } catch (e) {}
  carIdx = isUnlocked(save.car) ? save.car : 0;
}
function writeSave() { try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(save)); } catch (e) {} }

/* ================================ F2. AUDIO =============================== */
// Procedural WebAudio beeps - no files. The context is created on the first user press (browser rule).
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

/* =========================== F3. TRACK GENERATOR ========================== */
// The road is a chain of rectangles in (u,v) space. Even segments run along +u (RIGHT), odd along +v (LEFT).
// Each rectangle is padded by half the road width so corners overlap fully: no gaps, no dead zones.
function addSegment() {
  const p = segs[segs.length - 1];
  const dir = p ? 1 - p.dir : 1;
  const u0 = p ? p.endU : 0, v0 = p ? p.endV : 0;
  const lv = getLevel(Math.floor(u0 + v0));
  const len = p ? rand(lv.segMin, lv.segMax) : CONFIG.firstSegment;
  const h = lv.roadWidth / 2, endU = u0 + (dir === 0 ? len : 0), endV = v0 + (dir === 1 ? len : 0);
  segs.push({ dir, w: lv.roadWidth, colors: lv.colors, endU, endV, minU: u0 - h, maxU: endU + h, minV: v0 - h, maxV: endV + h });
}
function updateTrack() {
  const p = car.u + car.v;
  let l = segs[segs.length - 1];
  while (l.endU + l.endV < p + CONFIG.lookAhead) { addSegment(); l = segs[segs.length - 1]; }
  while (segs.length > 2 && segs[0].endU + segs[0].endV + segs[0].w < p - CONFIG.lookBehind) segs.shift();
}
function onRoad(u, v) {
  const e = CONFIG.edgeForgiveness;
  return segs.some(s => u >= s.minU - e && u <= s.maxU + e && v >= s.minV - e && v <= s.maxV + e);
}

/* ===================== F4. STATE MACHINE (start/pause/over) =============== */
function reset() {
  segs = []; parts = []; addSegment();
  level = getLevel(0);
  const sp = level.speed;
  car = { u: 0, v: 0, h: 0, vh: 0, dir: 1, ang: HALF_PI, angVel: 0, vu: 0, vv: sp, speed: sp, tilt: 0, tdir: 1, skidT: 0, slip: 0 };
  camU = 0; camV = 0; score = 0; updateTrack();
}
function cycleCar(step) {
  carIdx = (carIdx + step + CARS.length) % CARS.length;
  if (isUnlocked(carIdx)) { save.car = carIdx; writeSave(); }
  beep(520, 0.06);
}
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
function press(x, y) { // returns true if the press hit a UI button (so it must not steer)
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
  const wasState = state, consumed = press(e.clientX, e.clientY);
  if (consumed || wasState !== state) input.ignore = true;
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
  if (state === "START" && !e.repeat && (e.code === "ArrowLeft" || e.code === "ArrowRight")) { cycleCar(e.code === "ArrowRight" ? 1 : -1); return; }
  if (e.code !== "Space" && e.code !== "ArrowUp") return;
  e.preventDefault();
  if (e.repeat || input.space) return;
  const wasState = state;
  input.space = true; press(-1, -1);
  if (wasState !== state) input.ignore = true;
  syncHeld();
});
window.addEventListener("keyup", e => {
  if (e.code !== "Space" && e.code !== "ArrowUp") return;
  e.preventDefault(); input.space = false; syncHeld();
});

/* ============================== F6. SIMULATION ============================ */
function advance(d) { car.u += car.vu * d; car.v += car.vv * d; }
function spawnTrail(c, intensity) { // twin tyre marks at the rear wheels + smoke when sliding hard
  const fu = Math.cos(car.ang), fv = Math.sin(car.ang);
  for (const k of [-1, 1]) {
    const u = car.u - fu * c.length * 0.3 - fv * k * c.width * 0.4, v = car.v - fv * c.length * 0.3 + fu * k * c.width * 0.4;
    if (MODS.skidMarks) parts.push({ kind: 0, u, v, life: MODS.skidLife, max: MODS.skidLife });
    if (intensity > PHYSICS.driftSmokeAngle) parts.push({ kind: 1, u, v, h: 0.05, vh: rand(0.4, 0.9), life: 0.6, max: 0.6 });
  }
}
function stepPhysics(dt) { // ONE fixed step. All maths is dt-scaled so results do not depend on frame rate.
  const c = CARS[carIdx], P = PHYSICS;
  if (state === "PLAYING") {
    const want = input.held && !input.ignore ? 0 : 1;
    if (want !== car.dir) { car.dir = want; beep(want ? 300 : 360, 0.05, "triangle", 0.04); onTurn(want === 0 ? "RIGHT" : "LEFT"); }
    const lv = getLevel(Math.floor(car.u + car.v));
    if (lv !== level) { level = lv; beep(700, 0.25, "square", 0.04, 1200); onLevelChange(lv); }
    car.speed += (lv.speed - car.speed) * (1 - Math.exp(-CONFIG.speedEase * dt));
    // 1) heading: damped spring toward the steering target, with a turn-rate cap
    const target = car.dir === 0 ? 0 : HALF_PI;
    car.angVel += (P.steerStiffness * (target - car.ang) - P.steerDamping * car.angVel) * dt;
    car.angVel = Math.max(-P.maxTurnRate, Math.min(P.maxTurnRate, car.angVel));
    car.ang += car.angVel * dt;
    // 2) velocity: chases heading direction at car.speed, limited by lateral grip (this is the drift)
    const k = 1 - Math.exp(-P.lateralGrip * dt);
    car.vu += (Math.cos(car.ang) * car.speed - car.vu) * k;
    car.vv += (Math.sin(car.ang) * car.speed - car.vv) * k;
    advance(dt);
    // 3) slip angle = angle between where the car points and where it is travelling
    const hu = Math.cos(car.ang), hv = Math.sin(car.ang);
    car.slip = Math.abs(Math.atan2(hu * car.vv - hv * car.vu, hu * car.vu + hv * car.vv));
    car.tilt = -car.angVel * P.bodyRoll * 0.1;
    car.skidT -= dt;
    if (car.slip > P.driftSkidAngle && car.skidT <= 0) { spawnTrail(c, car.slip); car.skidT = 0.02; }
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
function update(realDt) { // fixed-step accumulator + per-frame (cosmetic) updates
  if (state !== "PAUSED") {
    accumulator += realDt * MODS.timeScale;
    while (accumulator >= CONFIG.fixedStep) { stepPhysics(CONFIG.fixedStep); accumulator -= CONFIG.fixedStep; }
    for (const p of parts) { p.life -= realDt; if (p.kind === 1) { p.h += p.vh * realDt; } }
    parts = parts.filter(p => p.life > 0);
  }
  const ck = 1 - Math.exp(-CONFIG.cameraEase * realDt);
  camU += (car.u - camU) * ck; camV += (car.v - camV) * ck;
  const k = 1 - Math.exp(-CONFIG.bgEase * realDt), tt = hex(level.colors.bgTop), tb = hex(level.colors.bgBottom);
  for (let i = 0; i < 3; i++) { bg.top[i] += (tt[i] - bg.top[i]) * k; bg.bot[i] += (tb[i] - bg.bot[i]) * k; }
}

/* ============================== F7. RENDERING ============================= */
function project(u, v, h) { return [view.ox + (u - v) * view.s, view.oy - (u + v) * view.s / 2 - h * view.s]; }
function poly(pts, col, dark) {
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  if (dark) { ctx.fillStyle = "rgba(0,0,0," + dark + ")"; ctx.fill(); }
}
function drawSegment(s) {
  const P = project, t = CONFIG.thickness * view.s;
  const a = P(s.minU, s.minV, 0), b = P(s.maxU, s.minV, 0), c = P(s.maxU, s.maxV, 0), d = P(s.minU, s.maxV, 0);
  if (c[1] > H + t || a[1] + t < 0 || d[0] > W || b[0] < 0) return;
  const dn = p => [p[0], p[1] + t];
  poly([a, b, dn(b), dn(a)], s.colors.side, 0.25);
  poly([a, d, dn(d), dn(a)], s.colors.side, 0);
  poly([a, b, c, d], s.colors.tileA, 0);
  const alongU = s.dir === 0, lo = alongU ? s.minU : s.minV, hi = alongU ? s.maxU : s.maxV;
  for (let i = Math.floor(lo); i < hi; i++) {
    if (!(i & 1)) continue;
    const x0 = Math.max(i, lo), x1 = Math.min(i + 1, hi);
    const q = alongU ? [P(x0, s.minV, 0), P(x1, s.minV, 0), P(x1, s.maxV, 0), P(x0, s.maxV, 0)]
                     : [P(s.minU, x0, 0), P(s.maxU, x0, 0), P(s.maxU, x1, 0), P(s.minU, x1, 0)];
    if (q[2][1] > H || q[0][1] < 0 || q[1][0] < 0 || q[3][0] > W) continue;
    poly(q, s.colors.tileB, 0);
  }
}
function drawParticles() { // skid marks lie on the road; smoke rises and fades
  const r = 0.07;
  for (const p of parts) {
    if (p.kind === 0) poly([project(p.u - r, p.v - r, 0), project(p.u + r, p.v - r, 0), project(p.u + r, p.v + r, 0), project(p.u - r, p.v + r, 0)], "rgba(0,0,0," + (0.4 * p.life / p.max) + ")", 0);
    else { const q = project(p.u, p.v, p.h), f = p.life / p.max; ctx.fillStyle = "rgba(255,255,255," + 0.45 * f + ")"; ctx.beginPath(); ctx.arc(q[0], q[1], view.s * (0.12 + 0.2 * (1 - f)), 0, 6.3); ctx.fill(); }
  }
}
function drawBox(cu, cv, h0, h1, th, len, wid, col, lean) { // oriented 3D box: far faces first, top last
  const c = Math.cos(th), n = Math.sin(th), hl = len / 2, hw = wid / 2;
  const cor = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(k => [cu + k[0] * c - k[1] * n, cv + k[0] * n + k[1] * c]);
  const pt = (p, h) => { const q = project(p[0], p[1], h); return [q[0] + lean * (h - car.h) * view.s, q[1]]; };
  const faces = cor.map((p, i) => {
    const q = cor[(i + 1) % 4], mu = (p[0] + q[0]) / 2 - cu, mv = (p[1] + q[1]) / 2 - cv;
    return { p, q, d: p[0] + p[1] + q[0] + q[1], k: (mu - mv) / (Math.hypot(mu, mv) * 1.414) };
  }).sort((a, b) => b.d - a.d);
  for (const f of faces) poly([pt(f.p, h0), pt(f.q, h0), pt(f.q, h1), pt(f.p, h1)], col, 0.22 + 0.2 * f.k);
  poly(cor.map(p => pt(p, h1)), col, 0);
}
function drawCar(c, cu, cv, ch, ang, tilt) { // shadow, 4 wheels, body, cabin
  const bh = c.width * 0.55, fu = Math.cos(ang), fv = Math.sin(ang);
  if (ch < 0.4 && ch > -0.01) { // shadow stays on the road; fades as the car drops away
    const sh = ctx.globalAlpha; ctx.globalAlpha = 0.3 * (1 - ch / 0.4);
    drawBoxFlat(cu, cv, ang, c.length * 1.05, c.width * 1.05); ctx.globalAlpha = sh;
  }
  for (const a of [1, -1]) for (const b of [1, -1])
    drawBox(cu + fu * a * c.length * 0.3 - fv * b * c.width * 0.5, cv + fv * a * c.length * 0.3 + fu * b * c.width * 0.5, ch, ch + 0.2, ang, c.length * 0.2, c.width * 0.18, "#222", tilt);
  drawBox(cu, cv, ch + 0.1, ch + bh, ang, c.length, c.width * 0.9, c.bodyColor, tilt);
  drawBox(cu - fu * c.length * 0.08, cv - fv * c.length * 0.08, ch + bh, ch + bh * 1.7, ang, c.length * 0.5, c.width * 0.72, c.roofColor, tilt);
}
function drawBoxFlat(cu, cv, th, len, wid) {
  const c = Math.cos(th), n = Math.sin(th), hl = len / 2, hw = wid / 2;
  poly([[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(k => project(cu + k[0] * c - k[1] * n, cv + k[0] * n + k[1] * c, 0)), "#000", 0);
}
function setFont(size) { ctx.font = "bold " + size + "px system-ui,-apple-system,sans-serif"; }
function label(str, x, y, size, col, align) {
  setFont(size); ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = size * 0.14; ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.strokeText(str, x, y); ctx.fillStyle = col || "#fff"; ctx.fillText(str, x, y);
}
function button(str, x, y, w, h, fn) { // draws a rounded button and registers its hit box for press()
  ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.beginPath(); ctx.roundRect(x, y, w, h, h * 0.3); ctx.fill();
  label(str, x + w / 2, y + h / 2, h * 0.5); buttons.push({ x, y, w, h, fn });
}
function drawHUD() { // score, start/garage, pause menu, game over, debug
  const cx = W / 2, pulse = 0.65 + 0.35 * Math.sin(clock * 5), bw = ui * 22, bh = ui * 9;
  buttons = [];
  const snd = () => button(save.sound ? "SND ON" : "SND OFF", W - bw - ui * 3, ui * 3, bw, bh, toggleSound);
  if (state === "START") {
    label(CONFIG.title, cx, H * 0.12, ui * 13);
    const c = CARS[carIdx], ok = isUnlocked(carIdx), fs = ui * 6;
    button("<", cx - ui * 36, H * 0.24, bh, bh, () => cycleCar(-1));
    button(">", cx + ui * 36 - bh, H * 0.24, bh, bh, () => cycleCar(1));
    label(c.name, cx, H * 0.24 + bh / 2, fs);
    label(ok ? "Best  " + save.best : "LOCKED - reach " + c.unlockScore + " (best " + save.best + ")", cx, H * 0.24 + bh * 1.6, ui * 4.5, ok ? "#fff" : "#ffd166");
    snd(); ctx.globalAlpha = ok ? pulse : 0.4; label(ok ? CONFIG.startText : "CHOOSE ANOTHER CAR", cx, H * 0.9, ui * 6.5); ctx.globalAlpha = 1;
  } else if (state === "PAUSED") {
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    label("PAUSED", cx, H * 0.28, ui * 12);
    button("RESUME", cx - bw, H * 0.4, bw * 2, bh, () => setPaused(false));
    button("RESTART", cx - bw, H * 0.4 + bh * 1.3, bw * 2, bh, () => { reset(); state = "PLAYING"; input.ignore = true; });
    button("MENU", cx - bw, H * 0.4 + bh * 2.6, bw * 2, bh, toMenu);
    snd();
  } else if (state === "GAME_OVER") {
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, W, H);
    label("GAME OVER", cx, H * 0.26, ui * 12);
    label("Score  " + score, cx, H * 0.4, ui * 10);
    label(car.newBest ? "NEW BEST!" : "Best  " + save.best, cx, H * 0.5, ui * 7, car.newBest ? "#ffd166" : "#fff");
    const unlockedNow = CARS.filter(k => k.unlockScore > 0 && save.best >= k.unlockScore && save.best - score < k.unlockScore && car.newBest);
    if (unlockedNow.length) label("Unlocked: " + unlockedNow.map(k => k.name).join(", "), cx, H * 0.58, ui * 4.5, "#80ed99");
    button("MENU", cx - bw / 2, H * 0.64, bw, bh, toMenu);
    ctx.globalAlpha = clock - overAt >= CONFIG.retryDelay ? pulse : 0.3; label(CONFIG.retryText, cx, H * 0.88, ui * 6.5); ctx.globalAlpha = 1;
  } else {
    label(String(score), cx, H * 0.1, ui * 18);
    label("BEST " + save.best, cx, H * 0.1 + ui * 12, ui * 4);
    if (state === "PLAYING") button("II", ui * 3, ui * 3, bh, bh, () => setPaused(true));
  }
  if (MODS.showDebug) {
    const p = project(car.u, car.v, car.h);
    ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 6.3); ctx.fill();
    const info = ["FPS " + Math.round(fps) + "  " + state, "speed " + Math.hypot(car.vu, car.vv).toFixed(2), "heading " + car.ang.toFixed(2) + " slip " + car.slip.toFixed(2),
      "vel " + car.vu.toFixed(2) + "," + car.vv.toFixed(2), "onRoad " + onRoad(car.u, car.v) + " segs " + segs.length + " tier " + level.name];
    info.forEach((t, i) => label(t, 8, 16 + i * 16, 13, "#0f0", "left"));
  }
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(bg.top)); g.addColorStop(1, rgb(bg.bot));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  view.ox = W / 2 - (camU - camV) * view.s;
  view.oy = H * CONFIG.carScreenY + (camU + camV) * view.s / 2;
  for (let i = segs.length - 1; i >= 0; i--) drawSegment(segs[i]);
  drawParticles(); drawCar(CARS[carIdx], car.u, car.v, car.h, car.ang, car.tilt); drawHUD();
}

/* ============================== F8. MAIN LOOP ============================= */
function resize() {
  dpr = window.devicePixelRatio || 1;
  W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ui = Math.min(W, H * 0.6) / 100; view.s = ui * 100 / CONFIG.tilesAcross;
}
function loop(t) {
  const real = Math.min((t - last) / 1000, CONFIG.maxFrame); last = t;
  if (real > 0) fps += (1 / real - fps) * 0.1;
  clock += Math.max(real, 0); update(Math.max(real, 0)); draw();
  requestAnimationFrame(loop);
}

/* ================================ F9. BOOT ================================ */
loadSave(); resize(); reset();
bg.top = hex(level.colors.bgTop); bg.bot = hex(level.colors.bgBottom);
window.addEventListener("resize", resize);
requestAnimationFrame(t => { last = t; loop(t); });
