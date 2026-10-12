// js/admin/people-members.js
// The Members tab of admin/people.html: every users doc, with roles, linked
// player, profile setup (player info, notifications, directory: done or
// skipped), push, and last visit. Edit roles opens a dialog; View As
// (admins only) starts admin-impersonate.js and opens Me as that member.
//
// Saving roles writes, as the old Roles page did: userRole, teamRoles
// ({ Team: { role, status, approvedBy, approvedAt } }, keys capitalized),
// specialRoles, linkedTeam, isCaptain, isTeamStaff, isAdmin and the stamps,
// then adds or removes the member in teams/{team}.captainIds.
// Fixed here: teamRoles keys are matched without case, so a captain stored
// under 'teal' stays a captain when saved as 'Teal' (the old page dropped him
// from captainIds), and roles on teams that are no longer in the league are
// kept instead of being wiped.

import { siteUrl } from '../core/app.js';
import { db, collection, doc, getDocs, updateDoc, serverTimestamp, arrayUnion, arrayRemove } from '../core/firebase.js';
import { getSeasonGames } from '../data/games.js';
import { normalizeGames } from '../domain/standings.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';
import { teamDot } from '../ui/game-shared.js';

const $ = (id) => document.getElementById(id);
const PAGE = 25;
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const lower = (s) => String(s || '').toLowerCase();

const LEAGUE_ROLES = {
  admin: ['Admin', 'Full access to everything'],
  'league-staff': ['League staff', 'Runs league operations'],
  player: ['Player', 'Plays in the league'],
  fan: ['Fan', 'Follows the league'],
  family: ['Family', "A player's family member"]
};
const TEAM_ROLES = { captain: 'Captain', 'team-staff': 'Team staff' };
const SPECIAL_ROLES = {
  eulogist: ['Eulogist', 'Writes team eulogies'],
  photographer: ['Photographer', 'Uploads and manages league photos'],
  oddsmaker: ['Oddsmaker', 'Sets game odds'],
  statistician: ['Statistician', 'Advanced stats access and editing'],
  historian: ['Historian', 'Edits historical records'],
  umpire: ['Umpire', 'League umpire'],
  scorekeeper: ['Scorekeeper', 'Game tracker for any team'],
  mallCop: ['Mall Cop', 'Reports violations on the Wall of Shame'],
  mediaManager: ['Media manager', 'Manages YouTube channels and podcasts on Media']
};

let ctx = null;
let all = [];          // decorated users
let teams = [];        // [{ id: 'teal', name: 'Teal', current: true }]
let page = 1;

// ---------------------------------------------------------------------------
// Decorating a users doc
// ---------------------------------------------------------------------------

const tokenCount = (u) => (Array.isArray(u.fcmTokens) ? u.fcmTokens.length : u.fcmTokens ? Object.keys(u.fcmTokens).length : 0);
const isAccount = (u) => !!u.email && !u.email.includes('@placeholder.aces') && u.id.length > 20 && !u.id.includes('_');

/** Active team roles, one per team (keys matched without case): [{ team: 'teal', role }]. */
function teamRolesOf(u) {
  const out = new Map();
  Object.entries(u.teamRoles || {}).forEach(([key, tr]) => {
    if (tr && tr.status === 'active' && tr.role && tr.role !== 'none' && !out.has(lower(key))) out.set(lower(key), tr.role);
  });
  if (u.isCaptain === true && !out.size && u.linkedTeam) out.set(lower(u.linkedTeam), 'captain');   // legacy flag
  return [...out].map(([team, role]) => ({ team, role }));
}

function setupOf(u) {
  const p = u.profileSetupProgress || {};
  const steps = [
    !!(u.position || u.primaryPosition || (u.bats && u.throws)) || !!p.playerInfoDismissed,
    tokenCount(u) > 0 || !!p.notificationsDismissed,
    u.directoryOptIn === true || !!p.directoryDismissed
  ];
  return steps.filter(Boolean).length;
}

function decorate(u) {
  const role = u.isAdmin === true ? 'admin' : (['captain', 'team-staff'].includes(u.userRole) ? (u.linkedPlayer ? 'player' : 'fan') : (u.userRole || 'fan'));
  return {
    ...u,
    _name: u.preferredDisplayName || u.displayName || u.email || u.id,
    _role: LEAGUE_ROLES[role] ? role : 'fan',
    _teams: teamRolesOf(u),
    _special: Object.keys(SPECIAL_ROLES).filter(k => u.specialRoles?.[k] === true),
    _setup: setupOf(u),
    _push: tokenCount(u) > 0,
    _visit: u.lastVisit?.seconds || 0,
    _account: isAccount(u)
  };
}

function ago(sec) {
  if (!sec) return 'Never';
  const d = Date.now() / 1000 - sec;
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return new Date(sec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function renderTiles() {
  const acc = all.filter(u => u._account && !u.migrated);
  const now = Date.now() / 1000;
  const tile = (v, l) => `<div class="aces-stat"><span class="aces-stat-value">${v}</span><span class="aces-stat-label">${esc(l)}</span></div>`;
  $('pmTiles').innerHTML = [
    tile(acc.length, 'Accounts'),
    tile(acc.filter(u => u._role === 'admin').length, 'Admins'),
    tile(acc.filter(u => u._role === 'league-staff').length, 'League staff'),
    tile(acc.filter(u => u._teams.some(t => t.role === 'captain')).length, 'Captains'),
    tile(acc.filter(u => u._push).length, 'Push on'),
    tile(acc.filter(u => u._visit && now - u._visit <= 86400 * 30).length, 'Visited in 30 days'),
    tile(acc.filter(u => u._setup === 3).length, 'Setup done')
  ].join('');
}

function filtered() {
  const q = lower($('pmSearch').value.trim());
  const role = $('pmRole').value, team = $('pmTeam').value, status = $('pmStatus').value;
  const showMigrated = $('pmMigrated').checked;
  const now = Date.now() / 1000;
  return all.filter(u => {
    if (u.migrated && !showMigrated) return false;
    if (q && ![u._name, u.email, u.linkedPlayer].some(v => lower(v).includes(q))) return false;
    if (role) {
      if (role === 'captain' || role === 'team-staff') { if (!u._teams.some(t => t.role === role)) return false; }
      else if (SPECIAL_ROLES[role]) { if (!u._special.includes(role)) return false; }
      else if (u._role !== role) return false;
    }
    if (team && lower(u.linkedTeam) !== team && !u._teams.some(t => t.team === team)) return false;
    if (status === 'setup' && (!u._account || u._setup === 3)) return false;
    if (status === 'nopush' && (!u._account || u._push)) return false;
    if (status === 'stale' && (!u._account || !u._visit || now - u._visit <= 86400 * 60)) return false;
    if (status === 'never' && (!u._account || u._visit)) return false;
    if (status === 'legacy' && u._account) return false;
    return true;
  });
}

function rolesCell(u) {
  const b = [];
  const [label] = LEAGUE_ROLES[u._role];
  b.push(`<span class="aces-badge ${u._role === 'admin' ? 'is-brand' : u._role === 'league-staff' ? 'is-accent' : 'is-outline'}">${esc(label)}</span>`);
  u._teams.forEach(t => b.push(`<span class="aces-badge pp-team">${teamDot(t.team)}${esc(TEAM_ROLES[t.role] || t.role)}, ${esc(cap(t.team))}</span>`));
  u._special.forEach(k => b.push(`<span class="aces-badge">${esc(SPECIAL_ROLES[k][0])}</span>`));
  return `<div class="pp-badges">${b.join('')}</div>`;
}

function render() {
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  page = Math.min(page, pages);
  $('pmCount').textContent = `${list.length} ${list.length === 1 ? 'member' : 'members'}`;
  if (!list.length) {
    $('pmRows').innerHTML = '<tr><td colspan="7" class="aces-empty">Nobody matches those filters.</td></tr>';
    $('pmPager').innerHTML = '';
    return;
  }
  const me = ctx.user.uid;
  $('pmRows').innerHTML = list.slice((page - 1) * PAGE, page * PAGE).map(u => `<tr${u.migrated ? ' class="pp-migrated-row"' : ''}>
    <td><div class="pp-member">
      <span class="aces-avatar pp-avatar">${u.profilePhotoURL ? `<img src="${esc(u.profilePhotoURL)}" alt="" loading="lazy">` : esc(u._name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase())}</span>
      <span><strong>${esc(u._name)}</strong><small>${u._account ? esc(u.email) : u.migrated ? `Merged into ${esc((u.migratedTo || '').slice(0, 8))}...` : 'Player record, no account'}</small></span>
    </div></td>
    <td>${rolesCell(u)}</td>
    <td>${u.linkedPlayer ? `${esc(u.linkedPlayer)}${u.linkedTeam ? `<small class="pp-sub">${esc(cap(u.linkedTeam))}</small>` : ''}` : '<span class="sse-dim">-</span>'}</td>
    <td class="is-num">${u._account ? `<span class="pp-setup is-${u._setup === 3 ? 'done' : u._setup ? 'part' : 'none'}">${u._setup}/3</span>` : '<span class="sse-dim">-</span>'}</td>
    <td>${u._account ? (u._push ? '<span class="aces-badge is-win">On</span>' : '<span class="sse-dim">Off</span>') : '<span class="sse-dim">-</span>'}</td>
    <td class="pp-visit">${u._account ? esc(ago(u._visit)) : '<span class="sse-dim">-</span>'}</td>
    <td class="pp-actions">${u.migrated ? '' : `<button class="aces-btn is-sm" type="button" data-roles="${esc(u.id)}">Roles</button>`}${ctx.realIsAdmin && u._account && !u.migrated && u.id !== me ? `<button class="aces-btn is-sm is-ghost" type="button" data-view-as="${esc(u.id)}">View as</button>` : ''}</td>
  </tr>`).join('');
  $('pmPager').innerHTML = pages > 1 ? `<button class="aces-btn is-sm" type="button" data-page="${page - 1}"${page === 1 ? ' disabled' : ''}>Previous</button>
    <span>Page ${page} of ${pages}</span>
    <button class="aces-btn is-sm" type="button" data-page="${page + 1}"${page === pages ? ' disabled' : ''}>Next</button>` : '';
}

// ---------------------------------------------------------------------------
// Edit roles
// ---------------------------------------------------------------------------

/** Teams to offer: this season's, plus any team the member already has a role on. */
function editorTeams(u) {
  const ids = new Set(teams.filter(t => t.current).map(t => t.id));
  u._teams.forEach(t => ids.add(t.team));
  if (u.linkedTeam) ids.add(lower(u.linkedTeam));
  return [...ids].sort().map(id => teams.find(t => t.id === id) || { id, name: cap(id) });
}

function editorHtml(u) {
  const roleOf = new Map(u._teams.map(t => [t.team, t.role]));
  const list = editorTeams(u);
  return `<form class="pp-editor" id="ppEditor" onsubmit="return false">
    <p class="pp-editor-who"><strong>${esc(u._name)}</strong>${u.email ? ` <span class="sse-dim">${esc(u.email)}</span>` : ''}</p>
    <fieldset><legend>League role</legend>
      <div class="pp-role-grid">${Object.entries(LEAGUE_ROLES).map(([k, [label, desc]]) => `<label class="pp-role-opt">
        <input type="radio" name="leagueRole" value="${k}"${u._role === k ? ' checked' : ''}>
        <span><strong>${esc(label)}</strong><small>${esc(desc)}</small></span></label>`).join('')}</div>
    </fieldset>
    <div class="aces-field" id="ppPrimary"${u._role === 'player' ? '' : ' hidden'}>
      <label class="aces-label" for="ppLinkedTeam">Primary team</label>
      <span class="aces-select-wrap"><select class="aces-select" id="ppLinkedTeam"><option value="">No team</option>
        ${list.map(t => `<option value="${esc(t.id)}"${lower(u.linkedTeam) === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select></span>
    </div>
    <fieldset><legend>Team roles</legend>
      <div class="pp-team-roles">${list.map(t => `<label class="pp-team-role">${teamDot(t.id)}<span>${esc(t.name)}</span>
        <span class="aces-select-wrap"><select class="aces-select" data-team-role="${esc(t.id)}">
          <option value="none">None</option>
          <option value="captain"${roleOf.get(t.id) === 'captain' ? ' selected' : ''}>Captain</option>
          <option value="team-staff"${roleOf.get(t.id) === 'team-staff' ? ' selected' : ''}>Team staff</option>
        </select></span></label>`).join('')}</div>
    </fieldset>
    <fieldset><legend>Special roles</legend>
      <div class="pp-special">${Object.entries(SPECIAL_ROLES).map(([k, [label, desc]]) => `<label class="agg-check"><input type="checkbox" data-special="${k}"${u._special.includes(k) ? ' checked' : ''}> <span><strong>${esc(label)}</strong> <span class="sse-dim">${esc(desc)}</span></span></label>`).join('')}</div>
    </fieldset>
  </form>`;
}

async function syncCaptainIds(userId, before, after) {
  const was = new Set(before), now = new Set(after);
  const jobs = [];
  now.forEach(t => { if (!was.has(t)) jobs.push(updateDoc(doc(db, 'teams', t), { captainIds: arrayUnion(userId) }).catch(e => console.warn(`[people] captainIds add ${t}`, e))); });
  was.forEach(t => { if (!now.has(t)) jobs.push(updateDoc(doc(db, 'teams', t), { captainIds: arrayRemove(userId) }).catch(e => console.warn(`[people] captainIds remove ${t}`, e))); });
  await Promise.all(jobs);
}

/** The dialog's choices: { leagueRole, primary, teamRoles: [[team, role]], special: { key: bool } }. */
function collect(form) {
  const special = {};
  form.querySelectorAll('[data-special]').forEach(c => { special[c.dataset.special] = c.checked; });
  return {
    leagueRole: form.querySelector('input[name="leagueRole"]:checked')?.value || '',
    primary: form.querySelector('#ppLinkedTeam')?.value || '',
    teamRoles: [...form.querySelectorAll('[data-team-role]')].map(sel => [sel.dataset.teamRole, sel.value]),
    special
  };
}

async function saveRoles(u, choice) {
  const me = ctx.user.uid;
  const { leagueRole, primary } = choice;
  const stamp = new Date().toISOString();

  // Existing roles by lowercase team, keeping each entry's data.
  const existing = new Map();
  Object.entries(u.teamRoles || {}).forEach(([key, tr]) => {
    const k = lower(key);
    if (!existing.has(k) || tr?.status === 'active') existing.set(k, tr || {});
  });
  const teamRoles = {};
  existing.forEach((tr, k) => { teamRoles[cap(k)] = tr; });   // teams not shown in the editor keep what they had
  choice.teamRoles.forEach(([k, value]) => {
    const prev = existing.get(k);
    if (value === 'none') {
      if (prev && prev.status === 'active') teamRoles[cap(k)] = { ...prev, status: 'removed', removedBy: me, removedAt: stamp };
    } else {
      const same = prev?.status === 'active' && prev.role === value;
      teamRoles[cap(k)] = same ? prev : { ...(prev || {}), role: value, status: 'active', approvedBy: me, approvedAt: stamp };
    }
  });
  const active = (role) => Object.entries(teamRoles).filter(([, tr]) => tr.status === 'active' && tr.role === role).map(([k]) => lower(k));
  const captainOf = active('captain').sort();

  const updates = {
    userRole: leagueRole,
    teamRoles,
    specialRoles: { ...choice.special },
    isCaptain: captainOf.length > 0,
    isTeamStaff: active('team-staff').length > 0,
    isAdmin: leagueRole === 'admin',
    linkedTeam: leagueRole === 'player' && primary ? cap(primary) : captainOf.length ? cap(captainOf[0]) : (u.linkedTeam ? cap(u.linkedTeam) : null),
    roleUpdatedBy: me,
    roleUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const before = Object.entries(u.teamRoles || {}).filter(([, tr]) => tr?.status === 'active' && tr.role === 'captain').map(([k]) => lower(k));
  await updateDoc(doc(db, 'users', u.id), updates);
  await syncCaptainIds(u.id, before, captainOf);
}

async function editRoles(id) {
  const u = all.find(x => x.id === id);
  if (!u) return;
  let choice = null;
  const value = await openModal({
    title: 'Roles',
    wide: true,
    html: editorHtml(u),
    actions: [{ label: 'Cancel', value: null }, { label: 'Save roles', value: 'save', variant: 'primary' }],
    onOpen: (dialog) => {
      dialog.querySelectorAll('input[name="leagueRole"]').forEach(r => r.addEventListener('change', () => {
        dialog.querySelector('#ppPrimary').hidden = r.value !== 'player' || !r.checked;
      }));
    },
    beforeClose: (v, dialog) => {
      if (v !== 'save') return true;
      const c = collect(dialog.querySelector('#ppEditor'));
      if (!c.leagueRole) { showToast('Pick a league role.', 'warning'); return false; }
      if (c.leagueRole === 'player' && !c.primary) { showToast("Pick the player's primary team.", 'warning'); return false; }
      choice = c;
      return true;
    }
  });
  if (value !== 'save' || !choice) return;
  try {
    await saveRoles(u, choice);
    showToast(`Roles saved for ${u._name}`, 'success');
    await ctx.refreshAll();
    window.dispatchEvent(new CustomEvent('people:changed'));
  } catch (err) {
    console.error('[people] save roles', err);
    showToast(`Could not save: ${err.message || err}`, 'error');
  }
}

async function viewAs(id) {
  const u = all.find(x => x.id === id);
  if (!u) return;
  const { startImpersonation } = await import('../../admin-impersonate.js');
  const res = await startImpersonation({ uid: ctx.user.uid, ...ctx.realProfile }, id);
  if (!res.success) { showToast(res.message || 'Could not start View As', 'error'); return; }
  location.href = siteUrl('me.html');
}

// ---------------------------------------------------------------------------

async function loadTeams() {
  const [snap, games] = await Promise.all([
    getDocs(collection(db, 'teams')).catch(() => null),
    ctx.config?.currentSeasonId ? getSeasonGames(ctx.config.currentSeasonId).catch(() => []) : []
  ]);
  const playing = new Set(normalizeGames(games).flatMap(g => [g.home, g.away]).map(lower).filter(t => t && t !== 'tbd'));
  teams = (snap?.docs || []).map(d => ({ id: lower(d.id), name: cap(d.data().teamName || d.data().name || d.id) }));
  playing.forEach(id => { if (!teams.some(t => t.id === id)) teams.push({ id, name: cap(id) }); });
  teams.forEach(t => { t.current = !playing.size || playing.has(t.id); });
  teams.sort((a, b) => a.name.localeCompare(b.name));
}

export async function refresh() {
  all = (await ctx.users()).map(decorate).sort((a, b) => lower(a._name).localeCompare(lower(b._name)));
  renderTiles();
  render();
}

export async function mount(c) {
  ctx = c;
  $('pmRole').innerHTML = '<option value="">Any role</option>' +
    Object.entries(LEAGUE_ROLES).map(([k, [l]]) => `<option value="${k}">${esc(l)}</option>`).join('') +
    Object.entries(TEAM_ROLES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('') +
    '<optgroup label="Special roles">' + Object.entries(SPECIAL_ROLES).map(([k, [l]]) => `<option value="${k}">${esc(l)}</option>`).join('') + '</optgroup>';
  await loadTeams();
  $('pmTeam').innerHTML = '<option value="">Any team</option>' + teams.filter(t => t.current).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  ['pmSearch', 'pmRole', 'pmTeam', 'pmStatus', 'pmMigrated'].forEach(id => $(id).addEventListener(id === 'pmSearch' ? 'input' : 'change', () => { page = 1; render(); }));
  document.querySelector('[data-panel="members"]').addEventListener('click', (e) => {
    const r = e.target.closest('[data-roles]');
    if (r) return editRoles(r.dataset.roles);
    const v = e.target.closest('[data-view-as]');
    if (v) return viewAs(v.dataset.viewAs);
    const p = e.target.closest('[data-page]');
    if (p) { page = Number(p.dataset.page); render(); document.querySelector('.pp-table').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  });
  await refresh();
}
