// js/admin/historical-import.js
// admin/historical-import.html: a team's old game-by-game batting lines
// (AB, H, R, BB) from a CSV, for seasons before full game tracking (first
// use: Purple 2024 and 2025). League staff and admins can load any team;
// captains and team staff only the teams they hold an active role on
// (firestore.rules checks the same thing). They show only on the player page's Splits tab
// (js/pages/player-splits.js). Season totals, aggregation, badges and leaders
// never read this collection, so nothing stored is overwritten.
//
//   historicalGameStats/{team}_{statId}_{seasonId}_{YYYY-MM-DD}_g{n}
//     { playerId (stats ID), playerName, team, teamLabel ('Purple', for the rules), seasonId, gameDate: 'YYYY-MM-DD',
//       opponent, isHome, isPlayoff, gameNum, games: 1, atBats, hits, runs, walks,
//       source: 'historical-import', importBatch, importedBy, importedAt }
//
// Saving replaces everything already loaded for that team in the file's
// seasons, so a fixed file can simply be loaded again.

import { initPage, pageReady } from '../core/app.js';
import { db, collection, doc, getDocs, query, where, writeBatch, serverTimestamp } from '../core/firebase.js';
import { escapeHtml as esc } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { teamDot } from '../ui/game-shared.js';
import { TEAM_COLORS } from '../ui/stat-columns.js';
import { toDateKey } from '../domain/dates.js';
import { parseStatSeasonId, seasonLabel, seasonSortKey } from '../domain/season-ids.js';
import { toStatId, statIdOf } from '../domain/player-id.js';
import { hasLeagueRole } from '../core/auth.js';
import { mountAdminShell } from './shell.js';

const $ = (id) => document.getElementById(id);
const COL = 'historicalGameStats';
const BATCH = 400;
const TEMPLATE = 'Date,Opponent,HomeAway,GameType,Player,AB,H,R,BB\n2024-06-04,Gold,H,Regular,Joe Smith,3,2,1,1\n2024-06-04,Gold,H,Regular,Mike Jones,4,1,0,0\n';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** Teams this person may load: every team for league staff, else active captain / team-staff roles. */
function allowedTeams(profile) {
  if (hasLeagueRole(profile) || profile?.isLeagueStaff === true) return [...TEAM_COLORS].sort();
  const out = new Set();
  Object.entries(profile?.teamRoles || {}).forEach(([t, tr]) => {
    if (tr?.status === 'active' && (tr.role === 'captain' || tr.role === 'team-staff')) out.add(t.toLowerCase());
  });
  if (profile?.isCaptain === true && profile.linkedTeam) out.add(String(profile.linkedTeam).toLowerCase());
  return [...out].sort();
}

// Header aliases: the file's column name (letters and digits only) -> field.
const ALIASES = {
  date: ['date', 'gamedate', 'day'],
  opponent: ['opponent', 'opp', 'vs', 'versus'],
  homeAway: ['homeaway', 'ha', 'home', 'ishome', 'location', 'site'],
  gameType: ['gametype', 'type', 'playoff', 'playoffs'],
  player: ['player', 'name', 'playername', 'batter'],
  ab: ['ab', 'atbats', 'atbat'],
  h: ['h', 'hits', 'hit'],
  r: ['r', 'runs', 'run'],
  bb: ['bb', 'walks', 'walk', 'bbs'],
  season: ['season'],
  gameNum: ['gamenum', 'gamenumber', 'game', 'gameno']
};

let user = null;
let players = new Map();   // statId -> { statId, name, teams: { seasonId: team }, totals: { seasonId: line } }
let rows = [];             // parsed file rows
let match = new Map();     // file name -> statId ('' when not matched)

const team = () => $('hiTeam').value;
const blank = () => ({ games: 0, atBats: 0, hits: 0, runs: 0, walks: 0 });
function addLine(into, s) {
  into.games += Number(s.games) || 0;
  into.atBats += Number(s.atBats) || 0;
  into.hits += Number(s.hits) || 0;
  into.runs += Number(s.runs) || 0;
  into.walks += Number(s.walks) || 0;
  return into;
}
const lineText = (s) => `${s.games} G, ${s.hits}-${s.atBats}, ${s.runs} R, ${s.walks} BB`;
const sameLine = (a, b) => ['games', 'atBats', 'hits', 'runs', 'walks'].every(k => a[k] === b[k]);

function setStatus(type, html) {
  const el = $('hiStatus');
  if (!html) { el.hidden = true; el.innerHTML = ''; return; }
  const ic = type === 'success' ? 'check-circle' : type === 'error' ? 'x-circle' : type === 'warning' ? 'alert' : 'info';
  el.className = `aces-notice is-${type}`;
  el.innerHTML = `${icon(ic)}<div>${html}</div>`;
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

async function loadPlayers() {
  const snap = await getDocs(collection(db, 'aggregatedPlayerStats'));
  players = new Map();
  snap.forEach(d => {
    const p = d.data();
    if (p.migrated === true || !p.name) return;
    const statId = statIdOf({ id: d.id, ...p });
    if (!statId) return;
    const e = players.get(statId) || { statId, name: p.name, teams: {}, totals: {} };
    Object.entries(p.seasons || {}).forEach(([key, s]) => {
      const sid = parseStatSeasonId(key).id;
      if (!sid || !s) return;
      if (s.team) e.teams[sid] = String(s.team).toLowerCase();
      addLine(e.totals[sid] ||= blank(), s);
    });
    players.set(statId, e);
  });
}

/** Best guess for a name in the file: same stats ID, else same last name on the team that season. */
function guess(name, seasons) {
  const id = toStatId(name);
  if (players.has(id)) return id;
  const byName = [...players.values()].find(p => toStatId(p.name) === id);
  if (byName) return byName.statId;
  const parts = id.split('_');
  const last = parts[parts.length - 1];
  const first = parts[0] || '';
  const onTeam = [...players.values()].filter(p => seasons.some(s => p.teams[s] === team()));
  const sameLast = onTeam.filter(p => toStatId(p.name).split('_').pop() === last);
  if (sameLast.length === 1) return sameLast[0].statId;
  const sameInitial = sameLast.filter(p => toStatId(p.name).startsWith(first.charAt(0)));
  return sameInitial.length === 1 ? sameInitial[0].statId : '';
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const out = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c.trim())) out.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c.trim())) out.push(row);
  return out;
}

function normalizeTeam(raw) {
  const s = String(raw || '').toLowerCase().replace(/\baces\b/g, '').replace(/[^a-z ]/g, '').trim();
  if (!s) return '';
  if (TEAM_COLORS.has(s)) return s;
  return [...TEAM_COLORS].find(t => s.split(/\s+/).includes(t)) || s.replace(/\s+/g, '_');
}

function seasonFor(dateKey, raw) {
  const year = dateKey.slice(0, 4);
  const v = String(raw || '').toLowerCase().trim();
  if (/^\d{4}-(summer|fall|spring)$/.test(v)) return v;
  if (/^(summer|fall|spring)$/.test(v)) return `${year}-${v}`;
  return `${year}-${Number(dateKey.slice(5, 7)) >= 9 ? 'fall' : 'summer'}`;
}

function toRows(text) {
  const table = parseCsv(text.replace(/^﻿/, ''));
  if (table.length < 2) throw new Error('The file needs a header row and at least one player row.');
  const header = table[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = {};
  Object.entries(ALIASES).forEach(([field, names]) => {
    const i = header.findIndex(h => names.includes(h));
    if (i >= 0) col[field] = i;
  });
  const need = ['date', 'opponent', 'homeAway', 'player', 'ab', 'h', 'r', 'bb'].filter(f => col[f] === undefined);
  if (need.length) throw new Error(`Missing columns: ${need.join(', ')}. Download the template to see the layout.`);

  const own = team();
  const seen = new Map();   // player|date -> count, to number doubleheaders
  const keys = new Set();
  return table.slice(1).map((cells, i) => {
    const get = (f) => (col[f] === undefined ? '' : String(cells[col[f]] ?? '').trim());
    const errors = [], warnings = [];
    const player = get('player').replace(/\s+/g, ' ');
    const dateKey = toDateKey(get('date'));
    if (!player) errors.push('No player');
    if (!dateKey) errors.push(`Date "${get('date')}" not understood`);
    const opponent = normalizeTeam(get('opponent'));
    if (!opponent) errors.push('No opponent');
    else if (opponent === own) errors.push('Opponent is the same team');
    else if (!TEAM_COLORS.has(opponent)) warnings.push(`"${get('opponent')}" is not a known team`);
    const ha = get('homeAway').toLowerCase();
    const isHome = /^(h|home|y|yes|true|1)$/.test(ha) ? true : /^(a|away|n|no|false|0|@|road)$/.test(ha) ? false : null;
    if (isHome === null) errors.push('HomeAway must be H or A');
    const isPlayoff = /^(p|playoff|playoffs|post|postseason|y|yes|true|1)$/i.test(get('gameType'));
    const num = (f) => {
      const v = get(f);
      if (v === '') return 0;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) { errors.push(`${f.toUpperCase()} "${v}" is not a whole number`); return 0; }
      return n;
    };
    const line = { games: 1, atBats: num('ab'), hits: num('h'), runs: num('r'), walks: num('bb') };
    if (line.hits > line.atBats) warnings.push('More hits than at bats');
    if (!line.atBats && !line.walks) warnings.push('No AB or BB');
    const seasonId = dateKey ? seasonFor(dateKey, get('season')) : '';
    const pk = `${player.toLowerCase()}|${dateKey}`;
    seen.set(pk, (seen.get(pk) || 0) + 1);
    const gameNum = parseInt(get('gameNum'), 10) || seen.get(pk);
    const key = `${player.toLowerCase()}|${seasonId}|${dateKey}|${gameNum}`;
    if (keys.has(key)) errors.push('Same player and game twice');
    keys.add(key);
    return { line: i + 2, player, dateKey, seasonId, opponent, isHome, isPlayoff, gameNum, ...line, errors, warnings };
  });
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

function playerOptions(selected, seasons) {
  const all = [...players.values()].sort((a, b) => a.name.localeCompare(b.name));
  const onTeam = all.filter(p => seasons.some(s => p.teams[s] === team()));
  const others = all.filter(p => !onTeam.includes(p));
  const opt = (p) => `<option value="${esc(p.statId)}"${p.statId === selected ? ' selected' : ''}>${esc(p.name)}</option>`;
  return `<option value="">Not matched</option>
    ${onTeam.length ? `<optgroup label="${esc(cap(team()))} in these seasons">${onTeam.map(opt).join('')}</optgroup>` : ''}
    <optgroup label="Everyone">${others.map(opt).join('')}</optgroup>`;
}

function renderPlayers() {
  const names = [...new Set(rows.map(r => r.player).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const seasons = [...new Set(rows.map(r => r.seasonId).filter(Boolean))];
  $('hiPlayers').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact">
    <thead><tr><th scope="col">In the file</th><th scope="col">Player record</th><th scope="col">File vs stored season totals</th></tr></thead>
    <tbody>${names.map(name => {
      const id = match.get(name) || '';
      const p = players.get(id);
      const bySeason = {};
      rows.filter(r => r.player === name && !r.errors.length).forEach(r => addLine(bySeason[r.seasonId] ||= blank(), r));
      const cmp = Object.keys(bySeason).sort((a, b) => seasonSortKey(a) - seasonSortKey(b)).map(sid => {
        const f = bySeason[sid], s = p?.totals[sid];
        const badge = !p ? '' : !s ? '<span class="aces-badge is-alert">No stored totals</span>'
          : sameLine(f, s) ? '<span class="aces-badge is-win">Matches</span>' : '<span class="aces-badge is-alert">Differs</span>';
        return `<div><strong>${esc(seasonLabel(sid))}</strong> file ${esc(lineText(f))}${s ? `<br><span class="sse-dim">stored ${esc(lineText(s))}</span>` : ''} ${badge}</div>`;
      }).join('');
      return `<tr><th scope="row">${esc(name)}</th>
        <td><span class="aces-select-wrap"><select class="aces-select is-sm" data-match="${esc(name)}" aria-label="Player record for ${esc(name)}">${playerOptions(id, seasons)}</select></span>
          ${id ? '' : ' <span class="aces-badge is-loss">Not matched</span>'}</td>
        <td>${cmp}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  $('hiPlayersCard').hidden = false;
}

function renderGames() {
  const bad = rows.filter(r => r.errors.length);
  const unmatched = [...match.values()].filter(v => !v).length;
  const games = new Map();
  rows.filter(r => !r.errors.length).forEach(r => {
    const k = `${r.seasonId}|${r.dateKey}|${r.opponent}|${r.gameNum}`;
    const g = games.get(k) || { ...r, players: 0, line: blank() };
    g.players++;
    addLine(g.line, r);
    games.set(k, g);
  });
  const list = [...games.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.gameNum - b.gameNum);
  const seasons = [...new Set(list.map(g => g.seasonId))].sort((a, b) => seasonSortKey(a) - seasonSortKey(b));
  const warned = rows.filter(r => !r.errors.length && r.warnings.length);

  $('hiSummary').innerHTML = [
    ['Lines', rows.length], ['Games', list.length], ['Players', match.size],
    ['Seasons', seasons.map(seasonLabel).join(', ') || '-'], ['Errors', bad.length]
  ].map(([l, v]) => `<div class="aces-stat"><span class="aces-stat-value">${esc(v)}</span><span class="aces-stat-label">${l}</span></div>`).join('');

  const problems = [
    ...bad.map(r => `<li><strong>Line ${r.line}</strong> ${esc(r.player || '')}: ${esc(r.errors.join('; '))}</li>`),
    ...warned.map(r => `<li class="sse-dim">Line ${r.line} ${esc(r.player)}: ${esc(r.warnings.join('; '))}</li>`)
  ];
  $('hiGames').innerHTML = `${problems.length ? `<details${bad.length ? ' open' : ''}><summary>${bad.length} errors, ${warned.length} to check</summary><ul>${problems.join('')}</ul></details>` : ''}
    <div class="aces-table-wrap"><table class="aces-table is-compact">
      <thead><tr><th scope="col">Date</th><th scope="col">Season</th><th scope="col">Opponent</th><th scope="col">H/A</th><th scope="col">Type</th>
        <th scope="col" class="is-num">Players</th><th scope="col" class="is-num">AB</th><th scope="col" class="is-num">H</th><th scope="col" class="is-num">R</th><th scope="col" class="is-num">BB</th></tr></thead>
      <tbody>${list.map(g => `<tr><td>${esc(g.dateKey)}${g.gameNum > 1 ? ` (G${g.gameNum})` : ''}</td><td>${esc(seasonLabel(g.seasonId))}</td>
        <td>${teamDot(g.opponent)}${esc(cap(g.opponent))}</td><td>${g.isHome ? 'Home' : 'Away'}</td><td>${g.isPlayoff ? 'Playoff' : 'Regular'}</td>
        <td class="is-num">${g.players}</td><td class="is-num">${g.line.atBats}</td><td class="is-num">${g.line.hits}</td><td class="is-num">${g.line.runs}</td><td class="is-num">${g.line.walks}</td></tr>`).join('')}</tbody>
    </table></div>`;

  const save = $('hiSave');
  save.disabled = !!bad.length || !!unmatched || !list.length;
  save.textContent = bad.length ? `Fix ${bad.length} errors first` : unmatched ? `Match ${unmatched} players first` : `Save ${rows.length} lines`;
  $('hiGamesCard').hidden = false;
}

function review() {
  renderPlayers();
  renderGames();
}

async function readFile(file) {
  if (!file) return;
  try {
    rows = toRows(await file.text());
  } catch (err) {
    rows = [];
    clearReview();
    setStatus('error', esc(err.message || err));
    return;
  }
  match = new Map();
  const names = [...new Set(rows.map(r => r.player).filter(Boolean))];
  names.forEach(n => match.set(n, guess(n, [...new Set(rows.filter(r => r.player === n).map(r => r.seasonId))])));
  const found = [...match.values()].filter(Boolean).length;
  setStatus('info', `Read ${rows.length} lines for ${names.length} players. Matched ${found} of ${names.length} to player records.`);
  review();
}

function clearReview() {
  rows = []; match = new Map();
  $('hiPlayersCard').hidden = true;
  $('hiGamesCard').hidden = true;
  $('hiFile').value = '';
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

async function loadedDocs() {
  const snap = await getDocs(query(collection(db, COL), where('team', '==', team())));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function removeIds(ids) {
  for (let i = 0; i < ids.length; i += BATCH) {
    const b = writeBatch(db);
    ids.slice(i, i + BATCH).forEach(id => b.delete(doc(db, COL, id)));
    await b.commit();
  }
}

async function save() {
  const t = team();
  const seasons = [...new Set(rows.map(r => r.seasonId))];
  const existing = (await loadedDocs()).filter(d => seasons.includes(d.seasonId));
  const msg = `Save ${rows.length} lines for ${cap(t)} (${seasons.map(seasonLabel).join(', ')})?`
    + (existing.length ? ` This replaces the ${existing.length} lines already loaded for those seasons.` : '');
  if (!(await confirmModal(msg, { confirmLabel: 'Save' }))) return;

  const btn = $('hiSave');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    await removeIds(existing.map(d => d.id));
    const importBatch = `${t}-${Date.now()}`;
    const docs = rows.map(r => {
      const statId = match.get(r.player);
      return [`${t}_${statId}_${r.seasonId}_${r.dateKey}_g${r.gameNum}`, {
        playerId: statId, playerName: players.get(statId)?.name || r.player, team: t, teamLabel: cap(t),
        seasonId: r.seasonId, gameDate: r.dateKey, opponent: r.opponent, isHome: r.isHome, isPlayoff: r.isPlayoff,
        gameNum: r.gameNum, games: 1, atBats: r.atBats, hits: r.hits, runs: r.runs, walks: r.walks,
        source: 'historical-import', importBatch, importedBy: user?.email || user?.uid || '', importedAt: serverTimestamp()
      }];
    });
    for (let i = 0; i < docs.length; i += BATCH) {
      const b = writeBatch(db);
      docs.slice(i, i + BATCH).forEach(([id, data]) => b.set(doc(db, COL, id), data));
      await b.commit();
    }
    showToast(`Saved ${docs.length} lines`, 'success');
    setStatus('success', `Saved ${docs.length} lines for ${esc(cap(t))}. They show on each player's Splits tab now.`);
    clearReview();
    await renderLoaded();
  } catch (err) {
    console.error('[historical-import] save failed', err);
    showToast(`Could not save: ${err.message || err}`, 'error');
    renderGames();
  }
}

async function renderLoaded() {
  const el = $('hiLoaded');
  el.innerHTML = '<p class="sse-dim">Loading...</p>';
  let docs;
  try { docs = await loadedDocs(); } catch (err) {
    el.innerHTML = `<p class="aces-empty">Could not load: ${esc(err.message || err)}</p>`;
    return;
  }
  const by = {};
  docs.forEach(d => {
    const e = by[d.seasonId] ||= { lines: 0, games: new Set(), players: new Set(), at: 0, who: '' };
    e.lines++;
    e.games.add(`${d.gameDate}|${d.opponent}|${d.gameNum}`);
    e.players.add(d.playerId);
    const ms = d.importedAt?.toMillis?.() || 0;
    if (ms > e.at) { e.at = ms; e.who = d.importedBy || ''; }
  });
  const sids = Object.keys(by).sort((a, b) => seasonSortKey(b) - seasonSortKey(a));
  el.innerHTML = sids.length ? `<div class="aces-table-wrap"><table class="aces-table is-compact">
    <thead><tr><th scope="col">Season</th><th scope="col" class="is-num">Games</th><th scope="col" class="is-num">Players</th><th scope="col" class="is-num">Lines</th><th scope="col">Loaded</th><th scope="col"><span class="u-sr-only">Remove</span></th></tr></thead>
    <tbody>${sids.map(s => `<tr><td>${teamDot(team())}${esc(seasonLabel(s))}</td><td class="is-num">${by[s].games.size}</td><td class="is-num">${by[s].players.size}</td><td class="is-num">${by[s].lines}</td>
      <td>${by[s].at ? esc(new Date(by[s].at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) : '-'}${by[s].who ? ` <span class="sse-dim">${esc(by[s].who)}</span>` : ''}</td>
      <td class="rc-row-actions"><button class="aces-btn is-sm is-ghost" type="button" data-remove="${esc(s)}">Remove</button></td></tr>`).join('')}</tbody>
  </table></div>` : `<p class="aces-empty">Nothing loaded for ${esc(cap(team()))} yet.</p>`;
  el._docs = docs;
}

// ---------------------------------------------------------------------------

async function main() {
  const ctx = await initPage({ title: 'Historical game import', role: 'team-staff', deniedMessage: 'This tool is for captains, team staff and league staff.' });
  if (!ctx?.user) return;
  user = ctx.user;
  mountAdminShell(ctx.profile, 'admin/historical-import.html');

  const teams = allowedTeams(ctx.profile);
  if (!teams.length) {
    pageReady();
    setStatus('warning', 'You are not a captain or team staff of any team, so there is no team to load for. Ask league staff to add your team role.');
    $('hiFile').disabled = true;
    $('hiTemplate').disabled = true;
    $('hiLoaded').innerHTML = '';
    return;
  }
  $('hiTeam').innerHTML = teams.map(t => `<option value="${t}"${t === 'purple' ? ' selected' : ''}>${esc(cap(t))}</option>`).join('');
  $('hiTeam').disabled = teams.length === 1;
  $('hiTeam').addEventListener('change', () => { if (rows.length) review(); renderLoaded(); });
  $('hiFile').addEventListener('change', (e) => readFile(e.target.files[0]));
  $('hiTemplate').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: 'historical-games-template.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('hiPlayers').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-match]');
    if (!sel) return;
    match.set(sel.dataset.match, sel.value);
    review();
  });
  $('hiSave').addEventListener('click', save);
  $('hiClear').addEventListener('click', () => { clearReview(); setStatus(); });
  $('hiLoaded').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const sid = b.dataset.remove;
    const ids = ($('hiLoaded')._docs || []).filter(d => d.seasonId === sid).map(d => d.id);
    if (!(await confirmModal(`Remove all ${ids.length} loaded lines for ${cap(team())} ${seasonLabel(sid)}?`, { confirmLabel: 'Remove', danger: true }))) return;
    try { await removeIds(ids); showToast('Removed', 'success'); await renderLoaded(); }
    catch (err) { showToast(`Could not remove: ${err.message || err}`, 'error'); }
  });

  pageReady();
  setStatus('info', 'Loading player records...');
  try {
    await loadPlayers();
    setStatus();
  } catch (err) {
    setStatus('error', `Could not load player records: ${esc(err.message || err)}`);
  }
  await renderLoaded();
}

main();
