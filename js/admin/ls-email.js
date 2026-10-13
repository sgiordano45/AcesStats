// js/admin/ls-email.js
// The Email tab of admin/league-staff.html: one email to a group of members,
// everyone in BCC, through the sendMassEmail Cloud Function (Resend).
//   sendMassEmail({ subject, body, fromName, replyTo, recipients: [{ email, name }],
//                   audienceLabel, sendMode: 'bcc' }) -> { success, sentCount, campaignId }
// Sent campaigns are read back from emailCampaigns (newest 15).
//
// Who gets it (users docs with a real email; placeholder, migrated, fan and
// family accounts are left out):
//   all       everyone else
//   linked    accounts linked to a player
//   active    on any of a season's rosters (rosters/{seasonId}-{team}),
//             matched by auth ID, legacy ID, or the linked player's name
//   captains  isCaptain or a captain team role
//   team      linkedTeam / currentTeam is one of the picked teams

import { db, functions, collection, getDocs, query, orderBy, limit } from '../core/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { seasonLabel } from '../domain/season-ids.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { statIdOf } from '../domain/player-id.js';

const $ = (id) => document.getElementById(id);
const TEAMS = ['Army', 'Black', 'Blue', 'Carolina', 'Gold', 'Green', 'Orange', 'Purple', 'Red', 'Silver', 'Teal'];
let ctx = null;
const picked = new Set();
let users = null;            // users docs, read once
const rosterCache = new Map();
let countSeq = 0;

async function allUsers() {
  if (!users) {
    const snap = await getDocs(collection(db, 'users'));
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return users;
}

async function activeIds(seasonId) {
  if (!rosterCache.has(seasonId)) {
    rosterCache.set(seasonId, getDocs(collection(db, 'rosters')).then(snap => {
      const auth = new Set(), legacy = new Set();
      snap.forEach(r => {
        if (!r.id.startsWith(`${seasonId}-`)) return;
        (r.data().players || []).forEach(p => { if (p.authId) auth.add(p.authId); if (p.id) legacy.add(p.id); });
      });
      return { auth, legacy };
    }));
  }
  return rosterCache.get(seasonId);
}

async function recipients() {
  const aud = $('leAudience').value;
  let active = null;
  if (aud === 'active') {
    if (!$('leSeason').value) throw new Error('Pick a season for active players');
    active = await activeIds($('leSeason').value);
  }
  const out = [];
  for (const d of await allUsers()) {
    const email = d.email || '';
    if (!email.includes('@') || email.endsWith('@placeholder.aces') || d.migrated) continue;
    if (d.userRole === 'fan' || d.userRole === 'family') continue;
    if (aud === 'linked' && !d.linkedPlayer) continue;
    if (aud === 'active') {
      const linked = d.linkedPlayer || d.mergedFromProfile ? statIdOf(d) : '';
      if (!(active.auth.has(d.id) || active.legacy.has(d.id) || (linked && active.legacy.has(linked)))) continue;
    }
    if (aud === 'captains' && !(d.isCaptain === true || Object.values(d.teamRoles || {}).some(r => r === 'captain' || r?.role === 'captain'))) continue;
    if (aud === 'team') {
      const team = String(d.linkedTeam || d.currentTeam || '').toLowerCase();
      if (![...picked].some(t => t.toLowerCase() === team)) continue;
    }
    out.push({ email, name: d.displayName || '' });
  }
  return out;
}

function audienceLabel() {
  const aud = $('leAudience').value;
  if (aud === 'all') return 'All members';
  if (aud === 'linked') return 'Linked players';
  if (aud === 'active') return `Active players (${seasonLabel($('leSeason').value)})`;
  if (aud === 'captains') return 'Captains';
  return `Teams: ${[...picked].join(', ')}`;
}

async function updateCount() {
  const aud = $('leAudience').value;
  $('leSeasonWrap').hidden = aud !== 'active';
  $('leTeams').hidden = aud !== 'team';
  $('leListWrap').hidden = true;
  const seq = ++countSeq;
  $('leCount').textContent = '...';
  try {
    const list = aud === 'team' && !picked.size ? [] : await recipients();
    if (seq === countSeq) $('leCount').textContent = list.length;
  } catch {
    if (seq === countSeq) $('leCount').textContent = '?';
  }
}

async function showList() {
  $('leListWrap').hidden = false;
  $('leList').textContent = 'Loading...';
  try {
    const list = await recipients();
    $('leListCount').textContent = list.length;
    $('leList').textContent = list.map(r => r.email).join(', ');
  } catch (err) {
    $('leList').textContent = `Could not load: ${err.message || err}`;
  }
}

function togglePreview() {
  const box = $('lePreview');
  if (!box.hidden) { box.hidden = true; $('lePreviewBtn').textContent = 'Preview'; return; }
  $('lePreviewSubject').textContent = $('leSubject').value.trim() || '(No subject)';
  // The body is HTML the sender wrote; show it in a sandboxed frame.
  const frame = document.createElement('iframe');
  frame.className = 'le-preview-frame';
  frame.setAttribute('sandbox', '');
  frame.title = 'Email preview';
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><body style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;margin:12px;color:#1f2937">${$('leBody').value || '(No message)'}</body>`;
  $('lePreviewBody').replaceChildren(frame);
  box.hidden = false;
  $('lePreviewBtn').textContent = 'Hide preview';
}

async function send() {
  const subject = $('leSubject').value.trim(), body = $('leBody').value.trim();
  const fromName = $('leFrom').value.trim() || 'Mountainside Aces';
  const replyTo = $('leReply').value.trim();
  if (!subject) return showToast('Add a subject.', 'warning');
  if (!body) return showToast('Write the message.', 'warning');
  if (!replyTo) return showToast('Add a reply-to address so members can answer.', 'warning');
  if ($('leAudience').value === 'team' && !picked.size) return showToast('Pick at least one team.', 'warning');
  let list;
  try { list = await recipients(); } catch (err) { return showToast(`Could not load recipients: ${err.message || err}`, 'error'); }
  if (!list.length) return showToast('Nobody matches that audience.', 'warning');
  const label = audienceLabel();
  if (!(await confirmModal(`Send "${subject}" to ${list.length} people (${label})? Everyone is BCC'd.`, { title: 'Send email', confirmLabel: `Send to ${list.length}` }))) return;

  const btn = $('leSend');
  btn.disabled = true;
  btn.textContent = `Sending to ${list.length}...`;
  $('leResult').innerHTML = '';
  try {
    const res = await httpsCallable(functions, 'sendMassEmail')({ subject, body, fromName, replyTo, recipients: list, audienceLabel: label, sendMode: 'bcc' }).then(r => r.data);
    if (!res?.success) throw new Error(res?.error || 'Unknown error');
    $('leResult').innerHTML = `<div class="aces-notice is-success"><div>Sent to ${esc(res.sentCount)} people. Campaign ${esc(res.campaignId || '')}</div></div>`;
    showToast(`Email sent to ${res.sentCount} people`, 'success');
    $('leSubject').value = ''; $('leBody').value = ''; $('leSubjectCount').textContent = '0';
    $('lePreview').hidden = true; $('lePreviewBtn').textContent = 'Preview';
    await loadHistory();
  } catch (err) {
    console.error('[email] send', err);
    $('leResult').innerHTML = `<div class="aces-notice is-error"><div>Not sent: ${esc(err.message || err)}. If this keeps happening, check the sendMassEmail function and the RESEND_API_KEY secret.</div></div>`;
    showToast(`Email failed: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send';
  }
}

async function loadHistory() {
  const el = $('leHistory');
  try {
    const snap = await getDocs(query(collection(db, 'emailCampaigns'), orderBy('sentAt', 'desc'), limit(15)));
    if (snap.empty) { el.innerHTML = '<p class="aces-empty">No emails sent yet.</p>'; return; }
    el.innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact ls-hist">
      <thead><tr><th scope="col">Subject</th><th scope="col">Sent</th><th scope="col">By</th><th scope="col">To</th><th scope="col" class="is-num">People</th></tr></thead>
      <tbody>${snap.docs.map(d => {
        const c = d.data();
        const when = c.sentAt?.toDate ? c.sentAt.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        return `<tr><td>${esc(c.subject || '(No subject)')}</td><td>${esc(when)}</td><td>${esc(c.sentBy || '')}</td><td>${esc(c.audienceLabel || 'All members')}</td><td class="is-num">${esc(c.sentCount || 0)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  } catch (err) {
    el.innerHTML = `<p class="aces-empty">Could not load: ${esc(err.message || err)}</p>`;
  }
}

export async function mount(c) {
  ctx = c;
  $('leSeason').innerHTML = ctx.seasonIds.map(id => `<option value="${esc(id)}">${esc(seasonLabel(id))}</option>`).join('');
  if (ctx.currentSeasonId) $('leSeason').value = ctx.currentSeasonId;
  $('leTeams').innerHTML = TEAMS.map(t => `<button type="button" class="ls-chip" data-email-team="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('');
  const panel = document.querySelector('[data-panel="email"]');
  panel.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-email-team]');
    if (chip) {
      const t = chip.dataset.emailTeam;
      if (picked.has(t)) picked.delete(t); else picked.add(t);
      chip.setAttribute('aria-pressed', String(picked.has(t)));
      return updateCount();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'email-list') showList();
    if (act === 'email-copy') navigator.clipboard.writeText($('leList').textContent).then(() => showToast('Addresses copied', 'success'), () => showToast('Select the list and copy it', 'info'));
    if (act === 'email-preview') togglePreview();
    if (act === 'email-send') send();
  });
  $('leAudience').addEventListener('change', updateCount);
  $('leSeason').addEventListener('change', updateCount);
  $('leSubject').addEventListener('input', () => { $('leSubjectCount').textContent = $('leSubject').value.length; });
  loadHistory();
  await updateCount();
}
