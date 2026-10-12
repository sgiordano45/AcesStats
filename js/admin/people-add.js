// js/admin/people-add.js
// Add players tab of admin/people.html: player records for people with no
// account yet (moved from the old Content admin's Users tab, same docs).
//
// Each player gets, under an ID made from the name (lowercase, spaces to _,
// nothing but a-z 0-9 _):
//   users/{id}                  { displayName, name, linkedTeam, userType: 'player',
//                                 role: 'player', isPlaceholder: true, createdAt,
//                                 createdBy, email? }
//   aggregatedPlayerStats/{id}  { name, currentTeam, seasons: { [season]: { team,
//                                 games: 0 } }, career: { games: 0 },
//                                 isPlaceholder: true, createdAt, email? }
//   rosters/{season}-{team}     players += { authId: '', bats: '-', captain: false,
//                                 id, name, number: null, position: '-', throws: '-' }
//
// An ID that already has a users doc or a stats record is skipped, so existing
// stats are never overwritten. The season is the site's current season.

import { db, collection, doc, getDoc, getDocs, setDoc, updateDoc, arrayUnion, serverTimestamp } from '../core/firebase.js';
import { getSeasonGames } from '../data/games.js';
import { normalizeGames } from '../domain/standings.js';
import { seasonLabel } from '../domain/season-ids.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { cap, teamDot } from '../ui/game-shared.js';

const $ = (id) => document.getElementById(id);
const toId = (name) => String(name || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

let S = null;          // shared context from people.js
let season = '';
let teams = [];        // display names, this season's teams
let bulk = [];         // [{ name, id, team, taken }]
let idEdited = false;

async function loadTeams() {
  const [tSnap, games] = await Promise.all([
    getDocs(collection(db, 'teams')).catch(() => null),
    season ? getSeasonGames(season).catch(() => []) : []
  ]);
  // Only this season's teams (the teams collection keeps retired ones, like Kings and White).
  const playing = new Set(normalizeGames(games).flatMap(g => [g.home, g.away]).map(t => String(t).toLowerCase()));
  teams = (tSnap?.docs || []).map(d => ({ id: d.id, name: d.data().name || cap(d.id) }))
    .filter(t => !playing.size || playing.has(String(t.id).toLowerCase()) || playing.has(String(t.name).toLowerCase()))
    .map(t => t.name)
    .sort((a, b) => a.localeCompare(b));
  const options = teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('paTeam').innerHTML = `<option value="">Pick a team</option>${options}`;
  $('paBulkTeam').innerHTML = `<option value="">Pick a team</option>${options}`;
  $('paListTeam').innerHTML = `<option value="">All teams</option>${options}`;
}

/** True when the ID already has a users doc or a stats record. */
async function taken(id) {
  const [u, s] = await Promise.all([getDoc(doc(db, 'users', id)), getDoc(doc(db, 'aggregatedPlayerStats', id))]);
  return u.exists() || s.exists();
}

async function create({ name, id, team, email }) {
  const extra = email ? { email } : {};
  await setDoc(doc(db, 'users', id), {
    displayName: name, name, linkedTeam: team, userType: 'player', role: 'player',
    isPlaceholder: true, createdAt: serverTimestamp(), createdBy: S.user.uid, ...extra
  });
  await setDoc(doc(db, 'aggregatedPlayerStats', id), {
    name, currentTeam: team, seasons: { [season]: { team, games: 0 } }, career: { games: 0 },
    isPlaceholder: true, createdAt: serverTimestamp(), ...extra
  });
  const rosterRef = doc(db, 'rosters', `${season}-${team.toLowerCase()}`);
  const entry = { authId: '', bats: '-', captain: false, id, name, number: null, position: '-', throws: '-' };
  if ((await getDoc(rosterRef)).exists()) await updateDoc(rosterRef, { players: arrayUnion(entry) });
  else await setDoc(rosterRef, { players: [entry], seasonId: season, teamId: team.toLowerCase() });
}

async function addOne() {
  const name = $('paName').value.trim().replace(/\s+/g, ' ');
  const team = $('paTeam').value;
  const id = toId($('paId').value || name);
  const email = $('paEmail').value.trim();
  if (!name || !team) { showToast('Add the name and team.', 'warning'); return; }
  if (!id) { showToast('That name makes an empty ID.', 'warning'); return; }
  const btn = $('paAdd');
  btn.disabled = true;
  try {
    if (await taken(id)) { showToast(`${id} already exists. Check Members or Records before adding again.`, 'error'); return; }
    await create({ name, id, team, email });
    showToast(`Added ${name} to ${team}`, 'success');
    $('paName').value = ''; $('paId').value = ''; $('paEmail').value = '';
    idEdited = false;
    await S.refreshAll();
    window.dispatchEvent(new Event('people:changed'));
  } catch (err) { showToast(`Could not add: ${err.message || err}`, 'error'); }
  finally { btn.disabled = false; }
}

async function previewBulk() {
  const team = $('paBulkTeam').value;
  const names = [...new Set($('paBulkNames').value.split('\n').map(n => n.trim().replace(/\s+/g, ' ')).filter(Boolean))];
  if (!team) { showToast('Pick a team.', 'warning'); return; }
  if (!names.length) { showToast('Add some names, one per line.', 'warning'); return; }
  $('paBulkOut').innerHTML = '<p class="sse-dim">Checking...</p>';
  bulk = await Promise.all(names.map(async name => {
    const id = toId(name);
    return { name, id, team, taken: !id || await taken(id) };
  }));
  const fresh = bulk.filter(b => !b.taken).length;
  $('paBulkOut').innerHTML = `<p class="pp-count">${fresh} new, ${bulk.length - fresh} already exist${bulk.length - fresh === 1 ? 's' : ''} and will be skipped.</p>
    <div class="aces-table-wrap"><table class="aces-table is-compact">
      <thead><tr><th scope="col">Name</th><th scope="col">ID</th><th scope="col">Team</th><th scope="col"></th></tr></thead>
      <tbody>${bulk.map(b => `<tr><td>${esc(b.name)}</td><td class="pa-mono">${esc(b.id || '-')}</td><td>${teamDot(b.team)}${esc(b.team)}</td>
        <td>${b.taken ? '<span class="aces-badge is-outline">Skip, exists</span>' : '<span class="aces-badge is-win">New</span>'}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="sse-actions"><button class="aces-btn is-primary" type="button" id="paBulkGo"${fresh ? '' : ' disabled'}>Add ${fresh} player${fresh === 1 ? '' : 's'}</button>
      <button class="aces-btn is-ghost" type="button" id="paBulkCancel">Cancel</button></div>`;
}

async function runBulk() {
  const todo = bulk.filter(b => !b.taken);
  if (!todo.length) return;
  if (!(await confirmModal(`Add ${todo.length} player${todo.length === 1 ? '' : 's'} to ${todo[0].team} for ${seasonLabel(season)}?`, { confirmLabel: 'Add' }))) return;
  $('paBulkGo').disabled = true;
  let done = 0, skipped = 0, failed = 0;
  for (const b of todo) {
    try {
      if (await taken(b.id)) { skipped++; continue; }
      await create(b);
      done++;
    } catch (err) { console.error(`[people-add] ${b.name}`, err); failed++; }
  }
  showToast(`Added ${done}${skipped ? `, skipped ${skipped}` : ''}${failed ? `, ${failed} failed (see console)` : ''}`, failed ? 'warning' : 'success');
  bulk = [];
  $('paBulkOut').innerHTML = '';
  $('paBulkNames').value = '';
  await S.refreshAll();
  window.dispatchEvent(new Event('people:changed'));
}

async function renderList() {
  const all = (await S.users()).filter(u => u.isPlaceholder === true && !u.migrated)
    .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')));
  const q = $('paFind').value.trim().toLowerCase();
  const team = $('paListTeam').value;
  const list = all.filter(u => (!q || `${u.displayName || ''} ${u.id}`.toLowerCase().includes(q)) && (!team || String(u.linkedTeam || '').toLowerCase() === team.toLowerCase()));
  $('paListCount').textContent = `${list.length} of ${all.length}`;
  $('paList').innerHTML = list.length
    ? `<div class="aces-table-wrap"><table class="aces-table is-compact">
        <thead><tr><th scope="col">Player</th><th scope="col">Team</th><th scope="col">ID</th><th scope="col">Email</th></tr></thead>
        <tbody>${list.map(u => `<tr><td>${esc(u.displayName || u.name || '-')}</td><td>${u.linkedTeam ? `${teamDot(u.linkedTeam)}${esc(u.linkedTeam)}` : '-'}</td>
          <td class="pa-mono">${esc(u.id)}</td><td>${esc(u.email || '-')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="aces-empty">None match.</p>';
}

export async function mount(shared) {
  S = shared;
  season = S.config?.currentSeasonId || '';
  $('paSeason').textContent = season ? seasonLabel(season) : 'the current season';
  if (!season) $('paNoSeason').hidden = false;
  await loadTeams();
  $('paName').addEventListener('input', () => { if (!idEdited) $('paId').value = toId($('paName').value); });
  $('paId').addEventListener('input', () => { idEdited = !!$('paId').value; });
  $('paAdd').addEventListener('click', addOne);
  $('paBulkPreview').addEventListener('click', () => previewBulk().catch(err => showToast(`Could not check: ${err.message || err}`, 'error')));
  $('paBulkOut').addEventListener('click', (e) => {
    if (e.target.closest('#paBulkGo')) runBulk();
    if (e.target.closest('#paBulkCancel')) { bulk = []; $('paBulkOut').innerHTML = ''; }
  });
  $('paFind').addEventListener('input', renderList);
  $('paListTeam').addEventListener('change', renderList);
  await renderList();
}

/** people.js calls this after any save or Refresh. */
export function refresh() { return renderList(); }
