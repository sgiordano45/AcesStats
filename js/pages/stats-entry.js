// js/pages/stats-entry.js
// Enter or fix one team's stats for one game. Shared by the captain page
// (submit-stats.html, js/pages/submit-stats.js) and admin Enter stats
// (admin/submit-stats.html, js/admin/submit-stats.js); both use the same
// markup (sse* ids). Captains and team staff see their own team's games;
// league staff and admins see every game.
//
//   1. Pick the game and side from the season's games. Each side shows
//      whether its stats are in (statsSubmittedHome / statsSubmittedAway).
//      ?season=&game=&side=home|away opens straight to a side.
//   2. The roster grid loads any stats already saved for that game, so the
//      same screen enters new stats and corrects old ones. A scoresheet PDF
//      can fill the grid instead of typing.
//   3. Subs: a player from another team's roster is added as a sub (batting
//      only). His doc is playerStats/{his legacyId}/games/{season}_{gameId}
//      with isSub: true, teamId = the team he played for, homeTeam = his own
//      team; the aggregator keeps it off his regular season line. The game
//      doc lists the side's subs in subsHome / subsAway ([{ legacyId, name,
//      homeTeam }]) so they reload; the old single subHome / subAway is read
//      too and cleared on save. Someone on no roster is added by name as a
//      regular line.
//   4. Save writes playerStats/{legacyId}/games/{season}_{gameId} and
//      pitchingStats/... (merge), removes stats for players unticked from
//      Played, and marks the side's stats as in on the game doc.
//
// Fields the grid doesn't show (strikeouts, stolen bases, a pitcher's
// earned runs, wins...) are only set to 0 when a doc is first created, so
// fixing a typo never wipes what the Game Tracker recorded.
// The CSV tab (many games for one team) is js/admin/stats-csv.js.

import { pageReady } from '../core/app.js';
import { db, collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp } from '../core/firebase.js';
import { getSeasonGames } from '../data/games.js';
import { getAllSeasons } from '../data/seasons.js';
import { getSeasonPlayerStatsOptimized } from '../data/player-stats.js';
import { getTeamRosterDoc } from '../../firebase-roster.js';
import { normalizeGame } from '../domain/standings.js';
import { parseGameDateTime, formatGameDate, toDateKey } from '../domain/dates.js';
import { seasonLabel, seasonSortKey } from '../domain/season-ids.js';
import { escapeHtml as esc } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { mountCsv } from '../admin/stats-csv.js';
import { parsePdf } from '../admin/stats-pdf.js';

const $ = (id) => document.getElementById(id);
const GAME_LENGTH_MS = 2 * 60 * 60 * 1000;

// [key, label, field on the playerStats game doc]
const BAT = [['ab', 'AB', 'atBats'], ['h', 'H', 'hits'], ['d2', '2B', 'doubles'], ['d3', '3B', 'triples'],
  ['hr', 'HR', 'homeRuns'], ['r', 'R', 'runs'], ['rbi', 'RBI', 'rbi'], ['bb', 'BB', 'walks']];
const PIT = [['ip', 'IP', 'inningsPitched'], ['ra', 'RA', 'runsAllowed']];
const ALL = [...BAT, ...PIT];
const PDF_KEY = { ab: 'ab', h: 'h', d2: '2b', d3: '3b', hr: 'hr', r: 'r', rbi: 'rbi', bb: 'bb', ip: 'ip', ra: 'ra' };

let user = null;
let opts = {};             // { scope: [lowercase team keys] | null, isAdmin, pipelineHref }
let teams = [];
let seasonId = '';
let items = [];            // season games with stats status
let filter = 'need';
let sel = null;            // the picked game and side
let rows = [];             // grid rows: { legacyId, name, id, played, v:{}, bat, pit, added, isSub, homeTeam }
let source = 'entry';      // 'entry' or 'pdf'
let pdfRows = [];
let saving = false;
let subPool = null;        // other teams' rostered players for the season: [{ legacyId, name, team }]
let subPoolKey = '';

const toLegacyId = (name) => String(name || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, '_');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower = (s) => String(s || '').toLowerCase();
const inScope = (...keys) => !opts.scope || keys.some(k => k && opts.scope.includes(lower(k)));

function notice(type, html) {
  const el = $('sseNotice');
  if (!html) { el.hidden = true; return; }
  const ic = { success: 'check-circle', error: 'x-circle', warning: 'alert' }[type] || 'info';
  el.className = `aces-notice${type === 'info' ? '' : ` is-${type}`}`;
  el.innerHTML = `${icon(ic)}<div>${html}</div>`;
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

const sideKeys = (x, side) => (side === 'home' ? [x.g.home, x.r.homeTeamId] : [x.g.away, x.r.awayTeamId]);
const mine = (x, side) => inScope(...sideKeys(x, side));

async function loadSeason(id) {
  seasonId = id;
  subPool = null;
  $('sseGames').innerHTML = '<p class="sse-dim">Loading games...</p>';
  const raw = await getSeasonGames(id);
  const now = Date.now();
  items = raw.map(r => {
    const g = normalizeGame(r);
    const start = parseGameDateTime(r.date, r.time)?.getTime() || 0;
    const decided = !!g.winner || !!g.unmatchedWinner;
    const all = r.statsSubmitted === true;
    return {
      r, g, start,
      played: decided || g.hasScores || (start && start + GAME_LENGTH_MS < now),
      awayIn: all || r.statsSubmittedAway === true,
      homeIn: all || r.statsSubmittedHome === true
    };
  }).filter(x => !opts.scope || mine(x, 'home') || mine(x, 'away'))
    .sort((a, b) => b.start - a.start);
  renderGames();
}

const needsStats = (x) => x.played && ((mine(x, 'away') && !x.awayIn) || (mine(x, 'home') && !x.homeIn));

function sideButton(x, side) {
  const team = side === 'home' ? x.g.home : x.g.away;
  if (!mine(x, side)) return `<span class="sse-side is-other"><span>${esc(team || 'TBD')}</span></span>`;
  const isIn = side === 'home' ? x.homeIn : x.awayIn;
  const on = sel && sel.r.id === x.r.id && sel.side === side;
  const badge = !x.played ? '' : isIn ? '<span class="aces-badge is-win">In</span>' : '<span class="aces-badge is-alert">Missing</span>';
  return `<button class="sse-side${on ? ' is-on' : ''}" type="button" data-game="${esc(x.r.id)}" data-side="${side}" aria-pressed="${on}">
    <span>${esc(team || 'TBD')}</span>${badge}</button>`;
}

function renderGames() {
  const need = items.filter(needsStats);
  const list = filter === 'need' ? need : items;
  $('sseCount').textContent = filter === 'need' ? `${need.length} need stats` : `${items.length} games`;
  if (!list.length) {
    $('sseGames').innerHTML = `<p class="sse-empty">${filter === 'need'
      ? `Every played game has ${opts.scope ? 'your' : 'both teams\''} stats in. Switch to All games to fix an earlier one.`
      : 'No games in this season yet.'}</p>`;
    return;
  }
  $('sseGames').innerHTML = `<ul class="sse-games">${list.map(x => {
    const { g } = x;
    const score = g.hasScores ? `${g.awayScore}-${g.homeScore}` : x.played ? 'Final' : 'Upcoming';
    const kind = g.type === 'playoff' ? `<span class="aces-badge is-brand">${esc(g.round || 'Playoff')}</span>` : '';
    return `<li class="sse-game${sel && sel.r.id === x.r.id ? ' is-on' : ''}">
      <div class="sse-game-info">
        <span class="sse-game-date">${esc(x.r.date ? formatGameDate(x.r.date) : 'No date')}</span>
        <span class="sse-game-score">${esc(score)}</span>${kind}
      </div>
      <div class="sse-sides">${sideButton(x, 'away')}<span class="sse-at">at</span>${sideButton(x, 'home')}</div>
    </li>`;
  }).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Roster, subs and existing stats
// ---------------------------------------------------------------------------

async function loadRoster(teamId) {
  const doc_ = await getTeamRosterDoc(teamId, seasonId);
  if (doc_.length) {
    return doc_.map(p => ({ id: p.playerId, legacyId: p.legacyId, name: p.name }));
  }
  // Seasons before 2026 have no roster docs: use the season's aggregated players.
  const players = await getSeasonPlayerStatsOptimized(seasonId);
  return players
    .filter(p => lower(p.team) === lower(teamId) && !p.migrated)
    .map(p => ({
      id: p.id,
      legacyId: p.isAuthUser ? toLegacyId(p.name) : p.id,
      name: p.name || p.playerName || p.id
    }));
}

/** Players on the other teams' rosters this season, for the sub picker. */
async function loadSubPool() {
  const key = `${seasonId}|${lower(sel.teamId)}`;
  if (subPool && subPoolKey === key) return subPool;
  const own = new Set(rows.filter(r => !r.isSub).map(r => r.legacyId));
  const others = teams.filter(t => lower(t.id) !== lower(sel.teamId) && lower(t.name) !== lower(sel.teamId));
  const lists = await Promise.all(others.map(async t => {
    const players = await getTeamRosterDoc(t.id, seasonId).catch(() => []);
    return players.filter(p => p.legacyId && !own.has(p.legacyId)).map(p => ({ legacyId: p.legacyId, name: p.name, team: t.name || t.id }));
  }));
  subPool = lists.flat().sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  subPoolKey = key;
  return subPool;
}

function renderSubPicker() {
  const sel_ = $('sseSubPick');
  if (!subPool) { sel_.innerHTML = '<option value="">Loading other teams...</option>'; sel_.disabled = true; return; }
  const taken = new Set(rows.map(r => r.legacyId));
  const byTeam = {};
  subPool.filter(p => !taken.has(p.legacyId)).forEach(p => { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
  sel_.innerHTML = `<option value="">Pick a player from another team</option>${Object.keys(byTeam).sort().map(t =>
    `<optgroup label="${esc(t)}">${byTeam[t].map(p => `<option value="${esc(p.legacyId)}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('')}`;
  sel_.disabled = !subPool.length;
}

async function loadExisting(legacyId) {
  const [b, p] = await Promise.all([
    getDoc(doc(db, 'playerStats', legacyId, 'games', sel.gameDocId)).catch(() => null),
    getDoc(doc(db, 'pitchingStats', legacyId, 'games', sel.gameDocId)).catch(() => null)
  ]);
  return { bat: b?.exists() ? b.data() : null, pit: p?.exists() ? p.data() : null };
}

function valuesFrom(ex) {
  const v = {};
  BAT.forEach(([k, , f]) => { v[k] = Number(ex.bat?.[f]) || 0; });
  PIT.forEach(([k, , f]) => { v[k] = Number(ex.pit?.[f]) || 0; });
  return v;
}

/** The side's saved subs from the game doc (new list, or the old single marker). */
function savedSubs(r, isHome) {
  const list = r[isHome ? 'subsHome' : 'subsAway'];
  const one = r[isHome ? 'subHome' : 'subAway'];
  const out = Array.isArray(list) ? list.filter(s => s?.legacyId) : [];
  if (one?.legacyId && !out.some(s => s.legacyId === one.legacyId)) out.push(one);
  return out;
}

async function selectSide(gameId, side, { scroll = true } = {}) {
  const x = items.find(i => i.r.id === gameId);
  if (!x || !mine(x, side)) return;
  const label = side === 'home' ? x.g.home : x.g.away;
  const opp = side === 'home' ? x.g.away : x.g.home;
  const team = teams.find(t => lower(t.id) === lower(label) || lower(t.name) === lower(label));
  sel = {
    r: x.r, g: x.g, side, isHome: side === 'home',
    teamId: team?.id || label, teamName: team?.name || team?.id || label, opponent: opp || 'Unknown',
    gameDocId: `${seasonId}_${x.r.id}`
  };
  history.replaceState(null, '', `?season=${encodeURIComponent(seasonId)}&game=${encodeURIComponent(x.r.id)}&side=${side}`);
  renderGames();

  $('sseEntry').hidden = false;
  $('sseTeam').textContent = `${sel.teamName} stats`;
  $('sseGameLine').textContent = `${sel.isHome ? 'vs' : 'at'} ${sel.opponent}, ${x.r.date ? formatGameDate(x.r.date, 'long') : 'no date'}${x.g.hasScores ? `, final ${x.g.awayScore}-${x.g.homeScore}` : ''}`;
  $('sseGrid').innerHTML = '<p class="sse-dim">Loading roster and saved stats...</p>';
  notice('', '');
  clearPdf();
  setPane('type');
  if (scroll) $('sseEntry').scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const roster = (await loadRoster(sel.teamId)).filter(p => p.legacyId);
    roster.sort((a, b) => a.name.localeCompare(b.name));
    const subs = savedSubs(x.r, sel.isHome).filter(s => !roster.some(p => p.legacyId === s.legacyId));
    const [existing, subExisting] = await Promise.all([
      Promise.all(roster.map(p => loadExisting(p.legacyId))),
      Promise.all(subs.map(s => loadExisting(s.legacyId)))
    ]);
    const editing = existing.some(e => e.bat || e.pit);
    rows = roster.map((p, i) => ({
      ...p, bat: existing[i].bat, pit: existing[i].pit,
      played: editing ? !!(existing[i].bat || existing[i].pit) : true,
      v: valuesFrom(existing[i])
    }));
    subs.forEach((s, i) => {
      const ex = subExisting[i];
      // Only this team's sub doc counts; anything else under his ID is not ours to edit.
      if (!ex.bat || ex.bat.isSub !== true || lower(ex.bat.teamId) !== lower(sel.teamName)) return;
      rows.push({ id: s.legacyId, legacyId: s.legacyId, name: s.name || ex.bat.playerName, isSub: true, homeTeam: s.homeTeam || ex.bat.homeTeam || '', bat: ex.bat, pit: null, played: true, v: valuesFrom({ bat: ex.bat }) });
    });
    source = 'entry';
    renderGrid();
    subPool = null;
    renderSubPicker();
    loadSubPool().then(renderSubPicker).catch(err => { console.warn('[stats] sub list', err); $('sseSubPick').innerHTML = '<option value="">Could not load other teams</option>'; });
    const sideIn = sel.isHome ? x.homeIn : x.awayIn;
    if (!rows.length) {
      notice('warning', `No roster found for ${esc(sel.teamName)} in ${esc(seasonLabel(seasonId))}. Add players below by name.`);
    } else if (editing || rows.some(r => r.isSub)) {
      const n = rows.filter(r => r.bat || r.pit).length;
      notice('warning', `${plural(n, 'player')} already ${n === 1 ? 'has' : 'have'} stats for this game. Saving updates them. Untick Played to remove a player's stats.`);
    } else if (sideIn) {
      notice('info', 'This side is marked as in, but no roster player has stats saved for it. Subs may have been entered under other names.');
    }
  } catch (err) {
    console.error('[stats] load failed', err);
    $('sseGrid').innerHTML = `<p class="sse-empty">Could not load the roster: ${esc(err.message || err)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function rowProblems(v) {
  const out = [];
  if (v.h > v.ab) out.push('more hits than at bats');
  if (v.d2 + v.d3 + v.hr > v.h) out.push('more extra-base hits than hits');
  return out;
}

function renderGrid() {
  if (!rows.length) {
    $('sseGrid').innerHTML = '<p class="sse-empty">No players yet. Add them below.</p>';
    return;
  }
  const head = ALL.map(([, l], i) => `<th class="is-num${i === BAT.length ? ' sse-split' : ''}" scope="col">${l}</th>`).join('');
  $('sseGrid').innerHTML = `<div class="aces-table-wrap"><table class="aces-table sse-grid">
    <thead><tr><th scope="col">Player</th><th scope="col" class="sse-played">Played</th>${head}</tr></thead>
    <tbody>${rows.map((p, i) => `<tr data-i="${i}" class="${p.played ? '' : 'is-out'}">
      <th scope="row"><span class="sse-name">${esc(p.name)}</span>${p.isSub ? `<span class="sse-saved sse-sub-tag" title="Sub from ${esc(p.homeTeam || 'another team')}">Sub${p.homeTeam ? `, ${esc(p.homeTeam)}` : ''}</span>` : ''}${p.bat || p.pit ? '<span class="sse-saved" title="Has stats saved for this game">Saved</span>' : ''}${p.added ? '<span class="sse-saved">Added</span>' : ''}</th>
      <td class="sse-played"><input type="checkbox" data-played ${p.played ? 'checked' : ''} aria-label="${esc(p.name)} played"></td>
      ${ALL.map(([k, l], j) => {
        const cls = `is-num${j === BAT.length ? ' sse-split' : ''}`;
        if (p.isSub && j >= BAT.length) return `<td class="${cls} sse-na" title="Sub pitching isn't collected here">-</td>`;
        return `<td class="${cls}"><input class="sse-in" type="number" min="0" step="${k === 'ip' ? '0.1' : '1'}" inputmode="${k === 'ip' ? 'decimal' : 'numeric'}"
        data-k="${k}" value="${p.v[k] || ''}" placeholder="0" aria-label="${esc(p.name)} ${l}"></td>`;
      }).join('')}
    </tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">Team</th><td></td>${ALL.map(([k], j) => `<td class="is-num${j === BAT.length ? ' sse-split' : ''}" data-total="${k}"></td>`).join('')}</tr></tfoot>
  </table></div>`;
  rows.forEach((p, i) => markRow(i));
  updateTotals();
}

function markRow(i) {
  const tr = $('sseGrid').querySelector(`tr[data-i="${i}"]`);
  if (!tr) return;
  const probs = rows[i].played ? rowProblems(rows[i].v) : [];
  tr.classList.toggle('is-bad', probs.length > 0);
  tr.classList.toggle('is-out', !rows[i].played);
  tr.title = probs.length ? `Check: ${probs.join(', ')}` : '';
}

function updateTotals() {
  ALL.forEach(([k]) => {
    const td = $('sseGrid').querySelector(`[data-total="${k}"]`);
    if (!td) return;
    const sum = rows.reduce((s, p) => s + (p.played ? Number(p.v[k]) || 0 : 0), 0);
    td.textContent = k === 'ip' ? String(Math.round(sum * 10) / 10) : String(sum);
  });
  const runs = rows.reduce((s, p) => s + (p.played ? Number(p.v.r) || 0 : 0), 0);
  const g = sel?.g;
  const teamScore = g?.hasScores ? (sel.isHome ? g.homeScore : g.awayScore) : null;
  const el = $('sseCheck');
  const entered = rows.some(p => p.played && ALL.some(([k]) => Number(p.v[k]) > 0));
  if (teamScore === null || teamScore === undefined || !rows.length || !entered) { el.textContent = ''; el.className = 'sse-check'; return; }
  el.innerHTML = Number(teamScore) === runs
    ? `${icon('check')} Runs add up to the final score (${runs}).`
    : `${icon('alert')} Runs total ${runs}, but ${esc(sel.teamName)} scored ${esc(teamScore)}.`;
  el.className = `sse-check ${Number(teamScore) === runs ? 'is-ok' : 'is-off'}`;
}

function onGridInput(e) {
  const tr = e.target.closest('tr[data-i]');
  if (!tr) return;
  const i = Number(tr.dataset.i);
  if (e.target.matches('[data-played]')) {
    rows[i].played = e.target.checked;
  } else if (e.target.matches('.sse-in')) {
    const k = e.target.dataset.k;
    rows[i].v[k] = k === 'ip' ? parseFloat(e.target.value) || 0 : parseInt(e.target.value, 10) || 0;
    if (!rows[i].played && e.target.value !== '' && e.target.value !== '0') {
      rows[i].played = true;
      tr.querySelector('[data-played]').checked = true;
    }
  } else return;
  markRow(i);
  updateTotals();
}

async function addPlayer() {
  const input = $('sseAddName');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name || !sel) return;
  const legacyId = toLegacyId(name);
  if (rows.some(r => r.legacyId === legacyId)) { showToast(`${name} is already in the grid`, 'info'); return; }
  if ((subPool || []).some(p => p.legacyId === legacyId)) {
    showToast(`${name} is on another team's roster. Add him as a sub instead.`, 'warning');
    return;
  }
  const ex = await loadExisting(legacyId);
  rows.push({ id: legacyId, legacyId, name, added: true, played: true, bat: ex.bat, pit: ex.pit, v: valuesFrom(ex) });
  input.value = '';
  renderGrid();
}

async function addSub() {
  const id = $('sseSubPick').value;
  const p = (subPool || []).find(x => x.legacyId === id);
  if (!p || !sel) return;
  if (rows.some(r => r.legacyId === id)) { showToast(`${p.name} is already in the grid`, 'info'); return; }
  const ex = await loadExisting(id);
  if (ex.bat && ex.bat.isSub !== true) {
    showToast(`${p.name} already has regular stats for this game, so he can't also be a sub.`, 'error');
    return;
  }
  rows.push({ id, legacyId: id, name: p.name, isSub: true, homeTeam: p.team, played: true, bat: ex.bat?.isSub ? ex.bat : null, pit: null, v: valuesFrom({ bat: ex.bat?.isSub ? ex.bat : null }) });
  renderGrid();
  renderSubPicker();
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

function common(p) {
  const r = sel.r;
  const isPlayoff = r.game_type === 'Playoff' || r.gameType === 'playoff' || r.gameType === 'Playoff';
  return {
    gameId: r.id, gameDocId: sel.gameDocId, playerId: p.legacyId, playerName: p.name,
    seasonId, teamId: sel.teamName,
    gameDate: r.date || null, gameDateFormatted: toDateKey(r.date) || 'Unknown',
    opponent: sel.opponent, isHome: sel.isHome,
    gameType: r.game_type || r.gameType || 'Regular', isPlayoff,
    submittedBy: user.uid, submittedByName: user.displayName || user.email,
    submittedAt: serverTimestamp(), lastModified: serverTimestamp(), dataVersion: 1,
    ...(source === 'pdf' ? { sourceType: 'pdf-import' } : {})
  };
}

const denied = (err) => err?.code === 'permission-denied' || /permission/i.test(err?.message || '');

async function save() {
  if (!sel || saving) return;
  const plan = [];          // { p, bat, pit, del }
  for (const p of rows) {
    const v = p.v;
    if (!p.played) {
      if (p.bat || p.pit) plan.push({ p, del: true });
      continue;
    }
    const hasBat = BAT.some(([k]) => v[k] > 0);
    const hasPit = !p.isSub && (v.ip > 0 || v.ra > 0);
    if (hasBat || hasPit || p.bat || p.pit) plan.push({ p, bat: hasBat || !!p.bat, pit: hasPit || (!p.isSub && !!p.pit) });
  }
  if (!plan.length) { notice('warning', 'Nothing to save yet. Enter stats for at least one player.'); return; }

  const bad = rows.filter(p => p.played && rowProblems(p.v).length);
  if (bad.length && !(await confirmModal(`These rows don't add up: ${bad.map(p => `${p.name} (${rowProblems(p.v).join(', ')})`).join('; ')}. Save anyway?`, { confirmLabel: 'Save anyway' }))) return;
  const dels = plan.filter(x => x.del);
  if (dels.length && !(await confirmModal(`Remove this game's stats for ${dels.map(x => x.p.name).join(', ')}? They are unticked from Played.`, { danger: true, confirmLabel: 'Remove and save' }))) return;

  saving = true;
  const btn = $('sseSave');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  let ok = 0, failed = 0, removed = 0;
  const blocked = [];

  await Promise.all(plan.map(async ({ p, bat, pit, del }) => {
    try {
      if (del) {
        if (p.bat) await deleteDoc(doc(db, 'playerStats', p.legacyId, 'games', sel.gameDocId));
        if (p.pit) await deleteDoc(doc(db, 'pitchingStats', p.legacyId, 'games', sel.gameDocId));
        removed++;
        return;
      }
      const base = common(p);
      if (bat) {
        const data = { ...base };
        BAT.forEach(([k, , f]) => { data[f] = Number(p.v[k]) || 0; });
        if (!p.bat) Object.assign(data, { strikeouts: 0, stolenBases: 0, caughtStealing: 0 });
        if (p.isSub) Object.assign(data, { isSub: true, homeTeam: p.homeTeam || null, ...(source === 'pdf' ? {} : { sourceType: 'manual-extended' }) });
        await setDoc(doc(db, 'playerStats', p.legacyId, 'games', sel.gameDocId), data, { merge: true });
      }
      if (pit) {
        const data = { ...base, inningsPitched: Number(p.v.ip) || 0, runsAllowed: Number(p.v.ra) || 0 };
        if (!p.pit) Object.assign(data, { earnedRuns: 0, strikeouts: 0, walks: 0, hits: 0, wins: 0, losses: 0, saves: 0 });
        await setDoc(doc(db, 'pitchingStats', p.legacyId, 'games', sel.gameDocId), data, { merge: true });
      }
      ok++;
    } catch (err) {
      console.error(`[stats] ${p.name} failed`, err);
      if (del && denied(err)) blocked.push(p.name);
      else failed++;
    }
  }));

  // Mark this side's stats as in and record its subs, so the pipeline and
  // admin home stop flagging it and the subs reload next time.
  let marked = false;
  if ((ok || removed) && !failed) {
    const subs = rows.filter(p => p.isSub && p.played && BAT.some(([k]) => p.v[k] > 0))
      .map(p => ({ legacyId: p.legacyId, name: p.name, homeTeam: p.homeTeam || null }));
    const subsKey = sel.isHome ? 'subsHome' : 'subsAway';
    const oldKey = sel.isHome ? 'subHome' : 'subAway';
    const update = {
      [sel.isHome ? 'statsSubmittedHome' : 'statsSubmittedAway']: true,
      statsSubmittedBy: user.uid,
      statsSubmittedByName: user.displayName || user.email,
      statsSubmittedAt: serverTimestamp(),
      statsSubmittedForTeam: sel.teamName,
      [subsKey]: subs
    };
    if (sel.r[oldKey] !== undefined) update[oldKey] = deleteField();
    try {
      await updateDoc(doc(db, 'seasons', seasonId, 'games', sel.r.id), update);
      marked = true;
      const x = items.find(i => i.r.id === sel.r.id);
      if (x) {
        x[sel.isHome ? 'homeIn' : 'awayIn'] = true;
        x.r[subsKey] = subs;
        delete x.r[oldKey];
      }
    } catch (err) {
      console.warn('[stats] could not mark the game', err);
    }
  }

  saving = false;
  btn.disabled = false;
  btn.textContent = 'Save stats';

  if (failed) {
    notice('error', `Saved ${plural(ok, 'player')}, but ${failed} failed. Check your connection, then save again.`);
    return;
  }
  showToast(`Saved stats for ${plural(ok, 'player')}`, 'success');
  const keep = { game: sel.r.id, side: sel.side };
  await selectSide(keep.game, keep.side, { scroll: false });
  const after = opts.pipelineHref
    ? ` Run the aggregation from the <a href="${esc(opts.pipelineHref)}?season=${encodeURIComponent(seasonId)}">stats pipeline</a> when the week's games are in.`
    : ' League staff fold them into the season totals when they next update stats.';
  const block = blocked.length ? ` Removing ${esc(blocked.join(', '))} needs league staff; ask them to untick and save.` : '';
  notice(blocked.length ? 'warning' : 'success', `Saved ${plural(ok, 'player')}${removed ? `, removed ${plural(removed, 'player')}` : ''}.${marked ? ` ${esc(sel.teamName)}'s stats are marked as in.` : ''}${block}${after}`);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function setPane(which) {
  document.querySelectorAll('[data-pane]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === which)));
  $('ssePaneType').hidden = which !== 'type';
  $('ssePanePdf').hidden = which !== 'pdf';
}

function clearPdf() {
  pdfRows = [];
  $('ssePdfFile').value = '';
  $('ssePdfStatus').hidden = true;
  $('ssePdfReview').innerHTML = '';
  $('ssePdfFill').hidden = true;
}

async function readPdf(file) {
  if (!sel || !file) return;
  const status = $('ssePdfStatus');
  status.hidden = false;
  status.className = 'aces-notice';
  status.innerHTML = `${icon('clock')}<div>Reading the PDF...</div>`;
  $('ssePdfReview').innerHTML = '';
  $('ssePdfFill').hidden = true;
  try {
    const { rows: parsed, gameChanger } = await parsePdf(file, rows);
    if (!parsed.length) {
      status.className = 'aces-notice is-warning';
      status.innerHTML = `${icon('alert')}<div>No player lines were found in this PDF. Type the stats in instead.</div>`;
      return;
    }
    pdfRows = parsed.map(p => ({ ...p, use: true, legacyId: p.matchedPlayer?.legacyId || '' }));
    const good = parsed.filter(p => p.matchScore >= 0.75).length;
    const none = parsed.filter(p => p.matchScore < 0.45).length;
    status.className = 'aces-notice is-success';
    status.innerHTML = `${icon('check-circle')}<div>Found ${plural(parsed.length, 'player')}${gameChanger ? ' (GameChanger box score)' : ''}: ${good} matched, ${parsed.length - good - none} to check, ${none} not matched. Fix any names below, then fill the grid. Add subs to the grid first so they can be matched.</div>`;
    renderPdf();
  } catch (err) {
    console.error('[stats] pdf failed', err);
    status.className = 'aces-notice is-error';
    status.innerHTML = `${icon('x-circle')}<div>Could not read the PDF: ${esc(err.message || err)}</div>`;
  }
}

function renderPdf() {
  const opts_ = (id) => `<option value="">Not on roster</option>${rows.map(p => `<option value="${esc(p.legacyId)}"${p.legacyId === id ? ' selected' : ''}>${esc(p.name)}${p.isSub ? ' (sub)' : ''}</option>`).join('')}`;
  const line = (p) => ['ab', 'h', '2b', '3b', 'hr', 'r', 'rbi', 'bb', 'ip', 'ra']
    .filter(k => p[k]).map(k => `${p[k]} ${k.toUpperCase()}`).join(', ') || 'No stats';
  $('ssePdfReview').innerHTML = `<div class="aces-table-wrap"><table class="aces-table sse-pdf">
    <thead><tr><th scope="col">Use</th><th scope="col">On the PDF</th><th scope="col">Roster player</th><th scope="col">Match</th><th scope="col">Line</th></tr></thead>
    <tbody>${pdfRows.map((p, i) => {
      const m = p.matchScore >= 0.75 ? '<span class="aces-badge is-win">Good</span>' : p.matchScore >= 0.45 ? '<span class="aces-badge is-alert">Check</span>' : '<span class="aces-badge is-loss">None</span>';
      return `<tr data-p="${i}">
        <td><input type="checkbox" data-use ${p.use ? 'checked' : ''} aria-label="Use ${esc(p.pdfName)}"></td>
        <td>${esc(p.pdfName)}</td>
        <td><span class="aces-select-wrap"><select class="aces-select" data-who aria-label="Roster player for ${esc(p.pdfName)}">${opts_(p.legacyId)}</select></span></td>
        <td>${m}</td>
        <td class="sse-line">${esc(line(p))}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  $('ssePdfFill').hidden = false;
}

function fillFromPdf() {
  const used = pdfRows.filter(p => p.use && p.legacyId);
  const dupes = used.map(p => p.legacyId).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length) {
    showToast('Two PDF lines point at the same roster player. Fix that first.', 'error');
    return;
  }
  rows.forEach(r => { r.played = false; ALL.forEach(([k]) => { r.v[k] = 0; }); });
  for (const p of used) {
    const r = rows.find(x => x.legacyId === p.legacyId);
    if (!r) continue;
    r.played = true;
    ALL.forEach(([k]) => { if (!(r.isSub && PIT.some(([pk]) => pk === k))) r.v[k] = Number(p[PDF_KEY[k]]) || 0; });
  }
  source = 'pdf';
  renderGrid();
  setPane('type');
  const skipped = pdfRows.length - used.length;
  notice('info', `Filled ${plural(used.length, 'player')} from the PDF${skipped ? ` (${skipped} skipped)` : ''}. Players not on the PDF are unticked. Check the grid, then save.`);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function bind() {
  document.querySelectorAll('[data-games]').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.games;
    document.querySelectorAll('[data-games]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderGames();
  }));
  $('sseGames').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-side]');
    if (b) selectSide(b.dataset.game, b.dataset.side);
  });
  $('sseGrid').addEventListener('input', onGridInput);
  $('sseGrid').addEventListener('change', onGridInput);
  $('sseGrid').addEventListener('focusin', (e) => { if (e.target.matches('.sse-in')) e.target.select(); });
  $('sseSave').addEventListener('click', save);
  $('sseReset').addEventListener('click', () => sel && selectSide(sel.r.id, sel.side, { scroll: false }));
  $('sseClose').addEventListener('click', () => {
    sel = null;
    $('sseEntry').hidden = true;
    history.replaceState(null, '', `?season=${encodeURIComponent(seasonId)}`);
    renderGames();
  });
  $('sseAdd').addEventListener('submit', (e) => { e.preventDefault(); addPlayer(); });
  $('sseSubAdd').addEventListener('click', addSub);
  document.querySelectorAll('[data-pane]').forEach(b => b.addEventListener('click', () => setPane(b.dataset.pane)));
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $('sseModeOne').hidden = b.dataset.mode !== 'one';
    $('sseModeCsv').hidden = b.dataset.mode !== 'csv';
  }));

  $('ssePdfFile').addEventListener('change', (e) => readPdf(e.target.files?.[0]));
  const drop = $('ssePdfDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const f = e.dataTransfer.files[0];
    if (f && f.name.toLowerCase().endsWith('.pdf')) readPdf(f);
    else showToast('Drop a PDF file', 'error');
  });
  $('ssePdfReview').addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-p]');
    if (!tr) return;
    const p = pdfRows[Number(tr.dataset.p)];
    if (e.target.matches('[data-use]')) p.use = e.target.checked;
    if (e.target.matches('[data-who]')) p.legacyId = e.target.value;
  });
  $('ssePdfFill').addEventListener('click', fillFromPdf);

  window.addEventListener('beforeunload', (e) => { if (saving) { e.preventDefault(); e.returnValue = ''; } });
}

/**
 * Start the page once the caller has checked access.
 * @param {object} ctx  initPage's result
 * @param {{ scope?: string[]|null, pipelineHref?: string }} options
 *   scope: lowercase team ids the user may enter (null = every team)
 */
export async function startStatsEntry(ctx, options = {}) {
  user = ctx.user;
  opts = { scope: options.scope || null, pipelineHref: options.pipelineHref || '' };

  const [seasons, teamSnap] = await Promise.all([getAllSeasons(), getDocs(collection(db, 'teams'))]);
  teams = teamSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  seasons.sort((a, b) => seasonSortKey(b.id) - seasonSortKey(a.id));

  const params = new URLSearchParams(location.search);
  const start = [params.get('season'), ctx.config?.currentSeasonId, ctx.config?.previousSeasonId, seasons[0]?.id]
    .find(id => id && seasons.some(s => s.id === id));
  const seasonSel = $('sseSeason');
  seasonSel.innerHTML = seasons.map(s => `<option value="${esc(s.id)}">${esc(seasonLabel(s.id))}</option>`).join('');
  if (start) seasonSel.value = start;
  seasonSel.addEventListener('change', async () => {
    sel = null;
    $('sseEntry').hidden = true;
    history.replaceState(null, '', `?season=${encodeURIComponent(seasonSel.value)}`);
    await loadSeason(seasonSel.value);
  });

  bind();
  const csvTeams = opts.scope ? teams.filter(t => inScope(t.id, t.name)) : teams;
  mountCsv({ user, teams: csvTeams, seasonId: () => seasonId });
  if (csvTeams.length === 1) $('csvTeam').value = csvTeams[0].id;
  pageReady();

  if (!start) { $('sseGames').innerHTML = '<p class="sse-empty">No seasons found.</p>'; return; }
  await loadSeason(start);
  const game = params.get('game');
  const side = params.get('side');
  const x = items.find(i => i.r.id === game);
  if (x && (side === 'home' || side === 'away') && mine(x, side)) {
    // Show the linked game in the list even when it no longer needs stats.
    if (!needsStats(x)) {
      filter = 'all';
      document.querySelectorAll('[data-games]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.games === 'all')));
    }
    await selectSide(game, side);
  }
}
