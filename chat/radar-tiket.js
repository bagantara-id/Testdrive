// ==========================================================================
// FILE: chat/radar-tiket.js
// FUNGSI: Mesin Radar, Web Audio Synth, & Background Media Hijack
// ARSITEKTUR: Background Microservice & Zero-Latency Routing
// ==========================================================================

import { dbChat } from './config-chat.js';
import { ref, onChildAdded, remove, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

let referensiRadar = null;
let uidDriverAktif = null;
let pemantauRadar = null; 

// =======================================================================
// ⚙️ HACK BRUTAL: BACKGROUND IMMORTALITY (MEDIA SESSION HIJACK)
// =======================================================================
const SILENT_AUDIO_B64 = "data:audio/mp3;base64,//OExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
let silentAudioLoop = null;

function inisialisasiImmortalityLatarBelakang() {
    if (!silentAudioLoop) {
        silentAudioLoop = new Audio(SILENT_AUDIO_B64);
        silentAudioLoop.loop = true;
        silentAudioLoop.volume = 0.01; 
    }
    
    silentAudioLoop.play().then(() => {
        // Membajak OS Android agar menganggap PWA ini adalah Spotify/Music Player
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: "Bagantara - Radar Aktif",
                artist: "Menunggu Pesanan Masuk...",
                album: "Sistem Operasional Driver",
                // Memastikan ikon tampil elegan di lock-screen Android (Asumsi icon tersedia)
                artwork: [{ src: './assets/icon-192.png', sizes: '192x192', type: 'image/png' }]
            });
            
            // Sabotase tombol pause agar OS tidak bisa mematikan proses latar belakang
            navigator.mediaSession.setActionHandler('play', () => { silentAudioLoop.play(); });
            navigator.mediaSession.setActionHandler('pause', () => { silentAudioLoop.play(); });
        }
    }).catch(e => console.warn("[SISTEM] Kekebalan Latar Belakang butuh tap pertama di layar."));
}

function hentikanImmortality() {
    if (silentAudioLoop) {
        silentAudioLoop.pause();
        silentAudioLoop.currentTime = 0;
        if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    }
}

// =======================================================================
// ⚙️ ENGINE AUDIO SYNTHESIZER (WEB AUDIO API MURNI)
// =======================================================================
let audioCtx = null;
let alarmInterval = null;
let isAlarmPlaying = false;

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

export function hentikanSonar() {
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    isAlarmPlaying = false;
}

// Saraf Pemicu: Matikan alarm seketika saat driver menyentuh layar (misal mengklik ruang chat)
document.addEventListener('click', hentikanSonar);
document.addEventListener('touchstart', hentikanSonar, { passive: true });

function bunyikanSonarTiket() {
    if (isAlarmPlaying) return;
    initAudioContext();
    isAlarmPlaying = true;

    let hitungan = 0;
    const batasMaksimal = 30; // Alarm panjang, berbunyi nyaring selama 30 detik 

    alarmInterval = setInterval(() => {
        if (hitungan >= batasMaksimal || !isAlarmPlaying) {
            hentikanSonar();
            return;
        }
        hitungan++;

        // SINTESIS SUARA ALARM FUTURISTIK & ELEGAN (Tanpa file MP3)
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const masterGain = audioCtx.createGain();

        // Gelombang Triangle & Sine menghasilkan nada modern ala UI Sci-Fi
        osc1.type = 'triangle';
        osc2.type = 'sine';

        // Modulasi Frekuensi (Nada melengking naik, meniru radar)
        const waktuMulai = audioCtx.currentTime;
        osc1.frequency.setValueAtTime(880, waktuMulai);           // Nada A5
        osc1.frequency.setValueAtTime(1318.51, waktuMulai + 0.1); // Melengking ke E6
        osc2.frequency.setValueAtTime(440, waktuMulai);           // Bass pendamping A4

        // Amplop Volume (Volume maksimal 1.0, Attack cepat, Decay halus)
        masterGain.gain.setValueAtTime(0, waktuMulai);
        masterGain.gain.linearRampToValueAtTime(1.0, waktuMulai + 0.05);
        masterGain.gain.exponentialRampToValueAtTime(0.001, waktuMulai + 0.8);

        // Menghubungkan sirkuit audio
        osc1.connect(masterGain);
        osc2.connect(masterGain);
        masterGain.connect(audioCtx.destination);

        // Membunyikan suara
        osc1.start(waktuMulai);
        osc2.start(waktuMulai);
        osc1.stop(waktuMulai + 0.8);
        osc2.stop(waktuMulai + 0.8);
    }, 1000); // Berulang setiap 1 detik
}

export function hidupkanRadar(uid) {
    if (!uid) return;
    uidDriverAktif = uid;
    
    // 1. Inisialisasi Audio Context
    initAudioContext();

    // 2. SUNTIKAN BRUTAL: Hidupkan penangkal Doze Mode Android
    inisialisasiImmortalityLatarBelakang();

    referensiRadar = ref(dbChat, `radar_tiket/${uid}`);
    
    // Cabut pendengar (listener) lama jika tombol On/Off ditekan berkali-kali
    if (pemantauRadar) { 
        pemantauRadar(); 
        pemantauRadar = null; 
    }
    
    // Memantau secara konstan aliran data tiket masuk dari Klien
    pemantauRadar = onChildAdded(referensiRadar, async (snapshot) => {
        const tiket = snapshot.val();
        const idTiket = snapshot.key; 
        
        // FATAL GHOST ORDER: Buang tiket otomatis dari KETIGA node jika > 5 menit (Hemat Kuota Mutlak)
        if (Date.now() - tiket.waktu_dibuat > 300000) {
            remove(ref(dbChat, `radar_tiket/${uidDriverAktif}/${idTiket}`));
            remove(ref(dbChat, `inbox_mitra/${uidDriverAktif}/${idTiket}`));
            remove(ref(dbChat, `sesi_komunikasi/${idTiket}`));
            return;
        }

        // Driver mencetak entri ke Inbox-nya sendiri.
        try {
            await update(ref(dbChat, `inbox_mitra/${uidDriverAktif}/${idTiket}`), {
                nama_klien: tiket.nama_klien || "Penumpang",
                layanan: tiket.layanan || "ORDER",
                pesan_terakhir: "Katalog pesanan masuk...",
                waktu_dibuat: tiket.waktu_dibuat || Date.now(),
                waktu_update: Date.now()
            });
        } catch (err) { console.error("Gagal sinkronisasi Inbox internal:", err); }

        // Peringatan Audio Futuristik (Dijamin hidup berkat Media Session Hijack)
        bunyikanSonarTiket();
        const indikatorKedip = document.getElementById('chat-notif-dot');
        if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');

        try {
            // Tampilkan informasi visual di layar
            if(window.showToast) window.showToast("Pesanan Baru Masuk ke Kotak Pesan!", "success");
        } catch (err) {
            console.error("[RADAR ENGINE] Gagal memproses notifikasi tiket:", err);
        }
    });
}

export function matikanRadar() {
    // Matikan Sonar Synthesizer jika sedang berbunyi
    hentikanSonar();

    // Matikan Kekebalan Latar Belakang Android
    hentikanImmortality();

    // Cabut paksa listener dari memori saat radar dimatikan agar terhindar dari Memory Leak & Limit Kuota
    if (pemantauRadar) {
        pemantauRadar();
        pemantauRadar = null;
    }
    
    uidDriverAktif = null;
}