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
// Coordinates are feet (home plate 0,0, y toward center), drawn at 1 px per
// foot on a 440 x 330 canvas that CSS scales up with crisp pixels.

import { FIELD, polar, spotXY } from '../../domain/sim-engine.js';
import { SLOTS } from '../../domain/sim-ratings.js';

export const W = 440;
export const H = 330;
const HOME_X = W / 2;
const HOME_Y = H - 24;
const toPx = (p) => ({ x: Math.round(HOME_X + p.x), y: Math.round(HOME_Y - p.y) });

const B = FIELD.base / Math.SQRT2;
export const BASES = [{ x: 0, y: 0 }, { x: B, y: B }, { x: 0, y: 2 * B }, { x: -B, y: B }, { x: 0, y: 0 }];
// Where a runner stands at each base (a step off the bag so the bag shows).
const STAND = [{ x: -9, y: 1 }, { x: B + 4, y: B - 3 }, { x: 3, y: 2 * B + 4 }, { x: -B - 4, y: B - 3 }];

const COLORS = {
  stands: '#20301f', standsDot: '#2c402a',
  grass: '#3f8f3a', grass2: '#46993f', grassDark: '#2f6f2c',
  dirt: '#b98a56', dirtDark: '#a37848', track: '#a87c4c',
  wall: '#1f4d2b', wallTop: '#e6c84a', chalk: '#f3f1e6',
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
  const c = document.createElement('canvas');
  c.width = 8; c.height = 12;
  const x = c.getContext('2d');
  const pal = { c: shade(color, 0.3), j: color, s: skin, p: COLORS.pants, k: COLORS.dark };
  rows.forEach((row, y) => [...row].forEach((ch, i) => {
    if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, y, 1, 1); }
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

  drawBackground() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.fillStyle = COLORS.stands;
    x.fillRect(0, 0, W, H);
    x.fillStyle = COLORS.standsDot;
    for (let yy = 0; yy < H; yy += 4) for (let xx = (yy / 4) % 2 ? 2 : 0; xx < W; xx += 4) x.fillRect(xx, yy, 1, 1);

    const hx = HOME_X;
    const hy = HOME_Y;
    const rad = (deg) => ((deg - 90) * Math.PI) / 180; // canvas angle for a field angle

    // Grass, fair and foul.
    x.fillStyle = COLORS.grass;
    x.beginPath();
    x.moveTo(hx - 50, hy + 22);
    x.lineTo(hx + 50, hy + 22);
    x.arc(hx, hy, FIELD.fence + 8, rad(52), rad(-52), true);
    x.closePath();
    x.fill();
    // Mowing stripes
    x.save();
    x.clip();
    x.fillStyle = COLORS.grass2;
    for (let s = -W; s < W; s += 24) {
      x.beginPath();
      x.moveTo(hx + s, hy);
      x.lineTo(hx + s + 12, hy);
      x.lineTo(hx + s + 12 - 300, hy - 300);
      x.lineTo(hx + s - 300, hy - 300);
      x.closePath();
      x.fill();
    }
    x.restore();

    // Warning track and wall (fair territory only).
    x.strokeStyle = COLORS.track;
    x.lineWidth = 12;
    x.beginPath();
    x.arc(hx, hy, FIELD.fence - 6, rad(-45), rad(45));
    x.stroke();
    x.strokeStyle = COLORS.wall;
    x.lineWidth = 5;
    x.beginPath();
    x.arc(hx, hy, FIELD.fence + 2, rad(-46), rad(46));
    x.stroke();
    x.strokeStyle = COLORS.wallTop;
    x.lineWidth = 1;
    x.beginPath();
    x.arc(hx, hy, FIELD.fence, rad(-46), rad(46));
    x.stroke();

    // Skinned infield.
    x.fillStyle = COLORS.dirt;
    x.beginPath();
    x.moveTo(hx, hy);
    x.arc(hx, hy, 128, rad(-47), rad(47));
    x.closePath();
    x.fill();
    x.beginPath();
    x.arc(hx, hy, 20, 0, Math.PI * 2);
    x.fill();
    // Dirt texture
    x.fillStyle = COLORS.dirtDark;
    for (let i = 0; i < 260; i += 1) {
      const a = -45 + ((i * 37) % 90);
      const r = 8 + ((i * 53) % 118);
      const p = toPx(polar(a, r));
      x.fillRect(p.x, p.y, 1, 1);
    }

    // Foul lines and base paths.
    x.strokeStyle = COLORS.chalk;
    x.lineWidth = 1;
    const line = (a, b) => {
      const p = toPx(a); const q = toPx(b);
      x.beginPath(); x.moveTo(p.x + 0.5, p.y + 0.5); x.lineTo(q.x + 0.5, q.y + 0.5); x.stroke();
    };
    line(BASES[0], polar(-45, FIELD.fence));
    line(BASES[0], polar(45, FIELD.fence));
    line(BASES[1], BASES[2]);
    line(BASES[2], BASES[3]);
    // Batter's boxes
    x.strokeRect(hx - 12.5, hy - 6.5, 6, 10);
    x.strokeRect(hx + 6.5, hy - 6.5, 6, 10);

    // Bases, plate, pitching rubber.
    x.fillStyle = '#ffffff';
    [BASES[1], BASES[2], BASES[3]].forEach((b) => { const p = toPx(b); x.fillRect(p.x - 2, p.y - 2, 4, 4); });
    const hp = toPx(BASES[0]);
    x.fillRect(hp.x - 2, hp.y - 2, 5, 3);
    x.fillRect(hp.x - 1, hp.y + 1, 3, 1);
    const pr = toPx({ x: 0, y: FIELD.mound });
    x.fillRect(pr.x - 2, pr.y, 5, 1);
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
    ctx.drawImage(img, pt.x - 4, pt.y - 12);
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
      const yy = Math.round(g.y - this.ball.h * 0.7);
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
  if (kind === 'HR') flight = 2100;
  const contact = PITCH + 40;
  add(contact, flight, (u) => {
    const h = play.contact === 'ground' ? (u < 0.15 ? Math.sin((u / 0.15) * Math.PI) * peak : 0) : Math.sin(u * Math.PI) * peak;
    field.ball = { x: lerp(plate.x, land.x, u), y: lerp(plate.y, land.y, u), h };
  });
  const arrive = contact + flight;

  if (kind === 'HR') {
    // Fielder drifts back to the wall and watches it go.
    const wall = polar(Math.atan2(land.x, land.y) * 180 / Math.PI, FIELD.fence - 12);
    add(contact, flight * 0.8, (u) => { F.x = lerp(Fstart.x, wall.x, ease(u)); F.y = lerp(Fstart.y, wall.y, ease(u)); F.frame = Math.floor(u * 12) % 2 ? 'run1' : 'run2'; });
    add(arrive, 1, () => { field.ball = null; F.frame = 'stand'; });
    const end = moveRunners(contact + 150);
    return finalize(bannerAt(Math.max(arrive, end - 400), 'HR'));
  }

  // The fielder goes to the ball (a hit gets there a beat after the ball).
  const caught = ['FO', 'LO', 'PO'].includes(kind);
  const reachBy = caught ? arrive : arrive + (['1B', '2B', '3B'].includes(kind) && !play.infield ? 350 : 0);
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
  const throwTo = (base, at, then) => {
    const target = base >= 4 ? BASES[0] : BASES[base];
    const dur = 220 + dist(throwFrom, target) * 3.2;
    add(at, dur, (u) => {
      F.ball = false;
      field.ball = { x: lerp(throwFrom.x, target.x, u), y: lerp(throwFrom.y, target.y, u), h: 4 + Math.sin(u * Math.PI) * Math.min(18, dist(throwFrom, target) / 8) };
    });
    add(at + dur, 1, () => { field.ball = null; then?.(); });
    return at + dur;
  };
  const release = reachBy + 120;
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
