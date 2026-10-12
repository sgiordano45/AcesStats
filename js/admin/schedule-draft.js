// js/admin/schedule-draft.js
// The schedule being built on the Generate and Workshop tabs of
// admin/schedule.html. It lives on this device (localStorage) so a refresh
// keeps the Workshop's edits; nothing here is written to the site.
//
//   aces.scheduleWorkshop   { seasonType, year, games: [{ week, iso 'YYYY-MM-DD',
//                             time, home, away }], newTeams: [name], savedAt }
//   aces.scheduleHandoff    what Season setup reads (?schedule=workshop):
//                           { seasonType, year, games: [{ date 'YYYY-MM-DDT12:00:00',
//                             time, home, away }], sentAt }

const KEY = 'aces.scheduleWorkshop';
const HANDOFF = 'aces.scheduleHandoff';
let memory = null;   // used when storage is blocked (private windows)

export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') || memory; }
  catch { return memory; }
}

export function saveDraft(draft) {
  memory = { ...draft, savedAt: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(memory)); return true; }
  catch { return false; }
}

export function clearDraft() {
  memory = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
}

/** Store the schedule for Season setup. False when storage is blocked. */
export function saveHandoff(draft) {
  const data = {
    seasonType: draft.seasonType,
    year: draft.year,
    games: draft.games.map(g => ({ date: `${g.iso}T12:00:00`, time: g.time, home: g.home, away: g.away })),
    sentAt: new Date().toISOString()
  };
  try { localStorage.setItem(HANDOFF, JSON.stringify(data)); return true; }
  catch { return false; }
}

/** A Date as YYYY-MM-DD in local time. */
export function toIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'Sun 4/26/2026' from YYYY-MM-DD. */
export function dayDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Hour of '7:45 PM' (24h); 24 when it can't be read. */
export function timeHour(time) {
  const m = String(time || '').match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
  if (!m) return 24;
  let h = parseInt(m[1], 10);
  if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  return h + (parseInt(m[2] || '0', 10) / 60);
}

/** CSV in the columns Season setup and the old tools read. */
export function scheduleCsv(games) {
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = games.map(g => {
    const d = new Date(`${g.iso}T12:00:00`);
    return [g.week, `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`, g.time, g.home, g.away, 'Regular'];
  });
  return [['Week', 'Date', 'Time', 'Home Team', 'Away Team', 'Game Type'], ...rows].map(r => r.map(q).join(',')).join('\n');
}

export function download(name, text, type = 'text/csv') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
