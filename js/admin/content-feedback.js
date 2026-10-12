// js/admin/content-feedback.js
// Feedback tab of admin/content.html: feature requests and bug reports sent
// from feature-submit.html (moved from admin/features.html, same docs).
//
//   featureSubmissions/{auto}
//     { category, title, description, pageRef, priority, status,
//       submittedAt, submittedBy { uid, displayName, email } | null,
//       adminNotes, updatedAt, updatedBy, resolvedAt, resolvedBy }
//
// Status and priority save as soon as they change; notes save on the button.
// Members see their own submission's status on feature-submit.html.

import { db, collection, doc, getDocs, updateDoc, deleteDoc, query, orderBy, serverTimestamp } from '../core/firebase.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { icon } from '../ui/icons.js';

const $ = (id) => document.getElementById(id);
const CATEGORIES = [['feature', 'New feature', 'sparkles'], ['improvement', 'Improvement', 'trending-up'], ['bug', 'Bug', 'alert-circle'], ['content', 'Content fix', 'edit'], ['other', 'Other', 'message']];
const STATUSES = [['new', 'New', 'is-alert'], ['reviewing', 'Reviewing', 'is-outline'], ['planned', 'Planned', 'is-accent'], ['in-progress', 'In progress', 'is-accent'], ['completed', 'Done', 'is-win'], ['declined', 'Declined', 'is-loss']];
const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']];
const TILES = [['new', 'New'], ['reviewing', 'Reviewing'], ['planned', 'Planned or in progress'], ['completed', 'Done'], ['declined', 'Declined']];

const label = (list, v) => (list.find(x => x[0] === v) || [v, v || '-'])[1];
const opts = (list, sel) => list.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');
const when = (t) => (t?.seconds ? new Date(t.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-');
const who = (s) => s.submittedBy ? (s.submittedBy.displayName || s.submittedBy.email || 'Member') : 'Anonymous';

let ctx = null;
let subs = [];
const open = new Set();   // expanded ids survive a redraw

async function load() {
  const snap = await getDocs(query(collection(db, 'featureSubmissions'), orderBy('submittedAt', 'desc')));
  subs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
}

function tiles() {
  const n = (st) => subs.filter(s => (st === 'planned' ? ['planned', 'in-progress'].includes(s.status) : s.status === st)).length;
  $('cfTiles').innerHTML = TILES.map(([st, l]) => `<button type="button" class="aces-stat ct-tile${$('cfStatus').value === st ? ' is-on' : ''}" data-status="${st}">
    <span class="aces-stat-value">${n(st)}</span><span class="aces-stat-label">${esc(l)}</span></button>`).join('');
}

function filtered() {
  const st = $('cfStatus').value, cat = $('cfCategory').value, pri = $('cfPriority').value;
  const q = $('cfFind').value.trim().toLowerCase();
  return subs.filter(s =>
    (!st || (st === 'planned' ? ['planned', 'in-progress'].includes(s.status) : s.status === st)) &&
    (!cat || s.category === cat) &&
    (!pri || s.priority === pri) &&
    (!q || [s.title, s.description, who(s), s.submittedBy?.email, s.pageRef].some(v => String(v || '').toLowerCase().includes(q))));
}

function card(s) {
  const st = STATUSES.find(x => x[0] === s.status) || STATUSES[0];
  const cat = CATEGORIES.find(x => x[0] === s.category) || CATEGORIES[4];
  return `<details class="aces-card ct-fb" data-id="${esc(s.id)}"${open.has(s.id) ? ' open' : ''}>
    <summary>
      <span class="adm-todo-icon ct-fb-icon is-${esc(cat[0])}">${icon(cat[2])}</span>
      <span class="ct-fb-main"><strong>${esc(s.title || 'Untitled')}</strong>
        <span class="ct-sub">${esc(cat[1])} &middot; ${esc(when(s.submittedAt))} &middot; ${esc(who(s))}${s.pageRef ? ` &middot; ${esc(s.pageRef)}` : ''}</span></span>
      <span class="ct-fb-badges"><span class="aces-badge ${st[2]}">${esc(st[1])}</span><span class="aces-badge is-outline">${esc(label(PRIORITIES, s.priority))}</span></span>
    </summary>
    <div class="ct-fb-body">
      <p class="ct-fb-text">${esc(s.description || '')}</p>
      ${s.submittedBy?.email ? `<p class="sse-dim">From ${esc(s.submittedBy.displayName || 'a member')}, <a href="mailto:${esc(s.submittedBy.email)}">${esc(s.submittedBy.email)}</a></p>` : ''}
      <div class="ct-grid">
        <div class="aces-field"><label class="aces-label" for="cfS-${esc(s.id)}">Status</label><span class="aces-select-wrap"><select class="aces-select" id="cfS-${esc(s.id)}" data-field="status">${opts(STATUSES, s.status)}</select></span></div>
        <div class="aces-field"><label class="aces-label" for="cfP-${esc(s.id)}">Priority</label><span class="aces-select-wrap"><select class="aces-select" id="cfP-${esc(s.id)}" data-field="priority">${opts(PRIORITIES, s.priority)}</select></span></div>
      </div>
      <div class="aces-field ct-gap"><label class="aces-label" for="cfN-${esc(s.id)}">Notes (admins only)</label><textarea class="aces-textarea" id="cfN-${esc(s.id)}" rows="2">${esc(s.adminNotes || '')}</textarea></div>
      <div class="sse-actions">
        <button class="aces-btn is-sm is-primary" type="button" data-notes>Save notes</button>
        <button class="aces-btn is-sm is-ghost" type="button" data-delete>Delete</button>
      </div>
    </div>
  </details>`;
}

function render() {
  tiles();
  const list = filtered();
  $('cfCount').textContent = `${list.length} of ${subs.length}`;
  $('cfList').innerHTML = list.length ? list.map(card).join('') : '<p class="aces-empty">Nothing matches.</p>';
}

async function save(id, data, msg) {
  const s = subs.find(x => x.id === id);
  await updateDoc(doc(db, 'featureSubmissions', id), { ...data, updatedAt: serverTimestamp(), updatedBy: ctx.user.uid });
  if (s) Object.assign(s, data);
  showToast(msg, 'success');
}

async function onChange(e) {
  const sel = e.target.closest('[data-field]');
  if (!sel) return;
  const id = sel.closest('[data-id]').dataset.id;
  const field = sel.dataset.field;
  const data = { [field]: sel.value };
  if (field === 'status' && sel.value === 'completed') Object.assign(data, { resolvedAt: serverTimestamp(), resolvedBy: ctx.user.uid });
  try {
    await save(id, data, field === 'status' ? `Marked ${label(STATUSES, sel.value).toLowerCase()}` : 'Priority saved');
    render();
    if (field === 'status') window.dispatchEvent(new Event('content:feedback'));
  } catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
}

async function onClick(e) {
  const box = e.target.closest('[data-id]');
  if (!box) return;
  const id = box.dataset.id;
  if (e.target.closest('[data-notes]')) {
    try { await save(id, { adminNotes: box.querySelector('textarea').value }, 'Notes saved'); }
    catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
  } else if (e.target.closest('[data-delete]')) {
    if (!(await confirmModal('Delete this submission? This cannot be undone.', { confirmLabel: 'Delete', danger: true }))) return;
    try {
      await deleteDoc(doc(db, 'featureSubmissions', id));
      subs = subs.filter(x => x.id !== id);
      open.delete(id);
      render();
      showToast('Deleted', 'success');
      window.dispatchEvent(new Event('content:feedback'));
    } catch (err) { showToast(`Could not delete: ${err.message || err}`, 'error'); }
  }
}

export async function mount(c) {
  ctx = c;
  $('cfStatus').innerHTML = `<option value="">Any status</option>${opts(TILES, '')}`;
  $('cfCategory').innerHTML = `<option value="">Any kind</option>${opts(CATEGORIES, '')}`;
  $('cfPriority').innerHTML = `<option value="">Any priority</option>${opts(PRIORITIES, '')}`;
  ['cfStatus', 'cfCategory', 'cfPriority'].forEach(id => $(id).addEventListener('change', render));
  $('cfFind').addEventListener('input', render);
  $('cfTiles').addEventListener('click', (e) => {
    const t = e.target.closest('[data-status]');
    if (!t) return;
    $('cfStatus').value = $('cfStatus').value === t.dataset.status ? '' : t.dataset.status;
    render();
  });
  $('cfRefresh').addEventListener('click', () => load().then(() => showToast('Up to date', 'success')).catch(err => showToast(`Could not load: ${err.message || err}`, 'error')));
  $('cfList').addEventListener('toggle', (e) => {
    const d = e.target.closest?.('[data-id]');
    if (d) { if (d.open) open.add(d.dataset.id); else open.delete(d.dataset.id); }
  }, true);
  $('cfList').addEventListener('change', onChange);
  $('cfList').addEventListener('click', onClick);
  await load().catch(err => { $('cfList').innerHTML = `<p class="aces-empty">Could not load: ${esc(err.message || err)}</p>`; });
}
