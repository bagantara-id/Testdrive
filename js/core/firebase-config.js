// ==========================================================================
// FILE: js/core/firebase-config.js
// FUNGSI: Eksekutor Firebase SDK Utama (Menyedot data dari credentials.js)
// ==========================================================================

// Mengambil kredensial dari folder config (naik satu tingkat dari core)
import { configAktif } from '../config/credentials.js'; 

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Inisialisasi menggunakan configAktif
const app = initializeApp(configAktif);
const auth = getAuth(app);
const dbFirestore = getFirestore(app);
const provider = new GoogleAuthProvider();

export { app, auth, dbFirestore, provider };
