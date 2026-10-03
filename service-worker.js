// ==========================================================================
// FILE: service-worker.js
// FUNGSI: Pengendali Jaringan & Cache PWA Modular
// ==========================================================================

// UBAH NAMA CACHE (Penting: agar browser tahu ada struktur folder baru dan membuang cache lama)
const CACHE_NAME = 'bagantara-driver-v2-modular'; 

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  
  // Aset CSS
  './css/style.css',
  './css/components.css',
  './css/hud-style.css',
  './chat/theme-chat.css',
  
  // Aset Utilitas & Konfigurasi
  './js/config/credentials.js',
  './js/utils/math-engine.js',
  './js/utils/ui-components.js',
  
  // Aset Inti & Modul
  './js/core/firebase-config.js',
  './js/core/auth.js',
  './js/modules/dashboard.js',
  './js/modules/gps-engine.js',
  './js/modules/hud-console.js',
  
  // Aset Modul Terisolasi (Chat & Radar)
  './chat/config-chat.js',
  './chat/app-chat.js',
  './chat/radar-tiket.js',
  './chat/cloud-media.js',

  // Media & Ikon
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/logo.png',
  './assets/pin_standby.png',
  './assets/pin-gps.png'
];

// 1. Proses Instalasi Mesin PWA
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Sistem latar belakang menyerap cache operasional modular...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. Pembersihan Cache Lama saat ada pembaruan arsitektur
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Memusnahkan cache usang:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Strategi Network-First dengan Fallback Offline
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // FILTER MUTLAK: Abaikan Cloudinary & Firebase Database API
  if (event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('firebasedatabase.app') ||
      event.request.url.includes('cloudinary.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
