// ==========================================================================
// FILE: service-worker.js
// FUNGSI: Pengendali Jaringan (Network-First untuk Kode Agar Tidak Perlu Hapus Data),
//         Dual-Cache Isolasi Peta (Cache-First Hemat Kuota Tile), Bypass Real-Time 3 RTDB,
//         & Jembatan Pemicu Sirine Latar Belakang (FCM + Push Wake-Up Bridge)
// ==========================================================================

importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

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

const MESIN_AKTIF = 'utama';

firebase.initializeApp(firebaseMesin[MESIN_AKTIF]);

const messaging = firebase.messaging();

// Fungsi pembangun sinyal ke seluruh tab Driver yang sedang di latar belakang (sedang buka aplikasi lain)
async function bangunkanTabDriverDiBackground(payloadData) {
    try {
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (let i = 0; i < windowClients.length; i++) {
            windowClients[i].postMessage({
                type: 'BGT_FCM_BACKGROUND_WAKEUP',
                data: payloadData || {}
            });
        }
    } catch (e) {}
}

// Menangkap Push Notification saat aplikasi tertutup / sedang membuka aplikasi lain
messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    const isChatMsg = data.type === 'CHAT_MESSAGE' || data.type === 'SONAR_PING';
    const notificationTitle = payload.notification?.title || data.title || (isChatMsg ? '💬 PESAN / PANGGILAN PENUMPANG!' : '🚨 ORDER BARU MASUK!');
    const notificationBody = payload.notification?.body || data.body || 'Ketuk untuk membuka aplikasi Driver Bagantara.';

    const notificationOptions = {
        body: notificationBody,
        icon: './assets/icon-192.png',
        badge: './assets/icon-192.png',
        tag: data.idTiket ? `bgt-${data.type || 'order'}-${data.idTiket}` : 'bgt-order-alert',
        renotify: true,
        vibrate: [600, 200, 600, 200, 800, 200, 600],
        requireInteraction: true,
        actions: [
            { action: 'open_cockpit', title: '⚡ BUKA KOKPIT SEKARANG' }
        ],
        data: data
    };

    bangunkanTabDriverDiBackground(data);
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Intersep level-rendah event 'push' agar meskipun FCM membawa objek notification, tab background tetap dibangunkan untuk memutar Sirine Web Audio!
self.addEventListener('push', (event) => {
    if (!event.data) return;
    try {
        const raw = event.data.json();
        const data = raw.data || {};
        event.waitUntil(bangunkanTabDriverDiBackground(data));
    } catch (e) {}
});

// Aksi ketika notifikasi diklik oleh pengemudi saat sedang membuka aplikasi lain
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const notifData = event.notification.data || {};

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url && 'focus' in client) {
                    client.postMessage({ type: 'BGT_FCM_ORDER_CLICK', data: notifData });
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('./index.html');
            }
        })
    );
});

const CACHE_STATIC = 'bagantara-driver-v8-static-r3';
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

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_STATIC).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_STATIC && cache !== CACHE_TILES) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const reqUrl = event.request.url;

    // FILTER MUTLAK: Abaikan futaqi-ali, chatting-88040, bagantara-core, OSRM, Cloudinary, Ipify, & Firestore API agar selalu 100% Real-Time
    if (reqUrl.includes('futaqi-ali') ||
        reqUrl.includes('chatting-88040') ||
        reqUrl.includes('bagantara-core') ||
        reqUrl.includes('firestore.googleapis.com') ||
        reqUrl.includes('firebasedatabase.app') ||
        reqUrl.includes('project-osrm.org') ||
        reqUrl.includes('cloudinary.com') ||
        reqUrl.includes('ipify.org')) {
        return;
    }

    // 1. Tile Peta tetap menggunakan Cache-First untuk menghemat kuota MapTiler/OSM secara maksimal
    if (reqUrl.includes('api.maptiler.com') ||
        reqUrl.includes('arcgisonline.com') ||
        reqUrl.includes('tile.openstreetmap')) {
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

    // 2. Strategi NETWORK-FIRST untuk file kode (.html, .js, .css, .json) agar setiap update langsung aktif real-time tanpa perlu Hapus Data!
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_STATIC).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});
