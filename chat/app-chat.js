// ==========================================================================
// FILE: chat/app-chat.js
// FUNGSI: Mesin Obrolan Real-Time, REST Inbox (0 Koneksi Idle), WebP Edge Compressor,
//         Background Chat Alert (Suara 2x Pesan Pelanggan + Banner Notifikasi Sistem), & Anti-XSS
// ==========================================================================

import { dbChat, dbRadar } from './config-chat.js';
import { configChat } from '../js/config/credentials.js';
import { auth } from '../js/core/firebase-config.js';
import { uploadMediaKeCloudinary, kompresGambarKeWebP, DEFAULT_UPLOAD_PRESET } from './cloud-media.js';
import { ref, push, onChildAdded, onChildChanged, remove, update, query, limitToLast, get, goOnline as rtdbGoOnline, goOffline as rtdbGoOffline } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Definisi fungsi jaringan secara eksplisit
export function goOnline(dbInstance) { try { rtdbGoOnline(dbInstance); } catch (e) {} }
export function goOffline(dbInstance) { try { rtdbGoOffline(dbInstance); } catch (e) {} }

const IZINKAN_MEDIA = true;
const CLOUDINARY_PRESET = DEFAULT_UPLOAD_PRESET;
const FITUR_MEDIA_AKTIF = true;

let idRuangObrolanAktif = null;
let waktuBukaRuang = 0;
let pemantauPesan = null;
let perakamAudio = null;
let potonganAudio = [];
let isDOMEventBound = false;
let pemantauPesanUbah = null;
let intervalRekamanGlobal = null;

// Memori lokal daftar inbox (0 Koneksi WebSocket Permanen saat tidak ada sesi aktif)
let memoriInboxLokal = {};

// Memori status sesi yang sudah diambil oleh Driver
const sesiOrderDiterimaMap = {};

// Simpan data rute terakhir per sesi agar tombol "Tampilkan Rute di Peta" dapat menggambar ulang kapan saja
const memoriRuteSesiMap = {};

export function tandaiOrderSudahDiambil(idTiket, waKlien = '') {
    if (!idTiket) return;
    sesiOrderDiterimaMap[idTiket] = {
        accepted: true,
        wa_klien: waKlien || sesiOrderDiterimaMap[idTiket]?.wa_klien || ''
    };
}

// ==========================================================================
// 0. SANITASI ANTI-XSS & HELPER NOTIFIKASI LATAR BELAKANG
// ==========================================================================
export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function tampilkanBannerNotifChatLatarBelakang(judul, isi, idTiket) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opsi = {
        body: isi,
        icon: './assets/icon-192.png',
        badge: './assets/icon-192.png',
        tag: `bgt-chat-${idTiket || 'msg'}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [500, 150, 500, 150, 700],
        data: { idTiket: idTiket, type: 'CHAT_MESSAGE' }
    };
    try {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            if (reg && typeof reg.showNotification === 'function') {
                await reg.showNotification(judul, opsi);
                return;
            }
        }
    } catch (e) {}
    try { new Notification(judul, opsi); } catch (e) {}
}

function bacakanPesanChatKokpit(teksSuara) {
    if (!('speechSynthesis' in window) || !teksSuara) return;
    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(teksSuara);
        utterance.lang = 'id-ID';
        utterance.rate = 1.04;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const idVoice = voices.find(v => v.lang && v.lang.toLowerCase().includes('id'));
        if (idVoice) utterance.voice = idVoice;
        window.speechSynthesis.speak(utterance);
    } catch (e) {}
}

// ==========================================================================
// 1. MESIN INBOX REST RINGAN (0 KONEKSI WEBSOCKET PERMANEN)
// ==========================================================================
function dapatkanKunciStorageInbox(uid) {
    return `bgt_inbox_local_${uid}`;
}

function bacaCacheInboxLokal(uid) {
    if (!uid) return {};
    try {
        const raw = localStorage.getItem(dapatkanKunciStorageInbox(uid));
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function tulisCacheInboxLokal(uid, dataObj) {
    if (!uid) return;
    try {
        localStorage.setItem(dapatkanKunciStorageInbox(uid), JSON.stringify(dataObj || {}));
    } catch (e) {}
}

export function simpanItemInboxLokal(uid, idTiket, itemData) {
    if (!uid || !idTiket || !itemData) return;
    const cache = bacaCacheInboxLokal(uid);
    cache[idTiket] = {
        ...(cache[idTiket] || {}),
        ...itemData
    };
    memoriInboxLokal = cache;
    tulisCacheInboxLokal(uid, cache);
    renderDaftarInboxDariMemori();
}

export function hapusItemInboxLokal(uid, idTiket) {
    if (!uid || !idTiket) return;
    const cache = bacaCacheInboxLokal(uid);
    delete cache[idTiket];
    memoriInboxLokal = cache;
    tulisCacheInboxLokal(uid, cache);
    renderDaftarInboxDariMemori();
}

function buatHTMLKartuInbox(idTiket, tiket) {
    const waktuFormat = new Date(tiket.waktu_update || tiket.waktu_dibuat || Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const rawNama = tiket.nama_klien || "Klien";
    const namaAman = escapeHTML(rawNama);
    const inisialAman = escapeHTML(rawNama.substring(0, 1).toUpperCase());
    const pesanTerakhirAman = escapeHTML(tiket.pesan_terakhir || "Memulai percakapan...");
    const layananAman = escapeHTML(tiket.layanan || "ORDER");
    const layananTag = (tiket.layanan === 'RIDE' || tiket.layanan === 'CAR') ? 'inbox-tag-ride' : 'inbox-tag-express';
    const idTiketAman = escapeHTML(idTiket);

    return `
        <div class="inbox-card" data-id="${idTiketAman}" data-nama="${namaAman}">
            <div class="inbox-avatar">${inisialAman}</div>
            <div class="inbox-content">
                <div class="inbox-header">
                    <span class="inbox-name">${namaAman} <span class="inbox-tag ${layananTag} ml-1">${layananAman}</span></span>
                    <span class="inbox-time">${waktuFormat}</span>
                </div>
                <span class="inbox-preview">${pesanTerakhirAman}</span>
            </div>
        </div>
    `;
}

function ikatKlikKartuInbox(cardEl) {
    if (!cardEl) return;
    cardEl.addEventListener('click', () => {
        const idTiket = cardEl.getAttribute('data-id');
        const namaKlien = cardEl.getAttribute('data-nama') || "Klien";
        bukaRuangKomunikasi(idTiket, namaKlien);
    });
}

function sinkronisasiCounterInbox() {
    const container = document.getElementById('inbox-list-container');
    const emptyState = document.getElementById('inbox-empty-state');
    const countEl = document.getElementById('inbox-count');
    if (!container || !emptyState || !countEl) return;

    const totalSesi = container.querySelectorAll('.inbox-card').length;
    if (totalSesi > 0) {
        emptyState.classList.add('hidden-state');
    } else {
        emptyState.classList.remove('hidden-state');
    }
    countEl.innerText = `${totalSesi} Sesi`;
}

function renderDaftarInboxDariMemori() {
    const container = document.getElementById('inbox-list-container');
    if (!container) return;

    container.querySelectorAll('.inbox-card').forEach(el => el.remove());

    const entries = Object.entries(memoriInboxLokal || {})
        .filter(([, val]) => val && (val.waktu_dibuat || val.waktu_update))
        .sort((a, b) => (Number(b[1].waktu_update || b[1].waktu_dibuat || 0) - Number(a[1].waktu_update || a[1].waktu_dibuat || 0)))
        .slice(0, 20);

    entries.forEach(([idTiket, tiket]) => {
        const cardHTML = buatHTMLKartuInbox(idTiket, tiket);
        container.insertAdjacentHTML('beforeend', cardHTML);
        const newCard = container.querySelector(`.inbox-card[data-id="${CSS.escape(idTiket)}"]`);
        ikatKlikKartuInbox(newCard);
    });

    sinkronisasiCounterInbox();
}

export async function inisialisasiInboxChat() {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

    memoriInboxLokal = bacaCacheInboxLokal(uid);
    renderDaftarInboxDariMemori();

    try {
        const ctrl = new AbortController();
        const tId = setTimeout(() => ctrl.abort(), 4000);
        const url = `${configChat.databaseURL}/inbox_mitra/${encodeURIComponent(uid)}.json?orderBy=%22$key%22&limitToLast=20`;
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tId);

        if (res.ok) {
            const data = await res.json();
            memoriInboxLokal = data && typeof data === 'object' ? data : {};
            tulisCacheInboxLokal(uid, memoriInboxLokal);
            renderDaftarInboxDariMemori();
        }
    } catch (err) {
        renderDaftarInboxDariMemori();
    }
}

// ==========================================================================
// 2. CONTROLLER RUANG OBROLAN (ON-DEMAND WEBSOCKET)
// ==========================================================================
export function bukaRuangKomunikasi(idTiketMasuk, namaKlien = "Klien", tiketAwal = null) {
    if (!idTiketMasuk) return;

    hentikanNotifChat();
    goOnline(dbChat);

    idRuangObrolanAktif = idTiketMasuk;
    waktuBukaRuang = Date.now();

    if (tiketAwal) {
        memoriRuteSesiMap[idTiketMasuk] = tiketAwal;
        if (tiketAwal.wa_klien) {
            if (!sesiOrderDiterimaMap[idTiketMasuk]) {
                sesiOrderDiterimaMap[idTiketMasuk] = { accepted: false, wa_klien: tiketAwal.wa_klien };
            } else {
                sesiOrderDiterimaMap[idTiketMasuk].wa_klien = tiketAwal.wa_klien;
            }
        }
    }

    const panelChat = document.getElementById('panel-komunikasi-utama');
    const titleChat = document.getElementById('chat-session-title');
    const bodyChat = document.getElementById('chat-body');

    if (panelChat && titleChat && bodyChat) {
        titleChat.innerText = String(namaKlien || "Klien").split(' ')[0];
        bodyChat.innerHTML = '<div style="text-align:center; font-size:0.65rem; color:#64748b; margin:10px 0;">Sesi Privat. Hapus pesan melalui tombol tong sampah.</div>';
        panelChat.classList.remove('hidden-state');
    }

    if (tiketAwal && typeof window.gambarRutePesananOSRM === 'function' && !window.__BGT_CLEARED_ROUTES?.[idTiketMasuk]) {
        window.gambarRutePesananOSRM(tiketAwal, idTiketMasuk);
    }

    pasangSarafInteraksi();

    if (window.DriverChat_handleTouchMove) {
        document.removeEventListener('touchmove', window.DriverChat_handleTouchMove);
        document.removeEventListener('mousemove', window.DriverChat_handleTouchMove);
        document.addEventListener('touchmove', window.DriverChat_handleTouchMove, { passive: false });
        document.addEventListener('mousemove', window.DriverChat_handleTouchMove);
    }
    if (window.DriverChat_handleTouchEnd) {
        document.removeEventListener('touchend', window.DriverChat_handleTouchEnd);
        document.removeEventListener('mouseup', window.DriverChat_handleTouchEnd);
        document.addEventListener('touchend', window.DriverChat_handleTouchEnd);
        document.addEventListener('mouseup', window.DriverChat_handleTouchEnd);
    }

    mulaiDengarPesan();
}

function renderStatusOrderDiambilHTML(noWaKlien) {
    const cleanWa = String(noWaKlien || '').replace(/[^0-9]/g, '').replace(/^0/, '62');
    const safeWaKlien = encodeURIComponent(cleanWa);
    return `
        <div style="width:100%; display:flex; flex-direction:column; gap:8px;">
            <div style="background:rgba(16, 185, 129, 0.15); border:1px dashed #10b981; color:#10b981; text-align:center; padding:8px; border-radius:8px; font-weight:bold; font-size:0.75rem; letter-spacing:1px;">
                <i class="fa-solid fa-check-double"></i> ORDER DIAMBIL
            </div>
            ${cleanWa ? `<a href="https://wa.me/${safeWaKlien}" target="_blank" rel="noopener noreferrer" style="background:#10b981; color:#0b101a; text-align:center; padding:10px; border-radius:8px; font-weight:bold; font-size:0.75rem; text-decoration:none; display:flex; justify-content:center; align-items:center; gap:6px; box-shadow:0 4px 10px rgba(16,185,129,0.3); transition:all 0.2s;"><i class="fa-brands fa-whatsapp text-lg"></i> CHAT PENUMPANG</a>` : ''}
        </div>
    `;
}

function pasangSarafInteraksi() {
    if (isDOMEventBound) return;
    isDOMEventBound = true;

    const wadahChat = document.getElementById('chat-body');
    const btnBack = document.getElementById('chat-btn-back');
    const btnHapus = document.getElementById('chat-btn-tutup');
    const btnKirim = document.getElementById('chat-btn-send');
    const inputTeks = document.getElementById('chat-teks');
    const btnToggle = document.getElementById('btn-toggle-tools');
    const menuAlat = document.getElementById('menu-alat-ekspansi');
    const btnMic = document.getElementById('tool-audio');
    const btnLokasi = document.getElementById('tool-lokasi');
    const btnKamera = document.getElementById('tool-kamera');
    const btnGaleri = document.getElementById('tool-galeri');
    const inpKamera = document.getElementById('input-kamera');
    const inpGaleri = document.getElementById('input-galeri');

    if (!FITUR_MEDIA_AKTIF) {
        if (btnToggle) btnToggle.style.display = 'none';
        if (btnMic) btnMic.style.display = 'none';
        if (menuAlat) {
            const btnCam = document.getElementById('tool-kamera');
            const btnGal = document.getElementById('tool-galeri');
            if (btnCam) btnCam.style.display = 'none';
            if (btnGal) btnGal.style.display = 'none';
        }
    }

    btnBack.addEventListener('click', akhiriSesiKomunikasi);

    btnHapus.addEventListener('click', async () => {
        if (await window.showConfirm(
            "HAPUS SESI OBROLAN",
            "Apakah Anda yakin ingin menghapus sesi ini? Pesanan akan dihapus dari Inbox Anda secara permanen.",
            "Ya, Hapus",
            true
        )) {
            hapusSesiObrolanMutlak();
        }
    });

    wadahChat.addEventListener('click', async (e) => {
        const btnForensik = e.target.closest('.btn-buka-forensik');
        if (btnForensik) {
            bukaBottomSheetForensik(btnForensik.getAttribute('data-info'), btnForensik.getAttribute('data-log'));
            return;
        }

        // Tombol gambar ulang rute di peta jika driver sebelumnya menekan "Bersihkan Rute"
        const btnGambarUlangRute = e.target.closest('.btn-redraw-osrm-route');
        if (btnGambarUlangRute) {
            const idSesi = idRuangObrolanAktif;
            if (idSesi && window.__BGT_CLEARED_ROUTES) {
                delete window.__BGT_CLEARED_ROUTES[idSesi];
            }
            const dataRute = memoriRuteSesiMap[idSesi];
            if (dataRute && typeof window.gambarRutePesananOSRM === 'function') {
                window.gambarRutePesananOSRM(dataRute, idSesi);
                akhiriSesiKomunikasi();
                if (window.showToast) window.showToast("Rute jalan raya ditampilkan kembali di peta.", "success");
            }
            return;
        }

        const btnTolak = e.target.closest('.btn-tolak-order');
        const btnTerima = e.target.closest('.btn-terima-order');

        if (btnTolak) {
            if (await window.showConfirm(
                "TOLAK PESANAN",
                "Tolak pesanan ini? Sesi akan dihapus dan penumpang akan diberitahu.",
                "Ya, Tolak",
                true
            )) {
                if (idRuangObrolanAktif && auth.currentUser) {
                    const uid = auth.currentUser.uid;
                    const idSesi = idRuangObrolanAktif;

                    goOnline(dbChat);
                    await Promise.allSettled([
                        update(ref(dbChat, `sesi_komunikasi/${idSesi}/metadata_order`), {
                            status: 'REJECTED',
                            waktu_ditolak: Date.now()
                        }),
                        push(ref(dbChat, `sesi_komunikasi/${idSesi}/pesan`), {
                            pengirim: "mitra", tipe: "sistem_tolak", konten: "Driver menolak pesanan", waktu: Date.now(), status: "sent"
                        })
                    ]);

                    hapusItemInboxLokal(uid, idSesi);
                    if (typeof window.bersihkanRutePesanan === 'function') window.bersihkanRutePesanan(true);

                    setTimeout(() => {
                        remove(ref(dbRadar, `radar_tiket/${uid}/${idSesi}`)).catch(() => {});
                        remove(ref(dbChat, `inbox_mitra/${uid}/${idSesi}`)).catch(() => {});
                        remove(ref(dbChat, `sesi_komunikasi/${idSesi}`)).catch(() => {});
                    }, 1500);
                }
                akhiriSesiKomunikasi();
            }
            return;
        }

        if (btnTerima) {
            const actionArea = btnTerima.closest('.katalog-action-area');

            try {
                let noWaKlien = actionArea ? (actionArea.getAttribute('data-waklien') || '') : '';
                if (auth.currentUser && idRuangObrolanAktif) {
                    const uid = auth.currentUser.uid;
                    if (!noWaKlien) {
                        const snapMeta = await get(ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/metadata_order`)).catch(() => null);
                        if (snapMeta && snapMeta.exists()) {
                            noWaKlien = snapMeta.val().wa_klien || '';
                        }
                    }

                    tandaiOrderSudahDiambil(idRuangObrolanAktif, noWaKlien);

                    const refRadar = ref(dbRadar, `radar_tiket/${uid}/${idRuangObrolanAktif}`);
                    await update(refRadar, { status: 'ACCEPTED', waktu_diterima: Date.now() }).catch(() => {});
                    setTimeout(() => { remove(refRadar).catch(() => {}); }, 4000);

                    await update(ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/metadata_order`), {
                        status: 'ACCEPTED',
                        waktu_diterima: Date.now()
                    }).catch(() => {});

                    const waktuSekarang = Date.now();
                    simpanItemInboxLokal(uid, idRuangObrolanAktif, {
                        pesan_terakhir: "Pesanan diterima - Meluncur ke lokasi jemput",
                        waktu_update: waktuSekarang
                    });
                }

                if (actionArea) {
                    actionArea.innerHTML = renderStatusOrderDiambilHTML(noWaKlien);
                }

                const rawWaDriver = (actionArea ? actionArea.getAttribute('data-wadriver') : '') || document.getElementById('lock-wa')?.value || '';
                const cleanWaDriver = rawWaDriver.replace(/[^0-9]/g, '').replace(/^0/, '62');
                const pesanTeks = cleanWaDriver
                    ? `Pesanan Anda telah saya terima, saya segera meluncur. Hubungi WA saya jika perlu: https://wa.me/${cleanWaDriver}`
                    : "Pesanan Anda telah saya terima, saya segera meluncur.";
                await kirimPayloadPesan(pesanTeks, "teks");

            } catch (err) {
                if (window.showToast) window.showToast("Gagal menyetujui pesanan", "error");
            }
            return;
        }

        const seleksiTeks = window.getSelection();
        if (seleksiTeks && seleksiTeks.toString().length > 0) return;

        const triggerImg = e.target.closest('.image-fullscreen-trigger');
        if (triggerImg) bukaLayarPenuhGambar(triggerImg.getAttribute('data-img'));
    });

    btnToggle.addEventListener('click', () => {
        menuAlat.classList.toggle('show-tools');
        btnToggle.style.transform = menuAlat.classList.contains('show-tools') ? 'rotate(45deg)' : 'rotate(0deg)';
    });

    inputTeks.addEventListener('input', () => {
        const nodeMic = document.getElementById('tool-audio');
        if (inputTeks.value.trim() !== '') { nodeMic.classList.add('hidden-state'); btnKirim.classList.remove('hidden-state'); }
        else { nodeMic.classList.remove('hidden-state'); btnKirim.classList.add('hidden-state'); }
    });

    btnKirim.addEventListener('click', () => {
        if (inputTeks.value.trim() !== '') {
            kirimPayloadPesan(inputTeks.value, "teks");
            inputTeks.value = '';
            document.getElementById('tool-audio').classList.remove('hidden-state'); btnKirim.classList.add('hidden-state');
        }
    });

    btnLokasi.addEventListener('click', () => {
        btnLokasi.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const kordinat = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
                kirimPayloadPesan(kordinat, "lokasi");
                btnLokasi.innerHTML = '<i class="fa-solid fa-location-dot"></i> Lokasi';
                menuAlat.classList.remove('show-tools');
            },
            (err) => {
                if (window.showToast) window.showToast("Akses GPS Ditolak.", "error");
                btnLokasi.innerHTML = '<i class="fa-solid fa-location-dot"></i> Lokasi';
            }, { enableHighAccuracy: true }
        );
    });

    btnKamera.addEventListener('click', () => inpKamera.click());
    btnGaleri.addEventListener('click', () => inpGaleri.click());

    inpKamera.addEventListener('change', (e) => { if (e.target.files.length > 0) ekstrakForensikDanKirim(e.target.files[0], "Kamera Langsung"); menuAlat.classList.remove('show-tools'); });
    inpGaleri.addEventListener('change', (e) => { if (e.target.files.length > 0) ekstrakForensikDanKirim(e.target.files[0], "Galeri Perangkat"); menuAlat.classList.remove('show-tools'); });

    const uiDefault = document.getElementById('ui-chat-default');
    const uiRecording = document.getElementById('ui-chat-recording');
    const btnTrash = document.getElementById('bgt-btn-trash');
    const btnSendRecord = document.getElementById('bgt-btn-send-record');
    const btnPause = document.getElementById('bgt-btn-pause');
    const stateActive = document.getElementById('bgt-state-active');
    const stateLocked = document.getElementById('bgt-state-locked');
    const slideHint = document.getElementById('bgt-slide-hint');
    const lockIndicator = document.getElementById('bgt-lock-indicator');
    const timerText = document.getElementById('teks-timer-record');
    const canvasWave = document.getElementById('bgt-canvas-wave');

    if (uiRecording) uiRecording.classList.remove('hidden-state');

    let isRecording = false;
    let isLocked = false;
    let isPaused = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let streamGlobal = null;
    let idAnimasiCanvas = null;
    let konteksAudio = null;
    let waktuRekaman = 0;
    let timerLongPress = null;

    if (wadahChat && !wadahChat.dataset.instruksiAktif) {
        wadahChat.insertAdjacentHTML('beforeend', `
            <div style="text-align:center; background:rgba(206,171,107,0.1); border:1px dashed #ceab6b; border-radius:8px; padding:10px; margin:10px 0; font-size:0.7rem; color:#ceab6b; font-weight:bold;">
                <i class="fa-solid fa-circle-info"></i> INSTRUKSI REKAMAN SUARA:<br>
                Tahan tombol <i class="fa-solid fa-microphone"></i> untuk merekam.<br>Geser kiri untuk Batal | Geser atas untuk Kunci.
            </div>
        `);
        wadahChat.dataset.instruksiAktif = "true";
        setTimeout(() => wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' }), 100);
    }

    const matikanRekaman = () => {
        if (!isRecording) return;
        isRecording = false;
        if (streamGlobal) streamGlobal.getTracks().forEach(track => track.stop());
        clearInterval(intervalRekamanGlobal);
        cancelAnimationFrame(idAnimasiCanvas);
        if (konteksAudio && konteksAudio.state !== 'closed') konteksAudio.close();

        if (uiRecording) uiRecording.classList.remove('active');
        if (lockIndicator) lockIndicator.classList.remove('show');
        if (uiDefault) uiDefault.style.opacity = '1';
        const activeMic = document.getElementById('tool-audio');
        if (activeMic) activeMic.style.transform = 'scale(1)';
    };

    const kirimDataSuara = async (dataBlob) => {
        const idLoading = 'load_audio_' + Date.now();
        const templateLoading = document.getElementById('tpl-chat-loading');
        if (templateLoading && wadahChat) {
            const cloneLoad = templateLoading.content.cloneNode(true);
            cloneLoad.querySelector('.msg-bubble').id = idLoading;
            wadahChat.appendChild(cloneLoad);
            wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' });
        }
        try {
            const url = await uploadMediaKeCloudinary(dataBlob, 'audio', CLOUDINARY_PRESET);
            if (url) {
                await kirimPayloadPesan(url, "audio");
            }
            const loadEl = document.getElementById(idLoading);
            if (loadEl) loadEl.remove();
        } catch (e) {
            if (window.showToast) window.showToast("Gagal kirim audio.", "error");
            const loadEl = document.getElementById(idLoading);
            if (loadEl) loadEl.remove();
        }
    };

    const mulaiPerekamanUI = async () => {
        if (isRecording) return;
        isRecording = true;
        isLocked = false;
        isPaused = false;
        waktuRekaman = 0;

        try {
            streamGlobal = await navigator.mediaDevices.getUserMedia({ audio: true });
            perakamAudio = new MediaRecorder(streamGlobal);
            potonganAudio = [];
            window.batalKirimSuara = false;

            if (uiDefault) uiDefault.style.opacity = '0';
            if (uiRecording) uiRecording.classList.add('active');
            if (lockIndicator) lockIndicator.classList.add('show');

            if (stateActive) { stateActive.classList.remove('bgt-hidden'); stateActive.style.display = 'flex'; }
            if (stateLocked) stateLocked.classList.add('bgt-hidden');
            if (slideHint) slideHint.style.opacity = '1';
            if (btnSendRecord) btnSendRecord.style.transform = 'scale(0)';
            if (timerText) timerText.innerText = "0:00";

            if (canvasWave) {
                const canvasCtx = canvasWave.getContext('2d');
                konteksAudio = new (window.AudioContext || window.webkitAudioContext)();
                const source = konteksAudio.createMediaStreamSource(streamGlobal);
                const analyser = konteksAudio.createAnalyser();
                analyser.fftSize = 64;
                source.connect(analyser);
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);

                function drawWave() {
                    if (!isRecording || isPaused) return;
                    idAnimasiCanvas = requestAnimationFrame(drawWave);
                    analyser.getByteFrequencyData(dataArray);
                    canvasWave.width = canvasWave.offsetWidth;
                    canvasWave.height = canvasWave.offsetHeight;
                    canvasCtx.clearRect(0, 0, canvasWave.width, canvasWave.height);
                    const barWidth = 3;
                    const gap = 2;
                    let x = 0;
                    for (let i = 0; i < bufferLength; i++) {
                        const barHeight = Math.max(2, (dataArray[i] / 255) * canvasWave.height);
                        const y = (canvasWave.height / 2) - (barHeight / 2);
                        canvasCtx.fillStyle = '#10b981';
                        canvasCtx.beginPath();
                        if (canvasCtx.roundRect) canvasCtx.roundRect(x, y, barWidth, barHeight, 2);
                        else canvasCtx.fillRect(x, y, barWidth, barHeight);
                        canvasCtx.fill();
                        x += barWidth + gap;
                    }
                }
                drawWave();
            }

            perakamAudio.ondataavailable = e => { if (e.data.size > 0) potonganAudio.push(e.data); };

            perakamAudio.onstop = () => {
                matikanRekaman();
                if (window.batalKirimSuara) return;
                const blobAudio = new Blob(potonganAudio, { type: 'audio/webm' });
                kirimDataSuara(blobAudio);
            };

            perakamAudio.start();

            intervalRekamanGlobal = setInterval(() => {
                waktuRekaman++;
                const s = waktuRekaman % 60;
                const m = Math.floor(waktuRekaman / 60);
                if (timerText) timerText.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
                if (waktuRekaman >= 60 && perakamAudio.state === "recording") {
                    window.batalKirimSuara = false;
                    perakamAudio.stop();
                }
            }, 1000);

        } catch (err) {
            isRecording = false;
            if (window.showToast) window.showToast("Akses Mikrofon Ditolak", "error");
        }
    };

    const handleTouchStart = (e) => {
        if (isRecording) return;
        e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;

        const nodeMic = document.getElementById('tool-audio');
        if (nodeMic) nodeMic.style.transform = 'scale(1.1)';

        timerLongPress = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(50);
            if (nodeMic) nodeMic.style.transform = 'scale(1.3)';
            mulaiPerekamanUI();
        }, 400);
    };

    const handleTouchMove = (e) => {
        const touch = e.touches ? e.touches[0] : e;

        if (!isRecording) {
            const geserX = Math.abs(touch.clientX - touchStartX);
            const geserY = Math.abs(touch.clientY - touchStartY);
            if (geserX > 15 || geserY > 15) {
                clearTimeout(timerLongPress);
                const nodeMic = document.getElementById('tool-audio');
                if (nodeMic) nodeMic.style.transform = 'scale(1)';
            }
            return;
        }

        if (isLocked) return;
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;

        if (deltaY < -60) {
            isLocked = true;
            if (lockIndicator) lockIndicator.classList.remove('show');
            if (slideHint) slideHint.style.opacity = '0';
            if (stateActive) stateActive.classList.add('bgt-hidden');
            if (stateLocked) { stateLocked.classList.remove('bgt-hidden'); stateLocked.style.display = 'flex'; }
            if (btnSendRecord) btnSendRecord.style.transform = 'scale(1)';
            return;
        }

        if (deltaX < -50) {
            window.batalKirimSuara = true;
            if (perakamAudio && perakamAudio.state === "recording") perakamAudio.stop();
            return;
        }

        if (deltaX < 0 && deltaX > -50) {
            if (slideHint) slideHint.style.opacity = 1 - (Math.abs(deltaX) / 50);
        }
    };

    const handleTouchEnd = (e) => {
        clearTimeout(timerLongPress);

        const nodeMic = document.getElementById('tool-audio');
        if (nodeMic) nodeMic.style.transform = 'scale(1)';

        if (!isRecording) return;

        if (!isLocked) {
            window.batalKirimSuara = false;
            if (perakamAudio && (perakamAudio.state === "recording" || perakamAudio.state === "paused")) perakamAudio.stop();
        }
    };

    const newBtnMic = btnMic.cloneNode(true);
    btnMic.parentNode.replaceChild(newBtnMic, btnMic);
    const btnMicAktif = newBtnMic;

    btnMicAktif.addEventListener('touchstart', handleTouchStart, { passive: false });
    btnMicAktif.addEventListener('mousedown', handleTouchStart);

    window.DriverChat_handleTouchMove = handleTouchMove;
    window.DriverChat_handleTouchEnd = handleTouchEnd;

    document.addEventListener('touchmove', window.DriverChat_handleTouchMove, { passive: false });
    document.addEventListener('mousemove', window.DriverChat_handleTouchMove);
    document.addEventListener('touchend', window.DriverChat_handleTouchEnd);
    document.addEventListener('mouseup', window.DriverChat_handleTouchEnd);

    if (btnTrash) {
        btnTrash.addEventListener('click', (e) => {
            e.preventDefault();
            if (isRecording) {
                window.batalKirimSuara = true;
                if (perakamAudio && (perakamAudio.state === "recording" || perakamAudio.state === "paused")) perakamAudio.stop();
            }
        });
    }

    if (btnSendRecord) {
        btnSendRecord.addEventListener('click', (e) => {
            e.preventDefault();
            if (isRecording) {
                window.batalKirimSuara = false;
                if (perakamAudio && (perakamAudio.state === "recording" || perakamAudio.state === "paused")) perakamAudio.stop();
            }
        });
    }

    if (btnPause) {
        btnPause.addEventListener('click', (e) => {
            e.preventDefault();
            if (!perakamAudio) return;
            if (isPaused) {
                isPaused = false;
                btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Jeda';
                perakamAudio.resume();

                intervalRekamanGlobal = setInterval(() => {
                    waktuRekaman++;
                    const s = waktuRekaman % 60;
                    const m = Math.floor(waktuRekaman / 60);
                    if (timerText) timerText.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
                    if (waktuRekaman >= 60 && perakamAudio.state === "recording") {
                        window.batalKirimSuara = false;
                        perakamAudio.stop();
                    }
                }, 1000);
            } else {
                isPaused = true;
                btnPause.innerHTML = '<i class="fa-solid fa-microphone"></i> Lanjut';
                perakamAudio.pause();
                clearInterval(intervalRekamanGlobal);
            }
        });
    }

    const btnSalinLog = document.getElementById('btn-bs-salin');
    if (btnSalinLog) {
        btnSalinLog.addEventListener('click', async (e) => {
            const b64 = e.target.closest('button').getAttribute('data-log');
            if (!b64) return;
            try {
                await navigator.clipboard.writeText(decodeURIComponent(escape(atob(b64))));
                if (window.showToast) window.showToast("Log disalin", "success");
                tutupBottomSheetForensik();
            } catch (err) { if (window.showToast) window.showToast("Gagal menyalin", "error"); }
        });
    }

    document.getElementById('btn-tutup-modal-img').addEventListener('click', tutupLayarPenuhGambar);
    document.getElementById('modal-fullscreen-img').addEventListener('click', (e) => { if (e.target.id === 'modal-fullscreen-img') tutupLayarPenuhGambar(); });
    document.getElementById('bs-backdrop').addEventListener('click', tutupBottomSheetForensik);
}

export function akhiriSesiKomunikasi() {
    const sesiSebelumnya = idRuangObrolanAktif;
    idRuangObrolanAktif = null;

    const apakahSesiSudahDiambil = Boolean(sesiSebelumnya && sesiOrderDiterimaMap[sesiSebelumnya]?.accepted);

    if (!apakahSesiSudahDiambil) {
        if (typeof pemantauPesan === 'function') { pemantauPesan(); pemantauPesan = null; }
        if (typeof pemantauPesanUbah === 'function') { pemantauPesanUbah(); pemantauPesanUbah = null; }
        goOffline(dbChat);
    } else {
        idRuangObrolanAktif = sesiSebelumnya;
    }

    if (intervalRekamanGlobal) { clearInterval(intervalRekamanGlobal); intervalRekamanGlobal = null; }

    if (perakamAudio && (perakamAudio.state === "recording" || perakamAudio.state === "paused")) {
        perakamAudio.stop();
    }

    if (window.DriverChat_handleTouchMove) {
        document.removeEventListener('touchmove', window.DriverChat_handleTouchMove);
        document.removeEventListener('mousemove', window.DriverChat_handleTouchMove);
    }
    if (window.DriverChat_handleTouchEnd) {
        document.removeEventListener('touchend', window.DriverChat_handleTouchEnd);
        document.removeEventListener('mouseup', window.DriverChat_handleTouchEnd);
    }

    const panel = document.getElementById('panel-komunikasi-utama');
    if (panel) panel.classList.add('hidden-state');

    const indikatorKedip = document.getElementById('chat-notif-dot');
    if (indikatorKedip) indikatorKedip.classList.add('hidden-state');
}

async function hapusSesiObrolanMutlak() {
    if (!idRuangObrolanAktif || !auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const idSesi = idRuangObrolanAktif;

    try {
        goOnline(dbChat);
        hapusItemInboxLokal(uid, idSesi);
        delete sesiOrderDiterimaMap[idSesi];
        delete memoriRuteSesiMap[idSesi];
        if (typeof window.bersihkanRutePesanan === 'function') window.bersihkanRutePesanan(true);

        await Promise.allSettled([
            remove(ref(dbRadar, `radar_tiket/${uid}/${idSesi}`)),
            remove(ref(dbChat, `inbox_mitra/${uid}/${idSesi}`)),
            remove(ref(dbChat, `sesi_komunikasi/${idSesi}`))
        ]);
        if (window.showToast) window.showToast("Sesi berhasil dihapus.", "success");
    } catch (err) {
        console.error("Gagal menghapus:", err);
    }
    idRuangObrolanAktif = null;
    if (typeof pemantauPesan === 'function') { pemantauPesan(); pemantauPesan = null; }
    if (typeof pemantauPesanUbah === 'function') { pemantauPesanUbah(); pemantauPesanUbah = null; }
    goOffline(dbChat);
    const panel = document.getElementById('panel-komunikasi-utama');
    if (panel) panel.classList.add('hidden-state');
}

// ==========================================================================
// 3. PARSER PESAN & OMNI-CARD ENGINE (SPESIFIKASI 3.2 & 3.4)
// ==========================================================================
function renderSmartReplyDriver(teksPesan) {
    let container = document.getElementById('bgt-smart-reply');
    if (!container) {
        const footer = document.querySelector('.chat-footer');
        if (!footer) return;
        footer.insertAdjacentHTML('afterbegin', `<div id="bgt-smart-reply" style="display:flex; gap:8px; overflow-x:auto; margin-bottom:8px; padding-bottom:4px; scrollbar-width:none;"></div>`);
        container = document.getElementById('bgt-smart-reply');
    }
    container.innerHTML = '';

    let opsiBalasan = [];
    const teks = String(teksPesan || '').toLowerCase();

    if (teks.includes('di mana') || teks.includes('dimana') || teks.includes('posisi')) {
        opsiBalasan = [{ label: '📍 Kirim Lokasi', aksi: 'lokasi' }, { label: 'Saya sedang meluncur kak', aksi: 'teks' }];
    } else if (teks.includes('sesuai') || teks.includes('map')) {
        opsiBalasan = [{ label: 'Baik, sesuai aplikasi ya', aksi: 'teks' }, { label: 'Oke siap', aksi: 'teks' }];
    } else if (teks.includes('tunggu') || teks.includes('sebentar')) {
        opsiBalasan = [{ label: 'Oke, saya tunggu', aksi: 'teks' }, { label: 'Siap kak', aksi: 'teks' }];
    } else if (teks === 'p' || teks.includes('halo') || teks.includes('ping')) {
        opsiBalasan = [{ label: 'Halo kak, titik jemput sesuai?', aksi: 'teks' }, { label: 'Iya kak, otw', aksi: 'teks' }];
    }

    if (opsiBalasan.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    opsiBalasan.forEach(opt => {
        const btn = document.createElement('button');
        btn.innerText = opt.label;
        btn.style.cssText = "background:rgba(206,171,107,0.1); border:1px solid #ceab6b; color:#ceab6b; padding:6px 12px; border-radius:14px; font-size:0.7rem; font-weight:bold; white-space:nowrap; cursor:pointer;";
        btn.onclick = () => {
            if (opt.aksi === 'lokasi') {
                const btnLokasi = document.getElementById('tool-lokasi');
                if (btnLokasi) btnLokasi.click();
            } else {
                kirimPayloadPesan(opt.label, "teks");
            }
            container.innerHTML = '';
            container.style.display = 'none';
        };
        container.appendChild(btn);
    });
}

function mulaiDengarPesan() {
    if (typeof pemantauPesan === 'function') {
        pemantauPesan();
        pemantauPesan = null;
    }
    if (typeof pemantauPesanUbah === 'function') {
        pemantauPesanUbah();
        pemantauPesanUbah = null;
    }

    waktuBukaRuang = Date.now();
    const idSesiSaatIni = idRuangObrolanAktif;
    const referensi = query(ref(dbChat, `sesi_komunikasi/${idSesiSaatIni}/pesan`), limitToLast(50));
    const wadahChat = document.getElementById('chat-body');

    if (idSesiSaatIni && !sesiOrderDiterimaMap[idSesiSaatIni]?.accepted) {
        get(ref(dbChat, `sesi_komunikasi/${idSesiSaatIni}/metadata_order`)).then((snap) => {
            if (snap && snap.exists()) {
                const meta = snap.val();
                if (meta.status === 'ACCEPTED') {
                    tandaiOrderSudahDiambil(idSesiSaatIni, meta.wa_klien || '');
                    const area = wadahChat ? wadahChat.querySelector('.katalog-action-area') : null;
                    if (area) {
                        const wa = area.getAttribute('data-waklien') || meta.wa_klien || '';
                        area.innerHTML = renderStatusOrderDiambilHTML(wa);
                    }
                }
            }
        }).catch(() => {});
    }

    pemantauPesan = onChildAdded(referensi, (snapshot) => {
        const pesan = snapshot.val();
        if (!pesan) return;

        const isPesanBaru = (pesan.waktu && pesan.waktu > waktuBukaRuang);
        const panelChat = document.getElementById('panel-komunikasi-utama');
        const isPanelChatTerbuka = panelChat && !panelChat.classList.contains('hidden-state');

        if (pesan.tipe === 'sistem_ping') {
            if (isPesanBaru) {
                mainkanNotifikasiPesanMasuk();
                try { if ('vibrate' in navigator) navigator.vibrate([600, 150, 600, 150, 800]); } catch (e) {}
                bacakanPesanChatKokpit("Perhatian! Penumpang memanggil Anda di ruang obrolan!");
                if (document.visibilityState === 'hidden' || !isPanelChatTerbuka) {
                    tampilkanBannerNotifChatLatarBelakang(
                        "🔔 PENUMPANG MEMANGGIL ANDA!",
                        pesan.konten || "Penumpang menekan tombol Deringkan Driver. Ketuk untuk membuka obrolan!",
                        idSesiSaatIni
                    );
                }
                if (window.showToast) window.showToast("🔔 Penumpang memanggil Anda!", "warning");
            }
            return;
        }

        if (pesan.pengirim === 'klien') {
            if (pesan.tipe === 'teks') {
                renderSmartReplyDriver(pesan.konten);
            }

            if (isPesanBaru) {
                mainkanNotifikasiPesanMasuk();
                try { if ('vibrate' in navigator) navigator.vibrate([400, 150, 400, 150, 600]); } catch (e) {}

                const indikatorKedip = document.getElementById('chat-notif-dot');
                if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');

                let previewTeks = pesan.tipe === 'teks' ? pesan.konten : (pesan.tipe === 'lokasi' ? '📍 Mengirim Titik Lokasi' : (pesan.tipe === 'audio' ? '🎤 Mengirim Pesan Suara' : (pesan.tipe === 'katalog_order' ? '📜 Mengirim Katalog Order' : '🖼️ Mengirim Gambar')));

                if (pesan.tipe !== 'katalog_order') {
                    if (pesan.tipe === 'teks') {
                        bacakanPesanChatKokpit(`Pesan baru dari penumpang. ${String(pesan.konten).substring(0, 120)}`);
                    } else {
                        bacakanPesanChatKokpit(`Penumpang mengirim ${previewTeks.replace(/[^\w\s]/gi, '')}`);
                    }

                    if (document.visibilityState === 'hidden' || !isPanelChatTerbuka) {
                        tampilkanBannerNotifChatLatarBelakang(
                            `💬 Pesan Baru dari Penumpang`,
                            previewTeks,
                            idSesiSaatIni
                        );
                    }
                }

                if (auth.currentUser && idRuangObrolanAktif) {
                    const uid = auth.currentUser.uid;
                    const waktuSekarang = Date.now();
                    update(ref(dbChat, `inbox_mitra/${uid}/${idRuangObrolanAktif}`), {
                        pesan_terakhir: previewTeks,
                        waktu_update: waktuSekarang
                    }).catch(() => {});
                    simpanItemInboxLokal(uid, idRuangObrolanAktif, {
                        pesan_terakhir: previewTeks,
                        waktu_update: waktuSekarang
                    });
                }
            }
        }

        const posisiKelas = pesan.pengirim === 'mitra' ? 'msg-mitra' : 'msg-klien';
        let htmlKonten = '';

        if (pesan.tipe === 'teks') {
            htmlKonten = `<p>${escapeHTML(pesan.konten)}</p>`;
        } else if (pesan.tipe === 'katalog_order') {
            try {
                const k = JSON.parse(pesan.konten);
                const formatRp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(k.harga) || 0);
                const warnaLayanan = k.layanan === 'RIDE' ? '#3b82f6' : (k.layanan === 'EXPRESS' ? '#f59e0b' : '#10b981');

                const objekRuteKatalog = {
                    pickup_coord: k.pickup_coord,
                    dropoff_coord: k.dropoff_coord,
                    pickup_alamat: k.jemput,
                    dropoff_alamat: k.tujuan,
                    waypoints: k.waypoints || '',
                    toko_jastip: k.toko_jastip || null
                };
                if (idSesiSaatIni) {
                    memoriRuteSesiMap[idSesiSaatIni] = objekRuteKatalog;
                }

                const sudahDihapusDriver = Boolean(idSesiSaatIni && window.__BGT_CLEARED_ROUTES?.[idSesiSaatIni]);
                if (!sudahDihapusDriver && (k.pickup_coord || k.dropoff_coord) && typeof window.gambarRutePesananOSRM === 'function') {
                    window.gambarRutePesananOSRM(objekRuteKatalog, idSesiSaatIni);
                }

                let mapsUrl = `https://www.google.com/maps/dir/?api=1`;
                if (k.pickup_coord) mapsUrl += `&origin=${encodeURIComponent(k.pickup_coord)}`;
                else mapsUrl += `&origin=${encodeURIComponent(k.jemput || '')}`;

                if (k.dropoff_coord) mapsUrl += `&destination=${encodeURIComponent(k.dropoff_coord)}`;
                else mapsUrl += `&destination=${encodeURIComponent(k.tujuan || '')}`;

                if (k.waypoints) mapsUrl += `&waypoints=${encodeURIComponent(k.waypoints)}`;

                const isJastip = k.layanan === 'JASTIP' && Array.isArray(k.belanjaan) && k.belanjaan.length > 0;
                let htmlJastip = '';
                if (isJastip) {
                    let rincianBelanjaTotal = 0;
                    k.belanjaan.forEach(item => { rincianBelanjaTotal += ((Number(item.qty) || 0) * (Number(item.price) || 0)); });
                    const formatBelanja = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(rincianBelanjaTotal);
                    htmlJastip = `<div style="border-top:1px dashed rgba(255,255,255,0.2); margin:8px 0; padding-top:8px;">
                        <span style="font-size:0.6rem; color:#94a3b8; display:block; margin-bottom:4px; font-weight:bold;">DAFTAR BELANJA:</span>
                        <ul style="margin:0 0 6px 0; padding-left:14px; font-size:0.75rem; color:#f8fafc;">
                            ${k.belanjaan.map(i => `<li><b>${escapeHTML(i.qty)}x</b> ${escapeHTML(i.name)} (@ Rp${escapeHTML(i.price)})</li>`).join('')}
                        </ul>
                        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); padding: 4px 8px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size:0.65rem; color:#10b981; font-weight:bold;">ESTIMASI BELANJA</span>
                            <span style="font-size:0.85rem; color:#10b981; font-weight:900; font-family:monospace;">${formatBelanja}</span>
                        </div>
                    </div>`;
                }

                let htmlCatatan = '';
                if (k.catatan && String(k.catatan).trim() !== '') {
                    htmlCatatan = `<div style="background:rgba(255,255,255,0.05); border-left:3px solid #94a3b8; padding:8px; border-radius:4px; margin-top:8px;">
                        <span style="font-size:0.65rem; color:#94a3b8; font-weight:bold; display:block; margin-bottom:2px;"><i class="fa-solid fa-comment-dots"></i> CATATAN DRIVER:</span>
                        <span style="font-size:0.75rem; color:#f8fafc; font-style:italic;">"${escapeHTML(k.catatan)}"</span>
                    </div>`;
                }

                let htmlBadgeTip = '';
                if (k.tip_nominal && Number(k.tip_nominal) > 0) {
                    const formatTip = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(k.tip_nominal) || 0);
                    htmlBadgeTip = `<div style="margin-top:4px; display:inline-block; background:rgba(212, 175, 55, 0.15); border:1px solid #ceab6b; color:#ceab6b; font-size:0.6rem; font-weight:bold; padding:2px 8px; border-radius:12px;">
                        <i class="fa-solid fa-bolt"></i> Termasuk Tip ${formatTip}
                    </div>`;
                }

                const waDriverLokal = document.getElementById('lock-wa')?.value || k.wa_driver || '';
                const waKlienDariKatalog = k.wa_klien || sesiOrderDiterimaMap[idRuangObrolanAktif]?.wa_klien || '';
                const sudahDiambil = Boolean(sesiOrderDiterimaMap[idRuangObrolanAktif]?.accepted);

                const actionButtons = sudahDiambil
                    ? `<div class="katalog-action-area" data-wadriver="${escapeHTML(waDriverLokal)}" data-waklien="${escapeHTML(waKlienDariKatalog)}" style="display:flex; gap:8px; margin-top:8px;">
                        ${renderStatusOrderDiambilHTML(waKlienDariKatalog)}
                       </div>`
                    : `<div class="katalog-action-area" data-wadriver="${escapeHTML(waDriverLokal)}" data-waklien="${escapeHTML(waKlienDariKatalog)}" style="display:flex; gap:8px; margin-top:8px;">
                        <button class="btn-tolak-order" style="flex:1; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); color:#ef4444; padding:10px; border-radius:8px; font-weight:bold; font-size:0.75rem; cursor:pointer; transition:all 0.2s;"><i class="fa-solid fa-xmark"></i> TOLAK</button>
                        <button class="btn-terima-order" style="flex:1; background:#10b981; color:#0b101a; border:none; padding:10px; border-radius:8px; font-weight:bold; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 10px rgba(16,185,129,0.3); transition:all 0.2s;"><i class="fa-solid fa-check"></i> TERIMA</button>
                       </div>`;

                htmlKonten = `
                    <div style="background:#0f1624; border:1px solid ${warnaLayanan}; border-radius:12px; padding:12px; width:min(255px, 76vw); display:flex; flex-direction:column; gap:6px; box-shadow:0 8px 20px rgba(0,0,0,0.4);">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px;">
                            <span style="font-size:0.65rem; color:${warnaLayanan}; font-weight:900; letter-spacing:1px;"><i class="fa-solid fa-receipt mr-1"></i> ORDER: ${escapeHTML(k.layanan)}</span>
                            <span style="font-size:0.65rem; color:#94a3b8; font-family:monospace;">${escapeHTML(k.jarak)} KM</span>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
                            <div style="display:flex; gap:6px;">
                                <i class="fa-solid fa-circle-up" style="color:#10b981; font-size:0.7rem; margin-top:3px;"></i>
                                <span style="font-size:0.75rem; color:#f8fafc; line-height:1.3;"><b>Jemput:</b><br>${escapeHTML(k.jemput)}</span>
                            </div>
                            <div style="width:2px; height:10px; background:rgba(255,255,255,0.2); margin-left:4px;"></div>
                            <div style="display:flex; gap:6px;">
                                <i class="fa-solid fa-location-dot" style="color:#ef4444; font-size:0.7rem; margin-top:3px;"></i>
                                <span style="font-size:0.75rem; color:#f8fafc; line-height:1.3;"><b>Tujuan:</b><br>${escapeHTML(k.tujuan)}</span>
                            </div>
                        </div>
                        ${htmlJastip}
                        ${htmlCatatan}
                        <div style="background:rgba(212,175,55,0.1); border:1px dashed #ceab6b; border-radius:6px; padding:8px; text-align:center; margin-top:6px;">
                            <span style="font-size:0.6rem; color:#ceab6b; display:block;">ESTIMASI TARIF</span>
                            <span style="font-size:1.2rem; color:#ceab6b; font-weight:900; font-family:monospace;">${formatRp}</span>
                            ${htmlBadgeTip}
                        </div>
                        <div style="display:flex; gap:6px; margin-top:4px;">
                            <a href="${mapsUrl}" target="_blank" style="flex:1; background:#2563eb; color:#fff; text-align:center; padding:8px; border-radius:8px; font-weight:bold; font-size:0.68rem; text-decoration:none; display:flex; justify-content:center; align-items:center; gap:5px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">
                                <i class="fa-solid fa-diamond-turn-right"></i> GOOGLE MAPS
                            </a>
                            <button type="button" class="btn-redraw-osrm-route" style="background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); color:#10b981; padding:8px 10px; border-radius:8px; font-weight:bold; font-size:0.68rem; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:4px;" title="Tampilkan Rute di Peta Aplikasi">
                                <i class="fa-solid fa-route"></i> RUTE
                            </button>
                        </div>
                        ${actionButtons}
                    </div>
                `;
            } catch (e) { htmlKonten = `<p><i>[Katalog Order Error]</i></p>`; }
        } else if (pesan.tipe === 'lokasi') {
            const [latRaw, lngRaw] = String(pesan.konten || '0,0').split(',');
            const lat = parseFloat(latRaw) || 0;
            const lng = parseFloat(lngRaw) || 0;
            htmlKonten = `
                <div style="background:#0f1624; border:1px solid #ceab6b; border-radius:12px; padding:12px; width:220px; display:flex; flex-direction:column; gap:10px; box-shadow:0 4px 15px rgba(0,0,0,0.3);">
                    <div style="display:flex; align-items:center; gap:10px; border-bottom:1px solid rgba(206,171,107,0.2); padding-bottom:8px;">
                        <div style="width:36px; height:36px; border-radius:50%; background:rgba(206,171,107,0.1); display:flex; justify-content:center; align-items:center; color:#ceab6b; font-size:1.1rem; flex-shrink:0;">
                            <i class="fa-solid fa-map-pin"></i>
                        </div>
                        <div style="display:flex; flex-direction:column; overflow:hidden;">
                            <span style="font-size:0.75rem; color:#ceab6b; font-weight:bold;">Titik Koordinat</span>
                            <span style="font-size:0.6rem; color:#94a3b8; font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Lat: ${lat.toFixed(5)}</span>
                            <span style="font-size:0.6rem; color:#94a3b8; font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Lng: ${lng.toFixed(5)}</span>
                        </div>
                    </div>
                    <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" style="background:#ceab6b; color:#0b101a; padding:10px; border-radius:8px; text-align:center; font-size:0.8rem; font-weight:bold; text-decoration:none; display:flex; justify-content:center; align-items:center; gap:6px;">
                        <i class="fa-solid fa-diamond-turn-right"></i> BUKA MAPS
                    </a>
                </div>
            `;
        } else if (pesan.tipe === 'audio') {
            htmlKonten = `<audio controls src="${escapeHTML(pesan.konten)}" style="height:32px; width:180px;"></audio>`;
        } else if (pesan.tipe === 'gambar') {
            let teksSalin = `SUMBER: ${pesan.forensik?.sumber}
IP SAAT INI: ${pesan.forensik?.ip}
NET: ${pesan.forensik?.jaringan}
RAM/CPU: ${pesan.forensik?.ram_cpu}
GPS SAAT UPLOAD: ${pesan.forensik?.lokasi}
OS: ${pesan.forensik?.browser}`;
            if (pesan.forensik?.exif) teksSalin += `

--- METADATA ASLI (GALERI) ---
KAMERA: ${pesan.forensik.exif.kamera}
WAKTU DIAMBIL: ${pesan.forensik.exif.waktu_diambil}
GPS ASLI: ${pesan.forensik.exif.lokasi_asli}`;

            const b64Teks = btoa(unescape(encodeURIComponent(teksSalin)));
            const dataForensikStr = btoa(unescape(encodeURIComponent(JSON.stringify(pesan.forensik || {}))));
            const urlAman = escapeHTML(pesan.konten);

            htmlKonten = `
                <div class="media-container" style="position:relative; width:200px;">
                    <div class="image-wrapper image-fullscreen-trigger" data-img="${urlAman}" style="position:relative; border-radius:6px; overflow:hidden; cursor:pointer; height: 260px;">
                        <img src="${urlAman}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; -webkit-touch-callout:none; user-select:none;">
                        <div style="position:absolute; inset:0; z-index:10;" oncontextmenu="return false;"></div>
                    </div>
                    <div class="btn-buka-forensik" data-log="${b64Teks}" data-info="${dataForensikStr}" style="position:absolute; bottom:8px; right:8px; background:rgba(15,22,36,0.8); border:1px solid #ceab6b; color:#ceab6b; width:28px; height:28px; border-radius:50%; display:flex; justify-content:center; align-items:center; z-index:20; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.5); backdrop-filter:blur(4px);">
                        <i class="fa-solid fa-shield-halved" style="font-size:0.75rem; pointer-events:none;"></i>
                    </div>
                </div>`;
        }

        const idUnik = snapshot.key;

        if (pesan.pengirim === 'klien' && pesan.status !== 'read' && isPanelChatTerbuka && document.visibilityState === 'visible') {
            update(ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/pesan/${idUnik}`), { status: 'read' }).catch(() => {});
        }

        let statusIkon = '';
        if (pesan.pengirim === 'mitra') {
            statusIkon = pesan.status === 'read'
                ? `<i class="fa-solid fa-check-double" style="color: #3b82f6; font-size: 0.65rem; margin-left: 4px;"></i>`
                : `<i class="fa-solid fa-check" style="color: #9ca3af; font-size: 0.65rem; margin-left: 4px;"></i>`;
        }

        const extraCardClass = (pesan.tipe === 'katalog_order' || pesan.tipe === 'lokasi' || pesan.tipe === 'gambar') ? ' msg-katalog-card' : '';
        if (wadahChat && !document.getElementById(idUnik)) {
            wadahChat.insertAdjacentHTML('beforeend', `<div id="${escapeHTML(idUnik)}" class="msg-bubble ${posisiKelas}${extraCardClass}"><div class="msg-content">${htmlKonten}</div><span class="msg-time" style="display: flex; align-items: center; justify-content: flex-end; margin-top: 2px;">${new Date(pesan.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}${statusIkon}</span></div>`);

            clearTimeout(wadahChat.scrollTimer);
            wadahChat.scrollTimer = setTimeout(() => wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' }), 150);
        }
    });

    if (pemantauPesanUbah) pemantauPesanUbah();
    pemantauPesanUbah = onChildChanged(referensi, (snapshot) => {
        const pesanUbah = snapshot.val();
        if (pesanUbah && pesanUbah.pengirim === 'mitra' && pesanUbah.status === 'read') {
            const elemenPesan = document.getElementById(snapshot.key);
            if (elemenPesan) {
                const timeSpan = elemenPesan.querySelector('.msg-time');
                if (timeSpan) {
                    timeSpan.innerHTML = `${new Date(pesanUbah.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} <i class="fa-solid fa-check-double" style="color: #3b82f6; font-size: 0.65rem; margin-left: 4px;"></i>`;
                }
            }
        }
    });
}

// ==========================================================================
// 4. MESIN PENGIRIM PESAN & MEDIA (SPESIFIKASI 3.3)
// ==========================================================================
async function kirimPayloadPesan(kontenPesan, tipePesan = "teks", metadataForensik = null) {
    if (!idRuangObrolanAktif || idRuangObrolanAktif.trim() === "" || !kontenPesan) return;

    try {
        goOnline(dbChat);
        const referensi = ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/pesan`);
        const payload = { pengirim: "mitra", tipe: tipePesan, konten: kontenPesan, waktu: Date.now(), status: "sent" };
        if (metadataForensik) payload.forensik = metadataForensik;
        await push(referensi, payload);

        if (auth.currentUser) {
            const uid = auth.currentUser.uid;
            let previewTeks = tipePesan === 'teks' ? kontenPesan : (tipePesan === 'lokasi' ? '📍 Mengirim Lokasi' : (tipePesan === 'audio' ? '🎤 Pesan Suara' : '🖼️ Mengirim Gambar'));
            const waktuSekarang = Date.now();
            await update(ref(dbChat, `inbox_mitra/${uid}/${idRuangObrolanAktif}`), {
                pesan_terakhir: "Anda: " + previewTeks,
                waktu_update: waktuSekarang
            });
            simpanItemInboxLokal(uid, idRuangObrolanAktif, {
                pesan_terakhir: "Anda: " + previewTeks,
                waktu_update: waktuSekarang
            });
        }
    } catch (err) { console.error("Gagal kirim pesan:", err); }
}

// ==========================================================================
// WEB AUDIO API SYNTHESIZER: SOUND EFFECT 4. PESAN PELANGGAN (BERBUNYI 2 KALI)
// ==========================================================================
let audioCtxChat = null;
let chatAlarmTimeout = null;
let isChatAlarmPlaying = false;
let activeChatOscillators = [];

export function hentikanNotifChat() {
    if (chatAlarmTimeout) { clearTimeout(chatAlarmTimeout); chatAlarmTimeout = null; }
    isChatAlarmPlaying = false;
    if (activeChatOscillators.length > 0) {
        activeChatOscillators.forEach(item => {
            try { item.osc.stop(); } catch (e) {}
            try { item.osc.disconnect(); } catch (e) {}
            try { item.gain.disconnect(); } catch (e) {}
        });
        activeChatOscillators = [];
    }
}

document.addEventListener('click', hentikanNotifChat, { passive: true });
document.addEventListener('touchstart', hentikanNotifChat, { passive: true });

export function mainkanNotifikasiPesanMasuk() {
    hentikanNotifChat();

    try {
        if (!audioCtxChat) { audioCtxChat = new (window.AudioContext || window.webkitAudioContext)(); }
        if (audioCtxChat.state === 'suspended') audioCtxChat.resume().catch(() => {});
    } catch (e) { return; }

    isChatAlarmPlaying = true;

    try {
        const synth = function(audioCtx) {
            const t = audioCtx.currentTime;
            for (let i = 0; i < 2; i++) { // Hanya berbunyi 2 kali saja
                const start = t + (i * 2);
                [1500, 2000].forEach((freq, idx) => {
                    const o = audioCtx.createOscillator();
                    const g = audioCtx.createGain();
                    o.type = 'sine';
                    o.frequency.value = freq;
                    const d = start + (idx * 0.15);
                    g.gain.setValueAtTime(0, d);
                    g.gain.linearRampToValueAtTime(0.7, d + 0.05);
                    g.gain.exponentialRampToValueAtTime(0.001, d + 1.5);
                    o.connect(g);
                    g.connect(audioCtx.destination);
                    o.start(d);
                    o.stop(d + 1.5);
                    activeChatOscillators.push({ osc: o, gain: g });
                });
            }
        };
        synth(audioCtxChat);
    } catch (e) {}

    chatAlarmTimeout = setTimeout(() => {
        isChatAlarmPlaying = false;
        activeChatOscillators = [];
    }, 3700);
}

function dapatkanKunciLokasiForensik() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) resolve("GPS_TIDAK_DIDUKUNG");
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve(`https://www.google.com/maps/search/?api=1&query=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`),
            (err) => resolve("AKSES_GPS_DITOLAK"),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 }
        );
    });
}

async function ekstrakForensikDanKirim(fileGambar, asalTangkapan) {
    if (window.showToast) window.showToast("Mengekstrak Metadata & Mengompresi...", "info");

    const idLoading = 'load_img_' + Date.now();
    const wadahChat = document.getElementById('chat-body');
    const templateLoading = document.getElementById('tpl-chat-loading');
    if (templateLoading && wadahChat) {
        const cloneLoad = templateLoading.content.cloneNode(true);
        cloneLoad.querySelector('.msg-bubble').id = idLoading;
        wadahChat.appendChild(cloneLoad);
        wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' });
    }

    let ipPublik = "Gagal memuat";
    try {
        const abortCtrl = new AbortController();
        const ipTimeoutId = setTimeout(() => abortCtrl.abort(), 1500);
        const res = await fetch('https://api.ipify.org?format=json', { signal: abortCtrl.signal });
        clearTimeout(ipTimeoutId);
        const d = await res.json();
        ipPublik = d.ip || "Gagal memuat";
    } catch (e) {
        ipPublik = "Timeout/Offline";
    }

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const infoJaringan = conn ? `${conn.effectiveType || 'N/A'} (${conn.downlink || 0}Mbps)` : "N/A";
    const ram = navigator.deviceMemory ? `${navigator.deviceMemory}GB+` : "N/A";
    const cpu = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} Core` : "N/A";
    const lokasiFaktual = await dapatkanKunciLokasiForensik();

    let dataExifAsli = null;
    if (asalTangkapan === "Galeri Perangkat") {
        try {
            const exifr = await import('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.js');
            const exifData = await exifr.default.parse(fileGambar);
            if (exifData) {
                let linkPetaExif = "Tidak tersimpan di gambar";
                if (exifData.latitude && exifData.longitude) linkPetaExif = `https://www.google.com/maps/search/?api=1&query=${exifData.latitude.toFixed(6)},${exifData.longitude.toFixed(6)}`;
                dataExifAsli = {
                    kamera: (exifData.Make || exifData.Model) ? `${exifData.Make || ''} ${exifData.Model || ''}`.trim() : "Tidak diketahui",
                    waktu_diambil: exifData.DateTimeOriginal ? new Date(exifData.DateTimeOriginal).toLocaleString('id-ID') : "Tidak diketahui",
                    lokasi_asli: linkPetaExif
                };
            }
        } catch (e) {}
    }

    const dataForensik = { sumber: asalTangkapan, ip: ipPublik, jaringan: infoJaringan, ram_cpu: `${ram} / ${cpu}`, lokasi: lokasiFaktual, browser: navigator.userAgent.substring(0, 50) + "..." };
    if (dataExifAsli) dataForensik.exif = dataExifAsli;

    try {
        const blobWebP = await kompresGambarKeWebP(fileGambar, 1280, 0.75);
        const urlGambar = await uploadMediaKeCloudinary(blobWebP, 'image', CLOUDINARY_PRESET);
        await kirimPayloadPesan(urlGambar, "gambar", dataForensik);
        const loadEl = document.getElementById(idLoading);
        if (loadEl) loadEl.remove();
    } catch (e) {
        if (window.showToast) window.showToast("Gagal Unggah: " + e.message, "error");
        const loadEl = document.getElementById(idLoading);
        if (loadEl) loadEl.remove();
    }
}

// ==========================================================================
// 5. DOM MODAL FORENSIK & GAMBAR LAYAR PENUH
// ==========================================================================
function bukaLayarPenuhGambar(urlGambar) {
    const modal = document.getElementById('modal-fullscreen-img');
    const targetImg = document.getElementById('fullscreen-img-target');
    if (modal && targetImg) {
        targetImg.src = urlGambar;
        modal.classList.remove('hidden-state');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
    }
}

function tutupLayarPenuhGambar() {
    const modal = document.getElementById('modal-fullscreen-img');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => { modal.classList.add('hidden-state'); document.getElementById('fullscreen-img-target').src = ''; }, 300);
    }
}

function bukaBottomSheetForensik(b64Info, b64Log) {
    const sheetEl = document.getElementById('bottom-sheet-forensik');
    const contentEl = document.getElementById('bs-content');
    if (!sheetEl || !contentEl) return;

    const info = JSON.parse(decodeURIComponent(escape(atob(b64Info))));

    document.getElementById('fs-sumber').innerText = info.sumber || '-';
    document.getElementById('fs-ip').innerText = info.ip || '-';
    document.getElementById('fs-hardware').innerText = info.ram_cpu || '-';
    document.getElementById('fs-lokasi').href = info.lokasi;

    const exifContainer = document.getElementById('fs-exif-container');
    if (info.exif) {
        exifContainer.classList.remove('hidden-state');
        document.getElementById('fs-exif-kamera').innerText = info.exif.kamera;
        document.getElementById('fs-exif-waktu').innerText = info.exif.waktu_diambil;
        document.getElementById('fs-exif-gps').innerHTML = info.exif.lokasi_asli.startsWith('http') ? `<a href="${escapeHTML(info.exif.lokasi_asli)}" target="_blank" class="text-[#ceab6b] underline font-bold"><i class="fa-solid fa-map-pin"></i> Buka Peta Asli</a>` : `<b>${escapeHTML(info.exif.lokasi_asli)}</b>`;
    } else {
        exifContainer.classList.add('hidden-state');
    }

    document.getElementById('btn-bs-salin').setAttribute('data-log', b64Log);

    sheetEl.classList.remove('hidden-state');
    requestAnimationFrame(() => {
        sheetEl.classList.remove('opacity-0');
        contentEl.classList.remove('translate-y-full');
    });
}

function tutupBottomSheetForensik() {
    const sheetEl = document.getElementById('bottom-sheet-forensik');
    const contentEl = document.getElementById('bs-content');
    if (sheetEl && contentEl) {
        contentEl.classList.add('translate-y-full');
        sheetEl.classList.add('opacity-0');
        setTimeout(() => sheetEl.classList.add('hidden-state'), 300);
    }
}

// ==========================================================================
// 6. MANAJEMEN KONEKSI CERDAS (TETAP SIAGA DI BACKGROUND SAAT ADA SESI ORDER AKTIF!)
// ==========================================================================
document.addEventListener("visibilitychange", () => {
    const adaOrderAktif = Boolean(idRuangObrolanAktif || Object.values(sesiOrderDiterimaMap).some(v => v && v.accepted));
    if (document.visibilityState === 'hidden') {
        if (!adaOrderAktif) {
            goOffline(dbChat);
        }
    } else {
        if (idRuangObrolanAktif) {
            goOnline(dbChat);
        }
    }
});
