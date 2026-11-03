// js/data/gamechanger.js
// GameChanger Scoreboard Widgets: the official embed from each team's
// web.gc.com Tools tab (no scraping, no API).
//
//   Firestore  siteConfig/gamechanger
//     { teams: { <teamKey>: { team, widgetId, link?, updatedAt, updatedByName } } }
//     teamKey is the lowercase team name ('teal'). link is the team's GC page
//     (the "social link" under Tools), optional.
//   Set in admin/content.html?tab=gamechanger (content-gamechanger.js).
//
// The home page shows a team's widget while one of its games is on: from
// GC_LEAD_MIN before first pitch to GC_TAIL_MIN after, ET. When both teams
// use GameChanger, the home team's widget is shown.

import { db, doc, getDoc } from '../core/firebase.js';
import { todayKey, parseTimeMinutes, LEAGUE_TIME_ZONE } from '../domain/dates.js';

export const GC_SDK_URL = 'https://widgets.gc.com/static/js/sdk.v1.js';
export const GC_LEAD_MIN = 15;
export const GC_TAIL_MIN = 120;
export const GC_MAX_GAMES = 4; // maxVerticalGamesVisible, as in GC's own snippet

export const gcConfigRef = () => doc(db, 'siteConfig', 'gamechanger');
export const gcTeamKey = (team) => String(team || '').trim().toLowerCase();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** GC's whole embed snippet, or just the widget id -> the widget id, or ''. */
export function parseGcWidgetId(text) {
  const s = String(text || '');
  const named = /widgetId\s*:\s*["']([^"']+)["']/i.exec(s);
  const match = UUID.exec(named ? named[1] : s);
  return match ? match[0].toLowerCase() : '';
}

/** A GameChanger page link (https, on gc.com), or '' if it isn't one. */
export function cleanGcLink(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  try {
    const url = new URL(s);
    return url.protocol === 'https:' && /(^|\.)gc\.com$/i.test(url.hostname) ? url.href : '';
  } catch {
    return '';
  }
}

/** { teamKey: { team, widgetId, link } } for teams with a widget. */
export async function getGcWidgets() {
  const snap = await getDoc(gcConfigRef());
  const teams = snap.exists() ? (snap.data().teams || {}) : {};
  const out = {};
  for (const [key, v] of Object.entries(teams)) {
    const widgetId = parseGcWidgetId(v?.widgetId);
    if (widgetId) out[key] = { team: v.team || key, widgetId, link: cleanGcLink(v.link) };
  }
  return out;
}

let sdkPromise = null;

/** Load GC's widget script once. Resolves with window.GC. */
export function loadGcSdk() {
  if (window.GC?.team?.schedule) return Promise.resolve(window.GC);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GC_SDK_URL;
      s.async = true;
      s.onload = () => (window.GC?.team?.schedule
        ? resolve(window.GC)
        : reject(new Error('The GameChanger widget script loaded but GC.team.schedule is missing')));
      s.onerror = () => { sdkPromise = null; s.remove(); reject(new Error('Could not load the GameChanger widget script')); };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

let seq = 0;

/** Put a team's scoreboard widget into an element (given an id if it has none). */
export async function mountGcWidget(el, widgetId, { maxGames = GC_MAX_GAMES } = {}) {
  const GC = await loadGcSdk();
  if (!el.id) el.id = `gc-widget-${++seq}`;
  GC.team.schedule.init({ target: `#${el.id}`, widgetId, maxVerticalGamesVisible: maxGames });
}

/** Minutes after midnight, ET. */
export function etMinutesNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEAGUE_TIME_ZONE, hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type) => Number(parts.find(p => p.type === type)?.value || 0);
  return (get('hour') % 24) * 60 + get('minute');
}

/**
 * Today's games that are on now and have a GC team: [{ key, widget, game }],
 * one per widget, earliest first. A game with no time counts all day.
 * games: summary game cards ({ id, dateKey, time, home, away, ... }).
 */
export function gcGamesNow(games, widgets, { now = new Date() } = {}) {
  const today = todayKey(now);
  const nowMin = etMinutesNow(now);
  const seen = new Set();
  const byKey = new Map();
  for (const g of games || []) {
    if (!g || seen.has(g.id) || g.dateKey !== today) continue;
    seen.add(g.id);
    const homeKey = gcTeamKey(g.home);
    const awayKey = gcTeamKey(g.away);
    const key = widgets[homeKey] ? homeKey : widgets[awayKey] ? awayKey : null;
    if (!key) continue;
    const start = parseTimeMinutes(g.time);
    if (start !== null && (nowMin < start - GC_LEAD_MIN || nowMin > start + GC_TAIL_MIN)) continue;
    // A doubleheader with both windows open: the later game.
    const prev = byKey.get(key);
    if (!prev || (start ?? -1) >= (parseTimeMinutes(prev.game.time) ?? -1)) byKey.set(key, { key, widget: widgets[key], game: g });
  }
  return [...byKey.values()].sort((a, b) => (parseTimeMinutes(a.game.time) ?? -1) - (parseTimeMinutes(b.game.time) ?? -1));
}
