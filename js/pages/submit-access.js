// js/pages/submit-access.js
// Which teams a member can submit scores and stats for (submit-score.html,
// submit-stats.html). League staff and admins: every team (null). Captains
// and team staff: their own teams, as lowercase team ids.

import { hasRole, getUserTeamIds } from '../core/auth.js';

/** null = every team; [] = signed in as staff but not linked to a team. */
export function submitScope(profile) {
  if (hasRole(profile, 'league-staff')) return null;
  return getUserTeamIds(profile);
}

/** Capitalised team names for "Showing games for ..." lines. */
export const scopeLabel = (scope) => scope.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' and ');
