// js/admin/special-badges.js
// admin/special-badges.html: award a one-off badge to a player for a moment
// in a game (name, description, icon file). Saved to specialBadges/{auto id}:
//   { playerId (legacy ID), playerName, authId, teamId, seasonId, gameId,
//     gameLabel, gameDate, name, description, iconPath, awardedAt, awardedBy }
// The badge calculator never writes this collection, so recalculating badges
// leaves them alone. player.js folds them into the player's Badges tab
// (category 'special', shown as Legendary moments).

import { initPage, pageReady, siteUrl } from '../core/app.js';
import { db, collection, doc, getDocs, addDoc, deleteDoc, query, where, serverTimestamp } from '../core/firebase.js';
import { getAllSeasons } from '../data/seasons.js';
import { getTeamRosterDoc } from '../../firebase-roster.js';
import { normalizeGame } from '../domain/standings.js';
import { formatGameDate, parseGameDate } from '../domain/dates.js';
import { seasonLabel, seasonSortKey } from '../domain/season-ids.js';
import { toStatId } from '../domain/player-id.js';
import { escapeHtml as esc } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { mountAdminShell } from './shell.js';

const $ = (id) => document.getElementById(id);
const ICON_DIR = 'assets/badges/special/';
const toMillis = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : 0);

let user = null;
let games = [];      // { id, label, date, home, away } for the season
let players = [];    // { legacyId, authId, name, team }
let awarded = [];    // specialBadges for the season
let busy = false;

/** 'face-value', 'face-value.png' or 'assets/badges/special/face-value.png' -> 'assets/badges/special/face-value'. */
function iconPathFrom(raw) {
  const name = String(raw || '').trim().split('/').pop().replace(/\.png$/i, '');
  return name ? ICON_DIR + name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() : '';
}

const artFor = (iconPath) => iconPath
  ? `<img src="${esc(siteUrl(`${iconPath}.png`))}" alt="" data-spb-img>`
  : icon('medal');

async function loadSeason(sid) {
  $('spbGame').innerHTML = '<option value="">Loading games...</option>';
  resetPlayers('Pick a game first');
  const snap = await getDocs(collection(db, 'seasons', sid, 'games'));
  games = snap.docs.map(d => {
    const raw = { id: d.id, ...d.data() };
    const g = normalizeGame(raw);
    const date = parseGameDate(raw.date);
    return { id: d.id, date: date ? date.getTime() : 0, home: g.home, away: g.away, raw };
  }).map(g => ({ ...g, label: `${formatGameDate(g.raw.date)}: ${g.away} at ${g.home}` }))
    .sort((a, b) => b.date - a.date);
  $('spbGame').innerHTML = '<option value="">Pick a game</option>' +
    games.map(g => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');
  await loadAwarded(sid);
}

function resetPlayers(text) {
  players = [];
  $('spbPlayer').innerHTML = `<option value="">${esc(text)}</option>`;
  $('spbPlayer').disabled = true;
}

async function loadPlayers() {
  const g = games.find(x => x.id === $('spbGame').value);
  if (!g) { resetPlayers('Pick a game first'); return; }
  resetPlayers('Loading rosters...');
  const sid = $('spbSeason').value;
  const teams = [g.away, g.home].filter(Boolean);
  const lists = await Promise.all(teams.map(t => getTeamRosterDoc(String(t), sid).catch(() => [])));
  players = [];
  lists.forEach((list, i) => list.filter(p => p.legacyId).forEach(p => players.push({
    legacyId: toStatId(p.legacyId), authId: p.authId || '', name: p.name, team: teams[i]
  })));
  if (!players.length) { resetPlayers('No roster found for these teams'); return; }
  $('spbPlayer').innerHTML = '<option value="">Pick a player</option>' + teams.map(t => {
    const list = players.filter(p => p.team === t).sort((a, b) => a.name.localeCompare(b.name));
    return list.length ? `<optgroup label="${esc(t)}">${list.map(p => `<option value="${esc(p.legacyId)}">${esc(p.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  $('spbPlayer').disabled = false;
}

function renderPreview() {
  const name = $('spbName').value.trim();
  const desc = $('spbDesc').value.trim();
  const path = iconPathFrom($('spbIcon').value);
  if (!name && !desc && !path) { $('spbPreview').innerHTML = ''; return; }
  $('spbPreview').innerHTML = `<div class="spb-card">
    <span class="spb-art">${artFor(path)}</span>
    <span><strong>${esc(name || 'Badge name')}</strong><span class="sse-dim">${esc(desc || 'Description')}</span>
    ${path ? `<code class="spb-path">${esc(path)}.png</code>` : ''}</span>
  </div>`;
}

async function loadAwarded(sid) {
  try {
    const snap = await getDocs(query(collection(db, 'specialBadges'), where('seasonId', '==', sid)));
    awarded = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => toMillis(b.awardedAt) - toMillis(a.awardedAt));
  } catch (err) {
    console.error('[special-badges] load failed', err);
    awarded = [];
    $('spbList').innerHTML = `<p class="sse-empty">Could not load: ${esc(err.message || err)}</p>`;
    return;
  }
  renderList();
}

function renderList() {
  $('spbCount').textContent = awarded.length ? String(awarded.length) : '';
  if (!awarded.length) { $('spbList').innerHTML = `<p class="sse-dim">No special badges in ${esc(seasonLabel($('spbSeason').value))} yet.</p>`; return; }
  $('spbList').innerHTML = `<ul class="spb-list">${awarded.map(b => `<li>
    <span class="spb-art">${artFor(b.iconPath)}</span>
    <span class="spb-what"><strong>${esc(b.name)}</strong> <span class="sse-dim">${esc(b.description || '')}</span><br>
      <a href="${esc(siteUrl(`player.html?${new URLSearchParams({ id: b.playerId, tab: 'badges' })}`))}">${esc(b.playerName || b.playerId)}</a>
      <span class="sse-dim">${esc(b.gameLabel || '')}</span></span>
    <button class="aces-btn is-sm is-ghost" type="button" data-del="${esc(b.id)}" aria-label="Remove ${esc(b.name)} from ${esc(b.playerName || '')}">${icon('trash')}</button>
  </li>`).join('')}</ul>`;
}

async function save() {
  if (busy) return;
  const sid = $('spbSeason').value;
  const g = games.find(x => x.id === $('spbGame').value);
  const p = players.find(x => x.legacyId === $('spbPlayer').value);
  const name = $('spbName').value.trim();
  const description = $('spbDesc').value.trim();
  if (!g || !p) { showToast('Pick a game and a player', 'error'); return; }
  if (!name) { showToast('Give the badge a name', 'error'); $('spbName').focus(); return; }
  busy = true;
  $('spbSave').disabled = true;
  try {
    await addDoc(collection(db, 'specialBadges'), {
      playerId: p.legacyId, authId: p.authId, playerName: p.name, teamId: p.team,
      seasonId: sid, gameId: g.id, gameLabel: g.label, gameDate: g.date ? new Date(g.date).toISOString() : null,
      name, description, iconPath: iconPathFrom($('spbIcon').value),
      awardedAt: serverTimestamp(), awardedBy: user.uid, awardedByName: user.displayName || user.email || ''
    });
    showToast(`${name} awarded to ${p.name}`, 'success');
    ['spbName', 'spbDesc', 'spbIcon'].forEach(id => { $(id).value = ''; });
    renderPreview();
    await loadAwarded(sid);
  } catch (err) {
    console.error('[special-badges] save failed', err);
    showToast(`Could not save: ${err.message}`, 'error');
  } finally {
    busy = false;
    $('spbSave').disabled = false;
  }
}

async function remove(id) {
  const b = awarded.find(x => x.id === id);
  if (!b) return;
  if (!(await confirmModal(`Remove ${b.name} from ${b.playerName}?`, { danger: true, confirmLabel: 'Remove badge' }))) return;
  try {
    await deleteDoc(doc(db, 'specialBadges', id));
    awarded = awarded.filter(x => x.id !== id);
    renderList();
    showToast('Badge removed', 'success');
  } catch (err) {
    showToast(`Could not remove: ${err.message}`, 'error');
  }
}

async function main() {
  const ctx = await initPage({ title: 'Special badges', role: 'admin', deniedMessage: 'Special badges are for admins.' });
  if (!ctx?.user) return;
  user = ctx.user;
  mountAdminShell(ctx.profile, 'admin/special-badges.html');

  const seasons = (await getAllSeasons()).sort((a, b) => seasonSortKey(b.id) - seasonSortKey(a.id));
  const start = [ctx.config?.currentSeasonId, seasons[0]?.id].find(id => id && seasons.some(s => s.id === id));
  $('spbSeason').innerHTML = seasons.map(s => `<option value="${esc(s.id)}">${esc(seasonLabel(s.id))}</option>`).join('');
  if (start) $('spbSeason').value = start;

  $('spbSeason').addEventListener('change', () => loadSeason($('spbSeason').value));
  $('spbGame').addEventListener('change', loadPlayers);
  ['spbName', 'spbDesc', 'spbIcon'].forEach(id => $(id).addEventListener('input', renderPreview));
  $('spbSave').addEventListener('click', save);
  $('spbList').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) remove(b.dataset.del); });
  // Icon not uploaded yet: show the medal instead of a broken image.
  document.addEventListener('error', (e) => {
    if (e.target.matches?.('[data-spb-img]')) e.target.replaceWith(Object.assign(document.createElement('span'), { innerHTML: icon('medal') }).firstElementChild);
  }, true);

  pageReady();
  if (start) await loadSeason(start);
}

main().catch(err => {
  console.error('[special-badges] start failed', err);
  pageReady();
  $('spbList').innerHTML = `<p class="sse-empty">Could not load: ${esc(err.message || err)}</p>`;
});
