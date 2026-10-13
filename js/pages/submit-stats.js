// js/pages/submit-stats.js
// submit-stats.html: captains and team staff enter or fix their team's stats
// for a game (one game by hand or from a scoresheet PDF, or many games from a
// CSV). League staff and admins can pick any team. The page logic is shared
// with admin Enter stats: js/pages/stats-entry.js.

import { initPage, pageReady } from '../core/app.js';
import { hasRole } from '../core/auth.js';
import { escapeHtml as esc } from '../ui/format.js';
import { startStatsEntry } from './stats-entry.js';
import { submitScope, scopeLabel } from './submit-access.js';

const $ = (id) => document.getElementById(id);

async function main() {
  const ctx = await initPage({ title: 'Submit stats', role: 'team-staff', deniedMessage: 'Submitting stats is for captains, team staff and league staff.' });
  if (!ctx?.user) return;
  const scope = submitScope(ctx.profile);
  if (scope && !scope.length) {
    pageReady();
    $('sseScope').innerHTML = '<span class="aces-badge is-alert">Not linked to a team</span> Ask league staff to link your account to your team.';
    $('sseModeOne').hidden = true;
    document.querySelector('.sse-modes').hidden = true;
    return;
  }
  $('sseScope').textContent = scope ? `Showing games for ${scopeLabel(scope)}.` : 'League staff: every team.';
  await startStatsEntry(ctx, {
    scope,
    pipelineHref: hasRole(ctx.profile, 'admin') ? 'admin/stats.html' : ''
  });
}

main().catch(err => {
  console.error('[submit-stats] start failed', err);
  pageReady();
  $('sseGames').innerHTML = `<p class="sse-empty">Could not load: ${esc(err.message || err)}</p>`;
});
