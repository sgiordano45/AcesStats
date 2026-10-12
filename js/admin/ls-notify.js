// js/admin/ls-notify.js
// The Notifications tab of admin/league-staff.html. Push notifications go out
// through Cloud Functions:
//   sendAnnouncement({ title, body, priority, targetTeams|null, targetCaptainsOnly, link|linkType })
//   testNotification({})                         to the signed-in user only
//   unsendAnnouncement({ announcementId, title }) removes it from every feed
//   cleanupNotifications({ title } | { type } | { all: true })   admins only
// Sent ones are read back from announcements (newest 10).

import { db, functions, collection, getDocs, query, orderBy, limit } from '../core/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal, openModal } from '../ui/modal.js';
import { cap } from '../ui/game-shared.js';
import { getSeasonGames } from '../data/games.js';
import { normalizeGames } from '../domain/standings.js';

const $ = (id) => document.getElementById(id);
const call = (name, data = {}) => httpsCallable(functions, name)(data).then(r => r.data);

let ctx = null;
let teams = [];          // teams collection: { id, name }
let pushUsers = [];      // users with a push token, for the reach estimate
let audience = 'all';    // 'all' | 'captains' | 'teams'
const picked = new Set();

function renderTeams() {
  $('lnTeams').innerHTML = teams.map(t => `<button type="button" class="ls-chip" data-team="${esc(t.id)}" aria-pressed="${picked.has(t.id)}">${esc(cap(t.name || t.id))}</button>`).join('');
}

function updateReach() {
  let n = pushUsers.length;
  if (audience === 'captains') n = pushUsers.filter(u => u.isCaptain).length;
  if (audience === 'teams') n = pushUsers.filter(u => picked.has(u.linkedTeam)).length;
  $('lnReach').textContent = audience === 'teams' && !picked.size
    ? 'Pick at least one team.'
    : `About ${n} ${n === 1 ? 'person has' : 'people have'} push turned on${audience === 'all' ? '' : ' in this group'}.`;
  updateForm();
}

function updateForm() {
  const title = $('lnTitle').value, body = $('lnBody').value;
  $('lnTitleCount').textContent = title.length;
  $('lnBodyCount').textContent = body.length;
  $('lnPrevTitle').textContent = title || 'Notification title';
  $('lnPrevBody').textContent = body || 'Your message shows here.';
  $('lnCustomWrap').hidden = $('lnLink').value !== 'custom';
  $('lnSend').disabled = !title.trim() || !body.trim() || (audience === 'teams' && !picked.size);
}

function setAudience(a) {
  audience = a;
  document.querySelectorAll('[data-aud]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aud === a)));
  $('lnTeams').hidden = a !== 'teams';
  updateReach();
}

async function send() {
  const title = $('lnTitle').value.trim(), body = $('lnBody').value.trim();
  if (!title || !body) return;
  const who = audience === 'all' ? 'everyone with push turned on'
    : audience === 'captains' ? 'all captains'
    : [...picked].map(id => cap(teams.find(t => t.id === id)?.name || id)).join(', ');
  if (!(await confirmModal(`Send "${title}" to ${who}?`, { title: 'Send notification', confirmLabel: 'Send' }))) return;
  const btn = $('lnSend');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const payload = {
      title, body,
      priority: $('lnPriority').value,
      targetTeams: audience === 'teams' ? [...picked] : null,
      targetCaptainsOnly: audience === 'captains'
    };
    const link = $('lnLink').value, custom = $('lnCustom').value.trim();
    if (link === 'custom' && custom) payload.link = custom;
    else if (link && link !== 'custom') payload.linkType = link;
    const res = await call('sendAnnouncement', payload);
    if (!res?.success) throw new Error(res?.error || 'Unknown error');
    showToast(`Sent to ${res.recipientCount} ${res.recipientCount === 1 ? 'person' : 'people'}`, 'success');
    $('lnTitle').value = ''; $('lnBody').value = ''; $('lnPriority').value = 'normal'; $('lnLink').value = ''; $('lnCustom').value = '';
    picked.clear(); renderTeams(); setAudience('all');
    await loadRecent();
  } catch (err) {
    console.error('[notify] send', err);
    showToast(`Could not send: ${err.message || err}`, 'error');
  } finally {
    btn.textContent = 'Send notification';
    updateForm();
  }
}

async function sendTest() {
  const btn = $('lnTest');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    await call('testNotification');
    showToast('Test sent. Check your phone.', 'success');
  } catch (err) {
    showToast(`Test failed: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send me a test';
  }
}

const PRIORITY = { urgent: ['Urgent', 'is-loss'], info: ['Info', 'is-outline'], normal: ['Normal', ''] };

async function loadRecent() {
  const el = $('lnRecent');
  try {
    const snap = await getDocs(query(collection(db, 'announcements'), orderBy('sentAt', 'desc'), limit(10)));
    if (snap.empty) { el.innerHTML = '<p class="aces-empty">Nothing sent yet.</p>'; return; }
    el.innerHTML = `<ul class="ln-recent">${snap.docs.map(d => {
      const a = d.data();
      const when = a.sentAt?.toDate ? a.sentAt.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const scope = a.wasFiltered === false || a.isLeagueWide ? 'Everyone'
        : a.targetCaptainsOnly ? 'Captains'
        : a.targetTeams?.length ? a.targetTeams.map(cap).join(', ')
        : (() => { const n = a.targetedUserCount || a.recipientCount || 0; return `${n} ${n === 1 ? 'person' : 'people'}`; })();
      const [pl, pc] = PRIORITY[a.priority] || PRIORITY.normal;
      return `<li class="aces-card ln-sent${a.unsent ? ' is-unsent' : ''}">
        <div class="ln-sent-head">
          <strong>${esc(a.title || 'Untitled')}</strong>
          ${a.priority && a.priority !== 'normal' ? `<span class="aces-badge ${pc}">${esc(pl)}</span>` : ''}
          ${a.unsent ? '<span class="aces-badge is-outline">Unsent</span>'
            : `<button class="aces-btn is-sm is-ghost" type="button" data-unsend="${esc(d.id)}" data-title="${esc(a.title || '')}">Unsend</button>`}
        </div>
        <p class="ln-sent-body">${esc(a.body || '')}</p>
        <p class="sse-dim">${esc([when, a.sentByName ? `by ${a.sentByName}` : '', `${a.recipientCount || 0} delivered`, scope].filter(Boolean).join(' · '))}</p>
      </li>`;
    }).join('')}</ul>`;
  } catch (err) {
    console.error('[notify] recent', err);
    el.innerHTML = `<p class="aces-empty">Could not load: ${esc(err.message || err)}</p>`;
  }
}

async function unsend(btn) {
  const id = btn.dataset.unsend, title = btn.dataset.title;
  if (!(await confirmModal(`Unsend "${title}"? It is removed from everyone's notification feed. Phones that already showed it keep the alert.`, { danger: true, confirmLabel: 'Unsend' }))) return;
  btn.disabled = true;
  btn.textContent = 'Removing...';
  try {
    const res = await call('unsendAnnouncement', { announcementId: id, title });
    if (!res?.success) throw new Error('Unsend failed');
    showToast(`Removed from ${res.deletedCount} feeds`, 'success');
    await loadRecent();
  } catch (err) {
    showToast(`Could not unsend: ${err.message || err}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Unsend';
  }
}

async function cleanup() {
  let chosen = null;
  const choice = await openModal({
    title: 'Clean up notifications',
    html: `<p>Delete notifications from every member's feed. This can't be undone.</p>
      <div class="aces-field"><label class="aces-label" for="lnClType">By type</label><span class="aces-select-wrap"><select class="aces-select" id="lnClType">
        <option value="">Choose...</option><option value="announcement">All announcements</option><option value="game_reminder">All game reminders</option><option value="milestone">All milestones</option><option value="all">Every notification</option>
      </select></span></div>
      <div class="aces-field"><label class="aces-label" for="lnClTitle">Or by exact title</label><input class="aces-input" id="lnClTitle" type="text"></div>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'go', variant: 'danger' }],
    beforeClose: (v, dialog) => {
      if (v !== 'go') return true;
      const ok = dialog.querySelector('#lnClTitle').value.trim() || dialog.querySelector('#lnClType').value;
      if (!ok) showToast('Pick a type or enter a title.', 'warning');
      if (ok) chosen = { title: dialog.querySelector('#lnClTitle').value.trim(), type: dialog.querySelector('#lnClType').value };
      return !!ok;
    }
  });
  if (choice !== 'go') return;
  const { title, type } = chosen;
  const params = title ? { title } : type === 'all' ? { all: true } : { type };
  const what = title ? `every notification titled "${title}"` : type === 'all' ? 'EVERY notification for every member' : `every ${type.replace('_', ' ')} notification`;
  if (!(await confirmModal(`Delete ${what}?`, { danger: true, confirmLabel: 'Delete' }))) return;
  try {
    const res = await call('cleanupNotifications', params);
    if (res?.success) showToast(`Deleted ${res.totalDeleted} from ${res.usersAffected} members`, 'success');
    await loadRecent();
  } catch (err) {
    showToast(`Cleanup failed: ${err.message || err}`, 'error');
  }
}

export async function mount(c) {
  ctx = c;
  $('lnCleanupBtn').hidden = !ctx.isAdmin;
  const panel = document.querySelector('[data-panel="notify"]');
  panel.addEventListener('click', (e) => {
    const aud = e.target.closest('[data-aud]');
    if (aud) return setAudience(aud.dataset.aud);
    const chip = e.target.closest('[data-team]');
    if (chip) {
      const id = chip.dataset.team;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      chip.setAttribute('aria-pressed', String(picked.has(id)));
      return updateReach();
    }
    const un = e.target.closest('[data-unsend]');
    if (un) return unsend(un);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'notify-send') send();
    if (act === 'notify-test') sendTest();
    if (act === 'notify-cleanup') cleanup();
  });
  ['lnTitle', 'lnBody', 'lnLink', 'lnCustom'].forEach(id => $(id).addEventListener('input', updateForm));
  updateForm();
  loadRecent();
  const [tSnap, uSnap, games] = await Promise.all([
    getDocs(collection(db, 'teams')).catch(() => null),
    getDocs(collection(db, 'users')).catch(() => null),
    ctx.currentSeasonId ? getSeasonGames(ctx.currentSeasonId).catch(() => []) : []
  ]);
  // Only this season's teams (the teams collection keeps retired ones, like Kings and White).
  const playing = new Set(normalizeGames(games).flatMap(g => [g.home, g.away]).map(t => String(t).toLowerCase()));
  teams = (tSnap?.docs || []).map(d => ({ id: d.id, ...d.data() }))
    .filter(t => !playing.size || playing.has(String(t.id).toLowerCase()) || playing.has(String(t.name || '').toLowerCase()))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  pushUsers = (uSnap?.docs || []).map(d => d.data()).filter(u => u.fcmTokens && Object.keys(u.fcmTokens).length);
  renderTeams();
  updateReach();
}
