// js/features/sim/field.js
// Aces Sim: the pixel-art field. Draws the diamond, eight-by-twelve pixel
// players in team colors, the ball and its shadow, and plays one plate
// appearance as a short animation from the engine's play object
// (js/domain/sim-engine.js planPA/commitPA).
//
//   const field = new SimField(canvas);
//   field.setScene({ fieldColor, batColor, bases: [id|null x3], batterId, bats });
//   await field.animate(play, outcome, { speed: 1, speedOf: (id) => rating });
//
// Coordinates are feet (home plate 0,0, y toward center), drawn at SCALE px
// per foot on a 446 x 478 canvas that CSS scales up with crisp pixels. The
// park is Senior Field (FIELD in sim-engine.js has its fence and spots).

import { FIELD, FIELDS, polar, spotXY, fenceAt, deadAt, CONDITIONS } from '../../domain/sim-engine.js';
import { SLOTS } from '../../domain/sim-ratings.js';

export const W = 446;
export const H = 478;
// Each park has its own framing (pixels per foot, and where home plate sits).
// Senior Field shows about -185..157 ft across and -22..345 deep; Field of
// Dreams, with its 280-ft left-field line, about -220..201 across and -25..426 deep.
const VIEWS = { senior: { scale: 1.3, homeX: 241, homeY: 449 }, dreams: { scale: 1.06, homeX: 233, homeY: 452 } };
export let SCALE = VIEWS.senior.scale;
let HOME_X = VIEWS.senior.homeX;
let HOME_Y = VIEWS.senior.homeY;
let PARK = FIELD;
function usePark(key) {
  PARK = FIELDS[key] || FIELD;
  const v = VIEWS[PARK.key] || VIEWS.senior;
  SCALE = v.scale;
  HOME_X = v.homeX;
  HOME_Y = v.homeY;
}
const FAR = FIELD.photoScale;
const far = (p) => ({ x: p.x * FAR, y: p.y * FAR });
const toPxF = (p) => ({ x: HOME_X + p.x * SCALE, y: HOME_Y - p.y * SCALE });
const toPx = (p) => { const q = toPxF(p); return { x: Math.round(q.x), y: Math.round(q.y) }; };
const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const B = FIELD.base / Math.SQRT2;
export const BASES = [{ x: 0, y: 0 }, { x: B, y: B }, { x: 0, y: 2 * B }, { x: -B, y: B }, { x: 0, y: 0 }];
// Where a runner stands at each base (a step off the bag so the bag shows).
const STAND = [{ x: -9, y: 1 }, { x: B + 4, y: B - 3 }, { x: 3, y: 2 * B + 4 }, { x: -B - 4, y: B - 3 }];

const COLORS = {
  grass: '#b39b76', grassDark: '#aa9270', grassDark2: '#a38b68', grassLight: '#bba381', grassGreen: '#93995e',
  dirt: '#dcc39f', dirtDark: '#cbae88', dirtLight: '#e8d3b3', clay: '#a8604a',
  chalk: '#f6f3ea', fence: '#3a3e3b', post: '#262927', foulPole: '#f2c94c',
  hedge: '#56702f', hedgeDark: '#3f5622', hedgeLight: '#71893c',
  tree: '#56783a', treeDark: '#3c5a28', treeLight: '#78964a',
  treeAutumn: '#b9a84a', treeAutumnDark: '#8f8434', treeAutumnLight: '#d4c463',
  path: '#c9c2b3', sidewalk: '#cfc9bb', curb: '#e4e1d8',
  asphalt: '#606366', asphaltDark: '#54575a', asphaltLight: '#6c6f72',
  roof: '#c8cbcc', roofEdge: '#8b8f91', roofShadow: 'rgba(30,32,28,0.45)', roofUnit: '#d9dbdc',
  bleacher: '#b7bcbf', bleacherDark: '#7d8386', bench: '#8b6a45',
  umpShirt: '#22304d', umpPants: '#80858c',
  skin: '#e2b48c', skin2: '#9b6b4a', pants: '#ececec', dark: '#1e1e1e', bat: '#d4a65f', glove: '#7a4a24',
  ball: '#ffffff', shadow: 'rgba(0,0,0,0.35)'
};

// Field of Dreams in summer: green and striped, an orange-tan infield.
const DREAMS_COLORS = {
  grass1: '#5f9b3f', grass2: '#6cab48', grassDark: '#558e37', grassLight: '#79b655',
  rough: '#4f7f35', roughDark: '#46722f', roughLight: '#5b8c3d',
  dirt: '#d9a56c', dirtDark: '#c9925a', dirtLight: '#e6b986',
  windscreen: '#2f4a33', branch: '#5a3d22', branchLight: '#8a6340', court: '#3f6fb0', courtSurround: '#4f8a6a', roadLine: '#e8c547',
  tree: '#3f6e2c', treeDark: '#2c5420', treeLight: '#5c8a3c'
};

// 8 x 12 sprites. c cap, j jersey, s skin, p pants, k dark, . clear
const SPRITES = {
  stand: [
    '..cccc..', '.cccccc.', '..ssss..', '..ssss..', '.jjjjjj.', 'sjjjjjjs',
    's.jjjj.s', '..kkkk..', '..pppp..', '..p..p..', '..p..p..', '.kk..kk.'
  ],
  run1: [
    '..cccc..', '.cccccc.', '..ssss..', '..ssss..', '.jjjjjj.', 'sjjjjjj.',
    '..jjjjs.', '..kkkk..', '..ppp...', '.pp..p..', '.p....p.', 'kk....kk'
  ],
  run2: [
    '..cccc..', '.cccccc.', '..ssss..', '..ssss..', '.jjjjjj.', '.jjjjjjs',
    's.jjjj..', '..kkkk..', '...ppp..', '..p..pp.', '.p....p.', 'kk....kk'
  ],
  ready: [
    '........', '..cccc..', '.cccccc.', '..ssss..', '..ssss..', '.jjjjjj.',
    'sjjjjjjs', 's.jjjj.s', '..kkkk..', '.pp..pp.', '.p....p.', 'kk....kk'
  ],
  // Both hands up: "dead ball!"
  arms: [
    's.cccc.s', 'jccccccj', 'j.ssss.j', 'j.ssss.j', '.jjjjjj.', '.jjjjjj.',
    '..jjjj..', '..kkkk..', '..pppp..', '..p..p..', '..p..p..', '.kk..kk.'
  ]
};

/** Darken a hex color by f (0..1). */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * (1 - f))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(ch).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const spriteCache = new Map();
function sprite(name, color, skin, pants = COLORS.pants) {
  const key = `${name}|${color}|${skin}|${pants}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const rows = SPRITES[name];
  // 10 x 14 with a dark outline, so players stand out on dry grass and dirt.
  const c = document.createElement('canvas');
  c.width = 10; c.height = 14;
  const x = c.getContext('2d');
  const pal = { c: shade(color, 0.3), j: color, s: skin, p: pants, k: COLORS.dark };
  const on = (i, y) => !!pal[rows[y]?.[i]];
  x.fillStyle = 'rgba(25,22,18,0.6)';
  for (let y = -1; y <= 12; y += 1) {
    for (let i = -1; i <= 8; i += 1) {
      if (!on(i, y) && (on(i - 1, y) || on(i + 1, y) || on(i, y - 1) || on(i, y + 1))) x.fillRect(i + 1, y + 1, 1, 1);
    }
  }
  rows.forEach((row, y) => [...row].forEach((ch, i) => {
    if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i + 1, y + 1, 1, 1); }
  }));
  spriteCache.set(key, c);
  return c;
}

// A steady skin tone per player so the same guy looks the same all game.
const skinOf = (id) => {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4 === 0 ? COLORS.skin2 : COLORS.skin;
};

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** A point `d` feet along the base path from base i (0 home .. 4 home). */
function alongBases(from, d) {
  let i = from;
  let left = d;
  while (i < 4 && left > FIELD.base) { left -= FIELD.base; i += 1; }
  if (i >= 4) return { ...BASES[4] };
  const a = BASES[i];
  const b = BASES[i + 1];
  const t = Math.min(1, left / FIELD.base);
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// ---- The road past left field (Field of Dreams) and its traffic ----------

/** The road behind the left-field fence: parallel to it, 80 ft out. Centre line a -> b (feet), unit dir. */
function roadOf(pk) {
  const [lf] = pk.poles;
  const cf = pk.gap ? pk.gap[0] : { x: 0, y: 325 };
  const len = Math.hypot(cf.x - lf.x, cf.y - lf.y);
  const dir = { x: (cf.x - lf.x) / len, y: (cf.y - lf.y) / len };
  const out = { x: -dir.y, y: dir.x };   // away from the field
  const at = (p, along, off) => ({ x: p.x + dir.x * along + out.x * off, y: p.y + dir.y * along + out.y * off });
  const a = at(lf, -230, 80);
  const b = at(cf, 260, 80);
  return { a, b, dir, out, len: Math.hypot(b.x - a.x, b.y - a.y), half: 15, ang: (Math.atan2(dir.y, dir.x) * 180) / Math.PI, at };
}

// Cars, pickups, vans, box trucks and the odd school bus. len x wid in feet.
const VEHICLES = [
  { kind: 'car', len: 14, wid: 6.5, w: 10 },
  { kind: 'suv', len: 15.5, wid: 7, w: 5 },
  { kind: 'pickup', len: 18, wid: 7, w: 4 },
  { kind: 'van', len: 17, wid: 7, w: 2 },
  { kind: 'truck', len: 26, wid: 8, w: 1.5 },
  { kind: 'bus', len: 34, wid: 8, w: 0.6 }
];
const CAR_COLORS = ['#f2f2ef', '#25375a', '#8c1d1d', '#3d4247', '#c9ccd0', '#1f1f1f', '#6b7d8f', '#2e5e3e', '#b8862f', '#5a2a5e'];
const pickVehicle = () => {
  let r = Math.random() * VEHICLES.reduce((t, v) => t + v.w, 0);
  for (const v of VEHICLES) { r -= v.w; if (r <= 0) return v; }
  return VEHICLES[0];
};

export class SimField {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.park = 'senior';
    usePark(this.park);
    this.base = this.drawBackground();
    this.bg = this.base;
    this.cond = CONDITIONS.perfect;
    this.fieldColor = '#1976d2';
    this.batColor = '#d32f2f';
    this.fielders = {};
    this.runners = [];      // { id, x, y, frame }
    this.batter = null;     // { id, x, y, bats, swing }
    this.ball = null;       // { x, y, h }
    this.banner = null;     // { text, color }
    this.marks = [];        // { x, y, text } out marks
    this.ump = { x: 6.5, y: -8.6, frame: 'ready' };   // behind the catcher, peeking over his shoulder
    this.umpSay = null;     // speech bubble text
    this.say = null;        // a fielder's call: { who, text }
    this.raf = 0;
    this.idleRaf = 0;       // a light redraw loop between plays (traffic, wind)
    this.traffic = null;    // { road, lanes: [{ off, sgn, cars, next }], last, flow }
    this.brakeUntil = 0;    // cars stop to watch a home run land
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.startIdle(); });
    this.resetFielders();
    this.draw();
  }

  // ---- Static scene -----------------------------------------------------

  // Senior Field from above, in the fall: dry grass, an all-dirt infield,
  // the fence and hedge across right and center with the gap in right-center,
  // open left field running into the next diamond (its dugouts, bleachers
  // and backstop), the school past center, the lot down the first-base side.
  drawBackground() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    const rand = seeded(20261116);
    const C = COLORS;
    const P = toPxF;
    const path = (pts) => { x.beginPath(); pts.forEach((p, i) => { const q = P(p); if (i) x.lineTo(q.x, q.y); else x.moveTo(q.x, q.y); }); x.closePath(); };
    const poly = (pts, fill) => { path(pts); x.fillStyle = fill; x.fill(); };
    const disc = (p, r, fill) => { const q = P(p); x.beginPath(); x.arc(q.x, q.y, r * SCALE, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); };
    const seg = (a, b, color, w) => { const p = P(a); const q = P(b); x.strokeStyle = color; x.lineWidth = w; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke(); };
    const line = (pts, color, w) => { for (let i = 0; i < pts.length - 1; i += 1) seg(pts[i], pts[i + 1], color, w); };
    const speckle = (n, colors, size = 1) => {
      for (let i = 0; i < n; i += 1) {
        x.fillStyle = colors[Math.floor(rand() * colors.length)];
        x.fillRect(Math.floor(rand() * W), Math.floor(rand() * H), size, size);
      }
    };
    const clipped = (shape, fn) => { x.save(); shape(); x.clip(); fn(); x.restore(); };
    // A rectangle len x wid feet centred on p, its length along angle ang (degrees, math convention).
    const box = (p, len, wid, ang, draw) => {
      const q = P(p);
      x.save();
      x.translate(q.x, q.y);
      x.rotate((-ang * Math.PI) / 180);
      draw(len * SCALE, wid * SCALE);
      x.restore();
    };
    const angOf = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const bleachers = (p, len, ang) => box(p, len, 8, ang, (l, w) => {
      x.fillStyle = C.bleacherDark; x.fillRect(-l / 2, -w / 2, l, w);
      x.fillStyle = C.bleacher;
      for (let r = 0; r < 4; r += 1) x.fillRect(-l / 2, -w / 2 + (r * w) / 4, l, Math.max(1, w / 8));
    });
    const dugout = (p, len, ang) => box(p, len, 7, ang, (l, w) => {
      x.fillStyle = 'rgba(40,40,40,0.18)'; x.fillRect(-l / 2, -w / 2, l, w);
      x.fillStyle = C.bench; x.fillRect(-l / 2 + 2, -1, l - 4, 2);
      x.strokeStyle = C.fence; x.lineWidth = 1; x.strokeRect(-l / 2 + 0.5, -w / 2 + 0.5, l - 1, w - 1);
    });
    const posts = (a, b, every) => {
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / every));
      for (let i = 0; i <= n; i += 1) {
        const q = P(lerpP(a, b, i / n));
        x.fillStyle = C.post;
        x.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 2, 2);
      }
    };

    if (PARK.key === 'dreams') {
      this.drawDreams(x, { P, path, poly, disc, seg, line, speckle, clipped, box, angOf, lerpP, bleachers, dugout, posts, rand });
      return c;
    }

    // Grass everywhere, dry and patchy, greener toward the left.
    x.fillStyle = C.grass;
    x.fillRect(0, 0, W, H);
    [[-150, 120, 34], [-160, 260, 30], [-55, 228, 18], [-125, 60, 22], [-20, 150, 20], [70, 40, 14], [-70, 290, 24], [90, 160, 18]]
      .forEach(([px, py, r]) => {
        const q = P(far({ x: px, y: py }));
        const g = x.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * SCALE * FAR);
        g.addColorStop(0, 'rgba(140,152,92,0.45)');
        g.addColorStop(1, 'rgba(140,152,92,0)');
        x.fillStyle = g;
        x.fillRect(q.x - r * SCALE * FAR, q.y - r * SCALE * FAR, 2 * r * SCALE * FAR, 2 * r * SCALE * FAR);
      });
    speckle(3000, [C.grassDark, C.grassDark, C.grassDark2, C.grassLight], 2);

    // Walkway along the left side, down to the third-base bleachers.
    line([{ x: -172, y: 300 }, { x: -166, y: 178 }, { x: -152, y: 155 }, { x: -84, y: 44 }, { x: -66, y: 20 }].map(far), C.path, 5 * SCALE);

    // The next diamond: all dirt, 60-foot bases, facing back toward our left-center.
    const corners = FIELD.other;
    const oc = { x: corners.reduce((t, p) => t + p.x, 0) / 4, y: corners.reduce((t, p) => t + p.y, 0) / 4 };
    const skin = corners.map((p) => lerpP(oc, p, 1.1));
    const [oh, o1, o2, o3] = corners.map((p) => lerpP(oc, p, 0.86));
    poly(skin, C.dirt);
    clipped(() => path(skin), () => speckle(700, [C.dirtDark, C.dirtLight]));
    const ou = { x: (o2.x - oh.x) / Math.hypot(o2.x - oh.x, o2.y - oh.y), y: (o2.y - oh.y) / Math.hypot(o2.x - oh.x, o2.y - oh.y) };
    const ow = { x: -ou.y, y: ou.x };
    x.globalAlpha = 0.85;
    seg(oh, lerpP(oh, o1, 1.1), C.chalk, 1);
    seg(oh, lerpP(oh, o3, 1.1), C.chalk, 1);
    const orub = lerpP(oh, o2, 0.48);
    const oq = P(orub);
    x.strokeStyle = C.chalk; x.lineWidth = 1;
    x.beginPath(); x.arc(oq.x, oq.y, 8 * SCALE, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 1;
    x.fillStyle = '#ffffff';
    [o1, o2, o3].forEach((b) => { const q = P(b); x.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 4, 4); });
    const ohq = P(oh);
    x.fillRect(Math.round(ohq.x) - 2, Math.round(ohq.y) - 1, 4, 3);
    // Its brick patio, backstop, dugouts and bleachers.
    box({ x: oh.x - ou.x * 15, y: oh.y - ou.y * 15 }, 44, 11, angOf({ x: 0, y: 0 }, ow), (l, w) => { x.fillStyle = C.clay; x.fillRect(-l / 2, -w / 2, l, w); });
    const obc = { x: oh.x - ou.x * 9, y: oh.y - ou.y * 9 };
    line([
      { x: obc.x + ow.x * 16 + ou.x * 7, y: obc.y + ow.y * 16 + ou.y * 7 },
      { x: obc.x + ow.x * 10, y: obc.y + ow.y * 10 },
      { x: obc.x - ow.x * 10, y: obc.y - ow.y * 10 },
      { x: obc.x - ow.x * 16 + ou.x * 7, y: obc.y - ow.y * 16 + ou.y * 7 }
    ], C.fence, 2);
    const [d1a, d1b] = FIELD.dead[1];
    dugout(mid(d1a, d1b), Math.hypot(d1b.x - d1a.x, d1b.y - d1a.y), angOf(d1a, d1b));
    const d3a = far({ x: -159.4, y: 235.2 });
    const d3b = far({ x: -142.8, y: 206.9 });
    dugout(mid(d3a, d3b), Math.hypot(d3b.x - d3a.x, d3b.y - d3a.y), angOf(d3a, d3b));
    bleachers(far({ x: -148, y: 251 }), 16, angOf(oh, o3));
    bleachers(far({ x: -110, y: 144 }), 14, angOf(oh, o1));

    // Parking lot down the first-base side.
    const lotA = { x: 108, y: -24 };
    const lotB = { x: 160, y: 84 };
    const lot = [lotA, lotB, { x: 160, y: -24 }];
    poly(lot, C.asphalt);
    clipped(() => path(lot), () => speckle(300, [C.asphaltDark, C.asphaltLight]));
    const lotLen = Math.hypot(lotB.x - lotA.x, lotB.y - lotA.y);
    const lotDir = { x: (lotB.x - lotA.x) / lotLen, y: (lotB.y - lotA.y) / lotLen };
    const toGrass = { x: -lotDir.y, y: lotDir.x };
    seg({ x: lotA.x + toGrass.x * 3, y: lotA.y + toGrass.y * 3 }, { x: lotB.x + toGrass.x * 3, y: lotB.y + toGrass.y * 3 }, C.sidewalk, 4 * SCALE);
    seg(lotA, lotB, C.curb, 1.5);
    [[0.18, '#f2f2ef'], [0.45, '#25375a']].forEach(([t, col]) => {
      const p = { x: lotA.x + (lotB.x - lotA.x) * t - toGrass.x * 14, y: lotA.y + (lotB.y - lotA.y) * t - toGrass.y * 14 };
      box(p, 14, 6.5, angOf({ x: 0, y: 0 }, toGrass), (l, w) => {
        x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(-l / 2 + 1, -w / 2 + 1, l, w);
        x.fillStyle = col; x.fillRect(-l / 2, -w / 2, l, w);
        x.fillStyle = 'rgba(20,30,40,0.55)'; x.fillRect(-l / 6, -w / 2 + 1, l / 3, w - 2);
      });
    });

    // The school, past center and right-center.
    const roof = [{ x: 22.6, y: 315 }, { x: 31, y: 254 }, { x: 84, y: 262 }, { x: 110, y: 205 }, { x: 142, y: 157 }, { x: 142, y: 315 }].map(far);
    poly(roof.map((p) => ({ x: p.x - 7, y: p.y - 3 })), C.roofShadow);
    poly(roof, C.roof);
    line(roof.slice(0, 5), C.roofEdge, 2);
    [[60, 285, 10, 6], [100, 245, 7, 7], [125, 205, 6, 5], [45, 300, 6, 4]].forEach(([px, py, l, w]) => box(far({ x: px, y: py }), l, w, 0, (L, Wd) => {
      x.fillStyle = C.roofEdge; x.fillRect(-L / 2 + 1, -Wd / 2 + 1, L, Wd);
      x.fillStyle = C.roofUnit; x.fillRect(-L / 2, -Wd / 2, L, Wd);
    }));

    // Our side: brick patio, bleachers.
    poly([{ x: -10, y: -9 }, { x: -36, y: -9 }, { x: -52, y: 9 }, { x: -46, y: 17 }, { x: -30, y: 3 }], C.clay);
    bleachers({ x: -80, y: 30 }, 18, 135);
    bleachers({ x: 43, y: 16 }, 16, 45);

    // The infield: all dirt, a wide round skin that stops just foul of the lines.
    const skinShape = () => {
      const q = P({ x: 0, y: 44 });
      x.beginPath();
      x.ellipse(q.x, q.y, 50 * SCALE, 54 * SCALE, 0, 0, Math.PI * 2);
    };
    clipped(() => path([{ x: 0, y: -10 }, { x: 230, y: 220 }, { x: -230, y: 220 }]), () => { skinShape(); x.fillStyle = C.dirt; x.fill(); });
    disc({ x: 0, y: 0 }, 13, C.dirt);
    clipped(() => {
      skinShape();
      const h = P({ x: 0, y: 0 });
      x.moveTo(h.x + 13 * SCALE, h.y);
      x.arc(h.x, h.y, 13 * SCALE, 0, Math.PI * 2);
    }, () => {
      x.globalAlpha = 0.5;
      disc({ x: 0, y: FIELD.mound }, 6, C.dirtLight);
      disc({ x: 0, y: 0 }, 9, C.dirtDark);
      x.globalAlpha = 1;
      speckle(900, [C.dirtDark, C.dirtLight]);
    });

    // Dugouts and backstop.
    dugout({ x: -27.6, y: 9.2 }, 24, 135);
    dugout({ x: 27.6, y: 9.2 }, 24, 45);
    const back = [{ x: -24, y: 4 }, { x: -12, y: -9 }, { x: 12, y: -9 }, { x: 24, y: 4 }];
    line(back, C.fence, 2);
    back.forEach((p) => { const q = P(p); x.fillStyle = C.post; x.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 3, 3); });

    // Foul lines and batter's boxes.
    x.globalAlpha = 0.9;
    seg(BASES[0], polar(-45, deadAt(-45) ?? 200), C.chalk, 1);
    seg(BASES[0], polar(45, fenceAt(45) ?? 160), C.chalk, 1);
    x.globalAlpha = 1;
    x.strokeStyle = C.chalk;
    x.lineWidth = 1;
    [-1, 1].forEach((side) => {
      const a = P({ x: side * 2.5 + (side < 0 ? -3 : 0), y: 3.5 });
      x.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(3 * SCALE), Math.round(7 * SCALE));
    });

    // The fence in two sections (the gap between them), the hedge behind.
    FIELD.fence.forEach(([f1, f2]) => {
      const len = Math.hypot(f2.x - f1.x, f2.y - f1.y);
      let out = { x: (f2.y - f1.y) / len, y: -(f2.x - f1.x) / len };
      if (out.x * f1.x + out.y * f1.y < 0) out = { x: -out.x, y: -out.y };   // away from home
      const behind = (p, d) => ({ x: p.x + out.x * d, y: p.y + out.y * d });
      seg(behind(f1, 3.5), behind(f2, 3.5), C.hedge, 5 * SCALE);
      for (let i = 0; i < len * 1.6; i += 1) {
        const q = P(behind(lerpP(f1, f2, rand()), 1 + rand() * 6));
        x.fillStyle = rand() < 0.5 ? C.hedgeLight : C.hedgeDark;
        x.fillRect(Math.floor(q.x), Math.floor(q.y), 2, 2);
      }
      seg(f1, f2, C.fence, 1.5);
      posts(f1, f2, 10);
    });
    const pole = P(polar(45, fenceAt(45) ?? 160));
    x.fillStyle = C.foulPole;
    x.fillRect(Math.round(pole.x) - 1, Math.round(pole.y) - 1, 3, 3);

    // Light pole by the right-field corner, and its long shadow.
    x.globalAlpha = 0.35;
    seg({ x: 150, y: 133 }, { x: 84, y: 140 }, '#1a1a1a', 1.5);
    [[81, 142], [81, 138], [78, 142], [78, 138]].forEach(([px, py]) => disc({ x: px, y: py }, 1, '#1a1a1a'));
    x.globalAlpha = 1;
    disc({ x: 150, y: 133 }, 1.4, C.post);

    // Trees: shadows (cast toward left field) first, then canopies.
    const trees = [
      ...[[96, 73, 15, 0], [18, 246, 7, 0], [-156, 201, 5, 1],
        [-120, 50, 16, 0], [-145, 68, 15, 0], [-100, -13, 13, 0], [-140, 8, 17, 0], [-80, -18, 11, 1], [-158, 110, 10, 0]]
        .map(([px, py, r, k]) => [px * FAR, py * FAR, r * FAR, k]),
      [48, 248, 6.5, 1], [71, 238, 6.5, 1],   // the two yellow trees at the gap
      [-12, -15, 6, 0], [14, -17, 6, 0], [42, -19, 4, 1]
    ];
    trees.forEach(([px, py, r]) => {
      x.globalAlpha = 0.4;
      disc({ x: px - r * 1.1, y: py - 1 }, r * 0.95, '#2a2f22');
      x.globalAlpha = 1;
    });
    trees.forEach(([px, py, r, autumn]) => {
      const [base, dark, light] = autumn ? [C.treeAutumn, C.treeAutumnDark, C.treeAutumnLight] : [C.tree, C.treeDark, C.treeLight];
      disc({ x: px, y: py }, r, dark);
      disc({ x: px + r * 0.12, y: py + r * 0.12 }, r * 0.85, base);
      clipped(() => { const q = P({ x: px, y: py }); x.beginPath(); x.arc(q.x, q.y, r * SCALE, 0, Math.PI * 2); }, () => {
        for (let i = 0; i < r * 9; i += 1) {
          const ang = rand() * Math.PI * 2;
          const rr = Math.sqrt(rand()) * r;
          const q = P({ x: px + Math.cos(ang) * rr, y: py + Math.sin(ang) * rr });
          x.fillStyle = rand() < 0.5 ? dark : light;
          x.fillRect(Math.floor(q.x), Math.floor(q.y), 2, 2);
        }
      });
    });

    // Bases, plate, rubber.
    x.fillStyle = '#ffffff';
    [BASES[1], BASES[2], BASES[3]].forEach((b) => { const p = toPx(b); x.fillRect(p.x - 2, p.y - 2, 5, 5); });
    const hp = toPx(BASES[0]);
    x.fillRect(hp.x - 3, hp.y - 2, 7, 3);
    x.fillRect(hp.x - 1, hp.y + 1, 3, 2);
    const pr = toPx({ x: 0, y: FIELD.mound });
    x.fillRect(pr.x - 3, pr.y, 7, 2);
    return c;
  }

  // Field of Dreams from above, in summer: striped green grass, a big dirt
  // infield, fence all the way around (tall in left, lower in right, the
  // open corner in right and the hole in center), the tree branch in
  // right-center, trees and the road past left, the tennis courts down the
  // right-field side, the lot and the building down the left side. The
  // light poles stand outside the fence.
  drawDreams(x, h) {
    const { P, path, poly, disc, seg, line, speckle, clipped, box, angOf, lerpP, bleachers, dugout, posts, rand } = h;
    const C = { ...COLORS, ...DREAMS_COLORS };
    const pk = PARK;
    const [lfPole, rfPole] = pk.poles;
    const fencePts = [lfPole, ...pk.fence.map(([, q]) => q)];   // left-field pole round to the open corner

    // Everything outside the park: deep green, then the road past left and center.
    x.fillStyle = C.rough;
    x.fillRect(0, 0, W, H);
    speckle(1800, [C.roughDark, C.roughLight], 2);
    // The road, parallel to the left-field fence and 80 ft past it.
    const rd = roadOf(pk);
    const lane = [rd.at(rd.a, 0, -rd.half), rd.at(rd.a, rd.len, -rd.half), rd.at(rd.a, rd.len, rd.half), rd.at(rd.a, 0, rd.half)];
    poly(lane, C.asphalt);
    clipped(() => path(lane), () => speckle(500, [C.asphaltDark, C.asphaltLight]));
    seg(lane[0], lane[1], C.curb, 2);
    seg(lane[3], lane[2], C.curb, 2);
    for (let i = 0; i < 40; i += 1) seg(rd.at(rd.a, i * 18, 0), rd.at(rd.a, i * 18 + 8, 0), C.roadLine, 1.5);

    // The park: striped grass inside the fence and down both foul sides.
    const park = [{ x: 0, y: -24 }, { x: -96, y: -24 }, { x: -205, y: 120 }, lfPole, ...fencePts.slice(1), rfPole, { x: 172, y: 150 }, { x: 96, y: -24 }];
    clipped(() => path(park), () => {
      x.fillStyle = C.grass1;
      x.fillRect(0, 0, W, H);
      x.fillStyle = C.grass2;
      for (let k = -40; k < 40; k += 2) {
        const a = { x: k * 14, y: -40 };
        box({ x: a.x + 300 * Math.SQRT1_2, y: a.y + 300 * Math.SQRT1_2 }, 900, 14, 45, (l, w) => x.fillRect(-l / 2, -w / 2, l, w));
      }
      speckle(1500, [C.grassDark, C.grassLight], 1);
    });

    // Trees: a row past the fence from left round to right, thick behind left and center.
    const trees = [];
    for (let i = 0; i <= 40; i += 1) {
      const t = i / 40;
      const seg2 = Math.min(fencePts.length - 2, Math.floor(t * (fencePts.length - 1)));
      const u = t * (fencePts.length - 1) - seg2;
      const p = lerpP(fencePts[seg2], fencePts[seg2 + 1], u);
      const r = Math.hypot(p.x, p.y);
      const out = 22 + rand() * 12;
      trees.push([p.x * (r + out) / r, p.y * (r + out) / r, 11 + rand() * 6]);
    }
    [[200, 120, 14], [205, 210, 16], [180, 250, 15], [-215, 90, 13], [-200, 40, 12], [-90, -20, 12], [-140, -10, 10], [150, -16, 11]]
      .forEach((t) => trees.push(t));
    trees.forEach(([px, py, r]) => { x.globalAlpha = 0.35; disc({ x: px - r * 0.9, y: py - 2 }, r * 0.95, '#1f2a18'); x.globalAlpha = 1; });
    trees.forEach(([px, py, r]) => {
      disc({ x: px, y: py }, r, C.treeDark);
      disc({ x: px + r * 0.12, y: py + r * 0.12 }, r * 0.85, C.tree);
      clipped(() => { const q = P({ x: px, y: py }); x.beginPath(); x.arc(q.x, q.y, r * SCALE, 0, Math.PI * 2); }, () => {
        for (let i = 0; i < r * 8; i += 1) {
          const ang = rand() * Math.PI * 2;
          const rr = Math.sqrt(rand()) * r;
          const q = P({ x: px + Math.cos(ang) * rr, y: py + Math.sin(ang) * rr });
          x.fillStyle = rand() < 0.5 ? C.treeDark : C.treeLight;
          x.fillRect(Math.floor(q.x), Math.floor(q.y), 2, 2);
        }
      });
    });

    // Tennis courts past the right-field side (foul), behind their own fence.
    const courtAng = 45;
    const cc = { x: 170, y: 52 };
    box(cc, 120, 74, courtAng, (l, w) => {
      x.fillStyle = C.courtSurround; x.fillRect(-l / 2, -w / 2, l, w);
      [-1, 1].forEach((k) => {
        const cx = k * l * 0.24;
        x.fillStyle = C.court; x.fillRect(cx - l * 0.2, -w * 0.32, l * 0.4, w * 0.64);
        x.strokeStyle = C.chalk; x.lineWidth = 1;
        x.strokeRect(cx - l * 0.2 + 0.5, -w * 0.32 + 0.5, l * 0.4, w * 0.64);
        x.beginPath(); x.moveTo(cx, -w * 0.32); x.lineTo(cx, w * 0.32); x.stroke();
        x.beginPath(); x.moveTo(cx - l * 0.2, 0); x.lineTo(cx + l * 0.2, 0); x.stroke();
      });
      x.strokeStyle = C.fence; x.lineWidth = 1.5; x.strokeRect(-l / 2 + 0.5, -w / 2 + 0.5, l - 1, w - 1);
    });

    // The lot and the building down the left side, behind third.
    const lot = [{ x: -96, y: -24 }, { x: -205, y: 120 }, { x: -235, y: 120 }, { x: -235, y: -24 }];
    poly(lot, C.asphalt);
    clipped(() => path(lot), () => speckle(300, [C.asphaltDark, C.asphaltLight]));
    seg({ x: -96, y: -24 }, { x: -205, y: 120 }, C.curb, 2);
    ['#f2f2ef', '#25375a', '#8c1d1d', '#3d4247', '#c9ccd0'].forEach((col, i) => {
      const p = lerpP({ x: -118, y: -6 }, { x: -196, y: 98 }, (i + 0.4) / 5);
      box({ x: p.x - 9, y: p.y + 4 }, 14, 6.5, 143, (l, w) => {
        x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(-l / 2 + 1, -w / 2 + 1, l, w);
        x.fillStyle = col; x.fillRect(-l / 2, -w / 2, l, w);
        x.fillStyle = 'rgba(20,30,40,0.55)'; x.fillRect(-l / 6, -w / 2 + 1, l / 3, w - 2);
      });
    });
    poly([{ x: -235, y: -24 }, { x: -235, y: 40 }, { x: -200, y: 40 }, { x: -200, y: -24 }], C.roof);
    line([{ x: -200, y: -24 }, { x: -200, y: 40 }, { x: -235, y: 40 }], C.roofEdge, 2);

    // The infield: a big dirt skin with a round front edge.
    const skinShape = () => {
      const q = P({ x: 0, y: 50 });
      x.beginPath();
      x.ellipse(q.x, q.y, 64 * SCALE, 70 * SCALE, 0, 0, Math.PI * 2);
    };
    clipped(() => path([{ x: 0, y: -12 }, { x: 260, y: 250 }, { x: -260, y: 250 }]), () => { skinShape(); x.fillStyle = C.dirt; x.fill(); });
    disc({ x: 0, y: 0 }, 14, C.dirt);
    clipped(() => {
      skinShape();
      const hq = P({ x: 0, y: 0 });
      x.moveTo(hq.x + 14 * SCALE, hq.y);
      x.arc(hq.x, hq.y, 14 * SCALE, 0, Math.PI * 2);
    }, () => {
      x.globalAlpha = 0.5;
      disc({ x: 0, y: pk.mound }, 6, C.dirtLight);
      x.globalAlpha = 1;
      speckle(900, [C.dirtDark, C.dirtLight]);
    });

    // Benches, bleachers and the backstop.
    dugout({ x: -30, y: 11 }, 26, 135);
    dugout({ x: 30, y: 11 }, 26, 45);
    bleachers({ x: -52, y: 22 }, 16, 135);
    bleachers({ x: 52, y: 22 }, 16, 45);
    const back = [{ x: -26, y: 4 }, { x: -13, y: -10 }, { x: 13, y: -10 }, { x: 26, y: 4 }];
    line(back, C.fence, 2);
    back.forEach((p) => { const q = P(p); x.fillStyle = C.post; x.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 3, 3); });

    // Foul lines and batter's boxes.
    x.globalAlpha = 0.9;
    seg(BASES[0], lfPole, C.chalk, 1);
    seg(BASES[0], rfPole, C.chalk, 1);
    x.globalAlpha = 1;
    x.strokeStyle = C.chalk;
    x.lineWidth = 1;
    [-1, 1].forEach((side) => {
      const a = P({ x: side * 2.5 + (side < 0 ? -3 : 0), y: 3.5 });
      x.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(3 * SCALE), Math.round(7 * SCALE));
    });

    // The fence: double height in left (drawn heavy, with its shadow), lower round to right.
    // The foul-side fences run back toward the plate.
    line([lfPole, { x: -205, y: 120 }], C.fence, 1.5);
    line([rfPole, { x: 172, y: 150 }], C.fence, 1.5);
    pk.fence.forEach(([f1, f2], i) => {
      const tall = i === 0;
      if (tall) {
        x.globalAlpha = 0.3;
        seg({ x: f1.x - 4, y: f1.y + 3 }, { x: f2.x - 4, y: f2.y + 3 }, '#1a1a1a', 4 * SCALE);
        x.globalAlpha = 1;
      }
      seg(f1, f2, tall ? C.windscreen : C.fence, tall ? 3.5 : 1.5);
      posts(f1, f2, tall ? 8 : 10);
    });
    // Foul poles (the right one stands at the open corner).
    [lfPole, rfPole].forEach((p) => { const q = P(p); x.fillStyle = C.foulPole; x.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 3, 3, 5); });

    // The tree branch lying in right-center, in front of the fence.
    const [b1, b2] = pk.dead[0];
    x.globalAlpha = 0.35;
    seg({ x: b1.x - 2, y: b1.y - 1 }, { x: b2.x - 2, y: b2.y - 1 }, '#1a1a1a', 4);
    x.globalAlpha = 1;
    seg(b1, b2, C.branch, 4);
    seg(lerpP(b1, b2, 0.1), lerpP(b1, b2, 0.9), C.branchLight, 1);
    [[0.3, 5, 8], [0.55, -4, -7], [0.8, 6, 5], [0.15, -3, 6]].forEach(([t, dx, dy]) => {
      const q = lerpP(b1, b2, t);
      seg(q, { x: q.x + dx, y: q.y + dy }, C.branch, 2);
    });
    for (let i = 0; i < 40; i += 1) {
      const p = lerpP(b1, b2, rand());
      const q = P({ x: p.x + (rand() - 0.5) * 8, y: p.y + (rand() - 0.5) * 8 });
      x.fillStyle = rand() < 0.5 ? C.treeLight : C.tree;
      x.fillRect(Math.floor(q.x), Math.floor(q.y), 2, 2);
    }

    // Light poles, outside the fence, and their shadows.
    [[-212, 175], [-70, 318], [72, 300], [178, 160]].forEach(([px, py]) => {
      x.globalAlpha = 0.3;
      seg({ x: px, y: py }, { x: px - 26, y: py + 4 }, '#1a1a1a', 1.5);
      x.globalAlpha = 1;
      disc({ x: px, y: py }, 1.6, C.post);
    });

    // Bases, plate, rubber.
    x.fillStyle = '#ffffff';
    [BASES[1], BASES[2], BASES[3]].forEach((b) => { const p = toPx(b); x.fillRect(p.x - 2, p.y - 2, 5, 5); });
    const hp = toPx(BASES[0]);
    x.fillRect(hp.x - 3, hp.y - 2, 7, 3);
    x.fillRect(hp.x - 1, hp.y + 1, 3, 2);
    const pr = toPx({ x: 0, y: pk.mound });
    x.fillRect(pr.x - 3, pr.y, 7, 2);
  }

  /** Switch parks ('senior' or 'dreams'): new framing and a new background. */
  setPark(key) {
    const k = FIELDS[key] ? key : 'senior';
    if (k === this.park) return;
    this.park = k;
    usePark(k);
    this.traffic = k === 'dreams' ? { road: roadOf(PARK), lanes: [{ off: -6.5, sgn: 1, cars: [], next: 0 }, { off: 6.5, sgn: -1, cars: [], next: 0 }], last: 0, flow: 1 } : null;
    this.base = this.drawBackground();
    this.setConditions(this.condId || 'perfect');
  }

  /** Keep redrawing between plays while something is moving (traffic, wind): ~30 fps, never in a hidden tab. */
  startIdle() {
    if (this.idleRaf) return;
    const loop = (now) => {
      this.idleRaf = 0;
      const moving = this.traffic || this.cond?.wind;
      if (!moving || document.hidden || !this.canvas.isConnected || this.canvas.offsetParent === null) return;
      if (!this.raf && now - (this.idleAt || 0) > 33) { this.idleAt = now; this.draw(); }
      this.idleRaf = requestAnimationFrame(loop);
    };
    this.idleRaf = requestAnimationFrame(loop);
  }

  /** Move the cars along (and send new ones) up to time now. */
  updateTraffic(now) {
    const T = this.traffic;
    if (!T) return;
    const dt = T.last ? Math.min(0.1, (now - T.last) / 1000) : 0;
    T.last = now;
    // Everyone eases to a stop while a home run comes down, then pulls away.
    const target = now < this.brakeUntil ? 0 : 1;
    T.flow += (target - T.flow) * Math.min(1, dt * (target ? 0.8 : 2.5));
    const L = T.road.len;
    for (const lane of T.lanes) {
      if (now >= lane.next) {
        const v = pickVehicle();
        const lead = lane.cars[lane.cars.length - 1];
        const room = !lead || (lane.sgn > 0 ? lead.s - lead.len : L - lead.s - lead.len) > 30;
        if (room) {
          const speed = 36 + Math.random() * 14;   // feet a second: 25-34 mph
          const color = v.kind === 'bus' ? '#f2b705' : v.kind === 'truck' ? '#f4f4f1' : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
          lane.cars.push({ ...v, s: lane.sgn > 0 ? -v.len : L + v.len, v: lead ? Math.min(speed, lead.v) : speed, color });
        }
        lane.next = now + 2500 + Math.random() * 7000;
      }
      for (const c of lane.cars) c.s += lane.sgn * c.v * T.flow * dt;
      lane.cars = lane.cars.filter((c) => c.s > -60 && c.s < L + 60);
    }
  }

  drawTraffic() {
    const T = this.traffic;
    if (!T) return;
    const ctx = this.ctx;
    const { road } = T;
    for (const lane of T.lanes) {
      for (const c of lane.cars) {
        const p = toPxF(road.at(road.a, c.s, lane.off));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((-(road.ang + (lane.sgn < 0 ? 180 : 0)) * Math.PI) / 180);
        const l = c.len * SCALE;
        const w = c.wid * SCALE;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(-l / 2 + 1, -w / 2 + 1, l, w);
        ctx.fillStyle = c.color;
        ctx.fillRect(-l / 2, -w / 2, l, w);
        ctx.fillStyle = 'rgba(20,30,40,0.6)';
        if (c.kind === 'truck') {
          ctx.fillStyle = '#c0392b'; ctx.fillRect(l / 2 - l * 0.22, -w / 2, l * 0.22, w);   // the cab
          ctx.fillStyle = 'rgba(20,30,40,0.6)'; ctx.fillRect(l / 2 - l * 0.1, -w / 2 + 1, l * 0.06, w - 2);
        } else if (c.kind === 'pickup') {
          ctx.fillRect(l * 0.02, -w / 2 + 1, l * 0.14, w - 2);                                    // windshield
          ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(-l / 2 + 1, -w / 2 + 1, l * 0.42, w - 2);   // the bed
        } else if (c.kind === 'bus') {
          ctx.fillRect(l / 2 - l * 0.08, -w / 2 + 1, l * 0.05, w - 2);
          ctx.fillStyle = 'rgba(20,30,40,0.35)';
          for (let i = 0; i < 6; i += 1) ctx.fillRect(-l / 2 + 2 + i * l * 0.13, -w / 2, l * 0.08, 1);
        } else {
          ctx.fillRect(l * 0.12, -w / 2 + 1, l * 0.14, w - 2);                                    // windshield
          ctx.fillRect(-l * 0.32, -w / 2 + 1, l * 0.1, w - 2);                                    // back window
        }
        ctx.restore();
      }
    }
  }

  /** Weather: tints the field, adds puddles when wet, wind streaks when windy. */
  setConditions(id) {
    const c = CONDITIONS[id] || CONDITIONS.perfect;
    this.cond = c;
    this.condId = id;
    const v = document.createElement('canvas');
    v.width = W;
    v.height = H;
    const x = v.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(this.base, 0, 0);
    if (c.wet) {
      x.fillStyle = 'rgba(45,55,40,0.2)';
      x.fillRect(0, 0, W, H);
      const rand = seeded(7);
      // Puddles: on the infield dirt and in the low spots of the grass.
      [[-22, 30, 7], [24, 58, 6], [-6, 10, 4], [40, 40, 5], [-40, 46, 5],
        [-70, 130, 10], [85, 150, 8], [-120, 250, 9], [10, 200, 7], [-30, 90, 6]].forEach(([px, py, r]) => {
        const q = toPxF({ x: px, y: py });
        const rx = r * SCALE * (0.8 + rand() * 0.5);
        const ry = rx * (0.45 + rand() * 0.2);
        x.fillStyle = 'rgba(88,104,112,0.55)';
        x.beginPath(); x.ellipse(q.x, q.y, rx, ry, rand() * Math.PI, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(210,225,232,0.35)';
        x.fillRect(Math.round(q.x - rx / 3), Math.round(q.y - ry / 3), Math.max(2, Math.round(rx / 2)), 1);
      });
    }
    if (c.tint === 'cold') { x.fillStyle = 'rgba(110,128,148,0.24)'; x.fillRect(0, 0, W, H); }
    if (c.tint === 'hot') { x.fillStyle = 'rgba(255,196,90,0.10)'; x.fillRect(0, 0, W, H); }
    this.bg = v;
    this.draw();
    this.startIdle();
  }

  drawWind() {
    const wind = this.cond?.wind;
    if (!wind) return;
    const ctx = this.ctx;
    // Direction in canvas pixels: out = toward the right-field corner, in = from center toward home.
    const d = wind === 'out' ? { x: Math.SQRT1_2, y: -Math.SQRT1_2 } : { x: 0, y: 1 };
    const t = performance.now() / 1000;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i += 1) {
      const u = ((i * 0.37 + t * 0.35) % 1);
      const sx = ((i * 97) % W) + d.x * u * 140 - d.x * 70;
      const sy = ((i * 61) % H) + d.y * u * 140 - d.y * 70;
      ctx.beginPath();
      ctx.moveTo(Math.round(sx), Math.round(sy));
      ctx.lineTo(Math.round(sx + d.x * 9), Math.round(sy + d.y * 9));
      ctx.stroke();
    }
    // Wind sock badge, top left.
    const label = wind === 'out' ? 'WIND OUT TO RIGHT' : 'WIND BLOWING IN';
    ctx.font = '600 9px Inter, sans-serif';
    const w = ctx.measureText(label).width + 30;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(6, 6, Math.round(w), 18);
    const cx = 16;
    const cy = 15;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - d.x * 5, cy - d.y * 5);
    ctx.lineTo(cx + d.x * 5, cy + d.y * 5);
    ctx.stroke();
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(cx + d.x * 6, cy + d.y * 6);
    ctx.lineTo(cx + d.x * 2 - d.y * 3, cy + d.y * 2 + d.x * 3);
    ctx.lineTo(cx + d.x * 2 + d.y * 3, cy + d.y * 2 - d.x * 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(label, 26, 18);
  }

  resetFielders() {
    // Whoever is out there (eight, nine or ten), plus the catcher (a courtesy one if need be).
    const slots = this.fielderIds ? [...new Set(['C', ...Object.keys(this.fielderIds)])] : SLOTS;
    this.fielders = Object.fromEntries(slots.map((s) => {
      const p = spotXY(s, PARK);
      return [s, { slot: s, x: p.x, y: p.y, frame: 'ready', ball: false }];
    }));
  }

  /**
   * The scene between plays.
   * @param {object} s { fieldColor, batColor, bases: [id|null x3], batterId, bats, fielderIds?: {slot: id} }
   */
  setScene(s) {
    if (s.fieldColor) this.fieldColor = s.fieldColor;
    if (s.batColor) this.batColor = s.batColor;
    if (s.fielderIds) this.fielderIds = s.fielderIds;
    this.resetFielders();
    this.runners = (s.bases || []).map((id, i) => (id ? { id, ...STAND[i + 1], frame: 'stand' } : null)).filter(Boolean);
    this.batter = s.batterId ? { id: s.batterId, x: s.bats === 'L' ? 9 : -9, y: 1, bats: s.bats, swing: 0 } : null;
    this.ball = null;
    this.banner = null;
    this.marks = [];
    this.umpSay = null;
    this.say = null;
    this.zuke = null;
    this.draw();
  }

  // ---- Drawing ----------------------------------------------------------

  drawPerson(p, color, id, pants) {
    const ctx = this.ctx;
    const pt = toPx(p);
    ctx.fillStyle = COLORS.shadow;
    ctx.fillRect(pt.x - 3, pt.y, 7, 2);
    const img = sprite(p.frame || 'stand', color, skinOf(id), pants);
    ctx.drawImage(img, pt.x - 5, pt.y - 13);
    if (p.ball) {
      ctx.fillStyle = COLORS.glove;
      ctx.fillRect(pt.x + 3, pt.y - 7, 2, 2);
    }
  }

  drawBatter() {
    const b = this.batter;
    if (!b || b.gone) return;
    this.drawPerson({ ...b, frame: 'stand' }, this.batColor, b.id);
    const ctx = this.ctx;
    const pt = toPx(b);
    const dir = b.bats === 'L' ? -1 : 1; // which way he swings
    // Bat: up behind the head, then around through the zone.
    const hand = { x: pt.x + (b.bats === 'L' ? -2 : 2), y: pt.y - 7 };
    const ang = b.swing ? lerp(-2.2, 0.6, b.swing) : -2.2;
    const len = 8;
    ctx.strokeStyle = COLORS.bat;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    ctx.lineTo(Math.round(hand.x + dir * Math.cos(ang) * len), Math.round(hand.y + Math.sin(ang) * len));
    ctx.stroke();
  }

  draw() {
    const ctx = this.ctx;
    ctx.drawImage(this.bg, 0, 0);
    if (this.traffic) {
      this.updateTraffic(performance.now());
      this.drawTraffic();
    }
    // Back to front so nearer players overlap farther ones.
    const people = [
      // With eight, the batting team's courtesy catcher stands in (in their colors).
      ...Object.values(this.fielders).map((f) => ({
        p: f,
        color: f.slot === 'C' && this.fielderIds && !this.fielderIds.C ? this.batColor : this.fieldColor,
        id: this.fielderIds?.[f.slot] || f.slot
      })),
      { p: this.ump, color: COLORS.umpShirt, id: 'ump', pants: COLORS.umpPants },
      ...this.runners.filter((r) => !r.gone).map((r) => ({ p: r, color: this.batColor, id: r.id }))
    ].sort((a, b) => b.p.y - a.p.y);
    people.forEach(({ p, color, id, pants }) => this.drawPerson(p, color, id, pants));
    this.drawBatter();

    for (const m of this.marks) {
      const pt = toPx(m);
      ctx.fillStyle = '#b42318';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.text, pt.x, pt.y - 16);
    }

    if (this.ball) {
      const g = toPx(this.ball);
      ctx.fillStyle = COLORS.shadow;
      ctx.fillRect(g.x - 1, g.y, 3, 1);
      const yy = Math.round(g.y - this.ball.h * 0.8);
      ctx.fillStyle = 'rgba(40,30,20,0.5)';
      ctx.fillRect(g.x - 2, yy - 2, 4, 4);
      ctx.fillStyle = COLORS.ball;
      ctx.fillRect(g.x - 1, yy - 1, 2, 2);
    }

    this.drawUmpBubble();
    if (this.say) this.drawBubble(this.say.who, this.say.text);
    if (this.zuke !== null && this.zuke !== undefined) this.drawZuke(this.zuke);
    this.drawWind();

    if (this.banner) {
      ctx.font = '20px "Bebas Neue", "Arial Narrow", sans-serif';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(this.banner.text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(Math.round(W / 2 - tw / 2 - 10), 14, Math.round(tw + 20), 26);
      ctx.fillStyle = this.banner.color || '#ffd700';
      ctx.fillText(this.banner.text, W / 2, 34);
    }
  }

  /**
   * Zuke, the home-run zucchini: pops up in the top-right corner after a
   * ball clears the fence and dances (shuffle, shuffle, hop, spin, arms up).
   * @param {number} ms  time since he came out
   */
  drawZuke(ms) {
    const ctx = this.ctx;
    const S = 2;                                  // one art pixel = 2 x 2 screen pixels
    const STEPS = ['L', 'R', 'L', 'R', 'hop', 'hop', 'side', 'back', 'side2', 'front', 'up', 'up'];
    const beat = Math.floor(ms / 280);
    const step = STEPS[beat % STEPS.length];
    const inBeat = (ms % 280) / 280;
    const pop = Math.min(1, ms / 220);            // rises into view
    const lean = step === 'L' ? -1 : step === 'R' ? 1 : 0;
    const hop = step === 'hop' ? Math.round(Math.sin(inBeat * Math.PI) * 5) : 0;
    const narrow = step === 'side' || step === 'side2';
    const cx = W - 40 + lean * 3;
    const foot = 74 - hop + Math.round((1 - pop) * 30);
    const px = (x, y, color, w = 1, h = 1) => { ctx.fillStyle = color; ctx.fillRect(Math.round(cx + x * S), Math.round(foot - y * S), w * S, h * S); };
    const DARK = '#1f4a1c';
    const BODY = '#2f6b2a';
    const LIGHT = '#5d9a45';
    const STEM = '#7a6a2e';

    ctx.save();
    ctx.globalAlpha = pop;
    // A soft spotlight so he stands out on any background.
    const gy = foot - 22;
    const glow = ctx.createRadialGradient(cx, gy, 2, cx, gy, 34);
    glow.addColorStop(0, 'rgba(255,244,190,0.6)');
    glow.addColorStop(1, 'rgba(255,244,190,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 34, gy - 34, 68, 68);
    // Shadow on the ground.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round(cx - 6 * S), 74 + 1, 12 * S, 2);

    // Legs (rows 0-3) and feet.
    const legL = step === 'R' ? 1 : 0;            // kick the off leg
    const legR = step === 'L' ? 1 : 0;
    px(-2, 3 + legL, DARK, 1, 3); px(-3 - legL, 0 + legL, DARK, 2, 1);
    px(1, 3 + legR, DARK, 1, 3); px(1, 0 + legR, DARK, 2 + legR, 1);

    // Body: a long zucchini (rows 3-20), rounded at both ends, leaning with the beat.
    const half = narrow ? [1, 2, 2, 2] : [1, 2, 3, 3];
    for (let r = 3; r <= 20; r += 1) {
      const fromEnd = Math.min(r - 3, 20 - r);
      const hw = half[Math.min(3, fromEnd)];
      const sh = Math.round(lean * ((r - 3) / 17) * 2);
      px(-hw + sh - 0.5, r + 1, DARK, hw * 2 + 1, 1);                 // outline
      px(-hw + sh, r + 1, BODY, hw * 2, 1);
      if ((r + (step === 'back' ? 1 : 0)) % 3 === 0) px(-hw + sh + 1, r + 1, LIGHT, 1, 1);   // speckled stripes
      if ((r + 1) % 4 === 0 && hw > 1) px(hw + sh - 2, r + 1, LIGHT, 1, 1);
    }
    const top = Math.round(lean * 2);
    px(top - 0.5, 23, STEM, 1, 2);                                      // the stem
    px(top + 0.5, 24, STEM, 1, 1);

    // Face (not from behind).
    if (step !== 'back') {
      const fx = top + (step === 'side' ? 1 : step === 'side2' ? -1 : 0);
      if (narrow) {
        px(fx - 0.5, 18, '#ffffff', 1, 2); px(fx - 0.5, 17, '#111111', 1, 1);
      } else {
        px(fx - 2, 18, '#ffffff', 2, 2); px(fx + 1, 18, '#ffffff', 2, 2);
        px(fx - 1, 17, '#111111', 1, 1); px(fx + 2, 17, '#111111', 1, 1);
        px(fx - 1, 14, '#111111', 3, 1); px(fx - 2, 15, '#111111', 1, 1); px(fx + 2, 15, '#111111', 1, 1);   // a big smile
      }
    }

    // Arms, by step.
    const arm = (side, pose) => {
      const x0 = side < 0 ? -4 + lean : 3 + lean;
      if (pose === 'up') { px(x0, 19, DARK, 1, 6); px(x0 + side, 21, DARK, 1, 2); }
      else if (pose === 'out') { px(side < 0 ? x0 - 3 : x0, 13, DARK, 4, 1); }
      else { px(x0, 13, DARK, 1, 5); }
    };
    if (!narrow) {
      const pose = (side) => {
        if (step === 'up' || step === 'hop') return step === 'hop' ? 'out' : 'up';
        if (step === 'L') return side < 0 ? 'up' : 'down';
        if (step === 'R') return side > 0 ? 'up' : 'down';
        return 'down';
      };
      arm(-1, pose(-1));
      arm(1, pose(1));
    } else {
      px(step === 'side' ? -1 : 0, 13, DARK, 1, 5);
    }
    ctx.restore();
  }

  /** The ump's call, in a little speech bubble beside him. */
  drawUmpBubble() {
    if (this.umpSay) this.drawBubble(this.ump, this.umpSay);
  }

  /** A speech bubble over a person on the field. */
  drawBubble(who, text) {
    const ctx = this.ctx;
    const pt = toPx(who);
    ctx.font = '700 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    const w = Math.ceil(ctx.measureText(text).width) + 12;
    const h = 17;
    const bx = Math.max(2, Math.min(W - w - 2, pt.x + 10));
    const by = Math.max(2, pt.y - 42);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(bx + 1, by + 2, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx + 0.5, by + 0.5, w, h, 4) : ctx.rect(bx + 0.5, by + 0.5, w, h);
    ctx.fill();
    ctx.stroke();
    // Tail down to the ump's head.
    ctx.beginPath();
    ctx.moveTo(bx + 6, by + h);
    ctx.lineTo(pt.x + 2, pt.y - 13);
    ctx.lineTo(bx + 13, by + h);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + 6, by + h + 0.5);
    ctx.lineTo(pt.x + 2, pt.y - 13);
    ctx.lineTo(bx + 13, by + h + 0.5);
    ctx.stroke();
    ctx.fillStyle = '#b42318';
    ctx.fillText(text, bx + 6, by + 12);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---- One plate appearance ---------------------------------------------

  /**
   * Animate a play. Resolves when it's done (or right away at speed 0).
   * @param {object} play     planPA() result
   * @param {object} outcome  the outcome committed (play.outcome or play.options[choice])
   * @param {object} opts     { speed: 1|2|4|0, speedOf: (id) => speed rating }
   */
  async animate(play, outcome, { speed = 1, speedOf = () => 50 } = {}) {
    this.stop();
    if (!speed) return;
    // Any flat or illegal pitches the ump calls first, then the pitch that counts.
    if (play.calls?.length) await this.run(buildCallsTimeline(this, play.calls), speed);
    await this.run(buildTimeline(this, play, outcome, speedOf), speed);
  }

  run(tl, speed) {
    this.stop();
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = (now) => {
        const t = (now - start) * speed;
        tl.update(t);
        this.draw();
        if (t >= tl.end) { this.raf = 0; resolve(); return; }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    });
  }
}

const BANNERS = {
  BB: ['WALK', '#8fd3ff'], K: ['STRIKEOUT', '#ff8a80'], '1B': ['SINGLE', '#ffd700'], '2B': ['DOUBLE', '#ffd700'],
  '3B': ['TRIPLE', '#ffd700'], HR: ['HOME RUN!', '#ffd700'], GO: ['OUT', '#ffffff'], FO: ['OUT', '#ffffff'],
  LO: ['OUT', '#ffffff'], PO: ['OUT', '#ffffff'], DP: ['DOUBLE PLAY', '#ff8a80'], FC: ["FIELDER'S CHOICE", '#ffffff'],
  E: ['ERROR', '#ffb74d']
};

/** Turn a list of tweens into { update(t), end }. */
function timeline(tw, minEnd = 0) {
  tw.sort((a, b) => a.from - b.from);
  return {
    end: Math.max(minEnd, ...tw.map((x) => x.to)),
    update(time) {
      for (const x of tw) {
        if (time < x.from) continue;
        const u = Math.min(1, (time - x.from) / (x.to - x.from));
        if (x.done && u === 1) continue;
        x.fn(u);
        if (u === 1) x.done = true;
      }
    }
  };
}

/**
 * Called balls before the real pitch: a flat one barely arcs, an illegal one
 * goes way up. The catcher takes it, the ump yells, the ball goes back.
 */
function buildCallsTimeline(field, calls) {
  const tw = [];
  const add = (from, dur, fn) => { tw.push({ from, to: from + Math.max(1, dur), fn }); return from + dur; };
  const pitcherAt = { x: 0, y: FIELD.mound + 2 };
  const mitt = { x: 0, y: -5 };
  let t = 0;
  for (const c of calls) {
    const peak = c === 'flat' ? 3 : 48;
    t = add(t, c === 'flat' ? 750 : 1100, (u) => {
      field.ball = { x: lerp(pitcherAt.x, mitt.x, u), y: lerp(pitcherAt.y, mitt.y, u), h: 5 + Math.sin(u * Math.PI) * peak };
    });
    add(t, 1, () => { field.ball = null; field.umpSay = c === 'flat' ? 'FLAT!' : 'ILLEGAL!'; });
    t = add(t, 1100, () => {});
    add(t, 1, () => { field.umpSay = null; });
    t = add(t, 550, (u) => {
      field.ball = { x: lerp(mitt.x, pitcherAt.x, u), y: lerp(mitt.y, pitcherAt.y, u), h: 4 + Math.sin(u * Math.PI) * 8 };
    });
    add(t, 1, () => { field.ball = null; });
    t += 250;
  }
  return timeline(tw, t);
}

/**
 * Turn a play into tweens: pitch, swing, ball flight, the fielder, the
 * throw, and every runner. Returns { update(t), end }.
 */
function buildTimeline(field, play, outcome, speedOf) {
  const tw = [];                    // { from, to, fn(t01) }
  const add = (from, dur, fn) => { tw.push({ from, to: from + Math.max(1, dur), fn }); return from + dur; };
  const pitcherAt = { x: 0, y: FIELD.mound + 2 };
  const plate = { x: 0, y: 2 };
  const batter = field.batter;
  let t = 0;

  // Pitch: a high slow-pitch arc.
  const PITCH = 900;
  add(0, PITCH, (u) => { field.ball = { x: lerp(pitcherAt.x, plate.x, u), y: lerp(pitcherAt.y, plate.y, u), h: 6 + Math.sin(u * Math.PI) * 26 }; });
  t = PITCH;

  const kind = play.kind;
  const bannerAt = (time, key) => {
    let [text, color] = BANNERS[key] || ['', '#fff'];
    if (key === 'FO' && outcome.sac) text = 'SAC FLY';
    if (key === 'HR' && play.insidePark) text = 'INSIDE-THE-PARKER!';
    if (play.grd) text = 'GROUND-RULE DOUBLE';
    if (play.gap) text = play.banner || 'AUTOMATIC TRIPLE';
    if (key === '1B' && play.infield) text = 'INFIELD SINGLE';
    add(time, 900, () => { field.banner = { text, color }; });
    return time + 900;
  };

  const moveRunners = (startAt, opts = {}) => {
    let last = startAt;
    for (const m of outcome.moves) {
      if (m.how === 'k') continue;
      const isBatter = m.id === play.batter;
      let person = isBatter ? null : field.runners.find((r) => r.id === m.id);
      if (isBatter) {
        person = { id: m.id, x: batter?.x ?? -9, y: batter?.y ?? 1, frame: 'stand' };
        field.runners.push(person);
        if (batter) batter.gone = true;
      }
      if (!person) continue;
      const fps = 42 + 5 * (((speedOf(m.id) ?? 50) - 50) / 10);
      const from = m.from;
      const startPos = { x: person.x, y: person.y };
      if (m.how === 'caught') {
        // Runs a few steps toward first, then peels off.
        const go = alongBases(0, 24);
        const end = add(startAt, 600, (u) => { person.x = lerp(startPos.x, go.x, u); person.y = lerp(startPos.y, go.y, u); person.frame = u < 1 ? (Math.floor(u * 8) % 2 ? 'run1' : 'run2') : 'stand'; });
        add(opts.caughtAt ?? end, 1, () => { person.gone = true; });
        last = Math.max(last, end);
        continue;
      }
      if (m.to === from) continue;
      const bases = m.to - from;
      let d = bases * FIELD.base;
      if (m.out) d -= 10;
      // On a caught fly ball every runner who moves is tagging up: he goes on the catch.
      const begin = (m.tag || opts.caughtAt !== undefined) ? (opts.caughtAt ?? startAt) : startAt;
      const dur = (d / fps) * 1000;
      const finalStand = m.to >= 4 || m.out ? null : STAND[m.to];
      const end = add(begin, dur, (u) => {
        const p = alongBases(from, d * u);
        person.x = p.x; person.y = p.y;
        person.frame = Math.floor(u * dur / 110) % 2 ? 'run1' : 'run2';
        if (u >= 1) {
          if (finalStand) { person.x = finalStand.x; person.y = finalStand.y; }
          person.frame = 'stand';
        }
      });
      if (m.to >= 4 && !m.out) add(end, 1, () => { person.gone = true; });
      if (m.out) {
        const at = alongBases(from, d);
        add(Math.max(end, opts.throwArrives ?? end), 1, () => { field.marks.push({ ...at, text: 'OUT' }); person.gone = true; });
      }
      last = Math.max(last, end);
    }
    return last;
  };

  if (kind === 'BB') {
    const end = moveRunners(PITCH + 200);
    add(PITCH, 1, () => { field.ball = null; });
    return finalize(bannerAt(Math.max(end, PITCH + 400), 'BB'));
  }

  // Swing
  add(PITCH - 120, 220, (u) => { if (batter) batter.swing = u; });
  if (kind === 'K') {
    add(PITCH, 1, () => { field.ball = null; });
    add(PITCH + 500, 1, () => { if (batter) batter.gone = true; });
    return finalize(bannerAt(PITCH + 200, 'K'));
  }

  // Ball in play
  const land = play.land || { x: 0, y: 150 };
  const fl = play.fielder || 'CF';
  const F = field.fielders[fl];
  const Fstart = { x: F.x, y: F.y };
  const d = Math.hypot(land.x, land.y);
  let flight;
  let peak;
  switch (play.contact) {
    case 'ground': flight = 300 + d * 3.2; peak = 4; break;
    case 'line': flight = 300 + d * 2.4; peak = 10; break;
    case 'pop': flight = 1700; peak = 90; break;
    default: flight = 700 + d * 4.6; peak = 30 + d * 0.22;
  }
  if (kind === 'HR' && !play.insidePark) flight = 2100;
  const contact = PITCH + 40;
  add(contact, flight, (u) => {
    const h = play.contact === 'ground' ? (u < 0.15 ? Math.sin((u / 0.15) * Math.PI) * peak : 0) : Math.sin(u * Math.PI) * peak;
    field.ball = { x: lerp(plate.x, land.x, u), y: lerp(plate.y, land.y, u), h };
  });
  const arrive = contact + flight;

  if (kind === 'HR' && !play.insidePark) {
    // Fielder drifts back to the fence and watches it go.
    const a = (Math.atan2(land.x, land.y) * 180) / Math.PI;
    const wall = polar(a, (fenceAt(a, PARK) ?? Math.hypot(land.x, land.y)) - 8);
    add(contact, flight * 0.8, (u) => { F.x = lerp(Fstart.x, wall.x, ease(u)); F.y = lerp(Fstart.y, wall.y, ease(u)); F.frame = Math.floor(u * 12) % 2 ? 'run1' : 'run2'; });
    add(arrive, 1, () => {
      field.ball = null; F.frame = 'stand';
      if (land.x < 40) field.brakeUntil = performance.now() + 2600;   // traffic on the road stops to watch
    });
    const end = moveRunners(contact + 150);
    // Zuke comes out and dances until the last runner is home.
    const danceFrom = arrive - 250;
    const danceFor = Math.max(2600, end - danceFrom + 700);
    add(danceFrom, danceFor, (u) => { field.zuke = u < 1 ? u * danceFor : null; });
    return finalize(bannerAt(Math.max(arrive, end - 400), 'HR'));
  }

  // The fielder goes to the ball (a hit gets there a beat after the ball).
  const caught = ['FO', 'LO', 'PO'].includes(kind);
  const reachBy = caught ? arrive : arrive + (['1B', '2B', '3B', 'HR'].includes(kind) && !play.infield ? 350 : 0);
  const runFrom = contact + 80;
  // A dead ball (through a gap, past the dugout, into the branch): he chases,
  // then pulls up. At the branch he gets close, throws up his hands and calls it.
  const landR = Math.hypot(land.x, land.y);
  const short = play.branch ? 9 : 30;
  const chase = play.dead ? { x: (land.x * (landR - short)) / landR, y: (land.y * (landR - short)) / landR } : land;
  add(runFrom, reachBy - runFrom, (u) => {
    F.x = lerp(Fstart.x, chase.x, ease(u)); F.y = lerp(Fstart.y, chase.y, ease(u));
    F.frame = u < 1 ? (Math.floor(u * 14) % 2 ? 'run1' : 'run2') : 'stand';
  });
  if (!caught) {
    // A hit rolls on a little until he gets there.
    add(arrive, reachBy - arrive, (u) => { if (field.ball) field.ball = { x: land.x, y: land.y, h: 0 }; });
  }
  add(reachBy, 1, () => { if (!play.dead) { F.ball = true; field.ball = null; } F.frame = 'stand'; });
  if (play.branch) {
    add(reachBy + 80, 1300, (u) => { F.frame = u < 1 ? 'arms' : 'stand'; field.say = u < 1 ? { who: F, text: 'DEAD BALL!' } : null; });
  }

  // Throw
  let throwArrives = reachBy;
  const throwFrom = { x: land.x, y: land.y };
  const throwTime = (target) => 220 + dist(throwFrom, target) * 3.2;
  const throwTo = (base, at, then) => {
    const target = base >= 4 ? BASES[0] : BASES[base];
    const dur = throwTime(target);
    add(at, dur, (u) => {
      F.ball = false;
      field.ball = { x: lerp(throwFrom.x, target.x, u), y: lerp(throwFrom.y, target.y, u), h: 4 + Math.sin(u * Math.PI) * Math.min(18, dist(throwFrom, target) / 8) };
    });
    add(at + dur, 1, () => { field.ball = null; then?.(); });
    return at + dur;
  };
  let release = reachBy + 120;
  if (play.insidePark) {
    // The relay comes in just after he crosses the plate.
    const fps = 42 + 5 * (((speedOf(play.batter) ?? 50) - 50) / 10);
    const scores = contact + 120 + ((4 * FIELD.base) / fps) * 1000;
    release = Math.max(release, scores + 250 - throwTime(BASES[0]));
  }
  if (play.dead) {
    throwArrives = reachBy;
  } else if (kind === 'DP') {
    const second = throwTo(2, release);
    const relayFrom = BASES[2];
    const dur = 220 + dist(relayFrom, BASES[1]) * 3.2;
    add(second + 60, dur, (u) => { field.ball = { x: lerp(relayFrom.x, BASES[1].x, u), y: lerp(relayFrom.y, BASES[1].y, u), h: 5 }; });
    add(second + 60 + dur, 1, () => { field.ball = null; });
    throwArrives = second + 60 + dur;
  } else if (play.throwTo) {
    throwArrives = throwTo(play.throwTo, release);
  } else if (!caught && kind !== 'GO') {
    throwArrives = throwTo(2, release);
  } else if (kind === 'GO') {
    throwArrives = release; // 1B takes it himself
  }

  const end = moveRunners(contact + 120, { caughtAt: caught ? arrive : undefined, throwArrives });
  return finalize(bannerAt(Math.max(end, throwArrives) - 200, kind === 'FO' && outcome.sac ? 'FO' : kind));

  function finalize(bannerEnd) {
    const endT = Math.max(bannerEnd, ...tw.map((x) => x.to));
    tw.sort((a, b) => a.from - b.from);
    return {
      end: endT,
      update(time) {
        for (const x of tw) {
          if (time < x.from) continue;
          const u = Math.min(1, (time - x.from) / (x.to - x.from));
          if (x.done && u === 1) continue;
          x.fn(u);
          if (u === 1) x.done = true;
        }
      }
    };
  }
}
