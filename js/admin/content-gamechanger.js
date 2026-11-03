// js/admin/content-gamechanger.js
// GameChanger tab of admin/content.html: each GC team's Scoreboard Widget
// code. The home page shows a team's widget while its game is on
// (js/data/gamechanger.js, js/pages/home.js).
//
//   Firestore  siteConfig/gamechanger
//     { teams: { <teamKey>: { team, widgetId, link, updatedAt, updatedByName } } }
//
// The code comes from the team's page on web.gc.com: Tools > Create
// Scoreboard Widget. Paste the whole snippet; only the widgetId is kept.
// League staff and admins (siteConfig rules: isStaffOrAdmin).

import { setDoc, updateDoc, getDoc, deleteField, serverTimestamp } from '../core/firebase.js';
import { getDisplaySeasonId } from '../core/config.js';
import { getSeasonSummary } from '../data/summaries.js';
import { gcConfigRef, gcTeamKey, parseGcWidgetId, cleanGcLink, mountGcWidget } from '../data/gamechanger.js';
import { TEAM_COLORS } from '../ui/stat-columns.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';

const $ = (id) => document.getElementById(id);
const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase());

let ctx = null;
let saved = {};   // teamKey -> stored entry
let teams = [];   // [{ key, team }] current season's teams plus any saved ones

async function seasonTeams() {
  try {
    const seasonId = await getDisplaySeasonId();
    const { summary } = await getSeasonSummary(seasonId, { allowBuild: false });
    const names = (summary?.standings || []).map(r => r.team).filter(Boolean);
    if (names.length) return names;
  } catch (err) {
    console.warn('[gamechanger] season teams unavailable', err);
  }
  return [...TEAM_COLORS].filter(k => k !== 'white').map(titleCase);
}

async function load() {
  const [snap, names] = await Promise.all([getDoc(gcConfigRef()), seasonTeams()]);
  saved = snap.exists() ? (snap.data().teams || {}) : {};
  const byKey = new Map(names.map(n => [gcTeamKey(n), n]));
  for (const [key, v] of Object.entries(saved)) if (!byKey.has(key)) byKey.set(key, v.team || titleCase(key));
  teams = [...byKey].map(([key, team]) => ({ key, team })).sort((a, b) => a.team.localeCompare(b.team));
  render();
}

function render() {
  const on = teams.filter(t => saved[t.key]?.widgetId).length;
  $('cgCount').textContent = `${on} of ${teams.length} teams have a GameChanger widget.`;
  $('cgList').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact ct-table">
    <thead><tr><th scope="col">Team</th><th scope="col">Widget</th><th scope="col">GC page</th><th scope="col">Updated</th><th scope="col"><span class="u-sr-only">Actions</span></th></tr></thead>
    <tbody>${teams.map(({ key, team }) => {
      const v = saved[key] || {};
      const when = v.updatedAt?.toDate ? v.updatedAt.toDate().toLocaleDateString() : '';
      return `<tr>
        <td><strong>${esc(team)}</strong></td>
        <td>${v.widgetId ? `<span class="aces-badge is-win">Set</span><span class="ct-sub ct-gc-id">${esc(v.widgetId)}</span>` : '<span class="aces-badge is-outline">None</span>'}</td>
        <td>${v.link ? `<a href="${esc(v.link)}" target="_blank" rel="noopener">Open</a>` : '<span class="sse-dim">-</span>'}</td>
        <td class="u-nowrap">${esc(when)}${v.updatedByName ? `<span class="ct-sub">${esc(v.updatedByName)}</span>` : ''}</td>
        <td class="ct-row-actions">
          ${v.widgetId ? `<button class="aces-btn is-sm is-ghost" type="button" data-gc-preview="${esc(key)}">Preview</button>` : ''}
          <button class="aces-btn is-sm" type="button" data-gc-edit="${esc(key)}">${v.widgetId ? 'Edit' : 'Add code'}</button>
          ${v.widgetId ? `<button class="aces-btn is-sm is-ghost" type="button" data-gc-del="${esc(key)}">Remove</button>` : ''}
        </td></tr>`;
    }).join('')}</tbody></table></div>`;
}

async function edit(key) {
  const t = teams.find(x => x.key === key);
  if (!t) return;
  const v = saved[key] || {};
  let out = null;
  const res = await openModal({
    title: `${t.team}: GameChanger widget`,
    wide: true,
    html: `<div class="ct-edit">
      <p class="sse-dim">On web.gc.com, open ${esc(t.team)}'s team page, go to Tools and choose Create Scoreboard Widget. Paste the whole code here.</p>
      <div class="aces-field"><label class="aces-label" for="cgeCode">Widget code</label>
        <textarea class="aces-textarea ct-gc-code" id="cgeCode" rows="7" spellcheck="false" placeholder="&lt;div id=&quot;gc-schedule-widget-...&quot;&gt;&lt;/div&gt; ... widgetId: &quot;...&quot;">${esc(v.widgetId || '')}</textarea></div>
      <div class="aces-field"><label class="aces-label" for="cgeLink">GameChanger team page link (optional)</label>
        <input class="aces-input" id="cgeLink" type="url" placeholder="https://web.gc.com/teams/..." value="${esc(v.link || '')}">
        <span class="sse-dim">Tools, then Copy Link under Social. Adds a "Follow live on GameChanger" button under the widget.</span></div>
    </div>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', variant: 'primary' }],
    beforeClose: (val, dialog) => {
      if (val !== 'ok') return true;
      const widgetId = parseGcWidgetId(dialog.querySelector('#cgeCode').value);
      if (!widgetId) { showToast('No widgetId found. Paste the whole code from GameChanger.', 'warning'); return false; }
      const rawLink = dialog.querySelector('#cgeLink').value.trim();
      const link = cleanGcLink(rawLink);
      if (rawLink && !link) { showToast('The link should be a GameChanger page (https://...gc.com/...).', 'warning'); return false; }
      out = { widgetId, link };
      return true;
    }
  });
  if (res !== 'ok' || !out) return;
  try {
    await setDoc(gcConfigRef(), { teams: { [key]: {
      team: t.team, widgetId: out.widgetId, link: out.link,
      updatedAt: serverTimestamp(), updatedByName: ctx.profile?.displayName || ctx.user?.email || ''
    } } }, { merge: true });
    showToast(`Saved ${t.team}'s GameChanger widget.`, 'success');
    await load();
    preview(key);
  } catch (err) {
    console.error('[gamechanger] save', err);
    showToast(`Could not save: ${err.message || err}`, 'error');
  }
}

async function remove(key) {
  const t = teams.find(x => x.key === key);
  const ok = await confirmModal(`Remove ${t?.team || key}'s GameChanger widget? The home page stops showing it.`, { title: 'Remove widget', confirmLabel: 'Remove', danger: true });
  if (!ok) return;
  try {
    await updateDoc(gcConfigRef(), { [`teams.${key}`]: deleteField() });
    showToast('Removed.', 'success');
    if ($('cgPreviewCard').dataset.key === key) closePreview();
    await load();
  } catch (err) {
    console.error('[gamechanger] remove', err);
    showToast(`Could not remove: ${err.message || err}`, 'error');
  }
}

function closePreview() {
  const card = $('cgPreviewCard');
  card.hidden = true;
  delete card.dataset.key;
  $('cgPreview').innerHTML = '';
}

function preview(key) {
  const v = saved[key];
  if (!v?.widgetId) return;
  const card = $('cgPreviewCard');
  card.hidden = false;
  card.dataset.key = key;
  $('cgPreviewTitle').textContent = `Preview: ${v.team || titleCase(key)}`;
  // A fresh element each time, so GC sets up a clean widget.
  const box = document.createElement('div');
  box.className = 'ct-gc-widget';
  $('cgPreview').replaceChildren(box);
  mountGcWidget(box, v.widgetId).catch((err) => {
    console.warn('[gamechanger] preview', err);
    box.innerHTML = `<p class="aces-empty">The GameChanger widget could not load: ${esc(err.message || err)}</p>`;
  });
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function mount(c) {
  ctx = c;
  $('cgList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gc-edit],[data-gc-del],[data-gc-preview]');
    if (!b) return;
    if (b.dataset.gcEdit) edit(b.dataset.gcEdit);
    else if (b.dataset.gcDel) remove(b.dataset.gcDel);
    else preview(b.dataset.gcPreview);
  });
  $('cgPreviewClose').addEventListener('click', closePreview);
  await load();
}
