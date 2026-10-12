// js/admin/league-staff.js
// admin/league-staff.html: the league office for league staff and admins.
// Rebuilt from the old League Staff Admin and Commissioner Hub pages.
//
//   Today          standings, tonight's games, seeding, latest results, each
//                  shareable as an image or text (ls-today.js)
//   Schedule       edit one game (the Schedule hub's editor, schedule-editor.js)
//   Banners        home page league-news messages (ls-banners.js)
//   Notifications  push notifications, test, unsend, cleanup (ls-notify.js)
//   Email          BCC email through Resend (ls-email.js)
//   Signup import  signup list -> Offseason rosters board (ls-signups.js)
//   Stats export   a season's stats as Excel (ls-export.js)
//
// Each tab's module loads the first time the tab opens. ?tab= opens one;
// the Schedule tab also takes ?season= and ?game=.

import { initPage, pageReady } from '../core/app.js';
import { hasRole } from '../core/auth.js';
import { getAllSeasons } from '../data/seasons.js';
import { seasonLabel, sortSeasonIds } from '../domain/season-ids.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { mountAdminShell } from './shell.js';
import { mountEditor, editorSeason } from './schedule-editor.js';

const $ = (id) => document.getElementById(id);
const TABS = ['today', 'schedule', 'banners', 'notify', 'email', 'signups', 'export'];
const MODULES = {
  today: () => import('./ls-today.js'),
  banners: () => import('./ls-banners.js'),
  notify: () => import('./ls-notify.js'),
  email: () => import('./ls-email.js'),
  signups: () => import('./ls-signups.js'),
  export: () => import('./ls-export.js')
};

let ctx = null;
let tab = 'today';
let seasonIds = [];
let scheduleReady = false;
const mounted = new Map();   // tab -> Promise of its module's mount()

/** What every tab module gets: who is signed in, the seasons, a name to stamp writes with. */
function tabContext() {
  return {
    ...ctx,
    isAdmin: hasRole(ctx.profile, 'admin'),
    seasonIds,
    currentSeasonId: ctx.config?.currentSeasonId || seasonIds[0] || '',
    who: ctx.realProfile?.displayName || ctx.realProfile?.name || ctx.user?.displayName || ctx.user?.email || ''
  };
}

async function openSchedule(game = '') {
  const sel = $('lsSeason');
  if (!scheduleReady) {
    scheduleReady = true;
    mountEditor(ctx);
    const params = new URLSearchParams(location.search);
    const start = [params.get('season'), ctx.config?.currentSeasonId, seasonIds[0]].find(id => id && seasonIds.includes(id)) || '';
    sel.innerHTML = seasonIds.map(id => `<option value="${esc(id)}">${esc(seasonLabel(id))}${id === ctx.config?.currentSeasonId ? ' (current)' : ''}</option>`).join('');
    sel.value = start;
    sel.addEventListener('change', () => {
      const p = new URLSearchParams(location.search);
      p.set('season', sel.value);
      p.delete('game');
      history.replaceState(null, '', `?${p}`);
      editorSeason(sel.value, '', true);
    });
  }
  if (sel.value) await editorSeason(sel.value, game);
}

async function setTab(name, { game = '' } = {}) {
  tab = TABS.includes(name) ? name : 'today';
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  const p = new URLSearchParams(location.search);
  p.set('tab', tab);
  if (tab !== 'schedule') { p.delete('game'); p.delete('season'); }
  history.replaceState(null, '', `?${p}`);

  if (tab === 'schedule') return openSchedule(game);
  if (!mounted.has(tab)) {
    mounted.set(tab, MODULES[tab]()
      .then(m => m.mount(tabContext()))
      .catch((err) => {
        console.error(`[league-staff] ${tab} failed`, err);
        mounted.delete(tab);
        showToast(`Could not load this tab: ${err.message || err}`, 'error');
      }));
  }
  return mounted.get(tab);
}

async function main() {
  ctx = await initPage({ title: 'League staff', role: 'league-staff', deniedMessage: 'League staff tools are for league staff and admins.' });
  if (!ctx?.user) return;
  mountAdminShell(ctx.profile, 'admin/league-staff.html');
  $('adminWho').textContent = hasRole(ctx.profile, 'admin') ? 'Admin' : 'League staff';

  seasonIds = sortSeasonIds((await getAllSeasons().catch(() => [])).map(s => s.id));

  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  pageReady();
  const params = new URLSearchParams(location.search);
  // Old links: league-staff-admin had ?tab=notifications / roster / statsexport.
  const alias = { notifications: 'notify', roster: 'signups', statsexport: 'export' };
  const want = params.get('tab') || 'today';
  await setTab(alias[want] || want, { game: params.get('game') || '' });
}

main();
