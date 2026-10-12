// js/admin/records-stats.js
// The Game stats tab of admin/records.html (it replaced Player stats editor):
// every game stat doc of one team's rostered players for a season, from
// playerStats/{legacyId}/games (batting) or pitchingStats/{legacyId}/games
// (pitching) where seasonId matches. Edit a row in a dialog, or delete rows.
//
// Fixed from the old page: rows are picked by player AND game (the old page
// keyed the selection on the game doc ID alone, which every player in that
// game shares, so "Delete selected" removed the whole game's docs); the
// batting dialog edits all eight counted fields (2B, 3B and RBI were missing);
// rows that don't add up (more hits than at-bats, more extra-base hits than
// hits, negatives) are flagged and can be filtered.
// Subs who played for the team but sit on another roster are not listed: their
// docs are under their own team's roster.

import { db, collection, doc, getDocs, query, where, updateDoc, deleteDoc, serverTimestamp } from '../core/firebase.js';
import { getAllSeasons } from '../data/seasons.js';
import { getSeasonGames } from '../data/games.js';
import { normalizeGames } from '../domain/standings.js';
import { seasonLabel, sortSeasonIds } from '../domain/season-ids.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { getTeamRosterDoc } from '../../firebase-roster.js';

const $ = (id) => document.getElementById(id);
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const BAT = [['atBats', 'AB'], ['hits', 'H'], ['doubles', '2B'], ['triples', '3B'], ['homeRuns', 'HR'], ['runs', 'R'], ['rbi', 'RBI'], ['walks', 'BB']];
const PIT = [['inningsPitched', 'IP'], ['runsAllowed', 'RA']];

let ctx = null;
let rows = [];          // { key, kind, playerId, playerName, docId, data }
let kind = 'batting';
const picked = new Set();
let loaded = { team: '', season: '' };

const keyOf = (r) => `${r.kind}|${r.playerId}|${r.docId}`;
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function problems(r) {
  if (r.kind !== 'batting') return [];
  const d = r.data, out = [];
  BAT.forEach(([f, l]) => { if (num(d[f]) !== null && num(d[f]) < 0) out.push(`${l} below zero`); });
  if ((num(d.hits) || 0) > (num(d.atBats) || 0)) out.push('more hits than at-bats');
  if ((num(d.doubles) || 0) + (num(d.triples) || 0) + (num(d.homeRuns) || 0) > (num(d.hits) || 0)) out.push('more extra-base hits than hits');
  return out;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function fillPickers() {
  const params = new URLSearchParams(location.search);
  const ids = sortSeasonIds((await getAllSeasons().catch(() => [])).map(s => s.id)).filter(id => /^\d{4}-/.test(id));
  const current = ctx.config?.currentSeasonId || ids[0] || '';
  $('rsSeason').innerHTML = ids.map(id => `<option value="${esc(id)}">${esc(seasonLabel(id))}${id === current ? ' (current)' : ''}</option>`).join('');
  $('rsSeason').value = params.get('season') && ids.includes(params.get('season')) ? params.get('season') : current;
  await fillTeams(params.get('team') || '');
}

async function fillTeams(want = '') {
  const games = await getSeasonGames($('rsSeason').value).catch(() => []);
  const teams = [...new Set(normalizeGames(games).flatMap(g => [g.home, g.away]).filter(t => t && t !== 'TBD').map(t => t.toLowerCase()))].sort();
  $('rsTeam').innerHTML = '<option value="">Choose a team</option>' + teams.map(t => `<option value="${esc(t)}">${esc(cap(t))}</option>`).join('');
  if (want && teams.includes(want.toLowerCase())) $('rsTeam').value = want.toLowerCase();
}

async function load() {
  const team = $('rsTeam').value, season = $('rsSeason').value;
  kind = $('rsKind').value;
  if (!team || !season) { showToast('Choose a team and season.', 'warning'); return; }
  const btn = $('rsLoad');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const roster = await getTeamRosterDoc(team, season);
    if (!roster.length) { showToast(`No ${cap(team)} roster for ${seasonLabel(season)}.`, 'warning'); return; }
    const coll = kind === 'batting' ? 'playerStats' : 'pitchingStats';
    const found = await Promise.all(roster.filter(p => p.legacyId).map(async (p) => {
      try {
        const snap = await getDocs(query(collection(db, coll, p.legacyId, 'games'), where('seasonId', '==', season)));
        return snap.docs.map(d => ({ kind, playerId: p.legacyId, playerName: p.name || p.legacyId, docId: d.id, data: d.data() }));
      } catch (err) { console.warn(`[records] ${coll}/${p.legacyId}`, err); return []; }
    }));
    rows = found.flat().map(r => ({ ...r, key: keyOf(r) }));
    rows.sort((a, b) => String(b.data.gameDateFormatted || '').localeCompare(String(a.data.gameDateFormatted || '')) || a.playerName.localeCompare(b.playerName));
    picked.clear();
    loaded = { team, season };
    const p = new URLSearchParams(location.search);
    p.set('team', team); p.set('season', season);
    history.replaceState(null, '', `?${p}`);
    $('rsResults').hidden = false;
    render();
    showToast(`${rows.length} game docs for ${roster.length} players`, 'success');
  } catch (err) {
    console.error('[records] load', err);
    showToast(`Could not load: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load';
  }
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function shown() {
  const q = $('rsFind').value.trim().toLowerCase();
  const onlyBad = $('rsOnlyBad').checked;
  return rows.filter(r => {
    if (onlyBad && !problems(r).length) return false;
    if (!q) return true;
    const d = r.data;
    return [r.playerName, d.opponent, d.gameDateFormatted, r.docId].some(v => String(v || '').toLowerCase().includes(q));
  });
}

function render() {
  const list = shown();
  const fields = kind === 'batting' ? BAT : PIT;
  const bad = rows.filter(r => problems(r).length).length;
  const tile = (v, l) => `<div class="aces-stat"><span class="aces-stat-value">${v}</span><span class="aces-stat-label">${esc(l)}</span></div>`;
  $('rsTiles').innerHTML = tile(new Set(rows.map(r => r.playerId)).size, 'Players') + tile(new Set(rows.map(r => r.data.gameDocId || r.docId)).size, 'Games')
    + tile(rows.length, kind === 'batting' ? 'Batting docs' : 'Pitching docs') + tile(bad, "Don't add up");
  const allOn = list.length && list.every(r => picked.has(r.key));
  $('rsTable').innerHTML = `<thead><tr>
      <th scope="col" class="rc-pick"><input type="checkbox" data-pick-all aria-label="Select all shown"${allOn ? ' checked' : ''}></th>
      <th scope="col">Player</th><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col">H/A</th>
      ${fields.map(([, l]) => `<th scope="col" class="is-num">${l}</th>`).join('')}
      <th scope="col">Game doc</th><th scope="col" class="rc-row-actions"><span class="u-sr-only">Actions</span></th>
    </tr></thead>
    <tbody>${list.length ? list.map(r => {
      const d = r.data, issues = problems(r);
      return `<tr class="${picked.has(r.key) ? 'is-picked' : ''}${issues.length ? ' is-bad' : ''}">
        <td class="rc-pick"><input type="checkbox" data-pick="${esc(r.key)}"${picked.has(r.key) ? ' checked' : ''} aria-label="Select ${esc(r.playerName)}, ${esc(d.gameDateFormatted || r.docId)}"></td>
        <td>${esc(r.playerName)}${issues.length ? `<small class="rc-issue">${esc(issues.join(', '))}</small>` : ''}</td>
        <td class="rc-date">${esc(d.gameDateFormatted || '-')}</td>
        <td>${esc(cap(d.opponent) || '-')}</td>
        <td>${d.isHome === true ? 'Home' : d.isHome === false ? 'Away' : '-'}</td>
        ${fields.map(([f]) => `<td class="is-num">${esc(d[f] ?? '-')}</td>`).join('')}
        <td class="rc-docid" title="${esc(r.docId)}">${esc(r.docId)}</td>
        <td class="rc-row-actions"><button class="aces-btn is-sm" type="button" data-edit="${esc(r.key)}">Edit</button><button class="aces-btn is-sm is-ghost" type="button" data-del="${esc(r.key)}">Delete</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="${fields.length + 7}" class="aces-empty">No game docs match.</td></tr>`}</tbody>`;
  $('rsBulk').hidden = !picked.size;
  $('rsPicked').textContent = `${picked.size} selected`;
}

// ---------------------------------------------------------------------------
// Edit and delete
// ---------------------------------------------------------------------------

const refOf = (r) => doc(db, r.kind === 'batting' ? 'playerStats' : 'pitchingStats', r.playerId, 'games', r.docId);

async function edit(key) {
  const r = rows.find(x => x.key === key);
  if (!r) return;
  const d = r.data;
  const fields = r.kind === 'batting' ? BAT : PIT;
  let values = null;
  const res = await openModal({
    title: `${r.playerName}, ${d.gameDateFormatted || r.docId}`,
    wide: true,
    html: `<form class="rc-edit" onsubmit="return false">
      <p class="sse-dim rc-docid-line">${esc(r.kind === 'batting' ? 'playerStats' : 'pitchingStats')}/${esc(r.playerId)}/games/${esc(r.docId)}</p>
      <div class="rc-edit-grid">
        <div class="aces-field"><label class="aces-label" for="reDate">Date</label><input class="aces-input" id="reDate" type="text" value="${esc(d.gameDateFormatted || '')}" placeholder="YYYY-MM-DD"></div>
        <div class="aces-field"><label class="aces-label" for="reOpp">Opponent</label><input class="aces-input" id="reOpp" type="text" value="${esc(d.opponent || '')}"></div>
        <div class="aces-field"><label class="aces-label" for="reHome">Home or away</label><span class="aces-select-wrap"><select class="aces-select" id="reHome">
          <option value="true"${d.isHome === true ? ' selected' : ''}>Home</option><option value="false"${d.isHome === false ? ' selected' : ''}>Away</option></select></span></div>
        <div class="aces-field"><label class="aces-label" for="reTeam">Team ID</label><input class="aces-input" id="reTeam" type="text" value="${esc(d.teamId || '')}"></div>
      </div>
      <div class="rc-edit-nums">${fields.map(([f, l]) => `<div class="aces-field"><label class="aces-label" for="re_${f}">${l}</label>
        <input class="aces-input" id="re_${f}" data-field="${f}" type="number" min="0" step="${f === 'inningsPitched' ? '0.1' : '1'}" value="${esc(d[f] ?? '')}"></div>`).join('')}</div>
      ${r.kind === 'pitching' ? '<p class="sse-dim">Innings in thirds: 5.1 is 5 1/3, 5.2 is 5 2/3.</p>' : ''}
      <p class="rc-edit-warn" id="reWarn" hidden></p>
    </form>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', variant: 'primary' }],
    onOpen: (dialog) => {
      const check = () => {
        const v = {};
        dialog.querySelectorAll('[data-field]').forEach(i => { v[i.dataset.field] = i.value === '' ? 0 : Number(i.value); });
        const issues = problems({ kind: r.kind, data: v });
        const w = dialog.querySelector('#reWarn');
        w.hidden = !issues.length;
        w.textContent = issues.length ? `Check this: ${issues.join(', ')}.` : '';
      };
      dialog.querySelectorAll('[data-field]').forEach(i => i.addEventListener('input', check));
      check();
    },
    beforeClose: (v, dialog) => {
      if (v !== 'save') return true;
      const date = dialog.querySelector('#reDate').value.trim();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('Write the date as YYYY-MM-DD.', 'warning'); return false; }
      values = {
        gameDateFormatted: date,
        opponent: dialog.querySelector('#reOpp').value.trim(),
        isHome: dialog.querySelector('#reHome').value === 'true',
        teamId: dialog.querySelector('#reTeam').value.trim()
      };
      dialog.querySelectorAll('[data-field]').forEach(i => {
        values[i.dataset.field] = i.dataset.field === 'inningsPitched' ? (Number(i.value) || 0) : (parseInt(i.value, 10) || 0);
      });
      return true;
    }
  });
  if (res !== 'save' || !values) return;
  try {
    await updateDoc(refOf(r), { ...values, lastModified: serverTimestamp(), editedBy: ctx.user.uid, editedVia: 'records' });
    Object.assign(r.data, values);
    render();
    showToast('Saved. Re-aggregate to update totals.', 'success');
  } catch (err) {
    console.error('[records] save', err);
    showToast(`Could not save: ${err.message || err}`, 'error');
  }
}

async function remove(keys) {
  const list = rows.filter(r => keys.includes(r.key));
  if (!list.length) return;
  const who = [...new Set(list.map(r => r.playerName))];
  const msg = list.length === 1
    ? `Delete ${list[0].playerName}'s ${list[0].kind} stats for ${list[0].data.gameDateFormatted || list[0].docId}? This can't be undone.`
    : `Delete ${list.length} ${kind} game docs (${who.slice(0, 6).join(', ')}${who.length > 6 ? ` and ${who.length - 6} more` : ''})? This can't be undone.`;
  if (!(await confirmModal(msg, { danger: true, confirmLabel: list.length === 1 ? 'Delete' : `Delete ${list.length}` }))) return;
  let ok = 0, failed = 0;
  for (const r of list) {
    try { await deleteDoc(refOf(r)); ok++; rows = rows.filter(x => x.key !== r.key); picked.delete(r.key); }
    catch (err) { console.error('[records] delete', r.key, err); failed++; }
  }
  render();
  showToast(`Deleted ${ok}${failed ? `, ${failed} failed` : ''}. Re-aggregate to update totals.`, failed ? 'warning' : 'success');
}

export async function mount(c) {
  ctx = c;
  await fillPickers();
  $('rsSeason').addEventListener('change', () => fillTeams($('rsTeam').value));
  $('rsLoad').addEventListener('click', load);
  $('rsFind').addEventListener('input', render);
  $('rsOnlyBad').addEventListener('change', render);
  $('rsDeletePicked').addEventListener('click', () => remove([...picked]));
  $('rsClearPicked').addEventListener('click', () => { picked.clear(); render(); });
  $('rsTable').addEventListener('change', (e) => {
    if (e.target.matches('[data-pick-all]')) { shown().forEach(r => (e.target.checked ? picked.add(r.key) : picked.delete(r.key))); render(); return; }
    const k = e.target.closest('[data-pick]')?.dataset.pick;
    if (k) { if (e.target.checked) picked.add(k); else picked.delete(k); render(); }
  });
  $('rsTable').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return edit(ed.dataset.edit);
    const del = e.target.closest('[data-del]');
    if (del) return remove([del.dataset.del]);
  });
  if (new URLSearchParams(location.search).get('team') && $('rsTeam').value) load();
}
