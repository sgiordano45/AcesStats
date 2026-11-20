// js/domain/playoff-slots.js
// Display names for playoff slots on the schedule and the weekend preview.
// Locked double-elimination game docs (playoff_g{n}) name an undecided side
// "G2 Winner" or "G4 Loser". Pick'em, its Cloud Function and the bracket page
// read that exact text, so it stays in Firestore; this only changes what is
// shown. A slot whose feeder game is decided shows that team; one whose feeder
// has both teams set shows "Gold/Teal Winner" (away/home, as Pick'em does);
// anything else keeps "G2 Winner".

const SLOT_RE = /^g(\d+)\s+(winner|loser)$/i;
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase() : '');

/** True for a slot name such as "G2 Winner" or "G13 Loser". */
export const isSlotName = (name) => SLOT_RE.test(String(name || '').trim());

/**
 * @param {Array<{id: string, home: string, away: string, result?: string}>} games
 *   normalizeGames() output for one season
 * @returns {Map<string, {home?: {text: string, team: string|null}, away?: {text: string, team: string|null}}>}
 *   by game id, only for sides that are slots with something better to show.
 *   team is the real team once the feeder game is decided, else null.
 */
export function playoffSlotLabels(games) {
  const byNum = new Map();
  for (const g of games || []) {
    const m = String(g.id || '').match(/^playoff_g(\d+)$/);
    if (m) byNum.set(Number(m[1]), g);
  }
  const out = new Map();

  // The real team on one side of a game: its own name, or a slot already settled.
  const teamOf = (g, side) => {
    const label = out.get(g.id)?.[side];
    if (label) return label.team;
    const n = String(g[side] || '').trim();
    return n && n.toUpperCase() !== 'TBD' && !isSlotName(n) ? n : null;
  };

  // Feeder games always have lower numbers, so one pass in order settles chains.
  for (const n of [...byNum.keys()].sort((a, b) => a - b)) {
    const g = byNum.get(n);
    for (const side of ['home', 'away']) {
      const m = String(g[side] || '').trim().match(SLOT_RE);
      const src = m ? byNum.get(Number(m[1])) : null;
      if (!src) continue;
      const winner = m[2].toLowerCase() === 'winner';
      let label = null;
      if (src.result === 'home' || src.result === 'away') {
        const pick = winner ? src.result : (src.result === 'home' ? 'away' : 'home');
        const team = teamOf(src, pick);
        if (team) label = { text: cap(team), team };
      } else {
        const a = teamOf(src, 'away');
        const h = teamOf(src, 'home');
        if (a && h) label = { text: `${cap(a)}/${cap(h)} ${winner ? 'Winner' : 'Loser'}`, team: null };
      }
      if (label) out.set(g.id, { ...out.get(g.id), [side]: label });
    }
  }
  return out;
}
