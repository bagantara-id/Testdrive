// ==========================================================================
// FILE: js/config/credentials.js
// FUNGSI: Gudang Kredensial Firebase (Pusat Failover/Backup)
// ==========================================================================

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
    },

    chatting: {
        apiKey: "AIzaSyArsaabjy6lr1lzYCBS__1IsjOnhntnzvE",
        authDomain: "chatting-88040.firebaseapp.com",
        databaseURL: "https://chatting-88040-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "chatting-88040",
        storageBucket: "chatting-88040.firebasestorage.app",
        messagingSenderId: "252383215816",
        appId: "1:252383215816:web:e029860517ce1ec77ea5fd"
    }
};

// SWITCHER MUTLAK: Ubah nilai ini jika server utama mengalami kendala
const MESIN_AKTIF = 'utama'; 

export const configAktif = firebaseMesin[MESIN_AKTIF];
export const configChat = firebaseMesin['chatting'];
