// js/admin/content-docs.js
// Documents tab of admin/content.html: league PDFs (moved from the old
// Content admin, same docs and files). league-rules.js lists the active ones.
//
//   Storage    league-documents/{Date.now()}_{sanitized file name}
//              (storage.rules: admins only)
//   Firestore  leagueDocuments/{auto}
//     { title, category, description, order, active, url, storagePath,
//       fileName, fileSize, uploadedBy, uploadedByName, uploadedAt, updatedAt }

import { db, storage, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp } from '../core/firebase.js';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 10 * 1024 * 1024;
const CATEGORIES = [['league', 'League'], ['town', 'Town / Recreation'], ['insurance', 'Insurance'], ['field', 'Field / Facilities']];
const catLabel = (c) => (CATEGORIES.find(([v]) => v === c) || [c, c || '-'])[1];
const mb = (n) => `${((n || 0) / (1024 * 1024)).toFixed(2)} MB`;
const catOptions = (sel) => CATEGORIES.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');

let ctx = null;
let docs = [];
let file = null;

function pickFile(f) {
  file = f || null;
  $('cdFileName').textContent = file ? `${file.name} (${mb(file.size)})` : 'PDF only, up to 10 MB';
  $('cdDrop').classList.toggle('has-file', !!file);
}

async function load() {
  const snap = await getDocs(query(collection(db, 'leagueDocuments'), orderBy('order', 'asc')));
  docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
}

function render() {
  if (!docs.length) { $('cdList').innerHTML = '<p class="aces-empty">No documents uploaded yet.</p>'; return; }
  $('cdList').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact ct-table">
    <thead><tr><th scope="col" class="is-num">#</th><th scope="col">Document</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Uploaded</th><th scope="col"><span class="u-sr-only">Actions</span></th></tr></thead>
    <tbody>${docs.map((d, i) => {
      const when = d.uploadedAt?.toDate ? d.uploadedAt.toDate().toLocaleDateString() : '-';
      return `<tr>
        <td class="is-num">${esc(d.order ?? '-')}</td>
        <td><strong>${esc(d.title || 'Untitled')}</strong>${d.description ? `<span class="ct-sub">${esc(d.description)}</span>` : ''}<span class="ct-sub">${esc(d.fileName || '')}${d.fileSize ? `, ${mb(d.fileSize)}` : ''}</span></td>
        <td>${esc(catLabel(d.category))}</td>
        <td>${d.active ? '<span class="aces-badge is-win">Active</span>' : '<span class="aces-badge is-outline">Hidden</span>'}</td>
        <td class="u-nowrap">${esc(when)}</td>
        <td class="ct-row-actions">
          ${d.url ? `<a class="aces-btn is-sm is-ghost" href="${esc(d.url)}" target="_blank" rel="noopener">View</a>` : ''}
          <button class="aces-btn is-sm" type="button" data-edit="${i}">Edit</button>
          <button class="aces-btn is-sm is-ghost" type="button" data-del="${i}">Delete</button>
        </td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function upload() {
  const title = $('cdTitle').value.trim();
  if (!title) { showToast('Give the document a title.', 'warning'); return; }
  if (!file) { showToast('Choose a PDF.', 'warning'); return; }
  if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) { showToast('Only PDF files.', 'error'); return; }
  if (file.size > MAX_BYTES) { showToast('The file must be under 10 MB.', 'error'); return; }

  const meta = {
    title,
    category: $('cdCategory').value,
    description: $('cdDesc').value.trim(),
    order: parseInt($('cdOrder').value, 10) || 1,
    active: $('cdActive').checked
  };
  const storagePath = `league-documents/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const btn = $('cdUpload');
  btn.disabled = true;
  $('cdProgress').hidden = false;
  $('cdBar').style.width = '0%';
  const done = () => { btn.disabled = false; $('cdProgress').hidden = true; $('cdStatus').textContent = ''; };

  const task = uploadBytesResumable(ref(storage, storagePath), file, { contentType: 'application/pdf' });
  task.on('state_changed',
    (s) => {
      const pct = Math.round((s.bytesTransferred / s.totalBytes) * 100);
      $('cdBar').style.width = `${pct}%`;
      $('cdStatus').textContent = `Uploading... ${pct}%`;
    },
    (err) => { console.error('[docs] upload', err); showToast(`Upload failed: ${err.message || err}`, 'error'); done(); },
    async () => {
      try {
        $('cdStatus').textContent = 'Saving...';
        const url = await getDownloadURL(task.snapshot.ref);
        await addDoc(collection(db, 'leagueDocuments'), {
          ...meta, url, storagePath,
          fileName: file.name,
          fileSize: file.size,
          uploadedBy: ctx.user.uid,
          uploadedByName: ctx.profile?.displayName || ctx.user.email || '',
          uploadedAt: serverTimestamp()
        });
        showToast(`Uploaded ${title}`, 'success');
        $('cdTitle').value = ''; $('cdDesc').value = ''; $('cdOrder').value = '1'; $('cdActive').checked = true;
        $('cdFile').value = '';
        pickFile(null);
        await load();
      } catch (err) {
        showToast(`Uploaded the file but could not save it: ${err.message || err}`, 'error');
      } finally { done(); }
    });
}

async function edit(i) {
  const d = docs[i];
  if (!d) return;
  let v = null;
  const res = await openModal({
    title: 'Edit document',
    html: `<div class="ct-edit">
      <div class="aces-field"><label class="aces-label" for="cdeTitle">Title</label><input class="aces-input" id="cdeTitle" type="text" value="${esc(d.title || '')}"></div>
      <div class="ct-grid">
        <div class="aces-field"><label class="aces-label" for="cdeCat">Category</label><span class="aces-select-wrap"><select class="aces-select" id="cdeCat">${catOptions(d.category)}</select></span></div>
        <div class="aces-field"><label class="aces-label" for="cdeOrder">Display order</label><input class="aces-input" id="cdeOrder" type="number" min="1" max="99" value="${esc(d.order ?? 1)}"></div>
      </div>
      <div class="aces-field"><label class="aces-label" for="cdeDesc">Description</label><textarea class="aces-textarea" id="cdeDesc" rows="3">${esc(d.description || '')}</textarea></div>
      <label class="agg-check"><input type="checkbox" id="cdeActive"${d.active ? ' checked' : ''}> <span>Active (shows on the Rules page)</span></label>
      <p class="sse-dim">File: ${esc(d.fileName || 'unknown')}. To replace the PDF, upload the new one and delete this.</p>
    </div>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', variant: 'primary' }],
    beforeClose: (val, dialog) => {
      if (val !== 'ok') return true;
      const title = dialog.querySelector('#cdeTitle').value.trim();
      if (!title) { showToast('Give the document a title.', 'warning'); return false; }
      v = {
        title,
        category: dialog.querySelector('#cdeCat').value,
        description: dialog.querySelector('#cdeDesc').value.trim(),
        order: parseInt(dialog.querySelector('#cdeOrder').value, 10) || 1,
        active: dialog.querySelector('#cdeActive').checked
      };
      return true;
    }
  });
  if (res !== 'ok' || !v) return;
  try {
    await updateDoc(doc(db, 'leagueDocuments', d.id), { ...v, updatedAt: serverTimestamp() });
    showToast('Saved', 'success');
    await load();
  } catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
}

async function remove(i) {
  const d = docs[i];
  if (!d) return;
  if (!(await confirmModal(`Delete "${d.title}"? The PDF file is deleted too.`, { confirmLabel: 'Delete', danger: true }))) return;
  try {
    if (d.storagePath) await deleteObject(ref(storage, d.storagePath)).catch(e => console.warn('[docs] file delete failed', e));
    await deleteDoc(doc(db, 'leagueDocuments', d.id));
    showToast('Deleted', 'success');
    await load();
  } catch (err) { showToast(`Could not delete: ${err.message || err}`, 'error'); }
}

export async function mount(c) {
  ctx = c;
  $('cdCategory').innerHTML = catOptions('league');
  $('cdFile').addEventListener('change', () => pickFile($('cdFile').files[0]));
  const drop = $('cdDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]);
  });
  $('cdUpload').addEventListener('click', upload);
  $('cdList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return edit(Number(ed.dataset.edit));
    const del = e.target.closest('[data-del]');
    if (del) return remove(Number(del.dataset.del));
  });
  await load().catch(err => { $('cdList').innerHTML = `<p class="aces-empty">Could not load: ${esc(err.message || err)}</p>`; });
}
