// js/admin/ls-banners.js
// The Banners tab of admin/league-staff.html: the bannerMessages docs that
// feed the home page's league news. { message, priority (lower first), link,
// isActive, created/lastModified stamps }.

import { db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp } from '../core/firebase.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let banners = [];
let sel = null;   // the banner being edited, or { isNew: true }

async function load() {
  $('lbList').innerHTML = '<p class="sse-dim">Loading...</p>';
  try {
    const snap = await getDocs(query(collection(db, 'bannerMessages'), orderBy('priority', 'asc')));
    banners = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
  } catch (err) {
    console.error('[banners] load', err);
    $('lbList').innerHTML = `<p class="aces-empty">Could not load banners: ${esc(err.message || err)}</p>`;
  }
}

function renderList() {
  if (!banners.length) { $('lbList').innerHTML = '<p class="aces-empty">No banners yet. Add one to show news on the home page.</p>'; return; }
  $('lbList').innerHTML = `<ul class="lb-list">${banners.map(b => `<li>
    <button type="button" class="lb-item${sel?.id === b.id ? ' is-on' : ''}${b.isActive ? '' : ' is-off'}" data-banner="${esc(b.id)}">
      <span class="lb-pri" title="Priority">${esc(b.priority ?? '-')}</span>
      <span class="lb-msg">${esc(b.message || '(empty)')}</span>
      <span class="aces-badge ${b.isActive ? 'is-win' : 'is-outline'}">${b.isActive ? 'Active' : 'Hidden'}</span>
    </button>
  </li>`).join('')}</ul>`;
}

function openEditor(b) {
  sel = b;
  $('lbEditorTitle').textContent = b.isNew ? 'New banner' : 'Edit banner';
  $('lbText').value = b.message || '';
  $('lbPriority').value = b.priority ?? 10;
  $('lbLink').value = b.link || '';
  $('lbActive').checked = b.isActive !== false;
  $('lbDelete').hidden = !!b.isNew;
  $('lbSave').textContent = b.isNew ? 'Add banner' : 'Save';
  $('lbEditor').hidden = false;
  renderList();
  $('lbText').focus();
}

function closeEditor() {
  sel = null;
  $('lbEditor').hidden = true;
  renderList();
}

async function save() {
  const message = $('lbText').value.trim();
  if (!message) return showToast('Write the banner message first.', 'warning');
  const btn = $('lbSave');
  btn.disabled = true;
  const data = {
    message,
    priority: parseInt($('lbPriority').value, 10) || 10,
    link: $('lbLink').value.trim() || null,
    isActive: $('lbActive').checked,
    lastModified: serverTimestamp(),
    lastModifiedBy: ctx.user.uid
  };
  try {
    if (sel.isNew) {
      await addDoc(collection(db, 'bannerMessages'), { ...data, createdAt: serverTimestamp(), createdBy: ctx.user.uid });
      showToast('Banner added', 'success');
    } else {
      await updateDoc(doc(db, 'bannerMessages', sel.id), data);
      showToast('Banner saved', 'success');
    }
    closeEditor();
    await load();
  } catch (err) {
    console.error('[banners] save', err);
    showToast(`Could not save: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function remove() {
  if (!sel || sel.isNew) return;
  if (!(await confirmModal('Delete this banner? It disappears from the home page.', { danger: true, confirmLabel: 'Delete' }))) return;
  try {
    await deleteDoc(doc(db, 'bannerMessages', sel.id));
    showToast('Banner deleted', 'success');
    closeEditor();
    await load();
  } catch (err) {
    console.error('[banners] delete', err);
    showToast(`Could not delete: ${err.message || err}`, 'error');
  }
}

export async function mount(c) {
  ctx = c;
  document.querySelector('[data-panel="banners"]').addEventListener('click', (e) => {
    const item = e.target.closest('[data-banner]');
    if (item) return openEditor(banners.find(b => b.id === item.dataset.banner));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'banner-new') openEditor({ isNew: true, isActive: true, priority: 10 });
    if (act === 'banner-close') closeEditor();
    if (act === 'banner-save') save();
    if (act === 'banner-delete') remove();
  });
  await load();
}
