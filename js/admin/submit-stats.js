// js/admin/submit-stats.js
// admin/submit-stats.html (Enter stats): every team's stats for any game.
// The page logic is shared with the captains' Submit stats page
// (js/pages/stats-entry.js); admins get every team and the stats pipeline link.

import { initPage, pageReady } from '../core/app.js';
import { escapeHtml as esc } from '../ui/format.js';
import { mountAdminShell } from './shell.js';
import { startStatsEntry } from '../pages/stats-entry.js';

async function main() {
  const ctx = await initPage({ title: 'Enter stats', role: 'admin', deniedMessage: 'Entering stats is for admins.' });
  if (!ctx?.user) return;
  mountAdminShell(ctx.profile, 'admin/submit-stats.html');
  await startStatsEntry(ctx, { scope: null, pipelineHref: 'stats.html' });
}

main().catch(err => {
  console.error('[enter-stats] start failed', err);
  pageReady();
  document.getElementById('sseGames').innerHTML = `<p class="sse-empty">Could not load: ${esc(err.message || err)}</p>`;
});
