// firebase-messaging.js
// Functions for managing push notifications

import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";

const messaging = getMessaging();
const VAPID_KEY = "BK39jgi3AT0p9jdaUBIPHz3vBkBg4YRvY-yMNuGMIJEhGbXTomDyKo77ug0hPYa10YBjJBM_GRBErlYp09cDSRw";

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
    console.error('Error requesting notification permission:', error);
    return null;
  }
}

/**
 * Get FCM token and save to user profile
 * @param {string} userId - Current user's ID
 * @returns {Promise<string>} FCM token
 */
async function getAndSaveToken(userId) {
  try {
    // Get FCM token
    const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
    
    if (currentToken) {
      console.log('FCM Token:', currentToken);
      
      // Save token to user profile
      await saveFCMToken(userId, currentToken);
      
      return currentToken;
    } else {
      console.warn('No FCM token available');
      return null;
    }
  } catch (error) {
    console.error('Error getting FCM token:', error);
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
    
    await updateDoc(userRef, {
      fcmTokens: arrayUnion(token), // Store as array (users may have multiple devices)
      lastTokenUpdate: new Date().toISOString(),
      notificationsEnabled: true
    });
    
    console.log('FCM token saved to user profile');
  } catch (error) {
    console.error('Error saving FCM token:', error);
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
    
    await updateDoc(userRef, {
      fcmTokens: arrayRemove(token),
      notificationsEnabled: false
    });
    
    console.log('FCM token removed from user profile');
  } catch (error) {
    console.error('Error removing FCM token:', error);
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