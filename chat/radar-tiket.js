// ==========================================================================
// FILE: chat/radar-tiket.js
// FUNGSI: Mesin Radar RTDB Ke-3 (futaqi-ali), Layar Sergap Pesanan Penuh (Inovasi 1),
//         Web Audio Sirine & Getaran Taktis, serta Suara Asisten Kokpit id-ID (Inovasi 2)
// ARSITEKTUR: On-Demand Radar Socket (Hanya Online saat Aktif/Standby)
// ==========================================================================

import { dbChat, dbRadar } from './config-chat.js';
import { configChat } from '../js/config/credentials.js';
import { bukaRuangKomunikasi, simpanItemInboxLokal, hapusItemInboxLokal, escapeHTML, goOnline, goOffline } from './app-chat.js';
import { ref, onChildAdded, remove, update, push } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

let referensiRadar = null;
let uidDriverAktif = null;
let pemantauRadar = null;

// State Modal Sergap Pesanan (Inovasi 1)
let tiketSergapAktif = null;
let idTiketSergapAktif = null;
let timerCountdownSergap = null;
let sisaDetikSergap = 30;
let isModalSergapBound = false;

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
    }).catch(() => {});
}

function hentikanImmortality() {
    if (silentAudioLoop) {
        silentAudioLoop.pause();
        silentAudioLoop.currentTime = 0;
        if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    }
}

// =======================================================================
// 🔊 INOVASI 1A: ENGINE AUDIO SIRINE TAKTIS (WEB AUDIO API MURNI) & GETARAN
// =======================================================================
let audioCtxRadar = null;
let sirineIntervalId = null;
let vibrateIntervalId = null;
let isSirineBerbunyi = false;

const POLA_GETAR_SERGAP = [600, 200, 600, 200, 800, 200, 600];

function initAudioContext() {
    try {
        if (!audioCtxRadar) {
            audioCtxRadar = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtxRadar.state === 'suspended') {
            audioCtxRadar.resume().catch(() => {});
        }
    } catch (e) {}
}

export function bunyikanSonarTiket() {
    initAudioContext();

    // 1. Getaran Berirama Taktis
    try {
        if ('vibrate' in navigator) {
            navigator.vibrate(POLA_GETAR_SERGAP);
            if (vibrateIntervalId) clearInterval(vibrateIntervalId);
            vibrateIntervalId = setInterval(() => {
                if (isSirineBerbunyi && 'vibrate' in navigator) {
                    navigator.vibrate(POLA_GETAR_SERGAP);
                }
            }, 3600);
        }
    } catch (e) {}

    // 2. Sirine Web Audio API
    if (isSirineBerbunyi) return;
    isSirineBerbunyi = true;

    const mainkanSiklusSirine = () => {
        if (!isSirineBerbunyi || !audioCtxRadar) return;
        try {
            if (audioCtxRadar.state === 'suspended') audioCtxRadar.resume().catch(() => {});
            const now = audioCtxRadar.currentTime;

            const osc1 = audioCtxRadar.createOscillator();
            const gain1 = audioCtxRadar.createGain();

            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(880, now);
            osc1.frequency.linearRampToValueAtTime(1760, now + 0.35);
            osc1.frequency.linearRampToValueAtTime(880, now + 0.70);
            osc1.frequency.linearRampToValueAtTime(1760, now + 1.05);

            gain1.gain.setValueAtTime(0.01, now);
            gain1.gain.linearRampToValueAtTime(0.35, now + 0.05);
            gain1.gain.setValueAtTime(0.35, now + 1.0);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.25);

            osc1.connect(gain1);
            gain1.connect(audioCtxRadar.destination);

            osc1.start(now);
            osc1.stop(now + 1.25);
        } catch (e) {}
    };

    mainkanSiklusSirine();
    if (sirineIntervalId) clearInterval(sirineIntervalId);
    sirineIntervalId = setInterval(mainkanSiklusSirine, 1500);
}

export function hentikanSonar() {
    isSirineBerbunyi = false;
    if (sirineIntervalId) {
        clearInterval(sirineIntervalId);
        sirineIntervalId = null;
    }
    if (vibrateIntervalId) {
        clearInterval(vibrateIntervalId);
        vibrateIntervalId = null;
    }
    try {
        if ('vibrate' in navigator) navigator.vibrate(0);
    } catch (e) {}
}

// =======================================================================
// 🗣️ INOVASI 2: SUARA ASISTEN KOKPIT OTOMATIS (0 KUOTA - WEB SPEECH API)
// =======================================================================
export function bacakanPesananKokpit(tiket) {
    if (!('speechSynthesis' in window) || !tiket) return;
    try {
        window.speechSynthesis.cancel();

        const layanan = String(tiket.layanan || 'RIDE').toUpperCase();
        const jemput = String(tiket.pickup_alamat || 'Titik jemput penumpang').replace(/[,()]/g, ' ');
        const tujuan = String(tiket.dropoff_alamat || 'Titik tujuan penumpang').replace(/[,()]/g, ' ');
        const nominalTarif = Number(tiket.harga_tawaran || tiket.harga_dasar || 0);
        const nominalTip = Number(tiket.tip_nominal || 0);

        let teksSuara = `Perhatian. Pesanan baru masuk. Layanan ${layanan}. Lokasi jemput di ${jemput}. Tujuan ke ${tujuan}. Estimasi tarif ${nominalTarif.toLocaleString('id-ID')} rupiah.`;
        if (nominalTip > 0) {
            teksSuara += ` Termasuk tip prioritas ${nominalTip.toLocaleString('id-ID')} rupiah.`;
        }

        const utterance = new SpeechSynthesisUtterance(teksSuara);
        utterance.lang = 'id-ID';
        utterance.rate = 1.02;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const idVoice = voices.find(v => v.lang && v.lang.toLowerCase().includes('id'));
        if (idVoice) utterance.voice = idVoice;

        window.speechSynthesis.speak(utterance);
    } catch (e) {}
}

export function hentikanBicaraKokpit() {
    try {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    } catch (e) {}
}

// =======================================================================
// 🚨 INOVASI 1B: MODAL LAYAR PENUH (FULL-SCREEN TACTICAL ORDER INTERCEPT)
// =======================================================================
function ikatEventModalSergap() {
    if (isModalSergapBound) return;
    const btnTerima = document.getElementById('btn-intercept-accept');
    const btnTolak = document.getElementById('btn-intercept-reject');
    if (!btnTerima || !btnTolak) return;

    isModalSergapBound = true;
    btnTerima.addEventListener('click', () => eksekusiTerimaPesananSergap());
    btnTolak.addEventListener('click', () => eksekusiTolakPesananSergap(false));
}

function tutupModalSergap() {
    if (timerCountdownSergap) {
        clearInterval(timerCountdownSergap);
        timerCountdownSergap = null;
    }
    hentikanSonar();
    hentikanBicaraKokpit();

    const modal = document.getElementById('bgt-order-intercept-modal');
    if (modal) {
        modal.classList.add('hidden-state');
    }
}

export function tampilkanModalSergapPesanan(idTiket, tiket) {
    if (!idTiket || !tiket) return;
    ikatEventModalSergap();

    // Bangunkan layar OLED Blackout seketika jika sedang aktif
    if (typeof window.bangunkanLayarOLED === 'function') {
        window.bangunkanLayarOLED();
    }

    tiketSergapAktif = tiket;
    idTiketSergapAktif = idTiket;
    sisaDetikSergap = 30;

    const modal = document.getElementById('bgt-order-intercept-modal');
    const elBadgeLayanan = document.getElementById('intercept-service-badge');
    const elNamaKlien = document.getElementById('intercept-client-name');
    const elJarak = document.getElementById('intercept-distance');
    const elPickup = document.getElementById('intercept-pickup-address');
    const elDropoff = document.getElementById('intercept-dropoff-address');
    const elTarif = document.getElementById('intercept-tariff');
    const elTipBadge = document.getElementById('intercept-tip-badge');
    const elExtraInfo = document.getElementById('intercept-extra-info');
    const elCountdownSec = document.getElementById('intercept-countdown-sec');
    const elProgressBar = document.getElementById('intercept-progress-bar');

    const layanan = String(tiket.layanan || 'RIDE').toUpperCase();
    const namaKlien = String(tiket.nama_klien || 'Penumpang Bagantara');
    const jarakKm = Number(tiket.jarak_km || 0).toFixed(1);
    const nominalTarif = Number(tiket.harga_tawaran || tiket.harga_dasar || 0);
    const nominalTip = Number(tiket.tip_nominal || 0);

    const formatRp = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(nominalTarif);

    if (elBadgeLayanan) {
        elBadgeLayanan.innerText = `LAYANAN: ${layanan}`;
        if (layanan === 'RIDE' || layanan === 'CAR') {
            elBadgeLayanan.className = "px-3 py-1 rounded-full text-xs font-extrabold tracking-widest uppercase bg-blue-500/20 text-blue-400 border border-blue-500/40";
        } else if (layanan === 'EXPRESS') {
            elBadgeLayanan.className = "px-3 py-1 rounded-full text-xs font-extrabold tracking-widest uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40";
        } else {
            elBadgeLayanan.className = "px-3 py-1 rounded-full text-xs font-extrabold tracking-widest uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40";
        }
    }

    if (elNamaKlien) elNamaKlien.innerText = namaKlien;
    if (elJarak) elJarak.innerText = `${jarakKm} KM`;

    let teksJemput = String(tiket.pickup_alamat || 'Titik Jemput Koordinat Peta');
    if (tiket.pickup_patokan && String(tiket.pickup_patokan).trim() !== '') {
        teksJemput += ` (${tiket.pickup_patokan})`;
    }
    if (elPickup) elPickup.innerText = teksJemput;

    let teksTujuan = String(tiket.dropoff_alamat || 'Titik Tujuan Koordinat Peta');
    if (tiket.dropoff_patokan && String(tiket.dropoff_patokan).trim() !== '') {
        teksTujuan += ` (${tiket.dropoff_patokan})`;
    }
    if (elDropoff) elDropoff.innerText = teksTujuan;

    if (elTarif) elTarif.innerText = formatRp;

    if (elTipBadge) {
        if (nominalTip > 0) {
            const formatTip = new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(nominalTip);
            elTipBadge.innerHTML = `<i class="fa-solid fa-bolt mr-1"></i> PRIORITAS + TIP ${escapeHTML(formatTip)}`;
            elTipBadge.classList.remove('hidden-state');
        } else {
            elTipBadge.classList.add('hidden-state');
        }
    }

    if (elExtraInfo) {
        const extraParts = [];
        if (tiket.toko_jastip) {
            extraParts.push(`<div><i class="fa-solid fa-store text-emerald-400 mr-1"></i> <b>Toko:</b> ${escapeHTML(tiket.toko_jastip)}</div>`);
        }
        if (Array.isArray(tiket.belanjaan) && tiket.belanjaan.length > 0) {
            const totalItem = tiket.belanjaan.reduce((acc, it) => acc + (Number(it.qty) || 1), 0);
            const estBelanja = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(tiket.estimasi_belanja || 0));
            extraParts.push(`<div><i class="fa-solid fa-bag-shopping text-emerald-400 mr-1"></i> <b>Belanjaan:</b> ${totalItem} Item (Est: ${escapeHTML(estBelanja)})</div>`);
        }
        if (Array.isArray(tiket.multi_dropoffs) && tiket.multi_dropoffs.length > 0) {
            extraParts.push(`<div><i class="fa-solid fa-route text-amber-400 mr-1"></i> <b>Multi-Stop:</b> ${tiket.multi_dropoffs.length} Titik Singgah Tambahan</div>`);
        }
        if (tiket.catatan_tambahan && String(tiket.catatan_tambahan).trim() !== '') {
            extraParts.push(`<div><i class="fa-solid fa-comment-dots text-theme-gold mr-1"></i> <b>Catatan:</b> "${escapeHTML(tiket.catatan_tambahan)}"</div>`);
        }

        if (extraParts.length > 0) {
            elExtraInfo.innerHTML = extraParts.join('');
            elExtraInfo.classList.remove('hidden-state');
        } else {
            elExtraInfo.innerHTML = '';
            elExtraInfo.classList.add('hidden-state');
        }
    }

    if (elCountdownSec) elCountdownSec.innerText = '30s';
    if (elProgressBar) elProgressBar.style.width = '100%';

    if (modal) {
        modal.classList.remove('hidden-state');
    }

    // Gambar preview rute OSRM di peta latar belakang
    if (typeof window.gambarRutePesananOSRM === 'function') {
        window.gambarRutePesananOSRM(tiket);
    }

    // Aktifkan Sirine Web Audio + Getaran Berirama + Suara Asisten Kokpit (id-ID)
    bunyikanSonarTiket();
    bacakanPesananKokpit(tiket);

    if (timerCountdownSergap) clearInterval(timerCountdownSergap);
    timerCountdownSergap = setInterval(() => {
        sisaDetikSergap--;
        if (elCountdownSec) elCountdownSec.innerText = `${Math.max(0, sisaDetikSergap)}s`;
        if (elProgressBar) {
            const pct = Math.max(0, (sisaDetikSergap / 30) * 100);
            elProgressBar.style.width = `${pct}%`;
        }
        if (sisaDetikSergap <= 0) {
            clearInterval(timerCountdownSergap);
            timerCountdownSergap = null;
            tutupModalSergap();
            if (window.showToast) {
                window.showToast("Waktu sergap 30 detik habis. Pesanan masih dapat dilihat di Kotak Masuk.", "warning");
            }
        }
    }, 1000);
}

async function simpanInboxMitraViaREST(uid, idTiket, payloadInbox) {
    try {
        const url = `${configChat.databaseURL}/inbox_mitra/${encodeURIComponent(uid)}/${encodeURIComponent(idTiket)}.json`;
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadInbox)
        });
    } catch (e) {}
}

async function eksekusiTerimaPesananSergap() {
    if (!uidDriverAktif || !idTiketSergapAktif || !tiketSergapAktif) {
        tutupModalSergap();
        return;
    }

    const uid = uidDriverAktif;
    const idTiket = idTiketSergapAktif;
    const tiket = tiketSergapAktif;

    // 1. Hentikan sirine, getaran, dan suara kokpit seketika
    tutupModalSergap();

    try {
        // 2. Update status tiket di futaqi-ali menjadi ACCEPTED, lalu hapus umpan radar setelah 4 detik
        const refTiketRadar = ref(dbRadar, `radar_tiket/${uid}/${idTiket}`);
        await update(refTiketRadar, {
            status: 'ACCEPTED',
            waktu_diterima: Date.now()
        }).catch(() => {});

        setTimeout(() => {
            remove(refTiketRadar).catch(() => {});
        }, 4000);

        // 3. Simpan ke inbox_mitra (REST + memori lokal) & sinkronkan sesi_komunikasi di dbChat
        const itemInbox = {
            nama_klien: tiket.nama_klien || "Penumpang",
            layanan: tiket.layanan || "RIDE",
            pesan_terakhir: "Pesanan diterima - Meluncur ke lokasi jemput",
            waktu_dibuat: tiket.waktu_dibuat || Date.now(),
            waktu_update: Date.now()
        };
        simpanItemInboxLokal(uid, idTiket, itemInbox);
        await simpanInboxMitraViaREST(uid, idTiket, itemInbox);

        // 4. Gambar rute jalan raya OSRM di peta driver
        if (typeof window.gambarRutePesananOSRM === 'function') {
            window.gambarRutePesananOSRM(tiket);
        }

        // 5. Buka ruang obrolan dengan penumpang (otomatis menyalakan goOnline(dbChat))
        bukaRuangKomunikasi(idTiket, tiket.nama_klien || "Penumpang", tiket);

        // 6. Update status metadata_order di sesi_komunikasi dan kirim konfirmasi otomatis
        await update(ref(dbChat, `sesi_komunikasi/${idTiket}/metadata_order`), {
            status: 'ACCEPTED',
            waktu_diterima: Date.now()
        }).catch(() => {});

        await push(ref(dbChat, `sesi_komunikasi/${idTiket}/pesan`), {
            pengirim: "mitra",
            tipe: "teks",
            konten: "Pesanan Anda telah saya terima melalui Radar Prioritas, saya segera meluncur ke titik jemput.",
            waktu: Date.now(),
            status: "sent"
        }).catch(() => {});

        if (window.showToast) {
            window.showToast("Pesanan diterima! Rute jalan raya & ruang obrolan aktif.", "success");
        }
    } catch (err) {
        if (window.showToast) {
            window.showToast("Terjadi kendala jaringan saat menyetujui pesanan.", "error");
        }
    }
}

async function eksekusiTolakPesananSergap() {
    if (!uidDriverAktif || !idTiketSergapAktif) {
        tutupModalSergap();
        return;
    }

    const uid = uidDriverAktif;
    const idTiket = idTiketSergapAktif;

    tutupModalSergap();
    hapusItemInboxLokal(uid, idTiket);
    if (typeof window.bersihkanRutePesanan === 'function') {
        window.bersihkanRutePesanan();
    }

    try {
        // Hapus umpan dari futaqi-ali segera
        await remove(ref(dbRadar, `radar_tiket/${uid}/${idTiket}`)).catch(() => {});

        // Kirim sinyal sistem_tolak ke penumpang di dbChat lalu bersihkan sesi & inbox
        goOnline(dbChat);
        await push(ref(dbChat, `sesi_komunikasi/${idTiket}/pesan`), {
            pengirim: "mitra",
            tipe: "sistem_tolak",
            konten: "Driver menolak pesanan",
            waktu: Date.now(),
            status: "sent"
        }).catch(() => {});

        setTimeout(async () => {
            await Promise.allSettled([
                remove(ref(dbChat, `inbox_mitra/${uid}/${idTiket}`)),
                remove(ref(dbChat, `sesi_komunikasi/${idTiket}`))
            ]);
            // Jika tidak sedang membuka ruang obrolan lain, putus kembali koneksi dbChat
            const panelChat = document.getElementById('panel-komunikasi-utama');
            if (!panelChat || panelChat.classList.contains('hidden-state')) {
                goOffline(dbChat);
            }
        }, 1500);

        if (window.showToast) {
            window.showToast("Pesanan telah ditolak.", "info");
        }
    } catch (err) {}
}

// =======================================================================
// 📡 KONTROL RADAR UTAMA (MESIN KE-3: futaqi-ali)
// =======================================================================
export function periksaPintuMasuk() {
    return !!uidDriverAktif;
}

export function hidupkanRadar(uid) {
    if (!uid) return;
    uidDriverAktif = uid;

    initAudioContext();
    inisialisasiImmortalityLatarBelakang();
    ikatEventModalSergap();

    // MITIGASI LIMIT 100 KONEKSI: Nyalakan koneksi ke dbRadar (futaqi-ali) HANYA saat Driver Online
    goOnline(dbRadar);

    referensiRadar = ref(dbRadar, `radar_tiket/${uid}`);

    if (pemantauRadar) {
        pemantauRadar();
        pemantauRadar = null;
    }

    pemantauRadar = onChildAdded(referensiRadar, async (snapshot) => {
        const tiket = snapshot.val();
        const idTiket = snapshot.key;
        if (!tiket) return;

        // FATAL GHOST ORDER: Buang tiket otomatis jika sudah kedaluwarsa (> 5 menit)
        if (tiket.waktu_dibuat && (Date.now() - Number(tiket.waktu_dibuat) > 300000)) {
            remove(ref(dbRadar, `radar_tiket/${uidDriverAktif}/${idTiket}`)).catch(() => {});
            hapusItemInboxLokal(uidDriverAktif, idTiket);
            fetch(`${configChat.databaseURL}/inbox_mitra/${encodeURIComponent(uidDriverAktif)}/${encodeURIComponent(idTiket)}.json`, { method: 'DELETE' }).catch(() => {});
            fetch(`${configChat.databaseURL}/sesi_komunikasi/${encodeURIComponent(idTiket)}.json`, { method: 'DELETE' }).catch(() => {});
            return;
        }

        // Cegah penulisan ulang jika tiket sudah berstatus ACCEPTED
        if (tiket.status === 'ACCEPTED') return;

        // Simpan ke inbox_mitra menggunakan REST ringan + memori lokal (0 Koneksi WebSocket dbChat)
        const payloadInbox = {
            nama_klien: tiket.nama_klien || "Penumpang",
            layanan: tiket.layanan || "ORDER",
            pesan_terakhir: "Katalog pesanan masuk...",
            waktu_dibuat: tiket.waktu_dibuat || Date.now(),
            waktu_update: Date.now()
        };
        simpanItemInboxLokal(uidDriverAktif, idTiket, payloadInbox);
        simpanInboxMitraViaREST(uidDriverAktif, idTiket, payloadInbox);

        const indikatorKedip = document.getElementById('chat-notif-dot');
        if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');

        // Tampilkan Layar Sergap Pesanan Penuh + Getaran + Sirine Web Audio + Suara Kokpit
        tampilkanModalSergapPesanan(idTiket, tiket);
    });
}

export function matikanRadar() {
    tutupModalSergap();
    hentikanImmortality();

    if (pemantauRadar) {
        pemantauRadar();
        pemantauRadar = null;
    }

    // MITIGASI LIMIT 100 KONEKSI: Wajib putus koneksi dbRadar saat Driver Offline
    goOffline(dbRadar);

    uidDriverAktif = null;
}

// Dengarkan pesan dari Service Worker saat notifikasi FCM diklik di latar belakang
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'BGT_FCM_ORDER_CLICK') {
            if (typeof window.bangunkanLayarOLED === 'function') {
                window.bangunkanLayarOLED();
            }
        }
    });
}
