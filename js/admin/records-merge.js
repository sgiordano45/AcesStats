// js/admin/records-merge.js
// The Merge records tab of admin/records.html. It replaced the merge in User
// management and the one-off Move player docs page: move (or copy) a
// player's stat docs from one or more IDs into another.
//
//   playerStats/{id}/games, playerStats/{id}/seasons,
//   pitchingStats/{id}/games, pitchingStats/{id}/seasons
//
// Game and season stats always live under legacy IDs (snake_case names), so
// the "Into" ID is the target record's legacy ID: mergedFromProfile, else
// its linked player's name as an ID, else the record's own ID. It is shown
// and can be edited before anything is written.
//
// Safer than the old merge: the preview lists every doc that already exists
// in the target (same game or season); those are skipped and left in place,
// so the target's copy is never overwritten (the old merge overwrote it while
// its preview said it was kept). Copied docs get mergedFrom/mergedAt, and
// playerId is set to the target ID when the doc has one (as Move player docs
// did). Optionally the old aggregatedPlayerStats doc is marked migrated.

import { db, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } from '../core/firebase.js';
import { siteUrl } from '../core/app.js';
import { escapeHtml as esc, fmtAvg } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { teamDot } from '../ui/game-shared.js';

const $ = (id) => document.getElementById(id);
const lower = (s) => String(s || '').toLowerCase();
const PARTS = [
  ['rmBatGames', 'playerStats', 'games', 'Batting games'],
  ['rmBatSeasons', 'playerStats', 'seasons', 'Batting seasons'],
  ['rmPitGames', 'pitchingStats', 'games', 'Pitching games'],
  ['rmPitSeasons', 'pitchingStats', 'seasons', 'Pitching seasons']
];

let ctx = null;
let records = [];        // aggregatedPlayerStats docs (+ IDs found by Check)
let from = [];           // record ids
let into = '';           // record id
let plan = null;         // preview result
let view = 'search';     // 'search' | 'dupes'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `agg-line is-${type}`;
  const t = document.createElement('span');
  t.className = 'agg-time';
  t.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  line.append(t, document.createTextNode(msg));
  $('rmLog').prepend(line);
}

const nameOf = (r) => r.name || r.displayName || r.id;
const isUid = (id) => id.length > 20 && !id.includes('_');
const legacyFromName = (n) => lower(n).replace(/\./g, '').replace(/'/g, '').trim().replace(/\s+/g, '_');

/** The ID a record's stat docs live under. */
function statIdOf(r) {
  if (!r) return '';
  if (!isUid(r.id)) return r.id;
  return r.mergedFromProfile || r.legacyId || (r.linkedPlayer ? legacyFromName(r.linkedPlayer) : r.id);
}

async function loadRecords() {
  const snap = await getDocs(collection(db, 'aggregatedPlayerStats'));
  const extra = records.filter(r => r._checked);
  records = [...snap.docs.map(d => ({ id: d.id, ...d.data() })), ...extra.filter(e => !snap.docs.some(d => d.id === e.id))];
  records.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

// ---------------------------------------------------------------------------
// Finding records
// ---------------------------------------------------------------------------

function recordRow(r) {
  const seasons = Object.keys(r.seasons || {}).length;
  const role = from.includes(r.id) ? 'from' : into === r.id ? 'into' : '';
  const tags = [
    isUid(r.id) ? '<span class="aces-badge is-brand">Account</span>' : '<span class="aces-badge is-outline">Legacy ID</span>',
    r.linkedPlayer ? `<span class="aces-badge">Linked: ${esc(r.linkedPlayer)}</span>` : '',
    r.migrated ? `<span class="aces-badge is-alert">Merged into ${esc(r.migratedTo || '?')}</span>` : '',
    r._checked ? '<span class="aces-badge is-alert">No player record</span>' : ''
  ].join('');
  return `<li class="rc-rec${role ? ` is-${role}` : ''}">
    <div class="rc-rec-main">
      <strong>${r.currentTeam ? teamDot(r.currentTeam) : ''}${esc(nameOf(r))}</strong>
      <code>${esc(r.id)}</code>
      <div class="rc-rec-tags">${tags}</div>
      <small class="sse-dim">${r._checked ? esc(r._summary) : `${seasons} season${seasons === 1 ? '' : 's'} · ${esc(r.career?.games || 0)} G · ${esc(r.career?.hits || 0)} H · ${esc(fmtAvg(r.career?.battingAverage))}`}</small>
    </div>
    <div class="rc-rec-actions">
      <button class="aces-btn is-sm${role === 'from' ? ' is-danger' : ''}" type="button" data-from="${esc(r.id)}" aria-pressed="${role === 'from'}">From</button>
      <button class="aces-btn is-sm${role === 'into' ? ' is-primary' : ''}" type="button" data-into="${esc(r.id)}" aria-pressed="${role === 'into'}">Into</button>
    </div>
  </li>`;
}

function renderList() {
  const q = lower($('rmFind').value.trim());
  const pinned = records.filter(r => from.includes(r.id) || into === r.id);
  let html = '';
  if (view === 'dupes') {
    // Same last name and first initial, not already merged.
    const groups = new Map();
    records.filter(r => !r.migrated).forEach(r => {
      const parts = lower(nameOf(r)).replace(/[^a-z\s]/g, '').trim().split(/\s+/);
      if (parts.length < 2) return;
      const k = `${parts[parts.length - 1]}|${parts[0][0]}`;
      (groups.get(k) || groups.set(k, []).get(k)).push(r);
    });
    const dupes = [...groups.values()].filter(g => g.length > 1);
    html = dupes.length
      ? `<p class="sse-dim">${dupes.length} groups with the same last name and first initial.</p>${dupes.map(g => `<ul class="rc-recs rc-group">${g.map(recordRow).join('')}</ul>`).join('')}`
      : '<p class="aces-empty">No likely duplicates.</p>';
  } else if (q.length >= 2) {
    const hits = records.filter(r => lower(nameOf(r)).includes(q) || lower(r.id).includes(q) || lower(r.linkedPlayer).includes(q)).slice(0, 40);
    html = hits.length ? `<ul class="rc-recs">${hits.map(recordRow).join('')}</ul>` : '<p class="aces-empty">No records match.</p>';
  } else {
    html = '<p class="sse-dim">Type at least two letters of a name or ID.</p>';
  }
  const pinnedHtml = pinned.length && view !== 'dupes' && q.length < 2 ? `<ul class="rc-recs">${pinned.map(recordRow).join('')}</ul>` : '';
  $('rmList').innerHTML = pinnedHtml + html;
}

async function checkId() {
  const id = $('rmCheckId').value.trim();
  if (!id) return;
  const btn = $('rmCheckBtn');
  btn.disabled = true;
  try {
    const counts = await Promise.all(PARTS.map(([, c, sub]) => getDocs(collection(db, c, id, sub)).then(s => s.size).catch(() => 0)));
    const total = counts.reduce((a, b) => a + b, 0);
    const existing = records.find(r => r.id === id);
    log(`Check ${id}: ${PARTS.map(([, , , l], i) => `${l} ${counts[i]}`).join(', ')}${existing ? ' (has a player record)' : ''}`);
    if (!total && !existing) { showToast(`Nothing stored under "${id}".`, 'warning'); return; }
    if (!existing) {
      const name = id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      records.push({ id, name, _checked: true, _summary: PARTS.map(([, , , l], i) => `${l}: ${counts[i]}`).join(' · ') });
    }
    $('rmFind').value = id;
    view = 'search';
    renderList();
    showToast(`Found ${total} stat docs under ${id}`, 'success');
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Plan, preview, run
// ---------------------------------------------------------------------------

function renderPlan() {
  const fromRecs = from.map(id => records.find(r => r.id === id)).filter(Boolean);
  const target = records.find(r => r.id === into);
  $('rmFrom').innerHTML = fromRecs.length
    ? fromRecs.map(r => `<span class="rc-chip">${esc(nameOf(r))} <code>${esc(r.id)}</code><button type="button" class="rc-x" data-unfrom="${esc(r.id)}" aria-label="Remove ${esc(nameOf(r))}">&times;</button></span>`).join('')
    : '<span class="sse-dim">Pick one or more records above (From)</span>';
  $('rmTo').innerHTML = target
    ? `<span class="rc-chip is-into">${esc(nameOf(target))} <code>${esc(target.id)}</code></span>
       <label class="aces-label rc-into-id" for="rmIntoId">Stats go under ID</label>
       <input class="aces-input" id="rmIntoId" type="text" value="${esc(statIdOf(target))}" autocomplete="off" spellcheck="false">`
    : '<span class="sse-dim">Pick the record that keeps the stats (Into)</span>';
  $('rmIntoId')?.addEventListener('input', () => { plan = null; $('rmPreviewOut').innerHTML = ''; });
  $('rmPreview').disabled = !fromRecs.length || !target;
  plan = null;
  $('rmPreviewOut').innerHTML = '';
}

function pick(kindOf, id) {
  if (kindOf === 'from') {
    if (from.includes(id)) from = from.filter(x => x !== id);
    else { from.push(id); if (into === id) into = ''; }
  } else {
    into = into === id ? '' : id;
    from = from.filter(x => x !== into);
  }
  renderList();
  renderPlan();
}

async function preview() {
  const target = $('rmIntoId')?.value.trim();
  const parts = PARTS.filter(([cb]) => $(cb).checked);
  if (!target || !from.length || !parts.length) { showToast('Pick From, Into and at least one kind of stats.', 'warning'); return; }
  const btn = $('rmPreview');
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const targetIds = {};
    await Promise.all(parts.map(async ([, c, sub]) => {
      targetIds[`${c}/${sub}`] = new Set((await getDocs(collection(db, c, target, sub)).catch(() => ({ docs: [] }))).docs.map(d => d.id));
    }));
    const lines = [];
    for (const id of from) {
      const src = statIdOf(records.find(r => r.id === id)) || id;
      if (src === target) { lines.push({ id, src, same: true }); continue; }
      for (const [, c, sub, label] of parts) {
        const snap = await getDocs(collection(db, c, src, sub)).catch(() => ({ docs: [] }));
        const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
        const clash = docs.filter(d => targetIds[`${c}/${sub}`].has(d.id));
        lines.push({ id, src, c, sub, label, docs: docs.filter(d => !targetIds[`${c}/${sub}`].has(d.id)), clash });
      }
    }
    const mode = document.querySelector('input[name="rmMode"]:checked').value;
    plan = { target, lines, mode, mark: $('rmMarkMerged').checked };
    const moving = lines.reduce((n, l) => n + (l.docs?.length || 0), 0);
    const clashes = lines.reduce((n, l) => n + (l.clash?.length || 0), 0);
    $('rmPreviewOut').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact rc-preview">
        <thead><tr><th scope="col">From ID</th><th scope="col">Stats</th><th scope="col" class="is-num">${mode === 'move' ? 'Move' : 'Copy'}</th><th scope="col" class="is-num">Already in target</th></tr></thead>
        <tbody>${lines.map(l => l.same
          ? `<tr><td><code>${esc(l.src)}</code></td><td colspan="3" class="sse-dim">Same ID as the target; skipped.</td></tr>`
          : `<tr><td><code>${esc(l.src)}</code></td><td>${esc(l.label)}</td><td class="is-num">${l.docs.length}</td><td class="is-num">${l.clash.length ? `<strong class="rc-warn">${l.clash.length}</strong>` : 0}</td></tr>`).join('')}</tbody>
      </table></div>
      ${clashes ? `<div class="aces-notice is-warning"><div><strong>${clashes} docs already exist under ${esc(target)}</strong> (same game or season): ${esc(lines.flatMap(l => (l.clash || []).map(d => d.id)).slice(0, 12).join(', '))}${clashes > 12 ? '...' : ''}. They are skipped and the originals stay where they are, so nothing in the target is overwritten. Check them in Game stats if they look like real duplicates.</div></div>` : ''}
      <p class="rc-summary">${moving ? `${mode === 'move' ? 'Move' : 'Copy'} <strong>${moving}</strong> docs into <code>${esc(target)}</code>${mode === 'move' ? ', then delete the originals' : ''}${plan.mark ? ', and mark the old player record merged' : ''}.` : 'Nothing to move.'}</p>
      <div class="sse-actions"><button class="aces-btn is-primary" type="button" id="rmRun"${moving || plan.mark ? '' : ' disabled'}>${mode === 'move' ? 'Move' : 'Copy'} ${moving} docs</button></div>`;
    log(`Preview into ${target}: ${moving} to ${mode}, ${clashes} already in target`);
  } catch (err) {
    console.error('[records] preview', err);
    showToast(`Preview failed: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Preview';
  }
}

async function run() {
  if (!plan) return;
  const { target, lines, mode, mark } = plan;
  const moving = lines.reduce((n, l) => n + (l.docs?.length || 0), 0);
  if (!(await confirmModal(`${mode === 'move' ? 'Move' : 'Copy'} ${moving} stat docs into ${target}?${mode === 'move' ? ' The originals are deleted after each copy.' : ''} Re-aggregate afterwards.`, { title: 'Merge records', danger: mode === 'move', confirmLabel: mode === 'move' ? 'Move' : 'Copy' }))) return;
  const btn = $('rmRun');
  btn.disabled = true;
  btn.textContent = 'Working...';
  let done = 0, failed = 0;
  for (const l of lines) {
    if (l.same || !l.docs?.length) continue;
    for (const d of l.docs) {
      try {
        const data = { ...d.data, mergedFrom: l.src, mergedAt: serverTimestamp() };
        if ('playerId' in d.data) data.playerId = target;
        await setDoc(doc(db, l.c, target, l.sub, d.id), data);
        if (mode === 'move') await deleteDoc(doc(db, l.c, l.src, l.sub, d.id));
        done++;
      } catch (err) {
        failed++;
        log(`Failed ${l.c}/${l.src}/${l.sub}/${d.id}: ${err.message || err}`, 'error');
      }
    }
    log(`${l.label} from ${l.src}: ${l.docs.length} ${mode === 'move' ? 'moved' : 'copied'}${l.clash.length ? `, ${l.clash.length} left (already in target)` : ''}`, 'success');
  }
  if (mark) {
    for (const id of from) {
      const r = records.find(x => x.id === id);
      if (!r || r._checked || r.id === target) continue;
      try {
        const ref = doc(db, 'aggregatedPlayerStats', r.id);
        if ((await getDoc(ref)).exists()) {
          await updateDoc(ref, { migrated: true, migratedTo: target, migratedAt: serverTimestamp() });
          log(`Marked aggregatedPlayerStats/${r.id} merged into ${target}`, 'success');
        }
      } catch (err) { log(`Could not mark ${r.id}: ${err.message || err}`, 'error'); }
    }
  }
  showToast(`${done} docs ${mode === 'move' ? 'moved' : 'copied'}${failed ? `, ${failed} failed (see the log)` : ''}. Run the aggregation next.`, failed ? 'warning' : 'success',
    { duration: 0, action: { label: 'Stats pipeline', onClick: () => { location.href = siteUrl('admin/stats.html'); } } });
  from = []; into = ''; plan = null;
  await loadRecords();
  renderList();
  renderPlan();
}

export async function mount(c) {
  ctx = c;
  const panel = document.querySelector('[data-panel="merge"]');
  panel.addEventListener('click', (e) => {
    const f = e.target.closest('[data-from]');
    if (f) return pick('from', f.dataset.from);
    const i = e.target.closest('[data-into]');
    if (i) return pick('into', i.dataset.into);
    const x = e.target.closest('[data-unfrom]');
    if (x) return pick('from', x.dataset.unfrom);
    if (e.target.closest('#rmRun')) return run();
  });
  $('rmFind').addEventListener('input', () => { view = 'search'; renderList(); });
  $('rmDupes').addEventListener('click', () => { view = view === 'dupes' ? 'search' : 'dupes'; $('rmDupes').textContent = view === 'dupes' ? 'Back to search' : 'Show possible duplicates'; renderList(); });
  $('rmCheckBtn').addEventListener('click', checkId);
  $('rmCheckId').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkId(); });
  $('rmPreview').addEventListener('click', preview);
  panel.querySelectorAll('.rc-opts input').forEach(i => i.addEventListener('change', () => { plan = null; $('rmPreviewOut').innerHTML = ''; }));
  try { await loadRecords(); } catch (err) { $('rmList').innerHTML = `<p class="aces-empty">Could not load player records: ${esc(err.message || err)}</p>`; return; }
  renderList();
  renderPlan();
}
