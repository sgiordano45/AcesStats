// js/admin/oop-homers.js
// admin/oop-homers.html: flag true out-of-park home runs (moved out of the
// retired Bulk stats fixes page; same docs). current-season.js reads them for
// the badge on the HR leaders.
//
//   outOfParkHRs/{legacyId}_{seasonId}_{date|unspecified}
//     { playerName, playerLegacyId, seasonId, gameDate|null, count, addedAt }
//
// Flagging the same player, season and date again replaces that doc (as before).

import { initPage, pageReady } from '../core/app.js';
import { db, collection, doc, getDocs, setDoc, deleteDoc, query, where } from '../core/firebase.js';
import { getAllSeasons } from '../data/seasons.js';
import { seasonLabel, sortSeasonIds } from '../domain/season-ids.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { teamDot } from '../ui/game-shared.js';
import { mountAdminShell } from './shell.js';

const $ = (id) => document.getElementById(id);
const legacyId = (name) => String(name || '').toLowerCase().replace(/\./g, '').trim().replace(/\s+/g, '_');
let flagged = [];      // this season's outOfParkHRs docs
let hitters = [];      // [{ name, team, hrs }]

const season = () => $('ohSeason').value;

async function load() {
  const sid = season();
  $('ohScan').innerHTML = '<p class="sse-dim">Loading...</p>';
  const [stats, oop] = await Promise.all([
    getDocs(collection(db, 'aggregatedPlayerStats')),
    getDocs(query(collection(db, 'outOfParkHRs'), where('seasonId', '==', sid)))
  ]);
  flagged = oop.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.playerName).localeCompare(String(b.playerName)) || String(a.gameDate || '').localeCompare(String(b.gameDate || '')));
  hitters = [];
  stats.forEach(d => {
    const p = d.data();
    if (p.migrated === true || !p.name) return;
    Object.entries(p.seasons || {}).forEach(([k, s]) => {
      if ((k === sid || k.startsWith(`${sid}-`) || k.startsWith(`${sid}_`)) && (s.homeRuns || 0) > 0) {
        const have = hitters.find(h => h.name === p.name);
        if (have) have.hrs += s.homeRuns; else hitters.push({ name: p.name, team: s.team || p.currentTeam || '', hrs: s.homeRuns });
      }
    });
  });
  hitters.sort((a, b) => b.hrs - a.hrs || a.name.localeCompare(b.name));
  $('ohNames').innerHTML = hitters.map(h => `<option value="${esc(h.name)}"></option>`).join('');
  render();
}

const flaggedFor = (name) => flagged.filter(f => String(f.playerName).toLowerCase().trim() === name.toLowerCase().trim()).reduce((n, f) => n + (f.count || 1), 0);

function render() {
  if (!hitters.length) {
    $('ohScan').innerHTML = `<p class="aces-empty">No home runs in the ${esc(seasonLabel(season()))} totals yet.</p>`;
  } else {
    const total = hitters.reduce((n, h) => n + h.hrs, 0);
    const outs = hitters.reduce((n, h) => n + flaggedFor(h.name), 0);
    $('ohScan').innerHTML = `<p class="sse-dim">${hitters.length} players, ${total} home runs, ${outs} flagged out of the park.</p>
      <div class="aces-table-wrap"><table class="aces-table is-compact rc-oop">
        <thead><tr><th scope="col">Player</th><th scope="col" class="is-num">HR</th><th scope="col" class="is-num">Out of park</th><th scope="col"><span class="u-sr-only">Flag</span></th></tr></thead>
        <tbody>${hitters.map((h, i) => {
          const n = flaggedFor(h.name);
          return `<tr><td>${teamDot(h.team)}${esc(h.name)}</td><td class="is-num">${h.hrs}</td>
            <td class="is-num">${n ? `<strong${n > h.hrs ? ' class="rc-warn" title="More flagged than hit"' : ''}>${n}</strong>` : '<span class="sse-dim">0</span>'}</td>
            <td class="rc-row-actions"><button class="aces-btn is-sm" type="button" data-flag="${i}">Flag</button></td></tr>`;
        }).join('')}</tbody></table></div>`;
  }
  $('ohList').innerHTML = flagged.length
    ? `<div class="aces-table-wrap"><table class="aces-table is-compact rc-oop">
        <thead><tr><th scope="col">Player</th><th scope="col">Game date</th><th scope="col" class="is-num">Count</th><th scope="col"><span class="u-sr-only">Remove</span></th></tr></thead>
        <tbody>${flagged.map(f => `<tr><td>${esc(f.playerName || '-')}</td><td>${esc(f.gameDate || 'Not given')}</td><td class="is-num">${esc(f.count || 1)}</td>
          <td class="rc-row-actions"><button class="aces-btn is-sm is-ghost" type="button" data-unflag="${esc(f.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>`
    : `<p class="aces-empty">Nothing flagged for ${esc(seasonLabel(season()))}.</p>`;
}

async function save(name, gameDate, count) {
  const sid = season();
  const id = `${legacyId(name)}_${sid}_${gameDate || 'unspecified'}`;
  await setDoc(doc(db, 'outOfParkHRs', id), { playerName: name, playerLegacyId: legacyId(name), seasonId: sid, gameDate: gameDate || null, count, addedAt: new Date() });
  showToast(`Flagged ${count} for ${name}`, 'success');
  await load();
}

async function flagFromRow(i) {
  const h = hitters[i];
  if (!h) return;
  let v = null;
  const res = await openModal({
    title: `Flag ${h.name}`,
    html: `<div class="rc-row">
      <div class="aces-field"><label class="aces-label" for="ohmDate">Game date</label><input class="aces-input" id="ohmDate" type="date"></div>
      <div class="aces-field"><label class="aces-label" for="ohmCount">How many</label><input class="aces-input" id="ohmCount" type="number" min="1" max="4" value="1"></div>
    </div>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Flag', value: 'ok', variant: 'primary' }],
    beforeClose: (val, dialog) => {
      if (val === 'ok') v = { date: dialog.querySelector('#ohmDate').value, count: parseInt(dialog.querySelector('#ohmCount').value, 10) || 1 };
      return true;
    }
  });
  if (res !== 'ok' || !v) return;
  try { await save(h.name, v.date, v.count); } catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
}

async function main() {
  const ctx = await initPage({ title: 'Out-of-park home runs', role: 'league-staff', deniedMessage: 'This is a league staff tool.' });
  if (!ctx?.user) return;
  mountAdminShell(ctx.profile, 'admin/oop-homers.html');
  const ids = sortSeasonIds((await getAllSeasons().catch(() => [])).map(s => s.id)).filter(id => /^\d{4}-/.test(id));
  const current = ctx.config?.currentSeasonId || ids[0] || '';
  $('ohSeason').innerHTML = ids.map(id => `<option value="${esc(id)}">${esc(seasonLabel(id))}${id === current ? ' (current)' : ''}</option>`).join('');
  $('ohSeason').value = current;
  $('ohSeason').addEventListener('change', () => load().catch(err => showToast(`Could not load: ${err.message || err}`, 'error')));
  $('ohAdd').addEventListener('click', async () => {
    const name = $('ohName').value.trim();
    if (!name) { showToast('Type the player.', 'warning'); return; }
    try {
      await save(name, $('ohDate').value, parseInt($('ohCount').value, 10) || 1);
      $('ohName').value = ''; $('ohDate').value = ''; $('ohCount').value = '1';
    } catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
  });
  document.querySelector('.adm-main').addEventListener('click', async (e) => {
    const f = e.target.closest('[data-flag]');
    if (f) return flagFromRow(Number(f.dataset.flag));
    const u = e.target.closest('[data-unflag]');
    if (u) {
      if (!(await confirmModal('Remove this out-of-park flag?', { confirmLabel: 'Remove', danger: true }))) return;
      try { await deleteDoc(doc(db, 'outOfParkHRs', u.dataset.unflag)); showToast('Removed', 'success'); await load(); }
      catch (err) { showToast(`Could not remove: ${err.message || err}`, 'error'); }
    }
  });
  pageReady();
  await load().catch(err => { $('ohScan').innerHTML = `<p class="aces-empty">Could not load: ${esc(err.message || err)}</p>`; });
}

main();
