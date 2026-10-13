// js/admin/people-links.js
// The Links tab of admin/people.html.
//
// Waiting for approval: every pending playerLinkRequests entry, approved or
// denied through data/player-links.js (approvePlayerLink / denyPlayerLink),
// the same calls Approve player links uses, so the link, role and stats
// happen the same way from either page.
//
// Accounts not linked to a player: fan accounts (real sign-ins, not merged,
// no linkedPlayer). Link by hand picks a player from aggregatedPlayerStats
// and does what the old Link players page did: sets the account to that
// player (role player, team, display name), merges a matching legacy users
// doc (captain flag, favorites, bats/throws, position, number, nickname,
// mergedFromProfile) and marks it migrated, then builds the player's stats
// (aggregatePlayerStats).

import { db, collection, doc, getDoc, getDocs, updateDoc, serverTimestamp } from '../core/firebase.js';
import { approvePlayerLink, denyPlayerLink, aggregatePlayerStats } from '../data/player-links.js';
import { escapeHtml as esc, fmtAvg } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal, promptModal } from '../ui/modal.js';
import { teamDot } from '../ui/game-shared.js';
import { statIdOf } from '../domain/player-id.js';

const $ = (id) => document.getElementById(id);
const lower = (s) => String(s || '').toLowerCase();
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const WEEK = 7 * 86400 * 1000;

let ctx = null;
let requests = [];
let fans = [];
let players = null;      // aggregatedPlayerStats, read on first Link
let claimed = new Set();
let fanFilter = 'all';

const when = (v) => {
  const ms = v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : typeof v === 'string' ? Date.parse(v) : 0;
  return ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};
const ms = (v) => (v?.seconds ? v.seconds * 1000 : 0);

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function fromUsers(users) {
  requests = [];
  fans = [];
  claimed = new Set();
  for (const u of users) {
    if (u.linkedPlayer) claimed.add(u.linkedPlayer);
    (u.playerLinkRequests || []).filter(r => r.status === 'pending').forEach(r => requests.push({ userId: u.id, userName: u.displayName, userEmail: u.email, ...r }));
    const realAccount = u.email && u.createdAt && u.id.length > 20 && !u.id.includes('_');
    if (realAccount && u.userRole === 'fan' && !u.linkedPlayer && !u.migrated) fans.push(u);
  }
  requests.sort((a, b) => ms(a.requestedAt) - ms(b.requestedAt));
  fans.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
}

async function loadPlayers() {
  if (players) return players;
  const snap = await getDocs(collection(db, 'aggregatedPlayerStats'));
  players = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.migrated !== true && (p.name || p.displayName))
    .map(p => ({ id: p.id, name: p.name || p.displayName, currentTeam: p.currentTeam || 'Unknown', career: p.career || {} }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return players;
}

/** How close two names are (shared name parts), 0 to 1, as before. */
function similarity(a, b) {
  a = lower(a); b = lower(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const p1 = a.split(/\s+/), p2 = b.split(/\s+/);
  const [short, long] = p1.length <= p2.length ? [p1, p2] : [p2, p1];
  const hits = short.filter(x => long.some(y => y.includes(x) || x.includes(y))).length;
  return hits / Math.max(p1.length, p2.length);
}

// ---------------------------------------------------------------------------
// Pending requests
// ---------------------------------------------------------------------------

const LEVEL = { auto: 'Auto-approve', captain: 'Captain review', staff: 'League staff', 'league-staff': 'League staff' };

function renderRequests() {
  $('plReqCount').textContent = requests.length ? String(requests.length) : '';
  if (!requests.length) { $('plRequests').innerHTML = '<p class="aces-empty">No requests waiting.</p>'; return; }
  $('plRequests').innerHTML = `<ul class="pl-list">${requests.map(r => `<li class="aces-card pl-req">
    <div class="pl-req-main">
      <p class="pl-req-who"><strong>${esc(r.userName || 'No name')}</strong> <span class="sse-dim">${esc(r.userEmail || '')}</span></p>
      <p class="pl-req-what">wants to be ${teamDot(r.teamId)}<strong>${esc(r.playerName || '?')}</strong>${r.teamId ? ` (${esc(cap(r.teamId))})` : ''}</p>
      ${r.reason ? `<p class="pl-req-reason">&ldquo;${esc(r.reason)}&rdquo;</p>` : ''}
      <p class="sse-dim pl-req-meta">${esc([when(r.requestedAt) && `Asked ${when(r.requestedAt)}`, LEVEL[r.approvalLevel] || r.approvalLevel, r.expiresAt && `expires ${when(r.expiresAt)}`].filter(Boolean).join(' · '))}</p>
    </div>
    <div class="pl-req-actions">
      <button class="aces-btn is-sm is-primary" type="button" data-approve="${esc(r.requestId)}">Approve</button>
      <button class="aces-btn is-sm" type="button" data-deny="${esc(r.requestId)}">Deny</button>
    </div>
  </li>`).join('')}</ul>`;
}

async function approve(btn) {
  const r = requests.find(x => x.requestId === btn.dataset.approve);
  if (!r) return;
  if (!(await confirmModal(`Link ${r.userName || r.userEmail} to ${r.playerName}? They become a player on ${cap(r.teamId) || 'that team'} and their stats are built.`, { title: 'Approve link', confirmLabel: 'Approve' }))) return;
  btn.disabled = true;
  btn.textContent = 'Linking...';
  const res = await approvePlayerLink(ctx.user.uid, r.requestId, 'Approved on People');
  if (res?.success) {
    showToast(`Linked to ${res.playerName || r.playerName}`, 'success');
    await done();
  } else {
    showToast(`Could not approve: ${res?.message || res?.error || 'unknown error'}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Approve';
  }
}

async function deny(btn) {
  const r = requests.find(x => x.requestId === btn.dataset.deny);
  if (!r) return;
  const reason = await promptModal(`Why is ${r.userName || r.userEmail}'s request to be ${r.playerName} denied? They see this reason.`, { title: 'Deny link', okLabel: 'Deny', placeholder: 'Reason' });
  if (reason === null) return;
  btn.disabled = true;
  const res = await denyPlayerLink(ctx.user.uid, r.requestId, reason);
  if (res?.success) { showToast('Request denied', 'success'); await done(); }
  else { showToast(`Could not deny: ${res?.message || res?.error || 'unknown error'}`, 'error'); btn.disabled = false; }
}

// ---------------------------------------------------------------------------
// Unlinked accounts
// ---------------------------------------------------------------------------

function renderFans() {
  const q = lower($('plSearch').value.trim());
  const now = Date.now();
  const list = fans.filter(f => {
    if (q && !lower(f.displayName).includes(q) && !lower(f.email).includes(q)) return false;
    if (fanFilter === 'skipped') return !!f.linkingSkipped;
    if (fanFilter === 'pending') return (f.playerLinkRequests || []).some(r => r.status === 'pending');
    if (fanFilter === 'new') return now - ms(f.createdAt) < WEEK;
    return true;
  });
  if (!list.length) { $('plFans').innerHTML = '<p class="aces-empty">No accounts match.</p>'; return; }
  $('plFans').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact pl-fans">
    <thead><tr><th scope="col">Account</th><th scope="col">Signed up</th><th scope="col">Status</th><th scope="col"><span class="u-sr-only">Actions</span></th></tr></thead>
    <tbody>${list.map(f => {
      const pend = (f.playerLinkRequests || []).find(r => r.status === 'pending');
      const how = f.registrationMethod || (f.photoURL ? 'google' : 'email');
      return `<tr>
        <td><strong>${esc(f.displayName || 'No name')}</strong><small class="pp-sub">${esc(f.email || '')}</small></td>
        <td>${esc(when(f.createdAt))} <span class="sse-dim">${esc(cap(how))}</span></td>
        <td>${pend ? `<span class="aces-badge is-alert">Asked for ${esc(pend.playerName)}</span>` : f.linkingSkipped ? '<span class="aces-badge is-outline">Skipped linking</span>' : '<span class="sse-dim">-</span>'}</td>
        <td class="pp-actions"><button class="aces-btn is-sm" type="button" data-link="${esc(f.id)}">Link to a player</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function pickerRows(fan, q) {
  const term = lower(q);
  let list = players.map(p => ({ ...p, taken: claimed.has(p.name), score: similarity(fan.displayName, p.name) }));
  if (term) list = list.filter(p => lower(p.name).includes(term) || lower(p.currentTeam).includes(term));
  list.sort((a, b) => (a.taken - b.taken) || (b.score - a.score) || a.name.localeCompare(b.name));
  list = list.slice(0, 40);
  if (!list.length) return '<p class="aces-empty">No players match.</p>';
  return list.map(p => `<label class="pl-pick${p.taken ? ' is-taken' : ''}">
    <input type="radio" name="plPlayer" value="${esc(p.id)}"${p.taken ? ' disabled' : ''}>
    <span class="pl-pick-name">${teamDot(p.currentTeam)}<strong>${esc(p.name)}</strong>
      ${p.score >= 0.9 ? '<span class="aces-badge is-win">Name match</span>' : p.score >= 0.6 ? '<span class="aces-badge is-alert">Likely</span>' : ''}
      ${p.taken ? '<span class="aces-badge is-outline">Already linked</span>' : ''}</span>
    <span class="sse-dim">${esc(p.currentTeam)} · ${esc(p.career.games || 0)} G · ${esc(fmtAvg(p.career.battingAverage))}</span>
  </label>`).join('');
}

async function linkByHand(fanId) {
  const fan = fans.find(f => f.id === fanId);
  if (!fan) return;
  try { await loadPlayers(); } catch (err) { showToast(`Could not load players: ${err.message || err}`, 'error'); return; }
  let picked = null;
  const value = await openModal({
    title: `Link ${fan.displayName || fan.email}`,
    wide: true,
    html: `<p class="sse-sub">Pick the player record for this account. Closest names are first.</p>
      <input class="aces-input pl-pick-search" type="search" placeholder="Find a player or team" aria-label="Find a player">
      <div class="pl-picker">${pickerRows(fan, '')}</div>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Link', value: 'link', variant: 'primary' }],
    onOpen: (dialog) => {
      const box = dialog.querySelector('.pl-picker');
      dialog.querySelector('.pl-pick-search').addEventListener('input', (e) => { box.innerHTML = pickerRows(fan, e.target.value); });
    },
    beforeClose: (v, dialog) => {
      if (v !== 'link') return true;
      const id = dialog.querySelector('input[name="plPlayer"]:checked')?.value;
      if (!id) { showToast('Pick a player first.', 'warning'); return false; }
      picked = players.find(p => p.id === id);
      return true;
    }
  });
  if (value !== 'link' || !picked) return;
  if (!(await confirmModal(`Link ${fan.displayName || fan.email} to ${picked.name}? Their role becomes player on ${picked.currentTeam}, their display name becomes ${picked.name}, and their stats are built.`, { title: 'Link account', confirmLabel: 'Link' }))) return;
  try {
    await manualLink(fan.id, picked);
    showToast(`Linked ${fan.displayName || fan.email} to ${picked.name}`, 'success');
    await done();
  } catch (err) {
    console.error('[people] link', err);
    showToast(`Could not link: ${err.message || err}`, 'error');
  }
}

/** The old Link players performManualLink, unchanged in what it writes. */
async function manualLink(fanId, player) {
  const me = ctx.user.uid;
  const ref = doc(db, 'users', fanId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Account not found');
  const legacyId = statIdOf(player);   // the picked record's own ID (js/domain/player-id.js)
  let legacy = null;
  try { const l = await getDoc(doc(db, 'users', legacyId)); if (l.exists()) legacy = l.data(); } catch { /* no legacy doc */ }

  const updates = {
    displayName: player.name,
    linkedPlayer: player.name,
    linkedTeam: player.currentTeam,
    userRole: 'player',
    linkingSkipped: false,
    linkedAt: serverTimestamp(),
    linkedBy: me,
    linkedByAdmin: true,
    updatedAt: serverTimestamp()
  };
  if (legacy) {
    if (legacy.role === 'captain' || legacy.isCaptain === true) {
      updates.userRole = 'captain';
      updates.isCaptain = true;
      updates.teamRoles = { [player.currentTeam]: { role: 'captain', approvedBy: me, approvedAt: new Date().toISOString(), canBeRemovedBy: [], status: 'active' } };
    }
    ['favoriteTeams', 'favoritePlayers', 'bats', 'throws', 'position', 'number', 'nickname'].forEach(k => { if (legacy[k]) updates[k] = legacy[k]; });
    updates.mergedFromProfile = legacyId;
    updates.mergedAt = serverTimestamp();
  }
  await updateDoc(ref, updates);
  if (legacy) {
    try { await updateDoc(doc(db, 'users', legacyId), { migrated: true, migratedTo: fanId, migratedAt: serverTimestamp() }); }
    catch (e) { console.warn('[people] could not mark the legacy doc migrated', e); }
  }
  try {
    const agg = await aggregatePlayerStats(fanId, player.name, player.currentTeam);
    if (!agg?.success) console.warn('[people] stats not built', agg?.error);
  } catch (e) { console.warn('[people] stats not built', e); }
  claimed.add(player.name);
}

// ---------------------------------------------------------------------------

async function done() {
  await ctx.refreshAll();
  window.dispatchEvent(new CustomEvent('people:changed'));
}

export async function refresh() {
  fromUsers(await ctx.users());
  renderRequests();
  renderFans();
}

export async function mount(c) {
  ctx = c;
  const panel = document.querySelector('[data-panel="links"]');
  panel.addEventListener('click', (e) => {
    const a = e.target.closest('[data-approve]');
    if (a) return approve(a);
    const d = e.target.closest('[data-deny]');
    if (d) return deny(d);
    const l = e.target.closest('[data-link]');
    if (l) return linkByHand(l.dataset.link);
    const f = e.target.closest('[data-fan-filter]');
    if (f) {
      fanFilter = f.dataset.fanFilter;
      document.querySelectorAll('[data-fan-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === f)));
      renderFans();
    }
  });
  $('plSearch').addEventListener('input', renderFans);
  await refresh();
}
