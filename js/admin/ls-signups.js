// js/admin/ls-signups.js
// The Signup import tab of admin/league-staff.html: read the rec department's
// signup list, match each name to a recent player, decide where each goes
// (back to his team, the draft pool, or skip), then push it all into the
// Offseason rosters board (offseasonRosters/current) and log the run to
// rosterImportAudit.
//
// Matching (unchanged from the old League Staff Admin page): names are
// compared with players active in the last two seasons; exact = 100, a known
// nickname with the same last name = 95, otherwise edit-distance similarity
// (+15, capped at 94, when last names match). 95+ is a match, 60-94 is a
// review with up to five candidates, under 60 is a new player.
// offseasonRosters/current.disbandedTeams is saved as teams are toggled.

import { db, collection, doc, getDoc, setDoc, updateDoc, addDoc, serverTimestamp } from '../core/firebase.js';
import { getAllPlayerStatsOptimized } from '../data/player-stats.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { teamDot } from '../ui/game-shared.js';
import { toStatId, statIdOf } from '../domain/player-id.js';

const $ = (id) => document.getElementById(id);
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

const NICKNAMES = {
  mike: ['michael', 'mikey'], bill: ['william', 'billy', 'will'], bob: ['robert', 'bobby', 'rob'],
  tom: ['thomas', 'tommy'], jim: ['james', 'jimmy'], steve: ['steven', 'stephen'], dan: ['daniel', 'danny'],
  joe: ['joseph', 'joey'], chris: ['christopher', 'kris'], matt: ['matthew'], dave: ['david'],
  nick: ['nicholas', 'nic'], tony: ['anthony'], ed: ['edward', 'eddie', 'ted'], pete: ['peter'],
  tim: ['timothy'], ben: ['benjamin', 'benji'], sam: ['samuel', 'sammy'], rick: ['richard', 'ricky', 'dick'],
  greg: ['gregory'], jon: ['jonathan', 'john', 'johnny'], will: ['william', 'bill', 'billy'], casey: ['kc'],
  alex: ['alexander', 'alexandra'], andy: ['andrew'], charlie: ['charles', 'chuck'], fred: ['frederick', 'freddy'],
  hank: ['henry'], jack: ['john', 'jackson'], jake: ['jacob'], jerry: ['gerald', 'jeremy'], josh: ['joshua'],
  ken: ['kenneth', 'kenny'], larry: ['lawrence'], liz: ['elizabeth', 'beth', 'lizzy'], max: ['maxwell', 'maximilian'],
  pat: ['patrick', 'patricia'], phil: ['phillip', 'philip'], ray: ['raymond'], ron: ['ronald', 'ronnie'],
  ted: ['theodore', 'edward'], vic: ['victor'], wes: ['wesley']
};

let ctx = null;
let sheet = null;            // rows from the uploaded file (first row = headers)
let names = [];
let targetSeasons = [];
let offseasonTeams = {};
let disbanded = [];
let rows = [];               // { uploadedName, matchedPlayer, confidence, lastTeam, lastSeason, isNew, isReview, candidates }
let assign = {};             // uploadedName -> { dest: 'keep'|'draft'|'skip'|null, teamName, playerRecord, resolved }
let missing = [];
const log = [];
let filter = 'all';
let search = '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addLog(action, detail) {
  log.push({ timestamp: new Date().toLocaleTimeString(), action, detail });
  $('lsLog').innerHTML = log.slice().reverse().map(l =>
    `<div class="agg-line is-info"><span class="agg-time">${esc(l.timestamp)}</span>[${esc(l.action)}] ${esc(l.detail)}</div>`).join('');
}

function download(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the spreadsheet reader'));
    document.head.appendChild(s);
  });
}

/** The two seasons to compare against, from today's date (as before). */
function seasonsToCompare() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
  if (m <= 4) return [`${y - 1}-fall`, `${y - 1}-summer`];
  if (m <= 8) return [`${y}-summer`, `${y - 1}-fall`];
  return [`${y}-fall`, `${y}-summer`];
}

const normalizeName = (n) => (n ? String(n).toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '') : '');

function areNicknames(a, b) {
  const p1 = a.split(' '), p2 = b.split(' ');
  if (p1.length < 2 || p2.length < 2) return false;
  if (p1[p1.length - 1] !== p2[p2.length - 1]) return false;
  if (p1[0] === p2[0]) return true;
  return Object.entries(NICKNAMES).some(([nick, v]) => { const all = [nick, ...v]; return all.includes(p1[0]) && all.includes(p2[0]); });
}

function levenshtein(a, b) {
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b.charAt(i - 1) === a.charAt(j - 1) ? m[i - 1][j - 1] : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

function matchScore(u, e) {
  if (u === e) return 100;
  if (areNicknames(u, e)) return 95;
  const max = Math.max(u.length, e.length);
  const sim = ((max - levenshtein(u, e)) / max) * 100;
  const p1 = u.split(' '), p2 = e.split(' ');
  if (p1.length >= 2 && p2.length >= 2 && p1[p1.length - 1] === p2[p2.length - 1]) return Math.max(sim, Math.min(sim + 15, 94));
  return Math.round(sim);
}

const lastOf = (player) => {
  const key = Object.keys(player.seasons || {}).sort().reverse()[0] || 'Unknown';
  return { lastSeason: key, lastTeam: player.seasons?.[key]?.team || 'Unknown' };
};

function bestMatch(uploadedName, players) {
  const n = normalizeName(uploadedName);
  const top = players.map(p => ({ player: p, score: matchScore(n, normalizeName(p.name)) }))
    .filter(m => m.score >= 60).sort((a, b) => b.score - a.score).slice(0, 5);
  if (!top.length) return { status: 'new', uploadedName };
  if (top[0].score >= 95) return { status: 'matched', uploadedName, match: top[0].player, confidence: top[0].score, ...lastOf(top[0].player) };
  return { status: 'review', uploadedName, candidates: top.map(m => ({ player: m.player, score: m.score, ...lastOf(m.player) })) };
}

const careerOf = (pr) => ({
  ba: pr?.careerStats?.ba || pr?.ba || null,
  bpi: pr?.careerStats?.acesBPI || pr?.acesBPI || null
});

// ---------------------------------------------------------------------------
// Disbanded teams
// ---------------------------------------------------------------------------

async function loadOffseason() {
  try {
    const snap = await getDoc(doc(db, 'offseasonRosters', 'current'));
    if (snap.exists()) { offseasonTeams = snap.data().teams || {}; disbanded = snap.data().disbandedTeams || []; }
  } catch (err) { console.error('[signups] offseason doc', err); }
  renderDisbanded();
}

function renderDisbanded() {
  const teams = Object.keys(offseasonTeams);
  $('lsDisbanded').innerHTML = teams.length
    ? teams.map(t => `<button type="button" class="ls-chip${disbanded.includes(t) ? ' is-danger' : ''}" data-disband="${esc(t)}" aria-pressed="${disbanded.includes(t)}">${teamDot(t)}${esc(t)}</button>`).join('')
    : '<p class="sse-dim">No teams on the Offseason rosters board yet. Set up the teams there first.</p>';
}

async function toggleDisbanded(team) {
  disbanded = disbanded.includes(team) ? disbanded.filter(t => t !== team) : [...disbanded, team];
  renderDisbanded();
  try {
    await updateDoc(doc(db, 'offseasonRosters', 'current'), { disbandedTeams: disbanded });
    addLog('disbanded', `${team} ${disbanded.includes(team) ? 'marked' : 'unmarked'} as disbanded`);
  } catch { /* no doc yet: saved on push */ }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

async function readFile(file) {
  addLog('upload', `${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  try {
    await loadXlsx();
    const data = new Uint8Array(await file.arrayBuffer());
    const wb = window.XLSX.read(data, { type: 'array' });
    sheet = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    if (sheet.length < 2) { sheet = null; showToast('That file has no rows under the header.', 'error'); return; }
    const headers = sheet[0].map(h => String(h || '').trim());
    $('lsColumn').innerHTML = '<option value="">Choose the column with names...</option>' +
      headers.map((h, i) => `<option value="${i}">${esc(h || `Column ${i + 1}`)}</option>`).join('');
    const guess = headers.findIndex(h => ['name', 'player', 'full name', 'fullname', 'player name', 'playername'].some(p => h.toLowerCase().includes(p)));
    if (guess >= 0) { $('lsColumn').value = String(guess); addLog('auto-detect', `Name column: "${headers[guess]}"`); }
    pickColumn();
    $('lsFileStep').hidden = false;
  } catch (err) {
    console.error('[signups] read', err);
    showToast(`Could not read the file: ${err.message || err}`, 'error');
    addLog('error', `File read: ${err.message || err}`);
  }
}

function pickColumn() {
  const col = parseInt($('lsColumn').value, 10);
  names = !sheet || Number.isNaN(col) ? [] : sheet.slice(1).map(r => r[col]).filter(n => n && String(n).trim()).map(n => String(n).trim());
  $('lsNameCount').textContent = names.length;
  $('lsAnalyze').disabled = !names.length;
}

// ---------------------------------------------------------------------------
// Analyze
// ---------------------------------------------------------------------------

async function analyze() {
  if (!names.length) { showToast('Choose the column with player names.', 'warning'); return; }
  const btn = $('lsAnalyze');
  btn.disabled = true;
  btn.textContent = 'Matching...';
  targetSeasons = seasonsToCompare();
  addLog('analyze', `Matching ${names.length} names against ${targetSeasons.join(' & ')}`);
  try {
    const all = await getAllPlayerStatsOptimized();
    const recent = all.filter(p => Object.keys(p.seasons || {}).some(s => targetSeasons.some(t => s.startsWith(t))));
    addLog('load', `${all.length} players, ${recent.length} active in those seasons`);
    const warnings = [];
    const seen = new Set();
    const results = [];
    for (const n of names) {
      const k = normalizeName(n);
      if (seen.has(k)) { warnings.push(`"${n}" is on the list twice`); continue; }
      seen.add(k);
      results.push(bestMatch(n, recent));
    }
    const uploaded = new Set(names.map(normalizeName));
    missing = recent.filter(p => !uploaded.has(normalizeName(p.name)) && !results.some(r => r.status === 'matched' && r.match?.name === p.name))
      .map(p => ({ name: p.name, ...lastOf(p) }));

    rows = [];
    assign = {};
    for (const r of results) {
      if (r.status === 'matched') {
        rows.push({ uploadedName: r.uploadedName, matchedPlayer: r.match, confidence: r.confidence, lastTeam: r.lastTeam, lastSeason: r.lastSeason, isNew: false, isReview: false });
        assign[r.uploadedName] = disbanded.includes(r.lastTeam)
          ? { dest: 'draft', playerRecord: r.match, lastTeam: r.lastTeam }
          : { dest: 'keep', teamName: r.lastTeam, playerRecord: r.match };
      } else if (r.status === 'review') {
        rows.push({ uploadedName: r.uploadedName, matchedPlayer: null, confidence: null, lastTeam: null, isNew: false, isReview: true, candidates: r.candidates });
        assign[r.uploadedName] = { dest: null };
      } else {
        rows.push({ uploadedName: r.uploadedName, matchedPlayer: null, confidence: null, lastTeam: null, isNew: true, isReview: false });
        assign[r.uploadedName] = { dest: 'draft', playerRecord: null };
      }
    }
    addLog('done', `${results.filter(r => r.status === 'matched').length} matched, ${results.filter(r => r.status === 'review').length} to check, ${results.filter(r => r.status === 'new').length} new, ${missing.length} didn't sign up`);
    showResults(warnings);
  } catch (err) {
    console.error('[signups] analyze', err);
    showToast(`Could not match players: ${err.message || err}`, 'error');
    addLog('error', `Analyze: ${err.message || err}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Match players';
  }
}

function counts() {
  const v = Object.values(assign);
  return { keep: v.filter(a => a.dest === 'keep').length, draft: v.filter(a => a.dest === 'draft').length, skip: v.filter(a => a.dest === 'skip').length, unset: v.filter(a => !a.dest).length };
}

function showResults(warnings) {
  $('lsUpload').hidden = true;
  $('lsResults').hidden = false;
  $('lsCompared').textContent = targetSeasons.join(' and ');
  $('lsWarnings').hidden = !warnings.length;
  $('lsWarnings').innerHTML = warnings.length ? `<div>${warnings.map(esc).join('<br>')}</div>` : '';
  $('lsMissing').hidden = !missing.length;
  $('lsMissingList').innerHTML = missing.map(p => `<li>${teamDot(p.lastTeam)}${esc(p.name)} <span class="sse-dim">${esc(p.lastTeam)}</span></li>`).join('');
  renderAll();
}

function renderAll() {
  renderTiles();
  renderTable();
  renderSummary();
}

function renderTiles() {
  const c = counts();
  const tile = (v, l) => `<div class="aces-stat"><span class="aces-stat-value">${v}</span><span class="aces-stat-label">${esc(l)}</span></div>`;
  $('lsTiles').innerHTML = tile(rows.length, 'Signed up') + tile(c.keep, 'Back on a team') + tile(c.draft, 'Draft pool') + tile(c.unset, 'Need a decision') + tile(missing.length, "Didn't sign up");
}

function renderTable() {
  const c = counts();
  const f = [['all', 'All', rows.length], ['unset', 'Decide', c.unset], ['keep', 'Keeping', c.keep], ['draft', 'Draft pool', c.draft], ['skip', 'Skipping', c.skip]];
  $('lsFilters').innerHTML = f.map(([id, l, n]) => `<button class="aces-segment" type="button" data-filter="${id}" aria-pressed="${filter === id}">${esc(l)} ${n}</button>`).join('');
  const q = search.toLowerCase();
  const shown = rows.filter(r => {
    const d = assign[r.uploadedName]?.dest || null;
    if (q && !r.uploadedName.toLowerCase().includes(q) && !(r.matchedPlayer?.name || '').toLowerCase().includes(q)) return false;
    return filter === 'all' || (filter === 'unset' ? !d : d === filter);
  });
  if (!shown.length) { $('lsRows').innerHTML = '<tr><td colspan="5" class="aces-empty">Nobody matches.</td></tr>'; return; }
  $('lsRows').innerHTML = shown.map(r => {
    const a = assign[r.uploadedName] || { dest: null };
    const i = rows.indexOf(r);
    const conf = r.isNew ? '<span class="aces-badge is-outline">New</span>'
      : r.isReview ? '<span class="aces-badge is-alert">Check</span>'
      : `<span class="aces-badge ${r.confidence >= 95 ? 'is-win' : r.confidence >= 75 ? 'is-alert' : 'is-loss'}">${Math.round(r.confidence)}%</span>`;
    const match = r.isNew ? '<span class="sse-dim">No history</span>'
      : r.isReview ? `<span class="aces-select-wrap"><select class="aces-select ls-cand" data-cand="${i}" aria-label="Pick the match for ${esc(r.uploadedName)}">
          <option value="">Pick the match...</option>
          ${r.candidates.map((cd, ci) => `<option value="${ci}">${esc(cd.player.name)} (${Math.round(cd.score)}%, ${esc(cd.lastTeam)})</option>`).join('')}
          <option value="new">New player (no history)</option>
        </select></span> ${conf}`
      : `${esc(r.matchedPlayer?.name || r.uploadedName)} ${conf}`;
    const team = r.lastTeam
      ? `${teamDot(r.lastTeam)}${esc(r.lastTeam)}${disbanded.includes(r.lastTeam) ? ' <span class="aces-badge is-loss">Disbanded</span>' : ''}`
      : '<span class="sse-dim">-</span>';
    const s = careerOf(r.matchedPlayer);
    const career = r.matchedPlayer ? `<span class="sse-dim">BA ${esc(s.ba ?? '-')} · BPI ${esc(s.bpi ?? '-')}</span>` : '<span class="sse-dim">-</span>';
    const keepTeam = a.teamName || r.lastTeam || '';
    const canKeep = !r.isNew && (!r.isReview || a.resolved);
    const opt = (dest, label) => `<button class="aces-segment" type="button" data-dest="${dest}" data-row="${i}" aria-pressed="${a.dest === dest}">${esc(label)}</button>`;
    return `<tr${a.dest ? '' : ' class="ls-undecided"'}>
      <td><strong>${esc(r.uploadedName)}</strong></td>
      <td>${match}</td>
      <td>${team}</td>
      <td>${career}</td>
      <td><div class="aces-segmented ls-dest" role="group" aria-label="Where ${esc(r.uploadedName)} goes">
        ${canKeep ? opt('keep', keepTeam ? `Keep on ${keepTeam}` : 'Keep') : ''}${opt('draft', 'Draft pool')}${opt('skip', 'Skip')}
      </div></td>
    </tr>`;
  }).join('');
}

function renderSummary() {
  const c = counts();
  $('lsSummary').innerHTML = `<li><strong>${c.keep}</strong> back on their team's roster</li><li><strong>${c.draft}</strong> into the draft pool</li><li><strong>${c.skip}</strong> skipped (not added anywhere)</li>`;
  $('lsUnresolved').hidden = !c.unset;
  $('lsUnresolved').innerHTML = c.unset ? `<div><strong>${c.unset}</strong> ${c.unset === 1 ? 'player still needs' : 'players still need'} a decision. Use the Decide filter to find them.</div>` : '';
  $('lsPush').disabled = c.unset > 0;
}

function setDest(i, dest) {
  const r = rows[i];
  const a = assign[r.uploadedName] || {};
  a.dest = dest;
  if (dest === 'keep') { a.teamName = a.teamName || r.lastTeam; a.playerRecord = a.playerRecord || r.matchedPlayer; }
  assign[r.uploadedName] = a;
  addLog('assign', `${r.uploadedName} -> ${dest}${dest === 'keep' ? ` (${a.teamName})` : ''}`);
  renderAll();
}

function pickCandidate(i, value) {
  const r = rows[i];
  const a = assign[r.uploadedName] || { dest: null };
  if (value === 'new') {
    Object.assign(a, { resolved: null, playerRecord: null, teamName: null, dest: 'draft' });
    addLog('confirm', `${r.uploadedName} is a new player`);
  } else if (value !== '') {
    const c = r.candidates[Number(value)];
    Object.assign(r, { matchedPlayer: c.player, lastTeam: c.lastTeam, lastSeason: c.lastSeason, confidence: c.score, isReview: false });
    Object.assign(a, { resolved: c.player, playerRecord: c.player, teamName: c.lastTeam, dest: disbanded.includes(c.lastTeam) ? 'draft' : 'keep' });
    addLog('confirm', `${r.uploadedName} is ${c.player.name} (${Math.round(c.score)}%)`);
  }
  assign[r.uploadedName] = a;
  setTimeout(renderAll, 0);   // let the dropdown close before the row is redrawn
}

function bulk(kind) {
  let n = 0;
  rows.forEach(r => {
    if (kind === 'keep' && !r.isNew && !r.isReview && r.confidence >= 95 && !disbanded.includes(r.lastTeam)) { assign[r.uploadedName] = { dest: 'keep', teamName: r.lastTeam, playerRecord: r.matchedPlayer }; n++; }
    if (kind === 'new' && r.isNew) { assign[r.uploadedName] = { dest: 'draft', playerRecord: null }; n++; }
    if (kind === 'disbanded' && r.lastTeam && disbanded.includes(r.lastTeam)) { assign[r.uploadedName] = { dest: 'draft', playerRecord: r.matchedPlayer, lastTeam: r.lastTeam }; n++; }
  });
  renderAll();
  addLog('bulk', `${kind}: ${n} players`);
  showToast(`${n} ${n === 1 ? 'player' : 'players'} updated`, 'success');
}

// ---------------------------------------------------------------------------
// Push, report, reset
// ---------------------------------------------------------------------------

async function push() {
  const c = counts();
  if (c.unset) { showToast(`${c.unset} players still need a decision.`, 'warning'); return; }
  const keepList = Object.entries(assign).filter(([, a]) => a.dest === 'keep');
  const draftList = Object.entries(assign).filter(([, a]) => a.dest === 'draft');
  if (!(await confirmModal(`Push ${keepList.length} players onto their teams and ${draftList.length} into the draft pool? Players already on the board are updated in place.`, { title: 'Push to Offseason rosters', confirmLabel: 'Push' }))) return;
  const btn = $('lsPush');
  btn.disabled = true;
  btn.textContent = 'Pushing...';
  const by = ctx.who;
  try {
    const ref = doc(db, 'offseasonRosters', 'current');
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};
    const teams = JSON.parse(JSON.stringify(existing.teams || {}));
    const unassigned = existing.unassignedPlayers || [];
    const now = new Date().toISOString();

    keepList.forEach(([uploadedName, a]) => {
      if (!a.teamName) return;
      if (!teams[a.teamName]) teams[a.teamName] = { players: [], maxRoster: 16 };
      const pr = a.playerRecord;
      const s = careerOf(pr);
      const id = (pr && statIdOf(pr)) || toStatId(uploadedName);
      const player = { id, name: pr?.name || uploadedName, ba: s.ba || '.000', acesBPI: s.bpi || '0.0', source: 'roster-import', importedAt: now };
      const at = teams[a.teamName].players.findIndex(p => p.id === id || p.name === player.name);
      if (at >= 0) teams[a.teamName].players[at] = player; else teams[a.teamName].players.push(player);
    });

    const drafts = draftList.map(([uploadedName, a]) => {
      const pr = a.playerRecord;
      const s = careerOf(pr);
      return {
        id: (pr && statIdOf(pr)) || toStatId(uploadedName),
        name: pr?.name || uploadedName,
        uploadedAs: uploadedName,
        ...(s.ba ? { ba: s.ba } : {}),
        ...(s.bpi ? { acesBPI: s.bpi } : {}),
        isNew: !pr,
        source: 'roster-import',
        importedAt: now,
        importedBy: by,
        ...(a.lastTeam ? { lastTeam: a.lastTeam } : {})
      };
    });
    const have = new Set(unassigned.map(p => p.id));
    const toAdd = drafts.filter(p => !have.has(p.id));
    const dupes = drafts.length - toAdd.length;
    if (dupes) addLog('warning', `${dupes} already in the draft pool, left as they were`);

    const payload = {
      teams,
      unassignedPlayers: [...unassigned, ...toAdd],
      disbandedTeams: disbanded,
      lastImport: serverTimestamp(),
      lastImportBy: by,
      lastImportSummary: { kept: keepList.length, draftAdded: toAdd.length, disbandedTeams: disbanded }
    };
    if (snap.exists()) await updateDoc(ref, payload);
    else await setDoc(ref, { ...payload, seasonType: 'fall-to-summer', createdAt: serverTimestamp(), createdBy: ctx.user.uid });

    await addDoc(collection(db, 'rosterImportAudit'), {
      timestamp: serverTimestamp(),
      performedBy: ctx.user.uid,
      performedByName: by,
      comparedSeasons: targetSeasons,
      disbandedTeams: disbanded,
      summary: { kept: keepList.length, draftAdded: toAdd.length, skippedDupes: dupes, missing: missing.length },
      keptPlayers: keepList.map(([n, a]) => ({ name: a.playerRecord?.name || n, team: a.teamName })),
      draftPlayers: toAdd.map(p => ({ name: p.name, isNew: p.isNew, lastTeam: p.lastTeam || null })),
      missingPlayers: missing.map(p => p.name),
      auditLog: log
    });
    addLog('push', `Pushed ${keepList.length} to teams, ${toAdd.length} to the draft pool`);
    showToast(`Pushed: ${keepList.length} on teams, ${toAdd.length} in the draft pool`, 'success', { action: { label: 'Open the board', onClick: () => { location.href = '../offseason-roster.html'; } } });
  } catch (err) {
    console.error('[signups] push', err);
    showToast(`Push failed: ${err.message || err}`, 'error');
    addLog('error', `Push: ${err.message || err}`);
  } finally {
    btn.textContent = 'Push to Offseason rosters';
    renderSummary();
  }
}

function report() {
  download(JSON.stringify({
    generatedAt: new Date().toISOString(),
    generatedBy: ctx.who,
    comparedSeasons: targetSeasons,
    disbandedTeams: disbanded,
    assignments: Object.entries(assign).map(([n, a]) => ({ uploadedName: n, destination: a.dest, teamName: a.teamName || null, matchedPlayer: a.playerRecord?.name || null })),
    missing,
    auditLog: log
  }, null, 2), 'roster-import-report.json', 'application/json');
  addLog('export', 'Downloaded the report');
}

async function reset() {
  if (rows.length && !(await confirmModal('Clear the matches and start over?', { confirmLabel: 'Start over' }))) return;
  sheet = null; names = []; rows = []; assign = {}; missing = []; filter = 'all'; search = '';
  $('lsSearch').value = '';
  $('lsFile').value = '';
  $('lsColumn').innerHTML = '';
  $('lsNameCount').textContent = '0';
  $('lsFileStep').hidden = true;
  $('lsResults').hidden = true;
  $('lsUpload').hidden = false;
  addLog('reset', 'Started over');
}

export async function mount(c) {
  ctx = c;
  const panel = document.querySelector('[data-panel="signups"]');
  const drop = $('lsDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('lsFile').addEventListener('change', (e) => { if (e.target.files[0]) readFile(e.target.files[0]); });
  $('lsColumn').addEventListener('change', pickColumn);
  $('lsSearch').addEventListener('input', (e) => { search = e.target.value; renderTable(); });
  panel.addEventListener('change', (e) => { const s = e.target.closest('[data-cand]'); if (s) pickCandidate(Number(s.dataset.cand), s.value); });
  panel.addEventListener('click', (e) => {
    const d = e.target.closest('[data-disband]');
    if (d) { toggleDisbanded(d.dataset.disband); return; }
    const dest = e.target.closest('[data-dest]');
    if (dest) { setDest(Number(dest.dataset.row), dest.dataset.dest); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; renderTable(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'signup-analyze') analyze();
    if (act === 'signup-reset') reset();
    if (act === 'signup-bulk-keep') bulk('keep');
    if (act === 'signup-bulk-new') bulk('new');
    if (act === 'signup-bulk-disbanded') bulk('disbanded');
    if (act === 'signup-push') push();
    if (act === 'signup-report') report();
    if (act === 'signup-missing-copy') navigator.clipboard.writeText(missing.map(p => `${p.name} (${p.lastTeam})`).join('\n')).then(() => showToast('Names copied', 'success'), () => showToast('Could not copy', 'error'));
    if (act === 'signup-missing-csv') download('Name,Last team,Last season\n' + missing.map(p => `"${p.name}","${p.lastTeam}","${p.lastSeason}"`).join('\n'), 'missing-players.csv', 'text/csv');
  });
  $('lsAnalyze').disabled = true;
  await loadOffseason();
}
