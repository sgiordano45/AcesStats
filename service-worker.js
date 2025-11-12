// service-worker.js - Offline Functionality for Mountainside Aces
// Version 1.0.2 - Reduced console noise from cache-first fallbacks

const CACHE_VERSION = 'aces-v1.0.2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// Base path for GitHub Pages subdirectory deployment
const BASE_PATH = '';

// Critical files that should always be cached
const STATIC_ASSETS = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/style.css`,
  `${BASE_PATH}/mobile-enhancements.css`,
  `${BASE_PATH}/firebase-auth.js`,
  `${BASE_PATH}/firebase-data.js`,
  `${BASE_PATH}/firebase-roster.js`,
  `${BASE_PATH}/nav-component.js`,
  `${BASE_PATH}/nav-config.js`,
  `${BASE_PATH}/nav-styles.css`,
  `${BASE_PATH}/current-season.html`,
  `${BASE_PATH}/weekend-preview.html`,
  `${BASE_PATH}/batting.html`,
  `${BASE_PATH}/signin.html`,
  `${BASE_PATH}/signup.html`,
   `${BASE_PATH}/submit-scores.html`,
	`${BASE_PATH}/submit-stats.html`,
	`${BASE_PATH}/league-history.html`,
	`${BASE_PATH}/offseason.html`,
	`${BASE_PATH}/offseason-roster.html`,
	`${BASE_PATH}/schedule-generator.html`,
  `${BASE_PATH}/profile.html`,
  `${BASE_PATH}/profile-fan.html`,
   `${BASE_PATH}/awards.html`,
  `${BASE_PATH}/league-rules.html`,
  `${BASE_PATH}/verify-email.html`,
  `${BASE_PATH}/reset-password.html`,
  `${BASE_PATH}/link-player.html`,
  `${BASE_PATH}/teams.html`,
  `${BASE_PATH}/players.html`,
  `${BASE_PATH}/offline.html`
];

// Firebase and external resources
const EXTERNAL_RESOURCES = [
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js'
];

// Install event - cache static assets with better error handling
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(async (cache) => {
        console.log('[SW] Caching static assets...');
        
        // Try to cache each asset individually to identify failures
        const allAssets = [...STATIC_ASSETS, ...EXTERNAL_RESOURCES];
        const cachePromises = allAssets.map(async (asset) => {
          try {
            await cache.add(asset);
            console.log(`[SW] ✅ Cached: ${asset}`);
          } catch (error) {
            console.error(`[SW] ❌ Failed to cache: ${asset}`, error);
            // Don't fail the entire installation if one asset fails
          }
        });
        
        await Promise.allSettled(cachePromises);
        console.log('[SW] Static asset caching complete (with possible failures)');
      })
      .then(() => {
        console.log('[SW] Service worker installation complete');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('[SW] Critical error during installation:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Delete caches that don't match current version
              return cacheName.startsWith('aces-') && 
                     !cacheName.startsWith(CACHE_VERSION);
            })
            .map((cacheName) => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// Fetch event - serve from cache or network with strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // Only handle requests for our app (not other origins)
  if (!url.pathname.startsWith(BASE_PATH) && !isExternalResource(url)) {
    return;
  }

  // Strategy 1: Cache-first for static assets
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Strategy 2: Cache-first for images
  if (isImageRequest(url)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Strategy 3: Network-first for Firebase API calls
  if (isFirebaseRequest(url)) {
    event.respondWith(networkFirst(request, DYNAMIC_CACHE));
    return;
  }

  // Strategy 4: Network-first with offline fallback for HTML pages
  if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
    event.respondWith(networkFirstWithOfflinePage(request));
    return;
  }

  // Default: Network-first
  event.respondWith(networkFirst(request, DYNAMIC_CACHE));
});

// Cache-first strategy: Try cache, fallback to network
async function cacheFirst(request, cacheName) {
  // First, check cache
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // Not in cache, try network
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Network failed, try cache one more time (in case it was added while we were fetching)
    const fallbackCache = await caches.match(request);
    if (fallbackCache) {
      return fallbackCache;
    }
    
    // Only log error if BOTH network and cache failed
    console.error('[SW] Cache-first failed (no cache and no network):', request.url);
    throw error;
  }
}

// Network-first strategy: Try network, fallback to cache
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Network-first with offline fallback page
async function networkFirstWithOfflinePage(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, checking cache:', request.url);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline fallback page
    const offlinePage = await caches.match(`${BASE_PATH}/offline.html`);
    if (offlinePage) {
      return offlinePage;
    }

    throw error;
  }
}

// Helper: Check if request is for a static asset
function isStaticAsset(url) {
  return STATIC_ASSETS.some(asset => url.pathname === asset);
}

// Helper: Check if request is for an external resource
function isExternalResource(url) {
  return EXTERNAL_RESOURCES.some(resource => url.href.startsWith(resource));
}

// Helper: Check if request is for an image
function isImageRequest(url) {
  return url.pathname.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/i);
}

// Helper: Check if request is for Firebase
function isFirebaseRequest(url) {
  return url.hostname.includes('firebaseio.com') ||
         url.hostname.includes('googleapis.com') ||
         url.hostname.includes('firestore.googleapis.com');
}

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_URLS') {
    const urlsToCache = event.data.urls;
    caches.open(DYNAMIC_CACHE).then((cache) => {
      cache.addAll(urlsToCache);
    });
  }
});

// Background sync for queued actions
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-queue') {
    event.waitUntil(syncQueuedActions());
  }
});

// Sync queued actions when back online
async function syncQueuedActions() {
  try {
    // Get queued actions from IndexedDB
    const db = await openDatabase();
    const queue = await getQueuedActions(db);

    console.log(`[SW] Syncing ${queue.length} queued actions`);

    for (const action of queue) {
      try {
        await processQueuedAction(action);
        await removeFromQueue(db, action.id);
        console.log('[SW] Synced action:', action.type);
      } catch (error) {
        console.error('[SW] Failed to sync action:', action.type, error);
      }
    }

    // Notify app that sync is complete
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        syncedCount: queue.length
      });
    });
  } catch (error) {
    console.error('[SW] Background sync failed:', error);
  }
}

// Helper functions for IndexedDB queue
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AcesOfflineQueue', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function getQueuedActions(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['queue'], 'readonly');
    const store = transaction.objectStore('queue');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function removeFromQueue(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['queue'], 'readwrite');
    const store = transaction.objectStore('queue');
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function processQueuedAction(action) {
  // This would call the appropriate Firebase function
  // based on the action type (RSVP, lineup update, etc.)
  switch (action.type) {
    case 'RSVP':
      // Call Firebase RSVP function
      break;
    case 'LINEUP_UPDATE':
      // Call Firebase lineup function
      break;
    default:
      console.warn('[SW] Unknown action type:', action.type);
  }
}