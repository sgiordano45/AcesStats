// js/admin/content-aceys.js
// Aceys tab of admin/content.html: set winners, control the reveal on the
// public page (aceys-2026.html), and publish winners to player profiles
// (moved from admin/aceys.html, same docs).
//
//   aceyAwards/{awardId}   one per award, live (onSnapshot)
//     { players: [{ name, playerId, legacyId }], playerName, playerId, legacyId
//       (first winner, kept for older readers), playerNames (multi-winner
//       awards, free text "POS - Name (Team)"), note, active, revealed,
//       revealedAt, source: 'write-in', label (write-ins) }
//   aceyControl/display    { supreme } for the ceremony screen
//   awards/{season}_{category slug}_{player slug}   what Publish writes
//     { category, playerName, playerId, legacyId, team, position, seasonId,
//       value: null, source: 'aceys', aceyAwardId, createdAt }
//
// Award ids and the publish season are this year's; change YEAR and
// PUBLISH_SEASON_ID (and the award list) for the next ceremony.

import { siteUrl } from '../core/app.js';
import { db, collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, writeBatch, query, where, serverTimestamp } from '../core/firebase.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { icon } from '../ui/icons.js';
import { statIdOf } from '../domain/player-id.js';

const $ = (id) => document.getElementById(id);
const YEAR = '2026';
const PUBLISH_SEASON_ID = '2026-summer';
const RETIRED_TEAMS = ['kings', 'white'];

const INDIVIDUAL = [
  ['mvp', 'MVP', 'mvp.png', 'MVP'],
  ['pitcher', 'Pitcher of the Year', 'pitcher_of_the_year.png', 'Pitcher of the Year'],
  ['rookie', 'Rookie of the Year', 'rookie_of_the_year.png', 'Rookie of the Year'],
  ['comeback', 'Comeback Player of the Year', 'comeback_player_of_the_year.png', 'Comeback Player of the Year'],
  ['slugger', 'Slugger of the Year', 'slugger_of_the_year.png', 'Slugger of the Year'],
  ['most-improved', 'Most Improved Ace', 'most_improved_ace.png', 'Most Improved Ace'],
  ['iron-man', 'Iron Man Award', 'iron_man_award.png', 'Iron Man Award'],
  ['captain', 'Captain of the Year', 'captain_of_the_year.png', 'Captain of the Year'],
  ['sub', 'Sub of the Year', 'sub_of_the_year.png', 'Sub of the Year'],
  ['good-guy', 'Al Pineda Good Guy Award', 'al_pineda_good_guy_award.png', 'Al Pineda Good Guy Award'],
  // The awards collection keeps the historical "Perservenance" spelling so years group together.
  ['lund', 'Erik Lund Perseverance Award', 'erik_lund_perservenance_award.png', 'Erik Lund Perservenance Award'],
  ['streaman', 'Mr. Streaman Award for Excellence', 'mr_streaman_award_for_excellence.png', 'Mr. Streaman Award for Excellence'],
  ['boner', 'Andrew Streaman Boner of the Year', 'andrew_streaman_boner_award.png', 'Andrew Streaman Boner Award']
].map(([k, label, img, category]) => ({ id: `${YEAR}_${k}`, label, img: `awards/${img}`, category, multi: false }));

const MULTI = [
  { id: `${YEAR}_all-aces`, label: 'All Aces Team', img: 'awards/all_aces.png', category: 'All Aces', multi: true },
  { id: `${YEAR}_gold-glove`, label: 'Gold Glove Team', img: 'awards/gold_glove.png', category: 'Gold Glove', multi: true }
];

const TRACKS = [
  ['Peters entrance', '7wRHBLwpASw', ''],
  ['Leo entrance', '-bzWSJG93P8', ''],
  ['Podcast theme', 'sj9Rk2LTWFY', '&start=72']
];

let teams = [];          // [{ id, name }]
let awards = {};         // aceyAwards id -> data
let players = [];        // [{ id, name, team, legacyId }] for search
let publishRows = null;

const teamAwards = () => teams.map(t => ({ id: `${YEAR}_team-mvp_${t.id}`, label: `${t.name} MVP`, img: 'awards/team_mvp.png', team: t.name, multi: false }));
const writeIns = () => Object.entries(awards).filter(([, d]) => d.source === 'write-in').map(([id, d]) => ({ id, label: d.label || id, multi: false, writeIn: true }));
const allDefs = () => [...INDIVIDUAL, ...MULTI, ...teamAwards(), ...writeIns()];
const defFor = (id) => allDefs().find(a => a.id === id) || { id, label: awards[id]?.label || id, multi: !!awards[id]?.multi };

function winnersOf(a) {
  const d = awards[a.id] || {};
  if (a.multi) return d.playerNames || [];
  if (d.players?.length) return d.players.map(p => p.name);
  return d.playerName ? [d.playerName] : [];
}

// ------------------------------------------------------------------ render

function row(a) {
  const d = awards[a.id] || {};
  const winners = winnersOf(a);
  const active = d.active !== false;
  const revealed = !!d.revealed;
  const cls = ['ct-award', revealed ? 'is-revealed' : winners.length ? 'has-winner' : '', active ? '' : 'is-off'].join(' ').trim();
  const canReveal = winners.length && active;
  return `<li class="${cls}" data-award="${esc(a.id)}">
    <span class="ct-award-img">${a.img ? `<img src="${esc(siteUrl(a.img))}" alt="" loading="lazy">` : icon('award')}</span>
    <div class="ct-award-main">
      <strong>${esc(a.label)}</strong>
      ${winners.length ? `<span class="ct-winner">${esc(winners.join(', '))}</span>` : '<span class="ct-sub">No winner yet</span>'}
      ${d.note ? `<span class="ct-sub">${esc(d.note)}</span>` : ''}
      <label class="agg-check ct-active"><input type="checkbox" data-act="active"${active ? ' checked' : ''}> <span>Active this year</span></label>
    </div>
    <div class="ct-award-actions">
      <span class="aces-badge ${revealed ? 'is-win' : 'is-outline'}">${revealed ? 'Revealed' : 'Hidden'}</span>
      <button class="aces-btn is-sm" type="button" data-act="edit">Edit</button>
      ${revealed
        ? '<button class="aces-btn is-sm" type="button" data-act="hide">Hide</button>'
        : `<button class="aces-btn is-sm is-primary" type="button" data-act="reveal"${canReveal ? '' : ` disabled title="${active ? 'Set a winner first' : 'Mark it active first'}"`}>Reveal</button>`}
      ${a.writeIn ? '<button class="aces-btn is-sm is-ghost" type="button" data-act="delete">Delete</button>' : ''}
    </div>
  </li>`;
}

function render() {
  $('caIndividual').innerHTML = INDIVIDUAL.map(row).join('');
  $('caTeams').innerHTML = teams.length ? teamAwards().map(row).join('') : '<li class="aces-empty">No teams found.</li>';
  $('caMulti').innerHTML = MULTI.map(row).join('');
  const w = writeIns();
  $('caWriteIns').innerHTML = w.length ? w.map(row).join('') : '<li class="sse-dim">No write-in awards yet.</li>';
  const ids = [...INDIVIDUAL, ...MULTI, ...teamAwards()];
  const set = ids.filter(a => winnersOf(a).length).length;
  const shown = ids.filter(a => awards[a.id]?.revealed).length;
  $('caSummary').innerHTML = `<strong>${set}</strong> of ${ids.length} winners set &middot; <strong>${shown}</strong> revealed`;
}

// ------------------------------------------------------------------ players

async function loadPlayers() {
  const snap = await getDocs(collection(db, 'users'));
  const byName = new Map();
  snap.docs.forEach(d => {
    const u = d.data();
    if (u.migrated || d.id.startsWith('anon')) return;
    const name = u.displayName || u.name || d.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const p = { id: d.id, name, team: u.currentTeam || u.linkedTeam || '', legacyId: (u.legacyId || u.linkedPlayer || u.mergedFromProfile) ? statIdOf({ id: d.id, ...u }) : null };
    const have = byName.get(name.toLowerCase());
    // Keep the account (28-character uid) over a legacy snake_case record.
    if (!have || p.id.length > have.id.length) byName.set(name.toLowerCase(), p);
  });
  players = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Search box with picks as chips inside a dialog. picked is changed in place. */
function wirePicker(dialog, picked, { single = false } = {}) {
  const find = dialog.querySelector('[data-pick-find]');
  const list = dialog.querySelector('[data-pick-list]');
  const chips = dialog.querySelector('[data-pick-chips]');
  let matches = [];
  const draw = () => {
    chips.innerHTML = picked.map((p, i) => `<span class="ct-chip">${esc(p.name)}${p.team ? ` <span class="sse-dim">${esc(p.team)}</span>` : ''}${p.playerId ? '' : ' <span class="sse-dim">(no link)</span>'}
      <button type="button" class="ct-x" data-rm="${i}" aria-label="Remove ${esc(p.name)}">&times;</button></span>`).join('');
  };
  const add = (p) => {
    if (single) picked.splice(0, picked.length);
    if (!picked.some(x => x.name.toLowerCase() === p.name.toLowerCase())) picked.push(p);
    find.value = '';
    list.hidden = true;
    draw();
  };
  find.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    matches = q ? players.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8) : [];
    list.innerHTML = matches.map((p, i) => `<li><button type="button" data-pick="${i}"><span>${esc(p.name)}</span><span class="sse-dim">${esc(p.team)}</span></button></li>`).join('');
    list.hidden = !matches.length;
  });
  find.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = find.value.trim();
    if (name) add({ name, playerId: null, legacyId: null, team: '' });
  });
  dialog.addEventListener('click', (e) => {
    const pk = e.target.closest('[data-pick]');
    if (pk) { const p = matches[Number(pk.dataset.pick)]; add({ name: p.name, playerId: p.id, legacyId: p.legacyId, team: p.team }); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { picked.splice(Number(rm.dataset.rm), 1); draw(); }
  });
  draw();
  setTimeout(() => find.focus(), 50);
  /** Text typed but not added yet counts as a name with no link. */
  return () => {
    const name = find.value.trim();
    if (name && !picked.some(x => x.name.toLowerCase() === name.toLowerCase())) add({ name, playerId: null, legacyId: null, team: '' });
  };
}

const pickerHtml = (labelText, hint) => `<div class="aces-field ct-pick">
  <label class="aces-label" for="caFind">${esc(labelText)}</label>
  <input class="aces-input" id="caFind" type="search" autocomplete="off" placeholder="Search players" data-pick-find>
  <ul class="ct-pick-list" data-pick-list hidden></ul>
  <div class="ct-chips" data-pick-chips></div>
  <p class="sse-dim ct-hint">${esc(hint)}</p>
</div>`;

// ------------------------------------------------------------------ actions

async function edit(id) {
  const a = defFor(id);
  const d = awards[id] || {};
  const picked = a.multi ? [] : (d.players?.length ? d.players : d.playerName ? [{ name: d.playerName, playerId: d.playerId, legacyId: d.legacyId }] : [])
    .map(p => ({ name: p.name, playerId: p.playerId || null, legacyId: p.legacyId || null, team: '' }));
  let flush = () => {};
  let payload = null;
  const res = await openModal({
    title: a.label,
    html: `<div class="ct-edit">
      ${a.multi
        ? `<div class="aces-field"><label class="aces-label" for="caNames">Winners, one per line</label>
            <textarea class="aces-textarea" id="caNames" rows="8" placeholder="SS - Player Name (Team)">${esc((d.playerNames || []).join('\n'))}</textarea>
            <p class="sse-dim ct-hint">Free text. "POS - Name (Team)" is split into position, player and team when published.</p></div>`
        : pickerHtml('Winner(s)', 'Pick from the list to link the player. Press Enter to add a name with no link. Co-winners are fine.')}
      <div class="aces-field"><label class="aces-label" for="caNote">Note (optional)</label><input class="aces-input" id="caNote" type="text" value="${esc(d.note || '')}" placeholder="e.g. unanimous vote"></div>
    </div>`,
    onOpen: (dialog) => { if (!a.multi) flush = wirePicker(dialog, picked); },
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', variant: 'primary' }],
    beforeClose: (val, dialog) => {
      if (val !== 'ok') return true;
      const note = dialog.querySelector('#caNote').value.trim();
      if (a.multi) {
        payload = { note, playerNames: dialog.querySelector('#caNames').value.split('\n').map(s => s.trim()).filter(Boolean), playerName: '', playerId: null, legacyId: null };
      } else {
        flush();
        const first = picked[0] || null;
        payload = {
          note,
          players: picked.map(p => ({ name: p.name, playerId: p.playerId || null, legacyId: p.legacyId || null })),
          playerNames: [],
          playerName: first?.name || '',
          playerId: first?.playerId || null,
          legacyId: first?.legacyId || null
        };
      }
      return true;
    }
  });
  if (res !== 'ok' || !payload) return;
  try { await setDoc(doc(db, 'aceyAwards', id), payload, { merge: true }); showToast('Saved', 'success'); }
  catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
}

async function addWriteIn() {
  const picked = [];
  let flush = () => {};
  let v = null;
  const res = await openModal({
    title: 'Add a write-in award',
    html: `<div class="ct-edit">
      <div class="aces-field"><label class="aces-label" for="caWiName">Award name</label><input class="aces-input" id="caWiName" type="text" placeholder="e.g. Best Trash Talk"></div>
      ${pickerHtml('Winner', 'Pick from the list to link the player, or type a name and press Enter.')}
      <div class="aces-field"><label class="aces-label" for="caWiNote">Note (optional)</label><input class="aces-input" id="caWiNote" type="text"></div>
    </div>`,
    onOpen: (dialog) => { flush = wirePicker(dialog, picked, { single: true }); setTimeout(() => dialog.querySelector('#caWiName').focus(), 60); },
    actions: [{ label: 'Cancel', value: null }, { label: 'Create', value: 'ok', variant: 'primary' }],
    beforeClose: (val, dialog) => {
      if (val !== 'ok') return true;
      const label = dialog.querySelector('#caWiName').value.trim();
      if (!label) { showToast('Name the award.', 'warning'); return false; }
      flush();
      v = { label, note: dialog.querySelector('#caWiNote').value.trim(), p: picked[0] || null };
      return true;
    }
  });
  if (res !== 'ok' || !v) return;
  const id = `${YEAR}_writein_${v.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${Date.now()}`;
  try {
    await setDoc(doc(db, 'aceyAwards', id), {
      label: v.label, note: v.note, source: 'write-in', active: true, revealed: false, multi: false,
      playerNames: [], revealedAt: null,
      playerName: v.p?.name || '', playerId: v.p?.playerId || null, legacyId: v.p?.legacyId || null,
      players: v.p ? [{ name: v.p.name, playerId: v.p.playerId || null, legacyId: v.p.legacyId || null }] : []
    });
    showToast(`Added ${v.label}`, 'success');
  } catch (err) { showToast(`Could not add: ${err.message || err}`, 'error'); }
}

async function onAction(e) {
  const li = e.target.closest('[data-award]');
  const btn = e.target.closest('[data-act]');
  if (!li || !btn) return;
  const id = li.dataset.award;
  const act = btn.dataset.act;
  try {
    if (act === 'edit') return edit(id);
    if (act === 'reveal' || act === 'hide') {
      const on = act === 'reveal';
      await setDoc(doc(db, 'aceyAwards', id), { revealed: on, revealedAt: on ? serverTimestamp() : null }, { merge: true });
      showToast(on ? 'Revealed' : 'Hidden', 'success');
    } else if (act === 'delete') {
      if (!(await confirmModal('Delete this write-in award?', { confirmLabel: 'Delete', danger: true }))) return;
      await deleteDoc(doc(db, 'aceyAwards', id));
      showToast('Deleted', 'success');
    }
  } catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
}

async function onActive(e) {
  const box = e.target.closest('[data-act="active"]');
  if (!box) return;
  const id = box.closest('[data-award]').dataset.award;
  try { await setDoc(doc(db, 'aceyAwards', id), { active: box.checked }, { merge: true }); showToast(box.checked ? 'Marked active' : 'Marked inactive', 'success'); }
  catch (err) { box.checked = !box.checked; showToast(`Could not save: ${err.message || err}`, 'error'); }
}

async function hideAll() {
  if (!(await confirmModal('Hide every reveal on the public page?', { confirmLabel: 'Hide all', danger: true }))) return;
  try {
    const ids = [...INDIVIDUAL, ...MULTI, ...teamAwards(), ...writeIns()].map(a => a.id);
    await Promise.all(ids.map(id => setDoc(doc(db, 'aceyAwards', id), { revealed: false, revealedAt: null }, { merge: true })));
    showToast('All hidden', 'success');
  } catch (err) { showToast(`Could not save: ${err.message || err}`, 'error'); }
}

// ------------------------------------------------------------------ publish

// Matches existing award doc ids: every non-alphanumeric character becomes "_".
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
const CATEGORY = Object.fromEntries([...INDIVIDUAL, ...MULTI].map(a => [a.id, a.category]));

function buildRows() {
  const rows = [];
  const byName = new Map(players.map(p => [p.name.toLowerCase(), p]));
  Object.entries(awards).forEach(([id, d]) => {
    if (!id.startsWith(`${YEAR}_`) || d.active === false) return;
    let category = CATEGORY[id] || null;
    let team = '';
    if (id.startsWith(`${YEAR}_team-mvp_`)) {
      category = 'Team MVP';
      team = teams.find(t => t.id === id.replace(`${YEAR}_team-mvp_`, ''))?.name || '';
    } else if (d.source === 'write-in') {
      category = (d.label || '').trim();
      if (/^team of the year$/i.test(category)) category = 'Team of the Year';
    }
    if (!category) return;
    const winners = d.playerNames?.length ? d.playerNames.map(n => ({ name: n }))
      : d.players?.length ? d.players
      : d.playerName ? [{ name: d.playerName, playerId: d.playerId, legacyId: d.legacyId }] : [];
    winners.forEach(w => {
      let name = String(w.name || '').replace(/\s+/g, ' ').trim();
      let position = '', parsedTeam = '';
      const pos = name.match(/^([A-Za-z0-9/]{1,4})\s*[-–—:]\s*(.+)$/);
      if (pos) { position = pos[1].toUpperCase(); name = pos[2].trim(); }
      const tm = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (tm) { name = tm[1].trim(); parsedTeam = tm[2].trim(); }
      if (!name) return;
      if (category === 'Team of the Year') {
        // The winner is a team: id "<season>_team_of_the_year_", team set, no player.
        rows.push({ docId: `${PUBLISH_SEASON_ID}_${slug(category)}_`, aceyAwardId: id, category, playerName: '', playerId: null, legacyId: null, team: parsedTeam || name, position: '', revealed: !!d.revealed, matched: true });
        return;
      }
      const m = byName.get(name.toLowerCase());
      rows.push({
        docId: `${PUBLISH_SEASON_ID}_${slug(category)}_${slug(name)}`,
        aceyAwardId: id, category,
        playerName: m ? m.name : name,
        playerId: w.playerId || m?.id || null,
        legacyId: w.legacyId || m?.legacyId || null,
        team: team || parsedTeam || m?.team || '',
        position, revealed: !!d.revealed, matched: !!m
      });
    });
  });
  return rows.sort((a, b) => a.category.localeCompare(b.category) || a.playerName.localeCompare(b.playerName));
}

async function preview() {
  const out = $('caPublishOut');
  if (!players.length) await loadPlayers().catch(() => {});
  publishRows = buildRows();
  if (!publishRows.length) { out.innerHTML = '<p class="aces-empty">No active awards with winners.</p>'; $('caPublish').disabled = true; return; }
  let stale = [];
  try {
    const snap = await getDocs(query(collection(db, 'awards'), where('seasonId', '==', PUBLISH_SEASON_ID)));
    const keep = new Set(publishRows.map(r => r.docId));
    stale = snap.docs.filter(d => d.data().source === 'aceys' && !keep.has(d.id)).map(d => d.id);
  } catch (err) { console.error('[aceys] stale check', err); }
  publishRows.stale = stale;
  const unmatched = publishRows.filter(r => !r.matched).length;
  const hidden = publishRows.filter(r => !r.revealed).length;
  out.innerHTML = `<p class="ct-summary"><strong>${publishRows.length}</strong> award docs will be written.${hidden ? ` ${hidden} not revealed yet.` : ''}</p>
    ${unmatched ? `<p class="aces-notice is-warning">${unmatched} name${unmatched === 1 ? " doesn't" : "s don't"} match a player account. They are still written, but won't show on a profile unless the name matches it exactly.</p>` : ''}
    ${stale.length ? `<p class="aces-notice is-warning">${stale.length} doc${stale.length === 1 ? '' : 's'} from an earlier publish will be removed: ${stale.map(esc).join(', ')}</p>` : ''}
    <div class="aces-table-wrap"><table class="aces-table is-compact ct-table">
      <thead><tr><th scope="col">Category</th><th scope="col">Player</th><th scope="col">Team</th><th scope="col">Doc ID</th></tr></thead>
      <tbody>${publishRows.map(r => `<tr${r.matched ? '' : ' class="is-unmatched"'}>
        <td>${esc(r.category)}</td>
        <td>${r.position ? `<span class="sse-dim">${esc(r.position)}</span> ` : ''}${esc(r.playerName || '-')}${r.matched ? '' : ' <span class="ct-warn">(no match)</span>'}</td>
        <td>${esc(r.team || '-')}</td><td class="ct-docid" title="${esc(r.docId)}">${esc(r.docId)}</td></tr>`).join('')}</tbody>
    </table></div>`;
  $('caPublish').disabled = false;
}

async function publish() {
  if (!publishRows?.length) { showToast('Preview first.', 'warning'); return; }
  const stale = publishRows.stale || [];
  if (!(await confirmModal(`Write ${publishRows.length} award docs to player profiles${stale.length ? ` and remove ${stale.length} old one${stale.length === 1 ? '' : 's'}` : ''}?`, { confirmLabel: 'Publish' }))) return;
  const btn = $('caPublish');
  btn.disabled = true;
  try {
    const batch = writeBatch(db);
    publishRows.forEach(r => batch.set(doc(db, 'awards', r.docId), {
      category: r.category, playerName: r.playerName, playerId: r.playerId, legacyId: r.legacyId,
      team: r.team, position: r.position || null, seasonId: PUBLISH_SEASON_ID, value: null,
      source: 'aceys', aceyAwardId: r.aceyAwardId, createdAt: serverTimestamp()
    }, { merge: true }));
    stale.forEach(id => batch.delete(doc(db, 'awards', id)));
    await batch.commit();
    showToast(`Published ${publishRows.length} awards`, 'success');
  } catch (err) { showToast(`Could not publish: ${err.message || err}`, 'error'); }
  finally { btn.disabled = false; }
}

// ------------------------------------------------------------------ ceremony night

let playing = null;
const yt = (i, cmd) => $(`caYt${i}`)?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: cmd, args: [] }), '*');

function drawShow() {
  $('caShowBody').innerHTML = `<p class="sse-dim">Music plays from this page. Supreme puts the picture full screen here and on the ceremony screen; click it or press Esc to close.</p>
    <div class="sse-actions ct-music">
      ${TRACKS.map(([l], i) => `<button class="aces-btn is-sm" type="button" data-track="${i}" aria-pressed="false">${esc(l)}</button>`).join('')}
      <button class="aces-btn is-sm is-ghost" type="button" data-track="stop">Stop</button>
      <button class="aces-btn is-sm is-accent" type="button" id="caSupremeBtn">Supreme</button>
    </div>
    <div class="ct-yt" aria-hidden="true">${TRACKS.map(([, v, extra], i) =>
      `<iframe id="caYt${i}" width="1" height="1" title="Track ${i + 1}" allow="autoplay" src="https://www.youtube.com/embed/${v}?enablejsapi=1&autoplay=0&loop=1&playlist=${v}${extra}"></iframe>`).join('')}</div>`;
  $('caShowBody').addEventListener('click', (e) => {
    const t = e.target.closest('[data-track]');
    if (t) {
      const i = t.dataset.track === 'stop' ? null : Number(t.dataset.track);
      if (playing !== null) yt(playing, 'pauseVideo');
      playing = i === playing ? null : i;
      if (playing !== null) yt(playing, 'playVideo');
      $('caShowBody').querySelectorAll('[data-track]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.track) === playing && b.dataset.track !== 'stop')));
    }
    if (e.target.closest('#caSupremeBtn')) toggleSupreme();
  });
}

async function toggleSupreme() {
  let ov = $('caSupreme');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'caSupreme';
    ov.className = 'ct-supreme';
    ov.hidden = true;
    ov.innerHTML = `<img src="${esc(siteUrl('assets/supreme%20leader.jpeg'))}" alt="Supreme Leader">`;
    ov.addEventListener('click', toggleSupreme);
    document.body.appendChild(ov);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('caSupreme').hidden) toggleSupreme(); });
  }
  ov.hidden = !ov.hidden;
  try { await setDoc(doc(db, 'aceyControl', 'display'), { supreme: !ov.hidden }, { merge: true }); }
  catch (err) { console.warn('[aceys] supreme sync failed', err); }
}

// ------------------------------------------------------------------ mount

export async function mount() {
  $('caPublishNote').innerHTML = `Copies every active award with a winner into the <code>awards</code> collection for <strong>${esc(PUBLISH_SEASON_ID)}</strong>, so it shows on player profiles and the Awards page. Re-publishing overwrites the same docs, and docs from an earlier publish that no longer match a winner are removed.`;
  try {
    const snap = await getDocs(collection(db, 'teams'));
    teams = snap.docs.map(d => ({ id: d.id, name: d.data().teamName || d.data().name || d.id }))
      .filter(t => !RETIRED_TEAMS.includes(String(t.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) { console.error('[aceys] teams', err); }
  loadPlayers().catch(err => console.error('[aceys] players', err));

  const panel = document.querySelector('[data-panel="aceys"]');
  panel.addEventListener('click', onAction);
  panel.addEventListener('change', onActive);
  $('caHideAll').addEventListener('click', hideAll);
  $('caAddWriteIn').addEventListener('click', addWriteIn);
  $('caPreview').addEventListener('click', () => preview().catch(err => showToast(`Could not preview: ${err.message || err}`, 'error')));
  $('caPublish').addEventListener('click', publish);
  $('caShow').addEventListener('toggle', () => { if ($('caShow').open && !$('caShowBody').childElementCount) drawShow(); });

  onSnapshot(collection(db, 'aceyAwards'), (snap) => {
    awards = {};
    snap.docs.forEach(d => { awards[d.id] = d.data(); });
    render();
  }, (err) => {
    console.error('[aceys] awards', err);
    $('caSummary').textContent = `Could not load awards: ${err.message || err}`;
  });
}
