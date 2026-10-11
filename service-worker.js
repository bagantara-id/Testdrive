// ==========================================================================
// FILE: service-worker.js
// FUNGSI: Pengendali Jaringan, Cache PWA, & Penerima Notifikasi FCM
// ==========================================================================

importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// FASE 3: Sinkronisasi Kamus Failover (Menyelaraskan dengan credentials.js)
const firebaseMesin = {
    utama: {
        apiKey: "AIzaSyCRIAiHzzkl-yTtC2fTbvh-vtC2jm1Sbvo",
        authDomain: "bagantara-core.firebaseapp.com",
        databaseURL: "https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "bagantara-core",
        storageBucket: "bagantara-core.firebasestorage.app",
        messagingSenderId: "760632276621",
        appId: "1:760632276621:web:1a2758755056e9ff7ed4c4"
    },
    cadangan_1: {
        apiKey: "CONTOH_API_KEY_CADANGAN",
        authDomain: "bagantara-backup.firebaseapp.com",
        databaseURL: "https://bagantara-backup-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "bagantara-backup",
        storageBucket: "bagantara-backup.firebasestorage.app",
        messagingSenderId: "1234567890",
        appId: "1:1234567890:web:abcdef123456"
    }
};

// SWITCHER MUTLAK: Pastikan nilai ini sama dengan yang ada di credentials.js
const MESIN_AKTIF = 'utama'; 

// Inisialisasi Firebase murni di latar belakang menggunakan mesin dinamis
firebase.initializeApp(firebaseMesin[MESIN_AKTIF]);

const messaging = firebase.messaging();

// Menangkap Push Notification saat aplikasi tertutup / di latar belakang
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM SW] Menerima pesan latar belakang: ', payload);
    
    const notificationTitle = payload.notification?.title || '🚨 ORDER MASUK!';
    const notificationOptions = {
        body: payload.notification?.body || 'Segera buka aplikasi untuk melihat pesanan.',
        icon: './assets/icon-192.png',
        badge: './assets/icon-192.png',
        vibrate: [500, 200, 500, 200, 500, 200, 500], // Getaran panjang, putus-putus, & agresif
        requireInteraction: true, // Notifikasi menempel di layar sampai diklik pengemudi
        data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Aksi ketika notifikasi diklik oleh pengemudi
self.addEventListener('notificationclick', (event) => {
    event.notification.close(); // Tutup kotak notifikasi
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Jika aplikasi sudah terbuka di latar belakang, tarik ke depan (fokuskan)
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // Jika aplikasi tertutup total, buka PWA dari awal
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});

// FASE 3: UBAH NAMA CACHE menjadi v5 untuk memicu pembaruan paksa di HP pengemudi
const CACHE_NAME = 'bagantara-driver-v5-fcm'; 

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  
  // Aset CSS
  './css/style.css',
  './css/components.css',
  './css/hud-style.css',
  './chat/theme-chat-driver.css',
  
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

// 3. Strategi Stale-While-Revalidate (Anti-Blank & Zero-Latency)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // FILTER MUTLAK: Abaikan Cloudinary & Firebase Database API
  if (event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('firebasedatabase.app') ||
      event.request.url.includes('cloudinary.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Eksekusi pengambilan file terbaru dari server di latar belakang
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      }).catch(() => {
        // Abaikan error secara senyap jika driver murni offline
      });

      // Kembalikan cache seketika jika ada (0 ms loading), jika cache kosong baru tunggu jaringan
      return cachedResponse || fetchPromise;
    })
  );
});