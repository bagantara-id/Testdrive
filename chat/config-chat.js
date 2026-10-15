// ==========================================================================
// FILE: chat/config-chat.js
// FUNGSI: Eksekutor Firebase Sekunder (dbChat - chatting-88040) & Tersier (dbRadar - futaqi-ali)
// ARSITEKTUR: ZERO-IDLE WEBSOCKET (Default Offline saat Inisialisasi Awal)
// ==========================================================================

import { configChat, configRadar } from '../js/config/credentials.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, goOffline } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Mesin 2: Khusus Ruang Obrolan Aktif (sesi_komunikasi & inbox_mitra)
const chatApp = initializeApp(configChat, "komunikasiEksternal");
export const dbChat = getDatabase(chatApp);

// Mesin 3: Khusus Penangkap Sinyal Pesanan Masuk (radar_tiket pada futaqi-ali)
const radarApp = initializeApp(configRadar, "radarTiketEksternal");
export const dbRadar = getDatabase(radarApp);

// Putus soket saat awal boot agar memakan 0 koneksi sebelum dibutuhkan
try { goOffline(dbChat); } catch (e) {}
try { goOffline(dbRadar); } catch (e) {}
