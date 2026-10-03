// ==========================================================================
// FILE: app.js (ROOT DIRECTORY)
// FUNGSI: Entry-Point Tunggal, Inisialisasi PWA, & Pemanggilan Sekuensial
// ==========================================================================

// 1. Registrasi Service Worker (Proteksi Luring & Cache Ekosistem)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('[SISTEM] Service Worker Aktif di ruang lingkup:', reg.scope))
            .catch(err => console.error('[SISTEM] Gagal menghidupkan Service Worker:', err));
    });
}

// 2. Injeksi Komponen UI Global (Dieksekusi Paling Awal)
import './js/utils/ui-components.js';

// 3. Pemanggilan Modul Utama Secara Sekuensial (Anti Race-Condition)
// Modul dieksekusi berurutan: Config -> Auth -> Dashboard -> HUD Telemetri
import './js/core/firebase-config.js';
import './js/core/auth.js';
import './js/modules/dashboard.js';
import './js/modules/hud-console.js';
