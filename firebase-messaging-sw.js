// firebase-messaging-sw.js
// This file handles background notifications (when app is not open)

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Initialize Firebase in service worker with YOUR actual config
firebase.initializeApp({
  apiKey: "AIzaSyCAEWkrTcprzJ2KPPJu-vFJPvYOVU4ky20",
  authDomain: "acessoftballreference-84791.firebaseapp.com",
  projectId: "acessoftballreference-84791",
  storageBucket: "acessoftballreference-84791.firebasestorage.app",
  messagingSenderId: "777699560175",
  appId: "1:777699560175:web:4092b422e7d7116352e91a"
});

const messaging = firebase.messaging();

// Install event - claim immediately
self.addEventListener('install', (event) => {
  console.log('Service worker installing...');
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - take control immediately
self.addEventListener('activate', (event) => {
  console.log('Service worker activating...');
  // Take control of all clients immediately
  event.waitUntil(self.clients.claim());
  console.log('Service worker activated and ready!');
});

// Handle SKIP_WAITING message to activate service worker immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Background message received:', payload);
  console.log('Payload structure:', JSON.stringify(payload, null, 2));
  
  try {
    // Safely extract notification data with fallbacks
    const notificationTitle = payload.notification?.title || payload.data?.title || 'Mountainside Aces';
    const notificationBody = payload.notification?.body || payload.data?.body || 'New notification';
    
    console.log('Creating notification with title:', notificationTitle);
    console.log('Creating notification with body:', notificationBody);
    
    const notificationOptions = {
      body: notificationBody,
      icon: '/icon-192.png', // Your app icon (optional, won't fail if missing)
      badge: '/badge-72.png', // Small icon (optional)
      tag: payload.data?.type || 'default', // Prevent duplicate notifications
      data: payload.data || {}, // Custom data for click handling
      requireInteraction: false, // Don't require user interaction
      vibrate: [200, 100, 200], // Vibration pattern
      timestamp: Date.now()
    };
    
    console.log('Showing notification with options:', notificationOptions);
    
    return self.registration.showNotification(notificationTitle, notificationOptions)
      .then(() => {
        console.log('✅ Notification displayed successfully');
      })
      .catch(error => {
        console.error('❌ Failed to show notification:', error);
        // Try a minimal notification as fallback
        return self.registration.showNotification(notificationTitle, {
          body: notificationBody
        });
      });
  } catch (error) {
    console.error('❌ Error in onBackgroundMessage:', error);
    // Last resort: show a basic notification
    return self.registration.showNotification('Mountainside Aces', {
      body: 'You have a new notification'
    });
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  event.notification.close();

  const clickAction = event.notification.data.clickAction || '/';
  
  // Open the app and navigate to relevant page
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it and navigate
        for (const client of clientList) {
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              url: clickAction
            });
            return client.focus();
          }
        }
        // Otherwise, open new window
        if (clients.openWindow) {
          return clients.openWindow(clickAction);
        }
      })
  );
});