// ==========================================================================
// FILE: app.js (ROOT DIRECTORY)
// FUNGSI: Entry-Point Tunggal, Inisialisasi PWA, & Pemanggilan Sekuensial
// ==========================================================================

// FASE 2 PERBAIKAN: Registrasi Service Worker ganda di sini dihapus secara total 
// untuk menghindari bentrokan (race-condition) dengan modul FCM di auth.js.

// 1. Injeksi Komponen UI Global (Dieksekusi Paling Awal)
import './js/utils/ui-components.js';

// 2. Pemanggilan Modul Utama Secara Sekuensial (Anti Race-Condition)
// Modul dieksekusi berurutan: Config -> Auth -> Dashboard -> HUD Telemetri
import './js/core/firebase-config.js';
import './js/core/auth.js';
import './js/modules/dashboard.js';
import './js/modules/hud-console.js';
import './chat/app-chat.js';
import './chat/radar-tiket.js';