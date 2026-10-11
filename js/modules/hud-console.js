// ==========================================================================
// FILE: js/modules/hud-console.js
// FUNGSI: Dasbor Intelijen (Cyber-Avionik), Anti-Throttle Timer, & Anti-Tuyul
// ==========================================================================

import { hitungJarakHaversine } from '../utils/math-engine.js';

let telemetriStatus = {
    socketConnected: false, akurasiGps: 0, deltaHaversine: 0, 
    waktuTransmisiTerakhir: Date.now(), mode: 'offline', expiresAt: 0, targetLat: 0, targetLng: 0
};

let isHudTerbuka = false;
let mainLoopInterval = null;

function sinkronisasiMemoriTelemetri() {
    if (window.__BGT_TELEMETRY_CACHE) {
        telemetriStatus.socketConnected = window.__BGT_TELEMETRY_CACHE.connected || false;
        telemetriStatus.akurasiGps = window.__BGT_TELEMETRY_CACHE.accuracy ? window.__BGT_TELEMETRY_CACHE.accuracy.toFixed(1) : 0;
        telemetriStatus.deltaHaversine = window.__BGT_TELEMETRY_CACHE.jarak ? window.__BGT_TELEMETRY_CACHE.jarak.toFixed(2) : 0;
        telemetriStatus.waktuTransmisiTerakhir = window.__BGT_TELEMETRY_CACHE.txTime || Date.now();
        telemetriStatus.mode = window.__BGT_TELEMETRY_CACHE.mode || 'offline';
        telemetriStatus.expiresAt = window.__BGT_TELEMETRY_CACHE.expiresAt || 0;
        telemetriStatus.targetLat = window.__BGT_TELEMETRY_CACHE.targetLat || 0;
        telemetriStatus.targetLng = window.__BGT_TELEMETRY_CACHE.targetLng || 0;
    }
}

function renderUIState() {
    if (!isHudTerbuka) return;
    sinkronisasiMemoriTelemetri();

    const pnlAktif = document.getElementById('hud-panel-aktif');
    const pnlMangkal = document.getElementById('hud-panel-mangkal');

    if (telemetriStatus.mode === 'standby') {
        if(pnlAktif) pnlAktif.classList.add('hidden-state');
        if(pnlMangkal) pnlMangkal.classList.remove('hidden-state');
        const txtTarget = document.getElementById('teks-target-mangkal');
        if(txtTarget) txtTarget.innerText = `TAR: ${telemetriStatus.targetLat.toFixed(5)}, ${telemetriStatus.targetLng.toFixed(5)}`;
    } else if (telemetriStatus.mode === 'aktif') {
        if(pnlMangkal) pnlMangkal.classList.add('hidden-state');
        if(pnlAktif) pnlAktif.classList.remove('hidden-state');
        renderStatistikKinetikAktif(); // Render pemicu awal
    } else {
        if(pnlAktif) pnlAktif.classList.add('hidden-state');
        if(pnlMangkal) pnlMangkal.classList.add('hidden-state');
    }
}

// FUNGSI BARU: Render Visual Intelijen (GPS Profiling & Anti Fake GPS)
function renderStatistikKinetikAktif() {
    if (telemetriStatus.mode !== 'aktif') return;

    // 1. Status Soket & Waktu Lapor
    const teksKoneksi = document.getElementById('teks-koneksi');
    const ledKoneksi = document.getElementById('led-koneksi');
    if (teksKoneksi && ledKoneksi) {
        if (telemetriStatus.socketConnected) { teksKoneksi.innerText = 'TERHUBUNG'; teksKoneksi.style.color = '#10b981'; ledKoneksi.className = 'indicator-dot indicator-green'; } 
        else { teksKoneksi.innerText = 'TERPUTUS'; teksKoneksi.style.color = '#ef4444'; ledKoneksi.className = 'indicator-dot indicator-red'; }
    }

    const teksUpdate = document.getElementById('teks-update-terakhir');
    if (teksUpdate) {
        const date = new Date(telemetriStatus.waktuTransmisiTerakhir);
        teksUpdate.innerText = `Lapor: ${date.toLocaleTimeString('id-ID', { hour12: false })} WIB`;
    }

    // 2. Profiling Integritas GPS (Ganti dari Akurat/Lemah ke 3D-Fix/Loss)
    const teksAkurasi = document.getElementById('teks-akurasi');
    if (teksAkurasi) {
        const akurasiVal = parseFloat(telemetriStatus.akurasiGps);
        if (akurasiVal === 0) { 
            teksAkurasi.innerHTML = `<div class="indicator-dot indicator-gray"></div> [SYS] MENCARI SATELIT...`; teksAkurasi.style.color = '#9ca3af'; 
        } else if (akurasiVal <= 10) { 
            teksAkurasi.innerHTML = `<div class="indicator-dot indicator-green"></div> [LOCK] 3D-Fix <span style="color:#d1d5db; font-size:0.55rem; margin-left:4px;">(±${akurasiVal}m)</span>`; teksAkurasi.style.color = '#10b981'; 
        } else if (akurasiVal <= 25) { 
            teksAkurasi.innerHTML = `<div class="indicator-dot indicator-amber"></div> [WARN] 2D-Fix <span style="color:#d1d5db; font-size:0.55rem; margin-left:4px;">(±${akurasiVal}m)</span>`; teksAkurasi.style.color = '#f59e0b'; 
        } else { 
            teksAkurasi.innerHTML = `<div class="indicator-dot indicator-red"></div> [LOSS] Sinyal Terhalang <span style="color:#d1d5db; font-size:0.55rem; margin-left:4px;">(±${akurasiVal}m)</span>`; teksAkurasi.style.color = '#ef4444'; 
        }
    }

    // 3. Sensor Pergerakan Kinetik Anti-Fake GPS
    const teksPergerakan = document.getElementById('teks-pergerakan');
    if (teksPergerakan) {
        const jarakFisik = parseFloat(telemetriStatus.deltaHaversine);
        if (jarakFisik === 0) {
            teksPergerakan.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> MENUNGGU KUNCIAN`;
            teksPergerakan.style.color = '#9ca3af';
        } else if (jarakFisik < 2.5) { // Toleransi 2.5m untuk mencegah lompatan kecil satelit (noise) dianggap bergerak
            teksPergerakan.innerHTML = `<i class="fa-solid fa-grip-lines mr-1"></i> KENDARAAN STASIONER (DIAM)`;
            teksPergerakan.style.color = '#38bdf8'; // Biru Cyan kalem
        } else {
            teksPergerakan.innerHTML = `<i class="fa-solid fa-angles-right text-theme-gold mr-1"></i> KINETIK AKTIF: <span style="color:#fff;">+${jarakFisik} Meter</span>`;
            teksPergerakan.style.color = '#d97706'; // Emas
        }
    }
}

// FUNGSI BARU: Mesin Waktu Mutlak (Tahan Terhadap Throttle Latar Belakang Browser)
function eksekusiMesinLokalEdge() {
    if (mainLoopInterval) { clearInterval(mainLoopInterval); mainLoopInterval = null; }
    
    mainLoopInterval = setInterval(() => {
        if (!isHudTerbuka) return;

        const waktuSekarangFaktual = typeof window.getTrueTime === 'function' ? window.getTrueTime() : Date.now();

        if (telemetriStatus.mode === 'standby') {
            const sisaMs = telemetriStatus.expiresAt - waktuSekarangFaktual;
            
            const elCountdown = document.getElementById('countdown-mangkal');
            if (sisaMs <= 0) {
                if(elCountdown) elCountdown.innerText = "00:00:00";
                if (typeof window.matikanSinkronisasi === 'function') window.matikanSinkronisasi("Waktu mangkal habis.");
            } else {
                const h = Math.floor(sisaMs / 3600000).toString().padStart(2, '0');
                const m = Math.floor((sisaMs % 3600000) / 60000).toString().padStart(2, '0');
                const s = Math.floor((sisaMs % 60000) / 1000).toString().padStart(2, '0');
                if(elCountdown) elCountdown.innerText = `${h}:${m}:${s}`;
            }

            const locStr = localStorage.getItem('bgt_last_coord');
            if (locStr) {
                const loc = JSON.parse(locStr);
                const deviasiMet = hitungJarakHaversine(loc.lat, loc.lng, telemetriStatus.targetLat, telemetriStatus.targetLng);
                const deviasiKm = (deviasiMet / 1000).toFixed(2);
                
                const elDeviasi = document.getElementById('teks-deviasi');
                if (elDeviasi) {
                    elDeviasi.innerText = `${deviasiKm} KM / 7.00 KM`;
                    if (deviasiMet > 7000) { 
                        elDeviasi.style.color = '#ef4444'; 
                        if (typeof window.matikanSinkronisasi === 'function') window.matikanSinkronisasi("PELANGGARAN: Fisik menjauh > 7 KM."); 
                    } 
                    else if (deviasiMet > 5000) elDeviasi.style.color = '#f59e0b';
                    else elDeviasi.style.color = '#10b981'; 
                }
            }
        } 
        
        else if (telemetriStatus.mode === 'aktif') {
            // Kalkulasi detik berlalu yang FAKTUAL, bukan mengandalkan tik interval
            const detikBerlalu = Math.floor((waktuSekarangFaktual - telemetriStatus.waktuTransmisiTerakhir) / 1000);
            
            const txMetronome = document.getElementById('tx-metronome');
            if (txMetronome) {
                if (detikBerlalu < 2) {
                    // Berkedip hijau sesaat setelah pengiriman data
                    txMetronome.innerHTML = `<span style="color: #10b981; text-shadow: 0 0 10px rgba(16,185,129,0.8);">[ SYNC: OK ]</span>`;
                } else if (detikBerlalu < 120) {
                    // Stopwatch detik normal (biru)
                    const s = detikBerlalu < 10 ? `0${detikBerlalu}` : detikBerlalu;
                    txMetronome.innerHTML = `[ TX: <span style="color: #38bdf8; text-shadow: 0 0 8px rgba(56,189,248,0.6);">${s}s AGO</span> ]`;
                } else {
                    // Indikator Mode Hemat Daya jika melebihi batas diam 2 menit
                    txMetronome.innerHTML = `[ TX: <span style="color: #f59e0b; text-shadow: 0 0 8px rgba(245,158,11,0.6);">IDLE SLEEP</span> ]`;
                }
            }
        }
    }, 1000);
}

window.addEventListener('hud-mode-update', renderUIState);
window.addEventListener('hud-telemetry-socket', (e) => { 
    telemetriStatus.socketConnected = e.detail.connected; 
    if (telemetriStatus.mode === 'aktif') renderStatistikKinetikAktif(); 
});
window.addEventListener('hud-telemetry-gps', (e) => { 
    telemetriStatus.akurasiGps = e.detail.accuracy.toFixed(1); 
    if (telemetriStatus.mode === 'aktif') renderStatistikKinetikAktif(); 
});
window.addEventListener('hud-telemetry-haversine', (e) => { 
    telemetriStatus.deltaHaversine = e.detail.jarak.toFixed(2); 
    if (telemetriStatus.mode === 'aktif') renderStatistikKinetikAktif(); 
});
window.addEventListener('hud-telemetry-tx', () => { 
    telemetriStatus.waktuTransmisiTerakhir = Date.now(); 
    if (telemetriStatus.mode === 'aktif') renderStatistikKinetikAktif(); 
});

function toggleHudConsole() {
    sinkronisasiMemoriTelemetri(); 
    const container = document.getElementById('telemetry-panel-container');
    if(!container) return;
    
    if (!isHudTerbuka) {
        isHudTerbuka = true; container.classList.add('telemetry-active');
        renderUIState(); eksekusiMesinLokalEdge();
    } else {
        isHudTerbuka = false; container.classList.remove('telemetry-active');
        if (mainLoopInterval) { clearInterval(mainLoopInterval); mainLoopInterval = null; }
    }
}
window.toggleHudConsole = toggleHudConsole;

document.addEventListener('click', (e) => {
    // Tombol tutup (close) kini menangkap class minimalis yang baru dibuat
    if (e.target.closest('#btn-telemetry-hud') || e.target.closest('.telemetry-btn-close-minimal')) {
        window.toggleHudConsole();
    }
});