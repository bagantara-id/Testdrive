// ==========================================================================
// FILE: chat/radar-tiket.js
// FUNGSI: Mesin Radar Anti-Spam & Negosiasi Tiket Klien
// ==========================================================================

import { dbChat } from './config-chat.js';
import { ref, onChildAdded, onChildRemoved, remove, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

let antrianTiket = [];
let referensiRadar = null;
let uidDriverAktif = null;

// Engine Audio Sonar (Alarm Order)
function bunyikanSonarTiket() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.8, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.4);
    } catch (e) {}
}

export function hidupkanRadar(uid) {
    if (!uid) return;
    uidDriverAktif = uid;
    antrianTiket = [];
    
    referensiRadar = ref(dbChat, `radar_tiket/${uid}`);
    
    onChildAdded(referensiRadar, (snapshot) => {
        const tiket = snapshot.val();
        tiket.id = snapshot.key; 
        
        // Anti-Spam: Buang otomatis jika > 60 detik
        if (Date.now() - tiket.waktu_dibuat > 60000) {
            buangTiketDariDatabase(tiket.id);
            return;
        }

        antrianTiket.push(tiket);
        bunyikanSonarTiket();
        
        const indikatorKedip = document.getElementById('chat-notif-dot');
        if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');
    });

    onChildRemoved(referensiRadar, (snapshot) => {
        antrianTiket = antrianTiket.filter(t => t.id !== snapshot.key);
        if (antrianTiket.length === 0) {
            const indikatorKedip = document.getElementById('chat-notif-dot');
            if (indikatorKedip) indikatorKedip.classList.add('hidden-state');
            tutupKartuJabatTangan(); 
        }
    });
}

export function matikanRadar() {
    uidDriverAktif = null;
    antrianTiket = [];
}

export function periksaPintuMasuk() {
    if (antrianTiket.length === 0) {
        if (window.showToast) window.showToast("Belum ada tawaran masuk dari Klien.", "info");
        return false; 
    }
    tampilkanKartuJabatTangan(antrianTiket[0]);
    return true;
}

function tampilkanKartuJabatTangan(tiket) {
    const panel = document.getElementById('panel-handshake');
    if (!panel) return;

    // Pasok Data ke DOM
    const hargaFormat = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(tiket.harga_tawaran);
    document.getElementById('handshake-info').innerText = `Jarak: ${tiket.jarak_km} KM | Layanan: ${tiket.layanan}`;
    document.getElementById('handshake-price').innerText = hargaFormat;
    
    // Tampilkan Panel
    panel.classList.remove('hidden-state');

    const btnTolak = document.getElementById('btn-tolak-tiket');
    const btnTerima = document.getElementById('btn-terima-tiket');

    // Reset tombol (Mencegah event listener bertumpuk dari tiket sebelumnya)
    btnTerima.innerHTML = 'TERIMA';
    btnTerima.disabled = false;
    btnTolak.disabled = false;

    // Fungsi Handler (Ditugaskan via property onclick untuk pembersihan absolut)
    btnTolak.onclick = () => {
        buangTiketDariDatabase(tiket.id);
        tutupKartuJabatTangan();
    };

    btnTerima.onclick = async () => {
        btnTerima.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnTerima.disabled = true;
        btnTolak.disabled = true;
        
        try {
            await update(ref(dbChat, `radar_tiket/${uidDriverAktif}/${tiket.id}`), { status: 'ACCEPTED' });
            tutupKartuJabatTangan();
            
            const chatModule = await import('./app-chat.js');
            chatModule.bukaRuangKomunikasi(tiket.id);
        } catch (err) {
            console.error("Gagal inisialisasi chat:", err);
            if(window.showToast) window.showToast("Gagal menyambungkan Sesi Obrolan.", "error");
            btnTerima.innerHTML = 'TERIMA';
            btnTerima.disabled = false;
            btnTolak.disabled = false;
        }
    };
}

function tutupKartuJabatTangan() {
    const panel = document.getElementById('panel-handshake');
    if (panel) panel.classList.add('hidden-state');
}

function buangTiketDariDatabase(idTiket) {
    if (uidDriverAktif && idTiket) {
        remove(ref(dbChat, `radar_tiket/${uidDriverAktif}/${idTiket}`));
    }
}
