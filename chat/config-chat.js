// ==========================================================================
// FILE: chat/config-chat.js
// FUNGSI: Eksekutor Firebase Sekunder Khusus Chat
// ==========================================================================

// Mengambil kredensial chat dari folder js/config
import { configChat } from '../js/config/credentials.js'; 

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Inisialisasi menggunakan configChat dengan namespace "komunikasiEksternal"
const chatApp = initializeApp(configChat, "komunikasiEksternal");
const dbChat = getDatabase(chatApp);

export { chatApp, dbChat };
