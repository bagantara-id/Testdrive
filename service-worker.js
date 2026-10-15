// ==========================================================================
// FILE: service-worker.js
// FUNGSI: Pengendali Jaringan, Dual-Cache Isolasi Peta, & Notifikasi FCM
// ==========================================================================

importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// Sinkronisasi Kamus Failover (Menyelaraskan dengan credentials.js)
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
        vibrate: [500, 200, 500, 200, 500, 200, 500],
        requireInteraction: true,
        data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Aksi ketika notifikasi diklik oleh pengemudi
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});

// SPESIFIKASI 1.2: Isolasi Cache Statis dan Cache Tile Peta
const CACHE_STATIC = 'bagantara-driver-v7-static';
const CACHE_TILES = 'bagantara-map-tiles-v1';

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
        caches.open(CACHE_STATIC).then((cache) => {
            console.log('[SW] Menyimpan aset statis ke dalam CACHE_STATIC...');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// 2. Pembersihan Cache Lama dengan Mempertahankan CACHE_STATIC & CACHE_TILES
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_STATIC && cache !== CACHE_TILES) {
                        console.log('[SW] Memusnahkan cache usang:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. Strategi Fetch Hibrida: Pure Cache-First (Tile Peta) & Stale-While-Revalidate (Aset Statis)
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const reqUrl = event.request.url;

    // FILTER MUTLAK: Abaikan Cloudinary, Ipify, & Firebase Database/Firestore API
    if (reqUrl.includes('firestore.googleapis.com') ||
        reqUrl.includes('firebasedatabase.app') ||
        reqUrl.includes('cloudinary.com') ||
        reqUrl.includes('ipify.org')) {
        return;
    }

    // SPESIFIKASI 1.2 & 4: KEY-AGNOSTIC PURE CACHE-FIRST untuk Multi-CDN Tile Peta & MapTiler BYOK
    if (reqUrl.includes('api.maptiler.com') ||
        reqUrl.includes('arcgisonline.com') ||
        reqUrl.includes('tile.openstreetmap')) {
        // Lewati cache untuk pre-flight validator token (cache: 'no-store' atau tile uji /256/0/0/0.png)
        if (event.request.cache === 'no-store' || reqUrl.includes('/256/0/0/0.png')) {
            return;
        }

        let cacheKey = event.request;
        if (reqUrl.includes('api.maptiler.com')) {
            const urlObj = new URL(event.request.url);
            urlObj.searchParams.delete('key');
            cacheKey = urlObj.toString();
        }

        event.respondWith(
            caches.match(cacheKey).then((cachedTile) => {
                if (cachedTile) {
                    return cachedTile;
                }
                return fetch(event.request).then((networkResponse) => {
                    const isValidTile = reqUrl.includes('api.maptiler.com')
                        ? (networkResponse && networkResponse.status === 200)
                        : (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque'));

                    if (isValidTile) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_TILES).then((cache) => {
                            cache.put(cacheKey, responseClone);
                        });
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // Strategi Stale-While-Revalidate untuk Aset Statis Aplikasi
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_STATIC).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {});

            return cachedResponse || fetchPromise;
        })
    );
});