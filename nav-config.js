// nav-config.js - Centralized Navigation Configuration
// Edit this file to reorganize pages across tiers

import { db, collection, getDocs } from './firebase-config.js';

// Store visibility configuration from Firebase
let visibilityConfig = {};
let configLoaded = false;

// Function to fetch page visibility from Firebase
export async function loadPageVisibility() {
  if (configLoaded) {
    console.log('✅ Page visibility already loaded');
    return visibilityConfig;
  }

  try {
    if (typeof db === 'undefined') {
      console.warn('⚠️ Firebase not loaded, using default visibility');
      configLoaded = true;
      return visibilityConfig;
    }

    const pagesRef = collection(db, 'siteConfig', 'navigation', 'pages');
    const pagesSnapshot = await getDocs(pagesRef);
    
    pagesSnapshot.forEach(doc => {
      visibilityConfig[doc.id] = doc.data();
    });
    
    configLoaded = true;
    console.log('✅ Loaded page visibility config:', visibilityConfig);
    return visibilityConfig;
  } catch (error) {
    console.error('❌ Error loading page visibility:', error);
    configLoaded = true;
    return visibilityConfig;
  }
}

// Helper function to check if page should be visible
export function isPageVisible(pageId) {
  const config = visibilityConfig[pageId];
  // Default to visible if no config exists
  return config === undefined || config.visible !== false;
}

// Function to get filtered navigation structure by visibility
export function getFilteredNavStructure() {
  const filtered = {
    primary: [],
    secondary: [],
    tertiary: [],
    auth: [],
    authPublic: []
  };

  Object.keys(NAV_STRUCTURE).forEach(tier => {
    filtered[tier] = NAV_STRUCTURE[tier].filter(page => {
      return isPageVisible(page.id);
    });
  });

  return filtered;
}

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
    { id: 'playoffs', href: 'playoffs.html', label: 'Playoff Bracket', icon: '🥇', priority: 2 },
    { id: 'projections', href: 'projections.html', label: 'Playoff Projections', icon: '🎱', priority: 2 },
    { id: 'clinching', href: 'playoff-clinching.html', label: 'Playoff Clinching', icon: '🔒', priority: 2 },
    { id: 'bracket', href: 'bracket.html', label: 'Create your own Playoff bracket', icon: '🔭', priority: 2 },
    { id: 'seasons', href: 'seasons.html', label: 'All Seasons', icon: '📅', priority: 2 },
    { id: 'champions', href: 'champions.html', label: 'Champions', icon: '🏆', priority: 2 },
    { id: 'recap', href: 'recap.html', label: 'Year in Review', icon: '📖', priority: 2 },
    { id: 'leaders', href: 'leaders.html', label: 'Career Leaders', icon: '👑', priority: 2 },
    { id: 'awards', href: 'awards.html', label: 'Awards', icon: '🏅', priority: 2 },
    { id: 'games', href: 'games.html', label: 'Daily Games', icon: '🎮', priority: 2 },
  ],
  
  // Tier 3: TERTIARY - Specialty pages (mobile-only unless contextually relevant)
  tertiary: [
    { id: 'milestones', href: 'milestones.html', label: 'Milestones', icon: '🎯', priority: 3 },
    { id: 'compare', href: 'compare.html', label: 'Player Comparison', icon: '🔀', priority: 3 },
    { id: 'team-compare', href: 'team_compare.html', label: 'Team Comparison', icon: '🆚', priority: 3 },
    { id: 'h2h', href: 'h2h_grid.html', label: 'Head-to-Head Grid', icon: '⚔️', priority: 3 },
    { id: 'history', href: 'league-history.html', label: 'League History', icon: '📜', priority: 3 },
    { id: 'charts', href: 'charts.html', label: 'Performance Charts', icon: '📊', priority: 3 },
    { id: 'query-stats', href: 'query-stats.html', label: 'Stats Query Tool', icon: '🔍', priority: 3 },
    { id: 'pictures', href: 'pictures.html', label: 'Gallery', icon: '📷', priority: 3 },
    { id: 'rule-proposals', href: 'rule-proposals.html', label: 'Rule Proposals', icon: '📋', priority: 3 },
    // game-preview removed - requires specific game ID parameter
  ],
  
  // Tier 4: AUTH - User-specific pages (only visible when authenticated)
  auth: [
    { id: 'dashboard', href: 'my-dashboard.html', label: 'My Dashboard', icon: '📋', priority: 4, requiresAuth: true },
    { id: 'profile', href: 'profile.html', label: 'My Profile', icon: '👤', priority: 4, requiresAuth: true },
    { id: 'contributor', href: 'contributor.html', label: 'Contributor Dashboard', icon: '✨', priority: 4, requiresAuth: true },
    { id: 'favorites', href: 'favorites.html', label: 'Favorites', icon: '⭐', priority: 4, requiresAuth: true },
    { id: 'roster-management', href: 'roster-management.html', label: 'Roster Management', icon: '✉️', priority: 4, requiresAuth: true },
    { id: 'directory', href: 'aces-directory.html', label: 'Aces Directory', icon: '📇', priority: 4, requiresAuth: true },
    { id: 'submit-score', href: 'submit-score.html', label: 'Submit Scores', icon: '🔢️', priority: 4, requiresAuth: true },
    { id: 'submit-stats', href: 'submit-stats.html', label: 'Submit Stats', icon: '🧮', priority: 4, requiresAuth: true },
    { id: 'photo-upload', href: 'photo-upload.html', label: 'Upload Photos', icon: '📤️', priority: 4, requiresAuth: true },
    { id: 'offseason-hub', href: 'offseason.html', label: 'Offseason Hub', icon: '🎣️', priority: 4, requiresAuth: true },
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
    desktop: ['home', 'current-season', 'league-rules', 'weekend-preview', 'playoffs','clinching','projections', 'batting', 'pitching', 'teams', 'players']
  },
  
  'league-rules.html': {
    desktop: ['home', 'current-season', 'league-rules', 'batting', 'pitching', 'teams', 'players']
  },
  
  'weekend-preview.html': {
    desktop: ['home', 'current-season', 'league-rules', 'playoffs', 'clinching','projections', 'batting', 'pitching']
  },
  
  'projections.html': {
    desktop: ['home', 'current-season', 'weekend-preview', 'playoffs', 'projections', 'batting', 'pitching', 'teams']
  },
    
  'playoff-clinching.html': {
    desktop: ['home', 'current-season', 'weekend-preview', 'playoffs', 'projections','bracket']
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
    desktop: ['home', 'current-season', 'seasons', 'champions', 'batting', 'pitching', 'teams', 'players', 'awards']
  },
  
  'season.html': {
    desktop: ['home', 'current-season', 'seasons', 'batting', 'pitching', 'teams', 'players']
  },
  
  'leaders.html': {
    desktop: ['home', 'current-season', 'batting', 'pitching', 'players', 'leaders', 'milestones', 'awards']
  },
  
  'awards.html': {
    desktop: ['home', 'current-season', 'seasons', 'champions', 'leaders', 'awards', 'players']
  },
  
  'recap.html': {
    desktop: ['home', 'current-season', 'seasons', 'recap', 'champions', 'awards', 'leaders', 'teams', 'players']
  },
  
  'champions.html': {
    desktop: ['home', 'current-season', 'seasons', 'champions', 'recap', 'awards', 'leaders', 'teams']
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
  
  'query-stats.html': {
    desktop: ['home', 'batting', 'pitching', 'players', 'leaders', 'query-stats']
  },
  
  'pictures.html': {
    desktop: ['home', 'current-season', 'teams', 'players', 'pictures']
  },
  
  'games.html': {
    desktop: ['home', 'current-season', 'players', 'teams']
  },
  
  // Game preview page - no nav needed (accessed via weekend-preview game cards)
  'game-preview.html': {
    desktop: ['home', 'current-season', 'weekend-preview']
  },
  
  // Auth-specific pages
  'my-dashboard.html': {
    desktop: []
  },
  
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
