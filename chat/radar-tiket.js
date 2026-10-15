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
const SILENT_AUDIO_B64 = "data:audio/mp3;base64,//OExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
let silentAudioLoop = null;

function inisialisasiImmortalityLatarBelakang() {
    if (!silentAudioLoop) {
        silentAudioLoop = new Audio(SILENT_AUDIO_B64);
        silentAudioLoop.loop = true;
        silentAudioLoop.volume = 0.01;
    }

    silentAudioLoop.play().then(() => {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: "Bagantara - Radar Aktif",
                artist: "Menunggu Pesanan Masuk...",
                album: "Sistem Operasional Driver",
                artwork: [{ src: './assets/icon-192.png', sizes: '192x192', type: 'image/png' }]
            });

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
// ⚙️ ENGINE AUDIO SYNTHESIZER (WEB AUDIO API MURNI) - DIMATIKAN
// =======================================================================
function initAudioContext() {}
export function hentikanSonar() {}
function bunyikanSonarTiket() {}

export function periksaPintuMasuk() {
    return !!uidDriverAktif;
}

export function hidupkanRadar(uid) {
    if (!uid) return;
    uidDriverAktif = uid;

    initAudioContext();
    inisialisasiImmortalityLatarBelakang();

    referensiRadar = ref(dbChat, `radar_tiket/${uid}`);

    if (pemantauRadar) {
        pemantauRadar();
        pemantauRadar = null;
    }

    pemantauRadar = onChildAdded(referensiRadar, async (snapshot) => {
        const tiket = snapshot.val();
        const idTiket = snapshot.key;
        if (!tiket) return;

        // FATAL GHOST ORDER: Buang tiket otomatis dari KETIGA node jika > 5 menit (Hemat Kuota Mutlak)
        if (Date.now() - tiket.waktu_dibuat > 300000) {
            remove(ref(dbChat, `radar_tiket/${uidDriverAktif}/${idTiket}`));
            remove(ref(dbChat, `inbox_mitra/${uidDriverAktif}/${idTiket}`));
            remove(ref(dbChat, `sesi_komunikasi/${idTiket}`));
            return;
        }

        // Cegah penulisan ulang ke inbox jika tiket sudah diambil (ACCEPTED)
        if (tiket.status === 'ACCEPTED') return;

        try {
            await update(ref(dbChat, `inbox_mitra/${uidDriverAktif}/${idTiket}`), {
                nama_klien: tiket.nama_klien || "Penumpang",
                layanan: tiket.layanan || "ORDER",
                pesan_terakhir: "Katalog pesanan masuk...",
                waktu_dibuat: tiket.waktu_dibuat || Date.now(),
                waktu_update: Date.now()
            });
        } catch (err) { console.error("Gagal sinkronisasi Inbox internal:", err); }

        bunyikanSonarTiket();
        const indikatorKedip = document.getElementById('chat-notif-dot');
        if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');

        try {
            if (window.showToast) window.showToast("Pesanan Baru Masuk ke Kotak Pesan!", "success");
        } catch (err) {
            console.error("[RADAR ENGINE] Gagal memproses notifikasi tiket:", err);
        }
    });
}

export function matikanRadar() {
    hentikanSonar();
    hentikanImmortality();

    if (pemantauRadar) {
        pemantauRadar();
        pemantauRadar = null;
    }

    uidDriverAktif = null;
}