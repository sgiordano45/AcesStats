// js/pages/sim.js
// sim.html: Backyard Aces Softball (the Aces Sim). Setup -> snake draft vs the computer -> lineup -> a
// 7-inning game on the pixel field -> box score. Everything about the game
// lives in this browser (localStorage acesSim.v1), so a refresh resumes.
//
// The pool and ratings: js/data/sim.js + js/domain/sim-ratings.js.
// Draft rules, the computer drafter and the at-bat engine: js/domain/sim-engine.js.
// The field and animation: js/features/sim/field.js.

import { initPage, pageReady } from '../core/app.js';
import { loadSimPool } from '../data/sim.js';
import { loadRecord, recordGame } from '../data/sim-records.js';
import {
  SLOTS, TEAM_SIZE, RATING_KEYS, RATING_ABBR, RATING_LABELS, positionTag, leagueSummary, reviveLeague
} from '../domain/sim-ratings.js';
import {
  pickOwner, legalPicks, cpuPick, assignPositions, battingOrder, makeTeam, newGame,
  CPU_STYLES, AUTO_PICK, CONDITIONS, randomConditions, dealPool,
  planPA, commitPA, simHalf, simToEnd, currentBatter, currentPitcher, battingTeam,
  ipText, starOfGame, INNINGS
} from '../domain/sim-engine.js';
import { SimField } from '../features/sim/field.js';
import { seasonLabel } from '../domain/season-ids.js';
import { escapeHtml as esc, fmtAvg } from '../ui/format.js';
import { teamDot } from '../ui/game-shared.js';
import { confirmModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';

const $ = (id) => document.getElementById(id);
const STORE = 'acesSim.v1';

const TEAM_COLORS = [
  ['Green', '#2d7d32'], ['Gold', '#CFB53B'], ['Carolina', '#4b9cd3'], ['Teal', '#008080'],
  ['Black', '#1a1a1a'], ['Purple', '#7b1fa2'], ['Army', '#654321'], ['Silver', '#757575'],
  ['Orange', '#f57c00'], ['Blue', '#1976d2'], ['Red', '#d32f2f']
];

const S = {
  pool: null,          // { seasonId, players, league }
  byId: new Map(),
  save: null,          // what's kept in localStorage (see newSave)
  field: null,         // SimField
  busy: false,
  auto: false,
  draftFilter: { slot: '', q: '', sort: 'ovr', fits: false }
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(S.save)); } catch { /* full or blocked */ }
}
function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
}
function clearSaved() {
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
}

const POOL_SIZES = [[36, '36 random players'], [28, '28 random players (thin)'], [0, 'Everyone']];

function newSave({ name, color, cpuColor, first, homeIsYou, ask, style, favorite, poolIds, conditionsMode }) {
  const st = CPU_STYLES[style];
  return {
    v: 1,
    phase: 'draft',
    seasonId: S.pool.seasonId,
    teams: [
      { name, color, cpu: false },
      { name: st.name, color: cpuColor, cpu: true }
    ],
    style,            // CPU_STYLES key
    favorite,         // the Homer's team
    poolIds,          // dealt pool (null: everyone)
    conditionsMode,   // 'random' or a CONDITIONS key
    conditions: null, // this game's
    first,            // team index that picks first (0 you, 1 computer)
    homeIsYou,
    picks: [[], []],  // player ids
    log: [],          // [{ n, team, id }]
    lineups: null,    // [{ lineup, field }, ...]
    game: null,
    ask,
    speed: 1,
    results: []       // [{ you, cpu }] across rematches
  };
}

const P = (id) => S.byId.get(id);
const picksOf = (ti) => S.save.picks[ti].map(P).filter(Boolean);
const poolLeft = () => {
  const taken = new Set([...S.save.picks[0], ...S.save.picks[1]]);
  const dealt = S.save.poolIds ? new Set(S.save.poolIds) : null;
  return S.pool.players.filter((p) => !taken.has(p.id) && (!dealt || dealt.has(p.id)));
};
const styleOf = () => CPU_STYLES[S.save.style] || CPU_STYLES.fundamentals;
const cpuName = () => S.save.teams[1].name || 'the computer';
const opponentLine = () => {
  const st = styleOf();
  return `${st.blurb}${S.save.style === 'homer' && S.save.favorite ? ` Favorite team: ${S.save.favorite}.` : ''}`;
};

// ---------------------------------------------------------------------------
// Bits of markup
// ---------------------------------------------------------------------------

const band = (v) => (v < 35 ? 1 : v < 45 ? 2 : v < 55 ? 3 : v < 65 ? 4 : 5);
const chip = (v, title = '') => `<span class="sim-rating" data-band="${band(v)}"${title ? ` title="${esc(title)}"` : ''}>${v}</span>`;
const posChip = (p) => `<span class="sim-pos${p.pos.wild ? ' is-wild' : ''}" title="Roster: ${esc(p.position)}">${esc(positionTag(p.pos))}</span>`;
const swatch = (color) => `<span class="sim-swatch" style="background:${esc(color)}"></span>`;

function show(phase) {
  for (const id of ['simSetup', 'simDraft', 'simLineup', 'simGame', 'simFinal']) $(id).hidden = true;
  $({ setup: 'simSetup', draft: 'simDraft', lineup: 'simLineup', game: 'simGame', final: 'simFinal' }[phase]).hidden = false;
  // The how-to steps show on the setup screen only.
  $('simSteps').hidden = phase !== 'setup';
  // The record sidebar shows between games; the draft and the game need the width.
  const aside = ['setup', 'lineup', 'final'].includes(phase);
  $('simAside').hidden = !aside;
  $('simLayout').classList.toggle('has-aside', aside);
}

// ---------------------------------------------------------------------------
// Record and pennants
// ---------------------------------------------------------------------------

// A pennant for each computer manager beaten.
const PENNANTS = {
  fundamentals: { short: 'Fundamentals', color: '#2d7d32' },
  sluggers: { short: 'Long Ball', color: '#d32f2f' },
  moneyball: { short: 'Moneyball', color: '#1976d2' },
  smallball: { short: 'Small Ball', color: '#f57c00' },
  leather: { short: 'Leather', color: '#654321' },
  homer: { short: 'Homer', color: '#7b1fa2' },
  chaos: { short: 'Chaos', color: '#1a1a1a' }
};

const pennantSvg = (color) => `<svg class="sim-pennant-flag" viewBox="0 0 44 26" aria-hidden="true">
  <rect x="1" y="1" width="2" height="24" fill="#6b5a45"/>
  <path d="M3 2 L43 13 L3 24 Z" fill="${color}"/>
  <path d="M3 2 L43 13 L3 24 Z" fill="none" stroke="rgba(0,0,0,.25)"/>
  <path d="M7 9 L18 13 L7 17 Z" fill="rgba(255,255,255,.85)"/></svg>`;

const fmtPct = (r) => (r.games ? (r.wins + r.ties / 2) / r.games : 0).toFixed(3).replace(/^0/, '');
const recLine = (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;

function renderRecordChip() {
  const r = S.record;
  const chip = $('simRecordChip');
  if (!r || !r.games) { chip.hidden = true; return; }
  const won = Object.values(r.byStyle).filter((s) => s.w).length;
  chip.hidden = false;
  chip.innerHTML = `<span class="sim-kicker">Your record</span> <strong>${recLine(r)}</strong> <span class="sim-dim">${won}/${Object.keys(PENNANTS).length} pennants</span>`;
}

function renderRecord({ fresh = '' } = {}) {
  renderRecordChip();
  const r = S.record;
  const box = $('simAside');
  if (!r) {
    box.innerHTML = '<section class="aces-card sim-record"><h2 class="aces-card-title">Your record</h2><p class="sim-dim">Couldn\u2019t load your record right now.</p></section>';
    return;
  }
  const per = (v) => (r.games ? (v / r.games).toFixed(1) : '-');
  const diff = r.runsFor - r.runsAgainst;
  const streak = r.streak?.n ? `${r.streak.type}${r.streak.n}` : '-';
  const won = Object.keys(PENNANTS).filter((k) => r.byStyle[k]?.w).length;
  box.innerHTML = `
    <section class="aces-card sim-record">
      <h2 class="aces-card-title">Your record</h2>
      ${S.uid ? '' : '<p class="sim-dim">Saved in this browser only. <a href="signin.html">Sign in</a> to keep your record on your account.</p>'}
      <div class="sim-rec-big"><strong>${recLine(r)}</strong><span class="sim-dim">${r.games ? `${fmtPct(r)} in ${r.games} game${r.games === 1 ? '' : 's'}` : 'No games yet'}</span></div>
      <dl class="sim-rec-stats">
        <div><dt>Runs per game</dt><dd>${per(r.runsFor)}</dd></div>
        <div><dt>Allowed per game</dt><dd>${per(r.runsAgainst)}</dd></div>
        <div><dt>Run diff</dt><dd>${r.games ? (diff > 0 ? `+${diff}` : diff) : '-'}</dd></div>
        <div><dt>Streak</dt><dd>${esc(streak)}</dd></div>
      </dl>
    </section>
    <section class="aces-card sim-record">
      <h2 class="aces-card-title">Pennants <span class="sim-dim">${won} of ${Object.keys(PENNANTS).length}</span></h2>
      <p class="sim-dim">Beat each computer manager to raise his pennant.</p>
      <ul class="sim-pennants">${Object.entries(PENNANTS).map(([k, pn]) => {
        const st = r.byStyle[k];
        const has = !!st?.w;
        const vs = st ? recLine({ wins: st.w, losses: st.l, ties: st.t }) : '0-0';
        const tip = has ? `Beat ${CPU_STYLES[k].name}${st.firstWinAt ? ` (first on ${new Date(st.firstWinAt).toLocaleDateString()})` : ''}. ${vs} against them.` : `Beat ${CPU_STYLES[k].name} to earn this.${st ? ` ${vs} so far.` : ''}`;
        return `<li class="sim-pennant${has ? ' is-won' : ''}${fresh === k ? ' is-new' : ''}" title="${esc(tip)}">
          ${pennantSvg(has ? pn.color : '#b9bdb6')}
          <span class="sim-pennant-name">${esc(pn.short)}</span>
          <span class="sim-pennant-rec">${esc(vs)}</span></li>`;
      }).join('')}</ul>
      ${won === Object.keys(PENNANTS).length ? '<p class="sim-pennant-all">All seven pennants. Nobody in the league can manage like you.</p>' : ''}
    </section>
    ${r.recent.length ? `<section class="aces-card sim-record">
      <h2 class="aces-card-title">Recent games</h2>
      <ol class="sim-recent">${r.recent.slice(0, 6).map((x) => {
        const res = x.you > x.cpu ? 'W' : x.you < x.cpu ? 'L' : 'T';
        return `<li><span class="sim-res is-${res}">${res}</span> ${x.you}-${x.cpu} <span class="sim-dim">vs ${esc(CPU_STYLES[x.style]?.name || 'the computer')}${CONDITIONS[x.conditions] && x.conditions !== 'perfect' ? `, ${esc(CONDITIONS[x.conditions].label.toLowerCase())}` : ''}</span></li>`;
      }).join('')}</ol>
    </section>` : ''}`;
}

/** Add the finished game to the person's record (account or browser). */
async function saveToRecord(g) {
  const yi = youIdx();
  const game = {
    you: g.score[yi],
    cpu: g.score[1 - yi],
    style: S.save.style || 'fundamentals',
    conditions: g.conditions || 'perfect',
    how: g.result?.how || ''
  };
  try {
    const name = S.profile?.displayName || S.profile?.linkedPlayer || '';
    const { record, newPennant } = await recordGame(S.uid, game, { name });
    S.record = record;
    renderRecord({ fresh: newPennant ? game.style : '' });
    if (newPennant) showToast(`Pennant earned: you beat ${CPU_STYLES[game.style].name}!`);
  } catch (err) {
    console.error('[sim] record not saved', err);
    showToast('Couldn\u2019t save this game to your record', 'error');
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function renderSetup(profile) {
  show('setup');
  const saved = readSaved();
  const canResume = saved && saved.phase && saved.seasonId === S.pool.seasonId;
  const first = (profile?.displayName || profile?.linkedPlayer || '').split(' ')[0];
  const defaultName = first ? `${first}'s Aces` : 'Your team';
  const defaultColor = TEAM_COLORS[3][1];
  $('simSetup').innerHTML = `
    ${canResume ? `<div class="aces-card sim-resume">
      <div><h2 class="aces-card-title">Pick up where you left off?</h2>
      <p class="sim-dim">${esc(saved.teams[0].name)} vs ${esc(saved.teams[1].name || 'the computer')}, ${esc(phaseWord(saved))}.</p></div>
      <div class="sim-actions"><button class="aces-btn is-primary" type="button" data-act="resume">Resume</button>
      <button class="aces-btn is-ghost" type="button" data-act="discard">Start over</button></div>
    </div>` : ''}
    <form class="aces-card sim-setup" id="simSetupForm" novalidate>
      <h2 class="aces-card-title">New game</h2>
      <p class="sim-dim">Pool: ${S.pool.players.length} players on the ${esc(seasonLabel(S.pool.seasonId))} rosters. Ratings run 20-80 with 50 as league average: contact from AVG, power from extra-base hits, speed from runs per game, plus defense and pitching set by the league.</p>
      <div class="aces-field"><label class="aces-label" for="suName">Team name</label>
        <input class="aces-input" id="suName" maxlength="28" value="${esc(defaultName)}"></div>
      <fieldset class="sim-colors"><legend class="aces-label">Your colors</legend>
        ${TEAM_COLORS.map(([n, c]) => `<label class="sim-color"><input type="radio" name="suColor" value="${c}"${c === defaultColor ? ' checked' : ''}><span style="background:${c}" title="${n}"></span><span class="u-sr-only">${n}</span></label>`).join('')}
      </fieldset>
      <div class="sim-row">
        <div class="aces-field"><label class="aces-label" for="suFirst">First pick</label>
          <span class="aces-select-wrap"><select class="aces-select" id="suFirst">
            <option value="flip">Coin flip</option><option value="0">You pick first</option><option value="1">The computer picks first</option>
          </select></span></div>
        <div class="aces-field"><label class="aces-label" for="suHome">Home team</label>
          <span class="aces-select-wrap"><select class="aces-select" id="suHome">
            <option value="flip">Coin flip</option><option value="you">You (bat last)</option><option value="cpu">The computer</option>
          </select></span></div>
      </div>
      <div class="sim-row">
        <div class="aces-field"><label class="aces-label" for="suStyle">Opponent</label>
          <span class="aces-select-wrap"><select class="aces-select" id="suStyle">
            <option value="random">Surprise me</option>
            ${Object.entries(CPU_STYLES).map(([k, st]) => `<option value="${k}">${esc(st.name)}</option>`).join('')}
          </select></span>
          <span class="sim-dim" id="suStyleNote">A random computer manager with its own taste in players.</span></div>
        <div class="aces-field"><label class="aces-label" for="suPool">Draft pool</label>
          <span class="aces-select-wrap"><select class="aces-select" id="suPool">
            ${POOL_SIZES.map(([n, label]) => `<option value="${n}">${esc(n ? label : `${label} (${S.pool.players.length})`)}</option>`).join('')}
          </select></span>
          <span class="sim-dim">A fresh random deal each draft, so the same stars aren't always there.</span></div>
        <div class="aces-field"><label class="aces-label" for="suWeather">Conditions</label>
          <span class="aces-select-wrap"><select class="aces-select" id="suWeather">
            <option value="random">Random each game</option>
            ${Object.entries(CONDITIONS).map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}
          </select></span></div>
      </div>
      <label class="sim-check"><input type="checkbox" id="suAsk" checked> Ask me to send or hold runners on close plays</label>
      <div class="sim-actions"><button class="aces-btn is-primary" type="submit">Start the draft</button></div>
      <p class="sim-dim sim-rules">Draft 9 players each, snake order. You need someone who can play every spot (P, C, 1B, 2B, 3B, SS, LF, CF, RF) from their roster position: IF covers any infield spot, OF any outfield spot, IF/OF either. Players with no position are Utility; you can take one Utility and one Flex player, and they can play anywhere. Games are 7 innings at Senior Field with the league mercy rule: past the next diamond's first-base dugout is a ground-rule double, through the gap in the fence is an automatic triple.</p>
    </form>`;

  $('simSetup').onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'resume') { S.save = saved; resume(); }
    if (act === 'discard') { clearSaved(); renderSetup(profile); }
  };
  $('suStyle').onchange = (e) => {
    const st = CPU_STYLES[e.target.value];
    $('suStyleNote').textContent = st ? st.blurb : 'A random computer manager with its own taste in players.';
  };
  $('simSetupForm').onsubmit = (e) => {
    e.preventDefault();
    const sv = $('suStyle').value;
    const style = CPU_STYLES[sv] ? sv : Object.keys(CPU_STYLES)[Math.floor(Math.random() * Object.keys(CPU_STYLES).length)];
    const realTeams = [...new Set(S.pool.players.map((p) => p.team).filter(Boolean))];
    const favorite = style === 'homer' ? realTeams[Math.floor(Math.random() * realTeams.length)] : '';
    const size = Number($('suPool').value) || 0;
    const dealt = size ? dealPool(S.pool.players, size) : null;
    const color = document.querySelector('input[name="suColor"]:checked')?.value || defaultColor;
    const others = TEAM_COLORS.map(([, c]) => c).filter((c) => c !== color);
    const cpuColor = others[Math.floor(Math.random() * others.length)];
    const fv = $('suFirst').value;
    const hv = $('suHome').value;
    S.save = newSave({
      name: $('suName').value.trim() || 'Your team',
      color,
      cpuColor,
      first: fv === 'flip' ? (Math.random() < 0.5 ? 0 : 1) : Number(fv),
      homeIsYou: hv === 'flip' ? Math.random() < 0.5 : hv === 'you',
      ask: $('suAsk').checked,
      style,
      favorite,
      poolIds: dealt && dealt.length < S.pool.players.length ? dealt.map((p) => p.id) : null,
      conditionsMode: $('suWeather').value
    });
    persist();
    if (sv === 'random') showToast(`Your opponent: ${CPU_STYLES[style].name}`);
    if (fv === 'flip') showToast(S.save.first === 0 ? 'You won the coin flip: you pick first' : `${CPU_STYLES[style].name} pick first`);
    renderDraft();
  };
}

function phaseWord(save) {
  if (save.phase === 'draft') return `drafting (${save.picks[0].length + save.picks[1].length} of 18 picks)`;
  if (save.phase === 'lineup') return 'setting the lineup';
  if (save.phase === 'game' && save.game) return `${save.game.half ? 'bottom' : 'top'} of the ${ordinal(save.game.inning)}, ${save.game.score.join('-')}`;
  if (save.phase === 'final') return 'game over';
  return save.phase;
}
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

function resume() {
  const missing = [...S.save.picks[0], ...S.save.picks[1]].filter((id) => !S.byId.has(id));
  if (missing.length && S.save.phase !== 'game' && S.save.phase !== 'final') {
    showToast('The rosters changed since this draft started, so it starts over', 'error');
    clearSaved();
    S.save = null;
    renderSetup(S.profile);
    return;
  }
  const ph = S.save.phase;
  if (ph === 'draft') renderDraft();
  else if (ph === 'lineup') renderLineup();
  else if (ph === 'game') startGameView();
  else if (ph === 'final') renderFinal();
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

const pickNo = () => S.save.picks[0].length + S.save.picks[1].length;
const onClock = () => pickOwner(pickNo(), S.save.first);
const draftDone = () => pickNo() >= 2 * TEAM_SIZE;
const draftTeams = () => [{ picks: picksOf(0) }, { picks: picksOf(1) }];

function makePick(ti, player) {
  const n = pickNo();
  S.save.picks[ti].push(player.id);
  S.save.log.push({ n, team: ti, id: player.id });
  persist();
}

let cpuTimer = 0;
function renderDraft() {
  show('draft');
  S.save.phase = 'draft';
  if (draftDone()) { finishDraft(); return; }
  const teams = draftTeams();
  const left = poolLeft();
  const ti = onClock();
  const legal = ti === 0 ? legalPicks(0, teams, left) : new Set();
  const placed = assignPositions(teams[0].picks) || {};
  const open = SLOTS.filter((s) => !placed[s]);
  const n = pickNo();
  const round = Math.floor(n / 2) + 1;

  const f = S.draftFilter;
  const q = f.q.toLowerCase();
  const rows = left
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
    .filter((p) => !f.slot || (f.slot === 'WILD' ? !!p.pos.wild : !p.pos.wild && p.pos.slots.includes(f.slot)))
    .filter((p) => !f.fits || p.pos.slots.some((s) => open.includes(s)))
    .sort((a, b) => (f.sort === 'ovr' ? b.ovr - a.ovr : b.ratings[f.sort] - a.ratings[f.sort]) || a.name.localeCompare(b.name));

  $('simDraft').innerHTML = `
    <div class="aces-card sim-clock${ti === 0 ? ' is-you' : ''}">
      <div>
        <span class="sim-kicker">Round ${round} of ${TEAM_SIZE}, pick ${n + 1} of ${2 * TEAM_SIZE}</span>
        <h2 class="sim-clock-title">${ti === 0 ? 'You are on the clock' : `On the clock: ${esc(cpuName())}`}</h2>
        ${ti === 0 ? `<p class="sim-dim">Open spots: ${open.map((s) => `<span class="sim-need">${s}</span>`).join(' ') || 'none'}</p>` : ''}
        <p class="sim-dim">Opponent: <strong>${esc(cpuName())}</strong>. ${esc(opponentLine())}${S.save.poolIds ? ` Drafting from ${S.save.poolIds.length} dealt players.` : ''}</p>
      </div>
      <div class="sim-actions">
        ${ti === 0 ? '<button class="aces-btn" type="button" data-act="autopick" title="Let the computer pick for you this round">Auto-pick</button>' : ''}
        <button class="aces-btn is-ghost" type="button" data-act="restart">Start over</button>
      </div>
    </div>
    <div class="sim-draft">
      <section class="aces-card sim-poolcard">
        <div class="sim-filters">
          <input class="aces-input" type="search" id="dfQ" placeholder="Find a player or team" value="${esc(f.q)}" autocomplete="off" aria-label="Find a player">
          <span class="aces-select-wrap"><select class="aces-select" id="dfSort" aria-label="Sort by">
            <option value="ovr">Sort: Overall</option>${RATING_KEYS.map((k) => `<option value="${k}"${f.sort === k ? ' selected' : ''}>Sort: ${RATING_LABELS[k]}</option>`).join('')}
          </select></span>
          <label class="sim-check"><input type="checkbox" id="dfFits"${f.fits ? ' checked' : ''}> Fits an open spot</label>
        </div>
        <div class="aces-chip-row sim-slotchips" role="group" aria-label="Position">
          ${['', ...SLOTS, 'WILD'].map((s) => `<button type="button" class="aces-chip" data-slot="${s}" aria-pressed="${f.slot === s}">${s === '' ? 'All' : s === 'WILD' ? 'UT/Flex' : s}</button>`).join('')}
        </div>
        <div class="aces-table-wrap sim-pool"><table class="aces-table is-compact">
          <thead><tr><th scope="col">Player</th><th scope="col">Pos</th>${RATING_KEYS.map((k) => `<th scope="col" class="is-num" title="${esc(RATING_LABELS[k])}">${RATING_ABBR[k]}</th>`).join('')}<th scope="col" class="is-num" title="Overall at his best spot">OVR</th><th scope="col"><span class="u-sr-only">Draft</span></th></tr></thead>
          <tbody>${rows.map((p) => poolRow(p, ti === 0, legal)).join('') || `<tr><td colspan="${RATING_KEYS.length + 4}" class="aces-empty">Nobody left matches.</td></tr>`}</tbody>
        </table></div>
      </section>
      <div class="sim-teams">
        ${teamPanel(0, teams[0].picks)}
        ${teamPanel(1, teams[1].picks)}
        <section class="aces-card"><h2 class="aces-card-title">Picks</h2><ol class="sim-picks">${[...S.save.log].reverse().map((l) => `<li><span class="sim-dim">${l.n + 1}.</span> ${swatch(S.save.teams[l.team].color)} ${esc(P(l.id)?.name || l.id)} <span class="sim-dim">${esc(positionTag(P(l.id)?.pos || { slots: [], wild: 'UT' }))}</span></li>`).join('') || '<li class="sim-dim">No picks yet.</li>'}</ol></section>
      </div>
    </div>`;

  bindDraft();
  clearTimeout(cpuTimer);
  if (ti === 1) {
    cpuTimer = setTimeout(() => {
      const p = cpuPick(1, draftTeams(), poolLeft(), { style: S.save.style || 'fundamentals', favorite: S.save.favorite || '' });
      if (!p) { showToast('The computer has no legal pick left', 'error'); return; }
      makePick(1, p);
      renderDraft();
    }, 700);
  }
}

function poolRow(p, yourTurn, legal) {
  const ok = legal.has(p.id);
  const why = yourTurn && !ok ? 'No room for him: you could no longer fill every spot (or you already have a Utility/Flex player)' : '';
  return `<tr class="${yourTurn && !ok ? 'is-blocked' : ''}">
    <th scope="row" class="sim-pname">${teamDot(p.team)}<span>${esc(p.name)}</span><small>${esc(p.team)}</small></th>
    <td>${posChip(p)}</td>
    ${RATING_KEYS.map((k) => `<td class="is-num">${chip(p.ratings[k])}</td>`).join('')}
    <td class="is-num"><strong>${p.ovr}</strong></td>
    <td class="sim-pickcell">${yourTurn ? `<button class="aces-btn is-sm${ok ? ' is-primary' : ''}" type="button" data-pick="${esc(p.id)}"${ok ? '' : ` disabled title="${esc(why)}"`}>Draft</button>` : ''}</td>
  </tr>`;
}

function teamPanel(ti, picks) {
  const t = S.save.teams[ti];
  const placed = assignPositions(picks) || {};
  const byId = new Map(picks.map((p) => [p.id, p]));
  return `<section class="aces-card sim-teamcard">
    <h2 class="aces-card-title">${swatch(t.color)} ${esc(t.name)} <span class="sim-dim">${picks.length}/${TEAM_SIZE}</span></h2>
    <ul class="sim-spots">${SLOTS.map((s) => {
      const p = byId.get(placed[s]);
      return `<li class="${p ? '' : 'is-open'}"><span class="sim-spot">${s}</span>${p ? `<span>${esc(p.name)}</span>${p.pos.wild ? `<span class="sim-pos is-wild">${p.pos.wild === 'FLEX' ? 'Flex' : 'UT'}</span>` : ''}<span class="sim-ovr">${p.ovr}</span>` : '<span class="sim-dim">open</span>'}</li>`;
    }).join('')}</ul>
  </section>`;
}

function bindDraft() {
  const root = $('simDraft');
  root.onclick = async (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick && !pick.disabled && onClock() === 0) {
      const p = P(pick.dataset.pick);
      makePick(0, p);
      renderDraft();
      return;
    }
    const slot = e.target.closest('[data-slot]');
    if (slot) { S.draftFilter.slot = slot.dataset.slot; renderDraft(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'autopick' && onClock() === 0) {
      const p = cpuPick(0, draftTeams(), poolLeft(), { style: AUTO_PICK });
      if (p) { makePick(0, p); showToast(`Auto-pick: ${p.name}`); renderDraft(); }
    }
    if (act === 'restart') restart();
  };
  $('dfQ').oninput = (e) => {
    S.draftFilter.q = e.target.value;
    const pos = e.target.selectionStart;
    renderDraft();
    $('dfQ').focus();
    $('dfQ').setSelectionRange(pos, pos);
  };
  $('dfSort').onchange = (e) => { S.draftFilter.sort = e.target.value; renderDraft(); };
  $('dfFits').onchange = (e) => { S.draftFilter.fits = e.target.checked; renderDraft(); };
}

async function restart() {
  if (!(await confirmModal('Throw out this game and start a new draft?', { danger: true, confirmLabel: 'Start over' }))) return;
  clearTimeout(cpuTimer);
  stopAuto();
  S.field?.stop();
  clearSaved();
  S.save = null;
  renderSetup(S.profile);
}

function finishDraft() {
  S.save.lineups = [0, 1].map((ti) => {
    const ps = picksOf(ti);
    return { lineup: battingOrder(ps), field: assignPositions(ps) };
  });
  S.save.phase = 'lineup';
  persist();
  renderLineup();
}

// ---------------------------------------------------------------------------
// Lineup
// ---------------------------------------------------------------------------

function renderLineup() {
  show('lineup');
  const mine = S.save.lineups[0];
  const slotOf = Object.fromEntries(Object.entries(mine.field).map(([s, id]) => [id, s]));
  const cpu = S.save.lineups[1];
  const cpuSlot = Object.fromEntries(Object.entries(cpu.field).map(([s, id]) => [id, s]));
  const homeName = S.save.homeIsYou ? S.save.teams[0].name : cpuName();
  // Conditions are set when the lineup screen first shows (rerolled for each game when random).
  if (!S.save.conditions) {
    S.save.conditions = S.save.conditionsMode && CONDITIONS[S.save.conditionsMode] ? S.save.conditionsMode : randomConditions();
    persist();
  }
  const cond = CONDITIONS[S.save.conditions];

  $('simLineup').innerHTML = `
    <div class="aces-card sim-clock is-you">
      <div><span class="sim-kicker">Lineup</span>
      <h2 class="sim-clock-title">Set your batting order and positions</h2>
      <p class="sim-dim">${esc(homeName)} ${S.save.homeIsYou ? 'are' : 'is'} the home team. Change a spot to swap two players; a player can only move to a spot his roster position allows.</p>
      <p class="sim-weather" data-cond="${esc(S.save.conditions)}"><strong>Today at Senior Field:</strong> ${esc(cond.label)}. ${esc(cond.blurb)}</p></div>
      <div class="sim-actions"><button class="aces-btn is-primary" type="button" data-act="play">Play ball</button>
      <button class="aces-btn is-ghost" type="button" data-act="restart">Start over</button></div>
    </div>
    <div class="sim-lineups">
      <section class="aces-card">
        <h2 class="aces-card-title">${swatch(S.save.teams[0].color)} ${esc(S.save.teams[0].name)}</h2>
        <ol class="sim-order">${mine.lineup.map((id, i) => {
          const p = P(id);
          return `<li>
            <span class="sim-bat">${i + 1}</span>
            <span class="sim-oname">${esc(p.name)} ${posChip(p)}</span>
            <span class="aces-select-wrap sim-slotsel"><select class="aces-select" data-slot-for="${esc(id)}" aria-label="${esc(p.name)} position">
              ${SLOTS.map((s) => `<option value="${s}"${slotOf[id] === s ? ' selected' : ''}${p.pos.slots.includes(s) ? '' : ' disabled'}>${s}</option>`).join('')}
            </select></span>
            <span class="sim-ochips">${chip(p.ratings.contact, 'Contact')}${chip(p.ratings.power, 'Power')}${chip(p.ratings.speed, 'Speed')}</span>
            <span class="sim-move">
              <button class="aces-btn is-sm is-icon is-ghost" type="button" data-up="${i}" aria-label="Move ${esc(p.name)} up"${i === 0 ? ' disabled' : ''}>▲</button>
              <button class="aces-btn is-sm is-icon is-ghost" type="button" data-down="${i}" aria-label="Move ${esc(p.name)} down"${i === mine.lineup.length - 1 ? ' disabled' : ''}>▼</button>
            </span>
          </li>`;
        }).join('')}</ol>
        <p class="sim-dim">Ratings shown: contact, power, speed.</p>
      </section>
      <section class="aces-card">
        <h2 class="aces-card-title">${swatch(S.save.teams[1].color)} ${esc(cpuName())}</h2>
        <p class="sim-dim">${esc(opponentLine())}</p>
        <ol class="sim-order is-cpu">${cpu.lineup.map((id, i) => {
          const p = P(id);
          return `<li><span class="sim-bat">${i + 1}</span><span class="sim-oname">${esc(p.name)}</span><span class="sim-spot">${cpuSlot[id]}</span>
            <span class="sim-ochips">${chip(p.ratings.contact, 'Contact')}${chip(p.ratings.power, 'Power')}${chip(p.ratings.speed, 'Speed')}</span></li>`;
        }).join('')}</ol>
      </section>
    </div>`;

  const root = $('simLineup');
  root.onclick = (e) => {
    const up = e.target.closest('[data-up]');
    const down = e.target.closest('[data-down]');
    if (up || down) {
      const i = Number((up || down).dataset[up ? 'up' : 'down']);
      const j = up ? i - 1 : i + 1;
      const L = mine.lineup;
      [L[i], L[j]] = [L[j], L[i]];
      persist();
      renderLineup();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') startGame();
    if (act === 'restart') restart();
  };
  root.onchange = (e) => {
    const sel = e.target.closest('[data-slot-for]');
    if (!sel) return;
    const id = sel.dataset.slotFor;
    const to = sel.value;
    const from = slotOf[id];
    const other = mine.field[to];
    if (other && !P(other).pos.slots.includes(from)) {
      showToast(`${P(other).name} can't play ${from}, so they can't swap`, 'error');
      sel.value = from;
      return;
    }
    mine.field[to] = id;
    if (other) mine.field[from] = other; else delete mine.field[from];
    persist();
    renderLineup();
  };
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

function startGame() {
  const mk = (ti) => makeTeam({
    name: S.save.teams[ti].name,
    color: S.save.teams[ti].color,
    cpu: S.save.teams[ti].cpu,
    players: picksOf(ti),
    lineup: S.save.lineups[ti].lineup,
    field: S.save.lineups[ti].field
  });
  const you = mk(0);
  const cpu = mk(1);
  you.side = 0; cpu.side = 1;
  const [away, home] = S.save.homeIsYou ? [cpu, you] : [you, cpu];
  if (!S.save.conditions) S.save.conditions = CONDITIONS[S.save.conditionsMode] ? S.save.conditionsMode : randomConditions();
  S.save.game = newGame({ away, home, league: leagueSummary(S.pool.league), conditions: S.save.conditions });
  S.save.phase = 'game';
  persist();
  startGameView();
}

const G = () => S.save.game;
const youIdx = () => (S.save.homeIsYou ? 1 : 0);   // which game team is the user's

function startGameView() {
  show('game');
  if (!S.field) S.field = new SimField($('simCanvas'));
  S.field.setConditions(G().conditions || 'perfect');
  $('simSpeed').value = String(S.save.speed ?? 1);
  $('simAsk').checked = !!S.save.ask;
  setScene();
  renderGame();
}

function setScene() {
  const g = G();
  if (g.over) return;
  const bat = battingTeam(g);
  const fld = g.teams[1 - g.half];
  const b = currentBatter(g);
  S.field.setScene({
    fieldColor: fld.color,
    batColor: bat.color,
    bases: g.bases,
    batterId: b.id,
    bats: b.bats,
    fielderIds: fld.field
  });
}

function lineScore(g) {
  const n = Math.max(INNINGS, g.inning);
  const cells = (t) => Array.from({ length: n }, (_, i) => {
    const v = t.runs[i];
    const playing = !g.over && g.inning === i + 1 && g.teams[g.half] === t;
    if (v === 'X') return '<td class="is-num">X</td>';
    if (v === undefined || v === null) return `<td class="is-num${playing ? ' is-now' : ''}">${playing ? '0' : ''}</td>`;
    return `<td class="is-num${playing ? ' is-now' : ''}">${v}</td>`;
  }).join('');
  return `<div class="aces-table-wrap"><table class="aces-table is-compact sim-line">
    <thead><tr><th scope="col"></th>${Array.from({ length: n }, (_, i) => `<th scope="col" class="is-num">${i + 1}</th>`).join('')}<th scope="col" class="is-num">R</th><th scope="col" class="is-num">H</th><th scope="col" class="is-num">E</th></tr></thead>
    <tbody>${g.teams.map((t, i) => `<tr><th scope="row">${swatch(t.color)} ${esc(t.name)}</th>${cells(t)}<td class="is-num"><strong>${g.score[i]}</strong></td><td class="is-num">${t.hits}</td><td class="is-num">${t.errors}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function todayLine(b) {
  if (!b) return '';
  const parts = [`${b.h}-${b.ab}`];
  if (b.hr) parts.push(b.hr > 1 ? `${b.hr} HR` : 'HR');
  if (b.t) parts.push(b.t > 1 ? `${b.t} 3B` : '3B');
  if (b.d) parts.push(b.d > 1 ? `${b.d} 2B` : '2B');
  if (b.rbi) parts.push(`${b.rbi} RBI`);
  if (b.bb) parts.push(b.bb > 1 ? `${b.bb} BB` : 'BB');
  return parts.join(', ');
}

function renderGame() {
  const g = G();
  $('simBoard').innerHTML = lineScore(g);
  if (g.over) { renderFinal(); return; }
  const bat = battingTeam(g);
  const fld = g.teams[1 - g.half];
  const b = currentBatter(g);
  const p = currentPitcher(g);
  const deck = bat.roster[bat.lineup[(bat.next + 1) % bat.lineup.length]];
  const base = (i) => `<span class="sim-base${g.bases[i] ? ' is-on' : ''}" title="${g.bases[i] ? esc(bat.roster[g.bases[i]].name) : 'Empty'}"></span>`;
  $('simSide').innerHTML = `
    <div class="sim-sit">
      <span class="sim-inning">${g.half ? 'Bot' : 'Top'} ${g.inning}</span>
      <span class="sim-diamond">${base(2)}${base(1)}${base(0)}</span>
      <span class="sim-outs" aria-label="${g.outs} out">${[0, 1].map((i) => `<span class="${i < g.outs ? 'is-on' : ''}"></span>`).join('')} <small>${g.outs} out</small></span>
    </div>
    <div class="sim-who">
      <span class="sim-kicker">${swatch(bat.color)} Now batting</span>
      <strong>${esc(b.name)}</strong>
      <span class="sim-dim">${esc(slotOfTeam(bat, b.id))} · ${esc(todayLine(bat.box[b.id]))}</span>
      <span class="sim-ochips">${chip(b.ratings.contact, 'Contact')}${chip(b.ratings.power, 'Power')}${chip(b.ratings.speed, 'Speed')}</span>
    </div>
    <div class="sim-who is-small">
      <span class="sim-kicker">On deck</span><span>${esc(deck.name)}</span>
    </div>
    <div class="sim-who is-small sim-weather" data-cond="${esc(g.conditions || 'perfect')}" title="${esc((CONDITIONS[g.conditions] || CONDITIONS.perfect).blurb)}">
      <span class="sim-kicker">Conditions</span><span>${esc((CONDITIONS[g.conditions] || CONDITIONS.perfect).label)}</span>
    </div>
    <div class="sim-who">
      <span class="sim-kicker">${swatch(fld.color)} Pitching</span>
      <strong>${esc(p.name)}</strong>
      <span class="sim-dim">${ipText(fld.pit.outs)} IP, ${fld.pit.r} R, ${fld.pit.h} H</span>
      <span class="sim-ochips">${chip(p.ratings.pitch, 'Pitching')}</span>
    </div>`;
  const log = g.log.slice(-60).reverse();
  $('simLog').innerHTML = log.map((e) => `<li class="${e.runs ? 'is-runs' : ''}"><span class="sim-dim">${e.half ? 'B' : 'T'}${e.inning}</span> ${esc(e.text)}${e.runs ? ` <strong>${esc(e.score.join('-'))}</strong>` : ''}</li>`).join('') || '<li class="sim-dim">Play ball!</li>';
  const busy = S.busy;
  $('simNext').disabled = busy || S.auto;
  $('simHalf').disabled = busy;
  $('simEnd').disabled = busy;
}

const slotOfTeam = (t, id) => Object.entries(t.field).find(([, v]) => v === id)?.[0] || '';

function askDecision(play) {
  return new Promise((resolve) => {
    const d = play.decision;
    const box = $('simDecide');
    const pct = Math.round(d.pSafe * 100);
    box.innerHTML = `<p><strong>${esc(play.outcome?.text || play.options.hold.text.split('.')[0] + '.')}</strong></p>
      <p>${esc(d.label)} <span class="sim-dim">About ${pct}% to make it.</span></p>
      <div class="sim-actions"><button class="aces-btn is-primary" type="button" data-choice="send">Send him</button>
      <button class="aces-btn" type="button" data-choice="hold">Hold</button></div>`;
    box.hidden = false;
    box.querySelector('[data-choice]')?.focus();
    box.onclick = (e) => {
      const c = e.target.closest('[data-choice]')?.dataset.choice;
      if (!c) return;
      box.hidden = true;
      resolve(c);
    };
  });
}

async function nextPlay() {
  const g = G();
  if (S.busy || g.over) return;
  S.busy = true;
  renderGame();
  try {
    const play = planPA(g);
    let choice;
    if (play.decision) {
      choice = play.decision.ask && S.save.ask ? await askDecision(play) : play.decision.auto;
    }
    const outcome = play.decision ? play.options[choice] : play.outcome;
    const speedOf = (id) => (g.teams[0].roster[id] || g.teams[1].roster[id])?.ratings.speed ?? 50;
    await S.field.animate(play, outcome, { speed: Number(S.save.speed ?? 1), speedOf });
    commitPA(g, play, choice);
    persist();
  } finally {
    S.busy = false;
  }
  if (g.over) { stopAuto(); finishGame(); return; }
  setScene();
  renderGame();
  if (S.auto) setTimeout(() => { if (S.auto) nextPlay(); }, Number(S.save.speed) === 0 ? 250 : 500);
}

function stopAuto() {
  S.auto = false;
  $('simAuto').setAttribute('aria-pressed', 'false');
  $('simAuto').textContent = 'Auto-play';
}

function simFast(fn) {
  const g = G();
  if (S.busy || g.over) return;
  stopAuto();
  S.field.stop();
  fn(g);
  persist();
  if (g.over) { finishGame(); return; }
  setScene();
  renderGame();
}

function finishGame() {
  const g = G();
  const yi = youIdx();
  const first = !S.save.recorded;
  if (first) {
    S.save.results.push({ you: g.score[yi], cpu: g.score[1 - yi] });
    S.save.recorded = true;
  }
  S.save.phase = 'final';
  persist();
  renderFinal();
  if (first) saveToRecord(g);
}

// ---------------------------------------------------------------------------
// Final
// ---------------------------------------------------------------------------

function boxTable(t) {
  const rows = t.lineup.map((id) => {
    const b = t.box[id];
    return `<tr><th scope="row">${esc(t.roster[id].name)} <span class="sim-dim">${esc(slotOfTeam(t, id))}</span></th>
      <td class="is-num">${b.ab}</td><td class="is-num">${b.r}</td><td class="is-num">${b.h}</td><td class="is-num">${b.d}</td><td class="is-num">${b.t}</td><td class="is-num">${b.hr}</td><td class="is-num">${b.rbi}</td><td class="is-num">${b.bb}</td></tr>`;
  }).join('');
  const sum = (k) => t.lineup.reduce((s, id) => s + t.box[id][k], 0);
  const pid = t.field.P;
  return `<section class="aces-card">
    <h2 class="aces-card-title">${swatch(t.color)} ${esc(t.name)}</h2>
    <div class="aces-table-wrap"><table class="aces-table is-compact">
      <thead><tr><th scope="col">Batting</th><th scope="col" class="is-num">AB</th><th scope="col" class="is-num">R</th><th scope="col" class="is-num">H</th><th scope="col" class="is-num">2B</th><th scope="col" class="is-num">3B</th><th scope="col" class="is-num">HR</th><th scope="col" class="is-num">RBI</th><th scope="col" class="is-num">BB</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th scope="row">Totals</th>${['ab', 'r', 'h', 'd', 't', 'hr', 'rbi', 'bb'].map((k) => `<td class="is-num">${sum(k)}</td>`).join('')}</tr></tfoot>
    </table></div>
    <p class="sim-dim">Pitching: ${esc(t.roster[pid].name)}, ${ipText(t.pit.outs)} IP, ${t.pit.h} H, ${t.pit.r} R, ${t.pit.bb} BB, ${t.pit.so} K${t.pit.calls ? `, ${t.pit.calls} flat or illegal` : ''}. Errors: ${t.errors}.</p>
  </section>`;
}

function renderFinal() {
  show('final');
  const g = G();
  if (!g) { renderSetup(S.profile); return; }
  const yi = youIdx();
  const you = g.score[yi];
  const cpu = g.score[1 - yi];
  const how = g.result?.how;
  const headline = you > cpu ? 'You win!' : you < cpu ? `${cpuName()} won.` : 'It ends in a tie.';
  const note = (how === 'mercy' ? `Mercy rule after ${g.result.innings} innings.` : how === 'walk-off' ? 'Walk-off!' : how === 'tie' ? 'Still tied after 10 innings.' : g.result?.innings > INNINGS ? `${g.result.innings} innings.` : '')
    + ` ${(CONDITIONS[g.conditions] || CONDITIONS.perfect).label}.`;
  const star = starOfGame(g);
  const rec = S.save.results || [];
  const w = rec.filter((r) => r.you > r.cpu).length;
  const l = rec.filter((r) => r.you < r.cpu).length;
  $('simFinal').innerHTML = `
    <div class="aces-card sim-result${you > cpu ? ' is-win' : you < cpu ? ' is-loss' : ''}">
      <div>
        <span class="sim-kicker">Final</span>
        <h2 class="sim-clock-title">${esc(headline)} ${you}-${cpu}</h2>
        <p class="sim-dim">${esc(note)} ${star ? `Player of the game: <strong>${esc(star.name)}</strong> (${esc(todayLine(star.line))}).` : ''} ${rec.length > 1 ? `Series with these teams: ${w}-${l}${rec.length - w - l ? `-${rec.length - w - l}` : ''}.` : ''}</p>
      </div>
      <div class="sim-actions">
        <button class="aces-btn is-primary" type="button" data-act="rematch">Rematch</button>
        <button class="aces-btn" type="button" data-act="lineup">Change lineup and rematch</button>
        <button class="aces-btn is-ghost" type="button" data-act="new">New draft</button>
      </div>
    </div>
    <section class="aces-card">${lineScore(g)}</section>
    <div class="sim-boxes">${g.teams.map(boxTable).join('')}</div>
    <section class="aces-card"><h2 class="aces-card-title">Scoring plays</h2>
      <ol class="sim-log">${g.log.filter((e) => e.runs).map((e) => `<li class="is-runs"><span class="sim-dim">${e.half ? 'B' : 'T'}${e.inning}</span> ${esc(e.text)} <strong>${esc(e.score.join('-'))}</strong></li>`).join('') || '<li class="sim-dim">No runs scored.</li>'}</ol>
    </section>`;
  $('simFinal').onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rematch') { S.save.homeIsYou = !S.save.homeIsYou; S.save.recorded = false; S.save.conditions = null; startGame(); }
    if (act === 'lineup') { S.save.homeIsYou = !S.save.homeIsYou; S.save.recorded = false; S.save.conditions = null; S.save.phase = 'lineup'; S.save.game = null; persist(); renderLineup(); }
    if (act === 'new') { clearSaved(); S.save = null; renderSetup(S.profile); }
  };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const { user, profile, impersonating } = await initPage({ title: 'Backyard Aces Softball' });
S.profile = profile;
// During View As, keep the admin's games off the viewed person's record (browser only).
S.uid = user && !impersonating ? user.uid : '';
try {
  S.record = await loadRecord(S.uid);
} catch (err) {
  console.error('[sim] record not loaded', err);
  S.record = null;
}
renderRecord();

try {
  S.pool = await loadSimPool();
} catch (err) {
  console.error(err);
}
if (!S.pool?.seasonId || (S.pool.players || []).length < 2 * TEAM_SIZE) {
  $('simSetup').innerHTML = '<div class="aces-card"><p class="aces-empty">The sim needs a season with rosters (at least 18 players). Check back once rosters are set.</p></div>';
  show('setup');
} else {
  S.pool.league = S.pool.league?.est ? S.pool.league : reviveLeague(S.pool.league);
  S.byId = new Map(S.pool.players.map((p) => [p.id, p]));
  renderSetup(profile);
}

$('simNext').addEventListener('click', nextPlay);
$('simAuto').addEventListener('click', () => {
  S.auto = !S.auto;
  $('simAuto').setAttribute('aria-pressed', String(S.auto));
  $('simAuto').textContent = S.auto ? 'Pause' : 'Auto-play';
  if (S.auto) nextPlay(); else renderGame();
});
$('simHalf').addEventListener('click', () => simFast(simHalf));
$('simEnd').addEventListener('click', async () => {
  if (await confirmModal('Sim the rest of the game? Close plays use the computer’s call.', { confirmLabel: 'Sim it' })) simFast(simToEnd);
});
$('simSpeed').addEventListener('change', (e) => { S.save.speed = Number(e.target.value); persist(); });
$('simAsk').addEventListener('change', (e) => { S.save.ask = e.target.checked; persist(); });
document.addEventListener('keydown', (e) => {
  if ($('simGame').hidden || e.target.closest('input, select, textarea, button, dialog')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); nextPlay(); }
});

pageReady();
