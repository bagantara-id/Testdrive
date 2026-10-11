// ==========================================================================
// FILE: js/core/firebase-config.js
// FUNGSI: Eksekutor Firebase SDK Utama (Menyedot data dari credentials.js)
// ==========================================================================

import { configAktif } from '../config/credentials.js'; 

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
// TAHAP FCM: Import modul Cloud Messaging & Penangkap Pesan Latar Depan
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

// VAPID Key untuk Autentikasi Push Notification Android/Chrome
export const VAPID_KEY = "BGbP91MFyrPG7qKUKRo8t1CBHCejXp8LOf55CmDCznPPgawrLG8RhKKy43OvSKiFraijY2BOIg99fachaOHIxqA";

// Inisialisasi menggunakan configAktif
const app = initializeApp(configAktif);
const auth = getAuth(app);
const dbFirestore = getFirestore(app);
const provider = new GoogleAuthProvider();
// Mengaktifkan mesin notifikasi
const messaging = getMessaging(app);

// Ekspor semua fungsi agar bisa digunakan oleh file auth.js
export { app, auth, dbFirestore, provider, messaging, getToken, onMessage };