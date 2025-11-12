// firebase-config.js
// Firebase connection configuration for Mountainside Aces

// Import Firebase SDK from CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  query,
  where,
  orderBy,
  limit,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCAEWkrTcprzJ2KPPJu-vFJPvYOVU4ky20",
  authDomain: "acessoftballreference-84791.firebaseapp.com",
  projectId: "acessoftballreference-84791",
  storageBucket: "acessoftballreference-84791.firebasestorage.app",
  messagingSenderId: "777699560175",
  appId: "1:777699560175:web:4092b422e7d7116352e91a"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// ADD THIS: Initialize Firebase Cloud Messaging
import { getMessaging, getToken, onMessage } from "firebase/messaging";
const messaging = getMessaging(app);

// VAPID key from Firebase Console
const VAPID_KEY = "BK39jgi3AT0p9jdaUBIPHz3vBkBg4YRvY-yMNuGMIJEhGbXTomDyKo77ug0hPYa10YBjJBM_GRBErlYp09cDSRw";

// ✨ ENABLE OFFLINE PERSISTENCE ✨
// This allows Firestore data to be cached locally and available offline
enableIndexedDbPersistence(db)
  .then(() => {
    console.log('✅ Firebase offline persistence enabled');
  })
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      // Multiple tabs open, persistence can only be enabled in one tab at a time
      console.warn('⚠️ Multiple tabs open - persistence enabled in first tab only');
    } else if (err.code === 'unimplemented') {
      // Browser doesn't support persistence
      console.warn('⚠️ Browser doesn\'t support offline persistence');
    } else {
      console.error('❌ Failed to enable persistence:', err);
    }
  });

// Export everything other files will need
export { 
  app,
  db,
  storage,
  collection, 
  doc, 
  getDocs, 
  getDoc,
  query,
  where,
  orderBy,
  limit
};