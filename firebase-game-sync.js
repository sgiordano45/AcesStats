/**
 * Firebase Game Sync Module
 * Handles real-time synchronization for dual-team game tracking
 */

import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  serverTimestamp, 
  updateDoc,
  collection 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { db } from './firebase-config.js';

// ============================================
// REAL-TIME SUBSCRIPTION FUNCTIONS
// ============================================

/**
 * Subscribe to a team's game state with real-time updates
 * @param {string} gameId - The game ID
 * @param {string} teamId - The team ID
 * @param {Function} callback - Callback function to handle updates
 * @returns {Function} Unsubscribe function
 */
export function subscribeToGameState(gameId, teamId, callback) {
  const stateRef = doc(db, 'gameStates', `${gameId}_${teamId}`);
  
  return onSnapshot(stateRef, 
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data());
      }
    }, 
    (error) => {
      console.error('Error subscribing to game state:', error);
    }
  );
}

/**
 * Subscribe to game-level metadata with real-time updates
 * @param {string} gameId - The game ID
 * @param {Function} callback - Callback function to handle updates
 * @returns {Function} Unsubscribe function
 */
export function subscribeToGameMetadata(gameId, callback) {
  const metadataRef = doc(db, 'gameMetadata', gameId);
  
  return onSnapshot(metadataRef, 
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data());
      }
    }, 
    (error) => {
      console.error('Error subscribing to game metadata:', error);
    }
  );
}

/**
 * Subscribe to game presence (who's viewing/tracking)
 * @param {string} gameId - The game ID
 * @param {Function} callback - Callback function to handle updates
 * @returns {Function} Unsubscribe function
 */
export function subscribeToPresence(gameId, callback) {
  const presenceRef = collection(db, 'gamePresence', gameId, 'users');
  
  return onSnapshot(presenceRef, 
    (snapshot) => {
      const users = [];
      snapshot.forEach(doc => users.push(doc.data()));
      callback(users);
    },
    (error) => {
      console.error('Error subscribing to presence:', error);
    }
  );
}

// ============================================
// GAME METADATA FUNCTIONS
// ============================================

/**
 * Get game metadata (one-time read)
 * @param {string} gameId - The game ID
 * @returns {Promise<Object|null>} Game metadata
 */
export async function getGameMetadata(gameId) {
  try {
    const metadataRef = doc(db, 'gameMetadata', gameId);
    const metadataDoc = await getDoc(metadataRef);
    
    if (metadataDoc.exists()) {
      return metadataDoc.data();
    }
    return null;
  } catch (error) {
    console.error('Error getting game metadata:', error);
    return null;
  }
}

/**
 * Initialize or update game metadata
 * @param {string} gameId - The game ID
 * @param {string} teamId - The team ID making the update
 * @param {string} teamName - The team name
 * @param {number} newScore - The team's current score
 * @param {string} currentInning - Current inning (e.g., "▲ 3rd")
 * @param {string} status - Game status ('scheduled', 'in_progress', 'final')
 * @param {string} trackerName - Name of the person tracking
 * @returns {Promise<void>}
 */
export async function updateGameMetadata(gameId, teamId, teamName, newScore, currentInning, status = 'in_progress', trackerName = '') {
  try {
    const metadataRef = doc(db, 'gameMetadata', gameId);
    const metadataDoc = await getDoc(metadataRef);
    
    if (!metadataDoc.exists()) {
      // Initialize metadata on first update
      console.log('📝 Initializing game metadata for', gameId);
      
      await setDoc(metadataRef, {
        gameId,
        homeTeam: { 
          id: teamId, 
          name: teamName, 
          score: newScore, 
          hasTracker: true,
          trackerName: trackerName
        },
        awayTeam: { 
          id: null, 
          name: '', 
          score: 0, 
          hasTracker: false,
          trackerName: ''
        },
        currentInning,
        status: 'in_progress',
        gameStartedAt: serverTimestamp(),
        lastScoreChange: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      // Update existing metadata
      const data = metadataDoc.data();
      const isHomeTeam = data.homeTeam.id === teamId;
      
      // Determine if this is setting up the away team for the first time
      if (!data.awayTeam.id && !isHomeTeam) {
        await updateDoc(metadataRef, {
          'awayTeam.id': teamId,
          'awayTeam.name': teamName,
          'awayTeam.score': newScore,
          'awayTeam.hasTracker': true,
          'awayTeam.trackerName': trackerName,
          currentInning,
          status,
          updatedAt: serverTimestamp()
        });
        console.log('📝 Away team initialized:', teamName);
        return;
      }
      
      const updateData = {
        [`${isHomeTeam ? 'homeTeam' : 'awayTeam'}.score`]: newScore,
        [`${isHomeTeam ? 'homeTeam' : 'awayTeam'}.hasTracker`]: true,
        [`${isHomeTeam ? 'homeTeam' : 'awayTeam'}.trackerName`]: trackerName,
        currentInning,
        status,
        updatedAt: serverTimestamp()
      };
      
      // Track score changes for notifications
      const oldScore = isHomeTeam ? data.homeTeam.score : data.awayTeam.score;
      if (oldScore !== newScore) {
        updateData.lastScoreChange = serverTimestamp();
      }
      
      await updateDoc(metadataRef, updateData);
    }
  } catch (error) {
    console.error('Error updating game metadata:', error);
  }
}

// ============================================
// PRESENCE FUNCTIONS
// ============================================

/**
 * Update user presence in a game
 * @param {string} gameId - The game ID
 * @param {string} userId - The user ID
 * @param {string} userName - The user's display name
 * @param {string} teamId - The team ID they're tracking/viewing
 * @param {boolean} canTrack - Whether they have tracking permissions
 * @returns {Promise<void>}
 */
export async function updatePresence(gameId, userId, userName, teamId, canTrack) {
  try {
    const presenceRef = doc(db, 'gamePresence', gameId, 'users', userId);
    await setDoc(presenceRef, {
      userId,
      userName,
      teamId,
      role: canTrack ? 'tracker' : 'viewer',
      canTrack,
      lastActive: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating presence:', error);
  }
}

/**
 * Remove user presence from a game (call on unmount/leave)
 * @param {string} gameId - The game ID
 * @param {string} userId - The user ID
 * @returns {Promise<void>}
 */
export async function removePresence(gameId, userId) {
  try {
    const presenceRef = doc(db, 'gamePresence', gameId, 'users', userId);
    await updateDoc(presenceRef, {
      lastActive: serverTimestamp(),
      status: 'left'
    });
  } catch (error) {
    console.error('Error removing presence:', error);
  }
}

// ============================================
// PERMISSION CHECKING
// ============================================

/**
 * Check if user can track a specific team's game
 * @param {Object} userProfile - User profile from firebase-auth
 * @param {string} teamId - Team ID to check
 * @returns {boolean}
 */
export function canUserTrackTeam(userProfile, teamId) {
  if (!userProfile) return false;
  
  // Admin/league-staff can track any team
  if (userProfile.userRole === 'admin' || userProfile.userRole === 'league-staff') {
    return true;
  }
  
  // Check team-specific role
  const teamRole = userProfile.teamRoles?.[teamId];
  if (!teamRole || teamRole.status !== 'active') {
    return false;
  }
  
  // Captain or team-staff can track
  return teamRole.role === 'captain' || teamRole.role === 'team-staff';
}

/**
 * Get user's tracking permissions for a game
 * @param {Object} userProfile - User profile from firebase-auth
 * @param {Object} game - Game object with homeTeamId and awayTeamId
 * @returns {Object} Permissions object
 */
export function getGameTrackingPermissions(userProfile, game) {
  if (!userProfile || !game) {
    return {
      canTrackHome: false,
      canTrackAway: false,
      canView: false
    };
  }
  
  return {
    canTrackHome: canUserTrackTeam(userProfile, game.homeTeamId),
    canTrackAway: canUserTrackTeam(userProfile, game.awayTeamId),
    canView: true // Any logged-in user can view
  };
}
