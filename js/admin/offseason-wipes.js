// js/admin/offseason-wipes.js
// Maintenance section of admin/offseason.html (admins): clear offseason
// working data and sandbox seasons. Moved from the old Content admin's
// Offseason Data tab; same docs. None of it touches live season data.
//
//   offseasonRosters/current   + changelog, presence subcollections (roster board)
//   drafts/current             the draft
//   seasons/sandbox-*          + games subcollection (Season setup sandbox runs)

import { db, collection, doc, getDoc, getDocs, deleteDoc } from '../core/firebase.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';

const $ = (id) => document.getElementById(id);
const when = (t) => (t?.toDate ? t.toDate().toLocaleDateString() : 'unknown');

const ITEMS = [
  {
    key: 'roster', title: 'Offseason roster board',
    text: 'offseasonRosters/current with its changelog and presence. Clear it to start next offseason from a fresh board.',
    async status() {
      const s = await getDoc(doc(db, 'offseasonRosters', 'current'));
      if (!s.exists()) return null;
      const d = s.data();
      return `${Object.keys(d.teams || {}).length} teams, last changed ${when(d.lastModified)}`;
    },
    confirm: 'Delete the offseason roster board (offseasonRosters/current, its changelog and presence)? Live season rosters are not touched.',
    async wipe() {
      for (const sub of ['changelog', 'presence']) {
        const snap = await getDocs(collection(db, 'offseasonRosters', 'current', sub)).catch(() => null);
        if (snap) await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(db, 'offseasonRosters', 'current'));
    }
  },
  {
    key: 'draft', title: 'Draft',
    text: 'drafts/current, the draft board and its picks.',
    async status() {
      const s = await getDoc(doc(db, 'drafts', 'current'));
      if (!s.exists()) return null;
      const d = s.data();
      return `${(d.picks || []).length} picks, status ${esc(d.status || 'unknown')}`;
    },
    confirm: 'Delete the draft (drafts/current)? Live season data is not touched.',
    async wipe() { await deleteDoc(doc(db, 'drafts', 'current')); }
  },
  {
    key: 'sandbox', title: 'Sandbox seasons',
    text: 'Seasons whose ID starts with sandbox-, left by Season setup test runs, with their games.',
    async status() {
      const ids = (await getDocs(collection(db, 'seasons'))).docs.map(d => d.id).filter(id => id.startsWith('sandbox-'));
      return ids.length ? `${ids.length}: ${ids.map(esc).join(', ')}` : null;
    },
    confirm: 'Delete every season whose ID starts with "sandbox-", with its games?',
    async wipe() {
      const seasons = (await getDocs(collection(db, 'seasons'))).docs.filter(d => d.id.startsWith('sandbox-'));
      for (const s of seasons) {
        const games = await getDocs(collection(db, 'seasons', s.id, 'games'));
        await Promise.all(games.docs.map(g => deleteDoc(g.ref)));
        await deleteDoc(s.ref);
      }
      return seasons.length;
    }
  }
];

async function refresh(item) {
  const el = $(`om-${item.key}`);
  const btn = document.querySelector(`[data-wipe="${item.key}"]`);
  el.textContent = 'Checking...';
  el.classList.remove('is-some');
  try {
    const s = await item.status();
    el.innerHTML = s ? `Has data: ${s}` : 'Empty';
    el.classList.toggle('is-some', !!s);
    btn.disabled = !s;
  } catch (err) {
    el.textContent = `Could not check: ${err.message || err}`;
    btn.disabled = false;
  }
}

export function mount() {
  const box = $('osMaint');
  box.innerHTML = `<h2 class="aces-card-title">Maintenance</h2>
    <p class="sse-dim">Clear offseason working data once it is no longer needed. None of this touches live season data. Admins only.</p>
    <ul class="om-list">${ITEMS.map(i => `<li class="om-item">
      <div><h3>${esc(i.title)}</h3><p class="sse-dim">${esc(i.text)}</p><p class="om-state" id="om-${i.key}">Checking...</p></div>
      <button class="aces-btn is-sm is-danger" type="button" data-wipe="${i.key}" disabled>Clear</button>
    </li>`).join('')}</ul>`;
  box.hidden = false;
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-wipe]');
    if (!b) return;
    const item = ITEMS.find(i => i.key === b.dataset.wipe);
    if (!(await confirmModal(item.confirm, { title: `Clear ${item.title.toLowerCase()}`, confirmLabel: 'Clear', danger: true }))) return;
    b.disabled = true;
    b.textContent = 'Clearing...';
    try { await item.wipe(); showToast(`Cleared ${item.title.toLowerCase()}`, 'success'); }
    catch (err) { showToast(`Could not clear: ${err.message || err}`, 'error'); }
    b.textContent = 'Clear';
    await refresh(item);
  });
  ITEMS.forEach(refresh);
}
