// js/pages/playoffs.js
// playoffs.html: the season's playoff bracket.
//
//   Projected   before the bracket is locked, seeds come from the current
//               standings (js/domain/standings.js)
//   Official    once league staff lock it, seeds are frozen (lockedSeeds) and
//               every game has a doc in seasons/{id}/games
//               (playoff_{seriesId}_g{n}), so it shows on the schedule
//
// League staff (View As aware), current season only: set the format and
// dates (playoffs-format.js), publish placeholder games, lock the bracket,
// enter series scores, and pull in scores already entered on the game docs.
// Everyone: share the bracket as an image (playoffs-share.js).
//
// URL: playoffs.html[?seasonId=2026-summer]. Data: seasons/{id}/playoffs/bracket
// (shape described in playoffs-format.js) and seasons/{id}/games.
//
// Double elimination (fall): one game per series; game docs are playoff_g{n};
// a slot can be the loser of a game; home is the better seed unless set;
// G21 is cancelled on the schedule when the winners' bracket team takes G20.

import { initPage, pageReady, showPageError } from '../core/app.js';
import { hasRole } from '../core/auth.js';
import { getDisplaySeasonId } from '../core/config.js';
import { db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, Timestamp } from '../core/firebase.js';
import { getSeasonGames } from '../data/games.js';
import { TEAM_COLORS } from '../ui/stat-columns.js';
import { escapeHtml as esc } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmModal, alertModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { normalizeGames, computeStandings } from '../domain/standings.js';
import { formatGameDate, formatTime } from '../domain/dates.js';
import { seasonLabel, parseStatSeasonId } from '../domain/season-ids.js';
import {
  ROUND_KEYS, ROUND_TITLES, allSeries, generateBracket, recount, missingDates, editFormat,
  DE_KEYS, DE_TITLES, DE_TEAMS, isDouble, generateDouble, deColumns
} from './playoffs-format.js';
import { drawBracket, openShare } from './playoffs-share.js';

const $ = (id) => document.getElementById(id);
const recordText = (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;

const S = {
  sid: '', label: '', staff: false, current: false,
  data: null, saved: false,       // bracket doc, and whether it exists yet
  standings: [], gameDocs: new Map(),
  unsynced: 0, scoring: false
};

const bracketRef = () => doc(db, 'seasons', S.sid, 'playoffs', 'bracket');
const gamesCol = () => collection(db, 'seasons', S.sid, 'games');
const gameId = (s, g) => (s.bracket ? `playoff_${s.id}` : `playoff_${s.id}_g${g.gameNum}`);
const projected = () => S.data?.isProjected !== false;
const findSeries = (id) => allSeries(S.data).find((s) => s.id === id) || null;
const dbl = () => isDouble(S.data);
const scored = (g) => g.team1Score !== null && g.team1Score !== undefined && g.team2Score !== null && g.team2Score !== undefined;

/** Side (1|2) at home: set per game, or 'seed' = the better seed once both are known. */
function homeSide(s, g) {
  if (g.homeTeam === 1 || g.homeTeam === 2) return g.homeTeam;
  const a = team(s.team1).seed;
  const b = team(s.team2).seed;
  return a && b && b < a ? 2 : 1;
}

/** G21 is only needed when the losers' bracket team (team2) wins G20. */
function notNeeded(s) {
  if (!s.ifNecessary || !s.bracket) return false;
  const g20 = findSeries('g20');
  return g20?.winner === 1;
}

/** Where the loser of a winners' bracket game goes, e.g. 'G8'. */
function loserTo(id) {
  const next = allSeries(S.data).find((x) => x.team1?.loser === id || x.team2?.loser === id);
  return next ? next.id.toUpperCase() : '';
}

// ---------------------------------------------------------------------------
// Teams in the bracket
// ---------------------------------------------------------------------------

function seedTeam(seed) {
  if (!projected() && Array.isArray(S.data.lockedSeeds)) {
    const t = S.data.lockedSeeds.find((x) => x.seed === seed);
    if (t) return { seed, name: t.teamName || t.teamId || `Seed ${seed}`, record: t.record || '', real: true };
  }
  const r = S.standings[seed - 1];
  return r ? { seed, name: r.team, record: r.games ? recordText(r) : '', real: true } : { seed, name: `Seed ${seed}`, record: '', real: false };
}

/** A slot ({ seed } or { from }) as { seed, name, record, real }. */
function team(slot) {
  if (!slot) return { seed: '', name: 'TBD', record: '', real: false };
  if (slot.seed) return seedTeam(slot.seed);
  if (slot.loser) {
    const lf = findSeries(slot.loser);
    if (lf?.winner) return team(lf.winner === 1 ? lf.team2 : lf.team1);
    return { seed: '', name: `Loser ${slot.loser.toUpperCase()}`, record: '', real: false };
  }
  const from = slot.from ? findSeries(slot.from) : null;
  if (from?.winner) return team(from.winner === 1 ? from.team1 : from.team2);
  if (from?.bracket) return { seed: '', name: `Winner ${from.id.toUpperCase()}`, record: '', real: false };
  if (from) return { seed: '', name: `Winner ${shortName(from.team1)}/${shortName(from.team2)}`, record: '', real: false };
  return { seed: '', name: 'TBD', record: '', real: false };
}

function shortName(slot) {
  if (!slot) return 'TBD';
  if (slot.seed) return projected() ? String(slot.seed) : seedTeam(slot.seed).name;
  if (slot.loser) return `L${slot.loser.slice(1)}`;
  const from = slot.from ? findSeries(slot.from) : null;
  if (from?.winner) return shortName(from.winner === 1 ? from.team1 : from.team2);
  return from ? from.id.toUpperCase() : 'TBD';
}

/** Name written on placeholder game docs before seeds are final. */
function placeholderName(slot) {
  if (slot?.seed) return `Seed ${slot.seed}`;
  if (slot?.loser) return `${slot.loser.toUpperCase()} Loser`;
  const from = slot?.from ? findSeries(slot.from) : null;
  if (from?.bracket) return `${from.id.toUpperCase()} Winner`;
  if (from?.team1?.seed && from?.team2?.seed) return `${from.team1.seed}v${from.team2.seed} Winner`;
  return 'TBD';
}

function teamHtml(t) {
  const k = String(t.name || '').toLowerCase();
  const dot = t.real ? `<span class="aces-team-dot"${TEAM_COLORS.has(k) ? ` data-team-color="${esc(k)}"` : ''}></span>` : '';
  const name = t.real && !/^Seed \d+$/.test(t.name)
    ? `<a href="team.html?${esc(new URLSearchParams({ team: t.name }).toString())}">${esc(t.name)}</a>`
    : `<span class="po-tbd">${esc(t.name)}</span>`;
  return `${dot}${name}`;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function load() {
  const [docs, snap] = await Promise.all([
    getSeasonGames(S.sid).catch((err) => { console.warn('[playoffs] games unavailable', err); return []; }),
    getDoc(bracketRef()).catch((err) => { console.warn('[playoffs] bracket unavailable', err); return null; })
  ]);
  S.gameDocs = new Map(docs.map((d) => [d.id, d]));
  const games = normalizeGames(docs);
  S.standings = computeStandings(games, { extras: false, includeScheduled: true }).filter((r) => r.team && r.team !== 'TBD' && !/^Seed \d+$/.test(r.team) && !/Winner|Loser/.test(r.team));

  if (snap && snap.exists()) {
    S.data = snap.data();
    S.saved = true;
  } else {
    // Fall playoffs are double elimination; summer stays best-of series.
    S.data = /-fall$/.test(S.sid) && S.standings.length === DE_TEAMS
      ? generateDouble({ seasonId: S.sid })
      : generateBracket({ teams: Math.max(2, S.standings.length || 8) });
    S.saved = false;
  }
  mergeGameScores();
  recount(S.data);
}

/** Scores entered on the game docs (Submit score) that the bracket doc lacks. */
function mergeGameScores() {
  S.unsynced = 0;
  for (const s of allSeries(S.data)) {
    for (const g of s.games || []) {
      if (g.team1Score !== null && g.team1Score !== undefined) continue;
      const d = S.gameDocs.get(gameId(s, g));
      const hs = Number(d?.homeScore);
      const as = Number(d?.awayScore);
      if (!d || d.homeScore === null || d.awayScore === null || d.homeScore === undefined || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
      g.team1Score = homeSide(s, g) === 1 ? hs : as;
      g.team2Score = homeSide(s, g) === 1 ? as : hs;
      S.unsynced += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function seriesStatus(s) {
  const t1 = team(s.team1);
  const t2 = team(s.team2);
  const w1 = s.seriesWins1 || 0;
  const w2 = s.seriesWins2 || 0;
  const n = (s.games || []).length;
  if (s.winner) return `${s.winner === 1 ? t1.name : t2.name} won ${Math.max(w1, w2)}-${Math.min(w1, w2)}`;
  if (w1 + w2 === 0) return n === 1 ? 'One game' : `Best of ${n}`;
  if (w1 === w2) return `Tied ${w1}-${w2}`;
  return `${w1 > w2 ? t1.name : t2.name} leads ${Math.max(w1, w2)}-${Math.min(w1, w2)}`;
}

function gameChip(s, g) {
  const played = g.team1Score !== null && g.team1Score !== undefined && g.team2Score !== null && g.team2Score !== undefined;
  let text;
  if (played) text = `${g.team1Score}-${g.team2Score}`;
  else if (s.winner && g.ifNecessary) text = 'Not needed';
  else if (g.date) text = `${formatGameDate(g.date)}${g.time ? ` \u00b7 ${formatTime(g.time)}` : ''}`;
  else text = 'Date TBD';
  const cls = played ? 'is-played' : g.ifNecessary ? 'is-maybe' : '';
  return `<li class="${cls}"><b>G${g.gameNum}</b><span>${esc(text)}</span>${g.ifNecessary && !played && !s.winner ? '<small>if nec.</small>' : ''}</li>`;
}

function deCard(s) {
  const t1 = team(s.team1);
  const t2 = team(s.team2);
  const g = s.games[0] || {};
  const played = scored(g);
  const skip = notNeeded(s);
  const home = homeSide(s, g);
  const row = (t, score, side) => `<div class="po-team${s.winner === side ? ' is-win' : s.winner ? ' is-out' : ''}">
      <span class="po-seed">${esc(t.seed || '')}</span>
      <span class="po-name">${teamHtml(t)}${projected() && t.record ? `<small>${esc(t.record)}</small>` : ''}</span>
      <span class="po-wins">${played ? esc(score) : ''}</span>
    </div>`;
  const when = g.date ? `${formatGameDate(g.date)}${g.time ? ` \u00b7 ${formatTime(g.time)}` : ''}` : 'Date TBD';
  const state = skip ? 'Not needed' : played ? 'Final' : s.ifNecessary ? 'If necessary' : '';
  const lt = s.bracket === 'winners' ? loserTo(s.id) : '';
  const editable = S.scoring && !projected() && !skip;
  return `<article class="po-series is-de${s.bracket === 'championship' ? ' is-final' : ''}${s.winner || skip ? ' is-done' : ''}${skip ? ' is-skip' : ''}${editable ? ' is-edit' : ''}"${editable ? ` data-score="${esc(s.id)}" tabindex="0" role="button" aria-label="Enter the score for ${esc(t1.name)} vs ${esc(t2.name)}"` : ''}>
    <header><span class="po-sid">${esc(s.id.toUpperCase())}</span><span class="po-sstate">${esc(state)}</span></header>
    ${row(t1, g.team1Score, 1)}
    ${row(t2, g.team2Score, 2)}
    <footer class="po-de-foot"><span>${esc(when)}${(t1.real && t2.real) || g.homeTeam !== 'seed' ? ` \u00b7 ${esc((home === 1 ? t1 : t2).name)} home` : ''}</span>${lt ? `<span>Loser to ${esc(lt)}</span>` : ''}</footer>
  </article>`;
}

function seriesCard(s, key) {
  const t1 = team(s.team1);
  const t2 = team(s.team2);
  const row = (t, wins, side) => `<div class="po-team${s.winner === side ? ' is-win' : s.winner ? ' is-out' : ''}">
      <span class="po-seed">${esc(t.seed || '')}</span>
      <span class="po-name">${teamHtml(t)}${projected() && t.record ? `<small>${esc(t.record)}</small>` : ''}</span>
      <span class="po-wins">${wins || 0}</span>
    </div>`;
  const editable = S.scoring && !projected();
  return `<article class="po-series${key === 'finals' ? ' is-final' : ''}${s.winner ? ' is-done' : ''}${editable ? ' is-edit' : ''}"${editable ? ` data-score="${esc(s.id)}" tabindex="0" role="button" aria-label="Enter scores for ${esc(t1.name)} vs ${esc(t2.name)}"` : ''}>
    <header><span class="po-sid">${esc(s.id.toUpperCase())}</span><span class="po-sstate">${esc(seriesStatus(s))}</span></header>
    ${row(t1, s.seriesWins1, 1)}
    ${row(t2, s.seriesWins2, 2)}
    <ul class="po-games">${(s.games || []).map((g) => gameChip(s, g)).join('')}</ul>
  </article>`;
}

function renderDouble() {
  const section = (key) => {
    const cols = deColumns(S.data, key);
    if (!cols.length) return '';
    const title = (col) => col[0].round.replace(/ \(if necessary\)$/, '');
    return `<section class="po-de-section is-${key}">
      <h2 class="po-de-title">${key === 'championship' ? icon('trophy') : ''}${esc(DE_TITLES[key])}</h2>
      <div class="po-bracket" style="--po-cols:${cols.length}">${cols.map((col) => `<section class="po-round">
        <h3 class="po-round-title">${esc(key === 'championship' ? (col[0].ifNecessary ? 'If necessary' : 'Championship') : title(col))}</h3>
        <div class="po-round-list">${col.map(deCard).join('')}</div>
      </section>`).join('')}</div>
    </section>`;
  };
  $('poBracket').innerHTML = DE_KEYS.map(section).join('');
}

function renderBracket() {
  if (dbl()) { renderDouble(); return; }
  const rounds = ROUND_KEYS.filter((k) => (S.data[k] || []).length);
  $('poBracket').innerHTML = rounds.length
    ? `<div class="po-bracket" style="--po-cols:${rounds.length}">${rounds.map((k) => `<section class="po-round">
        <h2 class="po-round-title">${k === 'finals' ? icon('trophy') : ''}${esc(ROUND_TITLES[k])}</h2>
        <div class="po-round-list">${S.data[k].map((s) => seriesCard(s, k)).join('')}</div>
      </section>`).join('')}</div>`
    : `<div class="aces-card"><div class="aces-empty">${icon('trophy')}<p>No bracket yet.</p></div></div>`;
}

/** { champ, runner, line } once the title is decided, else null. */
function championship() {
  if (dbl()) {
    const g20 = findSeries('g20');
    const g21 = findSeries('g21');
    const last = g20?.winner === 1 ? g20 : g20?.winner === 2 && g21?.winner ? g21 : null;
    if (!last) return null;
    const g = last.games[0];
    const hi = Math.max(g.team1Score, g.team2Score);
    const lo = Math.min(g.team1Score, g.team2Score);
    const champ = team(last.winner === 1 ? last.team1 : last.team2);
    const runner = team(last.winner === 1 ? last.team2 : last.team1);
    return { champ, runner, line: `Beat ${runner.name} ${hi}-${lo} in the ${last.id === 'g21' ? 'deciding game' : 'championship'}.` };
  }
  const f = (S.data.finals || [])[0];
  if (!f?.winner) return null;
  return {
    champ: team(f.winner === 1 ? f.team1 : f.team2),
    runner: team(f.winner === 1 ? f.team2 : f.team1),
    line: `Beat ${team(f.winner === 1 ? f.team2 : f.team1).name} ${Math.max(f.seriesWins1, f.seriesWins2)}-${Math.min(f.seriesWins1, f.seriesWins2)} in the finals.`
  };
}

function renderChampion() {
  const c = championship();
  if (!c) { $('poChampion').innerHTML = ''; return; }
  const { champ } = c;
  const k = champ.name.toLowerCase();
  $('poChampion').innerHTML = `<section class="aces-card po-champ"${TEAM_COLORS.has(k) ? ` data-team-color="${esc(k)}"` : ''}>
    <span class="po-champ-icon">${icon('trophy')}</span>
    <div><span class="aces-page-kicker">${esc(S.label)} champion</span>
      <h2 class="po-champ-name">${teamHtml(champ)}</h2>
      <p>${esc(c.line)}</p></div>
  </section>`;
}

function renderStatus() {
  const locked = !projected();
  const when = S.data.lockedAt ? new Date(S.data.lockedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  $('poStatus').innerHTML = locked
    ? `<div class="aces-notice is-success">${icon('lock')}<div><strong>Official bracket.</strong> Seeds were locked${when ? ` on ${esc(when)}` : ''}.</div></div>`
    : `<div class="aces-notice">${icon('info')}<div><strong>Projected bracket.</strong> Seeds follow the current standings until league staff lock the bracket.</div></div>`;

  if (!S.staff) { $('poStaff').innerHTML = ''; return; }
  const btn = (act, label, ic, extra = '') => `<button type="button" class="aces-btn is-sm${extra}" data-act="${act}">${icon(ic)}${label}</button>`;
  const missing = missingDates(S.data).length;
  $('poStaff').innerHTML = `<section class="aces-card po-staff">
    <div class="po-staff-head"><strong>${icon('shield')}League staff</strong>
      <span class="aces-hint">${locked ? `Enter scores ${dbl() ? 'game by game' : 'series by series'}; game docs and later rounds update too.` : `${S.saved ? 'Format saved.' : 'Format not saved yet.'}${missing ? ` ${missing} game${missing === 1 ? '' : 's'} still need a date.` : ' Every game has a date.'}`}</span></div>
    <div class="po-staff-btns">
      ${locked ? '' : btn('format', 'Format and dates', 'settings', ' is-primary')}
      ${locked ? '' : btn('publish', 'Publish placeholder games', 'calendar')}
      ${locked ? '' : btn('lock', 'Lock bracket', 'lock')}
      ${locked ? btn('scores', S.scoring ? 'Done entering scores' : 'Enter scores', 'edit', S.scoring ? ' is-primary' : '') : ''}
      ${S.unsynced ? btn('sync', `Save ${S.unsynced} score${S.unsynced === 1 ? '' : 's'} from game results`, 'refresh', ' is-accent') : ''}
    </div>
    ${S.scoring ? `<p class="aces-hint">Tap a ${dbl() ? 'game' : 'series'} to enter ${dbl() ? 'its score' : 'its game scores'}.</p>` : ''}
  </section>`;
}

function renderSeeds() {
  const n = S.data.format?.teams || (projected() ? S.standings.length : (S.data.lockedSeeds || []).length);
  const firstRound = new Map();
  [...ROUND_KEYS, ...DE_KEYS].forEach((k) => (S.data[k] || []).forEach((s) => [s.team1, s.team2].forEach((t) => {
    if (t?.seed && !firstRound.has(t.seed)) firstRound.set(t.seed, s.bracket ? `${s.id.toUpperCase()} \u00b7 ${s.round}` : ROUND_TITLES[k]);
  })));
  const rows = Array.from({ length: n }, (_, i) => seedTeam(i + 1)).filter((t) => t.real || !projected());
  if (!rows.length) { $('poSeeds').innerHTML = ''; return; }
  $('poSeeds').innerHTML = `<section class="aces-card po-seeds">
    <div class="aces-card-head"><h2 class="aces-card-title">${icon('list')}Seeds</h2>
      ${projected() ? '<a class="aces-section-link" href="projections.html">Seed odds</a>' : ''}</div>
    <div class="aces-table-wrap"><table class="aces-table is-compact">
      <thead><tr><th scope="col">Seed</th><th scope="col">Team</th><th scope="col">Record</th><th scope="col">Starts in</th></tr></thead>
      <tbody>${rows.map((t) => `<tr><td>${t.seed}</td><th scope="row">${teamHtml(t)}</th><td>${esc(t.record || '-')}</td>
        <td>${esc(firstRound.get(t.seed) || '-')}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function render() {
  renderStatus();
  renderChampion();
  renderBracket();
  renderSeeds();
}

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------

const clean = (v) => JSON.parse(JSON.stringify(v));   // Firestore rejects undefined

async function saveBracket() {
  await setDoc(bracketRef(), clean(S.data));
  S.saved = true;
}

function gameTimestamp(g) {
  const [y, m, d] = g.date.split('-').map(Number);
  const [hh, mm] = g.time.split(':').map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d, hh, mm));
}

async function needDates() {
  const missing = missingDates(S.data);
  if (!missing.length) return false;
  await alertModal(`These games still need a date and time: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `, and ${missing.length - 12} more` : ''}.\n\nSet them in Format and dates first.`, { title: 'Dates missing' });
  return true;
}

async function actFormat() {
  const label = (slot) => {
    if (slot?.seed) { const t = seedTeam(slot.seed); return t.real ? `${slot.seed} ${t.name}` : `Seed ${slot.seed}`; }
    if (slot?.loser) return `Loser ${slot.loser.toUpperCase()}`;
    return slot?.from ? `Winner ${slot.from.toUpperCase()}` : 'TBD';
  };
  const next = await editFormat(S.data, { teamCount: S.standings.length, label, seasonId: S.sid });
  if (!next) return;
  S.data = recount(next);
  try {
    await saveBracket();
    showToast('Playoff format saved.', 'success');
  } catch (err) {
    console.error('[playoffs] save format', err);
    showToast("Couldn't save the format.", 'error');
  }
  render();
}

/** Playoff game doc for one game, with the given team names. */
function gamePayload(s, g, n1, n2) {
  const home = homeSide(s, g);
  return {
    gameType: 'playoff', round: s.round, seriesId: s.id, gameNum: s.bracket ? s.num : g.gameNum,
    ...(s.bracket ? { bracket: s.bracket } : {}),
    date: gameTimestamp(g), time: formatTime(g.time),
    homeTeamName: home === 1 ? n1 : n2,
    awayTeamName: home === 1 ? n2 : n1,
    ifNecessary: !!g.ifNecessary
  };
}

/** Unscored playoff game docs that aren't in this bracket (left from an earlier format). */
function staleGameIds() {
  const keep = new Set(allSeries(S.data).flatMap((s) => s.games.map((g) => gameId(s, g))));
  return [...S.gameDocs.values()]
    .filter((d) => String(d.gameType || '').toLowerCase() === 'playoff' && /^playoff_/.test(d.id) && !keep.has(d.id))
    .filter((d) => (d.homeScore === null || d.homeScore === undefined) && !d.winner)
    .map((d) => d.id);
}

async function removeStale(ids) {
  for (const id of ids) {
    try { await deleteDoc(doc(gamesCol(), id)); S.gameDocs.delete(id); }
    catch (err) { console.warn(`[playoffs] couldn't remove ${id}`, err); }
  }
}

const staleNote = (ids) => (ids.length ? `\n\n${ids.length} unplayed playoff game${ids.length === 1 ? '' : 's'} from an earlier format will be removed from the schedule.` : '');

async function actPublish() {
  if (await needDates()) return;
  const count = allSeries(S.data).reduce((n, s) => n + s.games.length, 0);
  const stale = staleGameIds();
  if (!(await confirmModal(`Add ${count} placeholder playoff games to the schedule so players can see the dates? Teams show as seeds or "TBD" until the bracket is locked.${staleNote(stale)}`, { title: 'Publish placeholder games', confirmLabel: 'Publish' }))) return;
  try {
    await saveBracket();
    await removeStale(stale);
    for (const s of allSeries(S.data)) {
      const n1 = placeholderName(s.team1);
      const n2 = placeholderName(s.team2);
      for (const g of s.games) {
        await setDoc(doc(gamesCol(), gameId(s, g)), {
          ...gamePayload(s, g, n1, n2), isPlaceholder: true,
          homeScore: null, awayScore: null, winner: null
        }, { merge: true });
      }
    }
    showToast(`Published ${count} placeholder games.`, 'success');
  } catch (err) {
    console.error('[playoffs] publish', err);
    showToast("Publishing stopped partway. Try again; games already added are kept.", 'error');
  }
}

async function actLock() {
  if (await needDates()) return;
  const n = S.data.format?.teams || S.standings.length;
  const seeds = S.standings.slice(0, n);
  if (seeds.length < n) { await alertModal(`The bracket needs ${n} teams but the standings have ${seeds.length}.`, { title: "Can't lock yet" }); return; }
  const list = seeds.map((r, i) => `${i + 1}. ${r.team} (${recordText(r)})`).join('\n\n');
  const stale = staleGameIds();
  if (!(await confirmModal(`Lock the bracket with these seeds?\n\n${list}\n\nThis creates every playoff game on the schedule and can't be undone here.${staleNote(stale)}`, { title: 'Lock bracket', confirmLabel: 'Lock bracket', danger: true }))) return;
  S.data.isProjected = false;
  S.data.lockedAt = new Date().toISOString();
  S.data.lockedSeeds = seeds.map((r, i) => ({ seed: i + 1, teamName: r.team, teamId: r.team, record: recordText(r) }));
  try {
    await saveBracket();
    await removeStale(stale);
    for (const s of allSeries(S.data)) {
      const t1 = s.bracket ? placeholderOrTeam(s.team1) : team(s.team1).name;
      const t2 = s.bracket ? placeholderOrTeam(s.team2) : team(s.team2).name;
      for (const g of s.games) {
        await setDoc(doc(gamesCol(), gameId(s, g)), {
          ...gamePayload(s, g, t1, t2),
          homeScore: null, awayScore: null, winner: null
        });
      }
    }
    showToast('Bracket locked. Playoff games are on the schedule.', 'success');
  } catch (err) {
    console.error('[playoffs] lock', err);
    showToast("Locking stopped partway. Reload and check the schedule before trying again.", 'error');
  }
  render();
}

/** A team's name once known, else the placeholder ('G5 Winner'). */
function placeholderOrTeam(slot) {
  const t = team(slot);
  return t.real ? t.name : placeholderName(slot);
}

const feeds = (s, id) => [s.team1, s.team2].some((t) => t?.from === id || t?.loser === id);

/** Later-round game docs pick up the teams that just won (or lost) a series. */
async function updateDependents(seriesId) {
  for (const s of allSeries(S.data)) {
    // G21 also hangs on G20's result (played only if G20's team2 wins).
    if (!feeds(s, seriesId) && !(s.bracket && s.ifNecessary && seriesId === 'g20')) continue;
    const t1 = s.bracket ? placeholderOrTeam(s.team1) : team(s.team1).name;
    const t2 = s.bracket ? placeholderOrTeam(s.team2) : team(s.team2).name;
    for (const g of s.games || []) {
      const home = homeSide(s, g);
      const updates = { homeTeamName: home === 1 ? t1 : t2, awayTeamName: home === 1 ? t2 : t1 };
      if (s.bracket && s.ifNecessary) updates.status = notNeeded(s) ? 'cancelled' : 'scheduled';
      try {
        await updateDoc(doc(gamesCol(), gameId(s, g)), updates);
      } catch (err) { console.warn(`[playoffs] couldn't update ${gameId(s, g)}`, err); }
    }
  }
}

async function writeSeriesGames(s) {
  const t1 = team(s.team1).name;
  const t2 = team(s.team2).name;
  for (const g of s.games) {
    if (g.team1Score === null && g.team2Score === null) continue;
    const side = homeSide(s, g);
    const homeScore = side === 1 ? g.team1Score : g.team2Score;
    const awayScore = side === 1 ? g.team2Score : g.team1Score;
    const home = side === 1 ? t1 : t2;
    const away = side === 1 ? t2 : t1;
    const updates = { homeScore, awayScore };
    if (homeScore !== null && awayScore !== null && homeScore !== awayScore) updates.winner = homeScore > awayScore ? home : away;
    try { await updateDoc(doc(gamesCol(), gameId(s, g)), updates); }
    catch (err) { console.warn(`[playoffs] couldn't update ${gameId(s, g)}`, err); }
  }
}

async function actScore(seriesId) {
  const s = findSeries(seriesId);
  if (!s) return;
  const t1 = team(s.team1).name;
  const t2 = team(s.team2).name;
  const body = document.createElement('div');
  body.className = 'po-score-form';
  body.innerHTML = s.games.map((g) => `<fieldset class="po-score-game">
    <legend>${s.bracket ? `${esc(s.id.toUpperCase())} \u00b7 ${esc(s.round)}` : `Game ${g.gameNum}${g.ifNecessary ? ' (if necessary)' : ''}`} <small>${g.date ? esc(formatGameDate(g.date)) : 'Date TBD'}${g.time ? ` \u00b7 ${esc(formatTime(g.time))}` : ''}</small></legend>
    <label><span>${esc(t1)}</span><input class="aces-input" type="number" min="0" inputmode="numeric" data-g="${g.gameNum}" data-t="1" value="${g.team1Score ?? ''}"></label>
    <label><span>${esc(t2)}</span><input class="aces-input" type="number" min="0" inputmode="numeric" data-g="${g.gameNum}" data-t="2" value="${g.team2Score ?? ''}"></label>
  </fieldset>`).join('');
  const ok = await openModal({
    title: `${t1} vs ${t2}`, body,
    actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, variant: 'primary' }]
  });
  if (!ok) return;
  const before = s.winner;
  s.games.forEach((g) => {
    const v = (t) => { const x = body.querySelector(`[data-g="${g.gameNum}"][data-t="${t}"]`).value; return x === '' ? null : Math.max(0, parseInt(x, 10) || 0); };
    g.team1Score = v(1);
    g.team2Score = v(2);
  });
  recount(S.data);
  try {
    await saveBracket();
    await writeSeriesGames(s);
    if (s.winner && s.winner !== before) await updateDependents(s.id);
    showToast(s.bracket ? 'Score saved.' : 'Series saved.', 'success');
  } catch (err) {
    console.error('[playoffs] save series', err);
    showToast("Couldn't save the series.", 'error');
  }
  render();
}

async function actSync() {
  try {
    await saveBracket();
    for (const s of allSeries(S.data)) if (s.winner) await updateDependents(s.id);
    S.unsynced = 0;
    showToast('Bracket updated from game results.', 'success');
  } catch (err) {
    console.error('[playoffs] sync', err);
    showToast("Couldn't update the bracket.", 'error');
  }
  render();
}

async function actShare() {
  const canvas = drawBracket(S.data, {
    team: (slot) => team(slot),
    title: `${S.label} Playoffs`,
    subtitle: projected() ? 'Projected bracket' : 'Official bracket'
  });
  await openShare(canvas, `aces-${S.sid}-playoffs.png`);
}

// ---------------------------------------------------------------------------

function wire() {
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'share') return actShare();
      if (!S.staff) return;
      if (act === 'format') return actFormat();
      if (act === 'publish') return actPublish();
      if (act === 'lock') return actLock();
      if (act === 'sync') return actSync();
      if (act === 'scores') { S.scoring = !S.scoring; render(); return; }
    }
    const card = e.target.closest('[data-score]');
    if (card && S.staff && S.scoring && !e.target.closest('a')) actScore(card.dataset.score);
  });
  document.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('[data-score]');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); actScore(card.dataset.score); }
  });
  document.addEventListener('error', (e) => { if (e.target.matches?.('[data-logo]')) e.target.remove(); }, true);
}

async function main() {
  const ctx = await initPage({ title: 'Playoffs' });
  const config = ctx?.config || {};
  const q = new URLSearchParams(location.search);
  const live = config.phase !== 'offseason' ? config.currentSeasonId : '';
  S.sid = parseStatSeasonId(q.get('seasonId') || q.get('season') || '').id || live || await getDisplaySeasonId().catch(() => '') || '';
  S.label = seasonLabel(S.sid);
  S.current = !!live && S.sid === live;
  S.staff = S.current && hasRole(ctx?.profile, 'league-staff');

  $('poKicker').textContent = S.label;
  $('poLogo').innerHTML = `<img src="photos/${esc(S.label)} Playoff logo.png" alt="" data-logo>`;
  document.title = `${S.label} Playoffs - Mountainside Aces`;
  wire();
  await load();
  render();
  pageReady();
}

main().catch((err) => { pageReady(); showPageError(err, { container: '#poBracket' }); });
