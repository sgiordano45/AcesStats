// js/admin/people.js
// admin/people.html: everyone with an account, for league staff and admins.
// It replaced Roles, Link players, View As and Content admin's Users tab.
//
//   Members  roles (edit), View As (admins), profile setup, push, last visit
//            (people-members.js)
//   Links    pending link requests and linking accounts by hand
//            (people-links.js)
//   Add      player records for people with no account yet (people-add.js)
//
// The users collection is read once and shared by both tabs; Refresh and any
// save read it again. ?tab=members|links|add opens a tab.

import { initPage, pageReady } from '../core/app.js';
import { hasRole } from '../core/auth.js';
import { db, collection, getDocs } from '../core/firebase.js';
import { showToast } from '../ui/toast.js';
import { mountAdminShell } from './shell.js';

const $ = (id) => document.getElementById(id);
const TABS = ['members', 'links', 'add'];
const MODULES = {
  members: () => import('./people-members.js'),
  links: () => import('./people-links.js'),
  add: () => import('./people-add.js')
};

let ctx = null;
let tab = 'members';
let usersPromise = null;
const mods = new Map();   // tab -> Promise of the module (mounted)

/** All users docs as [{ id, ...data }], read once until reloaded. */
function users({ fresh = false } = {}) {
  if (fresh || !usersPromise) {
    usersPromise = getDocs(collection(db, 'users')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
    usersPromise.catch(() => { usersPromise = null; });
  }
  return usersPromise;
}

/** Re-read users and redraw every tab that has been opened. */
async function refreshAll() {
  await users({ fresh: true });
  await Promise.all([...mods.values()].map(p => p.then(m => m?.refresh?.()).catch(() => {})));
}

async function setTab(name) {
  tab = TABS.includes(name) ? name : 'members';
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  const p = new URLSearchParams(location.search);
  p.set('tab', tab);
  history.replaceState(null, '', `?${p}`);
  if (!mods.has(tab)) {
    const shared = {
      ...ctx,
      isAdmin: hasRole(ctx.profile, 'admin'),
      realIsAdmin: hasRole(ctx.realProfile, 'admin'),
      users,
      refreshAll
    };
    mods.set(tab, MODULES[tab]().then(async (m) => { await m.mount(shared); return m; }).catch((err) => {
      console.error(`[people] ${tab} failed`, err);
      mods.delete(tab);
      showToast(`Could not load this tab: ${err.message || err}`, 'error');
      return null;
    }));
  }
  return mods.get(tab);
}

/** Pending request count on the Links tab, without loading that tab. */
async function linkBadge() {
  try {
    const n = (await users()).reduce((sum, u) => sum + (u.playerLinkRequests || []).filter(r => r.status === 'pending').length, 0);
    $('ppLinkCount').textContent = n;
    $('ppLinkCount').hidden = !n;
  } catch { /* the badge is optional */ }
}

async function main() {
  ctx = await initPage({ title: 'People', role: 'league-staff', deniedMessage: 'People tools are for league staff and admins.' });
  if (!ctx?.user) return;
  mountAdminShell(ctx.profile, 'admin/people.html');
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('ppRefresh').addEventListener('click', async () => {
    const b = $('ppRefresh');
    b.disabled = true;
    try { await refreshAll(); await linkBadge(); showToast('Up to date', 'success'); }
    catch (err) { showToast(`Could not refresh: ${err.message || err}`, 'error'); }
    finally { b.disabled = false; }
  });
  window.addEventListener('people:changed', () => { linkBadge(); });
  pageReady();
  await setTab(new URLSearchParams(location.search).get('tab') || 'members');
  linkBadge();
}

main();
