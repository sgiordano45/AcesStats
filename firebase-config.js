// firebase-config.js
// Firebase connection configuration for Mountainside Aces

// Import Firebase SDK from CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js';
import { 
  initializeFirestore,
  collection, 
  doc, 
  getDocs, 
  getDoc,
  query,
  where,
  orderBy,
  limit
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { getMessaging } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCAEWkrTcprzJ2KPPJu-vFJPvYOVU4ky20",
  authDomain: "acessoftballreference-84791.firebaseapp.com",
  projectId: "acessoftballreference-84791",
  storageBucket: "acessoftballreference-84791.firebasestorage.app",
  messagingSenderId: "777699560175",
  appId: "1:777699560175:web:4092b422e7d7116352e91a",
  measurementId: "G-1F8JKZH6DZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Google Analytics
const analytics = getAnalytics(app);

// Detect Safari for cache strategy
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// Initialize Firestore with appropriate cache based on browser
// Safari has issues with IndexedDB, so we use memory cache for better compatibility
const db = initializeFirestore(app, {
  cache: isSafari ? 
    { kind: 'MemoryLruCache', sizeBytes: 40 * 1024 * 1024 } : // 40 MB for Safari
    { kind: 'IndexedDbLruCache', sizeBytes: 100 * 1024 * 1024 } // 100 MB for other browsers
});

console.log(`✅ Firestore initialized with ${isSafari ? 'Memory' : 'IndexedDB'} cache`);

const storage = getStorage(app);

// Initialize Firebase Cloud Messaging
const messaging = getMessaging(app);

// Initialize Firebase Cloud Functions
const functions = getFunctions(app);

// VAPID key from Firebase Console
const VAPID_KEY = "BK39jgi3AT0p9jdaUBIPHz3vBkBg4YRvY-yMNuGMIJEhGbXTomDyKo77ug0hPYa10YBjJBM_GRBErlYp09cDSRw";

// Export everything other files will need
export { 
  app,
  db,
  storage,
  messaging,
  functions,
  analytics,
  VAPID_KEY,
  collection, 
  doc, 
  getDocs, 
  getDoc,
  query,
  where,
  orderBy,
  limit
};
