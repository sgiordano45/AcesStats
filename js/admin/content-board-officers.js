// js/admin/content-board-officers.js
// Board tab of admin/content.html, Appointed officers card: add, edit, hide
// and delete the board's appointed (non-voting) officers. Active ones show on
// board.html by display order. Data: boardOfficers (see js/data/board.js).
// Mounted by content-board.js. League staff and admins.

import { db, collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from '../core/firebase.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { OFFICERS_COLLECTION, getAllOfficers } from '../data/board.js';

const $ = (id) => document.getElementById(id);

let ctx = null;
let items = [];

const who = () => ctx.profile?.displayName || ctx.user.email || '';

function formHtml(p, o = {}) {
  const duties = Array.isArray(o.duties) ? o.duties.join('\n') : '';
  return `
    <div class="ct-grid">
      <div class="aces-field"><label class="aces-label" for="${p}Name">Name</label><input class="aces-input" id="${p}Name" type="text" maxlength="80" placeholder="e.g. Pat Smith" value="${esc(o.name || '')}"></div>
      <div class="aces-field"><label class="aces-label" for="${p}Title">Title</label><input class="aces-input" id="${p}Title" type="text" maxlength="100" placeholder="e.g. Treasurer" value="${esc(o.title || '')}"></div>
      <div class="aces-field ct-narrow"><label class="aces-label" for="${p}Order">Display order</label><input class="aces-input" id="${p}Order" type="number" min="1" max="99" value="${esc(o.order ?? (items.length + 1))}"></div>
    </div>
    <div class="aces-field ct-gap"><label class="aces-label" for="${p}Desc">Description (optional)</label><textarea class="aces-textarea" id="${p}Desc" rows="2" maxlength="500" placeholder="One or two sentences on what the role does.">${esc(o.description || '')}</textarea></div>
    <div class="aces-field ct-gap"><label class="aces-label" for="${p}Duties">Duties (optional, one per line)</label><textarea class="aces-textarea" id="${p}Duties" rows="4" maxlength="1500">${esc(duties)}</textarea></div>
    <label class="agg-check ct-gap"><input type="checkbox" id="${p}Active"${o.active === false ? '' : ' checked'}> <span>Active (shows on the board page)</span></label>`;
}

function readForm(root, p) {
  const q = (id) => root.querySelector(`#${p}${id}`);
  const name = q('Name').value.trim();
  const title = q('Title').value.trim();
  if (!name) { showToast('Enter the officer\'s name.', 'warning'); return null; }
  if (!title) { showToast('Give the officer a title.', 'warning'); return null; }
  return {
    name,
    title,
    order: parseInt(q('Order').value, 10) || 1,
    description: q('Desc').value.trim(),
    duties: q('Duties').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 15),
    active: q('Active').checked
  };
}

async function load() {
  items = await getAllOfficers();
  render();
}

function render() {
  if (!items.length) {
    $('cboList').innerHTML = '<p class="aces-empty">No appointed officers. The section stays off the board page until you add one.</p>';
    return;
  }
  $('cboList').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact ct-table">
    <thead><tr><th scope="col" class="is-num">#</th><th scope="col">Officer</th><th scope="col">Status</th><th scope="col"><span class="u-sr-only">Actions</span></th></tr></thead>
    <tbody>${items.map((o, i) => `<tr>
      <td class="is-num">${esc(o.order ?? '-')}</td>
      <td><strong>${esc(o.name || 'Unnamed')}</strong><span class="ct-sub">${esc(o.title || '')}</span>${o.duties?.length ? `<span class="ct-sub">${o.duties.length} ${o.duties.length === 1 ? 'duty' : 'duties'}</span>` : ''}</td>
      <td>${o.active ? '<span class="aces-badge is-win">Active</span>' : '<span class="aces-badge is-outline">Hidden</span>'}</td>
      <td class="ct-row-actions">
        <button class="aces-btn is-sm" type="button" data-oedit="${i}">Edit</button>
        <button class="aces-btn is-sm is-ghost" type="button" data-odel="${i}">Delete</button>
      </td></tr>`).join('')}</tbody></table></div>`;
}

function resetForm() {
  $('cboForm').innerHTML = formHtml('cbo');
}

async function create() {
  const v = readForm($('cboForm'), 'cbo');
  if (!v) return;
  const btn = $('cboSave');
  btn.disabled = true;
  try {
    await addDoc(collection(db, OFFICERS_COLLECTION), { ...v, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedByName: who() });
    showToast(`Added ${v.name}`, 'success');
    await load();
    resetForm();
  } catch (err) {
    showToast(`Could not save: ${err.message || err}`, 'error');
  } finally { btn.disabled = false; }
}

async function edit(i) {
  const o = items[i];
  if (!o) return;
  let v = null;
  const res = await openModal({
    title: 'Edit officer',
    html: `<div class="ct-edit">${formHtml('cboe', o)}</div>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', variant: 'primary' }],
    beforeClose: (val, dialog) => {
      if (val !== 'ok') return true;
      v = readForm(dialog, 'cboe');
      return !!v;
    }
  });
  if (res !== 'ok' || !v) return;
  try {
    await updateDoc(doc(db, OFFICERS_COLLECTION, o.id), { ...v, updatedAt: serverTimestamp(), updatedByName: who() });
    showToast('Saved', 'success');
    await load();
  } catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
}

async function remove(i) {
  const o = items[i];
  if (!o) return;
  if (!(await confirmModal(`Delete ${o.name}? To take them off the board page but keep the details, edit and untick Active.`, { confirmLabel: 'Delete', danger: true }))) return;
  try {
    await deleteDoc(doc(db, OFFICERS_COLLECTION, o.id));
    showToast('Deleted', 'success');
    await load();
  } catch (err) { showToast(`Could not delete: ${err.message || err}`, 'error'); }
}

export async function mount(c) {
  ctx = c;
  await load().catch((err) => { $('cboList').innerHTML = `<p class="aces-empty">Could not load: ${esc(err.message || err)}</p>`; });
  resetForm();
  $('cboSave').addEventListener('click', create);
  $('cboList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-oedit]');
    if (ed) return edit(Number(ed.dataset.oedit));
    const del = e.target.closest('[data-odel]');
    if (del) return remove(Number(del.dataset.odel));
  });
}
