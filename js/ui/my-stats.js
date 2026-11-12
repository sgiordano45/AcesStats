// js/ui/my-stats.js
// "My season" for a signed-in player: one season's batting (sub records
// merged, or shown on their own line with splitSubs), pitching if any, and a
// career line. Shared by the home page's My
// Aces card and the Me dashboard.
//
//   import { mySeason, myStatsHtml } from './js/ui/my-stats.js';
//   const s = mySeason(player, '2026-fall');      // { line, team, hitTypes, pitch, career }
//   el.innerHTML = myStatsHtml(player, { seasonId: '2026-fall', finished: false });
//
// player is an aggregatedPlayerStats doc ({ seasons, pitchingSeasons }), as
// findPlayerStatsForUser() returns. Styles: .aces-mystats in css/components.css.

import { battingLine, era } from '../domain/stats.js';
import { parseStatSeasonId, hasCompleteHitTypes, inningsValue, seasonLabel } from '../domain/season-ids.js';
import { escapeHtml as esc, fmtAvg, fmtRate, formatIP } from './format.js';

const BAT = ['atBats', 'hits', 'walks', 'runs', 'games', 'doubles', 'triples', 'homeRuns', 'rbi'];
const blank = () => Object.fromEntries(BAT.map(k => [k, 0]));
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase() : '');

/**
 * One season's totals for a player, plus career batting. line is everything
 * (own team + sub games); own and sub split it for callers that show sub
 * appearances apart, with subTeams the teams subbed for.
 */
export function mySeason(player, seasonId) {
  let line = null;
  let own = null;
  let sub = null;
  let team = '';
  let hitTypes = true;
  let ownHitTypes = true;
  let subHitTypes = true;
  const subTeams = [];
  const career = blank();
  for (const [rawId, rec] of Object.entries(player?.seasons || {})) {
    for (const k of BAT) career[k] += Number(rec[k]) || 0;
    const sid = parseStatSeasonId(rawId);
    if (sid.id !== seasonId) continue;
    const isSub = sid.isSub || /^yes$/i.test(String(rec.sub || ''));
    const complete = 'doubles' in rec && hasCompleteHitTypes(sid.id, rec.team);
    line ??= blank();
    for (const k of BAT) line[k] += Number(rec[k]) || 0;
    if (isSub) {
      sub ??= blank();
      for (const k of BAT) sub[k] += Number(rec[k]) || 0;
      if (rec.team && !subTeams.includes(cap(rec.team))) subTeams.push(cap(rec.team));
      if (!complete) subHitTypes = false;
    } else {
      own ??= blank();
      for (const k of BAT) own[k] += Number(rec[k]) || 0;
      if (!complete) ownHitTypes = false;
    }
    if (!isSub || !team) team = rec.team || team;
    if (!complete) hitTypes = false;
  }
  let pitch = null;
  for (const [rawId, rec] of Object.entries(player?.pitchingSeasons || {})) {
    if (parseStatSeasonId(rawId).id !== seasonId) continue;
    pitch ??= { ip: 0, runsAllowed: 0, games: 0 };
    pitch.ip += inningsValue(rec.inningsPitched);
    pitch.runsAllowed += Number(rec.runsAllowed) || 0;
    pitch.games += Number(rec.games) || 0;
  }
  return {
    line, team: cap(team), hitTypes: !!line && hitTypes, pitch, career,
    own, ownHitTypes: !!own && ownHitTypes, sub, subHitTypes: !!sub && subHitTypes, subTeams
  };
}

/** "As a sub for Army: 2 G · 6 PA · 3 H · 1 R · .500 BA · .667 OBP", or '' with no sub games. */
function subLineHtml({ sub, subHitTypes, subTeams }) {
  if (!sub || sub.atBats + sub.walks <= 0) return '';
  const b = battingLine(sub);
  const parts = [`${sub.games} G`, `${b.pa} PA`, `${sub.hits} H`, `${sub.runs} R`];
  if (sub.walks) parts.push(`${sub.walks} BB`);
  if (subHitTypes) {
    if (sub.doubles) parts.push(`${sub.doubles} 2B`);
    if (sub.triples) parts.push(`${sub.triples} 3B`);
    if (sub.homeRuns) parts.push(`${sub.homeRuns} HR`);
    parts.push(`${sub.rbi} RBI`);
  }
  parts.push(`${fmtAvg(b.avg)} BA`, `${fmtAvg(b.obp)} OBP`);
  const who = subTeams.length ? ` for ${subTeams.join(', ')}` : '';
  return `<p class="aces-mystats-sub"><strong>As a sub${esc(who)}:</strong> ${esc(parts.join(' \u00b7 '))}</p>`;
}

const tile = (value, label) =>
  `<div class="aces-stat"><span class="aces-stat-value">${esc(String(value))}</span><span class="aces-stat-label">${esc(label)}</span></div>`;

/**
 * The block: a title ("2026 Fall so far"), batting tiles, pitching tiles when
 * the player pitched, and the career line.
 * With splitSubs, the tiles are own-team games only and sub appearances get
 * their own line underneath ("As a sub for Army: ...").
 * @param {object} player
 * @param {{ seasonId: string, finished?: boolean, title?: string, splitSubs?: boolean }} o
 */
export function myStatsHtml(player, { seasonId, finished = false, title, splitSubs = false } = {}) {
  const s = mySeason(player, seasonId);
  const { pitch, career } = s;
  const line = splitSubs ? s.own : s.line;
  const hitTypes = splitSubs ? s.ownHitTypes : s.hitTypes;
  const subNote = splitSubs ? subLineHtml(s) : '';
  let body = '';
  if (line && line.atBats + line.walks > 0) {
    const b = battingLine(line);
    body += `<div class="aces-stats">
      ${tile(line.games, 'G')}${tile(b.pa, 'PA')}${tile(line.hits, 'H')}${tile(line.runs, 'R')}${tile(line.walks, 'BB')}
      ${hitTypes ? tile(line.doubles, '2B') + tile(line.triples, '3B') + tile(line.homeRuns, 'HR') + tile(line.rbi, 'RBI') : ''}
      ${tile(fmtAvg(b.avg), 'BA')}${tile(fmtAvg(b.obp), 'OBP')}${hitTypes ? tile(fmtAvg(b.slg), 'SLG') : ''}
    </div>`;
  }
  if (pitch && pitch.ip > 0) {
    body += `<div class="aces-stats">
      ${tile(pitch.games, 'G pitched')}${tile(formatIP(pitch.ip), 'IP')}${tile(pitch.runsAllowed, 'R')}${tile(fmtRate(era(pitch.runsAllowed, pitch.ip)), 'ERA')}
    </div>`;
  }
  if (!body && !subNote) body = '<p class="aces-mystats-note">No stats yet this season.</p>';
  body += subNote;
  const cb = battingLine(career);
  const careerNote = career.atBats + career.walks > 0
    ? `<p class="aces-mystats-note">Career: ${career.games} G · ${career.hits} H · ${career.runs} R · ${esc(fmtAvg(cb.avg))} BA · ${esc(fmtAvg(cb.obp))} OBP</p>`
    : '';
  const heading = title ?? `${seasonLabel(seasonId)}${finished ? '' : ' so far'}`;
  return `<div class="aces-mystats"><h3 class="aces-mystats-title">${esc(heading)}</h3>${body}${careerNote}</div>`;
}
