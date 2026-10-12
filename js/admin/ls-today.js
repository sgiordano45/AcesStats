// js/admin/ls-today.js
// The Today tab of admin/league-staff.html (it replaced the Commissioner hub):
// standings, tonight's games with players to watch, playoff seeding and the
// latest results, each shareable as an image (copy or save) or as text.
//
// Standings and tiebreakers come from domain/standings.js and seeding from
// projections-clinch.js, so the numbers match Standings and Projections.
// Images: tables are drawn from the table on screen (ui/table.js
// drawTableImage), tonight's games with weekend-share.js, results here.

import { getDisplaySeasonId } from '../core/config.js';
import { db, doc, getDoc } from '../core/firebase.js';
import { getSeasonGames } from '../data/games.js';
import { getAllPlayerStatsOptimized } from '../data/player-stats.js';
import { normalizeGames, computeStandings, isDecided } from '../domain/standings.js';
import { formatGameDate, formatTime, todayKey, timeSortValue } from '../domain/dates.js';
import { seasonLabel } from '../domain/season-ids.js';
import { buildBattingRows } from '../ui/batting-stats.js';
import { escapeHtml as esc, fmtAvg, ordinal } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { drawTableImage } from '../ui/table.js';
import { cap, teamDot, moneyLine, createWatchList } from '../ui/game-shared.js';
import { analyse, statusBadge, byesFor } from '../pages/projections-clinch.js';
import { gamesImageBlob, gamesText, tierOf } from '../pages/weekend-share.js';

const $ = (id) => document.getElementById(id);
const SITE = 'acessoftballreference.com';
const T = { seasonId: '', games: [], standings: [], left: [], tonight: [], results: [], resultsDay: '', playoffTeams: 0, picks: new Map() };

const rec = (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;
const rowOf = (team) => T.standings.find(r => r.team.toLowerCase() === String(team || '').toLowerCase());
const recOf = (team) => { const r = rowOf(team); return r && r.games ? rec(r) : ''; };
const placeOf = (team) => { const r = rowOf(team); return r && r.games ? `${ordinal(r.rank)} place` : ''; };
const stamp = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function shareButtons(what, enabled) {
  const d = enabled ? '' : ' disabled';
  return `<button class="aces-btn is-sm" type="button" data-share-act="copy" data-what="${what}"${d}>${icon('copy')}Copy image</button>
    <button class="aces-btn is-sm" type="button" data-share-act="save" data-what="${what}"${d}>${icon('download')}Save</button>
    <button class="aces-btn is-sm is-ghost" type="button" data-share-act="text" data-what="${what}"${d}>Copy text</button>`;
}

function setShare(what, enabled) {
  const el = document.querySelector(`[data-share="${what}"]`);
  if (el) el.innerHTML = shareButtons(what, enabled);
}

function renderStandings() {
  const rows = T.standings;
  const played = rows.some(r => r.games);
  if (!rows.length || !played) {
    $('ltStandings').innerHTML = '<p class="aces-empty">No games played yet.</p>';
    return setShare('standings', false);
  }
  const ties = rows.some(r => r.ties);
  $('ltStandings').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact lt-table">
    <thead><tr><th scope="col" class="is-num">#</th><th scope="col">Team</th><th scope="col" class="is-num">W</th><th scope="col" class="is-num">L</th>${ties ? '<th scope="col" class="is-num">T</th>' : ''}
      <th scope="col" class="is-num">Pct</th><th scope="col" class="is-num">GB</th><th scope="col" class="is-num">RF</th><th scope="col" class="is-num">RA</th><th scope="col" class="is-num">Diff</th><th scope="col" class="is-num">Last 5</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="is-num">${r.games ? r.rank : '-'}</td>
      <td>${teamDot(r.team)}${esc(cap(r.team))}</td>
      <td class="is-num">${r.wins}</td><td class="is-num">${r.losses}</td>${ties ? `<td class="is-num">${r.ties}</td>` : ''}
      <td class="is-num">${r.games ? fmtAvg(r.winPct) : '-'}</td>
      <td class="is-num">${r.games && r.gamesBack ? r.gamesBack : '-'}</td>
      <td class="is-num">${r.runsFor}</td><td class="is-num">${r.runsAgainst}</td>
      <td class="is-num">${r.runDiff > 0 ? '+' : ''}${r.runDiff}</td>
      <td class="is-num">${esc(r.last5 || '-')}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
  setShare('standings', true);
}

function gameRow(g) {
  const picks = T.picks.get(g.id);
  const col = (team, list) => `<div><h4>${teamDot(team)}${esc(cap(team))}</h4>${list && list.length
    ? `<ul>${list.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : `<p class="sse-dim">${picks ? 'No picks' : '...'}</p>`}</div>`;
  return `<li class="lt-game">
    <div class="lt-game-top">
      <span class="lt-time">${esc(g.time ? formatTime(g.time) : 'TBD')}</span>
      ${g.type === 'playoff' ? `<span class="aces-badge is-brand">${esc(g.round ? cap(g.round) : 'Playoffs')}</span>` : ''}
    </div>
    <div class="lt-matchup">
      <span class="lt-team">${teamDot(g.away)}<strong>${esc(cap(g.away))}</strong><small>${esc(recOf(g.away) || '0-0')}</small></span>
      <span class="lt-at">at</span>
      <span class="lt-team">${teamDot(g.home)}<strong>${esc(cap(g.home))}</strong><small>${esc(recOf(g.home) || '0-0')}</small></span>
    </div>
    <div class="lt-watch">${col(g.away, picks?.away)}${col(g.home, picks?.home)}</div>
  </li>`;
}

function renderTonight() {
  if (!T.tonight.length) {
    $('ltTonight').innerHTML = `<p class="aces-empty">No games today.</p>`;
    return setShare('tonight', false);
  }
  $('ltTonight').innerHTML = `<p class="lt-sub">${esc(formatGameDate(todayKey(), 'long'))}${T.picks.size ? ' · players to watch' : ''}</p>
    <ul class="lt-games">${T.tonight.map(gameRow).join('')}</ul>`;
  setShare('tonight', true);
}

function renderResults() {
  $('ltResultsTitle').textContent = T.resultsDay === todayKey() ? "Today's results" : 'Latest results';
  if (!T.results.length) {
    $('ltResults').innerHTML = '<p class="aces-empty">No results yet this season.</p>';
    return setShare('results', false);
  }
  $('ltResults').innerHTML = `<p class="lt-sub">${esc(formatGameDate(T.resultsDay, 'long'))}</p>
    <ul class="lt-finals">${T.results.map(g => {
      const aw = g.result === 'away', hw = g.result === 'home';
      return `<li>
        ${g.type === 'playoff' ? `<span class="aces-badge is-brand">${esc(g.round ? cap(g.round) : 'Playoffs')}</span>` : ''}
        <span class="lt-final-row${aw ? ' is-win' : ''}">${teamDot(g.away)}${esc(cap(g.away))}<b>${g.hasScores ? g.awayScore : ''}</b></span>
        <span class="lt-final-row${hw ? ' is-win' : ''}">${teamDot(g.home)}${esc(cap(g.home))}<b>${g.hasScores ? g.homeScore : ''}</b></span>
      </li>`;
    }).join('')}</ul>`;
  setShare('results', true);
}

function seedRows() {
  return analyse(T.standings, T.left, Math.min(T.playoffTeams || T.standings.length, T.standings.length));
}

function renderSeeds() {
  if (!T.standings.some(r => r.games)) {
    $('ltSeeds').innerHTML = '<p class="aces-empty">Seeding starts once games are played.</p>';
    return setShare('seeds', false);
  }
  const P = Math.min(T.playoffTeams || T.standings.length, T.standings.length);
  const byes = byesFor(P);
  $('ltSeeds').innerHTML = `<div class="aces-table-wrap"><table class="aces-table is-compact lt-table">
    <thead><tr><th scope="col" class="is-num">Now</th><th scope="col">Team</th><th scope="col" class="is-num">Record</th><th scope="col" class="is-num">Left</th><th scope="col">Possible seeds</th><th scope="col">Status</th></tr></thead>
    <tbody>${seedRows().map(a => `<tr${byes && a.seed === byes ? ' class="lt-bye-edge"' : ''}>
      <td class="is-num">${a.seed}</td>
      <td>${teamDot(a.t.team)}${esc(cap(a.t.team))}</td>
      <td class="is-num">${esc(rec(a.t))}</td>
      <td class="is-num">${a.R}</td>
      <td>${a.clinched ? `<strong>${esc(ordinal(a.best))}</strong>` : `${a.best}&ndash;${a.worst}`}</td>
      <td>${statusBadge(a, byes)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
  setShare('seeds', true);
}

// ---------------------------------------------------------------------------
// Players to watch (loaded after the first paint)
// ---------------------------------------------------------------------------

async function loadPicks() {
  if (!T.tonight.length) return;
  const players = await getAllPlayerStatsOptimized().catch(() => []);
  const bat = buildBattingRows(players || []).filter(r => r.seasonId === T.seasonId);
  const watch = createWatchList({ seasonId: T.seasonId, players: players || [], bat, games: T.games });
  await Promise.all(T.tonight.map(async (g) => {
    const [a, h] = await Promise.all([watch(g.away, g.home), watch(g.home, g.away)]);
    T.picks.set(g.id, { away: a.players.map(p => p.name), home: h.players.map(p => p.name) });
  }));
  renderTonight();
}

// ---------------------------------------------------------------------------
// Share images and text
// ---------------------------------------------------------------------------

/** Tonight as weekend-share items, doubleheaders merged. */
function tonightItems() {
  const out = [];
  const seen = new Map();
  for (const g of T.tonight) {
    const key = [g.away, g.home].map(t => t.toLowerCase()).sort().join('|');
    const picks = T.picks.get(g.id) || { away: [], home: [] };
    const time = g.time ? formatTime(g.time) : '';
    const prev = seen.get(key);
    if (prev) { prev.when = [prev.when, time].filter(Boolean).join(' & '); prev.label = `${prev.label} · Doubleheader`; continue; }
    const it = {
      away: cap(g.away), home: cap(g.home), dateKey: g.dateKey, when: time, time,
      tier: tierOf(g.type, g.round),
      label: g.type === 'playoff' ? (g.round ? cap(g.round) : 'Playoffs') : 'Regular season',
      awayRec: recOf(g.away), homeRec: recOf(g.home), awayPlace: placeOf(g.away), homePlace: placeOf(g.home),
      awayPlayers: picks.away, homePlayers: picks.home,
      line: moneyLine(g.raw?.homeOdds, g.raw?.awayOdds)
    };
    seen.set(key, it);
    out.push(it);
  }
  return out;
}

const canvasBlob = (canvas) => new Promise(res => canvas.toBlob(res, 'image/png'));

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Final scores for one day, in the same green look as the games image. */
async function resultsCanvas() {
  const SANS = 'Inter, system-ui, -apple-system, sans-serif';
  const DISPLAY = '"Bebas Neue", Impact, sans-serif';
  try { await Promise.all([document.fonts.load(`40px ${DISPLAY}`), document.fonts.load(`600 16px ${SANS}`)]); } catch { /* fallback fonts */ }
  const W = 560, PAD = 20, HEAD = 64, SUB = 34, ROW = 84, GAP = 10, FOOT = 34;
  const list = T.results;
  const H = HEAD + SUB + PAD + list.length * (ROW + GAP) + FOOT;
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, HEAD);
  grad.addColorStop(0, '#2d5016'); grad.addColorStop(1, '#1f6b47');
  g.fillStyle = grad; g.fillRect(0, 0, W, HEAD);
  g.fillStyle = '#ffffff'; g.font = `400 34px ${DISPLAY}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(T.resultsDay === todayKey() ? "Today's Results" : 'Final Scores', PAD, HEAD / 2 + 2);
  g.font = `600 12px ${SANS}`; g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillText(seasonLabel(T.seasonId), W - PAD, HEAD / 2);
  g.fillStyle = '#f3f7f1'; g.fillRect(0, HEAD, W, SUB);
  g.fillStyle = '#2d5016'; g.font = `700 12px ${SANS}`; g.textAlign = 'left';
  g.fillText(formatGameDate(T.resultsDay, 'long').toUpperCase(), PAD, HEAD + SUB / 2);

  let y = HEAD + SUB + PAD;
  for (const r of list) {
    g.fillStyle = '#f8faf7'; roundRect(g, PAD, y, W - PAD * 2, ROW, 12); g.fill();
    g.strokeStyle = '#dfe7da'; g.lineWidth = 1; g.stroke();
    const line = (team, score, won, ly) => {
      g.textAlign = 'left'; g.fillStyle = won ? '#2d5016' : '#6b7280';
      g.font = `${won ? 800 : 600} 18px ${SANS}`;
      g.fillText(cap(team), PAD + 18, ly);
      g.textAlign = 'right'; g.font = `400 30px ${DISPLAY}`;
      g.fillText(r.hasScores ? String(score) : '', W - PAD - 70, ly + 1);
    };
    line(r.away, r.awayScore, r.result === 'away', y + ROW * 0.32);
    line(r.home, r.homeScore, r.result === 'home', y + ROW * 0.72);
    g.textAlign = 'right'; g.font = `800 10px ${SANS}`;
    const tag = r.type === 'playoff' ? (r.round ? cap(r.round) : 'PLAYOFF').toUpperCase() : 'FINAL';
    const tw = g.measureText(tag).width + 14;
    g.fillStyle = r.type === 'playoff' ? '#4a148c' : '#2d5016';
    roundRect(g, W - PAD - 14 - tw, y + ROW / 2 - 10, tw, 20, 4); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'center';
    g.fillText(tag, W - PAD - 14 - tw / 2, y + ROW / 2 + 1);
    y += ROW + GAP;
  }
  g.fillStyle = '#9aa39a'; g.font = `500 11px ${SANS}`; g.textAlign = 'center';
  g.fillText(SITE, W / 2, H - FOOT / 2);
  return c;
}

function tableBlob(elId, title) {
  const table = $(elId).querySelector('table');
  return canvasBlob(drawTableImage(table, { title, foot: SITE, maxRows: 40 }));
}

function makeBlob(what) {
  const label = seasonLabel(T.seasonId);
  if (what === 'standings') return tableBlob('ltStandings', `${label} Standings`);
  if (what === 'seeds') return tableBlob('ltSeeds', `${label} Playoff Seeding`);
  if (what === 'tonight') {
    const items = tonightItems();
    return gamesImageBlob({ heading: "Tonight's Games", sub: formatGameDate(todayKey(), 'long'), items, detail: items.length <= 3 });
  }
  if (what === 'results') return resultsCanvas().then(canvasBlob);
  return Promise.reject(new Error('Nothing to share'));
}

function makeText(what) {
  const label = seasonLabel(T.seasonId);
  if (what === 'standings') {
    return [`${label} Standings`, '', ...T.standings.filter(r => r.games).map(r =>
      `${r.rank}. ${cap(r.team)} ${rec(r)} (${fmtAvg(r.winPct)})${r.gamesBack ? `, ${r.gamesBack} GB` : ''}`), '', SITE].join('\n');
  }
  if (what === 'seeds') {
    const P = Math.min(T.playoffTeams || T.standings.length, T.standings.length);
    const byes = byesFor(P);
    return [`${label} Playoff Seeding`, '', ...seedRows().map(a => {
      const where = a.clinched ? `locked ${ordinal(a.best)}` : `seeds ${a.best}-${a.worst}`;
      const bye = byes && a.bye ? (a.bye.clinch === 0 ? ', bye clinched' : a.bye.shot === null ? '' : ', in the bye race') : '';
      return `${a.seed}. ${cap(a.t.team)} ${rec(a.t)}: ${where}${bye}`;
    }), '', SITE].join('\n');
  }
  if (what === 'tonight') return gamesText({ heading: "Tonight's Games", sub: formatGameDate(todayKey(), 'long'), items: tonightItems() });
  if (what === 'results') {
    return [`Final scores, ${formatGameDate(T.resultsDay, 'long')}`, '', ...T.results.map(g => {
      const a = `${cap(g.away)} ${g.hasScores ? g.awayScore : ''}`.trim();
      const h = `${cap(g.home)} ${g.hasScores ? g.homeScore : ''}`.trim();
      return g.result === 'home' ? `${h}, ${a}` : `${a}, ${h}`;
    }), '', SITE].join('\n');
  }
  return '';
}

const fileName = (what) => `aces-${what}-${stamp()}.png`;

async function share(act, what, btn) {
  if (act === 'text') {
    try { await navigator.clipboard.writeText(makeText(what)); showToast('Copied. Paste it in the group chat.', 'success'); }
    catch { showToast('Could not copy to the clipboard.', 'error'); }
    return;
  }
  btn.disabled = true;
  try {
    if (act === 'copy') {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        showToast("This browser can't copy images. Use Save instead.", 'info');
        return;
      }
      // The blob is passed as a promise so the copy stays inside the click.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': makeBlob(what) })]);
      showToast('Image copied. Paste it in the group chat.', 'success');
      return;
    }
    const blob = await makeBlob(what);
    const file = new File([blob], fileName(what), { type: 'image/png' });
    const phone = window.matchMedia('(pointer: coarse)').matches;
    if (phone && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Mountainside Aces' }); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast('Image saved.', 'success');
  } catch (err) {
    console.error('[league-staff] share', err);
    showToast(`Could not make the image: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------

export async function mount() {
  document.querySelector('[data-panel="today"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-share-act]');
    if (b) share(b.dataset.shareAct, b.dataset.what, b);
  });
  ['standings', 'tonight', 'results', 'seeds'].forEach(w => setShare(w, false));

  T.seasonId = await getDisplaySeasonId().catch(() => '') || '';
  if (!T.seasonId) {
    ['ltStandings', 'ltTonight', 'ltResults', 'ltSeeds'].forEach(id => { $(id).innerHTML = '<p class="aces-empty">No season yet.</p>'; });
    return;
  }
  $('ltIntro').textContent = `${seasonLabel(T.seasonId)}: standings, tonight's games, seeding and the latest results, each ready to share in the group chat.`;
  const [docs, fmt] = await Promise.all([
    getSeasonGames(T.seasonId).catch(() => []),
    getDoc(doc(db, 'seasons', T.seasonId, 'playoffs', 'bracket')).then(s => (s.exists() ? s.data().format : null)).catch(() => null)
  ]);
  T.games = normalizeGames(docs).map((g, i) => ({ ...g, raw: docs[i] }));
  T.standings = computeStandings(T.games, { includeScheduled: true }).filter(r => r.team && r.team !== 'TBD');
  T.left = T.games.filter(g => g.type === 'regular' && !isDecided(g) && g.home && g.away && g.home !== 'TBD' && g.away !== 'TBD');
  T.playoffTeams = Number(fmt?.teams) || T.standings.length;

  const today = todayKey();
  const bySlot = (a, b) => timeSortValue(a.time) - timeSortValue(b.time);
  T.tonight = T.games.filter(g => g.dateKey === today && !isDecided(g) && g.status !== 'postponed' && g.status !== 'cancelled').sort(bySlot);
  const days = [...new Set(T.games.filter(g => isDecided(g) && g.dateKey && g.dateKey <= today).map(g => g.dateKey))].sort();
  T.resultsDay = days[days.length - 1] || '';
  T.results = T.games.filter(g => g.dateKey === T.resultsDay && isDecided(g)).sort(bySlot);

  renderStandings();
  renderTonight();
  renderResults();
  renderSeeds();
  loadPicks().catch(err => console.warn('[league-staff] players to watch', err));
}
