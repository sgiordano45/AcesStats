// nav-config.js - Centralized Navigation Configuration
// Edit this file to reorganize pages across tiers

export const NAV_STRUCTURE = {
  // Tier 1: PRIMARY - Core pages (always visible on desktop)
  primary: [
    { id: 'home', href: 'index.html', label: 'Home', icon: '🏠', priority: 1 },
    { id: 'current-season', href: 'current-season.html', label: 'Current Season', icon: '🍂', priority: 1 },
    { id: 'league-rules', href: 'league-rules.html', label: 'League Rules', icon: '⚖️', priority: 1 },
    { id: 'batting', href: 'batting.html', label: 'Batting Stats', icon: '⚾', priority: 1, class: 'batting' },
    { id: 'pitching', href: 'pitching.html', label: 'Pitching Stats', icon: '🥎', priority: 1, class: 'pitching' },
    { id: 'teams', href: 'teams.html', label: 'All Teams', icon: '🏆', priority: 1 },
    { id: 'players', href: 'players.html', label: 'All Players', icon: '👥', priority: 1 },
  ],
  
  // Tier 2: SECONDARY - Important pages (shown contextually on desktop)
  secondary: [
    { id: 'weekend-preview', href: 'weekend-preview.html', label: 'Weekend Preview', icon: '🔮', priority: 2 },
    { id: 'projections', href: 'projections.html', label: 'Playoff Projections', icon: '🎱', priority: 2 },
    { id: 'seasons', href: 'seasons.html', label: 'All Seasons', icon: '📅', priority: 2 },
    { id: 'leaders', href: 'leaders.html', label: 'Career Leaders', icon: '👑', priority: 2 },
    { id: 'awards', href: 'awards.html', label: 'Awards', icon: '🏅', priority: 2 },
	{ id: 'playoffs', href: 'playoffs.html', label: 'Playoff Bracket', icon: '🥇', priority: 2 },
  ],
  
  // Tier 3: TERTIARY - Specialty pages (mobile-only unless contextually relevant)
  tertiary: [
    { id: 'milestones', href: 'milestones.html', label: 'Milestones', icon: '🎯', priority: 3 },
    { id: 'compare', href: 'compare.html', label: 'Player Comparison', icon: '🔀', priority: 3 },
    { id: 'team-compare', href: 'team_compare.html', label: 'Team Comparison', icon: '🆚', priority: 3 },
    { id: 'h2h', href: 'h2h_grid.html', label: 'Head-to-Head Grid', icon: '⚔️', priority: 3 },
	{ id: 'history', href: 'league-history.html', label: 'League History', icon: '📜', priority: 3 },
    { id: 'charts', href: 'charts.html', label: 'Performance Charts', icon: '📊', priority: 3 },
    { id: 'pictures', href: 'pictures.html', label: 'Gallery', icon: '📷', priority: 3 },
    // game-preview removed - requires specific game ID parameter
  ],
  
  // Tier 4: AUTH - User-specific pages (only visible when authenticated)
  auth: [
    { id: 'profile', href: 'profile.html', label: 'My Profile', icon: '👤', priority: 4, requiresAuth: true },
    { id: 'favorites', href: 'favorites.html', label: 'Favorites', icon: '⭐', priority: 4, requiresAuth: true },
    { id: 'game-tracker', href: 'game-tracker.html', label: 'Game Tracker', icon: '🔶', priority: 4, requiresAuth: true },
    { id: 'roster-management', href: 'roster-management.html', label: 'Roster Management', icon: '✉️', priority: 4, requiresAuth: true },
	{ id: 'offseason-hub', href: 'offseason.html', label: 'Offseason Hub', icon: '🎣️', priority: 4, requiresAuth: true },
	{ id: 'photo-upload', href: 'photo-upload.html', label: 'Upload Photos', icon: '📤️', priority: 4, requiresAuth: true },
	{ id: 'submit-score', href: 'submit-score.html', label: 'Submit Scores', icon: '🔢️', priority: 4, requiresAuth: true },
	{ id: 'submit-stats', href: 'submit-stats.html', label: 'Submit Stats', icon: '🧮', priority: 4, requiresAuth: true },
  ],
  
  // Public auth pages (signin handles both signin and signup - don't show in nav)
  authPublic: [
    { id: 'signin', href: 'signin.html', label: 'Sign In', icon: '🔐', priority: 5, hideFromNav: true },
  ]
};

// Flatten all pages into a single lookup object
export const ALL_PAGES = {};
['primary', 'secondary', 'tertiary', 'auth', 'authPublic'].forEach(tier => {
  NAV_STRUCTURE[tier].forEach(page => {
    ALL_PAGES[page.id] = page;
  });
});

// Page-specific configurations: which links to show on desktop
export const PAGE_CONFIGS = {
  'index.html': {
    desktop: [] // No desktop nav on home page
  },
  
  'current-season.html': {
    desktop: ['home', 'current-season', 'league-rules', 'weekend-preview', 'playoffs', 'projections', 'batting', 'pitching', 'teams', 'players']
  },
  
  'league-rules.html': {
    desktop: ['home', 'current-season', 'league-rules', 'batting', 'pitching', 'teams', 'players']
  },
  
  'weekend-preview.html': {
    desktop: ['home', 'current-season', 'league-rules', 'playoffs', 'projections', 'batting', 'pitching']
  },
  
  'projections.html': {
    desktop: ['home', 'current-season', 'weekend-preview', 'playoffs', 'projections', 'batting', 'pitching', 'teams']
  },
  
  'batting.html': {
    desktop: ['home', 'current-season', 'batting', 'pitching', 'players', 'leaders', 'compare', 'charts']
  },
  
  'pitching.html': {
    desktop: ['home', 'current-season', 'batting', 'pitching', 'players', 'leaders', 'compare', 'charts']
  },
  
  'teams.html': {
    desktop: ['home', 'current-season', 'batting', 'pitching', 'teams', 'players', 'team-compare', 'h2h']
  },
  
  'team.html': {
    desktop: ['home', 'current-season', 'batting', 'pitching', 'teams', 'players', 'team-compare', 'h2h']
  },
  
  'players.html': {
    desktop: ['home', 'current-season', 'batting', 'pitching', 'teams', 'players', 'leaders', 'compare']
  },
  
  'player.html': {
    desktop: ['home', 'batting', 'pitching', 'players', 'leaders', 'milestones', 'compare']
  },
  
  'seasons.html': {
    desktop: ['home', 'current-season', 'seasons', 'batting', 'pitching', 'teams', 'players', 'awards']
  },
  
  'season.html': {
    desktop: ['home', 'current-season', 'seasons', 'batting', 'pitching', 'teams', 'players']
  },
  
  'leaders.html': {
    desktop: ['home', 'current-season', 'batting', 'pitching', 'players', 'leaders', 'milestones', 'awards']
  },
  
  'awards.html': {
    desktop: ['home', 'current-season', 'seasons', 'leaders', 'awards', 'players']
  },
  
  'milestones.html': {
    desktop: ['home', 'batting', 'pitching', 'players', 'leaders', ]
  },
  
  'compare.html': {
    desktop: ['home', 'batting', 'pitching', 'players', 'leaders', ]
  },
  
  'team_compare.html': {
    desktop: ['home', 'teams', 'h2h', 'seasons']
  },
  
  'h2h_grid.html': {
    desktop: ['home', 'current-season', 'teams', 'team-compare', 'history']
  },
    'league-history.html': {
    desktop: ['home', 'current-season', 'teams', 'team-compare', 'h2h']
  },
  'charts.html': {
    desktop: ['home', 'current-season', 'batting', 'pitching', 'teams', 'players', 'seasons', 'leaders', 'compare', 'team-compare', 'charts']
  },
  
  'pictures.html': {
    desktop: ['home', 'current-season', 'teams', 'players', 'pictures']
  },
  
  // Game preview page - no nav needed (accessed via weekend-preview game cards)
  'game-preview.html': {
    desktop: ['home', 'current-season', 'weekend-preview']
  },
  
  // Auth-specific pages
  'profile.html': {
    desktop: []
  },
  
  'favorites.html': {
    desktop: []
  },
  
  'game-tracker.html': {
    desktop: ['home', 'roster-management']
  },
  
  'roster-management.html': {
    desktop: []
  },
  
    'offseason.html': {
    desktop: []
  },
  
  // Signin page (handles both signin and signup) - minimal nav
  'signin.html': {
    desktop: ['home']
  }
};

// Default config for any page not specifically configured
export const DEFAULT_CONFIG = {
  desktop: ['home', 'current-season', 'batting', 'pitching', 'teams', 'players']
};