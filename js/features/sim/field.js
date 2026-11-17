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
// per foot on a 480 x 420 canvas that CSS scales up with crisp pixels. The
// park is Senior Field (FIELD in sim-engine.js has its fence and spots).

import { FIELD, polar, spotXY, fenceAt } from '../../domain/sim-engine.js';
import { SLOTS } from '../../domain/sim-ratings.js';

export const W = 480;
export const H = 420;
export const SCALE = 1.5;
const HOME_X = 240;
const HOME_Y = 390;   // feet shown: -160..160 across, -20..260 deep
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
  skin: '#e2b48c', skin2: '#9b6b4a', pants: '#ececec', dark: '#1e1e1e', bat: '#d4a65f', glove: '#7a4a24',
  ball: '#ffffff', shadow: 'rgba(0,0,0,0.35)'
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
  ]
};

/** Darken a hex color by f (0..1). */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * (1 - f))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(ch).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const spriteCache = new Map();
function sprite(name, color, skin) {
  const key = `${name}|${color}|${skin}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const rows = SPRITES[name];
  // 10 x 14 with a dark outline, so players stand out on dry grass and dirt.
  const c = document.createElement('canvas');
  c.width = 10; c.height = 14;
  const x = c.getContext('2d');
  const pal = { c: shade(color, 0.3), j: color, s: skin, p: COLORS.pants, k: COLORS.dark };
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

export class SimField {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.bg = this.drawBackground();
    this.fieldColor = '#1976d2';
    this.batColor = '#d32f2f';
    this.fielders = {};
    this.runners = [];      // { id, x, y, frame }
    this.batter = null;     // { id, x, y, bats, swing }
    this.ball = null;       // { x, y, h }
    this.banner = null;     // { text, color }
    this.marks = [];        // { x, y, text } out marks
    this.raf = 0;
    this.resetFielders();
    this.draw();
  }

  // ---- Static scene -----------------------------------------------------

  // Senior Field from above, in the fall: dry grass, an all-dirt infield,
  // the straight fence and hedge across right and center, open left field
  // running into the next diamond, the school roof past right-center, the
  // parking lot down the first-base side, and the trees around it.
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
    const speckle = (n, colors, size = 1) => {
      for (let i = 0; i < n; i += 1) {
        x.fillStyle = colors[Math.floor(rand() * colors.length)];
        x.fillRect(Math.floor(rand() * W), Math.floor(rand() * H), size, size);
      }
    };
    const clipped = (shape, fn) => { x.save(); shape(); x.clip(); fn(); x.restore(); };
    // A rectangle `len` x `wid` feet centred on p, its length along angle ang (degrees, math convention).
    const box = (p, len, wid, ang, draw) => {
      const q = P(p);
      x.save();
      x.translate(q.x, q.y);
      x.rotate((-ang * Math.PI) / 180);
      draw(len * SCALE, wid * SCALE);
      x.restore();
    };

    // Grass everywhere, dry and patchy, greener toward left field.
    x.fillStyle = C.grass;
    x.fillRect(0, 0, W, H);
    [[-125, 190, 40], [-140, 95, 32], [-95, 125, 24], [-55, 70, 18], [70, 55, 14], [-20, 160, 22], [40, 200, 14], [-150, 30, 26]]
      .forEach(([px, py, r]) => {
        const q = P({ x: px, y: py });
        const g = x.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * SCALE);
        g.addColorStop(0, 'rgba(140,152,92,0.45)');
        g.addColorStop(1, 'rgba(140,152,92,0)');
        x.fillStyle = g;
        x.fillRect(q.x - r * SCALE, q.y - r * SCALE, 2 * r * SCALE, 2 * r * SCALE);
      });
    speckle(2600, [C.grassDark, C.grassDark, C.grassDark2, C.grassLight], 2);

    // The next diamond's infield, out past left-center.
    const other = [{ x: -170, y: 207 }, { x: -82, y: 205 }, { x: -85, y: 165 }, { x: -90, y: 150 }, { x: -101, y: 142 }, { x: -170, y: 140 }];
    poly(other, C.dirt);
    clipped(() => path(other), () => speckle(900, [C.dirtDark, C.dirtLight]));

    // Walkway down the third-base side.
    seg({ x: -170, y: 128 }, { x: -66, y: 27 }, C.path, 5 * SCALE);

    // Parking lot down the first-base side: sidewalk, curb, stalls, cars.
    const edgeA = { x: 63.4, y: -25 };
    const edgeB = { x: 160, y: 126 };
    const along = { x: 0.54, y: 0.841 };
    const toGrass = { x: -0.841, y: 0.54 };
    const at = (s, off) => ({ x: edgeA.x + (edgeB.x - edgeA.x) * s - toGrass.x * off, y: edgeA.y + (edgeB.y - edgeA.y) * s - toGrass.y * off });
    poly([edgeA, edgeB, { x: 160, y: -25 }], C.asphalt);
    clipped(() => path([edgeA, edgeB, { x: 160, y: -25 }]), () => speckle(700, [C.asphaltDark, C.asphaltLight]));
    seg(at(0, -3), at(1, -3), C.sidewalk, 4 * SCALE);
    seg(edgeA, edgeB, C.curb, 1.5);
    const stallAng = (Math.atan2(along.y, along.x) * 180) / Math.PI + 90;
    [0.05, 0.25, 0.45, 0.65, 0.85].forEach((s) => seg(at(s, 10), at(s, 28), C.curb, 1));
    [[0.15, '#f2f2ef'], [0.35, '#8a8f96'], [0.55, '#25375a'], [0.75, '#c8cbcf']].forEach(([s, col]) => {
      box(at(s, 19), 14, 6.5, stallAng, (l, w) => {
        x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(-l / 2 + 1, -w / 2 + 1, l, w);
        x.fillStyle = col; x.fillRect(-l / 2, -w / 2, l, w);
        x.fillStyle = 'rgba(20,30,40,0.55)'; x.fillRect(-l / 6, -w / 2 + 1, l / 3, w - 2);
      });
    });

    // The school roof past right-center.
    const roof = [{ x: 82, y: 262 }, { x: 160, y: 262 }, { x: 160, y: 168 }, { x: 118, y: 168 }, { x: 82, y: 224 }];
    poly(roof.map((p) => ({ x: p.x - 6, y: p.y - 4 })), C.roofShadow);
    poly(roof, C.roof);
    seg(roof[3], roof[4], C.roofEdge, 2);
    seg(roof[2], roof[3], C.roofEdge, 2);
    [[132, 232, 9, 6], [146, 200, 6, 6], [108, 240, 5, 4]].forEach(([px, py, l, w]) => box({ x: px, y: py }, l, w, 0, (L, Wd) => {
      x.fillStyle = C.roofEdge; x.fillRect(-L / 2 + 1, -Wd / 2 + 1, L, Wd);
      x.fillStyle = C.roofUnit; x.fillRect(-L / 2, -Wd / 2, L, Wd);
    }));

    // Brick patio behind the third-base dugout.
    poly([{ x: -10, y: -9 }, { x: -36, y: -9 }, { x: -52, y: 9 }, { x: -46, y: 17 }, { x: -30, y: 3 }], C.clay);

    // Bleachers on both sides.
    const bleachers = (p, len, ang) => box(p, len, 8, ang, (l, w) => {
      x.fillStyle = C.bleacherDark; x.fillRect(-l / 2, -w / 2, l, w);
      x.fillStyle = C.bleacher;
      for (let r = 0; r < 4; r += 1) x.fillRect(-l / 2, -w / 2 + (r * w) / 4, l, Math.max(1, w / 8));
    });
    bleachers({ x: -60, y: 12 }, 18, 135);
    bleachers({ x: 52, y: 27 }, 16, 45);

    // The infield: all dirt, a wide round skin that stops just foul of the lines.
    clipped(() => path([{ x: 0, y: -10 }, { x: 230, y: 220 }, { x: -230, y: 220 }]), () => {
      const q = P({ x: 0, y: 44 });
      x.beginPath();
      x.ellipse(q.x, q.y, 50 * SCALE, 54 * SCALE, 0, 0, Math.PI * 2);
      x.fillStyle = C.dirt;
      x.fill();
    });
    disc({ x: 0, y: 0 }, 13, C.dirt);
    clipped(() => {
      const q = P({ x: 0, y: 44 });
      x.beginPath();
      x.ellipse(q.x, q.y, 50 * SCALE, 54 * SCALE, 0, 0, Math.PI * 2);
      const h = P({ x: 0, y: 0 });
      x.moveTo(h.x + 13 * SCALE, h.y);
      x.arc(h.x, h.y, 13 * SCALE, 0, Math.PI * 2);
    }, () => {
      x.globalAlpha = 0.5;
      disc({ x: 0, y: FIELD.mound }, 6, C.dirtLight);
      disc({ x: 0, y: 0 }, 9, C.dirtDark);
      x.globalAlpha = 1;
      speckle(1100, [C.dirtDark, C.dirtLight]);
    });

    // Dugouts: fenced benches along each line.
    const dugout = (p, ang) => box(p, 24, 7, ang, (l, w) => {
      x.fillStyle = 'rgba(40,40,40,0.18)'; x.fillRect(-l / 2, -w / 2, l, w);
      x.fillStyle = C.bench; x.fillRect(-l / 2 + 2, w / 2 - 3, l - 4, 2);
      x.strokeStyle = C.fence; x.lineWidth = 1; x.strokeRect(-l / 2 + 0.5, -w / 2 + 0.5, l - 1, w - 1);
    });
    dugout({ x: -27.6, y: 9.2 }, 135);
    dugout({ x: 27.6, y: 9.2 }, 45);

    // Backstop.
    const back = [{ x: -24, y: 4 }, { x: -12, y: -9 }, { x: 12, y: -9 }, { x: 24, y: 4 }];
    for (let i = 0; i < back.length - 1; i += 1) seg(back[i], back[i + 1], C.fence, 2);
    back.forEach((p) => { const q = P(p); x.fillStyle = C.post; x.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 3, 3); });

    // Foul lines and batter's boxes.
    x.globalAlpha = 0.9;
    seg(BASES[0], polar(-45, 235), C.chalk, 1);
    seg(BASES[0], polar(45, fenceAt(45) ?? 160), C.chalk, 1);
    x.globalAlpha = 1;
    x.strokeStyle = C.chalk;
    x.lineWidth = 1;
    [-1, 1].forEach((side) => {
      const a = P({ x: side * 2.5 + (side < 0 ? -3 : 0), y: 3.5 });
      x.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(3 * SCALE), Math.round(7 * SCALE));
    });

    // The fence, with the hedge growing behind it.
    const [f1, f2] = FIELD.fence;
    const out = { x: 0.66, y: 0.751 };
    const behind = (p, d) => ({ x: p.x + out.x * d, y: p.y + out.y * d });
    seg(behind(f1, 3.5), behind(f2, 3.5), C.hedge, 5 * SCALE);
    for (let i = 0; i < 260; i += 1) {
      const t = rand();
      const q = P(behind({ x: f1.x + (f2.x - f1.x) * t, y: f1.y + (f2.y - f1.y) * t }, 1 + rand() * 6));
      x.fillStyle = rand() < 0.5 ? C.hedgeLight : C.hedgeDark;
      x.fillRect(Math.floor(q.x), Math.floor(q.y), 2, 2);
    }
    seg(f1, f2, C.fence, 1.5);
    const fenceLen = Math.hypot(f2.x - f1.x, f2.y - f1.y);
    for (let d = 0; d <= fenceLen; d += 10) {
      const q = P({ x: f1.x + ((f2.x - f1.x) * d) / fenceLen, y: f1.y + ((f2.y - f1.y) * d) / fenceLen });
      x.fillStyle = C.post;
      x.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 2, 2);
    }
    const pole = P(polar(45, fenceAt(45) ?? 160));
    x.fillStyle = C.foulPole;
    x.fillRect(Math.round(pole.x) - 1, Math.round(pole.y) - 1, 3, 3);

    // Light pole by the right-field corner, and its long shadow.
    x.globalAlpha = 0.35;
    seg({ x: 122, y: 121 }, { x: 58, y: 121 }, '#1a1a1a', 1.5);
    [[56, 123], [56, 119], [53, 123], [53, 119]].forEach(([px, py]) => disc({ x: px, y: py }, 1, '#1a1a1a'));
    x.globalAlpha = 1;
    disc({ x: 122, y: 121 }, 1.4, C.post);

    // Trees: shadows (cast toward left field) first, then canopies.
    const trees = [
      [106, 94, 13, 0], [100, 168, 11, 0], [8, 214, 6, 1], [26, 198, 6, 1], [-24, 240, 5, 0],
      [-118, 40, 16, 0], [-100, 18, 12, 0], [-142, 8, 18, 0], [-80, -14, 13, 0], [-130, -18, 14, 1],
      [-12, -15, 6, 0], [14, -17, 6, 0], [42, -20, 4, 1]
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

  resetFielders() {
    this.fielders = Object.fromEntries(SLOTS.map((s) => {
      const p = spotXY(s);
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
    this.draw();
  }

  // ---- Drawing ----------------------------------------------------------

  drawPerson(p, color, id) {
    const ctx = this.ctx;
    const pt = toPx(p);
    ctx.fillStyle = COLORS.shadow;
    ctx.fillRect(pt.x - 3, pt.y, 7, 2);
    const img = sprite(p.frame || 'stand', color, skinOf(id));
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
    // Back to front so nearer players overlap farther ones.
    const people = [
      ...Object.values(this.fielders).map((f) => ({ p: f, color: this.fieldColor, id: this.fielderIds?.[f.slot] || f.slot })),
      ...this.runners.filter((r) => !r.gone).map((r) => ({ p: r, color: this.batColor, id: r.id }))
    ].sort((a, b) => b.p.y - a.p.y);
    people.forEach(({ p, color, id }) => this.drawPerson(p, color, id));
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
  animate(play, outcome, { speed = 1, speedOf = () => 50 } = {}) {
    this.stop();
    if (!speed) return Promise.resolve();
    const tl = buildTimeline(this, play, outcome, speedOf);
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
    const wall = polar(a, (fenceAt(a) ?? Math.hypot(land.x, land.y)) - 8);
    add(contact, flight * 0.8, (u) => { F.x = lerp(Fstart.x, wall.x, ease(u)); F.y = lerp(Fstart.y, wall.y, ease(u)); F.frame = Math.floor(u * 12) % 2 ? 'run1' : 'run2'; });
    add(arrive, 1, () => { field.ball = null; F.frame = 'stand'; });
    const end = moveRunners(contact + 150);
    return finalize(bannerAt(Math.max(arrive, end - 400), 'HR'));
  }

  // The fielder goes to the ball (a hit gets there a beat after the ball).
  const caught = ['FO', 'LO', 'PO'].includes(kind);
  const reachBy = caught ? arrive : arrive + (['1B', '2B', '3B', 'HR'].includes(kind) && !play.infield ? 350 : 0);
  const runFrom = contact + 80;
  add(runFrom, reachBy - runFrom, (u) => {
    F.x = lerp(Fstart.x, land.x, ease(u)); F.y = lerp(Fstart.y, land.y, ease(u));
    F.frame = u < 1 ? (Math.floor(u * 14) % 2 ? 'run1' : 'run2') : 'stand';
  });
  if (!caught) {
    // A hit rolls on a little until he gets there.
    add(arrive, reachBy - arrive, (u) => { if (field.ball) field.ball = { x: land.x, y: land.y, h: 0 }; });
  }
  add(reachBy, 1, () => { F.ball = true; field.ball = null; F.frame = 'stand'; });

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
  if (kind === 'DP') {
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
