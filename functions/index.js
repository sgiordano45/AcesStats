// functions/index.js
// Cloud Functions for Firebase Cloud Messaging
// Mountainside Aces Softball Stats Platform

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if current time is within user's quiet hours
 * @param {Object} quietHours - User's quiet hours settings {enabled, start, end}
 * @returns {boolean} True if in quiet hours (should NOT send notification)
 */
function isInQuietHours(quietHours) {
  if (!quietHours || !quietHours.enabled) {
    return false; // Quiet hours not enabled
  }
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  // Parse start and end times (format: "HH:MM")
  const [startHour, startMinute] = quietHours.start.split(':').map(Number);
  const [endHour, endMinute] = quietHours.end.split(':').map(Number);
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;
  
  // Handle cases where quiet hours span midnight
  if (startTime < endTime) {
    // Normal case: e.g., 22:00 to 23:59
    return currentTime >= startTime && currentTime < endTime;
  } else {
    // Spans midnight: e.g., 22:00 to 08:00
    return currentTime >= startTime || currentTime < endTime;
  }
}

/**
 * Determine if a game ID is a playoff game
 * @param {string} gameId - The game document ID
 * @returns {boolean} True if this is a playoff game
 */
function isPlayoffGame(gameId) {
  return gameId && gameId.startsWith('playoff_');
}

/**
 * Get the current active season
 */
async function getCurrentSeason() {
  const seasonsSnapshot = await db
    .collection('seasons')
    .where('isActive', '==', true)
    .limit(1)
    .get();
  
  if (seasonsSnapshot.empty) {
    console.error('No active season found');
    return null;
  }
  
  const seasonDoc = seasonsSnapshot.docs[0];
  return {
    id: seasonDoc.id,
    ...seasonDoc.data()
  };
}

/**
 * Get FCM tokens for all players on specified teams
 * Uses linkedTeam field on user documents
 */
async function getTeamPlayerTokens(teamIds) {
  const tokens = [];
  
  // Get all users with linkedTeam field
  const usersSnapshot = await db
    .collection('users')
    .where('linkedTeam', '!=', null)
    .get();
  
  // Normalize team IDs for case-insensitive matching
  const normalizedTeamIds = teamIds.map(id => id.toLowerCase());
  
  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    const userTeam = userData.linkedTeam?.toLowerCase();
    
    // Check if this user is linked to one of the specified teams
    if (normalizedTeamIds.includes(userTeam)) {
      // Check if user has notifications enabled
      if (userData.notificationsEnabled !== false) {
        const fcmTokens = userData.fcmTokens || [];
        tokens.push(...fcmTokens);
      }
    }
  }
  
  return [...new Set(tokens)]; // Remove duplicates
}

/**
 * Get FCM tokens for team players with specific notification preference
 * Uses linkedTeam field on user documents
 * @param {Array} teamIds - Array of team IDs
 * @param {string} preferenceKey - Key in notificationPreferences to check
 * @returns {Array} Array of tokens for users who want this notification type
 */
async function getTeamPlayerTokensWithPreference(teamIds, preferenceKey) {
  const tokens = [];
  
  // Get all users with linkedTeam field
  const usersSnapshot = await db
    .collection('users')
    .where('linkedTeam', '!=', null)
    .get();
  
  // Normalize team IDs for case-insensitive matching
  const normalizedTeamIds = teamIds.map(id => id.toLowerCase());
  
  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    const userTeam = userData.linkedTeam?.toLowerCase();
    
    // Check if this user is linked to one of the specified teams
    if (normalizedTeamIds.includes(userTeam)) {
      // Check quiet hours first
      if (isInQuietHours(userData.notificationPreferences?.quietHours)) {
        console.log(`Skipping ${userDoc.id} - in quiet hours`);
        continue;
      }
      
      // Check global notifications enabled AND specific preference
      // Support both 'lineupChanges' (new) and 'lineupUpdates' (legacy)
      const prefs = userData.notificationPreferences || {};
      let preferenceEnabled = false;
      
      if (preferenceKey === 'lineupChanges') {
        // Check both possible field names for lineup notifications
        preferenceEnabled = prefs.lineupChanges !== false && 
                          prefs.lineupUpdates?.enabled !== false;
      } else {
        // For other preferences, check normally
        preferenceEnabled = prefs[preferenceKey] !== false;
      }
      
      if (userData.notificationsEnabled !== false && preferenceEnabled) {
        const fcmTokens = userData.fcmTokens || [];
        tokens.push(...fcmTokens);
      }
    }
  }
  
  return [...new Set(tokens)]; // Remove duplicates
}

/**
 * Get FCM tokens for users who favorited specified teams
 */
async function getFavoriteTeamTokens(teamIds) {
  const tokens = [];
  
  const usersSnapshot = await db
    .collection('users')
    .where('favoriteTeams', 'array-contains-any', teamIds.slice(0, 10)) // Firestore limit
    .get();
  
  usersSnapshot.forEach(doc => {
    const userData = doc.data();
    if (userData.notificationsEnabled !== false && 
        userData.notificationPreferences?.scoreUpdates !== false) {
      const fcmTokens = userData.fcmTokens || [];
      tokens.push(...fcmTokens);
    }
  });
  
  return tokens;
}

/**
 * Get all FCM tokens for users who have announcements enabled
 * @returns {Array} Array of tokens
 */
async function getAllAnnouncementTokens() {
  const tokens = [];
  
  const usersSnapshot = await db
    .collection('users')
    .where('notificationsEnabled', '==', true)
    .get();
  
  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    
    // Check quiet hours
    if (isInQuietHours(userData.notificationPreferences?.quietHours)) {
      console.log(`Skipping ${userDoc.id} - in quiet hours`);
      continue;
    }
    
    // Check if user wants announcements (default true)
    if (userData.notificationPreferences?.announcements !== false) {
      const fcmTokens = userData.fcmTokens || [];
      tokens.push(...fcmTokens);
    }
  }
  
  return [...new Set(tokens)]; // Remove duplicates
}

/**
 * Send notification to multiple tokens with error handling
 */
async function sendToTokens(tokens, message) {
  if (tokens.length === 0) {
    console.log('No tokens to send to');
    return { successCount: 0, failureCount: 0 };
  }
  
  // CRITICAL: Clean and validate tokens (remove whitespace, ensure strings)
  const cleanedTokens = tokens
    .filter(token => token && typeof token === 'string') // Remove null/undefined
    .map(token => token.trim()) // Remove whitespace
    .filter(token => token.length > 0); // Remove empty strings
  
  if (cleanedTokens.length === 0) {
    console.log('No valid tokens after cleaning');
    return { successCount: 0, failureCount: 0 };
  }
  
  console.log(`Sending to ${cleanedTokens.length} tokens`);
  console.log('First token sample:', cleanedTokens[0].substring(0, 50) + '...');
  
  // CRITICAL: Ensure all data values are strings (FCM requirement)
  const sanitizedData = {};
  if (message.data) {
    Object.keys(message.data).forEach(key => {
      sanitizedData[key] = String(message.data[key]);
    });
  }
  
  // Send individually (avoid /batch endpoint 404 error)
  // Note: sendMulticast() fails with 404 on /batch endpoint
  let successCount = 0;
  let failureCount = 0;
  
  for (const token of cleanedTokens) {
    try {
      // Use individual send() instead of sendMulticast()
      const messageWithToken = {
        token: token,
        notification: message.notification,
        data: sanitizedData,  // Use sanitized data with all strings
        webpush: message.webpush
      };
      
      const messageId = await messaging.send(messageWithToken);
      console.log(`✅ Token succeeded, message ID:`, messageId.substring(0, 20) + '...');
      successCount++;
      
    } catch (error) {
      console.error(`❌ Token failed:`, error.code, error.message);
      console.error(`   Token (first 50 chars):`, token.substring(0, 50));
      failureCount++;
      
      // Log if token should be cleaned up
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        console.log(`   Token should be removed from user profile`);
      }
    }
  }
  
  console.log(`Sent: ${successCount} success, ${failureCount} failed`);
  return { successCount, failureCount };
}

/**
 * Save notification to user's feed in Firestore
 * This allows notifications to persist and be displayed in the dashboard
 * @param {string[]} userIds - Array of user IDs to save notification for
 * @param {Object} notification - Notification details
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body text
 * @param {string} notification.type - Type: game_reminder, score_update, schedule_change, lineup_change, announcement, milestone, rsvp_reminder
 * @param {string} [notification.link] - Optional URL to navigate to when clicked
 * @param {Object} [notification.metadata] - Optional extra data (gameId, teamId, etc.)
 */
async function saveNotificationToFeed(userIds, notification) {
  if (!userIds || userIds.length === 0) {
    console.log('No users to save notification for');
    return;
  }

  const batch = db.batch();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  for (const userId of userIds) {
    const notifRef = db
      .collection('users')
      .doc(userId)
      .collection('notifications')
      .doc(); // Auto-generate ID

    batch.set(notifRef, {
      title: notification.title || 'Notification',
      body: notification.body || '',
      type: notification.type || 'announcement',
      link: notification.link || null,
      metadata: notification.metadata || {},
      read: false,
      createdAt: timestamp
    });
  }

  try {
    await batch.commit();
    console.log(`📥 Saved notification to ${userIds.length} user feeds`);
  } catch (error) {
    console.error('Error saving notifications to feed:', error);
    // Don't throw - notification feed is supplementary to push notifications
  }
}

/**
 * Get user IDs from tokens (for saving to notification feed)
 * @param {string} teamId - Team to get users for
 * @param {string} [preference] - Optional preference to check
 * @returns {Promise<string[]>} Array of user IDs
 */
async function getTeamUserIds(teamId, preference = null) {
  const userIds = [];
  const normalizedTeamId = teamId.charAt(0).toUpperCase() + teamId.slice(1).toLowerCase();
  
  const usersSnapshot = await db
    .collection('users')
    .where('linkedTeam', 'in', [teamId, teamId.toLowerCase(), normalizedTeamId])
    .get();

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    
    // Check if user has notifications enabled
    if (userData.notificationsEnabled === false) continue;
    
    // Check quiet hours
    if (isInQuietHours(userData.notificationPreferences?.quietHours)) continue;
    
    // Check specific preference if provided
    if (preference) {
      const prefEnabled = userData.notificationPreferences?.[preference] !== false;
      if (!prefEnabled) continue;
    }
    
    userIds.push(userDoc.id);
  }
  
  return userIds;
}

/**
 * Get user IDs who receive announcements (for saving to notification feed)
 * @returns {Promise<string[]>} Array of user IDs
 */
async function getAnnouncementUserIds() {
  const userIds = [];
  
  const usersSnapshot = await db
    .collection('users')
    .where('notificationsEnabled', '==', true)
    .get();

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    
    // Check quiet hours
    if (isInQuietHours(userData.notificationPreferences?.quietHours)) {
      continue;
    }
    
    // Check if user wants announcements (default true)
    if (userData.notificationPreferences?.announcements !== false) {
      userIds.push(userDoc.id);
    }
  }
  
  return userIds;
}

// ============================================================================
// 1. LINEUP CHANGES (Triggered when lineup is updated)
// ============================================================================

exports.sendLineupChange = functions.firestore
  .document('seasons/{seasonId}/games/{gameId}/lineups/{teamId}')
  .onWrite(async (change, context) => {
    const seasonId = context.params.seasonId;
    const gameId = context.params.gameId;
    const teamId = context.params.teamId;
    
    // Get the lineup data
    const after = change.after.exists ? change.after.data() : null;
    
    if (!after) {
      console.log('Lineup deleted - no notification needed');
      return null;
    }
    
    console.log(`📋 Lineup changed for ${teamId} in game ${gameId}`);
    
    // Get the game details
    const gameDoc = await db
      .collection('seasons')
      .doc(seasonId)
      .collection('games')
      .doc(gameId)
      .get();
    
    if (!gameDoc.exists) {
      console.log('Game not found');
      return null;
    }
    
    const game = gameDoc.data();
    
    // Get tokens for this team (only those who want lineup notifications)
    const tokens = await getTeamPlayerTokensWithPreference([teamId], 'lineupChanges');
    
    if (tokens.length === 0) {
      console.log('No tokens to notify');
      return null;
    }
    
    // Format team name
    const teamName = teamId.charAt(0).toUpperCase() + teamId.slice(1);
    
    // Determine if this is a playoff game
    const isPlayoff = isPlayoffGame(gameId);
    const gameTypeEmoji = isPlayoff ? '🏆 ' : '';
    
    // Determine opponent
    const opponent = game.homeTeamId === teamId ? game.awayTeamName : game.homeTeamName;
    
    const message = {
      notification: {
        title: `📋 ${teamName} Lineup Posted`,
        body: `${gameTypeEmoji}Lineup is set for the game vs ${opponent}. Check your position!`
      },
      data: {
        type: 'lineup_change',
        seasonId: seasonId,
        gameId: gameId,
        teamId: teamId,
        isPlayoff: String(isPlayoff),
        clickAction: `/roster-management.html?game=${gameId}`
      },
      webpush: {
        fcmOptions: {
          link: `/roster-management.html?game=${gameId}`
        }
      }
    };
    
    await sendToTokens(tokens, message);
    
    // Save to notification feed for users on this team
    const userIds = await getTeamUserIds(teamId, 'lineupChanges');
    await saveNotificationToFeed(userIds, {
      title: message.notification.title,
      body: message.notification.body,
      type: 'lineup_change',
      link: `/roster-management.html?game=${gameId}`,
      metadata: { seasonId, gameId, teamId, isPlayoff }
    });
    
    return null;
  });

// ============================================================================
// 2. SCORE UPDATES (Triggered when game score changes)
// ============================================================================

exports.sendScoreUpdate = functions.firestore
  .document('seasons/{seasonId}/games/{gameId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const seasonId = context.params.seasonId;
    const gameId = context.params.gameId;
    
    // Only send notification if score changed
    if (before.homeScore === after.homeScore && before.awayScore === after.awayScore) {
      return null;
    }
    
    // Check if this was a game completion (winner now set)
    const isGameComplete = !before.winner && after.winner;
    
    console.log(`⚾ Score update: ${after.homeTeamName} ${after.homeScore} - ${after.awayTeamName} ${after.awayScore}`);
    
    // Get tokens for both teams
    const teamTokens = await getTeamPlayerTokensWithPreference(
      [after.homeTeamId, after.awayTeamId], 
      'scoreUpdates'
    );
    
    // Also get tokens for users who favorited these teams
    const favoriteTokens = await getFavoriteTeamTokens([after.homeTeamId, after.awayTeamId]);
    
    const allTokens = [...new Set([...teamTokens, ...favoriteTokens])];
    
    if (allTokens.length === 0) {
      console.log('No tokens to notify');
      return null;
    }
    
    // Determine if this is a playoff game
    const isPlayoff = isPlayoffGame(gameId);
    const gameTypeEmoji = isPlayoff ? '🏆 ' : '';
    
    let title, body;
    
    if (isGameComplete) {
      const winnerName = after.winner.charAt(0).toUpperCase() + after.winner.slice(1);
      title = `${gameTypeEmoji}⚾ Final Score`;
      body = `${after.homeTeamName} ${after.homeScore} - ${after.awayTeamName} ${after.awayScore}. ${winnerName} wins!`;
    } else {
      title = `${gameTypeEmoji}⚾ Score Update`;
      body = `${after.homeTeamName} ${after.homeScore} - ${after.awayTeamName} ${after.awayScore}`;
    }
    
    const message = {
      notification: { title, body },
      data: {
        type: 'score_update',
        seasonId: seasonId,
        gameId: gameId,
        homeScore: String(after.homeScore),
        awayScore: String(after.awayScore),
        isComplete: String(isGameComplete),
        isPlayoff: String(isPlayoff),
        clickAction: `/game-tracker.html?game=${gameId}`
      },
      webpush: {
        fcmOptions: {
          link: `/game-tracker.html?game=${gameId}`
        }
      }
    };
    
    await sendToTokens(allTokens, message);
    
    // Save to notification feed for users on both teams
    const homeUserIds = await getTeamUserIds(after.homeTeamId, 'scoreUpdates');
    const awayUserIds = await getTeamUserIds(after.awayTeamId, 'scoreUpdates');
    const allUserIds = [...new Set([...homeUserIds, ...awayUserIds])];
    
    await saveNotificationToFeed(allUserIds, {
      title,
      body,
      type: 'score_update',
      link: `/game-tracker.html?game=${gameId}`,
      metadata: { seasonId, gameId, homeScore: after.homeScore, awayScore: after.awayScore, isComplete: isGameComplete, isPlayoff }
    });
    
    return null;
  });

// ============================================================================
// 3. PLAYER MILESTONES (Triggered when player stats update)
// ============================================================================

exports.checkPlayerMilestone = functions.firestore
  .document('aggregatedPlayerStats/{playerId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const playerId = context.params.playerId;
    
    // Check for milestone thresholds
    const milestones = [];
    
    // Hits milestones
    const hitsMilestones = [50, 100, 150, 200, 250, 300];
    for (const milestone of hitsMilestones) {
      if (before.career?.hits < milestone && after.career?.hits >= milestone) {
        milestones.push({
          type: 'hits',
          value: milestone,
          stat: after.career.hits
        });
      }
    }
    
    // Runs milestones
    const runsMilestones = [25, 50, 75, 100, 150, 200];
    for (const milestone of runsMilestones) {
      if (before.career?.runs < milestone && after.career?.runs >= milestone) {
        milestones.push({
          type: 'runs',
          value: milestone,
          stat: after.career.runs
        });
      }
    }
    
    // Games milestones
    const gamesMilestones = [25, 50, 75, 100, 150];
    for (const milestone of gamesMilestones) {
      if (before.career?.games < milestone && after.career?.games >= milestone) {
        milestones.push({
          type: 'games',
          value: milestone,
          stat: after.career.games
        });
      }
    }
    
    if (milestones.length === 0) {
      return null;
    }
    
    console.log(`🎯 Milestone reached for ${after.playerName}: ${milestones.map(m => `${m.value} ${m.type}`).join(', ')}`);
    
    // Get the player's user account if linked
    const playerLinksSnapshot = await db
      .collection('playerLinks')
      .where('playerId', '==', playerId)
      .where('status', '==', 'approved')
      .limit(1)
      .get();
    
    if (playerLinksSnapshot.empty) {
      console.log('Player not linked to user account');
      return null;
    }
    
    const playerLink = playerLinksSnapshot.docs[0].data();
    const userDoc = await db.collection('users').doc(playerLink.userId).get();
    
    if (!userDoc.exists) {
      console.log('User not found');
      return null;
    }
    
    const userData = userDoc.data();
    
    // Check notification preferences
    if (userData.notificationsEnabled === false || 
        userData.notificationPreferences?.milestones === false) {
      console.log('User has milestones notifications disabled');
      return null;
    }
    
    const fcmTokens = userData.fcmTokens || [];
    if (fcmTokens.length === 0) {
      console.log('User has no FCM tokens');
      return null;
    }
    
    // Send notification for each milestone
    for (const milestone of milestones) {
      const typeText = milestone.type.charAt(0).toUpperCase() + milestone.type.slice(1);
      
      const message = {
        notification: {
          title: `🎯 Milestone Reached!`,
          body: `Congratulations! You've reached ${milestone.value} career ${milestone.type}!`
        },
        data: {
          type: 'milestone',
          playerId: playerId,
          milestoneType: milestone.type,
          milestoneValue: String(milestone.value),
          currentStat: String(milestone.stat),
          clickAction: `/player.html?id=${playerId}`
        },
        webpush: {
          fcmOptions: {
            link: `/player.html?id=${playerId}`
          }
        }
      };
      
      await sendToTokens(fcmTokens, message);
      
      // Save to notification feed for this user
      await saveNotificationToFeed([playerLink.userId], {
        title: message.notification.title,
        body: message.notification.body,
        type: 'milestone',
        link: `/player.html?id=${playerId}`,
        metadata: { playerId, milestoneType: milestone.type, milestoneValue: milestone.value }
      });
    }
    
    return null;
  });

// ============================================================================
// 4. GAME REMINDERS (Scheduled function - runs daily at 9 AM)
// ============================================================================

exports.sendGameReminders = functions.pubsub
  .schedule('0 9 * * *')  // 9 AM daily
  .timeZone('America/New_York')
  .onRun(async (context) => {
    console.log('⏰ Running daily game reminders...');
    
    // Get current season
    const currentSeason = await getCurrentSeason();
    if (!currentSeason) {
      console.log('No active season');
      return null;
    }
    
    // Get games for tomorrow
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);
    
    console.log(`Looking for games between ${tomorrow.toISOString()} and ${dayAfter.toISOString()}`);
    
    // Query games for tomorrow
    const gamesSnapshot = await db
      .collection('seasons')
      .doc(currentSeason.id)
      .collection('games')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(tomorrow))
      .where('date', '<', admin.firestore.Timestamp.fromDate(dayAfter))
      .get();
    
    if (gamesSnapshot.empty) {
      console.log('No games scheduled for tomorrow');
      return null;
    }
    
    console.log(`Found ${gamesSnapshot.size} games for tomorrow`);
    
    // Send reminders for each game
    for (const gameDoc of gamesSnapshot.docs) {
      const game = gameDoc.data();
      const gameId = gameDoc.id;
      
      console.log(`Processing game: ${game.homeTeamName} vs ${game.awayTeamName}`);
      
      // Get tokens for both teams
      const tokens = await getTeamPlayerTokensWithPreference(
        [game.homeTeamId, game.awayTeamId], 
        'gameReminders'
      );
      
      if (tokens.length === 0) {
        console.log('No tokens for this game');
        continue;
      }
      
      // Format game time
      const gameDate = game.date.toDate();
      const timeString = gameDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      // Determine if this is a playoff game
      const isPlayoff = isPlayoffGame(gameId);
      const gameTypeEmoji = isPlayoff ? '🏆 ' : '';
      
      const message = {
        notification: {
          title: '⏰ Game Tomorrow!',
          body: `${gameTypeEmoji}${game.homeTeamName} vs ${game.awayTeamName} at ${timeString}`
        },
        data: {
          type: 'game_reminder',
          seasonId: currentSeason.id,
          gameId: gameDoc.id,
          isPlayoff: String(isPlayoff),
          clickAction: `/roster-management.html?game=${gameDoc.id}`
        },
        webpush: {
          fcmOptions: {
            link: `/roster-management.html?game=${gameDoc.id}`
          }
        }
      };
      
      await sendToTokens(tokens, message);
      
      // Save to notification feed for users on both teams
      const homeUserIds = await getTeamUserIds(game.homeTeamId, 'gameReminders');
      const awayUserIds = await getTeamUserIds(game.awayTeamId, 'gameReminders');
      const allUserIds = [...new Set([...homeUserIds, ...awayUserIds])];
      
      await saveNotificationToFeed(allUserIds, {
        title: message.notification.title,
        body: message.notification.body,
        type: 'game_reminder',
        link: `/roster-management.html?game=${gameDoc.id}`,
        metadata: { seasonId: currentSeason.id, gameId: gameDoc.id, isPlayoff }
      });
    }
    
    return null;
  });

// ============================================================================
// 5. RSVP REMINDERS (Runs twice daily for upcoming games)
// ============================================================================

exports.sendRsvpReminders = functions.pubsub
  .schedule('0 10,18 * * *')  // 10 AM and 6 PM daily
  .timeZone('America/New_York')
  .onRun(async (context) => {
    console.log('📋 Checking for RSVP reminders...');
    
    const currentSeason = await getCurrentSeason();
    if (!currentSeason) {
      console.log('No active season');
      return null;
    }
    
    // Get games in the next 3 days
    const now = new Date();
    const threeDaysOut = new Date(now);
    threeDaysOut.setDate(threeDaysOut.getDate() + 3);
    
    const gamesSnapshot = await db
      .collection('seasons')
      .doc(currentSeason.id)
      .collection('games')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(now))
      .where('date', '<', admin.firestore.Timestamp.fromDate(threeDaysOut))
      .get();
    
    if (gamesSnapshot.empty) {
      console.log('No upcoming games in next 3 days');
      return null;
    }
    
    console.log(`Found ${gamesSnapshot.size} games in next 3 days`);
    
    for (const gameDoc of gamesSnapshot.docs) {
      const game = gameDoc.data();
      const gameId = gameDoc.id;
      
      console.log(`Processing RSVPs for: ${game.homeTeamName || game.homeTeam} vs ${game.awayTeamName || game.awayTeam}`);
      
      // Get all RSVPs for this game
      const rsvpsSnapshot = await db
        .collection('rsvps')
        .doc(gameId)
        .collection('responses')
        .get();
      
      const rsvpdUserIds = new Set();
      rsvpsSnapshot.forEach(doc => {
        rsvpdUserIds.add(doc.id);
      });
      
      console.log(`${rsvpdUserIds.size} players have RSVP'd`);
      
      // Get all players on both teams
      const homeLinksSnapshot = await db
        .collection('playerLinks')
        .where('teamId', '==', game.homeTeamId)
        .where('status', '==', 'approved')
        .get();
      
      const awayLinksSnapshot = await db
        .collection('playerLinks')
        .where('teamId', '==', game.awayTeamId)
        .where('status', '==', 'approved')
        .get();
      
      // Find players who haven't RSVP'd
      const needsRSVP = [];
      
      for (const linkDoc of [...homeLinksSnapshot.docs, ...awayLinksSnapshot.docs]) {
        const userId = linkDoc.data().userId;
        
        // Skip if already RSVP'd
        if (rsvpdUserIds.has(userId)) {
          continue;
        }
        
        // Get user and check notification preferences
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
          continue;
        }
        
        const userData = userDoc.data();
        
        // Check if user wants RSVP reminders
        if (userData.notificationsEnabled !== false && 
            userData.notificationPreferences?.rsvpReminders !== false) {
          const fcmTokens = userData.fcmTokens || [];
          if (fcmTokens.length > 0) {
            needsRSVP.push({
              userId,
              tokens: fcmTokens,
              playerName: linkDoc.data().playerName
            });
          }
        }
      }
      
      console.log(`${needsRSVP.length} players need RSVP reminder`);
      
      if (needsRSVP.length === 0) {
        continue;
      }
      
      // Calculate game timing for message
      const gameDate = game.date.toDate();
      const hoursUntil = Math.round((gameDate - new Date()) / (1000 * 60 * 60));
      const timeText = hoursUntil < 24 ? 
        `tomorrow` : 
        `in ${Math.round(hoursUntil / 24)} days`;
      
      // Determine if this is a playoff game
      const isPlayoff = isPlayoffGame(gameId);
      const gameTypeEmoji = isPlayoff ? '🏆 ' : '';
      
      // Send reminders
      for (const player of needsRSVP) {
        const message = {
          notification: {
            title: '📋 RSVP Reminder',
            body: `${gameTypeEmoji}Don't forget to RSVP for ${game.homeTeamName || game.homeTeam} vs ${game.awayTeamName || game.awayTeam} ${timeText}!`
          },
          data: {
            type: 'rsvp_reminder',
            seasonId: currentSeason.id,
            gameId: gameId,
            isPlayoff: String(isPlayoff),
            clickAction: `/roster-management.html?game=${gameId}`
          },
          webpush: {
            fcmOptions: {
              link: `/roster-management.html?game=${gameId}`
            }
          }
        };
        
        await sendToTokens(player.tokens, message);
        
        // Save to notification feed for this specific user
        await saveNotificationToFeed([player.userId], {
          title: message.notification.title,
          body: message.notification.body,
          type: 'rsvp_reminder',
          link: `/roster-management.html?game=${gameId}`,
          metadata: { seasonId: currentSeason.id, gameId, isPlayoff }
        });
      }
    }
    
    return null;
  });

// ============================================================================
// 6. SCHEDULE CHANGES (Triggered when preview details change)
// ============================================================================

exports.sendScheduleChange = functions.firestore
  .document('seasons/{seasonId}/previews/{gameId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const seasonId = context.params.seasonId;
    const gameId = context.params.gameId;
    
    // Get the actual game document for team info
    const gameDoc = await db
      .collection('seasons')
      .doc(seasonId)
      .collection('games')
      .doc(gameId)
      .get();
    
    if (!gameDoc.exists) {
      console.log('Game not found');
      return null;
    }
    
    const game = gameDoc.data();
    
    // Helper function to format dates and timestamps
    function formatValue(value) {
      if (!value) return 'TBD';
      
      // Check if it's a Firestore Timestamp
      if (value && typeof value.toDate === 'function') {
        try {
          const date = value.toDate();
          return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
          });
        } catch (error) {
          console.error('Error formatting timestamp:', error);
          return 'TBD';
        }
      }
      
      // If it's already a string, return it
      return String(value);
    }
    
    // Check what changed in the preview
    const changes = [];
    
    // Date changed (handle both Timestamp objects and strings)
    const beforeDateStr = JSON.stringify(before.date);
    const afterDateStr = JSON.stringify(after.date);
    if (beforeDateStr !== afterDateStr) {
      changes.push(`Date: ${formatValue(before.date)} → ${formatValue(after.date)}`);
    }
    
    // Time changed
    if (before.time !== after.time) {
      changes.push(`Time: ${formatValue(before.time)} → ${formatValue(after.time)}`);
    }
    
    // Location changed
    if (before.location !== after.location) {
      changes.push(`Location: ${formatValue(before.location)} → ${formatValue(after.location)}`);
    }
    
    // Field changed
    if (before.field !== after.field) {
      changes.push(`Field: ${formatValue(before.field)} → ${formatValue(after.field)}`);
    }
    
    // Opponent changed (rare but possible)
    if (before.homeTeam !== after.homeTeam || before.awayTeam !== after.awayTeam) {
      changes.push(`Matchup changed`);
    }
    
    // If nothing relevant changed, don't send notification
    if (changes.length === 0) {
      return null;
    }
    
    console.log(`📅 Schedule changed for ${game.homeTeamName} vs ${game.awayTeamName}: ${changes.join(', ')}`);
    
    // Get tokens for both teams (only those who want schedule change notifications)
    const tokens = await getTeamPlayerTokensWithPreference(
      [game.homeTeamId, game.awayTeamId], 
      'scheduleChanges'
    );
    
    if (tokens.length === 0) {
      console.log('No tokens to notify');
      return null;
    }
    
    // Determine if this is a playoff game
    const isPlayoff = isPlayoffGame(gameId);
    const gameTypeEmoji = isPlayoff ? '🏆 ' : '';
    
    const message = {
      notification: {
        title: '📅 Game Schedule Changed',
        body: `${gameTypeEmoji}${after.homeTeam} vs ${after.awayTeam} - ${changes[0]}`
      },
      data: {
        type: 'schedule_change',
        seasonId: seasonId,
        gameId: gameId,
        changes: changes.join('; '),
        isPlayoff: String(isPlayoff),
        clickAction: `/roster-management.html?game=${gameId}`
      },
      webpush: {
        fcmOptions: {
          link: `/roster-management.html?game=${gameId}`
        }
      }
    };
    
    await sendToTokens(tokens, message);
    
    // Save to notification feed for users on both teams
    const homeUserIds = await getTeamUserIds(game.homeTeamId, 'scheduleChanges');
    const awayUserIds = await getTeamUserIds(game.awayTeamId, 'scheduleChanges');
    const allUserIds = [...new Set([...homeUserIds, ...awayUserIds])];
    
    await saveNotificationToFeed(allUserIds, {
      title: message.notification.title,
      body: message.notification.body,
      type: 'schedule_change',
      link: `/roster-management.html?game=${gameId}`,
      metadata: { seasonId, gameId, changes: changes.join('; '), isPlayoff }
    });
    
    return null;
  });

// ============================================================================
// 7. LEAGUE ANNOUNCEMENTS (Callable function for admins)
// ============================================================================

/**
 * Send a league-wide announcement
 * Callable by admins and league staff only
 * 
 * @param {Object} data - { title, body, link?, priority? }
 * @param {Object} context - Firebase callable context
 */
exports.sendAnnouncement = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be signed in to send announcements.'
    );
  }
  
  const userId = context.auth.uid;
  
  // Verify admin, league-staff, or captain role
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'User profile not found.'
    );
  }
  
  const userData = userDoc.data();
  const userRole = userData.role || userData.userRole || 'fan';
  const isCaptain = userData.isCaptain === true || userRole === 'captain';
  const allowedRoles = ['admin', 'league-staff'];
  
  // Captains can send, but only to specific recipients (enforced below)
  if (!allowedRoles.includes(userRole) && !isCaptain) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins, league staff, and captains can send announcements.'
    );
  }
  
  // Validate required fields
  const { title, body, link, priority, recipientUserIds } = data;
  
  // Captains MUST specify recipients (can't send to everyone)
  if (isCaptain && !allowedRoles.includes(userRole) && (!recipientUserIds || recipientUserIds.length === 0)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Captains must specify recipients.'
    );
  }
  
  if (!title || !body) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Title and body are required.'
    );
  }
  
  if (title.length > 100) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Title must be 100 characters or less.'
    );
  }
  
  if (body.length > 500) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Body must be 500 characters or less.'
    );
  }
  
  console.log(`📢 Sending announcement from ${userData.displayName || userId}: "${title}"`);
  
  // Get tokens based on whether specific recipients are provided
  let tokens = [];
  let targetUserIds = [];
  
  if (recipientUserIds && recipientUserIds.length > 0) {
    // Send to specific users only
    console.log(`Filtering to ${recipientUserIds.length} specific recipients`);
    targetUserIds = recipientUserIds;
    
    // Get tokens for specific users
    for (const recipientId of recipientUserIds) {
      const recipientDoc = await db.collection('users').doc(recipientId).get();
      if (!recipientDoc.exists) continue;
      
      const recipientData = recipientDoc.data();
      
      // Check if user has notifications enabled and wants announcements
      if (recipientData.notificationsEnabled !== false && 
          recipientData.notificationPreferences?.announcements !== false) {
        const fcmTokens = recipientData.fcmTokens || [];
        tokens.push(...fcmTokens);
      }
    }
  } else {
    // Send to all users with announcements enabled (league-wide)
    console.log('Sending to all users with announcements enabled');
    tokens = await getAllAnnouncementTokens();
    targetUserIds = await getAnnouncementUserIds();
  }
  
  if (tokens.length === 0) {
    console.log('No tokens to notify');
    return { 
      success: true, 
      message: 'Announcement created but no users to notify.',
      recipientCount: 0 
    };
  }
  
  console.log(`Found ${tokens.length} tokens to notify`);
  
  // Determine click action
  const clickAction = link || '/index.html';
  
  // Determine emoji based on priority
  let emoji = '📢';
  if (priority === 'urgent') {
    emoji = '🚨';
  } else if (priority === 'info') {
    emoji = 'ℹ️';
  }
  
  const message = {
    notification: {
      title: `${emoji} ${title}`,
      body: body
    },
    data: {
      type: 'announcement',
      priority: priority || 'normal',
      sentBy: userId,
      sentByName: userData.displayName || 'League Admin',
      timestamp: new Date().toISOString(),
      clickAction: clickAction
    },
    webpush: {
      fcmOptions: {
        link: clickAction
      }
    }
  };
  
  const result = await sendToTokens(tokens, message);
  
  // Save to notification feed for targeted users only
  await saveNotificationToFeed(targetUserIds, {
    title: `${emoji} ${title}`,
    body: body,
    type: 'announcement',
    link: clickAction,
    metadata: { sentBy: userId, sentByName: userData.displayName || 'League Admin', priority: priority || 'normal' }
  });
  
  // Log the announcement to Firestore for history
  await db.collection('announcements').add({
    title: title,
    body: body,
    link: link || null,
    priority: priority || 'normal',
    sentBy: userId,
    sentByName: userData.displayName || 'League Admin',
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    recipientCount: result.successCount,
    failureCount: result.failureCount,
    targetedUserCount: targetUserIds.length,
    wasFiltered: recipientUserIds && recipientUserIds.length > 0
  });
  
  console.log(`✅ Announcement sent: ${result.successCount} success, ${result.failureCount} failed (targeted ${targetUserIds.length} users)`);
  
  return {
    success: true,
    message: `Announcement sent to ${result.successCount} of ${targetUserIds.length} targeted users.`,
    recipientCount: result.successCount,
    failureCount: result.failureCount,
    targetedUserCount: targetUserIds.length
  };
});

// ============================================================================
// 8. TEST NOTIFICATION (Callable function for users to test their setup)
// ============================================================================

/**
 * Send a test notification to the current user
 * Allows users to verify their notification setup is working
 * 
 * @param {Object} data - { token? } - Optional specific token to test
 * @param {Object} context - Firebase callable context
 */
exports.testNotification = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be signed in to test notifications.'
    );
  }
  
  const userId = context.auth.uid;
  
  // Get user's FCM tokens
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError(
      'not-found',
      'User profile not found.'
    );
  }
  
  const userData = userDoc.data();
  
  // Check if notifications are enabled
  if (userData.notificationsEnabled === false) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Notifications are disabled for your account. Please enable them first.'
    );
  }
  
  // Get tokens - either specific token from request or all user tokens
  let tokensToTest = [];
  
  if (data && data.token) {
    // Test specific token
    tokensToTest = [data.token];
  } else {
    // Test all user tokens
    tokensToTest = userData.fcmTokens || [];
  }
  
  if (tokensToTest.length === 0) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'No FCM tokens found. Please enable notifications in your browser first.'
    );
  }
  
  console.log(`🧪 Sending test notification to ${userData.displayName || userId} (${tokensToTest.length} tokens)`);
  
  const message = {
    notification: {
      title: '🧪 Test Notification',
      body: `Success! Notifications are working for ${userData.displayName || 'your account'}.`
    },
    data: {
      type: 'test',
      timestamp: new Date().toISOString(),
      clickAction: '/profile.html'
    },
    webpush: {
      fcmOptions: {
        link: '/profile.html'
      }
    }
  };
  
  const result = await sendToTokens(tokensToTest, message);
  
  // If some tokens failed, clean them up
  if (result.failureCount > 0) {
    console.log(`Cleaning up ${result.failureCount} failed tokens for user ${userId}`);
    // Note: In production, you might want to remove invalid tokens here
  }
  
  if (result.successCount === 0) {
    throw new functions.https.HttpsError(
      'internal',
      'Failed to send test notification. Your tokens may be invalid. Try disabling and re-enabling notifications.'
    );
  }
  
  console.log(`✅ Test notification sent: ${result.successCount} success, ${result.failureCount} failed`);
  
  return {
    success: true,
    message: `Test notification sent successfully!`,
    successCount: result.successCount,
    failureCount: result.failureCount
  };
});

// ============================================================================
// 9. CALENDAR SUBSCRIPTION (HTTP endpoint for iCal feeds)
// ============================================================================

// League configuration for calendar
const LEAGUE_CONFIG = {
  name: 'Mountainside Aces Softball',
  timezone: 'America/New_York',
  defaultLocation: 'Mountainside, NJ',
  prodId: '-//Mountainside Aces//Softball Schedule//EN'
};

/**
 * Calendar endpoint - generates dynamic iCal feeds
 * 
 * Usage:
 *   GET /calendar              - All games for current season
 *   GET /calendar?team=orange  - Specific team's games
 *   GET /calendar?season=2025-fall - Specific season
 */
exports.calendar = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  try {
    const { team, season } = req.query;
    
    // Determine which season to fetch
    let seasonId = season;
    if (!seasonId) {
      // Find the active season
      const seasonsSnap = await db.collection('seasons')
        .where('isActive', '==', true)
        .limit(1)
        .get();
      
      if (seasonsSnap.empty) {
        // Fallback to most recent season
        const allSeasons = await db.collection('seasons')
          .orderBy('year', 'desc')
          .limit(1)
          .get();
        
        if (allSeasons.empty) {
          res.status(404).send('No seasons found');
          return;
        }
        seasonId = allSeasons.docs[0].id;
      } else {
        seasonId = seasonsSnap.docs[0].id;
      }
    }
    
    console.log(`📅 Generating calendar for season: ${seasonId}, team: ${team || 'all'}`);
    
    // Fetch games
    const gamesRef = db.collection('seasons').doc(seasonId).collection('games');
    const gamesSnap = await gamesRef.get();
    
    let games = [];
    gamesSnap.forEach(doc => {
      const data = doc.data();
      games.push({
        id: doc.id,
        ...data
      });
    });
    
    // Filter by team if specified
    if (team) {
      const teamLower = team.toLowerCase();
      games = games.filter(g => {
        const homeTeam = (g.homeTeamId || g.homeTeamName || g['home team'] || '').toLowerCase();
        const awayTeam = (g.awayTeamId || g.awayTeamName || g['away team'] || '').toLowerCase();
        return homeTeam.includes(teamLower) || awayTeam.includes(teamLower);
      });
    }
    
    // Sort by date
    games.sort((a, b) => {
      const dateA = getGameTimestamp(a);
      const dateB = getGameTimestamp(b);
      return dateA - dateB;
    });
    
    // Generate iCal
    const icalContent = generateICal(games, seasonId, team);
    
    // Set headers for calendar subscription
    const filename = team 
      ? `aces-${team.toLowerCase()}-${seasonId}.ics`
      : `aces-${seasonId}.ics`;
    
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    res.status(200).send(icalContent);
    
  } catch (error) {
    console.error('❌ Calendar generation error:', error);
    res.status(500).send('Error generating calendar');
  }
});

// Calendar helper functions
function getGameTimestamp(game) {
  if (game.date?.seconds) {
    return game.date.seconds * 1000;
  } else if (game.date && typeof game.date === 'string') {
    return new Date(game.date).getTime();
  }
  return 0;
}

function generateICal(games, seasonId, teamFilter) {
  const lines = [];
  
  // Calendar header
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push(`PRODID:${LEAGUE_CONFIG.prodId}`);
  lines.push(`X-WR-CALNAME:${teamFilter ? `Aces ${capitalize(teamFilter)} Schedule` : 'Mountainside Aces Schedule'}`);
  lines.push(`X-WR-TIMEZONE:${LEAGUE_CONFIG.timezone}`);
  lines.push('METHOD:PUBLISH');
  lines.push('CALSCALE:GREGORIAN');
  
  // Timezone definition
  lines.push('BEGIN:VTIMEZONE');
  lines.push('TZID:America/New_York');
  lines.push('BEGIN:DAYLIGHT');
  lines.push('TZOFFSETFROM:-0500');
  lines.push('TZOFFSETTO:-0400');
  lines.push('TZNAME:EDT');
  lines.push('DTSTART:19700308T020000');
  lines.push('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
  lines.push('END:DAYLIGHT');
  lines.push('BEGIN:STANDARD');
  lines.push('TZOFFSETFROM:-0400');
  lines.push('TZOFFSETTO:-0500');
  lines.push('TZNAME:EST');
  lines.push('DTSTART:19701101T020000');
  lines.push('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
  lines.push('END:STANDARD');
  lines.push('END:VTIMEZONE');
  
  // Add each game as an event
  games.forEach(game => {
    const event = generateGameEvent(game, seasonId, teamFilter);
    if (event) {
      lines.push(...event);
    }
  });
  
  lines.push('END:VCALENDAR');
  
  return lines.join('\r\n');
}

function generateGameEvent(game, seasonId, teamFilter) {
  const lines = [];
  
  // Get team names
  const homeTeam = game.homeTeamName || game['home team'] || capitalize(game.homeTeamId || 'TBD');
  const awayTeam = game.awayTeamName || game['away team'] || capitalize(game.awayTeamId || 'TBD');
  
  // Parse date
  let gameDate;
  if (game.date?.seconds) {
    gameDate = new Date(game.date.seconds * 1000);
  } else if (game.date) {
    gameDate = new Date(game.date);
  } else {
    return null; // Skip games without dates
  }
  
  // Parse time if available
  let startTime = '10:00'; // Default morning game
  if (game.time) {
    startTime = parseTimeString(game.time);
  }
  
  // Set game time
  const [hours, minutes] = startTime.split(':').map(Number);
  gameDate.setHours(hours, minutes, 0, 0);
  
  // Game end time (assume 1.5 hour games)
  const endDate = new Date(gameDate.getTime() + 90 * 60 * 1000);
  
  // Generate unique ID
  const uid = `${game.id || generateUID()}-${seasonId}@mountainsideaces.com`;
  
  // Determine if this is the filtered team's home or away game
  let summary;
  if (teamFilter) {
    const teamLower = teamFilter.toLowerCase();
    const isHome = (game.homeTeamId || '').toLowerCase().includes(teamLower) ||
                   (homeTeam || '').toLowerCase().includes(teamLower);
    summary = isHome ? `vs ${awayTeam}` : `@ ${homeTeam}`;
  } else {
    summary = `${awayTeam} @ ${homeTeam}`;
  }
  
  // Add game type prefix
  const gameType = game.gameType || game.game_type || 'Regular';
  if (gameType.toLowerCase() === 'playoff') {
    summary = `🏆 PLAYOFF: ${summary}`;
  }
  
  // Location
  const location = game.location || game.field || LEAGUE_CONFIG.defaultLocation;
  
  // Description with score if completed
  let description = `${LEAGUE_CONFIG.name}\\n${seasonId.replace('-', ' ').toUpperCase()}`;
  if (game.homeScore !== undefined && game.awayScore !== undefined && game.winner) {
    description += `\\n\\nFinal Score: ${homeTeam} ${game.homeScore} - ${awayTeam} ${game.awayScore}`;
    description += `\\nWinner: ${capitalize(game.winner)}`;
  }
  
  // Build event
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${formatICalDate(new Date())}`);
  lines.push(`DTSTART;TZID=${LEAGUE_CONFIG.timezone}:${formatICalDateLocal(gameDate)}`);
  lines.push(`DTEND;TZID=${LEAGUE_CONFIG.timezone}:${formatICalDateLocal(endDate)}`);
  lines.push(`SUMMARY:${escapeICalText(summary)}`);
  lines.push(`LOCATION:${escapeICalText(location)}`);
  lines.push(`DESCRIPTION:${escapeICalText(description)}`);
  
  // Status
  if (game.status === 'cancelled' || game.status === 'postponed') {
    lines.push('STATUS:CANCELLED');
  } else if (game.winner) {
    lines.push('STATUS:CONFIRMED');
  } else {
    lines.push('STATUS:TENTATIVE');
  }
  
  lines.push('END:VEVENT');
  
  return lines;
}

function formatICalDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function formatICalDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function escapeICalText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function parseTimeString(timeStr) {
  if (!timeStr) return '10:00';
  
  // Handle "10:00 AM", "2:30 PM" format
  const match = timeStr.match(/(\d+):?(\d*)\s*(AM|PM)?/i);
  if (!match) return '10:00';
  
  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const period = match[3]?.toUpperCase();
  
  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }
  
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function generateUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
