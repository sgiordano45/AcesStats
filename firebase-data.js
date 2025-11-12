// firebase-data.js
// Helper functions to fetch data from Firebase

// ✅ Import from firebase-config.js - the single source of truth
// This ensures Firebase is initialized only ONCE and persistence is enabled properly
import { 
  app, 
  db, 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  query, 
  where, 
  orderBy, 
  limit 
} from './firebase-config.js';

// Re-export app and db for firebase-auth.js and other files
export { app, db };

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Convert player name to userId format
 * "John Doe" -> "john_doe"
 */
function nameToUserId(name) {
  return name.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Convert userId back to display name
 * "john_doe" -> "John Doe"
 */
function userIdToName(userId) {
  return userId
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Validate that a field contains valid data
 */
function isValidData(value) {
  return value !== null && value !== undefined && value !== '' && !isNaN(value);
}

/**
 * Safely get a numeric value from a document field
 */
function getNumericValue(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '' || isNaN(value)) {
    return defaultValue;
  }
  return Number(value);
}

// ============================================
// PLAYER DATA FUNCTIONS
// ============================================

/**
 * Fetch all players from Firestore
 */
export async function fetchPlayers() {
  try {
    const playersRef = collection(db, 'players');
    const snapshot = await getDocs(playersRef);
    
    const players = [];
    snapshot.forEach((doc) => {
      players.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by name
    players.sort((a, b) => {
      const nameA = a.name || a.id;
      const nameB = b.name || b.id;
      return nameA.localeCompare(nameB);
    });
    
    console.log(`✅ Fetched ${players.length} players from Firestore`);
    return players;
    
  } catch (error) {
    console.error('❌ Error fetching players:', error);
    return [];
  }
}

/**
 * Fetch a single player by ID
 */
export async function fetchPlayer(playerId) {
  try {
    const playerRef = doc(db, 'players', playerId);
    const playerDoc = await getDoc(playerRef);
    
    if (playerDoc.exists()) {
      return {
        id: playerDoc.id,
        ...playerDoc.data()
      };
    } else {
      console.warn(`⚠️ Player not found: ${playerId}`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ Error fetching player ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch player statistics for a specific season
 */
export async function fetchPlayerSeasonStats(playerId, season) {
  try {
    const statsRef = doc(db, 'players', playerId, 'seasons', season);
    const statsDoc = await getDoc(statsRef);
    
    if (statsDoc.exists()) {
      return statsDoc.data();
    } else {
      console.warn(`⚠️ No stats found for ${playerId} in ${season}`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ Error fetching stats for ${playerId} (${season}):`, error);
    return null;
  }
}

/**
 * Fetch all seasons for a player
 */
export async function fetchPlayerSeasons(playerId) {
  try {
    const seasonsRef = collection(db, 'players', playerId, 'seasons');
    const snapshot = await getDocs(seasonsRef);
    
    const seasons = [];
    snapshot.forEach((doc) => {
      seasons.push({
        season: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by season (descending)
    seasons.sort((a, b) => b.season.localeCompare(a.season));
    
    return seasons;
    
  } catch (error) {
    console.error(`❌ Error fetching seasons for ${playerId}:`, error);
    return [];
  }
}

// ============================================
// TEAM DATA FUNCTIONS
// ============================================

/**
 * Fetch all teams from Firestore
 */
export async function fetchTeams() {
  try {
    const teamsRef = collection(db, 'teams');
    const snapshot = await getDocs(teamsRef);
    
    const teams = [];
    snapshot.forEach((doc) => {
      teams.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by name
    teams.sort((a, b) => {
      const nameA = a.name || a.id;
      const nameB = b.name || b.id;
      return nameA.localeCompare(nameB);
    });
    
    console.log(`✅ Fetched ${teams.length} teams from Firestore`);
    return teams;
    
  } catch (error) {
    console.error('❌ Error fetching teams:', error);
    return [];
  }
}

/**
 * Fetch a single team by ID
 */
export async function fetchTeam(teamId) {
  try {
    const teamRef = doc(db, 'teams', teamId);
    const teamDoc = await getDoc(teamRef);
    
    if (teamDoc.exists()) {
      return {
        id: teamDoc.id,
        ...teamDoc.data()
      };
    } else {
      console.warn(`⚠️ Team not found: ${teamId}`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ Error fetching team ${teamId}:`, error);
    return null;
  }
}

/**
 * Fetch team roster for a specific season
 */
export async function fetchTeamRoster(teamId, season) {
  try {
    const rosterRef = doc(db, 'teams', teamId, 'seasons', season);
    const rosterDoc = await getDoc(rosterRef);
    
    if (rosterDoc.exists()) {
      return rosterDoc.data();
    } else {
      console.warn(`⚠️ No roster found for ${teamId} in ${season}`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ Error fetching roster for ${teamId} (${season}):`, error);
    return null;
  }
}

// ============================================
// SEASON DATA FUNCTIONS
// ============================================

/**
 * Fetch all seasons from Firestore
 */
export async function fetchSeasons() {
  try {
    const seasonsRef = collection(db, 'seasons');
    const snapshot = await getDocs(seasonsRef);
    
    const seasons = [];
    snapshot.forEach((doc) => {
      seasons.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by season (descending)
    seasons.sort((a, b) => b.id.localeCompare(a.id));
    
    console.log(`✅ Fetched ${seasons.length} seasons from Firestore`);
    return seasons;
    
  } catch (error) {
    console.error('❌ Error fetching seasons:', error);
    return [];
  }
}

/**
 * Fetch a single season by ID
 */
export async function fetchSeason(seasonId) {
  try {
    const seasonRef = doc(db, 'seasons', seasonId);
    const seasonDoc = await getDoc(seasonRef);
    
    if (seasonDoc.exists()) {
      return {
        id: seasonDoc.id,
        ...seasonDoc.data()
      };
    } else {
      console.warn(`⚠️ Season not found: ${seasonId}`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ Error fetching season ${seasonId}:`, error);
    return null;
  }
}

/**
 * Fetch games for a specific season
 */
export async function fetchSeasonGames(seasonId) {
  try {
    const gamesRef = collection(db, 'seasons', seasonId, 'games');
    const snapshot = await getDocs(gamesRef);
    
    const games = [];
    snapshot.forEach((doc) => {
      games.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by date (descending)
    games.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      return dateB.localeCompare(dateA);
    });
    
    return games;
    
  } catch (error) {
    console.error(`❌ Error fetching games for ${seasonId}:`, error);
    return [];
  }
}

/**
 * Fetch standings for a specific season
 */
export async function fetchSeasonStandings(seasonId) {
  try {
    const standingsRef = collection(db, 'seasons', seasonId, 'standings');
    const snapshot = await getDocs(standingsRef);
    
    const standings = [];
    snapshot.forEach((doc) => {
      standings.push({
        teamId: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by wins (descending), then by win percentage
    standings.sort((a, b) => {
      const winsA = getNumericValue(a.wins, 0);
      const winsB = getNumericValue(b.wins, 0);
      
      if (winsB !== winsA) {
        return winsB - winsA;
      }
      
      const wpA = getNumericValue(a.winPercentage, 0);
      const wpB = getNumericValue(b.winPercentage, 0);
      return wpB - wpA;
    });
    
    return standings;
    
  } catch (error) {
    console.error(`❌ Error fetching standings for ${seasonId}:`, error);
    return [];
  }
}

// ============================================
// GAME DATA FUNCTIONS
// ============================================

/**
 * Fetch a single game by season and game ID
 */
export async function fetchGame(seasonId, gameId) {
  try {
    const gameRef = doc(db, 'seasons', seasonId, 'games', gameId);
    const gameDoc = await getDoc(gameRef);
    
    if (gameDoc.exists()) {
      return {
        id: gameDoc.id,
        ...gameDoc.data()
      };
    } else {
      console.warn(`⚠️ Game not found: ${seasonId}/${gameId}`);
      return null;
    }
    
  } catch (error) {
    console.error(`❌ Error fetching game ${seasonId}/${gameId}:`, error);
    return null;
  }
}

/**
 * Fetch recent games (across all seasons)
 */
export async function fetchRecentGames(limit = 10) {
  try {
    // This would require a collection group query or iterating through seasons
    // For now, fetch from current season
    const currentSeason = '2024'; // TODO: Make this dynamic
    return await fetchSeasonGames(currentSeason);
    
  } catch (error) {
    console.error('❌ Error fetching recent games:', error);
    return [];
  }
}

// ============================================
// STATISTICS FUNCTIONS
// ============================================

/**
 * Calculate batting average
 */
export function calculateBattingAverage(hits, atBats) {
  if (atBats === 0) return 0;
  return hits / atBats;
}

/**
 * Calculate on-base percentage
 */
export function calculateOBP(hits, walks, hbp, atBats, sacrificeFlies) {
  const numerator = hits + walks + hbp;
  const denominator = atBats + walks + hbp + sacrificeFlies;
  
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Calculate slugging percentage
 */
export function calculateSLG(singles, doubles, triples, homeRuns, atBats) {
  const totalBases = singles + (doubles * 2) + (triples * 3) + (homeRuns * 4);
  
  if (atBats === 0) return 0;
  return totalBases / atBats;
}

/**
 * Calculate OPS (On-base Plus Slugging)
 */
export function calculateOPS(obp, slg) {
  return obp + slg;
}

/**
 * Calculate ERA (Earned Run Average)
 */
export function calculateERA(earnedRuns, inningsPitched) {
  if (inningsPitched === 0) return 0;
  return (earnedRuns * 7) / inningsPitched; // 7 innings per game in softball
}

/**
 * Calculate WHIP (Walks + Hits per Inning Pitched)
 */
export function calculateWHIP(walks, hits, inningsPitched) {
  if (inningsPitched === 0) return 0;
  return (walks + hits) / inningsPitched;
}

/**
 * Format statistics for display
 */
export function formatStat(value, decimals = 3) {
  if (value === null || value === undefined || isNaN(value)) {
    return '-';
  }
  
  // Batting averages shown without leading zero (.300 not 0.300)
  if (decimals === 3) {
    return value.toFixed(3).substring(1);
  }
  
  return value.toFixed(decimals);
}

/**
 * Get player's best season
 */
export function getBestSeason(seasons, stat = 'battingAverage') {
  if (!seasons || seasons.length === 0) return null;
  
  let bestSeason = seasons[0];
  let bestValue = getNumericValue(bestSeason[stat], 0);
  
  for (const season of seasons) {
    const value = getNumericValue(season[stat], 0);
    if (value > bestValue) {
      bestValue = value;
      bestSeason = season;
    }
  }
  
  return bestSeason;
}

/**
 * Calculate career totals from multiple seasons
 */
export function calculateCareerTotals(seasons) {
  const totals = {
    games: 0,
    atBats: 0,
    hits: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    rbi: 0,
    runs: 0,
    walks: 0,
    strikeouts: 0,
    stolenBases: 0
  };
  
  for (const season of seasons) {
    for (const key in totals) {
      totals[key] += getNumericValue(season[key], 0);
    }
  }
  
  return totals;
}

// ============================================
// SEARCH AND FILTER FUNCTIONS
// ============================================

/**
 * Search players by name
 */
export async function searchPlayers(searchTerm) {
  try {
    const players = await fetchPlayers();
    
    const searchLower = searchTerm.toLowerCase();
    const filtered = players.filter(player => {
      const name = (player.name || player.id).toLowerCase();
      return name.includes(searchLower);
    });
    
    return filtered;
    
  } catch (error) {
    console.error('❌ Error searching players:', error);
    return [];
  }
}

/**
 * Filter players by team
 */
export async function filterPlayersByTeam(teamId, season) {
  try {
    const playersRef = collection(db, 'players');
    const q = query(
      playersRef,
      where(`seasons.${season}.team`, '==', teamId)
    );
    
    const snapshot = await getDocs(q);
    const players = [];
    
    snapshot.forEach((doc) => {
      players.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return players;
    
  } catch (error) {
    console.error('❌ Error filtering players by team:', error);
    return [];
  }
}

/**
 * Get league leaders for a specific stat
 */
export async function getLeagueLeaders(season, stat, limit = 10) {
  try {
    const players = await fetchPlayers();
    
    // Filter players with data for this season and stat
    const qualified = players.filter(player => {
      const seasonData = player.seasons?.[season];
      return seasonData && isValidData(seasonData[stat]);
    });
    
    // Sort by stat (descending)
    qualified.sort((a, b) => {
      const valueA = getNumericValue(a.seasons[season][stat], 0);
      const valueB = getNumericValue(b.seasons[season][stat], 0);
      return valueB - valueA;
    });
    
    // Return top N
    return qualified.slice(0, limit);
    
  } catch (error) {
    console.error('❌ Error getting league leaders:', error);
    return [];
  }
}

// ============================================
// UTILITY EXPORTS
// ============================================

export {
  nameToUserId,
  userIdToName,
  isValidData,
  getNumericValue
};