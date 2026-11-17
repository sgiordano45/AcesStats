// js/admin/home.js
// /admin/: the admin shell's home. A sidebar of every tool by job
// (js/admin/shell.js) and a to-do list of what needs doing now:
//   games past their start with no score, games missing a team's stats,
//   pending player-link and team-staff requests, rule proposals, new feature
//   requests, plus the season settings and when stats were last aggregated.
// Site status also switches the phase (regular / playoffs / offseason) in
// siteConfig/current, so it doesn't take a trip to the Firebase console.
// League staff and admins only; admin-only tools are hidden from league staff.

import { initPage, pageReady, siteUrl } from '../core/app.js';
import { hasRole } from '../core/auth.js';
import { db, collection, getDocs, doc, getDoc, setDoc, query, orderBy, limit, where } from '../core/firebase.js';
import { clearSiteConfigCache, PHASES } from '../core/config.js';
import { getSeasonGames } from '../data/games.js';
import { normalizeGame } from '../domain/standings.js';
import { parseGameDateTime, formatGameDate } from '../domain/dates.js';
import { seasonLabel } from '../domain/season-ids.js';
import { mountAdminShell } from './shell.js';
import { escapeHtml as esc } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { confirmModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';

const $ = (id) => document.getElementById(id);
const href = (p) => siteUrl(p);
const GAME_LENGTH_MS = 2 * 60 * 60 * 1000;
const toMillis = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : Date.parse(v || '') || 0);

function ago(ms) {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

// ---------------------------------------------------------------------------
// To-dos
// ---------------------------------------------------------------------------

async function gameTodos(seasonId) {
  const raw = await getSeasonGames(seasonId);
  const now = Date.now();
  const noScore = [];
  const noStats = [];
  let regularLeft = 0;
  for (const r of raw) {
    const g = normalizeGame(r);
    if (g && g.type === 'regular' && !g.winner && !g.unmatchedWinner) regularLeft++;
    const start = parseGameDateTime(r.date, r.time);
    if (!start || start.getTime() + GAME_LENGTH_MS > now) continue;
    const decided = !!g.winner || !!g.unmatchedWinner;
    if (!decided && !g.hasScores) { noScore.push({ g, r }); continue; }
    if (r.statsSubmitted === true || g.forfeit) continue;   // forfeits have no stats to enter
    const sides = [];
    if (r.statsSubmittedHome !== true) sides.push(g.home);
    if (r.statsSubmittedAway !== true) sides.push(g.away);
    if (sides.length) noStats.push({ g, r, sides });
  }
  const byDate = (a, b) => (a.g.dateKey < b.g.dateKey ? 1 : -1);
  return { noScore: noScore.sort(byDate), noStats: noStats.sort(byDate), regularLeft };
}

async function requestTodos() {
  const snap = await getDocs(collection(db, 'users'));
  let links = 0;
  let staff = 0;
  snap.forEach(d => {
    const u = d.data();
    links += (u.playerLinkRequests || []).filter(r => r.status === 'pending').length;
    staff += (u.staffRequests || []).filter(r => r.status === 'pending').length;
  });
  return { links, staff };
}

async function countWhere(col, field, values) {
  try {
    const snap = await getDocs(query(collection(db, col), where(field, 'in', values)));
    return snap.size;
  } catch (err) {
    console.warn(`[admin] ${col} count unavailable`, err);
    return null;
  }
}

const gameLine = ({ g, r, sides }) => `<li>
  <span class="adm-when">${esc(formatGameDate(r.date))}</span>
  <span>${esc(g.away)} at ${esc(g.home)}${g.hasScores ? ` <span class="adm-score">${g.awayScore}-${g.homeScore}</span>` : ''}</span>
  ${sides ? `<span class="adm-missing">${sides.map(esc).join(' and ')}</span>` : ''}</li>`;

function todoCard({ icon: ic, title, count, text, href: to, action, list = '', tone = '' }) {
  return `<section class="aces-card adm-todo${count ? ` ${tone || 'is-due'}` : ' is-clear'}">
    <div class="adm-todo-head">
      <span class="adm-todo-icon">${icon(ic)}</span>
      <div><h3>${esc(title)}</h3><p>${count === null ? 'Could not check' : count ? esc(text) : 'All clear'}</p></div>
      <span class="adm-todo-count">${count ?? '?'}</span>
    </div>
    ${list}
    ${count && to ? `<a class="aces-btn is-sm" href="${esc(href(to))}">${esc(action)}</a>` : ''}
  </section>`;
}

async function renderTodos(ctx) {
  const p = ctx.profile;
  const admin = hasRole(p, 'admin');
  const seasonId = ctx.config?.currentSeasonId;
  const phase = ctx.config?.phase || 'regular';

  const [games, reqs, features, latest, summary] = await Promise.all([
    seasonId ? gameTodos(seasonId).catch(err => { console.warn('[admin] games unavailable', err); return null; }) : null,
    requestTodos().catch(err => { console.warn('[admin] users unavailable', err); return null; }),
    admin ? countWhere('featureSubmissions', 'status', ['new']) : Promise.resolve(undefined),
    getDocs(query(collection(db, 'aggregatedPlayerStats'), orderBy('lastUpdated', 'desc'), limit(1))).then(s => toMillis(s.docs[0]?.data()?.lastUpdated)).catch(() => 0),
    seasonId ? getDoc(doc(db, 'siteConfig', 'summaries', 'seasons', seasonId)).then(s => (s.exists() ? toMillis(s.data().storedAt) || Date.parse(s.data().builtAt || '') : 0)).catch(() => 0) : 0
  ]);

  const top = (arr) => (arr.length ? `<ul class="adm-list">${arr.slice(0, 6).map(gameLine).join('')}</ul>${arr.length > 6 ? `<p class="adm-more">and ${arr.length - 6} more</p>` : ''}` : '');
  const cards = [];
  if (games) {
    cards.push(todoCard({ icon: 'hash', title: 'Missing scores', count: games.noScore.length, text: `${games.noScore.length} game${games.noScore.length === 1 ? ' has' : 's have'} started with no final score`,
      href: 'submit-score.html', action: 'Submit scores', list: top(games.noScore), tone: 'is-urgent' }));
    cards.push(todoCard({ icon: 'calculator', title: 'Missing stats', count: games.noStats.length, text: `${games.noStats.length} finished game${games.noStats.length === 1 ? ' is' : 's are'} missing a team's stats`,
      href: admin ? 'admin/stats.html' : 'submit-stats.html', action: admin ? 'Open stats pipeline' : 'Enter stats', list: top(games.noStats) }));
  }
  cards.push(todoCard({ icon: 'user-check', title: 'Player link requests', count: reqs ? reqs.links : null, text: `${reqs?.links} waiting for approval`, href: 'admin/people.html?tab=links', action: 'Review requests' }));
  cards.push(todoCard({ icon: 'shield', title: 'Team staff requests', count: reqs ? reqs.staff : null, text: `${reqs?.staff} waiting for a captain`, href: 'manage-team.html', action: 'Open team staff' }));
  if (features !== undefined) cards.push(todoCard({ icon: 'message', title: 'New feature requests', count: features, text: `${features} not looked at yet`, href: 'admin/content.html?tab=feedback', action: 'Open feedback' }));
  $('adminTodos').innerHTML = cards.join('');

  renderStatus(ctx, { seasonId, latest, summary, regularLeft: games ? games.regularLeft : null });
}

// ---------------------------------------------------------------------------
// Site status and the phase switch
// ---------------------------------------------------------------------------

const PHASE_LABELS = { [PHASES.REGULAR]: 'Regular season', [PHASES.PLAYOFFS]: 'Playoffs', [PHASES.OFFSEASON]: 'Offseason' };

// What each phase changes, shown in the confirm before switching.
const PHASE_EFFECTS = {
  [PHASES.REGULAR]: 'Projections and Clinching come back to the menu and the home page shows the playoff race links.',
  [PHASES.PLAYOFFS]: 'Projections and Clinching leave the menu, Championship preview can be switched on, and the home page shows the current playoff round. Standings are not affected.',
  [PHASES.OFFSEASON]: 'The season is treated as finished across the site: the home page shows final standings and the offseason sections, Year in review and Wrapped appear, and stat pages stop defaulting to this season.'
};

function renderStatus(ctx, info) {
  const phase = ctx.config?.phase || PHASES.REGULAR;
  const seg = Object.entries(PHASE_LABELS).map(([key, label]) =>
    `<button type="button" class="aces-segment${key === phase ? ' is-active' : ''}" data-phase="${key}" aria-pressed="${key === phase}">${esc(label)}</button>`).join('');

  $('adminStatus').innerHTML = `
    <dl class="adm-status">
      <div><dt>Season</dt><dd>${info.seasonId ? esc(seasonLabel(info.seasonId)) : 'None set'}</dd></div>
      <div><dt>Opening day</dt><dd>${esc(ctx.config?.openingDay || 'Not set')}</dd></div>
      <div><dt>Stats last aggregated</dt><dd>${esc(ago(info.latest))}</dd></div>
      <div><dt>Home page summary</dt><dd>${esc(ago(info.summary))}</dd></div>
    </dl>
    <div class="adm-phase">
      <h3 class="adm-phase-title">Phase</h3>
      <div class="aces-segmented" role="group" aria-label="Site phase" id="adminPhase">${seg}</div>
    </div>
    <p class="adm-hint">The phase is saved to <code>siteConfig/current</code>. Visitors see a change within 10 minutes.</p>`;

  $('adminPhase').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-phase]');
    if (btn && btn.dataset.phase !== phase) changePhase(ctx, info, btn.dataset.phase);
  });
}

async function changePhase(ctx, info, next) {
  const left = next === PHASES.PLAYOFFS && info.regularLeft
    ? `${info.regularLeft} regular-season game${info.regularLeft === 1 ? ' is' : 's are'} still without a result. Usually the switch waits until they're in and the bracket is locked.` : '';
  const ok = await confirmModal(
    [`Switch the site to ${PHASE_LABELS[next]}?`, PHASE_EFFECTS[next], left].filter(Boolean).join('\n\n'),
    { title: 'Change phase', confirmLabel: `Switch to ${PHASE_LABELS[next]}`, danger: next === PHASES.OFFSEASON || !!left });
  if (!ok) return;

  const buttons = $('adminPhase').querySelectorAll('button');
  buttons.forEach(b => { b.disabled = true; });
  try {
    await setDoc(doc(db, 'siteConfig', 'current'), { phase: next, phaseUpdatedAt: new Date() }, { merge: true });
    clearSiteConfigCache();
    ctx.config = { ...(ctx.config || {}), phase: next };
    renderStatus(ctx, info);
    showToast(`Phase set to ${PHASE_LABELS[next]}`, 'success');
  } catch (err) {
    console.error('[admin] phase change failed', err);
    buttons.forEach(b => { b.disabled = false; });
    showToast(`Couldn't change the phase: ${err.code || err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const ctx = await initPage({ title: 'Admin', role: 'league-staff', deniedMessage: 'The admin area is for league staff and admins.' });
  mountAdminShell(ctx.profile, 'admin/index.html');
  pageReady();
  await renderTodos(ctx);
}

main();
