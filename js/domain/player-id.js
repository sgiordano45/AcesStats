// js/domain/player-id.js
// One rule, site wide, for the ID a player's game stats are stored under:
//   playerStats/{statId}/games, pitchingStats/{statId}/games,
//   aggregatedPlayerStats2025Splits/{statId}, sprayChartData legacy docs.
//
// The stats ID is the player's snake_case "legacy" ID. Linked accounts keep
// theirs: aggregatedPlayerStats/{authUid} and users/{authUid} carry the name
// it came from (linkedPlayer) or the merged profile's ID (mergedFromProfile),
// and season rosters store it as players[].id. The account's display name can
// differ ("Zack Gubitosi" plays under zach_gubitosi), so never rebuild the ID
// from the display name when one of those is there.
//
//   toStatId("Tim O'Grady")            -> 'tim_ogrady'
//   toStatId("tim_o'grady")            -> 'tim_ogrady'   (IDs are cleaned the same way)
//   statIdOf({ id: '77ctt...', linkedPlayer: 'Zach Gubitosi', name: 'Zack Gubitosi' }) -> 'zach_gubitosi'
//   statIdOf({ id: 'zach_gubitosi', name: 'Zack Gubitosi' })                           -> 'zach_gubitosi'
//
// Same result the stats aggregation has always produced from linkedPlayer
// (lowercase, periods and apostrophes dropped, spaces to underscores).

/** Firebase Auth UIDs: 28 letters and digits, no underscores. */
export const isAuthUid = (id) => /^[A-Za-z0-9]{28}$/.test(String(id || ''));

/** A name or an ID in stats-ID form: 'Zach Gubitosi' / "tim_o'grady" -> 'zach_gubitosi' / 'tim_ogrady'. */
export function toStatId(value) {
  return String(value || '').trim().toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, '_');
}

/**
 * The stats ID for any player-shaped record: a roster entry ({ id, name }),
 * a users doc, an aggregatedPlayerStats doc, a stat row, or a plain string
 * (an ID or a name). Order: an explicit legacy ID, a merged profile, a
 * non-UID doc ID, the linked player name, then the name.
 */
export function statIdOf(rec) {
  if (!rec) return '';
  if (typeof rec === 'string') return isAuthUid(rec) ? '' : toStatId(rec);
  const direct = rec.legacyId || rec.mergedFromProfile;
  if (direct) return toStatId(direct);
  if (rec.id && !isAuthUid(rec.id)) return toStatId(rec.id);
  if (rec.linkedPlayer) return toStatId(rec.linkedPlayer);
  return toStatId(rec.name || rec.playerName || rec.displayName || rec.preferredDisplayName);
}

/**
 * Every ID a player's data may sit under, most likely first: the stats ID,
 * the Auth UID (tracker plays and spray charts for linked players), and the
 * ID rebuilt from the display name when it differs (older docs).
 */
export function idsOf(rec) {
  if (!rec) return [];
  const out = [statIdOf(rec)];
  const uid = typeof rec === 'string' ? (isAuthUid(rec) ? rec : '') : [rec.authId, rec.userId, rec.uid, rec.id].find(isAuthUid);
  if (uid) out.push(uid);
  if (typeof rec === 'object') out.push(toStatId(rec.name || rec.displayName));
  return [...new Set(out.filter(Boolean))];
}
