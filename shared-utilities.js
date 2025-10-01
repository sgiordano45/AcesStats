/**
 * Shared Utilities for Mountainside Aces Website
 * Common functions used across multiple pages
 */

// ==================== DATE UTILITIES ====================

/**
 * Parse game date string into Date object
 * @param {string} dateStr - Date string in various formats
 * @returns {Date} - Parsed date object
 */
function parseGameDate(dateStr) {
  return new Date(dateStr);
}

/**
 * Format date for display
 * @param {string|Date} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} - Formatted date string
 */
function formatDate(date, options = {}) {
  const dateObj = typeof date === 'string' ? parseGameDate(date) : date;
  const defaultOptions = { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  };
  return dateObj.toLocaleDateString('en-US', { ...defaultOptions, ...options });
}

/**
 * Format date for comparison purposes
 * @param {string} dateStr - Date string
 * @returns {string} - Normalized date string
 */
function formatDateForComparison(dateStr) {
  const date = parseGameDate(dateStr);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD format
}

/**
 * Get date range text for multiple dates
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {string} - Formatted date range
 */
function getDateRangeText(startDate, endDate) {
  if (startDate.toDateString() === endDate.toDateString()) {
    return startDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    });
  } else {
    return `${startDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })} - ${endDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })}`;
  }
}

// ==================== DATA CLEANING UTILITIES ====================

/**
 * Clean batting data
 * @param {Array} data - Raw batting data
 * @returns {Array} - Cleaned batting data
 */
function cleanBattingData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : "",
    team: p.team ? p.team.trim() : "",
    season: p.season ? p.season.trim() : "",
    year: p.year ? String(p.year).trim() : "",
    games: Number(p.games) || 0,
    atBats: Number(p.atBats) || 0,
    hits: Number(p.hits) || 0,
    runs: Number(p.runs) || 0,
    walks: Number(p.walks) || 0,
    AcesWar: p.AcesWar === "N/A" || !p.AcesWar ? "N/A" : Number(p.AcesWar),
    Sub: p.Sub || p.sub || ""
  }));
}

/**
 * Clean pitching data
 * @param {Array} data - Raw pitching data
 * @returns {Array} - Cleaned pitching data
 */
function cleanPitchingData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : "",
    team: p.team ? p.team.trim() : "",
    season: p.season ? p.season.trim() : "",
    year: p.year ? String(p.year).trim() : "",
    games: Number(p.games) || 0,
    IP: parseFloat(p.IP) || 0,
    runsAllowed: Number(p["runs allowed"]) || 0,
    ERA: p.ERA === "N/A" || !p.ERA ? "N/A" : Number(p.ERA)
  }));
}

/**
 * Generic data cleaning function
 * @param {Array} data - Raw data array
 * @returns {Array} - Cleaned data
 */
function cleanData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : "",
    team: p.team ? p.team.trim() : "",
    season: p.season ? p.season.trim() : "",
    year: p.year ? String(p.year).trim() : "",
    games: Number(p.games) || 0,
    atBats: Number(p.atBats) || 0,
    hits: Number(p.hits) || 0,
    runs: Number(p.runs) || 0,
    walks: Number(p.walks) || 0
  }));
}

// ==================== TEAM RECORD UTILITIES ====================

/**
 * Calculate team record from games
 * @param {Array} games - Array of game objects
 * @param {string} teamName - Name of the team (optional)
 * @returns {Object} - Record object with wins, losses, ties, winPct
 */
function calculateTeamRecord(games, teamName = null) {
  let wins = 0, losses = 0, ties = 0;
  let regularWins = 0, regularLosses = 0, regularTies = 0;
  let playoffWins = 0, playoffLosses = 0, playoffTies = 0;
  
  games.forEach(game => {
    const isRegular = game.game_type === 'Regular';
    
    // If teamName provided, calculate for that team; otherwise use currentTeam global
    const currentTeam = teamName || window.currentTeam;
    
    if (game.winner === currentTeam) {
      wins++;
      if (isRegular) regularWins++;
      else playoffWins++;
    } else if (game.winner === "Tie" || game.winner.includes("Forfeit - Tie")) {
      ties++;
      if (isRegular) regularTies++;
      else playoffTies++;
    } else if (game.winner && game.winner.trim() !== "") {
      losses++;
      if (isRegular) regularLosses++;
      else playoffLosses++;
    }
  });
  
  const totalDecided = wins + losses;
  const winPct = totalDecided > 0 ? (wins / totalDecided).toFixed(3) : '.000';
  
  return {
    wins,
    losses,
    ties,
    winPct,
    regular: { wins: regularWins, losses: regularLosses, ties: regularTies },
    playoff: { wins: playoffWins, losses: playoffLosses, ties: playoffTies }
  };
}

/**
 * Format team record for display
 * @param {Object} record - Record object from calculateTeamRecord
 * @param {boolean} includeTies - Whether to include ties in display
 * @returns {string} - Formatted record string
 */
function formatTeamRecord(record, includeTies = true) {
  if (includeTies && record.ties > 0) {
    return `${record.wins}-${record.losses}-${record.ties}`;
  }
  return `${record.wins}-${record.losses}`;
}

/**
 * Calculate team record for specific season
 * @param {string} teamName - Name of the team
 * @param {Array} games - All games array
 * @param {string} year - Year filter
 * @param {string} season - Season filter
 * @returns {Object} - Record object
 */
function calculateSeasonTeamRecord(teamName, games, year, season) {
  const teamGames = games.filter(g => 
    (g["home team"] === teamName || g["away team"] === teamName) && 
    g.winner && g.winner.trim() !== "" &&
    g.year === year && g.season === season
  );
  
  return calculateTeamRecord(teamGames, teamName);
}

// ==================== CALCULATION UTILITIES ====================

/**
 * Calculate batting average
 * @param {number} hits - Number of hits
 * @param {number} atBats - Number of at bats
 * @returns {string} - Batting average as string (.xxx format)
 */
function calculateBattingAverage(hits, atBats) {
  return atBats > 0 ? (hits / atBats).toFixed(3) : ".000";
}

/**
 * Calculate on-base percentage
 * @param {number} hits - Number of hits
 * @param {number} walks - Number of walks
 * @param {number} atBats - Number of at bats
 * @returns {string} - OBP as string (.xxx format)
 */
function calculateOBP(hits, walks, atBats) {
  const plateAppearances = atBats + walks;
  const onBaseEvents = hits + walks;
  return plateAppearances > 0 ? (onBaseEvents / plateAppearances).toFixed(3) : ".000";
}

/**
 * Calculate win percentage
 * @param {number} wins - Number of wins
 * @param {number} losses - Number of losses
 * @returns {number} - Win percentage as decimal
 */
function calculateWinPercentage(wins, losses) {
  const totalDecided = wins + losses;
  return totalDecided > 0 ? wins / totalDecided : 0;
}

// ==================== DATA LOADING UTILITIES ====================

/**
 * Generic fetch wrapper with error handling
 * @param {string} url - URL to fetch
 * @param {boolean} required - Whether the resource is required
 * @returns {Promise} - Promise resolving to data or empty array
 */
async function fetchData(url, required = true) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (required) {
        throw new Error(`Failed to load ${url}`);
      }
      return [];
    }
    return await response.json();
  } catch (error) {
    console.error(`Error loading ${url}:`, error);
    if (required) {
      throw error;
    }
    return [];
  }
}

/**
 * Load multiple data sources
 * @param {Array} sources - Array of {url, required, key} objects
 * @returns {Promise<Object>} - Object with loaded data keyed by source key
 */
async function loadMultipleDataSources(sources) {
  const promises = sources.map(source => 
    fetchData(source.url, source.required)
      .then(data => ({ [source.key]: data }))
      .catch(error => {
        console.error(`Failed to load ${source.key}:`, error);
        return { [source.key]: [] };
      })
  );
  
  const results = await Promise.all(promises);
  return Object.assign({}, ...results);
}

// ==================== TEXT UTILITIES ====================

/**
 * Clean text with encoding issues
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
  if (!text) return text;
  
  return text
    // Fix smart/curly apostrophes and quotes
    .replace(/['']/g, "'")  // Replace smart apostrophes with regular ones
    .replace(/[""]/g, '"')  // Replace smart quotes with regular ones
    // Fix any other common encoding issues
    .replace(/Ã¢â‚¬â„¢/g, "'")   // Another common apostrophe encoding issue
    .replace(/Ã¢â‚¬Å"/g, '"')   // Opening smart quote
    .replace(/Ã¢â‚¬/g, '"')    // Closing smart quote
    .replace(/Ã¢â‚¬"/g, "—")   // Em dash
    .replace(/Ã¢â‚¬"/g, "–");  // En dash
}

/**
 * Generate URL-safe parameter
 * @param {string} text - Text to encode
 * @returns {string} - URL-encoded text
 */
function encodeParam(text) {
  return encodeURIComponent(text);
}

/**
 * Create player link
 * @param {string} playerName - Player name
 * @returns {string} - HTML link element
 */
function createPlayerLink(playerName) {
  return `<a href="player.html?name=${encodeParam(playerName)}">${playerName}</a>`;
}

/**
 * Create team link
 * @param {string} teamName - Team name
 * @returns {string} - HTML link element
 */
function createTeamLink(teamName) {
  return `<a href="team.html?team=${encodeParam(teamName)}">${teamName}</a>`;
}

// ==================== FILTER UTILITIES ====================

/**
 * Populate filter dropdowns
 * @param {Array} data - Data array to extract filter options from
 * @param {Object} filterConfig - Configuration object for filters
 */
function populateFilters(data, filterConfig = {}) {
  const {
    yearFilterId = "yearFilter",
    seasonFilterId = "seasonFilter", 
    teamFilterId = "teamFilter",
    includeAll = true
  } = filterConfig;

  const years = [...new Set(data.map(p => p.year))].sort((a, b) => b - a);
  const seasons = [...new Set(data.map(p => p.season))].sort();
  const teams = [...new Set(data.map(p => p.team))].sort();

  const yearFilter = document.getElementById(yearFilterId);
  const seasonFilter = document.getElementById(seasonFilterId);
  const teamFilter = document.getElementById(teamFilterId);

  if (yearFilter) {
    if (includeAll) {
      yearFilter.innerHTML = '<option value="All">All Years</option>';
    }
    years.forEach(y => {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      yearFilter.appendChild(opt);
    });
  }

  if (seasonFilter) {
    if (includeAll) {
      seasonFilter.innerHTML = '<option value="All">All Seasons</option>';
    }
    seasons.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      seasonFilter.appendChild(opt);
    });
  }

  if (teamFilter) {
    if (includeAll) {
      teamFilter.innerHTML = '<option value="All">All Teams</option>';
    }
    teams.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      teamFilter.appendChild(opt);
    });
  }
}

/**
 * Apply filters to data
 * @param {Array} data - Original data array
 * @param {Object} filters - Filter values object
 * @returns {Array} - Filtered data array
 */
function applyDataFilters(data, filters) {
  return data.filter(item => {
    return Object.entries(filters).every(([key, value]) => {
      if (value === "All" || !value) return true;
      return String(item[key]) === String(value);
    });
  });
}

// ==================== LOGO UTILITIES ====================

/**
 * Load team logo with fallback
 * @param {string} teamName - Team name
 * @param {string} elementId - ID of img element
 */
function loadTeamLogo(teamName, elementId) {
  const logoElement = document.getElementById(elementId);
  if (!logoElement) return;
  
  logoElement.src = `logos/${teamName.toLowerCase().replace(/\s+/g, '_')}.png`;
  logoElement.alt = `${teamName} logo`;
  
  logoElement.onload = function() {
    this.classList.add('loaded');
    this.style.display = 'block';
  };
  
  logoElement.onerror = function() {
    this.style.display = 'none';
  };
}

// ==================== WEATHER UTILITIES ====================

/**
 * Get weather icon for condition
 * @param {string} condition - Weather condition
 * @returns {string} - Weather emoji
 */
function getWeatherIcon(condition) {
  const iconMap = {
    'Clear': '☀️',
    'Clouds': '☁️',
    'Rain': '🌧️',
    'Drizzle': '🌦️',
    'Thunderstorm': '⛈️',
    'Snow': '❄️',
    'Mist': '🌫️',
    'Fog': '🌫️',
    'Haze': '🌫️'
  };
  return iconMap[condition] || '🌤️';
}

// ==================== SORTING UTILITIES ====================

/**
 * Generic table sorting function
 * @param {HTMLTableElement} table - Table element to sort
 * @param {number} columnIndex - Column index to sort by
 * @param {string} direction - 'asc' or 'desc'
 */
function sortTable(table, columnIndex, direction = 'asc') {
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.rows);
  
  rows.sort((a, b) => {
    const x = a.cells[columnIndex].textContent.trim();
    const y = b.cells[columnIndex].textContent.trim();
    
    // Handle special cases
    if (x === "N/A" && y !== "N/A") return 1;
    if (y === "N/A" && x !== "N/A") return -1;
    if (x === "N/A" && y === "N/A") return 0;
    
    // Try parsing as numbers first
    const xNum = parseFloat(x.replace(/,/g, ""));
    const yNum = parseFloat(y.replace(/,/g, ""));
    
    if (!isNaN(xNum) && !isNaN(yNum)) {
      return direction === "asc" ? xNum - yNum : yNum - xNum;
    }
    
    // Fall back to string comparison
    return direction === "asc" ? x.localeCompare(y) : y.localeCompare(x);
  });
  
  // Re-append sorted rows
  rows.forEach(row => tbody.appendChild(row));
}

// ==================== ERROR HANDLING ====================

/**
 * Show error message in specified container
 * @param {string} containerId - ID of container element
 * @param {string} message - Error message to display
 */
function showError(containerId, message = "Error loading data. Please try again later.") {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `
      <div class="error">
        <h3>⚠️ Error</h3>
        <p>${message}</p>
      </div>
    `;
  }
}

/**
 * Show loading state in specified container
 * @param {string} containerId - ID of container element
 * @param {string} message - Loading message to display
 */
function showLoading(containerId, message = "Loading data...") {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `
      <div class="loading">
        <div>⏳</div>
        <p>${message}</p>
      </div>
    `;
  }
}

// ==================== CONSTANTS ====================

// Common constants used across the site
const CURRENT_SEASON = "Fall";
const CURRENT_YEAR = "2025";
const TODAY = new Date();

// Weather configuration (if needed)
const WEATHER_CONFIG = {
  ZIP: "07092", // Mountainside, NJ
  API_KEY: "c26153644bca587d9db1fc0256a01cf0" // Replace with actual key
};

// Export for use in other files (if using modules)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseGameDate,
    formatDate,
    formatDateForComparison,
    getDateRangeText,
    cleanBattingData,
    cleanPitchingData,
    cleanData,
    calculateTeamRecord,
    formatTeamRecord,
    calculateSeasonTeamRecord,
    calculateBattingAverage,
    calculateOBP,
    calculateWinPercentage,
    fetchData,
    loadMultipleDataSources,
    cleanText,
    encodeParam,
    createPlayerLink,
    createTeamLink,
    populateFilters,
    applyDataFilters,
    loadTeamLogo,
    getWeatherIcon,
    sortTable,
    showError,
    showLoading,
    CURRENT_SEASON,
    CURRENT_YEAR,
    TODAY,
    WEATHER_CONFIG
  };
}