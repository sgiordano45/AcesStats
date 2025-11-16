// firebase-roster.js
import { 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  updateDoc, 
  collection, 
  query,
  where,
  serverTimestamp,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { db } from './firebase-data.js';

// ========================================
// RSVP FUNCTIONS
// ========================================

/**
 * Get all RSVPs for a specific game
 * @param {string} gameId - The game ID
 * @returns {Object} Map of userId -> RSVP status
 */
export async function getGameRSVPs(gameId) {
  try {
    const rsvpsRef = collection(db, 'rsvps', gameId, 'responses');
    const snapshot = await getDocs(rsvpsRef);
    
    const rsvps = {};
    snapshot.forEach(doc => {
      rsvps[doc.id] = doc.data();
    });
    
    console.log(`✅ Loaded ${Object.keys(rsvps).length} RSVPs for game ${gameId}`);
    return rsvps;
  } catch (error) {
    console.error(`Error loading RSVPs for game ${gameId}:`, error);
    return {};
  }
}

/**
 * Update a player's RSVP for a game
 * @param {string} gameId - The game ID
 * @param {string} userId - The user/player ID
 * @param {string} status - "yes" | "no" | "maybe" | "none"
 * @param {string} playerName - Player's display name
 * @param {string} teamId - Team ID
 * @returns {Object} Success status
 */
export async function updateRSVP(gameId, userId, status, playerName, teamId) {
  try {
    const rsvpRef = doc(db, 'rsvps', gameId, 'responses', userId);
    
    await setDoc(rsvpRef, {
      status,
      playerName,
      teamId,
      updatedAt: serverTimestamp(),
      updatedBy: userId
    }, { merge: true });
    
    console.log(`✅ RSVP updated: ${playerName} -> ${status} for game ${gameId}`);
    return { success: true };
  } catch (error) {
    console.error('Error updating RSVP:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Get all RSVPs for a team across all games
 * @param {string} teamId - The team ID
 * @param {string} seasonId - The season ID
 * @returns {Array} Array of game RSVPs
 */
export async function getTeamRSVPs(teamId, seasonId) {
  try {
    // First get all games for the team in this season
    const gamesRef = collection(db, 'seasons', seasonId, 'games');
    const gamesQuery = query(
      gamesRef,
      where('homeTeamId', '==', teamId)
    );
    const awayQuery = query(
      gamesRef,
      where('awayTeamId', '==', teamId)
    );
    
    const [homeSnap, awaySnap] = await Promise.all([
      getDocs(gamesQuery),
      getDocs(awayQuery)
    ]);
    
    const gameIds = [];
    homeSnap.forEach(doc => gameIds.push(doc.id));
    awaySnap.forEach(doc => gameIds.push(doc.id));
    
    // Then get RSVPs for each game
    const rsvpPromises = gameIds.map(gameId => getGameRSVPs(gameId));
    const rsvpResults = await Promise.all(rsvpPromises);
    
    return gameIds.map((gameId, index) => ({
      gameId,
      rsvps: rsvpResults[index]
    }));
  } catch (error) {
    console.error('Error loading team RSVPs:', error);
    return [];
  }
}

/**
 * Listen to real-time RSVP updates for a game
 * @param {string} gameId - The game ID
 * @param {Function} callback - Callback function to handle updates
 * @returns {Function} Unsubscribe function
 */
export function listenToGameRSVPs(gameId, callback) {
  const rsvpsRef = collection(db, 'rsvps', gameId, 'responses');
  
  return onSnapshot(rsvpsRef, (snapshot) => {
    const rsvps = {};
    snapshot.forEach(doc => {
      rsvps[doc.id] = doc.data();
    });
    callback(rsvps);
  }, (error) => {
    console.error('Error listening to RSVPs:', error);
  });
}

// ========================================
// LINEUP FUNCTIONS
// ========================================

/**
 * Save batting order for a team in a game
 * @param {string} gameId - The game ID
 * @param {string} teamId - The team ID
 * @param {Array} order - Array of player IDs in batting order
 * @param {string} updatedBy - User ID making the update
 * @returns {Object} Success status
 */
export async function saveBattingOrder(gameId, teamId, order, updatedBy) {
  try {
    const battingRef = doc(db, 'lineups', gameId, 'batting', teamId);
    
    await setDoc(battingRef, {
      order,
      updatedAt: serverTimestamp(),
      updatedBy
    });
    
    console.log(`✅ Batting order saved for ${teamId} in game ${gameId}`);
    return { success: true };
  } catch (error) {
    console.error('Error saving batting order:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Get batting order for a team in a game
 * @param {string} gameId - The game ID
 * @param {string} teamId - The team ID
 * @returns {Array} Batting order
 */
export async function getBattingOrder(gameId, teamId) {
  try {
    const battingRef = doc(db, 'lineups', gameId, 'batting', teamId);
    const docSnap = await getDoc(battingRef);
    
    if (docSnap.exists()) {
      return docSnap.data().order || [];
    }
    return [];
  } catch (error) {
    console.error('Error loading batting order:', error);
    return [];
  }
}

/**
 * Save fielding positions for a specific inning
 * @param {string} gameId - The game ID
 * @param {string} teamId - The team ID
 * @param {number} inning - Inning number
 * @param {Object} positions - Map of position -> player ID
 * @param {string} updatedBy - User ID making the update
 * @returns {Object} Success status
 */
export async function saveFieldingPositions(gameId, teamId, inning, positions, updatedBy) {
  try {
    const fieldingRef = doc(db, 'lineups', gameId, 'fielding', teamId, 'innings', inning.toString());
    
    await setDoc(fieldingRef, {
      positions,
      updatedAt: serverTimestamp(),
      updatedBy
    });
    
    console.log(`✅ Fielding positions saved for ${teamId} inning ${inning}`);
    return { success: true };
  } catch (error) {
    console.error('Error saving fielding positions:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Get all fielding positions for a team in a game
 * @param {string} gameId - The game ID
 * @param {string} teamId - The team ID
 * @returns {Object} Map of inning -> positions
 */
export async function getFieldingPositions(gameId, teamId) {
  try {
    const inningsRef = collection(db, 'lineups', gameId, 'fielding', teamId, 'innings');
    const snapshot = await getDocs(inningsRef);
    
    const allInnings = {};
    snapshot.forEach(doc => {
      allInnings[doc.id] = doc.data().positions || {};
    });
    
    return allInnings;
  } catch (error) {
    console.error('Error loading fielding positions:', error);
    return {};
  }
}

/**
 * Save bench players for a specific inning
 * @param {string} gameId - The game ID
 * @param {string} teamId - The team ID
 * @param {number} inning - Inning number
 * @param {Array} players - Array of player IDs on bench
 * @param {string} updatedBy - User ID making the update
 * @returns {Object} Success status
 */
export async function saveBenchPlayers(gameId, teamId, inning, players, updatedBy) {
  try {
    const benchRef = doc(db, 'lineups', gameId, 'bench', teamId, 'innings', inning.toString());
    
    await setDoc(benchRef, {
      players,
      updatedAt: serverTimestamp(),
      updatedBy
    });
    
    console.log(`✅ Bench players saved for ${teamId} inning ${inning}`);
    return { success: true };
  } catch (error) {
    console.error('Error saving bench players:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Get all bench assignments for a team in a game
 * @param {string} gameId - The game ID
 * @param {string} teamId - The team ID
 * @returns {Object} Map of inning -> players array
 */
export async function getBenchPlayers(gameId, teamId) {
  try {
    const inningsRef = collection(db, 'lineups', gameId, 'bench', teamId, 'innings');
    const snapshot = await getDocs(inningsRef);
    
    const allInnings = {};
    snapshot.forEach(doc => {
      allInnings[doc.id] = doc.data().players || [];
    });
    
    return allInnings;
  } catch (error) {
    console.error('Error loading bench players:', error);
    return {};
  }
}

// ========================================
// GAMES FUNCTIONS
// ========================================

/**
 * Get upcoming games for a team
 * @param {string} teamId - The team ID (can be any case)
 * @param {string} seasonId - The season ID
 * @returns {Array} Array of upcoming games
 */
export async function getUpcomingTeamGames(teamId, seasonId) {
  try {
    const gamesRef = collection(db, 'seasons', seasonId, 'games');
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today
    
    console.log(`🔍 Looking for games for team: "${teamId}" in season: ${seasonId}`);
    console.log(`📅 Today (for comparison): ${now.toISOString()}`);
    
    // Get ALL games for this season (we'll filter by date client-side)
    const allGamesSnap = await getDocs(gamesRef);
    
    console.log(`📊 Total games in season: ${allGamesSnap.size}`);
    
    const games = [];
    const teamIdLower = teamId.toLowerCase();
    
    let matchedTeamCount = 0;
    let futureGameCount = 0;
    
    allGamesSnap.forEach(doc => {
      const data = doc.data();
      
      // Handle both regular season and playoff field names
      // Regular: homeTeamId, awayTeamId, homeTeam, awayTeam, homeTeamName, awayTeamName
      // Playoff: "home team", "away team"
      const homeTeamValue = data.homeTeamId || data.homeTeamName || data.homeTeam || data['home team'] || '';
      const awayTeamValue = data.awayTeamId || data.awayTeamName || data.awayTeam || data['away team'] || '';
      
      // Check if this team is involved
      const homeTeamMatch = homeTeamValue.toLowerCase() === teamIdLower;
      const awayTeamMatch = awayTeamValue.toLowerCase() === teamIdLower;
      
      if (homeTeamMatch || awayTeamMatch) {
        matchedTeamCount++;
        console.log(`✓ Found team match in game ${doc.id}:`, {
          homeTeam: homeTeamValue,
          awayTeam: awayTeamValue,
          isHome: homeTeamMatch,
          gameType: data.game_type || data.gameType,
          rawDate: data.date
        });
      }
      
      if (!homeTeamMatch && !awayTeamMatch) {
        return; // Not this team's game
      }
      
      // Parse the game date
      let gameDate;
      if (data.date?.seconds) {
        gameDate = new Date(data.date.seconds * 1000);
      } else if (data.date) {
        gameDate = new Date(data.date);
      } else {
        console.log(`⚠️ Game ${doc.id} has no valid date`);
        return; // No valid date
      }
      
      gameDate.setHours(0, 0, 0, 0);
      
      console.log(`📅 Game ${doc.id} date comparison:`, {
        gameDate: gameDate.toISOString(),
        now: now.toISOString(),
        isFuture: gameDate >= now
      });
      
      // Only include future games
      if (gameDate >= now) {
        futureGameCount++;
        // Determine opponent based on which team we are
        const opponent = homeTeamMatch ? awayTeamValue : homeTeamValue;
        
        // Normalize game type (handle "game_type" and "gameType")
        const gameType = data.game_type || data.gameType || 'Regular';
        
        games.push({
          id: doc.id,
          ...data,
          // Normalize field names for consistent access
          homeTeam: homeTeamValue,
          awayTeam: awayTeamValue,
          gameType: gameType,
          isHome: homeTeamMatch,
          opponent: opponent
        });
      }
    });
    
    console.log(`📊 Stats: ${matchedTeamCount} team matches, ${futureGameCount} future games`);
    
    // Sort by date
    games.sort((a, b) => {
      const dateA = a.date?.seconds || new Date(a.date).getTime() / 1000 || 0;
      const dateB = b.date?.seconds || new Date(b.date).getTime() / 1000 || 0;
      return dateA - dateB;
    });
    
    console.log(`✅ Loaded ${games.length} upcoming games for ${teamId}`);
    if (games.length > 0) {
      console.log('First game:', {
        id: games[0].id,
        date: games[0].date,
        home: games[0].homeTeam,
        away: games[0].awayTeam,
        opponent: games[0].opponent,
        gameType: games[0].gameType
      });
    }
    
    return games;
  } catch (error) {
    console.error('Error loading team games:', error);
    return [];
  }
}
