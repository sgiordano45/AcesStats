// js/admin/records.js
// admin/records.html: fixing player stat records, for admins and league staff.
//
//   What's wrong?  which tool fixes which problem (here, or the tool's own page)
//   Game stats     a team's game stat docs for a season (records-stats.js)
//   Merge records  move one record's stat docs into another (records-merge.js)
//
// Each tab's module loads when it first opens. ?tab=overview|stats|merge;
// the Game stats tab also takes ?team=&season=.

import { initPage, pageReady, siteUrl } from '../core/app.js';
import { hasRole } from '../core/auth.js';
import { escapeHtml as esc } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { mountAdminShell } from './shell.js';

const $ = (id) => document.getElementById(id);
const TABS = ['overview', 'stats', 'merge'];
const MODULES = { stats: () => import('./records-stats.js'), merge: () => import('./records-merge.js') };

// [icon, problem, what to do, [href, label, isHereTab]]
const PROBLEMS = [
  ['edit', "A player's line for a game is wrong", 'Fix the numbers, home or away, or the date on one game doc, or delete a doc that should not exist.', ['?tab=stats', 'Game stats', 'stats']],
  ['users', 'One player shows up twice, or his stats are under the wrong ID', 'Move the stat docs from the stray record into the right one. Covers duplicates, misspelled IDs and legacy records that belong to a linked account.', ['?tab=merge', 'Merge records', 'merge']],
  ['calculator', "A team's game stats are missing or need re-entering", 'Enter or correct a whole game for one team.', ['admin/submit-stats.html', 'Enter stats']],
  ['refresh', 'A tracked game ended but never counted', "Rebuild the game's result from the tracker's saved state, then convert it in Review tracked games.", ['admin/recover-game.html', 'Recover a game']],
  ['scale', "Season totals don't match the games, or a game has the wrong type", 'Compare game stats with season totals and fix regular-season / playoff flags.', ['admin/reconcile.html', 'Reconcile']],
  ['link', 'Stats stuck under an account that was deleted or re-linked', 'Scan for orphaned stats and repair them onto the right player.', ['admin/user-management.html', 'Player records']],
  ['mail', 'Players are missing emails', 'Match a spreadsheet of names and emails to player records.', ['admin/user-management.html', 'Player records']],
  ['user-check', 'An account needs linking to a player', 'Approve the request, or link the account by hand.', ['admin/people.html?tab=links', 'People, Links']]
];

let ctx = null;
const mods = new Map();

function renderOverview() {
  $('rcProblems').innerHTML = PROBLEMS.map(([ic, title, text, [href, label, tab]]) => `<li class="aces-card rc-problem">
    <span class="adm-todo-icon">${icon(ic)}</span>
    <div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>
    ${tab ? `<button class="aces-btn is-sm" type="button" data-goto="${tab}">${esc(label)}</button>`
      : `<a class="aces-btn is-sm" href="${esc(siteUrl(href))}">${esc(label)}</a>`}
  </li>`).join('') + `<li class="aces-card rc-problem is-after">
    <span class="adm-todo-icon">${icon('check-circle')}</span>
    <div><h3>After any fix</h3><p>Re-run the aggregation (test, then production), then badges, so totals, leaderboards and player pages catch up.</p></div>
    <a class="aces-btn is-sm is-primary" href="${esc(siteUrl('admin/stats.html'))}">Stats pipeline</a>
  </li>`;
}

async function setTab(name) {
  const tab = TABS.includes(name) ? name : 'overview';
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  const p = new URLSearchParams(location.search);
  p.set('tab', tab);
  if (tab !== 'stats') { p.delete('team'); p.delete('season'); }
  history.replaceState(null, '', `?${p}`);
  if (tab === 'overview' || mods.has(tab)) return;
  mods.set(tab, MODULES[tab]().then(m => m.mount({ ...ctx, isAdmin: hasRole(ctx.profile, 'admin') })).catch((err) => {
    console.error(`[records] ${tab} failed`, err);
    mods.delete(tab);
    showToast(`Could not load this tab: ${err.message || err}`, 'error');
  }));
}

async function main() {
  ctx = await initPage({ title: 'Records', role: 'league-staff', deniedMessage: 'Record fixes are for league staff and admins.' });
  if (!ctx?.user) return;
  mountAdminShell(ctx.profile, 'admin/records.html');
  renderOverview();
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('rcProblems').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) setTab(b.dataset.goto); });
  pageReady();
  await setTab(new URLSearchParams(location.search).get('tab') || 'overview');
}

main();
