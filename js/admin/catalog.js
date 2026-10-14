// js/admin/catalog.js
// Every admin and staff tool, grouped by job, for the /admin/ sidebar and home.
// Hrefs are from the site root. Admin-only tools live in /admin/ (their old
// root files forward); captain tools stay at the root.
//
// role: who sees the link (hasRole; admins pass every check).

export const ADMIN_GROUPS = [
  { id: 'season', label: 'Season setup', icon: 'calendar-days', items: [
    ['admin/season-setup.html', 'Season setup wizard', 'Create a season: teams, schedule, publish', 'league-staff'],
    ['admin/league-staff.html', 'League staff', 'Today to share, game edits, banners, push, email, signup import', 'league-staff'],
    ['admin/offseason.html', 'Offseason hub', 'Rosters, schedule and the draft', 'league-staff'],
    ['offseason-roster.html', 'Offseason rosters', 'Team assignments for next season', 'league-staff'],
    ['draft.html', 'Snake draft', 'Run the live draft', 'league-staff'],
    ['admin/playoff-eligibility.html', 'Playoff eligibility', 'Who has played enough games', 'league-staff'],
    ['playoffs.html', 'Playoff bracket', 'Set, lock and publish the bracket', 'league-staff']
  ] },
  { id: 'schedule', label: 'Schedule', icon: 'calendar', items: [
    ['admin/schedule.html', 'Schedule', 'Overview, edit a game, rework, generate a new season', 'league-staff'],
    ['admin/schedule.html?tab=generate', 'Schedule generator', 'Build a balanced schedule for a new season', 'league-staff'],
    ['admin/schedule.html?tab=workshop', 'Schedule workshop', 'Tune and check it, then send it to Season setup', 'league-staff'],
    ['admin/schedule.html?tab=edit', 'Edit a game', 'Change one game and share the update', 'league-staff'],
    ['admin/schedule.html?tab=rework', 'Rework after rainouts', 'Move games to new days, publish together', 'league-staff']
  ] },
  { id: 'stats', label: 'Stats pipeline', icon: 'calculator', items: [
    ['admin/stats.html', 'Stats pipeline', 'Step by step: stats in, review, aggregate, badges', 'admin'],
    ['admin/submit-stats.html', 'Enter stats', 'Stats for any team and game', 'admin'],
    ['admin/game-tracker-review.html', 'Review tracked games', 'Check live-tracked games before they count', 'team-staff'],
    ['admin/aggregate-stats.html', 'Aggregate stats', 'Rebuild player totals (test, then production)', 'admin'],
    ['admin/badges.html', 'Badge calculator', 'Award player badges after aggregation', 'admin'],
    ['admin/special-badges.html', 'Special badges', 'One-off badges for a moment in a game', 'admin'],
    ['admin/records.html', 'Records', 'Fix game stats, merge duplicate records, find the right fix', 'league-staff'],
    ['admin/reconcile.html', 'Reconcile', 'Compare game stats with totals', 'admin'],
    ['admin/recover-game.html', 'Recover a game', 'Restore a deleted or broken game', 'admin'],
    ['admin/spray-intake.html', 'Spray chart intake', 'Hit locations for spray charts', 'admin'],
    ['admin/oop-homers.html', 'Out-of-park home runs', 'Flag homers that left the park', 'league-staff'],
    ['admin/bwar-explorer.html', 'bWAR explorer', 'Tune bWAR weights', 'league-staff'],
    ['admin/aggregate-stats-legacy.html', 'Legacy aggregator', 'Older seasons', 'admin'],
    ['admin/submit-stats-legacy.html', 'Standard stats form', 'Submit without hit types', 'admin'],
    ['admin/gc-data-cleaner.html', 'GameChanger cleaner', 'Tidy imported GameChanger data', 'admin']
  ] },
  { id: 'rosters', label: 'Rosters', icon: 'users', items: [
    ['admin/rosters.html', 'Rosters', 'Edit season rosters, import a CSV, copy from the offseason board, fix links', 'league-staff'],
    ['admin/captain-roster-edit.html', 'Edit any roster', 'Roster info for any team', 'admin'],
    ['admin/player-import.html', 'Player import', 'Add players in bulk', 'admin'],
    ['admin/team-audit.html', 'Team audit', 'Check every player\u2019s currentTeam against this season\u2019s rosters', 'league-staff'],
    ['admin/signup-card-export.html', 'Signup cards', 'Export signup cards', 'league-staff'],
    ['admin/card-export.html', 'Card export', 'Export player trading cards', 'league-staff']
  ] },
  { id: 'users', label: 'Users and roles', icon: 'shield', items: [
    ['admin/people.html', 'People', 'Members, roles, View As, setup and push status', 'league-staff'],
    ['admin/people.html?tab=links', 'Player links', 'Approve link requests, link accounts by hand', 'league-staff'],
    ['admin/people.html?tab=add', 'Add players', 'Player records for people with no account yet', 'league-staff'],
    ['admin/user-management.html', 'Player records', 'Merge duplicates, repair orphaned stats, import emails', 'admin']
  ] },
  { id: 'content', label: 'Content', icon: 'megaphone', items: [
    ['admin/content.html', 'Content', 'League documents, feedback and the Aceys', 'league-staff'],
    ['admin/countdown.html', 'Opening Day countdown', 'Countdown graphic for the group chat', 'league-staff'],
    ['admin/content.html?tab=aceys', 'Aceys', 'Award winners, reveals, publish to profiles', 'league-staff'],
    ['captain-questionnaire-review.html', 'Captain questionnaires', 'Read captain responses', 'league-staff'],
    ['admin/content.html?tab=feedback', 'Feedback', 'Feature requests and bug reports', 'admin']
  ] },
  { id: 'tools', label: 'Games and tools', icon: 'gamepad', items: [
    ['admin/games.html', 'Daily games admin', 'Grid, Connections and the rest', 'admin'],
    ['admin/wordle.html', 'Wordle admin', 'Puzzles and the word list', 'admin'],
    ['admin/dfs.html', 'DFS generator', 'Weekly salaries and scoring', 'admin'],
    ['contributor.html', 'Contributor dashboard', 'Recaps, previews and photos', 'league-staff']
  ] }
];
