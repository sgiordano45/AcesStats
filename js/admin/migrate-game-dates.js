// js/admin/migrate-game-dates.js
// admin/migrate-game-dates.html: one-time conversion of game dates stored as a
// plain {seconds, nanoseconds} map into real Firestore Timestamps.
//
//   playerStats/{id}/games/*     gameDate
//   pitchingStats/{id}/games/*   gameDate
//   hitStreaks/*                 startDate, endDate, currentStreakStart
//   careerHighs/*                gameDate
//
// Scan first (no writes), then Convert. Updates touch only the date fields (not
// lastModified), so the create-only Cloud Function triggers do not fire. A JSON
// file of the old values downloads before any write. Re-running is safe: values
// that are already Timestamps are skipped.

import { initPage, pageReady } from '../core/app.js';
import { db, collection, getDocs, writeBatch } from '../core/firebase.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { mountAdminShell } from './shell.js';
import { toStatId } from '../domain/player-id.js';
import { toTimestampDate } from '../domain/dates.js';

const $ = (id) => document.getElementById(id);
const BATCH = 400;
const PARALLEL = 8;

let fixes = [];      // [{ path, ref, fields: { name: Date }, old: { name: {seconds, nanoseconds} }, label }]
let scanned = null;  // counts for the summary

// A map (not a Timestamp, which has toDate) with numeric seconds.
const isPlainMap = (v) => !!v && typeof v === 'object' && typeof v.toDate !== 'function' && typeof v.seconds === 'number';

function collectFixes(snap, label, fieldNames, out) {
  let docs = 0;
  snap.forEach(d => {
    docs++;
    const data = d.data();
    const fields = {}, old = {};
    fieldNames.forEach(f => {
      if (isPlainMap(data[f])) {
        const date = toTimestampDate(data[f]);
        if (date) { fields[f] = date; old[f] = { seconds: data[f].seconds, nanoseconds: data[f].nanoseconds || 0 }; }
      }
    });
    if (Object.keys(fields).length) out.push({ path: d.ref.path, ref: d.ref, fields, old, label });
  });
  return docs;
}

async function legacyIds() {
  // Same roster logic as the streak calculator: playerStats parent docs do not
  // exist (only their games subcollections), so the ids come from the totals.
  const snap = await getDocs(collection(db, 'aggregatedPlayerStats'));
  const ids = new Set();
  snap.forEach(d => {
    const p = d.data();
    if (p.migrated) return;
    ids.add(p.isAuthUser && p.linkedPlayer ? toStatId(p.linkedPlayer) : d.id);
  });
  return [...ids];
}

async function scan() {
  const out = [];
  const counts = { playerStats: 0, pitchingStats: 0, hitStreaks: 0, careerHighs: 0 };
  const ids = await legacyIds();
  for (const coll of ['playerStats', 'pitchingStats']) {
    for (let i = 0; i < ids.length; i += PARALLEL) {
      $('mgStatus').textContent = `Scanning ${coll}: ${Math.min(i + PARALLEL, ids.length)} of ${ids.length} players...`;
      const snaps = await Promise.all(ids.slice(i, i + PARALLEL).map(id => getDocs(collection(db, coll, id, 'games')).catch(() => null)));
      snaps.forEach(s => { if (s) counts[coll] += collectFixes(s, coll, ['gameDate'], out); });
    }
  }
  $('mgStatus').textContent = 'Scanning hitStreaks and careerHighs...';
  counts.hitStreaks = collectFixes(await getDocs(collection(db, 'hitStreaks')), 'hitStreaks', ['startDate', 'endDate', 'currentStreakStart'], out);
  counts.careerHighs = collectFixes(await getDocs(collection(db, 'careerHighs')), 'careerHighs', ['gameDate'], out);
  return { out, counts };
}

function render() {
  const by = {};
  fixes.forEach(f => { by[f.label] = (by[f.label] || 0) + 1; });
  const rows = Object.keys(scanned.counts).map(k =>
    `<tr><td>${esc(k)}</td><td>${scanned.counts[k]}</td><td><strong>${by[k] || 0}</strong></td></tr>`).join('');
  const sample = fixes.slice(0, 8).map(f => {
    const [name] = Object.keys(f.fields);
    return `<li><code>${esc(f.path)}</code> ${esc(name)}: ${esc(new Date(f.old[name].seconds * 1000).toISOString())}</li>`;
  }).join('');
  $('mgResult').innerHTML = `
    <table class="aces-table"><thead><tr><th>Collection</th><th>Docs checked</th><th>Need converting</th></tr></thead><tbody>${rows}</tbody></table>
    <p>${fixes.length ? `<strong>${fixes.length}</strong> documents have a map date.` : 'Nothing to convert. Every date is already a Timestamp.'}</p>
    ${sample ? `<p class="sse-sub">First few:</p><ul>${sample}</ul>` : ''}`;
  $('mgWrite').disabled = !fixes.length;
}

function downloadRollback() {
  const body = fixes.map(f => ({ path: f.path, old: f.old }));
  const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `game-dates-before-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function runScan() {
  $('mgScan').disabled = true; $('mgWrite').disabled = true;
  try {
    const r = await scan();
    fixes = r.out; scanned = r;
    $('mgStatus').textContent = 'Scan complete. Nothing was changed.';
    render();
  } catch (err) {
    $('mgStatus').textContent = '';
    $('mgResult').innerHTML = `<p class="aces-empty">Scan failed: ${esc(err.message || err)}</p>`;
  } finally { $('mgScan').disabled = false; }
}

async function runWrite() {
  if (!fixes.length) return;
  if (!(await confirmModal(`Convert ${fixes.length} map dates to Timestamps? A file of the old values downloads first. Only the date fields change.`, { confirmLabel: 'Convert' }))) return;
  $('mgScan').disabled = true; $('mgWrite').disabled = true;
  try {
    downloadRollback();
    let done = 0;
    for (let i = 0; i < fixes.length; i += BATCH) {
      const batch = writeBatch(db);
      fixes.slice(i, i + BATCH).forEach(f => batch.update(f.ref, f.fields));
      await batch.commit();
      done = Math.min(i + BATCH, fixes.length);
      $('mgStatus').textContent = `Converted ${done} of ${fixes.length}...`;
    }
    showToast(`Converted ${done} dates`, 'success');
    $('mgStatus').textContent = `Converted ${done}. Re-scanning to check...`;
    await runScan();
    $('mgStatus').textContent = fixes.length ? `${fixes.length} still need converting. Run Convert again.` : 'Done. Re-scan found no map dates left.';
  } catch (err) {
    showToast(`Stopped: ${err.message || err}`, 'error');
    $('mgStatus').textContent = `Stopped partway: ${err.message || err}. Scan again to see what is left; re-running is safe.`;
    $('mgScan').disabled = false;
  }
}

async function main() {
  const ctx = await initPage({ title: 'Fix game dates', role: 'admin', deniedMessage: 'This is an admin tool.' });
  if (!ctx?.user) return;
  mountAdminShell(ctx.profile, 'admin/migrate-game-dates.html');
  $('mgScan').addEventListener('click', runScan);
  $('mgWrite').addEventListener('click', runWrite);
  pageReady();
}

main();
