// js/pages/pickup.js
// pickup.html: pick-up and scrimmage games, any time of year.
//   No ?id   the list: upcoming and past games, and "New game".
//   ?id=X    one game: RSVP, Teams, Photos and Result tabs (?tab=teams ...).
//
// Who can do what (firestore.rules pickupGames block matches this):
//   anyone            view everything
//   signed in         set up a game, RSVP themselves, add guests
//   managers          the organizer, captains, team staff, league staff and
//                     admins: mark RSVPs for others, edit/cancel the game,
//                     build and save teams, enter the score
//   photo roles       upload photos (same roles as media.html#upload)
//
// Data:
//   pickupGames/{id}  { date 'YYYY-MM-DD', time '7:00 PM', location, notes,
//                       minPlayers, status 'open' | 'cancelled' | 'final',
//                       createdBy { uid, name }, createdAt, updatedAt,
//                       teams { a: { name, players: [{ key, name }] }, b: {...},
//                               locks { key: 'a'|'b' }, savedBy, savedAt } | null,
//                       teamRules [{ x, y, type: 'together'|'apart' }],
//                       result { a, b, notes, enteredBy, enteredAt } | null }
//   pickupGames/{id}/rsvps/{key}
//                     key: the player's stats ID (snake_case legacy ID), or
//                     u_<uid> for an account with no player, or g_<random> for a guest.
//                     { status 'yes'|'maybe'|'no', name, playerId|null, pos ['P','C','IF','OF'],
//                       note, self (set by the player themselves), ownerUid,
//                       guest, tier, addedBy, setBy { uid, name }, updatedAt }
//   teamPhotos        pick-up photos: folder 'pickup', pickupId, pickupDate.
//
// Pick-up results never touch league stats.

import { initPage, pageReady, showPageError, siteUrl } from '../core/app.js';
import { hasRole } from '../core/auth.js';
import {
  db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, onSnapshot, serverTimestamp
} from '../core/firebase.js';
import { getAllPlayerStatsOptimized } from '../data/player-stats.js';
import { escapeHtml as esc, formatPlayerName, playerUrl } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { todayKey, toDateKey, addDays, formatGameDate, formatTime, formatRelativeDay, parseTimeMinutes } from '../domain/dates.js';
import { statIdOf } from '../domain/player-id.js';
import {
  buildRatings, balanceOptions, splitReport, positionGroups,
  TIERS, DEFAULT_TIER, POSITIONS, POSITION_LABELS
} from '../domain/pickup.js';

const $ = (id) => document.getElementById(id);
const COL = 'pickupGames';
const UPLOAD_ROLES = ['team-staff', 'league-staff', 'photographer'];   // same as media.html; admins pass too
const MANAGER_ROLE = 'team-staff';   // hasRole: team staff, captains, league staff, admins
const DEFAULT_MIN = 14;
const DEFAULT_NAMES = { a: 'Light', b: 'Dark' };
const STATUS = [['yes', 'In', 'check-circle'], ['maybe', 'Maybe', 'help'], ['no', 'Out', 'x-circle']];
const TABS = [['rsvp', 'RSVP', 'users'], ['teams', 'Teams', 'shuffle'], ['photos', 'Photos', 'camera'], ['result', 'Result', 'trophy']];

const S = {
  ctx: null, user: null, uid: '', me: null,
  id: '', game: null, rsvps: new Map(), tab: 'rsvp',
  stats: null, ratings: null, roster: [], myPos: null,
  draft: null, photos: [], photosLoaded: false, viewerAt: 0, files: []
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lastName = (name) => String(name || '').trim().split(/\s+/).slice(-1)[0] || '';

function myIdentity(profile, user) {
  const name = profile?.preferredDisplayName || profile?.displayName || user?.displayName || (user?.email ? user.email.split('@')[0] : 'Member');
  const linked = profile && (profile.legacyId || profile.mergedFromProfile || profile.linkedPlayer);
  const playerId = linked ? statIdOf(profile) : '';
  return { name: linked ? formatPlayerName(profile.linkedPlayer || name) : name, playerId: playerId || null, key: playerId || `u_${user.uid}` };
}

const isManager = (game = S.game) => !!S.user && (game?.createdBy?.uid === S.uid || hasRole(S.ctx.profile, MANAGER_ROLE));
const canDeleteGame = () => !!S.user && (S.game?.createdBy?.uid === S.uid || hasRole(S.ctx.profile, 'league-staff'));
const canEditRsvp = (r) => !!S.user && (isManager() || r.ownerUid === S.uid || (r.guest && r.addedBy === S.uid));

function counts(rsvps = S.rsvps) {
  const c = { yes: 0, maybe: 0, no: 0 };
  for (const r of rsvps.values()) if (r.status in c) c[r.status] += 1;
  return c;
}

/** [label, badge class] for a game. yes: In count when known. */
function gameState(g, yes = null) {
  if (g.status === 'cancelled') return ['Cancelled', 'is-loss'];
  if (g.result && g.result.a != null) return ['Final', 'is-outline'];
  if (toDateKey(g.date) < todayKey()) return ['Played', 'is-outline'];
  const min = Number(g.minPlayers) || 0;
  if (yes !== null && min && yes >= min) return ['Game on', 'is-win'];
  if (yes !== null && min) return [`Need ${min - yes} more`, 'is-alert'];
  return ['Open', 'is-outline'];
}

function whenLine(g, style = 'full') {
  const rel = formatRelativeDay(g.date, { style: 'full' });
  const day = ['Today', 'Tomorrow', 'Yesterday'].includes(rel) ? `${rel}, ${formatGameDate(g.date, 'monthDay')}` : formatGameDate(g.date, style);
  return g.time ? `${day} · ${formatTime(g.time)}` : day;
}

function posTags(pos) {
  return (pos || []).length ? `<span class="pu-pos">${pos.map((p) => `<span title="${esc(POSITION_LABELS[p] || p)}">${esc(p)}</span>`).join('')}</span>` : '';
}

function posChips(name, chosen = []) {
  return `<div class="aces-chip-row pu-pos-pick" role="group" aria-label="Positions">${POSITIONS.map((p) =>
    `<label class="aces-chip pu-chip"><input type="checkbox" name="${name}" value="${p}"${chosen.includes(p) ? ' checked' : ''}><span>${esc(POSITION_LABELS[p])}</span></label>`).join('')}</div>`;
}

const tierOptions = (sel = DEFAULT_TIER) => TIERS.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(l)} (${v})</option>`).join('');

function signInLink(text) {
  return `<a href="${esc(siteUrl('signin.html'))}?next=${encodeURIComponent(location.href)}">${esc(text)}</a>`;
}

async function loadStats() {
  if (S.stats) return S.stats;
  S.stats = (async () => {
    const docs = await getAllPlayerStatsOptimized();
    S.ratings = buildRatings(docs);
    S.roster = [...S.ratings.byId.values()]
      .filter((p) => p.name)
      .map((p) => ({ id: p.id, name: formatPlayerName(p.name) }))
      .sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name));
    return S.ratings;
  })().catch((err) => {
    console.warn('[pickup] player stats unavailable', err);
    S.ratings = { byId: new Map(), latest: '' };
    S.roster = [];
    return S.ratings;
  });
  return S.stats;
}

// ---------------------------------------------------------------------------
// Game form (new and edit)
// ---------------------------------------------------------------------------

function nextSaturday() {
  const t = todayKey();
  const dow = new Date(`${t}T12:00:00`).getDay();
  return addDays(t, ((6 - dow + 7) % 7) || 7);
}

function to24h(time) {
  const m = parseTimeMinutes(time);
  return m === null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function formHtml(g = null) {
  const edit = !!g;
  return `
    <div class="aces-card-head"><h2 class="aces-card-title">${icon(edit ? 'edit' : 'plus')} ${edit ? 'Edit game' : 'New pick-up game'}</h2></div>
    <div class="pu-form-grid">
      <label class="aces-field"><span class="aces-label">Date</span><input class="aces-input" type="date" name="date" required value="${esc(g ? toDateKey(g.date) : nextSaturday())}"></label>
      <label class="aces-field"><span class="aces-label">Time</span><input class="aces-input" type="time" name="time" value="${esc(g ? to24h(g.time) : '10:00')}"></label>
      <label class="aces-field"><span class="aces-label">Field</span><input class="aces-input" name="location" maxlength="80" placeholder="Where" value="${esc(g?.location || '')}"></label>
      <label class="aces-field"><span class="aces-label">Players needed</span><input class="aces-input" type="number" name="minPlayers" min="2" max="40" value="${esc(g?.minPlayers ?? DEFAULT_MIN)}"><span class="aces-hint">Shows "Game on" once this many are in.</span></label>
    </div>
    <label class="aces-field"><span class="aces-label">Notes (optional)</span><textarea class="aces-input" name="notes" rows="2" maxlength="400" placeholder="Bring both shirts, rain plan, etc.">${esc(g?.notes || '')}</textarea></label>
    ${edit ? '' : '<label class="pu-check"><input type="checkbox" name="imIn" checked> Count me in</label>'}
    <p class="pu-error" hidden></p>
    <div class="aces-cluster">
      <button type="submit" class="aces-btn is-primary">${icon('save')}${edit ? 'Save changes' : 'Create game'}</button>
      <button type="button" class="aces-btn is-ghost" data-act="form-cancel">Cancel</button>
    </div>`;
}

function readForm(form) {
  const f = new FormData(form);
  const date = String(f.get('date') || '').trim();
  const time = String(f.get('time') || '').trim();
  const min = Math.round(Number(f.get('minPlayers')));
  const err = !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'Pick a date.' : (!Number.isFinite(min) || min < 2 ? 'Players needed should be at least 2.' : '');
  const p = form.querySelector('.pu-error');
  p.textContent = err;
  p.hidden = !err;
  if (err) return null;
  return {
    date,
    time: time ? formatTime(time) : '',
    location: String(f.get('location') || '').trim(),
    minPlayers: min,
    notes: String(f.get('notes') || '').trim(),
    imIn: f.get('imIn') === 'on'
  };
}

async function createGame(form) {
  const v = readForm(form);
  if (!v) return;
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const ref = await addDoc(collection(db, COL), {
      date: v.date, time: v.time, location: v.location, minPlayers: v.minPlayers, notes: v.notes,
      status: 'open',
      createdBy: { uid: S.uid, name: S.me.name },
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      teams: null, teamRules: [], result: null
    });
    if (v.imIn) {
      await setDoc(doc(db, COL, ref.id, 'rsvps', S.me.key), selfRsvp('yes', S.myPos || [], ''), { merge: true });
    }
    location.href = `pickup.html?id=${encodeURIComponent(ref.id)}`;
  } catch (e) {
    console.error('[pickup] create', e);
    showToast("That game didn't save. Try again.", 'error');
    btn.disabled = false;
  }
}

async function saveEdit(form) {
  const v = readForm(form);
  if (!v) return;
  try {
    await updateDoc(doc(db, COL, S.id), {
      date: v.date, time: v.time, location: v.location, minPlayers: v.minPlayers, notes: v.notes, updatedAt: serverTimestamp()
    });
    form.hidden = true;
    showToast('Game updated.');
  } catch (e) {
    console.error('[pickup] edit', e);
    showToast("Changes didn't save. Try again.", 'error');
  }
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

async function showList() {
  $('puList').hidden = false;
  $('puListHead').innerHTML = S.user
    ? `<div class="pu-list-head"><button type="button" class="aces-btn is-primary" data-act="new-game">${icon('plus')}New game</button></div>`
    : `<p class="aces-notice">${icon('user')}<span>${signInLink('Sign in')} to set up a game or RSVP.</span></p>`;

  let games = [];
  try {
    const snap = await getDocs(query(collection(db, COL), orderBy('date', 'desc'), limit(60)));
    games = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[pickup] games', err);
    $('puUpcoming').innerHTML = '<div class="aces-card"><p class="pu-empty">Games could not load. Try again in a minute.</p></div>';
    return;
  }
  const today = todayKey();
  const done = (g) => g.result && g.result.a != null;
  const upcoming = games.filter((g) => toDateKey(g.date) >= today && !done(g)).reverse();
  const past = games.filter((g) => toDateKey(g.date) < today || done(g));

  // In counts for the upcoming games.
  const yesOf = new Map();
  await Promise.all(upcoming.filter((g) => g.status !== 'cancelled').map(async (g) => {
    try {
      const snap = await getDocs(collection(db, COL, g.id, 'rsvps'));
      const c = { yes: 0, maybe: 0 };
      snap.forEach((d) => { const s = d.data().status; if (s in c) c[s] += 1; });
      yesOf.set(g.id, c);
    } catch { /* counts are a nice-to-have */ }
  }));

  $('puUpcoming').innerHTML = `<h2 class="pu-section">Upcoming</h2>${upcoming.length
    ? `<div class="pu-cards">${upcoming.map((g) => gameCard(g, yesOf.get(g.id))).join('')}</div>`
    : `<div class="aces-card"><p class="pu-empty">No pick-up games on the calendar.${S.user ? ' Start one with New game.' : ''}</p></div>`}`;
  $('puPast').innerHTML = past.length ? `<h2 class="pu-section">Past games</h2><div class="pu-cards">${past.map((g) => gameCard(g)).join('')}</div>` : '';
}

function gameCard(g, c = null) {
  const [label, cls] = gameState(g, c ? c.yes : null);
  const res = g.result && g.result.a != null
    ? `<span class="pu-card-score">${esc(g.teams?.a?.name || DEFAULT_NAMES.a)} ${esc(g.result.a)} - ${esc(g.result.b)} ${esc(g.teams?.b?.name || DEFAULT_NAMES.b)}</span>` : '';
  const line = c && g.status !== 'cancelled'
    ? `<span>${plural(c.yes, 'in', 'in')}${c.maybe ? ` &middot; ${c.maybe} maybe` : ''}${g.minPlayers ? ` &middot; need ${esc(g.minPlayers)}` : ''}</span>` : '';
  return `<a class="aces-card is-link pu-card" href="pickup.html?id=${encodeURIComponent(g.id)}">
    <div class="pu-card-top"><strong>${esc(whenLine(g, 'short'))}</strong><span class="aces-badge ${cls}">${esc(label)}</span></div>
    ${g.location ? `<span class="pu-card-meta">${icon('map-pin')}${esc(g.location)}</span>` : ''}
    ${line ? `<span class="pu-card-meta">${icon('users')}${line}</span>` : ''}
    ${res}
  </a>`;
}

// ---------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------

function showGame() {
  $('puGame').hidden = false;
  const t = new URLSearchParams(location.search).get('tab');
  if (TABS.some(([id]) => id === t)) S.tab = t;
  let first = true;
  return new Promise((resolve) => {
    onSnapshot(doc(db, COL, S.id), (snap) => {
      if (!snap.exists()) {
        $('puGame').innerHTML = `<div class="aces-card"><p class="pu-empty">This game isn't here any more. <a href="pickup.html">All pick-up games</a></p></div>`;
        resolve();
        return;
      }
      S.game = { id: snap.id, ...snap.data() };
      if (S.draft && !S.draft.dirty) {   // pick up teams saved elsewhere, keep the view settings
        const { includeMaybe, options, at, rulesOpen } = S.draft;
        S.draft = { ...newDraft(), includeMaybe, options, at, rulesOpen };
      }
      renderGame();
      if (first) { first = false; resolve(); }
    }, (err) => { showPageError(err); resolve(); });
    onSnapshot(collection(db, COL, S.id, 'rsvps'), (snap) => {
      S.rsvps = new Map(snap.docs.map((d) => [d.id, { key: d.id, ...d.data() }]));
      if (S.game) renderGame();
    }, (err) => console.warn('[pickup] rsvps', err));
  });
}

// Live updates re-render the page while someone may be typing: keep what
// they've typed in the RSVP and score forms, and where the cursor was.
function captureForms() {
  const out = { forms: {}, focus: null };
  for (const id of ['puMine', 'puResult']) {
    const f = $(id);
    if (f?.dataset.touched) out.forms[id] = [...f.elements].filter((el) => el.name).map((el) => [el.name, el.value, el.checked, el.type]);
  }
  const a = document.activeElement;
  if (a?.name && a.form?.id) out.focus = { sel: `#${a.form.id} [name="${a.name}"]`, start: a.selectionStart };
  else if (a?.dataset?.nameSide) out.focus = { sel: `[data-name-side="${a.dataset.nameSide}"]`, start: a.selectionStart };
  return out;
}

function restoreForms(saved) {
  for (const [id, fields] of Object.entries(saved.forms)) {
    const f = $(id);
    if (!f) continue;
    f.dataset.touched = '1';
    for (const [name, value, checked, type] of fields) {
      if (type === 'checkbox') { const el = f.querySelector(`[name="${name}"][value="${value}"]`); if (el) el.checked = checked; }
      else if (f.elements[name] && type !== 'submit' && type !== 'button') f.elements[name].value = value;
    }
  }
  if (saved.focus) {
    const el = document.querySelector(saved.focus.sel);
    if (el) {
      el.focus({ preventScroll: true });
      try { if (saved.focus.start != null) el.setSelectionRange(saved.focus.start, saved.focus.start); } catch { /* number inputs */ }
    }
  }
}

function renderGame() {
  const saved = captureForms();
  renderGameNow();
  restoreForms(saved);
}

function renderGameNow() {
  const g = S.game;
  const c = counts();
  const [label, cls] = gameState(g, c.yes);
  document.title = `Pick-up ${formatGameDate(g.date, 'monthDay')} - Mountainside Aces`;
  $('puKicker').innerHTML = `<a href="pickup.html">Pick-up</a>`;
  $('puTitle').textContent = formatGameDate(g.date, 'long');
  $('puDesc').hidden = true;
  const mgr = isManager();
  $('puGameHead').innerHTML = `<div class="aces-card pu-head">
    <div class="pu-head-main">
      <span class="aces-badge ${cls}">${esc(label)}</span>
      <div class="pu-head-facts">
        ${g.time ? `<span>${icon('clock')}${esc(formatTime(g.time))}</span>` : ''}
        ${g.location ? `<span>${icon('map-pin')}${esc(g.location)}</span>` : ''}
        <span>${icon('users')}${plural(c.yes, 'player')} in${g.minPlayers ? ` of ${esc(g.minPlayers)} needed` : ''}</span>
      </div>
      ${g.notes ? `<p class="pu-notes">${esc(g.notes)}</p>` : ''}
      <span class="pu-by">Set up by ${esc(g.createdBy?.name || 'a member')}</span>
    </div>
    ${mgr ? `<div class="aces-cluster pu-head-actions">
      <button type="button" class="aces-btn is-sm" data-act="edit-game">${icon('edit')}Edit</button>
      ${g.status === 'cancelled'
        ? `<button type="button" class="aces-btn is-sm" data-act="reopen">${icon('refresh')}Reopen</button>`
        : g.result ? '' : `<button type="button" class="aces-btn is-sm" data-act="cancel-game">${icon('x-circle')}Cancel game</button>`}
      ${canDeleteGame() ? `<button type="button" class="aces-btn is-sm is-ghost" data-act="delete-game">${icon('trash')}Delete</button>` : ''}
    </div>` : ''}
  </div>`;
  $('puTabs').innerHTML = TABS.map(([id, lbl, ic]) =>
    `<a class="aces-tab" href="?id=${encodeURIComponent(S.id)}&tab=${id}" data-goto="${id}"${id === S.tab ? ' aria-current="page"' : ''}>${icon(ic)}<span>${lbl}</span></a>`).join('');
  TABS.forEach(([id]) => { $(`pu-${id}`).hidden = id !== S.tab; });
  if (S.tab === 'rsvp') renderRsvp();
  if (S.tab === 'teams') renderTeams();
  if (S.tab === 'photos') renderPhotos();
  if (S.tab === 'result') renderResult();
}

function goTab(id) {
  S.tab = id;
  const u = new URL(location.href);
  if (id === 'rsvp') u.searchParams.delete('tab'); else u.searchParams.set('tab', id);
  history.replaceState(null, '', u);
  renderGame();
}

async function setStatus(status) {
  try {
    await updateDoc(doc(db, COL, S.id), { status, updatedAt: serverTimestamp() });
    showToast(status === 'cancelled' ? 'Game cancelled.' : 'Game reopened.');
  } catch (e) {
    console.error('[pickup] status', e);
    showToast("That didn't save. Try again.", 'error');
  }
}

async function deleteGame() {
  const ok = await confirmModal('Delete this game and its RSVPs? Photos stay in Media under Pick-up.', { danger: true, confirmLabel: 'Delete game' });
  if (!ok) return;
  try {
    const snap = await getDocs(collection(db, COL, S.id, 'rsvps'));
    for (const d of snap.docs) await deleteDoc(d.ref);
    await deleteDoc(doc(db, COL, S.id));
    location.href = 'pickup.html';
  } catch (e) {
    console.error('[pickup] delete', e);
    showToast("That didn't delete. Try again.", 'error');
  }
}

// ---------------------------------------------------------------------------
// RSVP
// ---------------------------------------------------------------------------

function selfRsvp(status, pos, note) {
  return {
    status, name: S.me.name, playerId: S.me.playerId, pos, note,
    self: true, ownerUid: S.uid, guest: false,
    setBy: { uid: S.uid, name: S.me.name }, updatedAt: serverTimestamp()
  };
}

function renderRsvp() {
  const g = S.game;
  const c = counts();
  const min = Number(g.minPlayers) || 0;
  const pct = min ? Math.min(100, Math.round((c.yes / min) * 100)) : 0;
  const mine = S.user ? S.rsvps.get(S.me.key) : null;
  const closed = g.status === 'cancelled';

  const meter = `<div class="aces-card pu-count">
    <div class="pu-count-nums">
      <div><strong>${c.yes}</strong><span>In</span></div>
      <div><strong>${c.maybe}</strong><span>Maybe</span></div>
      <div><strong>${c.no}</strong><span>Out</span></div>
    </div>
    ${min ? `<div class="pu-bar" role="img" aria-label="${c.yes} of ${min} needed"><span style="width:${pct}%"></span></div>
    <p class="pu-count-note">${c.yes >= min ? `${icon('check-circle')}Enough players. Game on.` : `${plural(min - c.yes, 'more player')} needed`}</p>` : ''}
  </div>`;

  let me = '';
  if (closed) {
    me = `<p class="aces-notice is-warning">${icon('alert')}<span>This game is cancelled.</span></p>`;
  } else if (!S.user) {
    me = `<p class="aces-notice">${icon('user')}<span>${signInLink('Sign in')} to RSVP.</span></p>`;
  } else {
    const pos = mine?.pos || S.myPos || [];
    me = `<form class="aces-card pu-mine" id="puMine">
      <div class="aces-card-head"><h2 class="aces-card-title">Are you in, ${esc(S.me.name.split(' ')[0])}?</h2></div>
      <div class="pu-status-row">${STATUS.map(([v, l, ic]) =>
        `<button type="button" class="pu-status is-${v}${mine?.status === v ? ' is-on' : ''}" data-act="my-status" data-status="${v}" aria-pressed="${mine?.status === v}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
      <span class="aces-label">Positions you can play</span>
      ${posChips('pos', pos)}
      <label class="aces-field"><span class="aces-label">Note (optional)</span><input class="aces-input" name="note" maxlength="80" placeholder="Leaving early, bringing a friend..." value="${esc(mine?.note || '')}"></label>
      ${mine ? `<div class="aces-cluster"><button type="submit" class="aces-btn is-sm">${icon('save')}Save positions and note</button>
        ${mine.self === false && mine.setBy ? `<span class="pu-meta">Marked by ${esc(mine.setBy.name)}</span>` : ''}</div>` : ''}
    </form>`;
  }

  const add = S.user && !closed ? `<div class="aces-cluster pu-add">
      ${isManager() ? `<button type="button" class="aces-btn is-sm" data-act="mark-player">${icon('user-check')}Mark a player</button>` : ''}
      <button type="button" class="aces-btn is-sm" data-act="add-guest">${icon('user-plus')}Add a guest</button>
    </div>` : '';

  const lists = STATUS.map(([v, l]) => {
    const rows = [...S.rsvps.values()].filter((r) => r.status === v).sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)));
    if (!rows.length) return '';
    return `<div class="aces-card pu-list-card"><h3 class="pu-list-title">${l} <span>${rows.length}</span></h3><ul class="pu-people">${rows.map(rsvpRow).join('')}</ul></div>`;
  }).join('');

  $('pu-rsvp').innerHTML = `${meter}${me}${add}${lists || '<div class="aces-card"><p class="pu-empty">No RSVPs yet.</p></div>'}`;
}

function rsvpRow(r) {
  const meta = [];
  if (r.guest) meta.push(`Guest${r.setBy?.name ? ` of ${esc(r.setBy.name)}` : ''}`);
  else if (r.self === false && r.setBy?.name) meta.push(`marked by ${esc(r.setBy.name)}`);
  if (r.note) meta.push(esc(r.note));
  const name = r.playerId ? `<a href="${esc(playerUrl({ id: r.playerId }))}">${esc(r.name)}</a>` : esc(r.name);
  const edit = canEditRsvp(r) && S.game.status !== 'cancelled'
    ? `<span class="pu-row-acts">${STATUS.map(([v, l, ic]) =>
        `<button type="button" class="pu-mini is-${v}${r.status === v ? ' is-on' : ''}" data-act="row-status" data-key="${esc(r.key)}" data-status="${v}" aria-label="Mark ${esc(r.name)} ${l.toLowerCase()}" aria-pressed="${r.status === v}" title="${l}">${icon(ic)}</button>`).join('')}
        <button type="button" class="pu-mini is-x" data-act="row-remove" data-key="${esc(r.key)}" aria-label="Remove ${esc(r.name)}" title="Remove">${icon('trash')}</button></span>` : '';
  return `<li class="pu-person"><span class="pu-person-main"><span class="pu-name">${name}</span>${posTags(r.pos)}${meta.length ? `<span class="pu-meta">${meta.join(' &middot; ')}</span>` : ''}</span>${edit}</li>`;
}

function readMine() {
  const form = $('puMine');
  return {
    pos: [...form.querySelectorAll('input[name="pos"]:checked')].map((i) => i.value),
    note: String(form.elements.note.value || '').trim()
  };
}

async function saveMine(status) {
  const { pos, note } = readMine();
  const cur = S.rsvps.get(S.me.key);
  try {
    await setDoc(doc(db, COL, S.id, 'rsvps', S.me.key), selfRsvp(status || cur?.status || 'yes', pos, note), { merge: true });
    if ($('puMine')) delete $('puMine').dataset.touched;
    if (!status) showToast('Saved.');
  } catch (e) {
    console.error('[pickup] rsvp', e);
    showToast("Your RSVP didn't save. Try again.", 'error');
  }
}

async function setRowStatus(key, status) {
  const r = S.rsvps.get(key);
  if (!r) return;
  const mine = r.ownerUid === S.uid;
  const data = { status, setBy: { uid: S.uid, name: S.me.name }, updatedAt: serverTimestamp() };
  if (mine) Object.assign(data, { self: true, ownerUid: S.uid });
  else if (!r.guest) data.self = false;
  if (r.guest) Object.assign(data, { guest: true, addedBy: r.addedBy });
  try {
    await setDoc(doc(db, COL, S.id, 'rsvps', key), data, { merge: true });
  } catch (e) {
    console.error('[pickup] row status', e);
    showToast("That didn't save. Try again.", 'error');
  }
}

async function removeRow(key) {
  const r = S.rsvps.get(key);
  if (!r || !(await confirmModal(`Remove ${r.name} from this game?`, { confirmLabel: 'Remove', danger: true }))) return;
  try {
    await deleteDoc(doc(db, COL, S.id, 'rsvps', key));
  } catch (e) {
    console.error('[pickup] remove', e);
    showToast("That didn't remove. Try again.", 'error');
  }
}

function modalForm(inner) {
  const form = document.createElement('form');
  form.className = 'pu-modal-form';
  form.innerHTML = inner;
  form.addEventListener('submit', (e) => e.preventDefault());
  return form;
}

const statusSelect = (sel = 'yes') => `<label class="aces-field"><span class="aces-label">Status</span><span class="aces-select-wrap"><select class="aces-select" name="status">
  ${STATUS.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('')}</select></span></label>`;

async function markPlayer() {
  await loadStats();
  const form = modalForm(`
    <label class="aces-field"><span class="aces-label">Player</span>
      <input class="aces-input" name="player" list="puRoster" autocomplete="off" placeholder="Start typing a name">
      <datalist id="puRoster">${S.roster.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>
      <span class="aces-hint">Not in the list? Use Add a guest instead.</span></label>
    ${statusSelect()}
    <span class="aces-label">Positions</span>${posChips('pos')}
    <label class="aces-field"><span class="aces-label">Note (optional)</span><input class="aces-input" name="note" maxlength="80"></label>
    <p class="pu-error" hidden></p>`);
  const pick = () => {
    const v = String(form.elements.player.value || '').trim().toLowerCase();
    return S.roster.find((p) => p.name.toLowerCase() === v) || null;
  };
  const ok = await openModal({
    title: 'Mark a player', body: form,
    actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, variant: 'primary' }],
    onOpen: () => form.elements.player.focus(),
    beforeClose: (value) => {
      if (!value) return true;
      const err = pick() ? '' : 'Pick a player from the list.';
      const p = form.querySelector('.pu-error');
      p.textContent = err;
      p.hidden = !err;
      return !err;
    }
  });
  if (!ok) return;
  const p = pick();
  const cur = S.rsvps.get(p.id);
  const pos = [...form.querySelectorAll('input[name="pos"]:checked')].map((i) => i.value);
  try {
    await setDoc(doc(db, COL, S.id, 'rsvps', p.id), {
      status: form.elements.status.value, name: p.name, playerId: p.id,
      pos: pos.length ? pos : (cur?.pos || []), note: String(form.elements.note.value || '').trim() || cur?.note || '',
      self: false, guest: false,
      setBy: { uid: S.uid, name: S.me.name }, updatedAt: serverTimestamp()
    }, { merge: true });
    showToast(`${p.name} marked.`);
  } catch (e) {
    console.error('[pickup] mark', e);
    showToast("That didn't save. Try again.", 'error');
  }
}

async function addGuest() {
  const form = modalForm(`
    <label class="aces-field"><span class="aces-label">Guest's name</span><input class="aces-input" name="name" maxlength="50" autocomplete="off"></label>
    <label class="aces-field"><span class="aces-label">How good are they?</span><span class="aces-select-wrap"><select class="aces-select" name="tier">${tierOptions()}</select></span>
      <span class="aces-hint">Used only to balance teams. Not shown to other players.</span></label>
    ${statusSelect()}
    <span class="aces-label">Positions</span>${posChips('pos')}
    <p class="pu-error" hidden></p>`);
  const ok = await openModal({
    title: 'Add a guest', body: form,
    actions: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, variant: 'primary' }],
    onOpen: () => form.elements.name.focus(),
    beforeClose: (value) => {
      if (!value) return true;
      const err = String(form.elements.name.value || '').trim() ? '' : 'Add a name.';
      const p = form.querySelector('.pu-error');
      p.textContent = err;
      p.hidden = !err;
      return !err;
    }
  });
  if (!ok) return;
  const key = `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    await setDoc(doc(db, COL, S.id, 'rsvps', key), {
      status: form.elements.status.value, name: String(form.elements.name.value).trim(), playerId: null,
      pos: [...form.querySelectorAll('input[name="pos"]:checked')].map((i) => i.value), note: '',
      self: false, guest: true, tier: Number(form.elements.tier.value) || DEFAULT_TIER, addedBy: S.uid,
      setBy: { uid: S.uid, name: S.me.name }, updatedAt: serverTimestamp()
    });
    showToast('Guest added.');
  } catch (e) {
    console.error('[pickup] guest', e);
    showToast("That didn't save. Try again.", 'error');
  }
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

function playerOf(key) {
  const r = S.rsvps.get(key);
  const saved = [...(S.game.teams?.a?.players || []), ...(S.game.teams?.b?.players || [])].find((p) => p.key === key);
  if (!r && !saved) return null;
  const stat = r?.playerId ? S.ratings?.byId.get(r.playerId) : null;
  const rating = stat?.power ?? (r?.tier != null ? Number(r.tier) : DEFAULT_TIER);
  return {
    key,
    name: r?.name || saved?.name || 'Player',
    status: r?.status || 'gone',
    pos: r?.pos || [],
    rating,
    source: stat?.power != null ? 'stats' : r?.guest ? 'guest' : 'no stats'
  };
}

function newDraft() {
  const t = S.game.teams;
  return {
    a: (t?.a?.players || []).map((p) => p.key),
    b: (t?.b?.players || []).map((p) => p.key),
    names: { a: t?.a?.name || DEFAULT_NAMES.a, b: t?.b?.name || DEFAULT_NAMES.b },
    locks: { ...(t?.locks || {}) },
    rules: [...(S.game.teamRules || [])],
    includeMaybe: false,
    options: [], at: 0,
    dirty: false
  };
}

/** Everyone who could play: In, plus Maybe when included, plus anyone already placed. */
function poolKeys(d) {
  const keys = new Set([...d.a, ...d.b]);
  for (const r of S.rsvps.values()) {
    if (r.status === 'yes' || (d.includeMaybe && r.status === 'maybe')) keys.add(r.key);
  }
  return [...keys];
}

async function renderTeams() {
  const box = $('pu-teams');
  if (!S.ratings) {
    box.innerHTML = '<div class="aces-card"><span class="aces-skeleton is-row"></span><span class="aces-skeleton is-row"></span></div>';
    await loadStats();
    if (S.tab === 'teams') renderTeams();
    return;
  }
  if (isManager() && S.game.status !== 'cancelled') return renderEditor();
  const t = S.game.teams;
  if (!t) {
    box.innerHTML = `<div class="aces-card"><p class="pu-empty">Teams aren't set yet. The organizer or a captain splits them once people are in.</p></div>`;
    return;
  }
  const col = (side) => `<div class="aces-card pu-team">
    <h3 class="pu-team-name">${esc(t[side].name)} <span>${t[side].players.length}</span></h3>
    <ul class="pu-people">${t[side].players.map((p) => { const r = S.rsvps.get(p.key); return `<li class="pu-person"><span class="pu-person-main"><span class="pu-name">${esc(r?.name || p.name)}</span>${posTags(r?.pos)}</span></li>`; }).join('')}</ul>
  </div>`;
  box.innerHTML = `<p class="pu-sub">Split by power rating (career Aces BPI and this season's bWAR) and positions.</p><div class="pu-teams">${col('a')}${col('b')}</div>`;
}

function renderEditor() {
  if (!S.draft) S.draft = newDraft();
  const d = S.draft;
  const pool = poolKeys(d);
  const inA = new Set(d.a);
  const inB = new Set(d.b);
  const out = pool.filter((k) => !inA.has(k) && !inB.has(k));
  const maybes = [...S.rsvps.values()].filter((r) => r.status === 'maybe').length;
  const rep = splitReport(d.a, d.b, playerOf, { apart: d.rules.filter((r) => r.type === 'apart').map((r) => [r.x, r.y]) });
  const fmt = (v) => v.toFixed(1);

  const issues = [...rep.issues];
  [...d.a, ...d.b].forEach((k) => {
    const p = playerOf(k);
    if (p && p.status !== 'yes' && !(d.includeMaybe && p.status === 'maybe')) issues.push(`${p.name} is ${p.status === 'gone' ? 'no longer on the RSVP list' : `now ${p.status === 'no' ? 'out' : 'a maybe'}`}`);
  });

  const row = (k, side) => {
    const p = playerOf(k);
    if (!p) return '';
    const locked = d.locks[k] === side;
    const acts = side === 'out'
      ? `<button type="button" class="pu-mini" data-act="to-side" data-key="${esc(k)}" data-side="a" title="Put on ${esc(d.names.a)}">${esc(d.names.a.charAt(0) || 'A')}</button>
         <button type="button" class="pu-mini" data-act="to-side" data-key="${esc(k)}" data-side="b" title="Put on ${esc(d.names.b)}">${esc(d.names.b.charAt(0) || 'B')}</button>`
      : `<button type="button" class="pu-mini${locked ? ' is-on' : ''}" data-act="lock" data-key="${esc(k)}" data-side="${side}" title="${locked ? 'Unlock' : 'Lock to this side'}" aria-pressed="${locked}">${icon(locked ? 'lock' : 'unlock')}</button>
         <button type="button" class="pu-mini" data-act="to-side" data-key="${esc(k)}" data-side="${side === 'a' ? 'b' : 'a'}" title="Move to the other side">${icon('arrow-left-right')}</button>
         <button type="button" class="pu-mini" data-act="to-side" data-key="${esc(k)}" data-side="out" title="Sit out">${icon('minus')}</button>`;
    const flag = p.status !== 'yes' ? ` <span class="aces-badge is-alert">${p.status === 'maybe' ? 'Maybe' : p.status === 'no' ? 'Out' : 'Removed'}</span>` : '';
    return `<li class="pu-person"><span class="pu-person-main"><span class="pu-name">${esc(p.name)}${flag}</span>${posTags(p.pos)}
      <span class="pu-meta" title="${p.source === 'stats' ? 'Power rating from stats' : p.source === 'guest' ? 'Guest tier' : 'No stats yet: default tier'}">${fmt(p.rating)}${p.source === 'stats' ? '' : '*'}</span></span>
      <span class="pu-row-acts">${acts}</span></li>`;
  };
  const sideCard = (side, S2) => `<div class="aces-card pu-team">
    <label class="pu-team-name"><input class="aces-input pu-name-input" data-name-side="${side}" value="${esc(d.names[side])}" maxlength="24" aria-label="Team name"></label>
    <p class="pu-team-meta">${plural(S2.count, 'player')} &middot; total ${fmt(S2.total)} &middot; avg ${fmt(S2.avg)}<br>${POSITIONS.map((g) => `${g} ${S2.pos[g]}`).join(' &middot; ')}</p>
    <ul class="pu-people">${(side === 'a' ? d.a : d.b).map((k) => row(k, side)).join('') || '<li class="pu-meta">Nobody yet</li>'}</ul>
  </div>`;

  const ruleName = (k) => playerOf(k)?.name || 'Player';
  const ruleOpts = pool.map((k) => `<option value="${esc(k)}">${esc(playerOf(k)?.name || k)}</option>`).join('');

  $('pu-teams').innerHTML = `
    <div class="aces-card pu-tools">
      <div class="aces-cluster">
        <button type="button" class="aces-btn is-primary" data-act="balance"${pool.length < 2 ? ' disabled' : ''}>${icon('sparkles')}Auto-balance</button>
        <button type="button" class="aces-btn" data-act="reroll"${d.options.length ? '' : ' disabled'}>${icon('shuffle')}Re-roll</button>
        <button type="button" class="aces-btn is-ghost" data-act="clear-teams"${d.a.length || d.b.length ? '' : ' disabled'}>Clear</button>
      </div>
      ${maybes ? `<label class="pu-check"><input type="checkbox" data-act="include-maybe"${d.includeMaybe ? ' checked' : ''}> Include maybes (${maybes})</label>` : ''}
      <p class="pu-balance">${d.a.length || d.b.length
        ? `Rating gap <strong>${fmt(Math.abs(rep.diff))}</strong> &middot; average gap ${fmt(Math.abs(rep.avgDiff))}`
        : `${plural(pool.length, 'player')} to place. Auto-balance splits them, or place them by hand.`}</p>
      ${issues.length ? `<ul class="pu-issues">${issues.map((i) => `<li>${icon('alert')}${esc(i)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="pu-teams">${sideCard('a', rep.a)}${sideCard('b', rep.b)}</div>
    ${out.length ? `<div class="aces-card pu-list-card"><h3 class="pu-list-title">Not placed <span>${out.length}</span></h3><ul class="pu-people">${out.map((k) => row(k, 'out')).join('')}</ul></div>` : ''}
    <details class="aces-card pu-rules"${(d.rulesOpen ?? d.rules.length) ? ' open' : ''}>
      <summary>Keep together / keep apart${d.rules.length ? ` (${d.rules.length})` : ''}</summary>
      ${d.rules.length ? `<ul class="pu-rule-list">${d.rules.map((r, i) => `<li>${esc(ruleName(r.x))} ${r.type === 'apart' ? '<em>apart from</em>' : '<em>with</em>'} ${esc(ruleName(r.y))}
        <button type="button" class="pu-mini is-x" data-act="rule-remove" data-i="${i}" aria-label="Remove rule">${icon('close')}</button></li>`).join('')}</ul>` : ''}
      <div class="pu-rule-add">
        <span class="aces-select-wrap"><select class="aces-select is-sm" data-rule="x">${ruleOpts}</select></span>
        <span class="aces-select-wrap"><select class="aces-select is-sm" data-rule="type"><option value="together">with</option><option value="apart">apart from</option></select></span>
        <span class="aces-select-wrap"><select class="aces-select is-sm" data-rule="y">${ruleOpts}</select></span>
        <button type="button" class="aces-btn is-sm" data-act="rule-add"${pool.length < 2 ? ' disabled' : ''}>${icon('plus')}Add</button>
      </div>
      <p class="pu-meta">Auto-balance follows these. Locked players stay on their side.</p>
    </details>
    <div class="pu-savebar${d.dirty ? ' is-dirty' : ''}">
      <span class="pu-meta">${d.dirty ? 'Unsaved changes' : S.game.teams ? `Saved${S.game.teams.savedBy?.name ? ` by ${esc(S.game.teams.savedBy.name)}` : ''}` : 'Not saved yet'}. Ratings with * have no stats. Only organizers and captains see ratings.</span>
      <div class="aces-cluster">
        ${S.game.teams ? `<button type="button" class="aces-btn is-ghost is-sm" data-act="unsave-teams">Remove saved teams</button>` : ''}
        <button type="button" class="aces-btn is-primary" data-act="save-teams"${d.dirty && (d.a.length || d.b.length) ? '' : ' disabled'}>${icon('save')}Save teams</button>
      </div>
    </div>`;
}

function touch() {
  S.draft.dirty = true;
  renderEditor();
}

function runBalance(fresh = true) {
  const d = S.draft;
  const keys = poolKeys(d).filter((k) => { const p = playerOf(k); return p && (p.status === 'yes' || (d.includeMaybe && p.status === 'maybe')); });
  const have = new Set(keys);
  const locks = Object.fromEntries(Object.entries(d.locks).filter(([k]) => have.has(k)));
  const pairs = (type) => d.rules.filter((r) => r.type === type && have.has(r.x) && have.has(r.y)).map((r) => [r.x, r.y]);
  if (fresh || !d.options.length) {
    const opts = balanceOptions(keys.map(playerOf), { locks, together: pairs('together'), apart: pairs('apart') });
    const best = opts[0]?.cost ?? 0;
    d.options = opts.filter((o) => o.cost <= best + Math.max(3, best * 0.25));
    d.at = 0;
  } else {
    d.at += 1;
    if (d.at >= d.options.length) {
      if (d.options.length === 1) showToast("That's the only split this close. Edit by hand or loosen a lock.", 'info');
      d.at = 0;
    }
  }
  const o = d.options[d.at];
  if (!o) return;
  d.a = [...o.a];
  d.b = [...o.b];
  touch();
}

function moveTo(key, side) {
  const d = S.draft;
  d.a = d.a.filter((k) => k !== key);
  d.b = d.b.filter((k) => k !== key);
  if (side === 'a') d.a.push(key);
  if (side === 'b') d.b.push(key);
  if (d.locks[key] && d.locks[key] !== side) delete d.locks[key];
  touch();
}

async function saveTeams() {
  const d = S.draft;
  const snap = (keys) => keys.map((k) => ({ key: k, name: playerOf(k)?.name || 'Player' }));
  const used = new Set([...d.a, ...d.b]);
  try {
    await updateDoc(doc(db, COL, S.id), {
      teams: {
        a: { name: d.names.a.trim() || DEFAULT_NAMES.a, players: snap(d.a) },
        b: { name: d.names.b.trim() || DEFAULT_NAMES.b, players: snap(d.b) },
        locks: Object.fromEntries(Object.entries(d.locks).filter(([k]) => used.has(k))),
        savedBy: { uid: S.uid, name: S.me.name },
        savedAt: serverTimestamp()
      },
      teamRules: d.rules,
      updatedAt: serverTimestamp()
    });
    d.dirty = false;
    renderGame();
    showToast('Teams saved.');
  } catch (e) {
    console.error('[pickup] teams', e);
    showToast("Teams didn't save. Try again.", 'error');
  }
}

async function unsaveTeams() {
  if (!(await confirmModal('Remove the saved teams? Everyone will see "Teams aren\'t set yet" again.', { confirmLabel: 'Remove', danger: true }))) return;
  try {
    await updateDoc(doc(db, COL, S.id), { teams: null, updatedAt: serverTimestamp() });
    S.draft = null;
  } catch (e) {
    console.error('[pickup] unsave', e);
    showToast("That didn't save. Try again.", 'error');
  }
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

async function loadPhotos() {
  try {
    const snap = await getDocs(query(collection(db, 'teamPhotos'), where('pickupId', '==', S.id)));
    S.photos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.url)
      .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  } catch (err) {
    console.warn('[pickup] photos', err);
    S.photos = [];
  }
  S.photosLoaded = true;
}

async function renderPhotos() {
  const box = $('pu-photos');
  if (!S.photosLoaded) {
    box.innerHTML = '<div class="aces-card"><span class="aces-skeleton is-row"></span></div>';
    await loadPhotos();
  }
  if (S.tab !== 'photos') return;
  const canUpload = S.user && hasRole(S.ctx.profile, UPLOAD_ROLES);
  const upload = canUpload ? `<form class="aces-card media-upload" id="puUpload">
      <div class="aces-card-head"><h2 class="aces-card-title">${icon('upload')} Add photos and videos</h2></div>
      <label class="aces-field"><span class="aces-label">Caption (optional)</span><input class="aces-input" name="caption" maxlength="80" placeholder="Pick-up ${esc(formatGameDate(S.game.date, 'monthDay'))}"></label>
      <label class="media-drop" data-drop>
        ${icon('camera')}<strong>Choose photos or videos</strong><span>JPG, PNG, HEIC, GIF, WEBP, MP4 or MOV, up to 50 MB each. iPhone photos are converted to JPG.</span>
        <input type="file" name="files" accept="image/*,.heic,.heif,video/mp4,video/quicktime" multiple hidden>
      </label>
      <ul class="media-files" data-files></ul>
      <div class="aces-cluster"><button type="submit" class="aces-btn is-primary" data-upload-btn disabled>Upload</button></div>
    </form>` : '';
  const grid = S.photos.length
    ? `<ul class="media-grid">${S.photos.map((p, i) => `<li>
        <button type="button" class="media-thumb${p.type === 'video' ? ' is-video' : ''}" data-act="view" data-i="${i}" aria-label="${esc(p.name || 'Photo')}">
          ${p.type === 'video' ? `<video src="${esc(p.url)}#t=0.5" muted playsinline preload="metadata"></video><span class="media-play">${icon('play')}</span>` : `<img src="${esc(p.url)}" alt="" loading="lazy" decoding="async">`}
        </button></li>`).join('')}</ul>`
    : `<div class="aces-card"><p class="pu-empty">No photos from this game yet.${canUpload ? '' : ' Photographers, captains and team staff can add them.'}</p></div>`;
  box.innerHTML = `${grid}${upload}`;
  renderFiles();
}

function renderFiles() {
  const form = $('puUpload');
  if (!form) return;
  form.querySelector('[data-files]').innerHTML = S.files.map((f) => `<li class="${f.state ? `is-${f.state}` : ''}">
    <span class="media-file-name">${esc(f.file.name)}</span><span class="media-file-size">${(f.file.size / 1048576).toFixed(1)} MB</span>
    <span class="media-file-state">${f.state === 'done' ? 'Uploaded' : f.state === 'failed' ? esc(f.error || 'Failed') : f.state === 'uploading' ? 'Uploading...' : ''}</span></li>`).join('');
  const pending = S.files.filter((f) => !f.state).length;
  const btn = form.querySelector('[data-upload-btn]');
  btn.disabled = !pending;
  btn.textContent = pending ? `Upload ${plural(pending, 'file')}` : 'Upload';
}

function addFiles(list) {
  for (const file of list) {
    if (!/^(image|video)\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) continue;
    S.files.push(file.size > 50 * 1048576 ? { file, state: 'failed', error: 'Over 50 MB' } : { file });
  }
  renderFiles();
}

async function upload(form) {
  const { uploadPhoto } = await import('../../firebase-storage.js');
  const caption = form.elements.caption.value.trim() || `Pick-up ${formatGameDate(S.game.date, 'monthDay')}`;
  const todo = S.files.filter((f) => !f.state);
  let n = 0;
  for (const f of todo) {
    f.state = 'uploading';
    renderFiles();
    const res = await uploadPhoto(f.file, 'pickup', todo.length > 1 ? `${caption} ${++n}` : caption, null);
    if (res?.success) {
      try { await updateDoc(doc(db, 'teamPhotos', res.photoId), { pickupId: S.id, pickupDate: toDateKey(S.game.date) }); } catch (e) { console.warn('[pickup] tag photo', e); }
    }
    f.state = res?.success ? 'done' : 'failed';
    f.error = res?.error || '';
    renderFiles();
  }
  const ok = todo.filter((f) => f.state === 'done').length;
  showToast(ok === todo.length ? `Uploaded ${plural(ok, 'file')}.` : `${ok} of ${todo.length} uploaded.`, ok ? 'success' : 'error');
  S.files = [];
  S.photosLoaded = false;
  renderPhotos();
}

function openViewer(i) {
  if (!S.photos.length) return;
  S.viewerAt = (i + S.photos.length) % S.photos.length;
  const p = S.photos[S.viewerAt];
  const v = $('puViewer');
  v.querySelector('[data-stage]').innerHTML = p.type === 'video'
    ? `<video src="${esc(p.url)}" controls autoplay playsinline></video>`
    : `<img src="${esc(p.url)}" alt="${esc(p.name || '')}">`;
  v.querySelector('[data-info]').innerHTML = `<strong>${esc(p.name || '')}</strong><span>${p.uploadedByName ? `${esc(p.uploadedByName)} &middot; ` : ''}${S.viewerAt + 1} of ${S.photos.length}</span>`;
  if (!v.open) v.showModal();
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function renderResult() {
  const g = S.game;
  const names = { a: g.teams?.a?.name || DEFAULT_NAMES.a, b: g.teams?.b?.name || DEFAULT_NAMES.b };
  const r = g.result;
  const has = r && r.a != null;
  const board = has ? `<div class="aces-card pu-score">
      <div class="pu-score-side${r.a > r.b ? ' is-win' : ''}"><span>${esc(names.a)}</span><strong>${esc(r.a)}</strong></div>
      <span class="pu-score-dash">-</span>
      <div class="pu-score-side${r.b > r.a ? ' is-win' : ''}"><span>${esc(names.b)}</span><strong>${esc(r.b)}</strong></div>
      ${r.notes ? `<p class="pu-notes">${esc(r.notes)}</p>` : ''}
    </div>` : `<div class="aces-card"><p class="pu-empty">No score entered${toDateKey(g.date) >= todayKey() ? ' yet' : ''}. Keeping score is optional.</p></div>`;
  const form = isManager() ? `<form class="aces-card pu-result-form" id="puResult">
      <div class="aces-card-head"><h2 class="aces-card-title">${has ? 'Update the score' : 'Enter the score'}</h2></div>
      <div class="pu-form-grid">
        <label class="aces-field"><span class="aces-label">${esc(names.a)}</span><input class="aces-input" type="number" name="a" min="0" max="99" inputmode="numeric" value="${has ? esc(r.a) : ''}"></label>
        <label class="aces-field"><span class="aces-label">${esc(names.b)}</span><input class="aces-input" type="number" name="b" min="0" max="99" inputmode="numeric" value="${has ? esc(r.b) : ''}"></label>
      </div>
      <label class="aces-field"><span class="aces-label">Notes (optional)</span><input class="aces-input" name="notes" maxlength="200" value="${esc(r?.notes || '')}" placeholder="Walk-off, mercy rule, played 5 innings..."></label>
      <p class="pu-error" hidden></p>
      <div class="aces-cluster">
        <button type="submit" class="aces-btn is-primary">${icon('save')}Save score</button>
        ${has ? '<button type="button" class="aces-btn is-ghost" data-act="clear-result">Clear score</button>' : ''}
      </div>
      <p class="pu-meta">Pick-up scores never count toward league stats.</p>
    </form>` : '';
  $('pu-result').innerHTML = `${board}${form}`;
}

async function saveResult(form) {
  const a = form.elements.a.value;
  const b = form.elements.b.value;
  const bad = a === '' || b === '' || !Number.isInteger(Number(a)) || !Number.isInteger(Number(b)) || Number(a) < 0 || Number(b) < 0;
  const p = form.querySelector('.pu-error');
  p.textContent = bad ? 'Enter both scores.' : '';
  p.hidden = !bad;
  if (bad) return;
  try {
    await updateDoc(doc(db, COL, S.id), {
      result: { a: Number(a), b: Number(b), notes: form.elements.notes.value.trim(), enteredBy: { uid: S.uid, name: S.me.name }, enteredAt: serverTimestamp() },
      status: 'final', updatedAt: serverTimestamp()
    });
    if ($('puResult')) delete $('puResult').dataset.touched;
    showToast('Score saved.');
  } catch (e) {
    console.error('[pickup] result', e);
    showToast("The score didn't save. Try again.", 'error');
  }
}

async function clearResult() {
  try {
    await updateDoc(doc(db, COL, S.id), { result: null, status: 'open', updatedAt: serverTimestamp() });
  } catch (e) {
    console.error('[pickup] clear result', e);
    showToast("That didn't save. Try again.", 'error');
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const ACTIONS = {
  'new-game': () => { const f = $('puForm'); f.innerHTML = formHtml(); f.hidden = false; f.querySelector('[name="date"]').focus(); },
  'form-cancel': (el) => { el.closest('form').hidden = true; },
  'edit-game': () => { const f = $('puEditForm'); f.innerHTML = formHtml(S.game); f.hidden = false; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'cancel-game': async () => { if (await confirmModal('Cancel this game? RSVPs stay, and you can reopen it.', { confirmLabel: 'Cancel game', danger: true })) setStatus('cancelled'); },
  reopen: () => setStatus('open'),
  'delete-game': deleteGame,
  'my-status': (el) => saveMine(el.dataset.status),
  'row-status': (el) => setRowStatus(el.dataset.key, el.dataset.status),
  'row-remove': (el) => removeRow(el.dataset.key),
  'mark-player': markPlayer,
  'add-guest': addGuest,
  balance: () => runBalance(true),
  reroll: () => runBalance(false),
  'clear-teams': () => { Object.assign(S.draft, { a: [], b: [], options: [], at: 0 }); touch(); },
  'to-side': (el) => moveTo(el.dataset.key, el.dataset.side),
  lock: (el) => {
    const d = S.draft;
    if (d.locks[el.dataset.key] === el.dataset.side) delete d.locks[el.dataset.key]; else d.locks[el.dataset.key] = el.dataset.side;
    d.options = [];
    touch();
  },
  'rule-add': () => {
    const box = $('pu-teams');
    const x = box.querySelector('[data-rule="x"]').value;
    const y = box.querySelector('[data-rule="y"]').value;
    const type = box.querySelector('[data-rule="type"]').value;
    if (!x || !y || x === y) { showToast('Pick two different players.', 'error'); return; }
    S.draft.rules = S.draft.rules.filter((r) => !((r.x === x && r.y === y) || (r.x === y && r.y === x)));
    S.draft.rules.push({ x, y, type });
    S.draft.options = [];
    touch();
  },
  'rule-remove': (el) => { S.draft.rules.splice(Number(el.dataset.i), 1); S.draft.options = []; touch(); },
  'save-teams': saveTeams,
  'unsave-teams': unsaveTeams,
  'clear-result': clearResult,
  view: (el) => openViewer(Number(el.dataset.i))
};

function wire() {
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); goTab(go.dataset.goto); return; }
    const el = e.target.closest('[data-act]');
    if (el && el.tagName !== 'INPUT' && ACTIONS[el.dataset.act]) { ACTIONS[el.dataset.act](el); return; }
    const step = e.target.closest('[data-viewer-step]');
    if (step) { openViewer(S.viewerAt + Number(step.dataset.viewerStep)); return; }
    if (e.target.closest('[data-viewer-close]') || e.target === $('puViewer')) $('puViewer').close();
  });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'puForm') { e.preventDefault(); createGame(f); }
    if (f.id === 'puEditForm') { e.preventDefault(); saveEdit(f); }
    if (f.id === 'puMine') { e.preventDefault(); saveMine(null); }
    if (f.id === 'puResult') { e.preventDefault(); saveResult(f); }
    if (f.id === 'puUpload') { e.preventDefault(); upload(f); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    const tf = t.closest?.('#puMine, #puResult');
    if (tf) tf.dataset.touched = '1';
    if (t.matches('[data-act="include-maybe"]')) { S.draft.includeMaybe = t.checked; S.draft.options = []; renderEditor(); }
    if (t.name === 'files' && t.closest('#puUpload')) { addFiles(t.files); t.value = ''; }
  });
  document.addEventListener('toggle', (e) => { if (e.target.matches?.('.pu-rules') && S.draft) S.draft.rulesOpen = e.target.open; }, true);
  document.addEventListener('input', (e) => {
    const t = e.target;
    const tf = t.closest?.('#puMine, #puResult');
    if (tf) tf.dataset.touched = '1';
    if (t.dataset.nameSide && S.draft) {
      S.draft.names[t.dataset.nameSide] = t.value;
      if (!S.draft.dirty) { S.draft.dirty = true; const btn = $('pu-teams').querySelector('[data-act="save-teams"]'); if (btn) btn.disabled = false; $('pu-teams').querySelector('.pu-savebar')?.classList.add('is-dirty'); }
    }
  });
  document.addEventListener('dragover', (e) => { const d = e.target.closest('[data-drop]'); if (d) { e.preventDefault(); d.classList.add('is-over'); } });
  document.addEventListener('dragleave', (e) => { e.target.closest('[data-drop]')?.classList.remove('is-over'); });
  document.addEventListener('drop', (e) => {
    const d = e.target.closest('[data-drop]');
    if (!d) return;
    e.preventDefault();
    d.classList.remove('is-over');
    addFiles(e.dataTransfer.files);
  });
  document.addEventListener('keydown', (e) => {
    if (!$('puViewer').open) return;
    if (e.key === 'ArrowLeft') openViewer(S.viewerAt - 1);
    if (e.key === 'ArrowRight') openViewer(S.viewerAt + 1);
  });
  $('puViewer').addEventListener('close', () => { $('puViewer').querySelector('[data-stage]').innerHTML = ''; });
  window.addEventListener('beforeunload', (e) => { if (S.draft?.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

// Positions from the player's own questionnaire, to prefill their RSVP.
async function loadMyPositions() {
  if (!S.user) return;
  try {
    const snap = await getDoc(doc(db, 'draftQuestionnaires', S.uid));
    if (snap.exists()) S.myPos = positionGroups(snap.data().preferredPositions);
  } catch { /* no questionnaire: no prefill */ }
}

async function main() {
  const ctx = await initPage({ title: 'Pick-up' });
  S.ctx = ctx;
  S.user = ctx.user || null;
  S.uid = S.user?.uid || '';
  if (S.user) S.me = myIdentity(ctx.realProfile || ctx.profile, S.user);
  S.id = new URLSearchParams(location.search).get('id') || '';
  wire();
  await loadMyPositions();
  if (S.id) {
    loadStats();   // in the background: the picker and ratings need it
    await showGame();
  } else {
    await showList();
  }
  pageReady();
}

main().catch((err) => showPageError(err));
