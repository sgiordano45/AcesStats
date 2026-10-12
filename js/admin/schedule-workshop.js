// js/admin/schedule-workshop.js
// Workshop tab of admin/schedule.html: tune a generated schedule before it
// goes live. Edit any game, run the balancers, and check fairness as you go
// (games by day and time, byes, opponents, the MOLSKI fairness score, the
// opponent grid and time-slot spread). When it looks right, Send to Season
// setup hands it to the wizard, which creates the season and its games.
//
// Replaced admin/schedule-workshop.html. The logic (MOLSKI, the balancers,
// byes) is the old page's; the schedule comes from the Generate tab instead of
// a CSV, and its Export to Firebase (which wrote to another Firebase project)
// is gone. Edits are kept on this device (schedule-draft.js) with an undo.

import { siteUrl } from '../core/app.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { cap, teamDot } from '../ui/game-shared.js';
import { drawTableImage } from '../ui/table.js';
import { loadDraft, saveDraft, clearDraft, saveHandoff, dayDate, timeHour, scheduleCsv, download } from './schedule-draft.js';

const $ = (id) => document.getElementById(id);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOf = (iso) => DAYS[new Date(`${iso}T12:00:00`).getDay()];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let ctx = null;
let draft = null;          // { seasonType, year, games, newTeams, savedAt }
let team = '';             // team shown in Team check
let sort = { field: '', asc: true };
const undo = [];

const games = () => draft.games;
const teamsOf = () => [...new Set(games().flatMap(g => [g.home, g.away]))].sort();
const slotsOf = () => [...new Set(games().map(g => g.time).filter(Boolean))].sort((a, b) => timeHour(a) - timeHour(b));

// ------------------------------------------------------------------ state

function snapshot() {
  undo.push(JSON.stringify(games()));
  if (undo.length > 30) undo.shift();
  $('swUndo').disabled = false;
}

function commit({ table = true } = {}) {
  saveDraft(draft);
  draft.savedAt = loadDraft()?.savedAt || draft.savedAt;
  render({ table });
}

// ------------------------------------------------------------------ analysis (the old workshop's)

function teamData() {
  const data = {};
  for (const g of games()) {
    for (const [t, loc, opp] of [[g.home, 'Home', g.away], [g.away, 'Away', g.home]]) {
      const d = data[t] || (data[t] = { games: 0, home: 0, away: 0, days: {}, times: {}, opponents: {} });
      d.games++;
      if (loc === 'Home') d.home++; else d.away++;
      const day = g.iso ? dayOf(g.iso) : '?';
      d.days[day] = (d.days[day] || 0) + 1;
      d.times[g.time] = (d.times[g.time] || 0) + 1;
      d.opponents[opp] = (d.opponents[opp] || 0) + 1;
    }
  }
  return data;
}

function leagueDists() {
  const days = {}, times = {};
  games().forEach(g => {
    if (g.iso) { const d = dayOf(g.iso); days[d] = (days[d] || 0) + 1; }
    times[g.time] = (times[g.time] || 0) + 1;
  });
  return { days, times };
}

// Root-mean-squared gap between a team's mix and the league's (0 = matches).
function deviation(teamDist, leagueDist) {
  const lt = Object.values(leagueDist).reduce((a, b) => a + b, 0);
  const tt = Object.values(teamDist).reduce((a, b) => a + b, 0);
  if (!lt || !tt) return 0;
  let sq = 0;
  Object.keys(leagueDist).forEach(k => { sq += ((teamDist[k] || 0) / tt - leagueDist[k] / lt) ** 2; });
  return Math.sqrt(sq);
}

// Desirability by hour (1 worst, 6 best); evening slots map to their daytime equivalents.
const SLOT_DESIRABILITY = { 13: 1, 12: 2, 8: 3, 19: 3, 11: 4, 21: 4, 9: 5, 10: 6, 20: 6 };
const desirability = (time) => SLOT_DESIRABILITY[Math.floor(timeHour(time))] ?? 3;
function avgDesirability(times) {
  let total = 0, n = 0;
  Object.entries(times).forEach(([t, c]) => { total += desirability(t) * c; n += c; });
  return n ? total / n : 3;
}

function molski(d, league) {
  let score = Math.min(40, deviation(d.times, league.times) * 60);                              // time-slot spread
  score += Math.min(15, Math.max(0, avgDesirability(league.times) - avgDesirability(d.times)) * 10); // slot quality
  score += Math.min(45, deviation(d.days, league.days) * 67.5);                                  // day mix
  return Math.round(score);
}

function molskiRating(s) {
  if (s <= 15) return ['Excellent', 'is-win'];
  if (s <= 30) return ['Good', 'is-win'];
  if (s <= 45) return ['Fair', 'is-outline'];
  if (s <= 60) return ['Poor', 'is-alert'];
  return ['Unfair', 'is-loss'];
}

/** Weeks a team doesn't play. Week 1: Opening Day alone counts as a bye week. */
function byeWeeks(t) {
  const weeks = [...new Set(games().map(g => g.week))].sort((a, b) => a - b);
  const od = games().filter(g => g.week === 1).map(g => g.iso).sort()[0];
  return weeks.filter(w => {
    const mine = games().filter(g => g.week === w && (g.home === t || g.away === t));
    return w === 1 ? !mine.some(g => g.iso !== od) : !mine.length;
  });
}

function problems() {
  const out = [];
  games().forEach((g, i) => { if (g.home === g.away) out.push(`Game ${i + 1} (${dayDate(g.iso)}): ${g.home} is playing itself.`); });
  const seen = new Map();
  games().forEach(g => [g.home, g.away].forEach(t => {
    const k = `${t}|${g.iso}|${g.time}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }));
  seen.forEach((n, k) => { if (n > 1) { const [t, iso, time] = k.split('|'); out.push(`${t} has ${n} games at ${time} on ${dayDate(iso)}.`); } });
  if (draft.seasonType === 'fall') {
    // Fall rule: every team plays every week.
    teamsOf().forEach(t => {
      const weeks = new Set(games().filter(g => g.home === t || g.away === t).map(g => g.week));
      const off = [...new Set(games().map(g => g.week))].filter(w => !weeks.has(w)).sort((a, b) => a - b);
      if (off.length) out.push(`${t} has no game in week${off.length > 1 ? 's' : ''} ${off.join(', ')} (fall teams play every week).`);
    });
  }
  return out;
}

// ------------------------------------------------------------------ balancers (the old workshop's)

function balanceDays() {
  const dayVariance = () => {
    const counts = {}, active = new Set();
    games().forEach(g => {
      if (!g.iso) return;
      const d = new Date(`${g.iso}T12:00:00`).getDay();
      active.add(d);
      [g.home, g.away].forEach(t => { (counts[t] || (counts[t] = Array(7).fill(0)))[d]++; });
    });
    let v = 0;
    Object.values(counts).forEach(arr => {
      const vals = [...active].map(d => arr[d]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      vals.forEach(x => { v += (x - mean) ** 2; });
    });
    return v;
  };
  // Doubleheader nights (2+ games on a date) in weeks 2-11, grouped by week.
  const byWeek = () => {
    const byDate = {};
    games().forEach((g, i) => { if (g.week >= 2 && g.week <= 11 && g.iso) (byDate[g.iso] || (byDate[g.iso] = [])).push(i); });
    const weeks = {};
    Object.entries(byDate).filter(([, ix]) => ix.length >= 2).forEach(([iso, idxs]) => { (weeks[games()[idxs[0]].week] || (weeks[games()[idxs[0]].week] = [])).push({ iso, idxs }); });
    return weeks;
  };
  let improved = true, passes = 0, swaps = 0;
  while (improved && passes < 20) {
    improved = false;
    passes++;
    for (const pairs of Object.values(byWeek())) {
      for (let a = 0; a < pairs.length; a++) {
        for (let b = a + 1; b < pairs.length; b++) {
          const A = pairs[a], B = pairs[b];
          if (A.iso === B.iso) continue;
          const before = dayVariance();
          A.idxs.forEach(i => { games()[i].iso = B.iso; });
          B.idxs.forEach(i => { games()[i].iso = A.iso; });
          if (dayVariance() < before - 0.001) {
            improved = true;
            swaps++;
            pairs[a] = { iso: B.iso, idxs: A.idxs };
            pairs[b] = { iso: A.iso, idxs: B.idxs };
          } else {
            A.idxs.forEach(i => { games()[i].iso = A.iso; });
            B.idxs.forEach(i => { games()[i].iso = B.iso; });
          }
        }
      }
    }
  }
  return swaps ? `Balanced days: ${plural(swaps, 'swap')} of whole nights within a week.` : 'Days were already as even as swaps can make them.';
}

function balanceTimes() {
  const timeVariance = () => {
    const slots = {};
    games().forEach(g => [g.home, g.away].forEach(t => { const s = slots[t] || (slots[t] = {}); s[g.time] = (s[g.time] || 0) + 1; }));
    let v = 0;
    Object.values(slots).forEach(s => {
      const vals = Object.values(s);
      if (vals.length < 2) return;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      vals.forEach(x => { v += (x - mean) ** 2; });
    });
    return v;
  };
  // Only times swap, within the same date: matchups and dates never change.
  const byDate = {};
  games().forEach((g, i) => { (byDate[g.iso] || (byDate[g.iso] = [])).push(i); });
  let improved = true, passes = 0, swaps = 0;
  while (improved && passes < 40) {
    improved = false;
    passes++;
    for (const idxs of Object.values(byDate)) {
      for (let a = 0; a < idxs.length; a++) {
        for (let b = a + 1; b < idxs.length; b++) {
          const ga = games()[idxs[a]], gb = games()[idxs[b]];
          if (ga.time === gb.time) continue;
          const before = timeVariance();
          [ga.time, gb.time] = [gb.time, ga.time];
          if (timeVariance() < before - 0.001) { improved = true; swaps++; }
          else [ga.time, gb.time] = [gb.time, ga.time];
        }
      }
    }
  }
  return swaps ? `Balanced times: ${plural(swaps, 'swap')} within the same night.` : 'Time slots were already as even as swaps can make them.';
}

// ------------------------------------------------------------------ render

function renderTable() {
  const ts = teamsOf(), slots = slotsOf();
  const q = $('swFind').value.trim().toLowerCase();
  let idx = games().map((_, i) => i);
  if (q) idx = idx.filter(i => { const g = games()[i]; return `${g.home} ${g.away} ${dayDate(g.iso)} ${g.time} wk${g.week}`.toLowerCase().includes(q); });
  if (sort.field) {
    const val = (g) => ({ week: g.week, date: `${g.iso} ${String(timeHour(g.time)).padStart(5, '0')}`, time: timeHour(g.time), home: g.home, away: g.away })[sort.field];
    idx.sort((a, b) => { const x = val(games()[a]), y = val(games()[b]); return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1); });
  }
  const bad = new Set();
  const seen = new Map();
  games().forEach((g, i) => { if (g.home === g.away) bad.add(i); [g.home, g.away].forEach(t => { const k = `${t}|${g.iso}|${g.time}`; (seen.get(k) || seen.set(k, []).get(k)).push(i); }); });
  seen.forEach(list => { if (list.length > 1) list.forEach(i => bad.add(i)); });
  const opt = (list, sel) => list.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const th = (f, label) => `<th scope="col"><button type="button" class="sw-sort" data-sort="${f}">${label}${sort.field === f ? (sort.asc ? ' &#9650;' : ' &#9660;') : ''}</button></th>`;
  $('swCount').textContent = q ? `${idx.length} of ${games().length}` : games().length;
  $('swTable').innerHTML = `<thead><tr>${th('week', 'Wk')}${th('date', 'Date')}${th('time', 'Time')}${th('home', 'Home')}<th scope="col"><span class="u-sr-only">Swap</span></th>${th('away', 'Away')}</tr></thead>
    <tbody>${idx.map(i => {
      const g = games()[i];
      return `<tr data-i="${i}"${bad.has(i) ? ' class="is-bad"' : ''}>
        <td class="is-num">${g.week}</td>
        <td class="u-nowrap"><span class="sw-day">${g.iso ? dayOf(g.iso).slice(0, 3) : ''}</span><input class="aces-input sw-in" type="date" data-f="iso" value="${esc(g.iso)}" aria-label="Date"></td>
        <td><select class="aces-select sw-in" data-f="time" aria-label="Time">${opt(slots, g.time)}</select></td>
        <td><select class="aces-select sw-in" data-f="home" aria-label="Home">${opt(ts, g.home)}</select></td>
        <td><button class="aces-btn is-sm is-ghost sw-swap" type="button" data-swap title="Swap home and away" aria-label="Swap home and away">&#8644;</button></td>
        <td><select class="aces-select sw-in" data-f="away" aria-label="Away">${opt(ts, g.away)}</select></td>
      </tr>`;
    }).join('')}</tbody>`;
}

function bars(dist, total, order) {
  return order(Object.entries(dist)).map(([k, n]) => `<div class="sw-bar-row"><span>${esc(k)}</span><span class="sw-bar"><span style="width:${Math.round(n / total * 100)}%"></span></span><span class="is-num">${n}</span></div>`).join('');
}

function renderAnalysis() {
  const data = teamData();
  const ts = Object.keys(data).sort();
  if (!data[team]) team = ts[0];
  const d = data[team];
  const league = leagueDists();
  const ms = molski(d, league);
  const [label, cls] = molskiRating(ms);
  $('swTeams').innerHTML = ts.map(t => `<button type="button" class="aces-chip" data-pick="${esc(t)}" aria-pressed="${t === team}">${teamDot(t)}${esc(t)}</button>`).join('');
  $('swTiles').innerHTML = `<div class="aces-stat"><span class="aces-stat-value">${d.games}</span><span class="aces-stat-label">Games</span></div>
    <div class="aces-stat"><span class="aces-stat-value">${d.home}/${d.away}</span><span class="aces-stat-label">Home/away</span></div>
    <div class="aces-stat"><span class="aces-stat-value">${ms}</span><span class="aces-stat-label">MOLSKI <span class="aces-badge ${cls}">${label}</span></span></div>`;
  $('swDays').innerHTML = bars(d.days, d.games, e => e.sort((a, b) => DAYS.indexOf(a[0]) - DAYS.indexOf(b[0])));
  $('swTimes').innerHTML = bars(d.times, d.games, e => e.sort((a, b) => timeHour(a[0]) - timeHour(b[0])));
  const byes = byeWeeks(team);
  $('swByes').innerHTML = byes.length ? `<div class="aces-chip-row">${byes.map(w => `<span class="aces-badge is-outline">Week ${w}</span>`).join(' ')}</div>` : '<p class="sse-dim">None</p>';
  $('swOpps').innerHTML = Object.entries(d.opponents).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([o, n]) => `<span class="sw-opp">${teamDot(o)}${esc(o)} <strong>${n}</strong></span>`).join('');
  const scores = ts.map(t => ({ t, s: molski(data[t], league) })).sort((a, b) => a.s - b.s);
  $('swMolski').innerHTML = `<thead><tr><th scope="col" class="is-num">#</th><th scope="col">Team</th><th scope="col" class="is-num">MOLSKI</th><th scope="col">Rating</th></tr></thead>
    <tbody>${scores.map((x, i) => { const [l, c] = molskiRating(x.s); return `<tr${x.t === team ? ' class="is-me"' : ''}><td class="is-num">${i + 1}</td><td>${teamDot(x.t)}${esc(x.t)}</td><td class="is-num">${x.s}</td><td><span class="aces-badge ${c}">${l}</span></td></tr>`; }).join('')}</tbody>`;
  const avg = Math.round(scores.reduce((n, x) => n + x.s, 0) / scores.length);
  $('swMolskiNote').textContent = `League average ${avg}. Best ${scores[0].s} (${scores[0].t}), worst ${scores[scores.length - 1].s} (${scores[scores.length - 1].t}).`;
}

const heat = (n, max) => (n ? ` style="background:color-mix(in srgb, var(--color-brand) ${Math.round(12 + (n / max) * 58)}%, var(--color-surface));${n / max > 0.6 ? 'color:var(--color-on-brand);' : ''}"` : '');

function renderGrids() {
  const ts = teamsOf(), slots = slotsOf();
  // Opponent grid
  const m = Object.fromEntries(ts.map(t => [t, Object.fromEntries(ts.map(u => [u, 0]))]));
  games().forEach(g => { if (m[g.home] && m[g.away]) { m[g.home][g.away]++; m[g.away][g.home]++; } });
  const tot = Object.fromEntries(ts.map(t => [t, ts.reduce((n, u) => n + (u !== t ? m[t][u] : 0), 0)]));
  const mode = $('swOppSort').value;
  const order = [...ts];
  if (mode === 'most') order.sort((a, b) => tot[b] - tot[a] || a.localeCompare(b));
  if (mode === 'fewest') order.sort((a, b) => tot[a] - tot[b] || a.localeCompare(b));
  const maxO = Math.max(1, ...ts.flatMap(t => ts.map(u => (t === u ? 0 : m[t][u]))));
  $('swOppGrid').innerHTML = `<thead><tr><th scope="col">vs</th>${order.map(t => `<th scope="col" class="is-num">${esc(t)}</th>`).join('')}<th scope="col" class="is-num">Total</th></tr></thead>
    <tbody>${order.map(r => `<tr><th scope="row">${esc(r)}</th>${order.map(c => (r === c ? '<td class="is-num sw-diag">-</td>' : `<td class="is-num"${heat(m[r][c], maxO)}>${m[r][c] || '-'}</td>`)).join('')}<td class="is-num"><strong>${tot[r]}</strong></td></tr>`).join('')}</tbody>`;

  // Time slots by team
  const ct = Object.fromEntries(ts.map(t => [t, Object.fromEntries(slots.map(s => [s, 0]))]));
  games().forEach(g => [g.home, g.away].forEach(t => { if (ct[t]) ct[t][g.time] = (ct[t][g.time] || 0) + 1; }));
  const maxT = Math.max(1, ...ts.flatMap(t => slots.map(s => ct[t][s])));
  const expected = games().length ? (games().length * 2) / (ts.length * slots.length) : 0;
  const mark = (n) => (n - expected >= 1.5 ? ' &#9650;' : n - expected <= -1.5 ? ' &#9660;' : '');
  const colTot = Object.fromEntries(slots.map(s => [s, ts.reduce((n, t) => n + ct[t][s], 0)]));
  $('swTimeGrid').innerHTML = `<thead><tr><th scope="col">Team</th>${slots.map(s => `<th scope="col" class="is-num">${esc(s)}</th>`).join('')}<th scope="col" class="is-num">Total</th></tr></thead>
    <tbody>${ts.map(t => `<tr><th scope="row">${esc(t)}</th>${slots.map(s => `<td class="is-num"${heat(ct[t][s], maxT)}>${ct[t][s] ? `${ct[t][s]}${mark(ct[t][s])}` : '-'}</td>`).join('')}<td class="is-num"><strong>${slots.reduce((n, s) => n + ct[t][s], 0)}</strong></td></tr>`).join('')}
      <tr class="sw-foot"><th scope="row">Slot total</th>${slots.map(s => `<td class="is-num">${colTot[s]}</td>`).join('')}<td class="is-num">${games().length * 2}</td></tr></tbody>`;
  const heavy = ts.map(t => { const c = slots.map(s => ct[t][s]); const hi = Math.max(...c), lo = Math.min(...c); return hi - lo >= 3 ? `${t}: ${hi} at ${slots[c.indexOf(hi)]}, ${lo} at ${slots[c.indexOf(lo)]}` : ''; }).filter(Boolean);
  $('swTimeNotes').innerHTML = heavy.length
    ? `<p class="sw-note"><strong>Spread of 3 or more:</strong></p><div class="aces-chip-row">${heavy.map(h => `<span class="aces-badge is-alert">${esc(h)}</span>`).join(' ')}</div>`
    : '<p class="sw-note sw-ok">No team has a spread of 3 or more between its busiest and quietest slot.</p>';
}

function renderChart() {
  const sel = $('swChartTeam');
  const ts = teamsOf();
  const cur = ts.includes(sel.value) ? sel.value : ts[0];
  sel.innerHTML = ts.map(t => `<option value="${esc(t)}"${t === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const weeks = [...new Set(games().map(g => g.week))].sort((a, b) => a - b);
  const slots = slotsOf();
  if (!weeks.length || !slots.length) { $('swChart').innerHTML = ''; return; }
  const W = 760, H = 220, P = { t: 18, r: 20, b: 40, l: 80 };
  const CW = W - P.l - P.r, CH = H - P.t - P.b;
  const x = (w) => (weeks.length < 2 ? P.l + CW / 2 : P.l + ((w - weeks[0]) / (weeks[weeks.length - 1] - weeks[0])) * CW);
  const y = (s) => (slots.length < 2 ? P.t + CH / 2 : P.t + (slots.indexOf(s) / (slots.length - 1)) * CH);
  let svg = '';
  slots.forEach(s => { svg += `<line class="sw-grid-line" x1="${P.l}" y1="${y(s)}" x2="${W - P.r}" y2="${y(s)}"/><text class="sw-axis" x="${P.l - 8}" y="${y(s) + 4}" text-anchor="end">${esc(s)}</text>`; });
  const step = weeks.length > 18 ? 2 : 1;
  weeks.forEach((w, i) => { svg += `<line class="sw-grid-line is-faint" x1="${x(w)}" y1="${P.t}" x2="${x(w)}" y2="${H - P.b}"/>${i % step === 0 ? `<text class="sw-axis" x="${x(w)}" y="${H - P.b + 16}" text-anchor="middle">W${w}</text>` : ''}`; });
  const wk = {};
  games().forEach(g => { if (g.home === cur || g.away === cur) (wk[g.week] || (wk[g.week] = [])).push(g.time); });
  const played = weeks.filter(w => wk[w]?.length);
  const first = (w) => [...wk[w]].sort((a, b) => timeHour(a) - timeHour(b))[0];
  for (let i = 0; i < played.length - 1; i++) {
    const a = played[i], b = played[i + 1];
    svg += `<line class="sw-path${b - a > 1 ? ' is-gap' : ''}" x1="${x(a)}" y1="${y(first(a))}" x2="${x(b)}" y2="${y(first(b))}"/>`;
  }
  played.forEach(w => {
    const dh = wk[w].length > 1;
    wk[w].forEach(t => { svg += `<circle class="sw-dot${dh ? ' is-dh' : ''}" cx="${x(w)}" cy="${y(t)}" r="${dh ? 6 : 5}"><title>Week ${w}: ${esc(t)}${dh ? ' (doubleheader night)' : ''}</title></circle>`; });
  });
  $('swChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cur)} game times by week">${svg}</svg>`;
}

function render({ table = true } = {}) {
  const has = !!draft?.games?.length;
  $('swEmpty').hidden = has;
  $('swBody').hidden = !has;
  if (!has) return;
  $('swTitle').textContent = `${draft.year} ${cap(draft.seasonType)} schedule`;
  const ts = teamsOf();
  $('swMeta').textContent = `${games().length} games, ${ts.length} teams, weeks 1 to ${Math.max(...games().map(g => g.week))}.${draft.savedAt ? ` Last change ${new Date(draft.savedAt).toLocaleString()}.` : ''}`;
  const probs = problems();
  $('swWarn').innerHTML = probs.map(p => `<li class="tr-check is-warn"><span>${esc(p)}</span></li>`).join('');
  $('swWarn').hidden = !probs.length;
  if (table) renderTable();
  renderAnalysis();
  renderGrids();
  renderChart();
}

// ------------------------------------------------------------------ actions

async function saveImage(kind) {
  const table = kind === 'opp' ? $('swOppGrid') : $('swTimeGrid');
  const title = `${draft.year} ${cap(draft.seasonType)}: ${kind === 'opp' ? 'opponent grid' : 'time slots by team'}`;
  try {
    const canvas = drawTableImage(table, { title, foot: location.host, maxRows: 40 });
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const name = `${draft.year}-${draft.seasonType}-${kind === 'opp' ? 'opponent-grid' : 'time-slots'}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      showToast('Image saved');
    }
  } catch (err) {
    console.error('[workshop] image', err);
    showToast('Could not make the image', 'error');
  }
}

async function send() {
  const probs = problems();
  const warn = probs.length ? ` It still has ${plural(probs.length, 'warning')}.` : '';
  const extra = draft.newTeams?.length ? ` ${draft.newTeams.join(', ')} ${draft.newTeams.length === 1 ? 'is' : 'are'} not in the teams list yet, so add ${draft.newTeams.length === 1 ? 'it' : 'them'} first.` : '';
  if (!(await confirmModal(`Open Season setup with these ${games().length} games loaded?${warn}${extra} Nothing goes live until you finish Season setup's last step.`, { title: 'Send to Season setup', confirmLabel: 'Open Season setup' }))) return;
  if (!saveHandoff(draft)) { showToast('This browser is blocking storage, so the schedule cannot be handed over. Download the CSV and upload it in Season setup.', 'error'); return; }
  location.href = siteUrl('admin/season-setup.html?schedule=workshop');
}

function onEdit(e) {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  const g = games()[Number(el.closest('[data-i]').dataset.i)];
  if (!el.value || g[el.dataset.f] === el.value) return;
  snapshot();
  g[el.dataset.f] = el.value;
  commit();
}

function onClick(e) {
  const s = e.target.closest('[data-sort]');
  if (s) { sort = { field: s.dataset.sort, asc: sort.field === s.dataset.sort ? !sort.asc : true }; renderTable(); return; }
  const sw = e.target.closest('[data-swap]');
  if (sw) {
    const g = games()[Number(sw.closest('[data-i]').dataset.i)];
    snapshot();
    [g.home, g.away] = [g.away, g.home];
    commit();
  }
}

/** Called each time the tab opens: pick up a new schedule from Generate. */
export function show() {
  const fresh = loadDraft();
  if (fresh?.savedAt !== draft?.savedAt || (!!fresh) !== (!!draft)) {
    draft = fresh ? { ...fresh, games: fresh.games.map(g => ({ ...g })) } : null;
    undo.length = 0;
    $('swUndo').disabled = true;
    sort = { field: '', asc: true };
    team = '';
    $('swStatus').textContent = '';
    render();
  }
}

export function mount(c) {
  ctx = c;
  $('swTable').addEventListener('change', onEdit);
  $('swTable').addEventListener('click', onClick);
  $('swFind').addEventListener('input', renderTable);
  $('swTeams').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { team = b.dataset.pick; renderAnalysis(); } });
  $('swOppSort').addEventListener('change', renderGrids);
  $('swChartTeam').addEventListener('change', renderChart);
  document.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => {
    snapshot();
    const msg = b.dataset.fix === 'days' ? balanceDays() : balanceTimes();
    $('swStatus').textContent = msg;
    commit();
  }));
  document.querySelectorAll('[data-image]').forEach(b => b.addEventListener('click', () => saveImage(b.dataset.image)));
  $('swUndo').addEventListener('click', () => {
    const prev = undo.pop();
    if (!prev) return;
    draft.games = JSON.parse(prev);
    $('swUndo').disabled = !undo.length;
    $('swStatus').textContent = 'Undone.';
    commit();
  });
  $('swCsv').addEventListener('click', () => download(`${draft.year}-${draft.seasonType}-schedule.csv`, scheduleCsv(games())));
  $('swSend').addEventListener('click', send);
  $('swClear').addEventListener('click', async () => {
    if (!(await confirmModal('Clear the Workshop? The schedule and your edits are removed from this device.', { confirmLabel: 'Clear', danger: true }))) return;
    clearDraft();
    draft = null;
    render();
  });
  draft = null;
  show();
}
