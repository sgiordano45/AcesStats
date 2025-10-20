/**
 * Firebase Game Tracker Module
 * Handles fetching game-specific lineup data for the game tracker
 */

import { db } from './firebase-config.js';
import { doc, getDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

/**
 * Get the batting order for a specific game
 * @param {string} gameId - The game ID
 * @param {string} teamName - The team name
 * @returns {Promise<Array>} Array of player objects in batting order
 */
export async function getGameBattingOrder(gameId, teamName) {
  try {
    const battingOrderRef = doc(db, 'battingOrders', `${gameId}_${teamName}`);
    const battingOrderSnap = await getDoc(battingOrderRef);
    
    if (!battingOrderSnap.exists()) {
      console.log('No batting order found for this game');
      return [];
    }
    
    const data = battingOrderSnap.data();
    const playerIds = data.order || [];
    
    // Fetch player details for each ID
    const players = await Promise.all(
      playerIds.map(async (playerId) => {
        if (!playerId) return null;
        
        try {
          const playerDoc = await getDoc(doc(db, 'users', playerId));
          if (playerDoc.exists()) {
            const playerData = playerDoc.data();
            return {
              id: playerId,
              name: playerData.linkedPlayer || playerData.displayName,
              number: playerData.number || '0',
              position: playerData.position || 'IF/OF'
            };
          }
        } catch (error) {
          console.warn(`Could not fetch player ${playerId}:`, error);
        }
        return null;
      })
    );
    
    return players.filter(p => p !== null);
  } catch (error) {
    console.error('Error fetching batting order:', error);
    return [];
  }
}

/**
 * Get defensive positions for all innings of a game
 * @param {string} gameId - The game ID
 * @param {string} teamName - The team name
 * @returns {Promise<Object>} Object mapping innings to positions to players
 */
export async function getGameDefensivePositions(gameId, teamName) {
  try {
    const positionsRef = doc(db, 'fieldingPositions', `${gameId}_${teamName}`);
    const positionsSnap = await getDoc(positionsRef);
    
    if (!positionsSnap.exists()) {
      console.log('No defensive positions found for this game');
      return {};
    }
    
    const data = positionsSnap.data();
    const innings = data.innings || {};
    
    // Convert player IDs to player objects for each inning/position
    const defensiveLineup = {};
    
    for (const [inning, positions] of Object.entries(innings)) {
      defensiveLineup[inning] = {};
      
      for (const [position, playerData] of Object.entries(positions)) {
        if (playerData && playerData.id) {
          defensiveLineup[inning][position] = {
            id: playerData.id,
            name: playerData.name,
            number: playerData.number || '0',
            position: position
          };
        }
      }
    }
    
    return defensiveLineup;
  } catch (error) {
    console.error('Error fetching defensive positions:', error);
    return {};
  }
}

/**
 * Get bench players for all innings of a game
 * @param {string} gameId - The game ID
 * @param {string} teamName - The team name
 * @returns {Promise<Object>} Object mapping innings to arrays of bench players
 */
export async function getGameBenchPlayers(gameId, teamName) {
  try {
    const benchRef = doc(db, 'benchPlayers', `${gameId}_${teamName}`);
    const benchSnap = await getDoc(benchRef);
    
    if (!benchSnap.exists()) {
      console.log('No bench players found for this game');
      return {};
    }
    
    const data = benchSnap.data();
    return data.innings || {};
  } catch (error) {
    console.error('Error fetching bench players:', error);
    return {};
  }
}

/**
 * Get RSVPs for a specific game
 * @param {string} gameId - The game ID
 * @returns {Promise<Object>} Object mapping player IDs to RSVP status
 */
export async function getGameRSVPs(gameId) {
  try {
    const rsvpRef = doc(db, 'gameRSVPs', gameId);
    const rsvpSnap = await getDoc(rsvpRef);
    
    if (!rsvpSnap.exists()) {
      console.log('No RSVPs found for this game');
      return {};
    }
    
    return rsvpSnap.data().rsvps || {};
  } catch (error) {
    console.error('Error fetching RSVPs:', error);
    return {};
  }
}

/**
 * Get complete game lineup data (batting order, defense, bench, RSVPs)
 * @param {string} gameId - The game ID
 * @param {string} teamName - The team name
 * @returns {Promise<Object>} Complete lineup data
 */
export async function getCompleteGameLineup(gameId, teamName) {
  try {
    const [battingOrder, defensivePositions, benchPlayers, rsvps] = await Promise.all([
      getGameBattingOrder(gameId, teamName),
      getGameDefensivePositions(gameId, teamName),
      getGameBenchPlayers(gameId, teamName),
      getGameRSVPs(gameId)
    ]);
    
    return {
      battingOrder,
      defensivePositions,
      benchPlayers,
      rsvps,
      gameId,
      teamName
    };
  } catch (error) {
    console.error('Error fetching complete game lineup:', error);
    return {
      battingOrder: [],
      defensivePositions: {},
      benchPlayers: {},
      rsvps: {},
      gameId,
      teamName
    };
  }
}

/**
 * Check if a lineup has been set for a game
 * @param {string} gameId - The game ID
 * @param {string} teamName - The team name
 * @returns {Promise<boolean>} True if lineup exists
 */
export async function hasLineupBeenSet(gameId, teamName) {
  try {
    const battingOrderRef = doc(db, 'battingOrders', `${gameId}_${teamName}`);
    const battingOrderSnap = await getDoc(battingOrderRef);
    return battingOrderSnap.exists();
  } catch (error) {
    console.error('Error checking lineup:', error);
    return false;
  }
}
