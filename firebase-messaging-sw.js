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

// Handle SKIP_WAITING message to activate service worker immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Background message received:', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon-192.png', // Your app icon
    badge: '/badge-72.png',
    tag: payload.data.type || 'default', // Prevent duplicate notifications
    data: payload.data, // Custom data for click handling
    requireInteraction: payload.data.priority === 'high', // Stay visible until clicked
    actions: payload.data.actions ? JSON.parse(payload.data.actions) : []
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
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