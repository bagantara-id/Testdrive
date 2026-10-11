// ==========================================================================
// FILE: chat/config-chat.js
// FUNGSI: Eksekutor Firebase Sekunder Khusus Chat
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// HARDCODE KREDENSIAL: Memastikan Driver terhubung ke Database Chat yang SAMA PERSIS dengan Klien
const firebaseConfigChat = {
  apiKey: "AIzaSyArsaabjy6lr1lzYCBS__1IsjOnhntnzvE",
  authDomain: "chatting-88040.firebaseapp.com",
  databaseURL: "https://chatting-88040-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "chatting-88040",
  storageBucket: "chatting-88040.firebasestorage.app",
  messagingSenderId: "252383215816",
  appId: "1:252383215816:web:e029860517ce1ec77ea5fd"
};

const chatApp = initializeApp(firebaseConfigChat, "komunikasiEksternal");
export const dbChat = getDatabase(chatApp);
