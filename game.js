// game.js

/* ============================ A. HOW TO MODIFY ============================
 * 1. Game feel (zoom, gravity, forgiveness, first road piece) -> B. CONFIG
 * 2. Add or edit cars (colors are "#rrggbb")                  -> C. CARS
 * 3. Add or edit difficulty tiers and palettes                 -> D. LEVELS
 *    (keep startScore ascending and segMin >= roadWidth)
 * 4. Cheats, debug view and empty hook functions               -> E. MODS & HOOKS
 * 5. Never edit section F. After saving, bump ?v= in index.html.
 * ======================================================================== */

/* ================================ B. CONFIG ============================== */
const CONFIG = {
  title: "DRIFT CLONE",          // EDIT ME - title on the start screen (text)
  startText: "TAP TO START",     // EDIT ME - hint on the start screen (text)
  retryText: "TAP TO RETRY",     // EDIT ME - hint on the game-over screen (text)
  tilesAcross: 12,               // EDIT ME - tiles across the screen width; smaller = zoomed in (tiles, 8-18)
  thickness: 0.6,                // EDIT ME - road slab depth (tiles, 0.2-1.5)
  gravity: 22,                   // fall acceleration (tiles/s^2, 10-40)
  fallTime: 1.0,                 // time spent falling before GAME_OVER (seconds, 0.6-1.5)
  turnEase: 0.12,                // time for the car sprite to swing 90 degrees (seconds, 0.05-0.3)
  edgeForgiveness: 0,            // EDIT ME - extra grace past road edge (tiles, 0-0.5; 0 = exact)
  firstSegment: 8,               // EDIT ME - length of the first road piece (tiles, 4-15)
  lookAhead: 45,                 // road generated ahead of the car (tiles of travel, 40-70)
  lookBehind: 20,                // road kept behind the car (tiles of travel, 18-30)
  speedEase: 3,                  // how fast speed follows the tier speed (1/second, 1-8)
  bgEase: 2,                     // how fast the background colors blend between tiers (1/second, 0.5-5)
  maxDt: 0.05,                   // longest simulated frame (seconds, 0.03-0.1)
  retryDelay: 0.4,               // taps ignored after game over (seconds, 0-1)
  carScreenY: 0.7,               // car's fixed vertical screen position (fraction of height, 0.5-0.8)
  storageKey: "driftclone.best"  // localStorage key for the best score (text)
};

/* ================================= C. CARS ================================ */
// length/width are cosmetic (tiles, 0.5-1.4); speedMult scales tier speed (0.8-1.2)
const CARS = [
  { name: "Red Racer", bodyColor: "#e63946", roofColor: "#f1faee", length: 1.0, width: 0.6,  speedMult: 1.0 },  // EDIT ME
  { name: "Blue Bolt", bodyColor: "#3a86ff", roofColor: "#caf0f8", length: 1.1, width: 0.6,  speedMult: 0.95 }, // EDIT ME
  { name: "Lime Dart", bodyColor: "#80ed99", roofColor: "#22577a", length: 0.9, width: 0.55, speedMult: 1.05 }, // EDIT ME
  { name: "Gold Rush", bodyColor: "#ffbe0b", roofColor: "#3d405b", length: 1.0, width: 0.65, speedMult: 1.1 }   // EDIT ME
];
const SELECTED_CAR = 0; // EDIT ME - index into CARS used at launch (0 to CARS.length-1)

/* ================================ D. LEVELS =============================== */
// startScore = tiles travelled when the tier begins; roadWidth/segMin/segMax in tiles; speed in tiles/second.
// The engine's getLevel(tiles) returns the last tier whose startScore <= tiles.
const LEVELS = [
  { name: "Warm-up", startScore: 0,   roadWidth: 2.2, segMin: 3,   segMax: 9, speed: 3.5,   // EDIT ME
    colors: { bgTop: "#1b1f4b", bgBottom: "#6a4c93", tileA: "#ff9f1c", tileB: "#ffbf69", side: "#a85d12" } },
  { name: "Cruise",  startScore: 40,  roadWidth: 1.9, segMin: 2.5, segMax: 7, speed: 4.5,   // EDIT ME
    colors: { bgTop: "#0b3d4a", bgBottom: "#2a9d8f", tileA: "#48cae4", tileB: "#90e0ef", side: "#0077b6" } },
  { name: "Hustle",  startScore: 120, roadWidth: 1.7, segMin: 2,   segMax: 6, speed: 5.5,   // EDIT ME
    colors: { bgTop: "#3a0ca3", bgBottom: "#f72585", tileA: "#ff5d8f", tileB: "#ff85a1", side: "#8e2461" } },
  { name: "Insane",  startScore: 250, roadWidth: 1.5, segMin: 1.7, segMax: 5, speed: 6.5,   // EDIT ME
    colors: { bgTop: "#02010a", bgBottom: "#3d0c4e", tileA: "#e5e5e5", tileB: "#8d99ae", side: "#2b2d42" } }
];

/* ============================= E. MODS & HOOKS ============================ */
const MODS = {
  godMode: false,        // EDIT ME - true = never fall off (boolean)
  scoreMultiplier: 1,    // EDIT ME - multiplies displayed score only (number, 0.5-10)
  timeScale: 1,          // EDIT ME - game speed multiplier (number, 0.25-2)
  skidMarks: true,       // EDIT ME - leave tyre marks while turning (boolean)
  skidLife: 1.5,         // how long a skid mark stays visible (seconds, 0.5-4)
  showDebug: false       // EDIT ME - show hit point and FPS (boolean)
};
function onStart() {}             // called when a run begins
function onTurn(dir) {}           // called on each heading change; dir is "LEFT" or "RIGHT"
function onScore(n) {}            // called whenever the displayed score changes
function onLevelChange(level) {}  // called when a new LEVELS tier is reached
function onGameOver(score) {}     // called once when the run ends

/* ===================== F. ENGINE - DO NOT EDIT BELOW ====================== */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const HALF_PI = Math.PI / 2;
const view = { s: 30, ox: 0, oy: 0 };                    // s = pixels per tile, ox/oy = screen origin of world (0,0)
const bg = { top: [0, 0, 0], bot: [0, 0, 0] };           // current (blended) background colors
const input = { ptrs: new Set(), space: false, held: false, ignore: false };
let W = 0, H = 0, dpr = 1, ui = 1;                       // canvas size (CSS px), pixel ratio, UI unit
let state = "START", carIdx = SELECTED_CAR % CARS.length;
let car, segs, parts, level, score = 0, best = 0, fallT = 0;
let clock = 0, overAt = 0, fps = 60, nameBox = null, last = 0;

function rand(a, b) { return a + Math.random() * (b - a); }                               // random float in [a,b)
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; } // "#rrggbb" -> [r,g,b]
function rgb(a) { return "rgb(" + a.map(Math.round).join(",") + ")"; }                    // [r,g,b] -> CSS color
function getLevel(tiles) { for (let i = LEVELS.length - 1; i > 0; i--) if (tiles >= LEVELS[i].startScore) return LEVELS[i]; return LEVELS[0]; } // picks tier by tiles travelled
function loadBest() { try { best = parseInt(localStorage.getItem(CONFIG.storageKey), 10) || 0; } catch (e) {} } // reads best score
function saveBest() { try { localStorage.setItem(CONFIG.storageKey, String(best)); } catch (e) {} }           // stores best score

// ---------- track generator ----------
function addSegment() { // appends the next road piece (alternating LEFT/RIGHT) using the current tier's width and colors
  const p = segs[segs.length - 1];
  const dir = p ? 1 - p.dir : 1;                          // 1 = LEFT (+v), 0 = RIGHT (+u)
  const u0 = p ? p.endU : 0, v0 = p ? p.endV : 0;
  const lv = getLevel(Math.floor(u0 + v0));
  const len = p ? rand(lv.segMin, lv.segMax) : CONFIG.firstSegment;
  const h = lv.roadWidth / 2, endU = u0 + (dir === 0 ? len : 0), endV = v0 + (dir === 1 ? len : 0);
  segs.push({ dir, w: lv.roadWidth, colors: lv.colors, endU, endV, minU: u0 - h, maxU: endU + h, minV: v0 - h, maxV: endV + h });
}
function updateTrack() { // generates road ahead of the car and deletes road far behind it
  const p = car.u + car.v;
  let l = segs[segs.length - 1];
  while (l.endU + l.endV < p + CONFIG.lookAhead) { addSegment(); l = segs[segs.length - 1]; }
  while (segs.length > 2 && segs[0].endU + segs[0].endV + segs[0].w < p - CONFIG.lookBehind) segs.shift();
}
function onRoad(u, v) { // true if the point lies inside any road rectangle (+/- edgeForgiveness)
  const e = CONFIG.edgeForgiveness;
  return segs.some(s => u >= s.minU - e && u <= s.maxU + e && v >= s.minV - e && v <= s.maxV + e);
}

// ---------- state machine ----------
function reset() { // builds a fresh world with the car idle on the first segment, heading LEFT
  segs = []; parts = []; addSegment();
  level = getLevel(0);
  car = { u: 0, v: 0, h: 0, vh: 0, dir: 1, ang: HALF_PI, speed: level.speed * CARS[carIdx].speedMult, tilt: 0, tdir: 1 };
  score = 0; updateTrack();
}
function cycleCar() { // switches to the next car on the start screen
  carIdx = (carIdx + 1) % CARS.length;
  car.speed = level.speed * CARS[carIdx].speedMult;
}
function startGame() { // begins a run; the press that did this must not steer
  if (state === "GAME_OVER") reset();
  state = "PLAYING"; input.ignore = true; onStart();
}
function gameOver() { // ends the run, stores best score
  state = "GAME_OVER"; overAt = clock;
  if (score > best) { best = score; saveBest(); }
  onGameOver(score);
}

// ---------- input ----------
function syncHeld() { // recomputes whether any pointer or Space is down
  input.held = input.ptrs.size > 0 || input.space;
  if (!input.held) input.ignore = false;
}
function press(x, y) { // handles a brand-new press (x,y in CSS px; -1 for keyboard)
  if (state === "START") {
    const b = nameBox;
    if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) cycleCar(); else startGame();
  } else if (state === "GAME_OVER" && clock - overAt >= CONFIG.retryDelay) startGame();
}
canvas.addEventListener("pointerdown", e => { // pointer/touch press
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  input.ptrs.add(e.pointerId); syncHeld(); press(e.clientX, e.clientY);
});
function pointerUp(e) { input.ptrs.delete(e.pointerId); syncHeld(); } // pointer/touch release or cancel
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);
window.addEventListener("blur", () => { input.ptrs.clear(); input.space = false; syncHeld(); });
window.addEventListener("keydown", e => { // Space press (key repeat ignored)
  if (e.code !== "Space") return;
  e.preventDefault();
  if (e.repeat || input.space) return;
  input.space = true; syncHeld(); press(-1, -1);
});
window.addEventListener("keyup", e => { // Space release
  if (e.code !== "Space") return;
  e.preventDefault(); input.space = false; syncHeld();
});

// ---------- simulation ----------
function advance(d) { if (car.dir === 0) car.u += d; else car.v += d; } // moves the car d tiles along its heading
function spawnSkid(c) { // drops two tyre marks at the rear wheels
  const fu = Math.cos(car.ang), fv = Math.sin(car.ang);
  for (const k of [-1, 1]) parts.push({
    u: car.u - fu * c.length * 0.3 - fv * k * c.width * 0.4,
    v: car.v - fv * c.length * 0.3 + fu * k * c.width * 0.4, life: MODS.skidLife });
}
function update(dt) { // advances the whole simulation by dt seconds
  const c = CARS[carIdx];
  if (state === "PLAYING") {
    const want = input.held && !input.ignore ? 0 : 1;
    if (want !== car.dir) { car.dir = want; onTurn(want === 0 ? "RIGHT" : "LEFT"); }
    const lv = getLevel(Math.floor(car.u + car.v));
    if (lv !== level) { level = lv; onLevelChange(lv); }
    car.speed += (lv.speed * c.speedMult - car.speed) * (1 - Math.exp(-CONFIG.speedEase * dt));
    advance(car.speed * dt);
    const s = Math.floor(Math.floor(car.u + car.v) * MODS.scoreMultiplier);
    if (s !== score) { score = s; onScore(s); }
    if (!MODS.godMode && !onRoad(car.u, car.v)) { state = "FALLING"; fallT = 0; car.tdir = car.dir === 0 ? 1 : -1; }
    updateTrack();
  } else if (state === "FALLING") {
    fallT += dt; car.vh -= CONFIG.gravity * dt; car.h += car.vh * dt; car.tilt += car.tdir * 3 * dt;
    advance(car.speed * dt);
    if (fallT >= CONFIG.fallTime) gameOver();
  }
  const diff = (car.dir === 0 ? 0 : HALF_PI) - car.ang;   // sprite angle eases; logic heading is already instant
  if (Math.abs(diff) > 1e-4) {
    car.ang += Math.sign(diff) * Math.min(Math.abs(diff), HALF_PI / CONFIG.turnEase * dt);
    if (MODS.skidMarks && state === "PLAYING") spawnSkid(c);
  }
  for (const p of parts) p.life -= dt;
  parts = parts.filter(p => p.life > 0);
  const k = 1 - Math.exp(-CONFIG.bgEase * dt), tt = hex(level.colors.bgTop), tb = hex(level.colors.bgBottom);
  for (let i = 0; i < 3; i++) { bg.top[i] += (tt[i] - bg.top[i]) * k; bg.bot[i] += (tb[i] - bg.bot[i]) * k; }
}

// ---------- rendering ----------
function project(u, v, h) { return [view.ox + (u - v) * view.s, view.oy - (u + v) * view.s / 2 - h * view.s]; } // iso 2:1 world -> screen
function poly(pts, col, dark) { // fills a polygon, optionally with a black shade overlay (alpha 0-1)
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  if (dark) { ctx.fillStyle = "rgba(0,0,0," + dark + ")"; ctx.fill(); }
}
function drawSegment(s) { // draws one road piece: side faces, top face, then alternating stripes
  const P = project, t = CONFIG.thickness * view.s;
  const a = P(s.minU, s.minV, 0), b = P(s.maxU, s.minV, 0), c = P(s.maxU, s.maxV, 0), d = P(s.minU, s.maxV, 0);
  if (c[1] > H || a[1] + t < 0 || d[0] > W || b[0] < 0) return;   // off-screen: skip
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
function drawSkids() { // draws tyre marks as small dark quads on the road plane
  const r = 0.07;
  for (const p of parts) poly([project(p.u - r, p.v - r, 0), project(p.u + r, p.v - r, 0), project(p.u + r, p.v + r, 0), project(p.u - r, p.v + r, 0)],
    "rgba(0,0,0," + (0.4 * p.life / MODS.skidLife) + ")", 0);
}
function drawBox(cu, cv, h0, h1, th, len, wid, col, lean) { // draws an oriented 3D box, far faces first, top last
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
function drawCar() { // draws the car body and cabin at its current angle, height and tilt
  const c = CARS[carIdx], bh = c.width * 0.55, fu = Math.cos(car.ang), fv = Math.sin(car.ang);
  drawBox(car.u, car.v, car.h + 0.03, car.h + bh, car.ang, c.length, c.width, c.bodyColor, car.tilt);
  drawBox(car.u - fu * c.length * 0.08, car.v - fv * c.length * 0.08, car.h + bh, car.h + bh * 1.7, car.ang, c.length * 0.5, c.width * 0.8, c.roofColor, car.tilt);
}
function setFont(size) { ctx.font = "bold " + size + "px system-ui,-apple-system,sans-serif"; } // sets the UI font
function label(str, x, y, size, col, align) { // draws outlined centered text
  setFont(size); ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = size * 0.14; ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.strokeText(str, x, y); ctx.fillStyle = col || "#fff"; ctx.fillText(str, x, y);
}
function drawHUD() { // draws score, start screen, game-over screen and debug info
  const cx = W / 2, pulse = 0.65 + 0.35 * Math.sin(clock * 5);
  nameBox = null;
  if (state === "START") {
    label(CONFIG.title, cx, H * 0.16, ui * 13);
    const nm = "<  " + CARS[carIdx].name + "  >", fs = ui * 6;
    setFont(fs);
    const w = ctx.measureText(nm).width + fs * 1.5, h = fs * 2;
    nameBox = { x: cx - w / 2, y: H * 0.27 - h / 2, w, h };
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(nameBox.x, nameBox.y, w, h);
    label(nm, cx, H * 0.27, fs);
    ctx.globalAlpha = pulse; label(CONFIG.startText, cx, H * 0.88, ui * 6.5); ctx.globalAlpha = 1;
  } else if (state === "GAME_OVER") {
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, W, H);
    label("GAME OVER", cx, H * 0.28, ui * 12);
    label("Score  " + score, cx, H * 0.42, ui * 10);
    label("Best  " + best, cx, H * 0.52, ui * 7);
    ctx.globalAlpha = clock - overAt >= CONFIG.retryDelay ? pulse : 0.3;
    label(CONFIG.retryText, cx, H * 0.7, ui * 6.5); ctx.globalAlpha = 1;
  } else label(String(score), cx, H * 0.1, ui * 18);
  if (MODS.showDebug) {
    const p = project(car.u, car.v, car.h);
    ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fill();
    label("FPS " + Math.round(fps) + "  " + state, 8, 16, 14, "#0f0", "left");
  }
}
function draw() { // renders one frame: background, road far-to-near, skids, car, HUD
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(bg.top)); g.addColorStop(1, rgb(bg.bot));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  view.ox = W / 2 - (car.u - car.v) * view.s;
  view.oy = H * CONFIG.carScreenY + (car.u + car.v) * view.s / 2;
  for (let i = segs.length - 1; i >= 0; i--) drawSegment(segs[i]);
  drawSkids(); drawCar(); drawHUD();
}

// ---------- main loop ----------
function resize() { // fits the canvas to the window, crisp via devicePixelRatio
  dpr = window.devicePixelRatio || 1;
  W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ui = Math.min(W, H * 0.6) / 100; view.s = ui * 100 / CONFIG.tilesAcross;
}
function loop(t) { // main loop: clamped delta-time update, then draw
  const real = (t - last) / 1000; last = t;
  if (real > 0) fps += (1 / real - fps) * 0.1;
  const step = Math.min(real, CONFIG.maxDt);
  clock += step; update(step * MODS.timeScale); draw();
  requestAnimationFrame(loop);
}
loadBest(); resize(); reset();
bg.top = hex(level.colors.bgTop); bg.bot = hex(level.colors.bgBottom);
window.addEventListener("resize", resize);
requestAnimationFrame(loop);
