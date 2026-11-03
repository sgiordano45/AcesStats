// js/admin/content-board.js
// Board tab of admin/content.html: post, edit and delete Board of Directors
// decisions. Published ones show on board.html; drafts stay here.
// Data: boardDecisions (see js/data/board.js). League staff and admins.

import { db, collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from '../core/firebase.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';
import {
  BOARD_COLLECTION, DECISION_CATEGORIES, DECISION_OUTCOMES, categoryOf, outcomeOf,
  formatDecisionDate, voteLine, getAllDecisions
} from '../data/board.js';

const $ = (id) => document.getElementById(id);

let ctx = null;
let items = [];

const options = (list, sel) => list.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');

/** Today as YYYY-MM-DD in the league's time zone. */
function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** A vote box: '' -> null (not recorded), else a whole number 0-20. */
function voteNum(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : NaN;
}

/** The form fields inside root (the page card or the edit modal). */
function formHtml(p, d = {}) {
  const v = (x) => (Number.isFinite(x) ? x : '');
  return `
    <div class="aces-field"><label class="aces-label" for="${p}Title">Decision</label><input class="aces-input" id="${p}Title" type="text" maxlength="140" placeholder="e.g. Courtesy runner rule adopted for 2027" value="${esc(d.title || '')}"></div>
    <div class="ct-grid ct-gap">
      <div class="aces-field"><label class="aces-label" for="${p}Date">Date decided</label><input class="aces-input" id="${p}Date" type="date" value="${esc(d.decidedOn || todayIso())}"></div>
      <div class="aces-field"><label class="aces-label" for="${p}Cat">Category</label><span class="aces-select-wrap"><select class="aces-select" id="${p}Cat">${options(DECISION_CATEGORIES, d.category || 'rules')}</select></span></div>
      <div class="aces-field"><label class="aces-label" for="${p}Out">Outcome</label><span class="aces-select-wrap"><select class="aces-select" id="${p}Out">${options(DECISION_OUTCOMES, d.outcome || 'approved')}</select></span></div>
    </div>
    <div class="ct-grid ct-gap">
      <div class="aces-field ct-narrow"><label class="aces-label" for="${p}For">Votes for</label><input class="aces-input" id="${p}For" type="number" min="0" max="20" inputmode="numeric" value="${v(d.votesFor)}"></div>
      <div class="aces-field ct-narrow"><label class="aces-label" for="${p}Against">Against</label><input class="aces-input" id="${p}Against" type="number" min="0" max="20" inputmode="numeric" value="${v(d.votesAgainst)}"></div>
      <div class="aces-field ct-narrow"><label class="aces-label" for="${p}Abstain">Abstained</label><input class="aces-input" id="${p}Abstain" type="number" min="0" max="20" inputmode="numeric" value="${v(d.abstain)}"></div>
    </div>
    <p class="sse-dim">Leave the votes blank for announcements or decisions without a recorded count.</p>
    <div class="aces-field ct-gap"><label class="aces-label" for="${p}Summary">Summary</label><textarea class="aces-textarea" id="${p}Summary" rows="4" maxlength="2000" placeholder="What was decided, and when it takes effect.">${esc(d.summary || '')}</textarea></div>
    <label class="agg-check ct-gap"><input type="checkbox" id="${p}Pub"${d.published === false ? '' : ' checked'}> <span>Published (shows on the board page)</span></label>`;
}

/** Read and check the form. Returns the fields, or null after a toast. */
function readForm(root, p) {
  const q = (id) => root.querySelector(`#${p}${id}`);
  const title = q('Title').value.trim();
  if (!title) { showToast('Give the decision a title.', 'warning'); return null; }
  const decidedOn = q('Date').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decidedOn)) { showToast('Pick the date it was decided.', 'warning'); return null; }
  const votesFor = voteNum(q('For').value);
  const votesAgainst = voteNum(q('Against').value);
  const abstain = voteNum(q('Abstain').value);
  if ([votesFor, votesAgainst, abstain].some(Number.isNaN)) { showToast('Votes must be whole numbers.', 'warning'); return null; }
  return {
    title,
    decidedOn,
    category: q('Cat').value,
    outcome: q('Out').value,
    votesFor, votesAgainst, abstain,
    summary: q('Summary').value.trim(),
    published: q('Pub').checked
  };
}

async function load() {
  items = await getAllDecisions();
  render();
}

function render() {
  if (!items.length) { $('cbList').innerHTML = '<p class="aces-empty">No decisions posted yet.</p>'; return; }
  $('cbList').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact ct-table">
    <thead><tr><th scope="col">Date</th><th scope="col">Decision</th><th scope="col">Category</th><th scope="col">Outcome</th><th scope="col">Status</th><th scope="col"><span class="u-sr-only">Actions</span></th></tr></thead>
    <tbody>${items.map((d, i) => {
      const vote = voteLine(d);
      return `<tr>
        <td class="u-nowrap">${esc(formatDecisionDate(d.decidedOn) || '-')}</td>
        <td><strong>${esc(d.title || 'Untitled')}</strong>${d.summary ? `<span class="ct-sub">${esc(d.summary.length > 140 ? `${d.summary.slice(0, 140)}...` : d.summary)}</span>` : ''}</td>
        <td>${esc(categoryOf(d.category)[1])}</td>
        <td class="u-nowrap">${esc(outcomeOf(d.outcome)[1])}${vote ? `<span class="ct-sub">${esc(vote)}</span>` : ''}</td>
        <td>${d.published ? '<span class="aces-badge is-win">Published</span>' : '<span class="aces-badge is-outline">Draft</span>'}</td>
        <td class="ct-row-actions">
          <button class="aces-btn is-sm" type="button" data-edit="${i}">Edit</button>
          <button class="aces-btn is-sm is-ghost" type="button" data-del="${i}">Delete</button>
        </td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function resetForm() {
  $('cbForm').innerHTML = formHtml('cb');
}

async function create() {
  const v = readForm($('cbForm'), 'cb');
  if (!v) return;
  const btn = $('cbSave');
  btn.disabled = true;
  try {
    await addDoc(collection(db, BOARD_COLLECTION), {
      ...v,
      createdBy: ctx.user.uid,
      createdByName: ctx.profile?.displayName || ctx.user.email || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showToast(v.published ? 'Decision published' : 'Draft saved', 'success');
    resetForm();
    await load();
  } catch (err) {
    showToast(`Could not save: ${err.message || err}`, 'error');
  } finally { btn.disabled = false; }
}

async function edit(i) {
  const d = items[i];
  if (!d) return;
  let v = null;
  const res = await openModal({
    title: 'Edit decision',
    html: `<div class="ct-edit">${formHtml('cbe', d)}</div>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', variant: 'primary' }],
    beforeClose: (val, dialog) => {
      if (val !== 'ok') return true;
      v = readForm(dialog, 'cbe');
      return !!v;
    }
  });
  if (res !== 'ok' || !v) return;
  try {
    await updateDoc(doc(db, BOARD_COLLECTION, d.id), {
      ...v,
      updatedAt: serverTimestamp(),
      updatedByName: ctx.profile?.displayName || ctx.user.email || ''
    });
    showToast('Saved', 'success');
    await load();
  } catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
}

async function remove(i) {
  const d = items[i];
  if (!d) return;
  if (!(await confirmModal(`Delete "${d.title}"? This can't be undone. To take it off the board page but keep it, edit it and untick Published.`, { confirmLabel: 'Delete', danger: true }))) return;
  try {
    await deleteDoc(doc(db, BOARD_COLLECTION, d.id));
    showToast('Deleted', 'success');
    await load();
  } catch (err) { showToast(`Could not delete: ${err.message || err}`, 'error'); }
}

export async function mount(c) {
  ctx = c;
  resetForm();
  $('cbSave').addEventListener('click', create);
  $('cbList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return edit(Number(ed.dataset.edit));
    const del = e.target.closest('[data-del]');
    if (del) return remove(Number(del.dataset.del));
  });
  await load().catch(err => { $('cbList').innerHTML = `<p class="aces-empty">Could not load: ${esc(err.message || err)}</p>`; });
}
