// firebase-auth.js
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

import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

import { app, db } from './firebase-data.js';

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// ========================================
// AUTHENTICATION FUNCTIONS
// ========================================

export async function registerUser(email, password, displayName) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    await updateProfile(user, { displayName });
    await sendEmailVerification(user);
    
    await createUserProfile(user.uid, {
      email: user.email,
      displayName: displayName,
      createdAt: serverTimestamp(),
      emailVerified: false
    });
    
    console.log('✅ User registered:', displayName);
    return { success: true, user, message: 'Account created! Please check your email to verify.' };
  } catch (error) {
    console.error('❌ Registration error:', error.code, error);
    return { success: false, error: error.code, message: getErrorMessage(error.code) };
  }
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

// ========================================
// USER PROFILE FUNCTIONS
// ========================================

async function createUserProfile(userId, data) {
  const userRef = doc(db, 'users', userId);
  await setDoc(userRef, {
    ...data,
    linkedPlayer: null,
    linkedTeam: null,
    isCaptain: false,
    favoriteTeams: [],
    favoritePlayers: [],
    notificationsEnabled: true,
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
      displayName: playerName,  // ADD THIS LINE
	  linkedPlayer: playerName,
      linkedTeam: teamId,
      isCaptain: isCaptain,
      updatedAt: serverTimestamp()
    };
    
    if (existingPlayerData) {
        // CRITICAL FIX: Check for captain status in legacy profile
        if (existingPlayerData.role === 'captain' || existingPlayerData.isCaptain === true) {
          updateData.isCaptain = true;
          console.log('✅ Setting isCaptain = true from legacy profile');
        }
        
      if (existingPlayerData.favoriteTeams) updateData.favoriteTeams = existingPlayerData.favoriteTeams;
      if (existingPlayerData.favoritePlayers) updateData.favoritePlayers = existingPlayerData.favoritePlayers;
      if (existingPlayerData.stats) updateData.stats = existingPlayerData.stats;
      if (existingPlayerData.seasonStats) updateData.seasonStats = existingPlayerData.seasonStats;
      if (existingPlayerData.careerStats) updateData.careerStats = existingPlayerData.careerStats;
      if (existingPlayerData.role) updateData.role = existingPlayerData.role;
      if (existingPlayerData.currentTeam && !teamId) updateData.linkedTeam = existingPlayerData.currentTeam;
      
      updateData.mergedFromProfile = playerUserId;
      updateData.mergedAt = serverTimestamp();
      
      console.log('✅ Merging data from old profile');
    }
    
    await updateDoc(userRef, updateData);
    
      if (existingPlayerData && playerUserId) {
        try {
          const oldPlayerRef = doc(db, 'users', playerUserId);
          await setDoc(oldPlayerRef, {
            migrated: true,
            migratedTo: userId,
            migratedAt: serverTimestamp()
          }, { merge: true });
          console.log('✅ Marked legacy profile as migrated:', playerUserId);
        } catch (migrationError) {
          console.error('❌ Could not mark legacy profile as migrated:', migrationError);
        }
      }
    
    console.log('✅ Player linked to user:', playerName, 'Team:', teamId);
    return { success: true };
  } catch (error) {
    console.error('❌ Error linking player:', error);
    return { success: false, error: error.code };
  }
}

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