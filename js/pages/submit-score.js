// js/pages/submit-score.js
// submit-score.html: final scores. Captains and team staff see their team's
// games; league staff and admins see every game.
//
//   Needs a score   games that have started and have no score yet
//   All games       every game, so a wrong score can be fixed (it shows the
//                   score that's there and says it will be replaced)
//
// Save writes to seasons/{season}/games/{id}: homeScore, awayScore, winner
// (the winning team's id, or 'tie'), status 'completed', forfeit,
// lastScoreUpdate, scoreSubmittedBy / scoreSubmittedByEmail, and optionally
// lineScore { home: [], away: [], innings } and gameNotes. Turning the line
// score off, or clearing the notes, on a game that had them removes them.
// ?season=&game= opens a game.

import { initPage, pageReady } from '../core/app.js';
import { db, doc, updateDoc, deleteField, Timestamp } from '../core/firebase.js';
import { getSeasonGames } from '../data/games.js';
import { getAllSeasons } from '../data/seasons.js';
import { normalizeGame } from '../domain/standings.js';
import { parseGameDateTime, formatGameDate, formatTime } from '../domain/dates.js';
import { seasonLabel, seasonSortKey } from '../domain/season-ids.js';
import { escapeHtml as esc } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { teamDot } from '../ui/game-shared.js';
import { submitScope, scopeLabel } from './submit-access.js';

const $ = (id) => document.getElementById(id);
const MIN_INN = 1, MAX_INN = 15, DEFAULT_INN = 7;

let ctx = null;
let scope = null;          // lowercase team ids, or null for every team
let seasonId = '';
let items = [];            // [{ r, g, start }]
let filter = 'need';
let sel = null;            // the picked item
let line = null;           // { away: [], home: [] } while the line score is on
let saving = false;

const lower = (s) => String(s || '').toLowerCase();
const mineKeys = (r, g) => [r.homeTeamId, g.home, r.awayTeamId, g.away].map(lower);
const isMine = (x) => !scope || mineKeys(x.r, x.g).some(k => k && scope.includes(k));
const started = (x) => !x.start || x.start <= Date.now();
const off = (x) => ['postponed', 'cancelled', 'canceled'].includes(lower(x.r.status));
const needsScore = (x) => !x.g.hasScores && !x.g.winner && started(x) && !off(x);

// ------------------------------------------------------------------ games

async function loadSeason(id) {
  seasonId = id;
  $('ssGames').innerHTML = '<p class="sse-dim">Loading games...</p>';
  const raw = await getSeasonGames(id);
  items = raw.filter(r => r.placeholder !== true && !String(r.id).startsWith('team_'))
    .map(r => ({ r, g: normalizeGame(r), start: parseGameDateTime(r.date, r.time)?.getTime() || 0 }))
    .filter(isMine);
  renderGames();
}

function renderGames() {
  const need = items.filter(needsScore).sort((a, b) => a.start - b.start);
  const list = filter === 'need' ? need : [...items].sort((a, b) => b.start - a.start);
  $('ssCount').textContent = filter === 'need' ? `${need.length} need a score` : `${items.length} games`;
  if (!list.length) {
    $('ssGames').innerHTML = `<p class="sse-empty">${filter === 'need' ? 'Every game that has started has a score. Switch to All games to fix one.' : 'No games in this season yet.'}</p>`;
    return;
  }
  $('ssGames').innerHTML = `<ul class="ss-games">${list.map(x => {
    const { g, r } = x;
    const status = off(x) ? `<span class="aces-badge is-outline">${esc(r.status)}</span>`
      : g.hasScores ? `<span class="ss-final">${esc(g.awayScore)}-${esc(g.homeScore)}</span>${r.forfeit ? ' <span class="aces-badge is-loss">Forfeit</span>' : ''}`
      : started(x) ? '<span class="aces-badge is-alert">Needs a score</span>' : '<span class="sse-dim">Upcoming</span>';
    const kind = g.type === 'playoff' ? ` <span class="aces-badge is-brand">${esc(g.round || 'Playoff')}</span>` : '';
    return `<li><button type="button" class="ss-game${sel?.r.id === r.id ? ' is-on' : ''}" data-game="${esc(r.id)}">
      <span class="ss-when">${esc(r.date ? formatGameDate(r.date) : 'No date')}${r.time ? `<span>${esc(formatTime(r.time))}</span>` : ''}</span>
      <span class="ss-teams">${teamDot(g.away)}${esc(g.away || 'TBD')} <span class="sse-at">at</span> ${teamDot(g.home)}${esc(g.home || 'TBD')}${kind}</span>
      <span class="ss-status">${status}</span>
    </button></li>`;
  }).join('')}</ul>`;
}

// ------------------------------------------------------------------ entry

function pick(gameId, { scroll = true } = {}) {
  const x = items.find(i => i.r.id === gameId);
  if (!x) return;
  sel = x;
  const { g, r } = x;
  history.replaceState(null, '', `?season=${encodeURIComponent(seasonId)}&game=${encodeURIComponent(r.id)}`);
  renderGames();
  $('ssEntry').hidden = false;
  $('ssTitle').textContent = `${g.away || 'TBD'} at ${g.home || 'TBD'}`;
  $('ssWhen').textContent = `${r.date ? formatGameDate(r.date, 'long') : 'No date'}${r.time ? `, ${formatTime(r.time)}` : ''}${g.type === 'playoff' ? `, ${g.round || 'playoff'}` : ''}`;
  $('ssAwayName').innerHTML = `${teamDot(g.away)}${esc(g.away || 'Away')}`;
  $('ssHomeName').innerHTML = `${teamDot(g.home)}${esc(g.home || 'Home')}`;
  $('ssAway').value = g.hasScores ? g.awayScore : '';
  $('ssHome').value = g.hasScores ? g.homeScore : '';
  $('ssForfeit').checked = r.forfeit === true;
  $('ssNotes').value = r.gameNotes || '';
  const ls = r.lineScore;
  if (ls && Array.isArray(ls.home) && Array.isArray(ls.away)) {
    const n = Math.max(ls.home.length, ls.away.length, 1);
    line = { away: Array.from({ length: n }, (_, i) => Number(ls.away[i]) || 0), home: Array.from({ length: n }, (_, i) => Number(ls.home[i]) || 0) };
  } else line = null;
  $('ssLineOn').checked = !!line;
  renderLine();
  if (g.hasScores) {
    const by = r.scoreSubmittedByEmail ? ` by ${esc(r.scoreSubmittedByEmail)}` : '';
    note('warning', `This game already has a final of ${esc(g.away)} ${esc(g.awayScore)}, ${esc(g.home)} ${esc(g.homeScore)}${by}. Saving replaces it.`);
  } else if (!started(x)) {
    note('info', "This game hasn't started yet.");
  } else note('', '');
  $('ssDone').hidden = true;
  preview();
  if (scroll) $('ssEntry').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function note(type, html) {
  const el = $('ssNotice');
  if (!html) { el.hidden = true; return; }
  const ic = { success: 'check-circle', error: 'x-circle', warning: 'alert' }[type] || 'info';
  el.className = `aces-notice${type === 'info' ? '' : ` is-${type}`}`;
  el.innerHTML = `${icon(ic)}<div>${html}</div>`;
  el.hidden = false;
}

function renderLine() {
  const on = !!line;
  $('ssLine').hidden = !on;
  $('ssAway').readOnly = on;
  $('ssHome').readOnly = on;
  if (!on) return;
  const n = line.home.length;
  const { g } = sel;
  const cells = (side) => line[side].map((v, i) => `<td><input class="ss-inn" type="number" min="0" inputmode="numeric" data-side="${side}" data-i="${i}" value="${v}" aria-label="${esc(side === 'home' ? g.home : g.away)} inning ${i + 1}"></td>`).join('');
  const sum = (side) => line[side].reduce((a, b) => a + b, 0);
  $('ssLineTable').innerHTML = `<thead><tr><th scope="col">Team</th>${line.home.map((_, i) => `<th scope="col" class="is-num">${i + 1}</th>`).join('')}<th scope="col" class="is-num">R</th></tr></thead>
    <tbody><tr><th scope="row">${esc(g.away || 'Away')}</th>${cells('away')}<td class="is-num"><strong>${sum('away')}</strong></td></tr>
    <tr><th scope="row">${esc(g.home || 'Home')}</th>${cells('home')}<td class="is-num"><strong>${sum('home')}</strong></td></tr></tbody>`;
  $('ssInnCount').textContent = `${n} inning${n === 1 ? '' : 's'}`;
  $('ssInnLess').disabled = n <= MIN_INN;
  $('ssInnMore').disabled = n >= MAX_INN;
  $('ssAway').value = sum('away');
  $('ssHome').value = sum('home');
}

function scores() {
  const a = $('ssAway').value, h = $('ssHome').value;
  return { away: a === '' ? NaN : parseInt(a, 10), home: h === '' ? NaN : parseInt(h, 10) };
}

function preview() {
  if (!sel) return;
  const { away, home } = scores();
  const { g } = sel;
  const el = $('ssPreview');
  if (Number.isNaN(away) || Number.isNaN(home)) { el.textContent = 'Enter both scores.'; el.className = 'ss-preview'; return; }
  const winner = away > home ? g.away : home > away ? g.home : '';
  el.innerHTML = `${esc(g.away)} ${away}, ${esc(g.home)} ${home}: ${winner ? `<strong>${esc(winner)} win</strong>` : '<strong>tie</strong>'}${$('ssForfeit').checked ? ' (forfeit)' : ''}${line ? `, ${line.home.length}-inning line score` : ''}`;
  el.className = 'ss-preview is-ready';
}

async function save() {
  if (!sel || saving) return;
  const { away, home } = scores();
  if (Number.isNaN(away) || Number.isNaN(home) || away < 0 || home < 0) { note('error', 'Enter a score of 0 or more for both teams.'); return; }
  const { r, g } = sel;
  const homeId = lower(r.homeTeamId || g.home).replace(/\s+/g, '_') || null;
  const awayId = lower(r.awayTeamId || g.away).replace(/\s+/g, '_') || null;
  const forfeit = $('ssForfeit').checked;
  const notes = $('ssNotes').value.trim();
  const winner = home > away ? homeId : away > home ? awayId : 'tie';
  const replacing = g.hasScores && (Number(g.homeScore) !== home || Number(g.awayScore) !== away);
  const msg = `${g.away} ${away}, ${g.home} ${home}${forfeit ? ' (forfeit)' : ''}.${replacing ? ` This replaces the ${g.awayScore}-${g.homeScore} that's there now.` : ''}`;
  if (!(await confirmModal(msg, { title: g.hasScores ? 'Update the score?' : 'Submit the score?', confirmLabel: g.hasScores ? 'Update score' : 'Submit score' }))) return;

  const data = {
    homeScore: home, awayScore: away, winner, status: 'completed', forfeit,
    lastScoreUpdate: Timestamp.now(),
    scoreSubmittedBy: ctx.user.uid,
    scoreSubmittedByEmail: ctx.user.email || null
  };
  if (line) data.lineScore = { home: [...line.home], away: [...line.away], innings: line.home.length };
  else if (r.lineScore) data.lineScore = deleteField();
  if (notes) data.gameNotes = notes;
  else if (r.gameNotes) data.gameNotes = deleteField();

  saving = true;
  $('ssSave').disabled = true;
  $('ssSave').textContent = 'Saving...';
  try {
    await updateDoc(doc(db, 'seasons', seasonId, 'games', r.id), data);
    Object.assign(r, data, { lineScore: line ? data.lineScore : undefined, gameNotes: notes || undefined });
    sel.g = normalizeGame({ ...r, __normalized: false });
    showToast(`Saved: ${g.away} ${away}, ${g.home} ${home}`, 'success');
    renderGames();
    note('success', `Saved. ${esc(g.away)} ${away}, ${esc(g.home)} ${home}.`);
    // Straight on to stats for the side(s) this member can enter.
    const sides = ['away', 'home'].filter(s => !scope || [lower(s === 'home' ? r.homeTeamId : r.awayTeamId), lower(s === 'home' ? g.home : g.away)].some(k => scope.includes(k)));
    $('ssDone').innerHTML = `<span class="sse-dim">Next:</span> ${sides.map(s => `<a class="aces-btn is-sm" href="submit-stats.html?season=${encodeURIComponent(seasonId)}&game=${encodeURIComponent(r.id)}&side=${s}">Enter ${esc(s === 'home' ? g.home : g.away)} stats</a>`).join(' ')}`;
    $('ssDone').hidden = !sides.length;
  } catch (err) {
    console.error('[submit-score] save failed', err);
    note('error', `Could not save: ${esc(err.message || err)}`);
  } finally {
    saving = false;
    $('ssSave').disabled = false;
    $('ssSave').textContent = 'Save score';
  }
}

// ------------------------------------------------------------------ start

function bind() {
  document.querySelectorAll('[data-games]').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.games;
    document.querySelectorAll('[data-games]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderGames();
  }));
  $('ssGames').addEventListener('click', (e) => { const b = e.target.closest('[data-game]'); if (b) pick(b.dataset.game); });
  ['ssAway', 'ssHome'].forEach(id => $(id).addEventListener('input', preview));
  $('ssForfeit').addEventListener('change', preview);
  $('ssLineOn').addEventListener('change', async () => {
    if ($('ssLineOn').checked) {
      line = { away: Array(DEFAULT_INN).fill(0), home: Array(DEFAULT_INN).fill(0) };
    } else if (line && [...line.home, ...line.away].some(v => v > 0) && !(await confirmModal('Clear the inning-by-inning runs?', { confirmLabel: 'Clear' }))) {
      $('ssLineOn').checked = true;
      return;
    } else line = null;
    renderLine();
    preview();
  });
  $('ssLineTable').addEventListener('input', (e) => {
    const inp = e.target.closest('.ss-inn');
    if (!inp) return;
    line[inp.dataset.side][Number(inp.dataset.i)] = Math.max(0, parseInt(inp.value, 10) || 0);
    const sum = (side) => line[side].reduce((a, b) => a + b, 0);
    $('ssAway').value = sum('away');
    $('ssHome').value = sum('home');
    $('ssLineTable').querySelectorAll('tbody tr').forEach((tr, i) => { tr.lastElementChild.innerHTML = `<strong>${sum(i ? 'home' : 'away')}</strong>`; });
    preview();
  });
  $('ssLineTable').addEventListener('focusin', (e) => { if (e.target.matches('.ss-inn')) e.target.select(); });
  $('ssInnMore').addEventListener('click', () => { if (line.home.length < MAX_INN) { line.home.push(0); line.away.push(0); renderLine(); preview(); } });
  $('ssInnLess').addEventListener('click', async () => {
    const n = line.home.length;
    if (n <= MIN_INN) return;
    if ((line.home[n - 1] || line.away[n - 1]) && !(await confirmModal(`Inning ${n} has runs. Remove it anyway?`, { confirmLabel: 'Remove' }))) return;
    line.home.pop(); line.away.pop();
    renderLine();
    preview();
  });
  $('ssSave').addEventListener('click', save);
  $('ssClose').addEventListener('click', () => {
    sel = null;
    $('ssEntry').hidden = true;
    history.replaceState(null, '', `?season=${encodeURIComponent(seasonId)}`);
    renderGames();
  });
  window.addEventListener('beforeunload', (e) => { if (saving) { e.preventDefault(); e.returnValue = ''; } });
}

async function main() {
  ctx = await initPage({ title: 'Submit scores', role: 'team-staff', deniedMessage: 'Submitting scores is for captains, team staff and league staff.' });
  if (!ctx?.user) return;
  scope = submitScope(ctx.profile);
  if (scope && !scope.length) {
    pageReady();
    $('ssScope').innerHTML = '<span class="aces-badge is-alert">Not linked to a team</span> Ask league staff to link your account to your team.';
    $('ssBody').hidden = true;
    return;
  }
  $('ssScope').textContent = scope ? `Showing games for ${scopeLabel(scope)}.` : 'League staff: every game.';

  const seasons = (await getAllSeasons()).sort((a, b) => seasonSortKey(b.id) - seasonSortKey(a.id));
  const params = new URLSearchParams(location.search);
  const start = [params.get('season'), ctx.config?.currentSeasonId, seasons[0]?.id].find(id => id && seasons.some(s => s.id === id));
  const seasonSel = $('ssSeason');
  seasonSel.innerHTML = seasons.map(s => `<option value="${esc(s.id)}">${esc(seasonLabel(s.id))}</option>`).join('');
  if (start) seasonSel.value = start;
  seasonSel.addEventListener('change', async () => {
    sel = null;
    $('ssEntry').hidden = true;
    history.replaceState(null, '', `?season=${encodeURIComponent(seasonSel.value)}`);
    await loadSeason(seasonSel.value);
  });
  bind();
  pageReady();
  if (!start) { $('ssGames').innerHTML = '<p class="sse-empty">No seasons found.</p>'; return; }
  await loadSeason(start);
  const game = params.get('game');
  const x = items.find(i => i.r.id === game);
  if (x) {
    if (!needsScore(x)) {
      filter = 'all';
      document.querySelectorAll('[data-games]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.games === 'all')));
      renderGames();
    }
    pick(game);
  }
}

main().catch(err => {
  console.error('[submit-score] start failed', err);
  pageReady();
  $('ssGames').innerHTML = `<p class="sse-empty">Could not load: ${esc(err.message || err)}</p>`;
});
