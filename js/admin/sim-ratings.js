// js/admin/sim-ratings.js
// admin/sim-ratings.html: the ratings grid for the Aces Sim (sim.html).
// Loads the season's pool (js/data/sim.js), lets the admin set range, arm and
// pitching and override contact/power/speed, saves to simRatings/{seasonId},
// and can play a batch of computer-vs-computer games to check the run level.

import { initPage, pageReady } from '../core/app.js';
import { mountAdminShell } from './shell.js';
import { loadSimPool, saveSimRatings } from '../data/sim.js';
import {
  RATING_KEYS, STAT_KEYS, SET_KEYS, RATING_LABELS, RATING_ABBR, SCALE,
  positionTag, refreshOverall, savedEntry, leagueSummary
} from '../domain/sim-ratings.js';
import { pickOwner, legalPicks, makeTeam, newGame, simToEnd } from '../domain/sim-engine.js';
import { seasonLabel } from '../domain/season-ids.js';
import { escapeHtml as esc, fmtAvg } from '../ui/format.js';
import { teamDot } from '../ui/game-shared.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';

const $ = (id) => document.getElementById(id);

const S = {
  data: null,           // loadSimPool() result
  base: new Map(),      // id -> JSON of savedEntry at load/save time
  sort: { key: 'ovr', dir: -1 },
  who: ''
};

const COLS = [
  { key: 'name', label: 'Player' },
  { key: 'team', label: 'Team' },
  { key: 'pos', label: 'Pos', title: 'Roster position' },
  { key: 'g', label: 'G', num: true, title: 'Games' },
  { key: 'ab', label: 'AB', num: true, title: 'At-bats' },
  { key: 'avg', label: 'AVG', num: true, title: 'Batting average' },
  { key: 'xbh', label: 'XBH/AB', num: true, title: 'Extra-base hits per at-bat' },
  { key: 'rg', label: 'R/G', num: true, title: 'Runs per game' },
  { key: 'ip', label: 'IP', num: true, title: 'Innings pitched' },
  { key: 'era', label: 'ERA', num: true, title: 'Runs allowed per 7 innings' },
  ...RATING_KEYS.map((k) => ({ key: k, label: RATING_ABBR[k], num: true, rating: true, title: RATING_LABELS[k] })),
  { key: 'ovr', label: 'OVR', num: true, title: 'Overall at his best spot (draft value)' }
];

const stat = (p, key) => {
  const l = p.line;
  switch (key) {
    case 'name': return p.name.toLowerCase();
    case 'team': return p.team.toLowerCase();
    case 'pos': return positionTag(p.pos);
    case 'g': return l.g;
    case 'ab': return l.ab;
    case 'avg': return l.ab ? l.h / l.ab : -1;
    case 'xbh': return l.ab ? (l.d + l.t + l.hr) / l.ab : -1;
    case 'rg': return l.g ? l.r / l.g : -1;
    case 'ip': return l.ip;
    case 'era': return l.ip ? (l.ra * 7) / l.ip : 99;
    case 'ovr': return p.ovr;
    default: return p.ratings[key];
  }
};

const band = (v) => (v < 35 ? 1 : v < 45 ? 2 : v < 55 ? 3 : v < 65 ? 4 : 5);
const ipShort = (ip) => (ip ? (Math.round(ip * 10) / 10).toString() : '');

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function load(seasonId) {
  $('srLeague').innerHTML = '<p class="sse-dim">Loading...</p>';
  $('srTable').innerHTML = '';
  S.data = await loadSimPool(seasonId);
  const d = S.data;
  $('srSeason').innerHTML = d.seasons.map((id) => `<option value="${esc(id)}"${id === d.seasonId ? ' selected' : ''}>${esc(seasonLabel(id))}</option>`).join('');
  if (!d.seasonId) {
    $('srLeague').innerHTML = '<p class="aces-empty">No season rosters yet.</p>';
    return;
  }
  S.base = new Map(d.players.map((p) => [p.id, JSON.stringify(savedEntry(p))]));
  const teams = [...new Set(d.players.map((p) => p.team))].sort();
  $('srTeam').innerHTML = '<option value="">All teams</option>' + teams.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  renderLeague();
  renderTable();
  updateDirty();
}

function renderLeague() {
  const { league: L, players, savedAt, savedBy, seasonId } = S.data;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const setCount = players.filter((p) => SET_KEYS.some((k) => p.edited.has(k))).length;
  $('srLeague').innerHTML = `
    <h2 class="aces-card-title">${esc(seasonLabel(seasonId))} league baseline</h2>
    <div class="aces-stats sr-tiles">
      <div class="aces-stat"><span class="aces-stat-value">${fmtAvg(L.ba)}</span><span class="aces-stat-label">AVG</span></div>
      <div class="aces-stat"><span class="aces-stat-value">${fmtAvg(L.xbh)}</span><span class="aces-stat-label">XBH per AB</span></div>
      <div class="aces-stat"><span class="aces-stat-value">${L.rg.toFixed(2)}</span><span class="aces-stat-label">Runs per game (player)</span></div>
      <div class="aces-stat"><span class="aces-stat-value">${L.era.toFixed(2)}</span><span class="aces-stat-label">ERA (team runs per 7)</span></div>
      <div class="aces-stat"><span class="aces-stat-value">${pct(L.bb)}</span><span class="aces-stat-label">Walk rate</span></div>
      <div class="aces-stat"><span class="aces-stat-value">${players.length}</span><span class="aces-stat-label">Players in the pool</span></div>
    </div>
    <p class="sse-dim">${L.hitTypes ? `Hit mix: ${pct(L.mix.d)} doubles, ${pct(L.mix.t)} triples, ${pct(L.mix.hr)} home runs of extra-base hits.` : 'This season has no 2B/3B/HR, so power uses a default rate and everyone starts near 50.'}
      ${setCount ? `${setCount} players have defense or pitching set.` : 'No defense or pitching set yet: everyone is 50 range and arm.'}
      ${savedAt ? `Last saved ${esc(savedAt.toLocaleString())}${savedBy ? ` by ${esc(savedBy)}` : ''}.` : 'Not saved yet.'}</p>`;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function visible() {
  const q = $('srSearch').value.trim().toLowerCase();
  const team = $('srTeam').value;
  const pos = $('srPos').value;
  const edited = $('srEdited').checked;
  const { key, dir } = S.sort;
  return S.data.players
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .filter((p) => !team || p.team === team)
    .filter((p) => {
      if (!pos) return true;
      if (pos === 'UT' || pos === 'FLEX') return p.pos.wild === pos;
      if (p.pos.wild) return false;
      if (pos === 'IF') return p.pos.slots.some((s) => ['1B', '2B', '3B', 'SS'].includes(s));
      if (pos === 'OF') return p.pos.slots.some((s) => ['LF', 'CF', 'RF'].includes(s));
      return p.pos.slots.includes(pos);
    })
    .filter((p) => !edited || p.edited.size)
    .sort((a, b) => {
      const x = stat(a, key);
      const y = stat(b, key);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name);
    });
}

function renderTable() {
  const rows = visible();
  $('srCount').textContent = `${rows.length} of ${S.data.players.length}`;
  const head = COLS.map((c) => {
    const sorted = S.sort.key === c.key;
    return `<th scope="col" class="${c.num ? 'is-num' : ''}${c.rating ? ' sr-rh' : ''}"${sorted ? ` aria-sort="${S.sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>
      <button type="button" class="sr-sort" data-sort="${c.key}"${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}${sorted ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
  }).join('');
  $('srTable').innerHTML = `<thead><tr>${head}<th scope="col"><span class="u-sr-only">Reset</span></th></tr></thead>
    <tbody>${rows.map(rowHtml).join('') || `<tr><td colspan="${COLS.length + 1}" class="aces-empty">No players match.</td></tr>`}</tbody>`;
}

function rowHtml(p) {
  const l = p.line;
  const cells = [
    `<th scope="row" class="sr-name">${esc(p.name)}</th>`,
    `<td>${teamDot(p.team)}${esc(p.team)}</td>`,
    `<td><span class="sim-pos${p.pos.wild ? ' is-wild' : ''}" title="Roster: ${esc(p.position)}">${esc(positionTag(p.pos))}</span></td>`,
    `<td class="is-num">${l.g || ''}</td>`,
    `<td class="is-num">${l.ab || ''}</td>`,
    `<td class="is-num">${l.ab ? fmtAvg(l.h / l.ab) : ''}</td>`,
    `<td class="is-num">${l.ab ? fmtAvg((l.d + l.t + l.hr) / l.ab) : ''}</td>`,
    `<td class="is-num">${l.g ? (l.r / l.g).toFixed(2) : ''}</td>`,
    `<td class="is-num">${ipShort(l.ip)}</td>`,
    `<td class="is-num">${l.ip ? ((l.ra * 7) / l.ip).toFixed(2) : ''}</td>`,
    ...RATING_KEYS.map((k) => ratingCell(p, k)),
    `<td class="is-num sr-ovr" data-ovr="${esc(p.id)}"><span class="sim-rating" data-band="${band(p.ovr)}">${p.ovr}</span></td>`,
    `<td class="rc-row-actions"><button class="aces-btn is-sm is-ghost" type="button" data-reset="${esc(p.id)}" title="Back to the computed ratings and 50 defense"${p.edited.size ? '' : ' disabled'}>Reset</button></td>`
  ];
  return `<tr data-id="${esc(p.id)}">${cells.join('')}</tr>`;
}

function ratingCell(p, k) {
  const v = p.ratings[k];
  const over = STAT_KEYS.includes(k) && v !== p.computed[k];
  const set = SET_KEYS.includes(k) && p.edited.has(k);
  const tip = STAT_KEYS.includes(k) ? `Computed ${p.computed[k]}` : k === 'pitch' ? `From ERA ${p.computed.pitch}` : 'Default 50';
  return `<td class="is-num sr-cell${over ? ' is-over' : ''}${set ? ' is-set' : ''}" data-band="${band(v)}">
    <input class="sr-in" type="number" inputmode="numeric" min="${SCALE.MIN}" max="${SCALE.MAX}" step="1" value="${v}"
      data-id="${esc(p.id)}" data-key="${k}" aria-label="${esc(p.name)} ${esc(RATING_LABELS[k])}" title="${esc(tip)}"></td>`;
}

const playerById = (id) => S.data.players.find((p) => p.id === id);

function onInput(e) {
  const input = e.target.closest('.sr-in');
  if (!input) return;
  const p = playerById(input.dataset.id);
  const k = input.dataset.key;
  let v = Math.round(Number(input.value));
  if (!Number.isFinite(v)) return;
  if (e.type === 'change') {
    v = Math.min(SCALE.MAX, Math.max(SCALE.MIN, v));
    input.value = v;
  } else if (v < SCALE.MIN || v > SCALE.MAX) return;
  p.ratings[k] = v;
  if (SET_KEYS.includes(k)) p.edited.add(k);
  else if (v !== p.computed[k]) p.edited.add(k); else p.edited.delete(k);
  refreshOverall(p);
  const td = input.closest('td');
  td.dataset.band = band(v);
  td.classList.toggle('is-over', STAT_KEYS.includes(k) && v !== p.computed[k]);
  td.classList.toggle('is-set', SET_KEYS.includes(k));
  const ovr = $('srTable').querySelector(`[data-ovr="${CSS.escape(p.id)}"] .sim-rating`);
  if (ovr) { ovr.textContent = p.ovr; ovr.dataset.band = band(p.ovr); }
  const reset = $('srTable').querySelector(`[data-reset="${CSS.escape(p.id)}"]`);
  if (reset) reset.disabled = !p.edited.size;
  updateDirty();
}

function resetPlayer(id) {
  const p = playerById(id);
  p.ratings = { ...p.computed };
  p.edited = new Set();
  refreshOverall(p);
  const tr = $('srTable').querySelector(`tr[data-id="${CSS.escape(id)}"]`);
  if (tr) tr.outerHTML = rowHtml(p);
  updateDirty();
}

// Up/Down arrows move between rows in the same column, like a spreadsheet.
function onKey(e) {
  const input = e.target.closest('.sr-in');
  if (!input || !['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) return;
  if (e.key !== 'Enter' && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    // Plain arrows keep their number-input meaning (step); Enter / modified arrows move.
    return;
  }
  e.preventDefault();
  const tr = input.closest('tr');
  const next = (e.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling);
  next?.querySelector(`.sr-in[data-key="${input.dataset.key}"]`)?.focus();
  next?.querySelector(`.sr-in[data-key="${input.dataset.key}"]`)?.select();
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

function dirtyPlayers() {
  return S.data.players.filter((p) => JSON.stringify(savedEntry(p)) !== S.base.get(p.id));
}

function updateDirty() {
  const n = dirtyPlayers().length;
  $('srSaveBar').hidden = n === 0;
  $('srDirty').textContent = `${n} player${n === 1 ? '' : 's'} changed`;
}

async function save() {
  const btn = $('srSave');
  btn.disabled = true;
  try {
    const out = {};
    for (const p of S.data.players) {
      const e = savedEntry(p);
      if (e) out[p.id] = e;
    }
    await saveSimRatings(S.data.seasonId, out, S.who);
    S.base = new Map(S.data.players.map((p) => [p.id, JSON.stringify(savedEntry(p))]));
    S.data.savedAt = new Date();
    S.data.savedBy = S.who;
    renderLeague();
    updateDirty();
    showToast('Ratings saved');
  } catch (err) {
    console.error(err);
    showToast(`Couldn't save: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function discard() {
  if (!(await confirmModal('Discard the unsaved rating changes?', { danger: true, confirmLabel: 'Discard' }))) return;
  await load(S.data.seasonId);
}

// ---------------------------------------------------------------------------
// Check the sim
// ---------------------------------------------------------------------------

async function runTest() {
  const n = Number($('srTestN').value) || 300;
  const out = $('srTestOut');
  const btn = $('srTest');
  btn.disabled = true;
  const league = leagueSummary(S.data.league);
  const pool0 = S.data.players;
  if (pool0.length < 18) { out.innerHTML = '<p class="aces-empty">Need at least 18 players.</p>'; btn.disabled = false; return; }
  const t = { games: 0, runs: 0, ab: 0, h: 0, xbh: 0, hr: 0, bb: 0, pa: 0, mercy: 0, ties: 0, innings: 0, high: 0 };
  const step = 20;
  for (let done = 0; done < n; done += step) {
    for (let i = done; i < Math.min(n, done + step); i += 1) {
      let pool = [...pool0];
      const teams = [{ picks: [] }, { picks: [] }];
      for (let k = 0; k < 18; k += 1) {
        const ti = pickOwner(k, i % 2);
        // Random legal picks, so the teams look like the league, not its all-stars.
        const legal = [...legalPicks(ti, teams, pool)];
        const id = legal[Math.floor(Math.random() * legal.length)];
        const p = pool.find((x) => x.id === id);
        if (!p) break;
        teams[ti].picks.push(p);
        pool = pool.filter((x) => x !== p);
      }
      if (teams.some((x) => x.picks.length < 9)) continue;
      const g = newGame({
        away: makeTeam({ name: 'A', cpu: true, players: teams[0].picks }),
        home: makeTeam({ name: 'B', cpu: true, players: teams[1].picks }),
        league
      });
      simToEnd(g);
      t.games += 1;
      t.runs += g.score[0] + g.score[1];
      t.high = Math.max(t.high, ...g.score);
      t.innings += g.result.innings;
      if (g.result.how === 'mercy') t.mercy += 1;
      if (g.result.how === 'tie') t.ties += 1;
      for (const team of g.teams) {
        for (const b of Object.values(team.box)) {
          t.ab += b.ab; t.h += b.h; t.xbh += b.d + b.t + b.hr; t.hr += b.hr; t.bb += b.bb; t.pa += b.ab + b.bb;
        }
      }
    }
    out.innerHTML = `<p class="sse-dim">Playing... ${Math.min(n, done + step)} of ${n}</p>`;
    await new Promise((r) => setTimeout(r, 0));
  }
  const L = S.data.league;
  const per = (v) => (t.games ? v / t.games : 0);
  out.innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact">
    <thead><tr><th scope="col"></th><th scope="col" class="is-num">Sim (${t.games} games)</th><th scope="col" class="is-num">League</th></tr></thead>
    <tbody>
      <tr><th scope="row">Runs per team per game</th><td class="is-num">${(per(t.runs) / 2).toFixed(2)}</td><td class="is-num">${L.era.toFixed(2)}</td></tr>
      <tr><th scope="row">AVG</th><td class="is-num">${fmtAvg(t.h / t.ab)}</td><td class="is-num">${fmtAvg(L.ba)}</td></tr>
      <tr><th scope="row">XBH per AB</th><td class="is-num">${fmtAvg(t.xbh / t.ab)}</td><td class="is-num">${fmtAvg(L.xbh)}</td></tr>
      <tr><th scope="row">HR per AB</th><td class="is-num">${fmtAvg(t.hr / t.ab)}</td><td class="is-num">${fmtAvg(L.xbh * L.mix.hr)}</td></tr>
      <tr><th scope="row">Walk rate</th><td class="is-num">${(100 * t.bb / t.pa).toFixed(1)}%</td><td class="is-num">${(100 * L.bb).toFixed(1)}%</td></tr>
      <tr><th scope="row">Mercy-rule games</th><td class="is-num">${(100 * t.mercy / t.games).toFixed(0)}%</td><td></td></tr>
      <tr><th scope="row">Ties (${10} innings)</th><td class="is-num">${t.ties}</td><td></td></tr>
      <tr><th scope="row">Most runs by a team</th><td class="is-num">${t.high}</td><td></td></tr>
    </tbody></table></div>
    <p class="sse-dim">Teams are drafted at random from the pool, so they should hit like the league. Runs are compared with the league ERA (every run allowed, per 7 innings).</p>`;
  btn.disabled = false;
}

// ---------------------------------------------------------------------------

const { profile } = await initPage({ title: 'Sim ratings', role: 'admin' });
mountAdminShell(profile, 'admin/sim-ratings.html');
S.who = profile?.displayName || profile?.linkedPlayer || profile?.email || '';

$('srSeason').addEventListener('change', async (e) => {
  if (dirtyPlayers().length && !(await confirmModal('Switch seasons and lose the unsaved changes?', { danger: true, confirmLabel: 'Switch' }))) {
    e.target.value = S.data.seasonId;
    return;
  }
  load(e.target.value);
});
['srSearch', 'srTeam', 'srPos', 'srEdited'].forEach((id) => $(id).addEventListener(id === 'srSearch' ? 'input' : 'change', renderTable));
$('srTable').addEventListener('input', onInput);
$('srTable').addEventListener('change', onInput);
$('srTable').addEventListener('keydown', onKey);
$('srTable').addEventListener('focusin', (e) => { if (e.target.matches('.sr-in')) e.target.select(); });
$('srTable').addEventListener('click', (e) => {
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn) {
    const key = sortBtn.dataset.sort;
    S.sort = S.sort.key === key ? { key, dir: -S.sort.dir } : { key, dir: ['name', 'team', 'pos'].includes(key) ? 1 : -1 };
    renderTable();
    return;
  }
  const reset = e.target.closest('[data-reset]');
  if (reset) resetPlayer(reset.dataset.reset);
});
$('srSave').addEventListener('click', save);
$('srUndo').addEventListener('click', discard);
$('srTest').addEventListener('click', runTest);
window.addEventListener('beforeunload', (e) => { if (S.data && dirtyPlayers().length) { e.preventDefault(); e.returnValue = ''; } });

try {
  await load(new URLSearchParams(location.search).get('season') || undefined);
} catch (err) {
  console.error(err);
  $('srLeague').innerHTML = `<p class="aces-empty">Couldn't load the pool: ${esc(err.message || err)}</p>`;
}
pageReady();
