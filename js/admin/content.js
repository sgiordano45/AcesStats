// js/admin/content.js
// admin/content.html: league content.
//
//   Documents  league PDFs on the Rules page (content-docs.js, admins)
//   Feedback   feature requests and bug reports (content-feedback.js, admins)
//   Aceys      award winners, reveals and publishing (content-aceys.js, staff)
//
// Each tab's module loads when it first opens. ?tab=docs|feedback|aceys.
// League staff who are not admins see only Aceys.

import { initPage, pageReady } from '../core/app.js';
import { hasRole } from '../core/auth.js';
import { db, collection, getDocs, query, where } from '../core/firebase.js';
import { showToast } from '../ui/toast.js';
import { mountAdminShell } from './shell.js';

const $ = (id) => document.getElementById(id);
const MODULES = {
  docs: () => import('./content-docs.js'),
  feedback: () => import('./content-feedback.js'),
  aceys: () => import('./content-aceys.js')
};

let ctx = null;
let tabs = [];
const mods = new Map();

async function setTab(name) {
  const tab = tabs.includes(name) ? name : tabs[0];
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  const p = new URLSearchParams(location.search);
  p.set('tab', tab);
  history.replaceState(null, '', `?${p}`);
  if (mods.has(tab)) return;
  mods.set(tab, MODULES[tab]().then(m => m.mount({ ...ctx, isAdmin: hasRole(ctx.profile, 'admin') })).catch((err) => {
    console.error(`[content] ${tab} failed`, err);
    mods.delete(tab);
    showToast(`Could not load this tab: ${err.message || err}`, 'error');
  }));
}

/** New feedback count on the Feedback tab, without loading that tab. */
async function feedbackBadge() {
  try {
    const n = (await getDocs(query(collection(db, 'featureSubmissions'), where('status', '==', 'new')))).size;
    $('ctNewCount').textContent = n;
    $('ctNewCount').hidden = !n;
  } catch { /* the badge is optional */ }
}

async function main() {
  ctx = await initPage({ title: 'Content', role: 'league-staff', deniedMessage: 'Content tools are for league staff and admins.' });
  if (!ctx?.user) return;
  mountAdminShell(ctx.profile, 'admin/content.html');
  const admin = hasRole(ctx.profile, 'admin');
  if (!admin) document.querySelectorAll('[data-admin-only]').forEach(b => { b.hidden = true; });
  tabs = admin ? ['docs', 'feedback', 'aceys'] : ['aceys'];
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  window.addEventListener('content:feedback', feedbackBadge);
  pageReady();
  await setTab(new URLSearchParams(location.search).get('tab') || tabs[0]);
  if (admin) feedbackBadge();
}

main();
