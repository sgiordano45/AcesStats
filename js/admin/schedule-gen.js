// js/admin/schedule-gen.js
// Generate tab of admin/schedule.html: pick the season and teams, generate a
// balanced schedule (schedule-gen-core.js, the old generator's logic), then
// open it in the Workshop or download it. Nothing is written to the site.
// Replaced admin/schedule-generator.html; its Export to Firebase is gone
// (Season setup writes the season and games). Its time-slot, restriction and
// home/away options were never read by the scheduling logic, so they are gone too.

import { db, collection, getDocs } from '../core/firebase.js';
import { getSeasonGames } from '../data/games.js';
import { normalizeGames } from '../domain/standings.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { cap, teamDot } from '../ui/game-shared.js';
import { generate, balanceScore, balanceLabel } from './schedule-gen-core.js';
import { loadDraft, saveDraft, toIso, scheduleCsv, download } from './schedule-draft.js';

const $ = (id) => document.getElementById(id);
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let ctx = null;
let teams = [];        // [{ id, name, isNew, picked }]
let result = null;     // { games, config }

const picked = () => teams.filter(t => t.picked);
const type = () => $('sgType').value;

const INFO = {
  summer: `<strong>Summer, 11 teams.</strong> Opening Day (Sunday): 6 games from 3:45 PM, and the Opening Day DH team plays twice.
    Opening week Mon to Thu: 4 doubleheaders. Weeks 2 to 11: Sun to Thu, 5 doubleheaders a week at 7:45 and 8:45 PM, one team on a bye.
    Week 12: a Sunday doubleheader and 8 weeknight singles. Week 13: 3 Sunday singles. 22 games a team plus Opening Day (127 games).`,
  fall: `<strong>Fall, 10 or 11 teams</strong> on the fixed fall calendar: Sundays Sep 13 to Nov 15 (8 AM to 1 PM) plus weeknights at 7:45 and 8:45 PM.
    13 games a team; with 11 teams one team plays 14 (72 games). Every pair meets once or twice. Double-elimination playoffs follow, championship Dec 6.`
};

// ------------------------------------------------------------------ form

function renderTeams() {
  $('sgTeams').innerHTML = teams.map((t, i) => `<button type="button" class="aces-chip" data-team="${i}" aria-pressed="${t.picked}">${teamDot(t.name)}${esc(t.name)}${t.isNew ? ' <span class="aces-badge is-accent">New</span>' : ''}</button>`).join('');
  $('sgTeamCount').textContent = `${picked().length} picked`;
  renderExtras();
  check();
}

function teamOptions(sel = '', blank = 'Pick a team') {
  return `<option value="">${esc(blank)}</option>${picked().map(t => `<option value="${esc(t.id)}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}`;
}

/** Opening Day rows (summer) and the extra-game team (fall, 11 teams). */
function renderExtras() {
  const n = picked().length;
  const summer = type() === 'summer';
  $('sgOdCard').hidden = !(summer && n === 11);
  if (!$('sgOdCard').hidden) {
    const rows = [...$('sgOd').querySelectorAll('.sg-od-row')].map(r => [r.querySelector('[data-side="home"]').value, r.querySelector('[data-side="away"]').value]);
    $('sgOd').innerHTML = Array.from({ length: 6 }, (_, i) => `<div class="sg-od-row">
      <span class="sg-od-n">G${i + 1}</span>
      <span class="aces-select-wrap"><select class="aces-select" data-side="home" aria-label="Game ${i + 1} home">${teamOptions(rows[i]?.[0], 'Home')}</select></span>
      <span class="sse-dim">vs</span>
      <span class="aces-select-wrap"><select class="aces-select" data-side="away" aria-label="Game ${i + 1} away">${teamOptions(rows[i]?.[1], 'Away')}</select></span>
    </div>`).join('');
  }
  $('sgExtraCard').hidden = !(type() === 'fall' && n === 11);
  if (!$('sgExtraCard').hidden) $('sgExtra').innerHTML = teamOptions($('sgExtra').value);
}

/** Opening Day check: { ok, msg, matchups, dhTeam }. */
function readOd() {
  const all = picked();
  const rows = [...$('sgOd').querySelectorAll('.sg-od-row')].map(r => [r.querySelector('[data-side="home"]').value, r.querySelector('[data-side="away"]').value]);
  if (rows.some(([h, a]) => !h || !a)) return { ok: false, msg: 'Fill in all six Opening Day games.' };
  if (rows.some(([h, a]) => h === a)) return { ok: false, msg: 'A team is playing itself on Opening Day.' };
  const used = {};
  rows.flat().forEach(id => { used[id] = (used[id] || 0) + 1; });
  const name = (id) => all.find(t => t.id === id)?.name || id;
  const thrice = Object.keys(used).filter(id => used[id] > 2);
  if (thrice.length) return { ok: false, msg: `${thrice.map(name).join(', ')} is in more than two games.` };
  const twice = Object.keys(used).filter(id => used[id] === 2);
  if (twice.length !== 1) return { ok: false, msg: twice.length ? `Only one team can play twice (${twice.map(name).join(', ')}).` : 'One team has to play twice: that is the Opening Day DH team.' };
  const missing = all.filter(t => !used[t.id]).map(t => t.name);
  if (missing.length) return { ok: false, msg: `Missing: ${missing.join(', ')}.` };
  return {
    ok: true,
    msg: `${name(twice[0])} is the Opening Day DH team: plays twice, sits Monday to Thursday of opening week.`,
    matchups: rows.map(([h, a]) => ({ home: all.find(t => t.id === h), away: all.find(t => t.id === a) })),
    dhTeam: twice[0]
  };
}

/** Why Generate is off, or '' when it can run. */
function check() {
  const n = picked().length;
  const t = type();
  $('sgInfo').innerHTML = INFO[t];
  document.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== t; });
  let why = '';
  if (t === 'summer' && n !== 11) why = `Summer needs 11 teams (${n} picked).`;
  else if (t === 'fall' && n !== 10 && n !== 11) why = `Fall needs 10 or 11 teams (${n} picked).`;
  else if (t === 'summer' && !$('sgStart').value) why = 'Set the Opening Day date.';
  if (!$('sgOdCard').hidden) {
    const od = readOd();
    $('sgOdMsg').textContent = od.msg;
    $('sgOdMsg').className = `sg-od-msg ${od.ok ? 'is-ok' : 'is-bad'}`;
    if (!why && !od.ok) why = 'Finish the Opening Day match-ups.';
  }
  $('sgWhy').textContent = why;
  $('sgGo').disabled = !!why;
  return !why;
}

// ------------------------------------------------------------------ generate

function run() {
  if (!check()) return;
  const t = type();
  const config = {
    seasonType: t,
    seasonYear: parseInt($('sgYear').value, 10) || new Date().getFullYear(),
    selectedTeams: picked().map(({ id, name, isNew }) => ({ id, name, isNew })),
    startDate: $('sgStart').value,
    skipTeacherConvention: t === 'fall' && $('sgSkipTC').checked,
    fallExtraTeamId: t === 'fall' ? ($('sgExtra').value || null) : null
  };
  if (!$('sgOdCard').hidden) {
    const od = readOd();
    config.openingDayMatchups = od.matchups;
    config.openingDayDHTeam = od.dhTeam;
  }
  try {
    // The scheduling logic is random and some runs leave games unplaced (a team
    // a game or two short), so try up to 40 times and keep the fullest run.
    let best = null;
    for (let i = 0; i < 40; i++) {
      const { games } = generate(config);
      if (!games.length || games.some(g => !(g.date instanceof Date))) throw new Error('The generator returned games without dates.');
      const per = {};
      games.forEach(g => { per[g.home.id] = (per[g.home.id] || 0) + 1; per[g.away.id] = (per[g.away.id] || 0) + 1; });
      const counts = Object.values(per);
      const rank = games.length * 100 - (Math.max(...counts) - Math.min(...counts));
      if (!best || rank > best.rank) best = { games, rank, tries: i + 1 };
      if (games.length >= (config.seasonType === 'summer' ? 127 : config.selectedTeams.length === 11 ? 72 : 65)) break;
    }
    const { games } = best;
    result = { games, config, tries: best.tries };
    renderResult();
    $('sgResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error('[generate]', err);
    showToast(err.message || String(err), 'error');
  }
}

function note(g) {
  if (g.isOpeningDay) return '<span class="aces-badge is-accent">Opening Day</span>';
  if (g.isFinalWeek) return '<span class="aces-badge is-outline">Final week</span>';
  if (g.isDoubleHeader) return `<span class="sse-dim">DH${g.dhGame ? ` ${g.dhGame}` : ''}</span>`;
  if (g.isWeeknight || g.isExtra) return '<span class="sse-dim">Weeknight</span>';
  return '';
}

function renderResult() {
  const { games, config } = result;
  const ts = config.selectedTeams;
  const by = Object.fromEntries(ts.map(t => [t.id, { name: t.name, home: 0, away: 0 }]));
  games.forEach(g => { by[g.home.id].home++; by[g.away.id].away++; });
  const rows = Object.values(by).sort((a, b) => a.name.localeCompare(b.name));
  const counts = rows.map(r => r.home + r.away);
  const lo = Math.min(...counts), hi = Math.max(...counts);
  const weeks = Math.max(...games.map(g => g.week || 0));
  const score = balanceScore(games, ts);
  $('sgResultTitle').textContent = `${config.seasonYear} ${cap(config.seasonType)}: ${games.length} games`;
  $('sgTiles').innerHTML = [
    [games.length, 'Games'], [weeks || '-', 'Weeks'], [lo === hi ? lo : `${lo}-${hi}`, 'Games per team'], [`${score}%`, `Home/away: ${balanceLabel(score)}`]
  ].map(([v, l]) => `<div class="aces-stat"><span class="aces-stat-value">${esc(v)}</span><span class="aces-stat-label">${esc(l)}</span></div>`).join('');
  $('sgTeamTable').innerHTML = `<thead><tr><th scope="col">Team</th><th scope="col" class="is-num">Games</th><th scope="col" class="is-num">Home</th><th scope="col" class="is-num">Away</th></tr></thead>
    <tbody>${rows.map(r => {
      const n = r.home + r.away;
      return `<tr><td>${teamDot(r.name)}${esc(r.name)}</td><td class="is-num">${n}${n < hi ? ' <span class="aces-badge is-alert">Short</span>' : ''}</td><td class="is-num">${r.home}</td><td class="is-num">${r.away}${Math.abs(r.home - r.away) > 1 ? ' <span class="aces-badge is-alert">Uneven</span>' : ''}</td></tr>`;
    }).join('')}</tbody>`;
  $('sgGames').innerHTML = `<thead><tr><th scope="col" class="is-num">Wk</th><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Home</th><th scope="col">Away</th><th scope="col"></th></tr></thead>
    <tbody>${games.map(g => `<tr><td class="is-num">${g.week}</td><td class="u-nowrap">${DAY[g.date.getDay()]} ${g.date.getMonth() + 1}/${g.date.getDate()}</td><td class="u-nowrap">${esc(g.time)}</td>
      <td>${teamDot(g.home.name)}${esc(g.home.name)}</td><td>${teamDot(g.away.name)}${esc(g.away.name)}</td><td>${note(g)}</td></tr>`).join('')}</tbody>`;
  $('sgResult').hidden = false;
}

const draftOf = () => ({
  seasonType: result.config.seasonType,
  year: result.config.seasonYear,
  games: result.games.map(g => ({ week: g.week, iso: toIso(g.date), time: g.time, home: g.home.name, away: g.away.name })),
  newTeams: result.config.selectedTeams.filter(t => t.isNew).map(t => t.name)
});

async function toWorkshop() {
  if (!result) return;
  const old = loadDraft();
  if (old?.games?.length && !(await confirmModal(`The Workshop already has a ${old.year} ${cap(old.seasonType)} schedule (${old.games.length} games). Replace it with this one?`, { confirmLabel: 'Replace' }))) return;
  if (!saveDraft(draftOf())) showToast('This browser is blocking storage, so the Workshop copy lasts only until you leave the page.', 'warning');
  ctx.goTab('workshop');
}

// ------------------------------------------------------------------ mount

async function loadTeams() {
  const sid = ctx.config?.currentSeasonId;
  const [snap, games] = await Promise.all([getDocs(collection(db, 'teams')), sid ? getSeasonGames(sid).catch(() => []) : []]);
  const playing = new Set(normalizeGames(games).flatMap(g => [g.home, g.away]).map(t => String(t).toLowerCase()));
  teams = snap.docs.map(d => ({ id: d.id, name: d.data().name || cap(d.id) }))
    .filter(t => t.id !== 'kings' && t.name.toLowerCase() !== 'kings')
    .map(t => ({ ...t, isNew: false, picked: playing.has(t.id.toLowerCase()) || playing.has(t.name.toLowerCase()) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function addTeam() {
  const name = $('sgNewTeam').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (teams.some(t => t.name.toLowerCase() === name.toLowerCase())) { showToast(`${name} is already listed.`, 'warning'); return; }
  teams.push({ id: `new-${name.toLowerCase().replace(/\s+/g, '-')}`, name, isNew: true, picked: true });
  teams.sort((a, b) => a.name.localeCompare(b.name));
  $('sgNewTeam').value = '';
  renderTeams();
  showToast(`Added ${name}. Add it to the teams list before Season setup so it can be picked there.`, 'info');
}

export async function mount(c) {
  ctx = c;
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  $('sgYear').value = year;
  $('sgStart').value = `${year}-04-24`;
  $('sgType').value = now.getMonth() >= 6 || now.getMonth() < 3 ? 'summer' : 'fall';
  $('sgYear').addEventListener('change', () => { $('sgStart').value = `${parseInt($('sgYear').value, 10) || year}-04-24`; check(); });
  ['sgType', 'sgStart', 'sgSkipTC', 'sgExtra'].forEach(id => $(id).addEventListener('change', () => { if (id === 'sgType') renderExtras(); check(); }));
  $('sgTeams').addEventListener('click', (e) => {
    const b = e.target.closest('[data-team]');
    if (!b) return;
    const t = teams[Number(b.dataset.team)];
    t.picked = !t.picked;
    renderTeams();
  });
  $('sgAll').addEventListener('click', () => { teams.forEach(t => { t.picked = true; }); renderTeams(); });
  $('sgNone').addEventListener('click', () => { teams.forEach(t => { t.picked = false; }); renderTeams(); });
  $('sgAddTeam').addEventListener('click', addTeam);
  $('sgNewTeam').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTeam(); } });
  $('sgOd').addEventListener('change', check);
  $('sgGo').addEventListener('click', run);
  $('sgAgain').addEventListener('click', run);
  $('sgCsv').addEventListener('click', () => result && download(`${result.config.seasonYear}-${result.config.seasonType}-schedule.csv`, scheduleCsv(draftOf().games)));
  $('sgToWorkshop').addEventListener('click', toWorkshop);
  try { await loadTeams(); }
  catch (err) { $('sgTeams').innerHTML = `<p class="aces-empty">Could not load teams: ${esc(err.message || err)}</p>`; return; }
  renderTeams();
}
