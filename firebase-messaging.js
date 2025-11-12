// firebase-messaging.js
// Functions for managing push notifications

import { messaging, VAPID_KEY } from './firebase-config.js';
import { db } from './firebase-config.js';
import { getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';
import { doc, updateDoc, setDoc, getDoc, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
/**
 * Register the Firebase Messaging service worker
 */
export async function registerMessagingServiceWorker() {
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('Firebase Messaging Service Worker registered:', registration);
      return registration;
    }
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    throw error;
  }
}

/**
 * Request notification permission and get FCM token
 * @param {string} userId - Current user's ID
 * @returns {Promise<string|null>} FCM token or null if denied
 */
export async function requestNotificationPermission(userId) {
  try {
    // Check if notifications are supported
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications');
      return null;
    }

    // CRITICAL: Register and wait for service worker BEFORE getting token
    console.log('Ensuring service worker is registered...');
    const registration = await registerMessagingServiceWorker();
    
    // Wait for service worker to be active with timeout
    if (registration.installing) {
      console.log('Service worker is installing, waiting for activation...');
      
      // Try to skip waiting first
      registration.installing.postMessage({ type: 'SKIP_WAITING' });
      
      // Wait for activation with 10 second timeout
      await Promise.race([
        new Promise(resolve => {
          registration.installing.addEventListener('statechange', (e) => {
            console.log('Service worker state changed to:', e.target.state);
            if (e.target.state === 'activated') {
              console.log('✅ Service worker activated');
              resolve();
            }
            if (e.target.state === 'redundant') {
              console.warn('Service worker became redundant, will retry');
              resolve(); // Continue anyway
            }
          });
        }),
        new Promise(resolve => setTimeout(() => {
          console.warn('⚠️ Service worker activation timeout - continuing anyway');
          resolve();
        }, 10000))
      ]);
    } else if (registration.waiting) {
      console.log('Service worker is waiting, activating now...');
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      await new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('✅ Controller changed, service worker activated');
          resolve();
        }, { once: true });
        // Timeout fallback
        setTimeout(resolve, 5000);
      });
    } else if (registration.active) {
      console.log('✅ Service worker already active');
    }
    
    console.log('✅ Service worker is ready');

    // Check if already granted
    if (Notification.permission === 'granted') {
      return await getAndSaveToken(userId);
    }

    // Request permission
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      console.log('Notification permission granted');
      return await getAndSaveToken(userId);
    } else {
      console.log('Notification permission denied');
      return null;
    }
  } catch (error) {
    console.error('❌ Error requesting notification permission:', error);
    // Re-throw the error so the UI can display it
    throw error;
  }
}

/**
 * Get FCM token and save to user profile
 * @param {string} userId - Current user's ID
 * @returns {Promise<string>} FCM token
 */
async function getAndSaveToken(userId) {
  try {
    console.log('📝 Getting FCM token for user:', userId);
    
    // Get FCM token
    const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
    
    if (currentToken) {
      console.log('✅ FCM Token obtained:', currentToken.substring(0, 20) + '...');
      
      // Save token to user profile
      await saveFCMToken(userId, currentToken);
      
      console.log('✅ Token saved successfully');
      return currentToken;
    } else {
      console.warn('⚠️ No FCM token available - check service worker and VAPID key');
      return null;
    }
  } catch (error) {
    console.error('❌ Error getting FCM token:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Save FCM token to user's Firestore profile
 * @param {string} userId - Current user's ID
 * @param {string} token - FCM token
 */
export async function saveFCMToken(userId, token) {
  try {
    const userRef = doc(db, 'users', userId);
    
    // Use setDoc with merge to create document if it doesn't exist
    await setDoc(userRef, {
      fcmTokens: arrayUnion(token), // Store as array (users may have multiple devices)
      lastTokenUpdate: new Date().toISOString(),
      notificationsEnabled: true
    }, { merge: true }); // CRITICAL: merge creates doc if missing, updates if exists
    
    console.log('✅ FCM token saved to user profile');
  } catch (error) {
    console.error('❌ Error saving FCM token:', error);
    throw error;
  }
}

/**
 * Remove FCM token from user profile (when disabling notifications)
 * @param {string} userId - Current user's ID
 * @param {string} token - FCM token to remove
 */
export async function removeFCMToken(userId, token) {
  try {
    const userRef = doc(db, 'users', userId);
    
    // Check if document exists first
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.warn('User document does not exist, nothing to remove');
      return;
    }
    
    const userData = userDoc.data();
    const currentTokens = userData.fcmTokens || [];
    
    // Remove the specific token
    const updatedTokens = currentTokens.filter(t => t !== token);
    
    // Update document with new tokens array and disable flag if no tokens left
    await setDoc(userRef, {
      fcmTokens: updatedTokens,
      notificationsEnabled: updatedTokens.length > 0, // Only disable if no tokens left
      lastTokenUpdate: new Date().toISOString()
    }, { merge: true });
    
    console.log('✅ FCM token removed from user profile');
  } catch (error) {
    console.error('❌ Error removing FCM token:', error);
    throw error;
  }
}

/**
 * Disable all notifications and remove ALL FCM tokens
 * This is more reliable than calling removeFCMToken in a loop
 * @param {string} userId - Current user's ID
 */
export async function disableAllNotifications(userId) {
  try {
    const userRef = doc(db, 'users', userId);
    
    console.log('🔕 Disabling all notifications for user:', userId);
    
    // Check if document exists first
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.warn('⚠️ User document does not exist, nothing to disable');
      return { success: true, message: 'No notifications to disable' };
    }
    
    const currentTokens = userDoc.data()?.fcmTokens || [];
    console.log(`📝 Removing ${currentTokens.length} token(s)`);
    
    // Clear all tokens and disable notifications in ONE operation
    await setDoc(userRef, {
      fcmTokens: [],  // Clear all tokens at once
      notificationsEnabled: false,
      lastTokenUpdate: new Date().toISOString()
    }, { merge: true });
    
    console.log('✅ All notifications disabled and tokens removed');
    return { success: true, message: 'Notifications disabled successfully' };
  } catch (error) {
    console.error('❌ Error disabling all notifications:', error);
    throw error;
  }
}

/**
 * Listen for foreground messages (when app is open)
 */
export function onForegroundMessage(callback) {
  return onMessage(messaging, (payload) => {
    console.log('Foreground message received:', payload);
    
    // Show notification even when app is open
    if (Notification.permission === 'granted') {
      new Notification(payload.notification.title, {
        body: payload.notification.body,
        icon: '/icon-192.png',
        tag: payload.data.type || 'default',
        data: payload.data
      });
    }
    
    // Call custom callback for app-specific handling
    if (callback) {
      callback(payload);
    }
  });
}

/**
 * Update notification preferences in Firestore
 * @param {string} userId - Current user's ID
 * @param {object} preferences - Notification preference settings
 */
export async function updateNotificationPreferences(userId, preferences) {
  try {
    const userRef = doc(db, 'users', userId);
    
    await updateDoc(userRef, {
      notificationPreferences: preferences
    });
    
    console.log('Notification preferences updated');
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    throw error;
  }
}