// ROLE CONSTANTS AND PERMISSIONS
// AUTHENTICATION FUNCTIONS
// USER PROFILE FUNCTIONS
// TEAM STAFF MANAGEMENT FUNCTIONS
// PLAYER LINK APPROVAL SYSTEM HERE
// FAVORITES FUNCTIONS
// PERMISSION HELPER FUNCTIONS
// MIGRATION HELPER
// UTILITY FUNCTIONS

// firebase-auth.js - Enhanced with Team-Staff Role System
import { getAuth,
         createUserWithEmailAndPassword,
         signInWithEmailAndPassword,
         signInWithPopup,
         GoogleAuthProvider,
         signOut,
         onAuthStateChanged,
         sendPasswordResetEmail,
         sendEmailVerification,
         updateProfile,
         setPersistence,
         browserSessionPersistence,
         browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

import { doc, setDoc, getDoc, updateDoc, serverTimestamp, collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { app, db } from './firebase-data.js';

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// ========================================
// ROLE CONSTANTS AND PERMISSIONS
// ========================================

export const USER_ROLES = {
  PLAYER: 'player',
  CAPTAIN: 'captain',
  TEAM_STAFF: 'team-staff',
  LEAGUE_STAFF: 'league-staff',
  FAN: 'fan',
  FAMILY: 'family',
  ADMIN: 'admin'
};

export const ROLE_PERMISSIONS = {
  player: {
    canViewOwnStats: true,
    canRSVPForSelf: true,
    canEditOwnProfile: true,
    canViewTeamRoster: true,
    canViewSchedule: true,
    canFavoriteTeams: true,
    canFavoritePlayers: true,
    canEditRoster: false,
    canEditLineup: false,
    canSubmitStats: false,
    canManageGames: false,
    canManageStaff: false,
    canRemoveCaptain: false
  },
  
  'team-staff': {
    canViewOwnStats: true,
    canRSVPForSelf: true,
    canEditOwnProfile: true,
    canViewTeamRoster: true,
    canViewSchedule: true,
    canEditRoster: true,
    canEditLineup: true,
    canManageRSVPs: true,
    canViewAllTeamStats: true,
    canCreateGames: true,
    canEditGameDetails: true,
    canAssignPositions: true,
    canSubmitStats: true,
    canFavoriteTeams: true,
    canFavoritePlayers: true,
    // Cannot do these (captain-only):
    canManageStaff: false,
    canRemoveCaptain: false,
    canPromoteToStaff: false,
    canTransferCaptaincy: false
  },
  
  captain: {
    canViewOwnStats: true,
    canRSVPForSelf: true,
    canEditOwnProfile: true,
    canViewTeamRoster: true,
    canViewSchedule: true,
    canEditRoster: true,
    canEditLineup: true,
    canManageRSVPs: true,
    canViewAllTeamStats: true,
    canCreateGames: true,
    canEditGameDetails: true,
    canAssignPositions: true,
    canSubmitStats: true,
    canFavoriteTeams: true,
    canFavoritePlayers: true,
    // Captain-exclusive:
    canManageStaff: true,
    canRemoveCaptain: false,
    canPromoteToStaff: true,
    canTransferCaptaincy: true
  },
  
  'league-staff': {
    canViewAllGames: true,
    canEditAnyGame: true,
    canSubmitStatsAnyTeam: true,
    canManageSeasons: true,
    canViewReports: true,
    canManageAwards: true,
    canApproveCaptains: true,
    canRemoveCaptain: true,
    canOverrideTeamStaff: true
  },
  
  fan: {
    canViewPublicStats: true,
    canViewPublicSchedule: true,
    canFavoriteTeams: true,
    canFavoritePlayers: true,
    canReceiveNotifications: true
  },
  
  family: {
    canViewPublicStats: true,
    canViewPublicSchedule: true,
    canFavoriteTeams: true,
    canFavoritePlayers: true,
    canReceiveNotifications: true,
    canViewFamilyMemberStats: true,
    canReceiveFamilyMemberUpdates: true
  },
  
  admin: {
    allPermissions: true
  }
};

// ========================================
// AUTHENTICATION FUNCTIONS
// ========================================

/**
 * Enhanced registration with name validation and audit trail
 */
export async function registerUser(email, password, displayName) {
  try {
    // Validate display name format
    const nameValidation = validateDisplayName(displayName);
    if (!nameValidation.valid) {
      return { 
        success: false, 
        error: 'invalid-display-name',
        message: nameValidation.message 
      };
    }
    
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    await updateProfile(user, { displayName });
    await sendEmailVerification(user);
    
    // Create user profile with additional security fields
    await createUserProfile(user.uid, {
      email: user.email,
      displayName: displayName,
      displayNameOriginal: displayName, // Store original for audit
      registrationMethod: 'email', // Track how they signed up
      registrationIP: null, // Could add IP tracking if needed
      createdAt: serverTimestamp(),
      emailVerified: false,
      accountFlags: {
        requiresManualReview: false,
        suspiciousActivity: false,
        linkingAttempts: 0,
        linkingAttemptsHistory: []
      }
    });
    
    console.log('✅ User registered:', displayName);
    return { 
      success: true, 
      user, 
      message: 'Account created! Please check your email to verify.',
      nameValidation: nameValidation.confidence
    };
  } catch (error) {
    console.error('❌ Registration error:', error.code, error);
    return { 
      success: false, 
      error: error.code, 
      message: getErrorMessage(error.code) 
    };
  }
}

/**
 * Validate display name to prevent abuse
 */
function validateDisplayName(name) {
  if (!name || name.trim().length === 0) {
    return { valid: false, message: 'Name is required', confidence: 'low' };
  }
  
  const trimmedName = name.trim();
  
  // Check minimum length
  if (trimmedName.length < 2) {
    return { 
      valid: false, 
      message: 'Name must be at least 2 characters', 
      confidence: 'low' 
    };
  }
  
  // Check maximum length
  if (trimmedName.length > 50) {
    return { 
      valid: false, 
      message: 'Name must be less than 50 characters', 
      confidence: 'low' 
    };
  }
  
  // Check for valid characters (letters, spaces, hyphens, apostrophes)
  const nameRegex = /^[a-zA-Z\s'-]+$/;
  if (!nameRegex.test(trimmedName)) {
    return { 
      valid: false, 
      message: 'Name can only contain letters, spaces, hyphens, and apostrophes', 
      confidence: 'low' 
    };
  }
  
  // Check for minimum word count (at least first name)
  const words = trimmedName.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 1) {
    return { 
      valid: false, 
      message: 'Please enter at least your first name', 
      confidence: 'low' 
    };
  }
  
  // Warn if only one name provided (but allow it)
  if (words.length === 1) {
    return { 
      valid: true, 
      warning: 'Including your last name helps with player matching', 
      confidence: 'medium' 
    };
  }
  
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /^test/i,
    /^admin/i,
    /^fake/i,
    /^asdf/i,
    /^\d+$/,
    /^[a-z]{20,}$/i, // Very long single word
    /(.)\1{4,}/ // Same character repeated 5+ times
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmedName)) {
      return { 
        valid: false, 
        message: 'Please enter a valid name', 
        confidence: 'suspicious' 
      };
    }
  }
  
  return { valid: true, confidence: 'high' };
}

export async function loginUser(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log('✅ User logged in:', userCredential.user.displayName);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error('❌ Login error:', error.code);
    return { success: false, error: error.code, message: getErrorMessage(error.code) };
  }
}

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    console.log('✅ Google sign-in successful:', user.displayName);
    
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) {
      await createUserProfile(user.uid, {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: serverTimestamp(),
        emailVerified: user.emailVerified
      });
      console.log('✅ User profile created in Firestore');
    } else {
      console.log('ℹ️ Existing user profile found');
    }
    
    return { success: true, user };
  } catch (error) {
    console.error('❌ Google sign-in error:', error.code, error.message);
    return { success: false, error: error.code, message: error.message || getErrorMessage(error.code) };
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
    console.log('✅ User signed out');
    return { success: true };
  } catch (error) {
    console.error('❌ Sign out error:', error);
    return { success: false, error: error.code };
  }
}

export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    console.log('✅ Password reset email sent to:', email);
    return { success: true, message: 'Password reset email sent!' };
  } catch (error) {
    console.error('❌ Password reset error:', error.code);
    return { success: false, error: error.code, message: getErrorMessage(error.code) };
  }
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function setAuthPersistence(rememberMe = true) {
  try {
    const persistenceMode = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistenceMode);
    console.log(`✅ Auth persistence set to: ${rememberMe ? 'LOCAL' : 'SESSION'}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error setting persistence:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Change user password (for email/password accounts)
 * @param {string} currentPassword - Current password for verification
 * @param {string} newPassword - New password
 * @returns {Promise<Object>}
 */
export async function changeUserPassword(currentPassword, newPassword) {
  try {
    const user = auth.currentUser;
    
    if (!user) {
      return { success: false, message: 'No user signed in' };
    }
    
    // Check if user is using email/password authentication
    const isEmailProvider = user.providerData.some(
      provider => provider.providerId === 'password'
    );
    
    if (!isEmailProvider) {
      return { 
        success: false, 
        message: 'Password change is only available for email/password accounts' 
      };
    }
    
    // Validate new password
    if (newPassword.length < 6) {
      return { 
        success: false, 
        message: 'New password must be at least 6 characters' 
      };
    }
    
    if (currentPassword === newPassword) {
      return { 
        success: false, 
        message: 'New password must be different from current password' 
      };
    }
    
    // Re-authenticate user with current password
    const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import(
      'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
    );
    
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    
    try {
      await reauthenticateWithCredential(user, credential);
    } catch (error) {
      if (error.code === 'auth/wrong-password') {
        return { 
          success: false, 
          message: 'Current password is incorrect' 
        };
      }
      throw error;
    }
    
    // Update password
    await updatePassword(user, newPassword);
    
    console.log('✅ Password changed successfully');
    return { 
      success: true, 
      message: 'Password changed successfully!' 
    };
    
  } catch (error) {
    console.error('❌ Error changing password:', error);
    return { 
      success: false, 
      error: error.code,
      message: getErrorMessage(error.code) || 'Failed to change password. Please try again.'
    };
  }
}

// ========================================
// EMAIL VERIFICATION FUNCTIONS
// ========================================

/**
 * Check if user needs email verification
 * Google users are always considered verified
 * @param {Object} user - Firebase user object
 * @returns {boolean}
 */
export function needsEmailVerification(user) {
  if (!user) return false;
  
  // Check if this is a Google user (always verified)
  const isGoogleUser = user.providerData.some(
    provider => provider.providerId === 'google.com'
  );
  
  if (isGoogleUser) {
    return false; // Google users don't need verification
  }
  
  // Email/password users need verification
  return !user.emailVerified;
}

/**
 * Resend verification email with rate limiting
 * @returns {Promise<Object>}
 */
export async function resendVerificationEmail() {
  try {
    const user = auth.currentUser;
    
    if (!user) {
      return { success: false, message: 'No user signed in' };
    }
    
    // Check if already verified
    if (user.emailVerified) {
      return { success: false, message: 'Email already verified' };
    }
    
    // Check if this is a Google user
    const isGoogleUser = user.providerData.some(
      provider => provider.providerId === 'google.com'
    );
    
    if (isGoogleUser) {
      return { success: false, message: 'Google users do not need email verification' };
    }
    
    // Send verification email
    await sendEmailVerification(user);
    
    console.log('✅ Verification email resent to:', user.email);
    return { 
      success: true, 
      message: 'Verification email sent! Please check your inbox.' 
    };
    
  } catch (error) {
    console.error('❌ Error resending verification email:', error);
    
    let message = 'Failed to send verification email. Please try again.';
    
    if (error.code === 'auth/too-many-requests') {
      message = 'Too many requests. Please wait a few minutes before trying again.';
    }
    
    return { 
      success: false, 
      error: error.code,
      message 
    };
  }
}

/**
 * Refresh user's email verification status
 * Call this after user claims to have verified their email
 * @returns {Promise<Object>}
 */
export async function refreshVerificationStatus() {
  try {
    const user = auth.currentUser;
    
    if (!user) {
      return { success: false, message: 'No user signed in' };
    }
    
    // Reload user to get fresh token with updated emailVerified status
    await user.reload();
    
    // Get the refreshed user
    const refreshedUser = auth.currentUser;
    
    console.log('✅ Verification status refreshed:', refreshedUser.emailVerified);
    
    return { 
      success: true, 
      emailVerified: refreshedUser.emailVerified,
      user: refreshedUser
    };
    
  } catch (error) {
    console.error('❌ Error refreshing verification status:', error);
    return { 
      success: false, 
      error: error.code,
      message: 'Failed to check verification status. Please try again.'
    };
  }
}

/**
 * Get user's verification status and provider info
 * Useful for determining what verification UI to show
 * @returns {Object}
 */
export function getVerificationInfo() {
  const user = auth.currentUser;
  
  if (!user) {
    return {
      signedIn: false,
      emailVerified: false,
      isGoogleUser: false,
      needsVerification: false
    };
  }
  
  const isGoogleUser = user.providerData.some(
    provider => provider.providerId === 'google.com'
  );
  
  return {
    signedIn: true,
    emailVerified: user.emailVerified,
    isGoogleUser: isGoogleUser,
    needsVerification: !isGoogleUser && !user.emailVerified,
    email: user.email
  };
}


// ========================================
// USER PROFILE FUNCTIONS
// ========================================

async function createUserProfile(userId, data) {
  const userRef = doc(db, 'users', userId);
  await setDoc(userRef, {
    ...data,
    // Enhanced role system
    userRole: USER_ROLES.FAN, // Default role
    teamRoles: {}, // Multi-team role tracking
    
    // Legacy fields (keep for backward compatibility)
    linkedPlayer: null,
    linkedTeam: null,
    isCaptain: false,
    
	// Staff management
    staffRequests: [],
    playerLinkRequests: [], // needed for link-player.html
    
    // Preferences
    favoriteTeams: [],
    favoritePlayers: [],
    notificationsEnabled: true,
    preferences: {
      emailGameReminders: true,
      emailScoreUpdates: false,
      favoriteTeamNotifications: true,
      favoritePlayerAlerts: true,
      publicFavorites: false,
      defaultStatsView: 'season',
      defaultSeason: 'current'
    },
    
    // Profile completion
    profileComplete: false,
    
    theme: 'light',
    updatedAt: serverTimestamp()
  });
  console.log('✅ User profile created in Firestore for:', userId);
}

export async function getUserProfile(userId) {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      return { success: true, data: userDoc.data() };
    }
    return { success: false, message: 'User profile not found' };
  } catch (error) {
    console.error('❌ Error getting user profile:', error);
    return { success: false, error: error.code };
  }
}

export async function updateUserProfile(userId, updates) {
  try {
    await updateDoc(doc(db, 'users', userId), {
      ...updates,
      updatedAt: serverTimestamp()
    });
    console.log('✅ User profile updated:', userId);
    return { success: true };
  } catch (error) {
    console.error('❌ Error updating user profile:', error);
    return { success: false, error: error.code };
  }
}

export async function linkPlayerToUser(userId, playerName, teamId, isCaptain = false) {
  try {
    const user = auth.currentUser;
    
    // Update auth user's display name to match player profile
    if (playerName && user) {
      try {
        await updateProfile(user, { displayName: playerName });
        console.log('✅ Updated auth displayName to:', playerName);
      } catch (profileUpdateError) {
        console.error('⚠️ Could not update auth profile:', profileUpdateError);
      }
    }
    
    let existingPlayerData = null;
    let playerUserId = null;
    
    if (playerName) {
      playerUserId = playerName.toLowerCase().replace(/\s+/g, '_');
      
      try {
        const oldPlayerRef = doc(db, 'users', playerUserId);
        const oldPlayerDoc = await getDoc(oldPlayerRef);
        
        if (oldPlayerDoc.exists()) {
          console.log('✅ Found existing player profile:', playerUserId);
          existingPlayerData = oldPlayerDoc.data();
        } else {
          console.log('ℹ️ No existing player profile found for:', playerUserId);
        }
      } catch (profileError) {
        console.warn('Could not fetch old player profile:', profileError);
      }
    }
    
    const userRef = doc(db, 'users', userId);
    const updateData = {
      displayName: playerName,
      linkedPlayer: playerName,
      linkedTeam: teamId,
      isCaptain: isCaptain,
      updatedAt: serverTimestamp()
    };
    
    // Determine user role based on captain status
    if (isCaptain) {
      updateData.userRole = USER_ROLES.CAPTAIN;
      
      // Initialize teamRoles if captain
      updateData.teamRoles = {
        [teamId]: {
          role: USER_ROLES.CAPTAIN,
          approvedBy: 'system', // System-assigned captain
          approvedAt: serverTimestamp(),
          canBeRemovedBy: [], // Only league-staff/admin can remove
          status: 'active'
        }
      };
    } else {
      updateData.userRole = USER_ROLES.PLAYER;
    }
    
    // Merge existing player data
    if (existingPlayerData) {
      // CRITICAL FIX: Check for captain status in legacy profile
      if (existingPlayerData.role === 'captain' || existingPlayerData.isCaptain === true) {
        updateData.isCaptain = true;
        updateData.userRole = USER_ROLES.CAPTAIN;
        
        updateData.teamRoles = {
          [teamId]: {
            role: USER_ROLES.CAPTAIN,
            approvedBy: 'system',
            approvedAt: serverTimestamp(),
            canBeRemovedBy: [],
            status: 'active'
          }
        };
        
        console.log('✅ Setting isCaptain = true from legacy profile');
      }
      
      if (existingPlayerData.favoriteTeams) updateData.favoriteTeams = existingPlayerData.favoriteTeams;
      if (existingPlayerData.favoritePlayers) updateData.favoritePlayers = existingPlayerData.favoritePlayers;
      if (existingPlayerData.stats) updateData.stats = existingPlayerData.stats;
      if (existingPlayerData.seasonStats) updateData.seasonStats = existingPlayerData.seasonStats;
      if (existingPlayerData.careerStats) updateData.careerStats = existingPlayerData.careerStats;
      if (existingPlayerData.role) updateData.role = existingPlayerData.role;
      if (existingPlayerData.currentTeam && !teamId) updateData.linkedTeam = existingPlayerData.currentTeam;
      
	  // ADD THESE LINES FOR PLAYER INFO:
  if (existingPlayerData.bats) updateData.bats = existingPlayerData.bats;
  if (existingPlayerData.batting) updateData.bats = existingPlayerData.batting; // fallback field name
  if (existingPlayerData.throws) updateData.throws = existingPlayerData.throws;
  if (existingPlayerData.throwing) updateData.throws = existingPlayerData.throwing; // fallback field name
  if (existingPlayerData.position) updateData.position = existingPlayerData.position;
  if (existingPlayerData.number) updateData.number = existingPlayerData.number;
  if (existingPlayerData.nickname) updateData.nickname = existingPlayerData.nickname;
  if (existingPlayerData.photo) updateData.photo = existingPlayerData.photo;
  if (existingPlayerData.photoURL) updateData.photoURL = existingPlayerData.photoURL;
	  
      updateData.mergedFromProfile = playerUserId;
      updateData.mergedAt = serverTimestamp();
      
      console.log('✅ Merging data from old profile');
    }
    
    await updateDoc(userRef, updateData);
    
    // Mark legacy profile as migrated
    if (existingPlayerData && playerUserId) {
      try {
        const oldPlayerRef = doc(db, 'users', playerUserId);
        await updateDoc(oldPlayerRef, {
          migrated: true,
          migratedTo: userId,
          migratedAt: serverTimestamp()
        });
        console.log('✅ Marked legacy profile as migrated:', playerUserId);
      } catch (migrationError) {
        console.warn('Could not mark legacy profile as migrated:', migrationError);
      }
    }
    
    console.log('✅ Player linked to user:', playerName, 'Team:', teamId);
    return { success: true };
  } catch (error) {
    console.error('❌ Error linking player:', error);
    return { success: false, error: error.code };
  }
}


/**
 * Get the correct profile page URL for a user's role
 * @param {Object} userProfile - User profile data
 * @returns {string} - URL to correct profile page
 */
export function getProfilePageForUser(userProfile) {
  if (!userProfile) return 'profile-fan.html'; // Default to fan
  
  const role = userProfile.userRole;
  
  // Fans and family use fan profile
  if (role === USER_ROLES.FAN || role === USER_ROLES.FAMILY) {
    return 'profile-fan.html';
  }
  
  // Players, captains, team-staff, league-staff, admin use full profile
  return 'profile.html';
}

/**
 * Redirect user to correct profile page if on wrong one
 * @param {Object} userProfile - User profile data
 * @param {string} currentPage - Current page filename (e.g., 'profile.html')
 */
export function ensureCorrectProfilePage(userProfile, currentPage) {
  const correctPage = getProfilePageForUser(userProfile);
  
  if (currentPage !== correctPage) {
    console.log(`🔀 Redirecting from ${currentPage} to ${correctPage}`);
    window.location.href = correctPage;
  }
}


// ========================================
// TEAM STAFF MANAGEMENT FUNCTIONS
// ========================================

/**
 * Request team-staff access for a team
 */
export async function requestTeamStaffAccess(userId, teamId, teamName) {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const currentRequests = userDoc.data().staffRequests || [];
    
    // Check if already requested
    const existingRequest = currentRequests.find(
      r => r.teamId === teamId && r.status === 'pending'
    );
    
    if (existingRequest) {
      return { success: false, message: 'Request already pending' };
    }
    
    // Check if already staff for this team
    const teamRoles = userDoc.data().teamRoles || {};
    if (teamRoles[teamId] && teamRoles[teamId].status === 'active') {
      return { success: false, message: 'Already staff member of this team' };
    }
    
    // Add new request
    currentRequests.push({
      teamId,
      teamName,
      requestedAt: serverTimestamp(),
      status: 'pending',
      requestedBy: userId
    });
    
    await updateDoc(userRef, {
      staffRequests: currentRequests,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Staff access requested for:', teamName);
    return { success: true, message: 'Request submitted to team captain' };
    
  } catch (error) {
    console.error('❌ Error requesting staff access:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Approve team-staff request (captain only)
 */
export async function approveTeamStaff(captainId, requestUserId, teamId) {
  try {
    // Verify captain has permission
    const captainDoc = await getDoc(doc(db, 'users', captainId));
    if (!captainDoc.exists()) {
      return { success: false, message: 'Captain not found' };
    }
    
    const captainData = captainDoc.data();
    const captainTeamRole = captainData.teamRoles?.[teamId];
    
    if (!captainTeamRole || captainTeamRole.role !== USER_ROLES.CAPTAIN) {
      return { success: false, message: 'Only team captain can approve staff' };
    }
    
    // Update the requesting user's profile
    const userRef = doc(db, 'users', requestUserId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const userData = userDoc.data();
    const staffRequests = userData.staffRequests || [];
    
    // Update request status
    const updatedRequests = staffRequests.map(req => {
      if (req.teamId === teamId && req.status === 'pending') {
        return {
          ...req,
          status: 'approved',
          reviewedBy: captainId,
          reviewedAt: new Date().toISOString()
        };
      }
      return req;
    });
    
    // Add team-staff role
    const teamRoles = userData.teamRoles || {};
    teamRoles[teamId] = {
      role: USER_ROLES.TEAM_STAFF,
      approvedBy: captainId,
      approvedAt: serverTimestamp(),
      canBeRemovedBy: [captainId],
      status: 'active'
    };
    
    await updateDoc(userRef, {
      userRole: USER_ROLES.TEAM_STAFF,
      linkedTeam: teamId,
      teamRoles,
      staffRequests: updatedRequests,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Team staff approved:', requestUserId);
    return { success: true, message: 'Staff member approved' };
    
  } catch (error) {
    console.error('❌ Error approving staff:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Remove team-staff member (captain only, cannot remove captain)
 */
export async function removeTeamStaff(captainId, staffUserId, teamId) {
  try {
    // Verify captain has permission
    const captainDoc = await getDoc(doc(db, 'users', captainId));
    const staffDoc = await getDoc(doc(db, 'users', staffUserId));
    
    if (!captainDoc.exists() || !staffDoc.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const captainData = captainDoc.data();
    const staffData = staffDoc.data();
    
    // Check captain permission
    const captainTeamRole = captainData.teamRoles?.[teamId];
    if (!captainTeamRole || captainTeamRole.role !== USER_ROLES.CAPTAIN) {
      return { success: false, message: 'Only team captain can remove staff' };
    }
    
    // Check if trying to remove captain (not allowed)
    const staffTeamRole = staffData.teamRoles?.[teamId];
    if (staffTeamRole?.role === USER_ROLES.CAPTAIN) {
      return { success: false, message: 'Cannot remove team captain. Only league staff/admin can remove captains.' };
    }
    
    // Remove team-staff role
    const teamRoles = staffData.teamRoles || {};
    if (teamRoles[teamId]) {
      teamRoles[teamId].status = 'removed';
      teamRoles[teamId].removedBy = captainId;
      teamRoles[teamId].removedAt = serverTimestamp();
    }
    
    // Determine new user role
    const activeRoles = Object.values(teamRoles).filter(r => r.status === 'active');
    let newUserRole = USER_ROLES.PLAYER;
    
    if (activeRoles.length > 0) {
      // User has other active team roles
      newUserRole = activeRoles[0].role;
    }
    
    await updateDoc(doc(db, 'users', staffUserId), {
      userRole: newUserRole,
      linkedTeam: activeRoles.length > 0 ? Object.keys(teamRoles).find(tid => teamRoles[tid].status === 'active') : null,
      teamRoles,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Team staff removed:', staffUserId);
    return { success: true, message: 'Staff member removed' };
    
  } catch (error) {
    console.error('❌ Error removing staff:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Deny team-staff request (captain only)
 */
export async function denyTeamStaffRequest(captainId, requestUserId, teamId) {
  try {
    const captainDoc = await getDoc(doc(db, 'users', captainId));
    if (!captainDoc.exists()) {
      return { success: false, message: 'Captain not found' };
    }
    
    const captainData = captainDoc.data();
    const captainTeamRole = captainData.teamRoles?.[teamId];
    
    if (!captainTeamRole || captainTeamRole.role !== USER_ROLES.CAPTAIN) {
      return { success: false, message: 'Only team captain can deny requests' };
    }
    
    const userRef = doc(db, 'users', requestUserId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const userData = userDoc.data();
    const staffRequests = userData.staffRequests || [];
    
    const updatedRequests = staffRequests.map(req => {
      if (req.teamId === teamId && req.status === 'pending') {
        return {
          ...req,
          status: 'denied',
          reviewedBy: captainId,
          reviewedAt: new Date().toISOString()
        };
      }
      return req;
    });
    
    await updateDoc(userRef, {
      staffRequests: updatedRequests,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Staff request denied:', requestUserId);
    return { success: true, message: 'Request denied' };
    
  } catch (error) {
    console.error('❌ Error denying request:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Get all pending staff requests for a team (captain view)
 */
export async function getTeamStaffRequests(teamId) {
  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const pendingRequests = [];
    
    usersSnapshot.forEach(docSnap => {
      const userData = docSnap.data();
      const requests = userData.staffRequests || [];
      
      requests.forEach(req => {
        if (req.teamId === teamId && req.status === 'pending') {
          pendingRequests.push({
            userId: docSnap.id,
            userName: userData.displayName,
            userEmail: userData.email,
            photoURL: userData.photoURL || null,
            ...req
          });
        }
      });
    });
    
    return { success: true, requests: pendingRequests };
    
  } catch (error) {
    console.error('❌ Error fetching staff requests:', error);
    return { success: false, error: error.code, requests: [] };
  }
}

/**
 * Get all team-staff members for a team
 */
export async function getTeamStaffMembers(teamId) {
  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const staffMembers = [];
    
    usersSnapshot.forEach(docSnap => {
      const userData = docSnap.data();
      const teamRole = userData.teamRoles?.[teamId];
      
      if (teamRole && 
          (teamRole.role === USER_ROLES.TEAM_STAFF || teamRole.role === USER_ROLES.CAPTAIN) &&
          teamRole.status === 'active') {
        staffMembers.push({
          userId: docSnap.id,
          userName: userData.displayName,
          userEmail: userData.email,
          photoURL: userData.photoURL || null,
          role: teamRole.role,
          approvedBy: teamRole.approvedBy,
          approvedAt: teamRole.approvedAt
        });
      }
    });
    
    // Sort: captains first, then team-staff
    staffMembers.sort((a, b) => {
      if (a.role === USER_ROLES.CAPTAIN && b.role !== USER_ROLES.CAPTAIN) return -1;
      if (a.role !== USER_ROLES.CAPTAIN && b.role === USER_ROLES.CAPTAIN) return 1;
      return a.userName.localeCompare(b.userName);
    });
    
    return { success: true, staff: staffMembers };
    
  } catch (error) {
    console.error('❌ Error fetching staff members:', error);
    return { success: false, error: error.code, staff: [] };
  }
}
// ========================================
// PLAYER LINK APPROVAL SYSTEM
// Add these functions to firebase-auth.js
// ========================================

/**
 * Request to link a player account (requires approval)
 * @param {string} userId - User's Firebase UID
 * @param {string} playerName - Player name to link
 * @param {string} teamId - Team ID
 * @param {string} reason - Optional reason for linking
 * @returns {Promise<Object>}
 */
/**
 * Request to link a player account (requires approval) - FIXED VERSION
 * @param {string} userId - User's Firebase UID
 * @param {string} playerName - Player name to link
 * @param {string} teamId - Team ID
 * @param {string} reason - Optional reason for linking
 * @returns {Promise<Object>}
 */
export async function requestPlayerLink(userId, playerName, teamId, reason = '') {
  try {
    console.log('🔗 Starting player link request for:', playerName);
    
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.error('❌ User not found:', userId);
      return { success: false, message: 'User not found' };
    }
    
    const userData = userDoc.data();
    console.log('✓ User data loaded:', userData.displayName);
    
    // SECURITY CHECK: Track linking attempts
    const accountFlags = userData.accountFlags || {};
    const linkingAttempts = accountFlags.linkingAttempts || 0;
    
    // Rate limiting: Max 3 requests per hour
    const linkingHistory = accountFlags.linkingAttemptsHistory || [];
    const recentAttempts = linkingHistory.filter(attempt => {
      const attemptTime = new Date(attempt.timestamp);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return attemptTime > oneHourAgo;
    });
    
    if (recentAttempts.length >= 3) {
      console.warn('⚠️ Rate limit exceeded for user:', userId);
      return { 
        success: false, 
        message: 'Too many link requests. Please wait an hour before trying again.' 
      };
    }
    
    // Check if already linked
    if (userData.linkedPlayer) {
      console.warn('⚠️ User already has linked player:', userData.linkedPlayer);
      return { 
        success: false, 
        message: 'You already have a linked player. Please unlink first.' 
      };
    }
    
    // Check if there's already a pending request
    const playerLinkRequests = userData.playerLinkRequests || [];
    const pendingRequest = playerLinkRequests.find(
      r => r.status === 'pending' && r.playerName === playerName
    );
    
    if (pendingRequest) {
      console.warn('⚠️ Pending request already exists for:', playerName);
      return { 
        success: false, 
        message: 'You already have a pending request for this player' 
      };
    }
    
    // Check if this player is already claimed by someone else
    console.log('🔍 Checking if player is already claimed...');
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let playerAlreadyClaimed = false;
    
    usersSnapshot.forEach(docSnap => {
      if (docSnap.id !== userId) {
        const otherUserData = docSnap.data();
        if (otherUserData.linkedPlayer === playerName) {
          playerAlreadyClaimed = true;
          console.warn('⚠️ Player already claimed by:', docSnap.id);
        }
      }
    });
    
    if (playerAlreadyClaimed) {
      return { 
        success: false, 
        message: 'This player is already linked to another account. Contact league staff if this is incorrect.' 
      };
    }
    
    console.log('✓ Player is available for linking');
    
    // Calculate name similarity
    const similarity = calculateNameSimilarity(userData.displayName, playerName);
    console.log('✓ Name similarity score:', similarity);
    
    // Determine approval level with stricter thresholds for email users
    const registrationMethod = userData.registrationMethod || 'google';
    let approvalLevel = 'league-staff'; // Default to strictest
    
    if (registrationMethod === 'google') {
      // Google users get normal thresholds
      if (similarity >= 0.9) {
        approvalLevel = 'auto';
      } else if (similarity >= 0.6) {
        approvalLevel = 'captain';
      }
    } else {
      // Email users need higher similarity for auto-approval
      if (similarity >= 0.95) {
        approvalLevel = 'auto';
      } else if (similarity >= 0.8) {
        approvalLevel = 'captain';
      }
      // Otherwise stays as 'league-staff'
    }
    
    console.log('✓ Approval level determined:', approvalLevel);
    console.log('✓ Registration method:', registrationMethod);
    
    // Flag suspicious requests
    let requiresManualReview = false;
    if (similarity < 0.3 || linkingAttempts > 5) {
      requiresManualReview = true;
      approvalLevel = 'league-staff'; // Force manual review
      console.warn('⚠️ Request flagged for manual review');
    }
    
    // Create link request
    const now = new Date();
    const expiresDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const newRequest = {
      requestId: `${userId}-${Date.now()}`,
      playerName: playerName,
      teamId: teamId,
      reason: reason || 'Player linking their account',
      requestedAt: now.toISOString(),
      requestedBy: userId,
      status: 'pending',
      approvalLevel: approvalLevel,
      reviewedBy: null,
      reviewedAt: null,
      expiresAt: expiresDate.toISOString(),
      securityInfo: {
        registrationMethod: registrationMethod,
        nameSimilarity: similarity,
        requiresManualReview: requiresManualReview,
        userDisplayName: userData.displayName,
        linkingAttemptNumber: linkingAttempts + 1
      }
    };
    
    console.log('✓ Created request object:', newRequest.requestId);
    
    // Add to array
    playerLinkRequests.push(newRequest);
    
    // Update linking attempts tracking
    const updatedHistory = [
      ...linkingHistory,
      {
        timestamp: now.toISOString(),
        playerName: playerName,
        approvalLevel: approvalLevel,
        similarity: similarity
      }
    ].slice(-10); // Keep last 10 attempts
    
    // Update Firestore
    console.log('💾 Updating Firestore...');
    await updateDoc(userRef, {
      playerLinkRequests: playerLinkRequests,
      'accountFlags.linkingAttempts': linkingAttempts + 1,
      'accountFlags.linkingAttemptsHistory': updatedHistory,
      'accountFlags.requiresManualReview': requiresManualReview,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Player link request submitted successfully');
    
    // Return appropriate message based on approval level
    let message = '';
    if (approvalLevel === 'auto') {
      message = 'Perfect name match! Your account will be linked automatically.';
    } else if (approvalLevel === 'captain') {
      message = 'Link request submitted. Your team captain will review and approve.';
    } else {
      message = 'Link request submitted for review by league staff. This may take 1-2 business days.';
    }
    
    if (requiresManualReview) {
      message += ' (Manual review required due to security check)';
    }
    
    return { 
      success: true, 
      message: message,
      requestId: newRequest.requestId,
      approvalLevel: approvalLevel,
      similarity: similarity,
      requiresManualReview: requiresManualReview
    };
    
  } catch (error) {
    console.error('❌ Error requesting player link:', error);
    return { 
      success: false, 
      error: error.code,
      message: error.message || 'An error occurred while submitting the request'
    };
  }
}

/**
 * Determine what level of approval is needed
 * @param {Object} userData - User's profile data
 * @param {string} playerName - Player name
 * @param {string} teamId - Team ID
 * @returns {string} - 'auto', 'captain', 'league-staff'
 */
function determineApprovalLevel(userData, playerName, teamId) {
  // Level 1: AUTO-APPROVE if name match is very close
  const userDisplayName = userData.displayName || '';
  const nameSimilarity = calculateNameSimilarity(userDisplayName, playerName);
  
  if (nameSimilarity > 0.9) {
    return 'auto'; // 90%+ match = auto-approve
  }
  
  // Level 2: CAPTAIN APPROVAL for reasonable matches
  if (nameSimilarity > 0.6) {
    return 'captain'; // 60-90% match = captain approval
  }
  
  // Level 3: LEAGUE STAFF for low matches or disputes
  return 'league-staff'; // <60% match = requires league staff
}

/**
 * Calculate name similarity (simple algorithm)
 * @param {string} name1
 * @param {string} name2
 * @returns {number} - Similarity score 0-1
 */
function calculateNameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;
  
  const clean1 = name1.toLowerCase().trim();
  const clean2 = name2.toLowerCase().trim();
  
  // Exact match
  if (clean1 === clean2) return 1.0;
  
  // Split into parts
  const parts1 = clean1.split(/\s+/);
  const parts2 = clean2.split(/\s+/);
  
  // Check if all parts of shorter name are in longer name
  const shorter = parts1.length <= parts2.length ? parts1 : parts2;
  const longer = parts1.length > parts2.length ? parts1 : parts2;
  
  let matches = 0;
  shorter.forEach(part => {
    if (longer.some(p => p.includes(part) || part.includes(p))) {
      matches++;
    }
  });
  
  return matches / Math.max(parts1.length, parts2.length);
}

/**
 * Process player link request (auto-approve if eligible)
 * @param {string} requestId - Request ID
 * @returns {Promise<Object>}
 */
export async function processPlayerLinkRequest(requestId) {
  try {
    // Find the request
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let userDoc = null;
    let request = null;
    
    usersSnapshot.forEach(docSnap => {
      const userData = docSnap.data();
      const requests = userData.playerLinkRequests || [];
      const found = requests.find(r => r.requestId === requestId);
      if (found) {
        userDoc = docSnap;
        request = found;
      }
    });
    
    if (!request) {
      return { success: false, message: 'Request not found' };
    }
    
    // Check if expired
    if (request.expiresAt && new Date(request.expiresAt.seconds * 1000) < new Date()) {
      return { success: false, message: 'Request has expired' };
    }
    
    // Auto-approve if eligible
    if (request.approvalLevel === 'auto') {
      return await approvePlayerLink('system', requestId, 'Auto-approved based on name match');
    }
    
    // Otherwise, wait for manual approval
    return { 
      success: true, 
      message: `Awaiting ${request.approvalLevel} approval`,
      approvalLevel: request.approvalLevel
    };
    
  } catch (error) {
    console.error('❌ Error processing player link:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Approve player link request
 * @param {string} approverId - User ID of approver (or 'system')
 * @param {string} requestId - Request ID
 * @param {string} notes - Optional approval notes
 * @returns {Promise<Object>}
 */
export async function approvePlayerLink(approverId, requestId, notes = '') {
  try {
    // Find the request
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let userId = null;
    let request = null;
    let userRef = null;
    
    usersSnapshot.forEach(docSnap => {
      const userData = docSnap.data();
      const requests = userData.playerLinkRequests || [];
      const found = requests.find(r => r.requestId === requestId);
      if (found) {
        userId = docSnap.id;
        userRef = doc(db, 'users', docSnap.id);
        request = found;
      }
    });
    
    if (!request) {
      return { success: false, message: 'Request not found' };
    }
    
    if (request.status !== 'pending') {
      return { success: false, message: 'Request already processed' };
    }
    
    // If not system, verify approver has permission
    if (approverId !== 'system') {
      const approverDoc = await getDoc(doc(db, 'users', approverId));
      if (!approverDoc.exists()) {
        return { success: false, message: 'Approver not found' };
      }
      
      const approverData = approverDoc.data();
      
      // Check if approver has permission
      const hasPermission = await verifyApproverPermission(
        approverData,
        request.approvalLevel,
        request.teamId
      );
      
      if (!hasPermission) {
        return { success: false, message: 'Insufficient permissions to approve this request' };
      }
    }
    
    // Get the user data
    const userDoc = await getDoc(userRef);
    const userData = userDoc.data();
    const playerLinkRequests = userData.playerLinkRequests || [];
    
    // Update request status
    const updatedRequests = playerLinkRequests.map(r => {
      if (r.requestId === requestId) {
        return {
          ...r,
          status: 'approved',
          reviewedBy: approverId,
          reviewedAt: new Date().toISOString(),
          notes
        };
      }
      return r;
    });
    
    // Actually link the player (call existing linkPlayerToUser function)
    const linkResult = await linkPlayerToUser(
      userId,
      request.playerName,
      request.teamId,
      false // Not captain by default
    );
    
    if (!linkResult.success) {
      return { success: false, message: 'Failed to link player' };
    }
    
    // Update requests
    await updateDoc(userRef, {
      playerLinkRequests: updatedRequests,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Player link approved:', request.playerName);
    return { 
      success: true, 
      message: 'Player link approved successfully',
      playerName: request.playerName
    };
    
  } catch (error) {
    console.error('❌ Error approving player link:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Deny player link request
 * @param {string} denierId - User ID of denier
 * @param {string} requestId - Request ID
 * @param {string} reason - Reason for denial
 * @returns {Promise<Object>}
 */
export async function denyPlayerLink(denierId, requestId, reason = '') {
  try {
    // Find the request
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let userRef = null;
    let request = null;
    
    usersSnapshot.forEach(docSnap => {
      const userData = docSnap.data();
      const requests = userData.playerLinkRequests || [];
      const found = requests.find(r => r.requestId === requestId);
      if (found) {
        userRef = doc(db, 'users', docSnap.id);
        request = found;
      }
    });
    
    if (!request) {
      return { success: false, message: 'Request not found' };
    }
    
    // Verify denier has permission
    const denierDoc = await getDoc(doc(db, 'users', denierId));
    if (!denierDoc.exists()) {
      return { success: false, message: 'Denier not found' };
    }
    
    const denierData = denierDoc.data();
    const hasPermission = await verifyApproverPermission(
      denierData,
      request.approvalLevel,
      request.teamId
    );
    
    if (!hasPermission) {
      return { success: false, message: 'Insufficient permissions to deny this request' };
    }
    
    // Get user data
    const userDoc = await getDoc(userRef);
    const userData = userDoc.data();
    const playerLinkRequests = userData.playerLinkRequests || [];
    
    // Update request status
    const updatedRequests = playerLinkRequests.map(r => {
      if (r.requestId === requestId) {
        return {
          ...r,
          status: 'denied',
          reviewedBy: denierId,
          reviewedAt: new Date().toISOString(),
          denialReason: reason
        };
      }
      return r;
    });
    
    await updateDoc(userRef, {
      playerLinkRequests: updatedRequests,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Player link denied:', request.playerName);
    return { 
      success: true, 
      message: 'Player link request denied',
      reason
    };
    
  } catch (error) {
    console.error('❌ Error denying player link:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Verify approver has permission for approval level
 * @param {Object} approverData - Approver's user data
 * @param {string} approvalLevel - Required approval level
 * @param {string} teamId - Team ID
 * @returns {Promise<boolean>}
 */
async function verifyApproverPermission(approverData, approvalLevel, teamId) {
  // Admin can approve anything
  if (approverData.userRole === USER_ROLES.ADMIN) {
    return true;
  }
  
  // League staff can approve anything
  if (approverData.userRole === USER_ROLES.LEAGUE_STAFF) {
    return true;
  }
  
  // Captain can approve captain-level requests for their team
  if (approvalLevel === 'captain') {
    const teamRole = approverData.teamRoles?.[teamId];
    if (teamRole?.role === USER_ROLES.CAPTAIN && teamRole?.status === 'active') {
      return true;
    }
  }
  
  return false;
}

/**
 * Get all pending player link requests (for captains/staff)
 * @param {string} teamId - Optional: filter by team
 * @returns {Promise<Object>}
 */
export async function getPendingPlayerLinkRequests(teamId = null) {
  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const pendingRequests = [];
    
    usersSnapshot.forEach(docSnap => {
      const userData = docSnap.data();
      const requests = userData.playerLinkRequests || [];
      
      requests.forEach(req => {
        if (req.status === 'pending') {
          // Filter by team if specified
          if (!teamId || req.teamId === teamId) {
            pendingRequests.push({
              userId: docSnap.id,
              userName: userData.displayName,
              userEmail: userData.email,
              photoURL: userData.photoURL || null,
              ...req
            });
          }
        }
      });
    });
    
    // Sort by request date (oldest first)
    pendingRequests.sort((a, b) => {
      const timeA = a.requestedAt?.seconds || 0;
      const timeB = b.requestedAt?.seconds || 0;
      return timeA - timeB;
    });
    
    return { success: true, requests: pendingRequests };
    
  } catch (error) {
    console.error('❌ Error fetching player link requests:', error);
    return { success: false, error: error.code, requests: [] };
  }
}

/**
 * Cancel a pending player link request (user can cancel their own)
 * @param {string} userId - User ID
 * @param {string} requestId - Request ID
 * @returns {Promise<Object>}
 */
export async function cancelPlayerLinkRequest(userId, requestId) {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const userData = userDoc.data();
    const playerLinkRequests = userData.playerLinkRequests || [];
    
    // Find and update the request
    const updatedRequests = playerLinkRequests.map(r => {
      if (r.requestId === requestId && r.status === 'pending') {
        return {
          ...r,
          status: 'cancelled',
          cancelledAt: new Date().toISOString()
        };
      }
      return r;
    });
    
    await updateDoc(userRef, {
      playerLinkRequests: updatedRequests,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Player link request cancelled');
    return { success: true, message: 'Request cancelled successfully' };
    
  } catch (error) {
    console.error('❌ Error cancelling request:', error);
    return { success: false, error: error.code };
  }
}

/**
 * Unlink player (requires approval if player has stats)
 * @param {string} userId - User ID
 * @param {string} reason - Reason for unlinking
 * @returns {Promise<Object>}
 */
export async function requestPlayerUnlink(userId, reason = '') {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const userData = userDoc.data();
    
    if (!userData.linkedPlayer) {
      return { success: false, message: 'No player linked to unlink' };
    }
    
    // Check if player has significant stats (games played)
    // If yes, require captain/staff approval
    // If no, allow immediate unlink
    
    const hasStats = userData.stats?.games > 0 || userData.career?.games > 0;
    
    if (!hasStats) {
      // Allow immediate unlink for new accounts
      await updateDoc(userRef, {
        linkedPlayer: null,
        linkedTeam: null,
        isCaptain: false,
        userRole: USER_ROLES.FAN,
        teamRoles: {},
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ Player unlinked immediately (no stats)');
      return { success: true, message: 'Player unlinked successfully' };
    }
    
    // Create unlink request for accounts with stats
    const unlinkRequests = userData.unlinkRequests || [];
    unlinkRequests.push({
      requestId: `unlink-${userId}-${Date.now()}`,
      playerName: userData.linkedPlayer,
      teamId: userData.linkedTeam,
      reason,
      requestedAt: serverTimestamp(),
      status: 'pending'
    });
    
    await updateDoc(userRef, {
      unlinkRequests,
      updatedAt: serverTimestamp()
    });
    
    console.log('✅ Unlink request submitted');
    return { 
      success: true, 
      message: 'Unlink request submitted. Awaiting captain or league staff approval.' 
    };
    
  } catch (error) {
    console.error('❌ Error requesting unlink:', error);
    return { success: false, error: error.code };
  }
}
// ========================================
// FAVORITES FUNCTIONS
// ========================================

export async function addFavoriteTeam(userId, teamId) {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    const currentFavorites = userDoc.data()?.favoriteTeams || [];
    
    if (!currentFavorites.includes(teamId)) {
      currentFavorites.push(teamId);
      await updateDoc(userRef, {
        favoriteTeams: currentFavorites,
        updatedAt: serverTimestamp()
      });
      console.log('✅ Favorite team added:', teamId);
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error adding favorite team:', error);
    return { success: false, error: error.code };
  }
}

export async function addFavoritePlayer(userId, playerName) {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    const currentFavorites = userDoc.data()?.favoritePlayers || [];
    
    if (!currentFavorites.includes(playerName)) {
      currentFavorites.push(playerName);
      await updateDoc(userRef, {
        favoritePlayers: currentFavorites,
        updatedAt: serverTimestamp()
      });
      console.log('✅ Favorite player added:', playerName);
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error adding favorite player:', error);
    return { success: false, error: error.code };
  }
}

// ========================================
// PERMISSION HELPER FUNCTIONS
// ========================================

/**
 * Check if user has permission for an action
 * @param {Object} user - User profile object
 * @param {string} permission - Permission to check
 * @param {Object} context - Additional context (e.g., teamId)
 * @returns {boolean}
 */
export function hasPermission(user, permission, context = {}) {
  if (!user) return false;
  
  // Admin override
  if (user.userRole === USER_ROLES.ADMIN) return true;
  
  // Check custom permissions first
  if (user.customPermissions?.[permission]) {
    return true;
  }
  
  // Special case: team-specific permissions
  if (context.teamId) {
    const teamRole = user.teamRoles?.[context.teamId];
    
    // Check if user has active role for this team
    if (!teamRole || teamRole.status !== 'active') {
      return false;
    }
    
    // Get permissions for this role
    const rolePerms = ROLE_PERMISSIONS[teamRole.role] || {};
    
    // Special check: cannot remove captain
    if (permission === 'canRemoveCaptain') {
      return user.userRole === USER_ROLES.LEAGUE_STAFF || user.userRole === USER_ROLES.ADMIN;
    }
    
    // Special check: only captain can manage staff
    if (permission === 'canManageStaff') {
      return teamRole.role === USER_ROLES.CAPTAIN;
    }
    
    return rolePerms[permission] || false;
  }
  
  // Default role-based check
  const rolePerms = ROLE_PERMISSIONS[user.userRole] || {};
  return rolePerms[permission] || false;
}

/**
 * Check if user can manage another user's role
 * @param {Object} currentUser - Current user profile
 * @param {Object} targetUser - Target user profile
 * @param {string} teamId - Team ID context
 * @returns {boolean}
 */
export function canManageUser(currentUser, targetUser, teamId) {
  // Admin can manage anyone
  if (currentUser.userRole === USER_ROLES.ADMIN) return true;
  
  // League staff can manage captains
  if (currentUser.userRole === USER_ROLES.LEAGUE_STAFF) return true;
  
  // Captain can manage team-staff for their team
  const currentUserTeamRole = currentUser.teamRoles?.[teamId];
  const targetUserTeamRole = targetUser.teamRoles?.[teamId];
  
  if (currentUserTeamRole?.role === USER_ROLES.CAPTAIN && 
      currentUserTeamRole?.status === 'active') {
    
    // Cannot remove another captain
    if (targetUserTeamRole?.role === USER_ROLES.CAPTAIN) {
      return false;
    }
    
    // Can manage team-staff
    return true;
  }
  
  return false;
}

// ========================================
// MIGRATION HELPER
// ========================================

/**
 * Migrate existing user to new role system
 * Run this once to migrate all existing users
 */
export async function migrateUserToNewRoleSystem(userId) {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const userData = userDoc.data();
    
    // Skip if already migrated
    if (userData.teamRoles && Object.keys(userData.teamRoles).length > 0) {
      console.log('ℹ️ User already migrated:', userId);
      return { success: true, message: 'Already migrated' };
    }
    
    const updates = {
      teamRoles: {},
      updatedAt: serverTimestamp()
    };
    
    // Determine role based on existing data
    if (userData.isCaptain && userData.linkedTeam) {
      updates.userRole = USER_ROLES.CAPTAIN;
      updates.teamRoles[userData.linkedTeam] = {
        role: USER_ROLES.CAPTAIN,
        approvedBy: 'system',
        approvedAt: serverTimestamp(),
        canBeRemovedBy: [],
        status: 'active'
      };
    } else if (userData.linkedPlayer && userData.linkedTeam) {
      updates.userRole = USER_ROLES.PLAYER;
    } else {
      updates.userRole = USER_ROLES.FAN;
    }
    
    // Initialize empty arrays if not present
    if (!userData.staffRequests) {
      updates.staffRequests = [];
    }
    
    if (!userData.preferences) {
      updates.preferences = {
        emailGameReminders: true,
        emailScoreUpdates: false,
        favoriteTeamNotifications: true,
        favoritePlayerAlerts: true,
        publicFavorites: false,
        defaultStatsView: 'season',
        defaultSeason: 'current'
      };
    }
    
    await updateDoc(doc(db, 'users', userId), updates);
    console.log('✅ User migrated to new role system:', userId);
    return { success: true, message: 'Migration successful' };
    
  } catch (error) {
    console.error('❌ Error migrating user:', error);
    return { success: false, error: error.code };
  }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function getErrorMessage(errorCode) {
  const errorMessages = {
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/operation-not-allowed': 'Operation not allowed.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed.',
    'auth/popup-blocked': 'Sign-in popup was blocked by your browser. Please allow popups for this site.'
  };
  return errorMessages[errorCode] || 'An error occurred. Please try again.';
}

export { auth };

// Make auth available globally for navigation component
if (typeof window !== 'undefined') {
  window.auth = auth;
}
