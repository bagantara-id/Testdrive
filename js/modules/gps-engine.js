// ==========================================================================
// FILE: js/modules/gps-engine.js
// FUNGSI: Mesin Peta Murni, Geofencing Taktis, & Delegasi Event Modular
// ==========================================================================

import { auth } from '../core/firebase-config.js';
import { hitungJarakHaversine, encodeGeohash, getTrueTime } from '../utils/math-engine.js';

window.__BGT_TELEMETRY_CACHE = window.__BGT_TELEMETRY_CACHE || { connected: false, accuracy: 0, jarak: 0, txTime: Date.now() };

const btnPower = document.getElementById('btn-power');
const btnRecenter = document.getElementById('btn-recenter');
const statusText = document.getElementById('status-text');
const statusBadge = document.getElementById('status-badge');

let mapSystem = null;
let driverMarker = null;
let standbyRadiusLayer = null; 
let physicalGpsMarker = null;  
let gpsWatchId = null;
let syncInterval = null;
let standbyTimeout = null;
let lastCoord = null;
let currentMode = 'aktif'; 
let isSystemOnline = false;
let isSocketConnected = false; 
let isPendingPower = false; 

let durasiMangkalMemori = 1;
let currentRadiusKm = 7.0; // Radius default Taktis
let isLightModeGlobal = false;
let koordinatLokal = null; 
let isGeofenceValid = true; // State pengaman agar Toast tidak spam

// ==========================================================================
// 1. SARAF NAVIGASI DOM & KAPSUL MIKRO
// ==========================================================================
function inisialisasiEventDOM() {
    const btnCancelTarget = document.getElementById('btn-cancel-target');
    if (btnCancelTarget) {
        btnCancelTarget.addEventListener('click', () => {
            document.getElementById('bgt-targeting-ui').classList.add('hidden-state');
            const bottomNav = document.querySelector('.pb-safe');
            if (bottomNav) bottomNav.style.transform = 'translateY(0)';
            
            // KINETIK AUTO-HIDE: Munculkan kembali tombol Power & Recenter
            if (btnPower) btnPower.classList.remove('btn-auto-hide');
            if (btnRecenter) btnRecenter.classList.remove('btn-auto-hide');
            
            if (mapSystem) mapSystem.off('move', updateRadiusKeCenter);
            if (standbyRadiusLayer && mapSystem) { mapSystem.removeLayer(standbyRadiusLayer); standbyRadiusLayer = null; }
            if (driverMarker) driverMarker.setOpacity(1);
            matikanSinkronisasi("Operasi mangkal dibatalkan. Sistem kembali Offline.");
        });
    }

    const btnLockTarget = document.getElementById('btn-lock-target');
    if (btnLockTarget) {
        btnLockTarget.addEventListener('click', () => {
            // Cegah bypass jika di-hack via console
            if (!isGeofenceValid) return window.showToast("Pelanggaran Jarak! Kunci dibatalkan.", "error");
            
            document.getElementById('bgt-targeting-ui').classList.add('hidden-state');
            kunciLokasiStandby(durasiMangkalMemori);
        });
    }

    // TACTICAL SLIDER: Logika Real-Time Zero-Latency
    const sliderRadius = document.getElementById('slider-radius');
    const sliderVal = document.getElementById('slider-radius-val');
    if (sliderRadius && sliderVal) {
        sliderRadius.addEventListener('input', (e) => {
            currentRadiusKm = parseFloat(e.target.value);
            sliderVal.innerText = currentRadiusKm.toFixed(1) + ' KM';
            if (standbyRadiusLayer) {
                standbyRadiusLayer.setRadius(currentRadiusKm * 1000);
            }
        });
    }

    const capAktif = document.getElementById('btn-cap-aktif');
    const capMangkal = document.getElementById('btn-cap-mangkal');
    const capClose = document.getElementById('btn-cap-close');
    const capDurations = document.getElementById('cap-durations');
    const durBtns = document.querySelectorAll('.cap-dur-btn');
    const microCapsule = document.getElementById('bgt-micro-capsule');

    const defaultAktifClass = "btn-cap-mode bg-[#10b981] hover:bg-[#059669] text-white border border-emerald-400/50 rounded-full px-6 py-3 text-[0.7rem] font-bold uppercase tracking-widest transition-all flex items-center gap-2 shrink-0 cursor-pointer shadow-[0_4px_15px_rgba(16,185,129,0.4)]";
    const pasifAktifClass = "btn-cap-mode bg-[#0f172a] text-gray-500 border border-white/10 rounded-full px-6 py-3 text-[0.7rem] font-bold uppercase tracking-widest transition-all flex items-center gap-2 shrink-0 cursor-pointer";
    const defaultMangkalClass = "btn-cap-mode bg-[#0f172a] hover:bg-[#1e40af] text-blue-300 border border-blue-500/50 rounded-full px-6 py-3 text-[0.7rem] font-bold uppercase tracking-widest transition-all flex items-center gap-2 shrink-0 cursor-pointer";
    const aktifMangkalClass = "btn-cap-mode bg-[#3b82f6] text-white border border-blue-400/50 rounded-full px-6 py-3 text-[0.7rem] font-bold uppercase tracking-widest transition-all flex items-center gap-2 shrink-0 cursor-pointer shadow-[0_4px_15px_rgba(59,130,246,0.4)]";

    if (capAktif) {
        capAktif.addEventListener('click', () => {
            if(microCapsule) microCapsule.classList.add('hidden-state');
            if(capDurations) capDurations.classList.replace('flex', 'hidden');
            isPendingPower = false;
            mulaiModeAktif();
        });
    }

    if (capMangkal) {
        capMangkal.addEventListener('click', () => {
            if(capDurations) capDurations.classList.replace('hidden', 'flex');
            capMangkal.className = aktifMangkalClass;
            if(capAktif) capAktif.className = pasifAktifClass;
        });
    }

    if (durBtns) {
        durBtns.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                durasiMangkalMemori = parseInt(ev.target.getAttribute('data-val'));
                if(microCapsule) microCapsule.classList.add('hidden-state');
                setTimeout(() => {
                    if(capDurations) capDurations.classList.replace('flex', 'hidden');
                    if(capAktif) capAktif.className = defaultAktifClass;
                    if(capMangkal) capMangkal.className = defaultMangkalClass;
                }, 300);
                isPendingPower = false;
                mulaiFasePersiapan(); // Inisiasi Geofencing
            });
        });
    }

    if (capClose) {
        capClose.addEventListener('click', () => {
            if(microCapsule) microCapsule.classList.add('hidden-state');
            if(capDurations) capDurations.classList.replace('flex', 'hidden');
            setTimeout(() => { 
                if(capAktif) capAktif.className = defaultAktifClass; 
                if(capMangkal) capMangkal.className = defaultMangkalClass; 
            }, 300);
            isPendingPower = false;
            updateUIState(); 
        });
    }

    const btnFisik = document.getElementById('btn-recenter-fisik');
    if(btnFisik) {
        btnFisik.addEventListener('click', () => {
            if (koordinatLokal && mapSystem) {
                mapSystem.flyTo([koordinatLokal.coords.latitude, koordinatLokal.coords.longitude], 17, { animate: true, duration: 1.5 });
                if(window.showToast) window.showToast("Menyorot GPS Fisik Anda", "success");
            } else {
                if(window.showToast) window.showToast("Sinyal GPS Fisik belum terkunci", "error");
            }
        });
    }
}
document.addEventListener('DOMContentLoaded', inisialisasiEventDOM);

window.addEventListener('theme-toggled', (e) => {
    isLightModeGlobal = e.detail.isLight;
    if (standbyRadiusLayer && driverMarker) validasiGeofencingSetup(); // Rekalkulasi warna tema
});

function dapatkanIkonMarker(mode) {
    if (mode === 'standby') {
        return L.divIcon({
            className: 'custom-nav-marker-standby',
            html: `<div style="position: relative; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; width: 60px; height: 60px;">
                     <img src="./assets/pin_standby.png" style="width: 50px; height: 50px; object-fit: contain; z-index: 10; filter: drop-shadow(0 8px 6px rgba(0,0,0,0.6));" alt="Standby">
                     <div style="width: 18px; height: 5px; background: rgba(217,119,6,0.8); border-radius: 50%; box-shadow: 0 0 20px rgba(217,119,6,1); z-index: 1; filter: blur(2px); margin-top: -4px;"></div>
                   </div>`,
            iconSize: [60, 60], iconAnchor: [30, 60]
        });
    } else {
        return L.divIcon({
            className: 'custom-nav-marker-aktif',
            html: `<div id="nav-arrow" style="transform: rotate(0deg); transition: transform 0.4s ease-out; position: relative; display: flex; justify-content: center; align-items: center; width: 42px; height: 42px;">
                     <div style="position: absolute; inset: 2px; border-radius: 50%; box-shadow: 0 0 20px rgba(59, 130, 246, 0.5);"></div>
                     <svg viewBox="0 0 24 24" width="38" height="38" style="position: absolute; z-index: 10; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));">
                       <path d="M12 2L3 21l9-3 9 3z" fill="#3b82f6" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
                     </svg>
                   </div>`,
            iconSize: [42, 42], iconAnchor: [21, 21]
        });
    }
}

// ==========================================================================
// 2. ENGINE UTAMA PETA & RADAR SILUMAN
// ==========================================================================
async function periksaResureksiStatus() {
    if (!auth.currentUser) return false;
    try {
        const token = await auth.currentUser.getIdToken();
        const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;
        const res = await fetch(dbUrl);
        const data = await res.json();
        
        if (data) {
            const now = getTrueTime();
            if (data.mode === 'standby' && data.expiresAt && data.expiresAt > now) {
                isSystemOnline = true; currentMode = 'standby';
                const sisaWaktuMs = data.expiresAt - now;
                
                // Menarik memori radius dari server
                if (data.radius) currentRadiusKm = data.radius;

                tetapkanPosisiPeta(data.lat, data.lng, false);
                if(mapSystem) mapSystem.off('move', updateRadiusKeCenter);
                
                if (driverMarker) {
                    driverMarker.dragging.disable();
                    driverMarker.setIcon(dapatkanIkonMarker('standby'));
                    driverMarker.setOpacity(1);
                }
                updateUIState();
                
                standbyTimeout = setTimeout(() => matikanSinkronisasi("Durasi mangkal habis. Sistem otomatis dimatikan."), sisaWaktuMs);
                window.__BGT_TELEMETRY_CACHE.mode = 'standby'; window.__BGT_TELEMETRY_CACHE.expiresAt = data.expiresAt;
                window.__BGT_TELEMETRY_CACHE.targetLat = data.lat; window.__BGT_TELEMETRY_CACHE.targetLng = data.lng;
                window.dispatchEvent(new CustomEvent('hud-mode-update'));
                return true;
            } else if (data.isOnline && data.mode === 'standby' && data.expiresAt && data.expiresAt <= now) {
                matikanSinkronisasi("Sesi mangkal Anda telah kedaluwarsa saat aplikasi ditutup."); return false;
            } else if (data.isOnline && data.mode === 'aktif') {
                return 'lanjut_aktif'; 
            }
        }
    } catch (e) {} return false;
}

export async function inisialisasiPeta() {
    if (mapSystem) { mapSystem.invalidateSize(); return; }
    mapSystem = L.map('map', { zoomControl: false, attributionControl: false }).setView([-6.200000, 106.816666], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapSystem);
    isLightModeGlobal = document.body.classList.contains('theme-light');

    const statusResureksi = await periksaResureksiStatus();

    if (statusResureksi === true) {
        nyalakanRadarGeofencingSiluman();
    } else {
        const initialLocWatch = navigator.geolocation.watchPosition(
            (pos) => {
                const lat = pos.coords.latitude, lng = pos.coords.longitude;
                localStorage.setItem('bgt_last_coord', JSON.stringify({lat, lng}));
                tetapkanPosisiPeta(lat, lng, true);
                if (statusResureksi === 'lanjut_aktif') mulaiModeAktif();
                navigator.geolocation.clearWatch(initialLocWatch);
                nyalakanRadarGeofencingSiluman(); 
            },
            () => matikanSinkronisasi("Akses lokasi ditolak atau gagal."),
            { enableHighAccuracy: true, maximumAge: 0 }
        );
    }
}

function nyalakanRadarGeofencingSiluman() {
    if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
    
    gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => { 
            koordinatLokal = pos; 
            const lat = pos.coords.latitude, lng = pos.coords.longitude, heading = pos.coords.heading || 0, akurasi = pos.coords.accuracy || 0;
            localStorage.setItem('bgt_last_coord', JSON.stringify({lat, lng}));
            if (currentMode !== 'aktif') lastCoord = { lat, lng };
            
            window.__BGT_TELEMETRY_CACHE.accuracy = akurasi;
            window.dispatchEvent(new CustomEvent('hud-telemetry-gps', { detail: { accuracy: akurasi } }));

            // AUTO-KILL SWITCH (ATURAN 2): Background Monitoring Absolut
            if (currentMode === 'standby' && window.__BGT_TELEMETRY_CACHE.targetLat) {
                const jarakFisik = hitungJarakHaversine(window.__BGT_TELEMETRY_CACHE.targetLat, window.__BGT_TELEMETRY_CACHE.targetLng, lat, lng);
                if (jarakFisik > 7000) { 
                    matikanSinkronisasi("PELANGGARAN LOKASI: Anda meninggalkan Area Mangkal lebih dari 7 KM. Sistem diputus!"); 
                    return; 
                }
            }

            if (currentMode === 'aktif' && driverMarker) {
                driverMarker.setLatLng([lat, lng]);
                const arrowElement = document.getElementById('nav-arrow');
                if(arrowElement && heading !== null && !isNaN(heading)) arrowElement.style.transform = `rotate(${heading}deg)`;
            }
            
            if (currentMode === 'standby' || currentMode === 'persiapan') {
                if (!physicalGpsMarker) {
                    physicalGpsMarker = L.marker([lat, lng], {
                        icon: L.divIcon({ className: 'bgt-physical-pin', html: `<img src="./assets/pin-gps.png" style="width:36px; height:36px; object-fit:contain; filter:drop-shadow(0 4px 6px rgba(0,0,0,0.6));" onerror="this.src='./assets/pin_standby.png'">`, iconSize: [36, 36], iconAnchor: [18, 18] }), interactive: false, zIndexOffset: 999 
                    }).addTo(mapSystem);
                } else { physicalGpsMarker.setLatLng([lat, lng]); }
                
                // Memicu validasi Geofence seketika jika satelit update saat mode persiapan
                if (currentMode === 'persiapan') validasiGeofencingSetup();
            } else {
                if (physicalGpsMarker && mapSystem) { mapSystem.removeLayer(physicalGpsMarker); physicalGpsMarker = null; }
            }
        },
        (err) => { if (isSystemOnline && err.code === 1) matikanSinkronisasi("Izin akses GPS dicabut paksa."); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 } 
    );
}

function tetapkanPosisiPeta(lat, lng, animate = false) {
    if (animate) mapSystem.flyTo([lat, lng], 17, { animate: true, duration: 1.5 });
    else mapSystem.setView([lat, lng], 17);

    if (!driverMarker) driverMarker = L.marker([lat, lng], { icon: dapatkanIkonMarker(currentMode), draggable: false }).addTo(mapSystem);
    else driverMarker.setLatLng([lat, lng]);
    perbaruiRadiusStandby(lat, lng);
}

// ==========================================================================
// 3. KONTROL RADIUS & EDGE AI VALIDATION (ZERO LATENCY)
// ==========================================================================
function perbaruiRadiusStandby(lat, lng) {
    if (!mapSystem) return;
    if (currentMode === 'standby' || currentMode === 'persiapan') {
        if (!mapSystem.getPane('bgRadiusPane')) { mapSystem.createPane('bgRadiusPane'); mapSystem.getPane('bgRadiusPane').style.zIndex = 250; mapSystem.getPane('bgRadiusPane').style.pointerEvents = 'none'; }
        
        const radiusFaktual = currentRadiusKm * 1000;

        if (!standbyRadiusLayer) {
            standbyRadiusLayer = L.circle([lat, lng], { radius: radiusFaktual, weight: 1.5, interactive: false, pane: 'bgRadiusPane' }).addTo(mapSystem);
        } else {
            standbyRadiusLayer.setLatLng([lat, lng]); 
            standbyRadiusLayer.setRadius(radiusFaktual);
        }
        validasiGeofencingSetup(); // Terapkan styling Safe/Danger
    } else {
        if (standbyRadiusLayer) { mapSystem.removeLayer(standbyRadiusLayer); standbyRadiusLayer = null; }
    }
}

// ATURAN 1: Validasi Jarak 7KM saat Persiapan (Setup)
function validasiGeofencingSetup() {
    if (!mapSystem || !standbyRadiusLayer || currentMode !== 'persiapan') return;
    
    let isValid = true;
    if (koordinatLokal) {
        const center = mapSystem.getCenter();
        const jarak = hitungJarakHaversine(koordinatLokal.coords.latitude, koordinatLokal.coords.longitude, center.lat, center.lng);
        // Validasi Ekstrem: Pusat target tidak boleh > 7KM dari GPS Fisik
        if (jarak > 7000) isValid = false;
    } else {
        isValid = false; // GPS belum terkunci
    }

    const btnLock = document.getElementById('btn-lock-target');
    
    // Injeksi Kelas Dinamis Safe/Danger
    const radColor = isLightModeGlobal ? (isValid ? '#b48545' : '#dc2626') : (isValid ? '#38bdf8' : '#ef4444');
    const radFill = isLightModeGlobal ? (isValid ? '#fef3c7' : '#450a0a') : (isValid ? '#e0f2fe' : '#450a0a');
    const radFillOp = isLightModeGlobal ? (isValid ? 0.4 : 0.6) : (isValid ? 0.15 : 0.5);
    const radClass = isLightModeGlobal
        ? (isValid ? 'standby-glass-radius-day-safe' : 'standby-glass-radius-day-danger')
        : (isValid ? 'standby-glass-radius-night-safe' : 'standby-glass-radius-night-danger');

    standbyRadiusLayer.setStyle({ color: radColor, fillColor: radFill, fillOpacity: radFillOp, className: radClass });

    if (btnLock) {
        if (isValid) {
            btnLock.classList.remove('opacity-50', 'cursor-not-allowed', 'grayscale');
        } else {
            btnLock.classList.add('opacity-50', 'cursor-not-allowed', 'grayscale');
        }
    }

    // Anti-Spam Toast: Hanya panggil Toast jika terjadi transisi status dari Valid -> Invalid
    if (isValid !== isGeofenceValid) {
        isGeofenceValid = isValid;
        if (!isValid && koordinatLokal) {
             if(window.showToast) window.showToast("Batas 7 KM Terlampaui! Kunci Mangkal diblokir.", "error");
        }
    }
}

function updateRadiusKeCenter() {
    if (currentMode === 'persiapan' && standbyRadiusLayer && mapSystem) {
        standbyRadiusLayer.setLatLng(mapSystem.getCenter());
        validasiGeofencingSetup(); // Rekalkulasi 60fps saat peta digeser
    }
}

// ==========================================================================
// 4. PENANGANAN KONEKSI & TOMBOL UTAMA
// ==========================================================================
function sinkronisasiKoneksiNative() {
    isSocketConnected = navigator.onLine; updateUIState();
    window.__BGT_TELEMETRY_CACHE.connected = isSocketConnected;
    window.dispatchEvent(new CustomEvent('hud-telemetry-socket', { detail: { connected: isSocketConnected } }));
}
window.addEventListener('online', sinkronisasiKoneksiNative);
window.addEventListener('offline', sinkronisasiKoneksiNative);
sinkronisasiKoneksiNative();

if (btnRecenter) {
    btnRecenter.addEventListener('click', () => {
        if (currentMode === 'standby' || currentMode === 'persiapan') {
            if (driverMarker && mapSystem) { mapSystem.flyTo(driverMarker.getLatLng(), 17, { animate: true, duration: 1.5 }); if(window.showToast) window.showToast("Kamera dikembalikan ke Titik Mangkal.", "success"); }
            return; 
        }
        
        const iconRecenter = document.getElementById('icon-recenter');
        if (iconRecenter) {
            iconRecenter.className = 'fa-solid fa-circle-notch fa-spin text-lg pointer-events-none drop-shadow-md text-yellow-400';
            
            navigator.geolocation.getCurrentPosition(
                pos => { 
                    tetapkanPosisiPeta(pos.coords.latitude, pos.coords.longitude, true); 
                    iconRecenter.className = 'fa-solid fa-location-crosshairs text-lg pointer-events-none drop-shadow-md text-green-400';
                    setTimeout(() => { iconRecenter.className = 'fa-solid fa-location-crosshairs text-lg pointer-events-none drop-shadow-md text-white'; }, 2000);
                }, 
                err => {
                    iconRecenter.className = 'fa-solid fa-location-crosshairs text-lg pointer-events-none drop-shadow-md text-red-500';
                    if (driverMarker && mapSystem) mapSystem.flyTo(driverMarker.getLatLng(), 17, { animate: true, duration: 1 });
                    else if(window.showToast) window.showToast("Sinyal satelit gagal ditangkap.", "error");
                    setTimeout(() => { iconRecenter.className = 'fa-solid fa-location-crosshairs text-lg pointer-events-none drop-shadow-md text-white'; }, 2000);
                }, 
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        }
    });
}

if (btnPower) {
    btnPower.addEventListener('click', async () => {
        if (!auth.currentUser) return window.alert("Otorisasi gagal.", "warning");
        
        if (isSystemOnline) {
            await matikanSinkronisasi("Sistem dialihkan ke mode Luring (Offline).");
            const microCapsule = document.getElementById('bgt-micro-capsule');
            if(microCapsule) microCapsule.classList.add('hidden-state');
            isPendingPower = false;
        } else {
            isPendingPower = !isPendingPower;
            const microCapsule = document.getElementById('bgt-micro-capsule');
            const capDurations = document.getElementById('cap-durations');
            if (isPendingPower) {
                if(microCapsule) microCapsule.classList.remove('hidden-state');
            } else { 
                if(microCapsule) microCapsule.classList.add('hidden-state'); 
                if(capDurations) capDurations.classList.replace('flex', 'hidden'); 
            }
            updateUIState(); 
        }
    });
}

// ==========================================================================
// 5. MESIN STATE MODE (AKTIF / PERSIAPAN / MANGKAL)
// ==========================================================================
function mulaiModeAktif() {
    isSystemOnline = true; isPendingPower = false; matikanProsesLatar(); currentMode = 'aktif';
    
    window.__BGT_TELEMETRY_CACHE.mode = 'aktif'; window.dispatchEvent(new CustomEvent('hud-mode-update'));
    updateUIState();         
    
    if(mapSystem) mapSystem.off('move', updateRadiusKeCenter);
    const uiTarget = document.getElementById('bgt-targeting-ui');
    if(uiTarget) uiTarget.classList.add('hidden-state');
    
    if (driverMarker) {
        driverMarker.setOpacity(1); driverMarker.setIcon(dapatkanIkonMarker(currentMode));
        perbaruiRadiusStandby(driverMarker.getLatLng().lat, driverMarker.getLatLng().lng);
    }
    
    if (physicalGpsMarker && mapSystem) { mapSystem.removeLayer(physicalGpsMarker); physicalGpsMarker = null; }
    
    lastCoord = null; nyalakanRadarGeofencingSiluman();
    syncInterval = setInterval(async () => {
        if (!koordinatLokal || !isSocketConnected) return;
        const currentLat = koordinatLokal.coords.latitude, currentLng = koordinatLokal.coords.longitude;
        let pergeseranJarak = 0;

        if (lastCoord) {
            pergeseranJarak = hitungJarakHaversine(lastCoord.lat, lastCoord.lng, currentLat, currentLng);
            window.__BGT_TELEMETRY_CACHE.jarak = pergeseranJarak;
            window.dispatchEvent(new CustomEvent('hud-telemetry-haversine', { detail: { jarak: pergeseranJarak } }));
            if (pergeseranJarak < 10) return; 
        }

        kirimPayloadRTDB(currentLat, currentLng, 'aktif', null);
        lastCoord = { lat: currentLat, lng: currentLng };
        
        window.__BGT_TELEMETRY_CACHE.txTime = Date.now();
        window.dispatchEvent(new CustomEvent('hud-telemetry-tx'));
    }, 10000); 
}

function mulaiFasePersiapan() {
    isSystemOnline = false; isPendingPower = true;
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
    if (standbyTimeout) { clearTimeout(standbyTimeout); standbyTimeout = null; }
    
    currentMode = 'persiapan'; updateUIState();
    if (!gpsWatchId) nyalakanRadarGeofencingSiluman();
    
    const bottomNav = document.querySelector('.pb-safe');
    if (bottomNav) { bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)'; bottomNav.style.transform = 'translateY(150%)'; }
    
    // KINETIK AUTO-HIDE: Sembunyikan tombol saat targeting
    if (btnPower) btnPower.classList.add('btn-auto-hide');
    if (btnRecenter) btnRecenter.classList.add('btn-auto-hide');

    if (driverMarker) driverMarker.setOpacity(0);
    const uiTarget = document.getElementById('bgt-targeting-ui');
    if(uiTarget) uiTarget.classList.remove('hidden-state');
    
    if(mapSystem) {
        const center = mapSystem.getCenter();
        perbaruiRadiusStandby(center.lat, center.lng);
        mapSystem.on('move', updateRadiusKeCenter);
    }
}

function kunciLokasiStandby(durasiJam) {
    if (!mapSystem) return;
    const center = mapSystem.getCenter();
    
    // PENGAMAN SILUMAN EKSTREM: Validasi Final sebelum Kunci Database
    if (koordinatLokal) {
        const fisikLat = koordinatLokal.coords.latitude, fisikLng = koordinatLokal.coords.longitude;
        const jarakTarget = hitungJarakHaversine(fisikLat, fisikLng, center.lat, center.lng);
        if (jarakTarget > 7000) {
            if(window.showToast) window.showToast(`Gagal! Titik ini ${Math.round(jarakTarget/1000)} KM dari Anda (Max 7 KM).`, "error");
            document.getElementById('btn-cancel-target').click(); 
            return;
        }
    } else {
        if(window.showToast) window.showToast("Sinyal fisik sedang dikalibrasi. Tunggu 3 detik lalu coba lagi.", "error"); return;
    }

    mapSystem.off('move', updateRadiusKeCenter); currentMode = 'standby';
    if(window.showToast) window.showToast("Target Terkunci. Memulai Mangkal...", "success");
    
    const bottomNav = document.querySelector('.pb-safe');
    if (bottomNav) bottomNav.style.transform = 'translateY(0)';
    
    // KINETIK AUTO-HIDE: Munculkan kembali tombol Power & Recenter
    if (btnPower) btnPower.classList.remove('btn-auto-hide');
    if (btnRecenter) btnRecenter.classList.remove('btn-auto-hide');
    
    if (driverMarker) { driverMarker.setLatLng(center); driverMarker.setIcon(dapatkanIkonMarker(currentMode)); driverMarker.setOpacity(1); }
    perbaruiRadiusStandby(center.lat, center.lng);
    
    const expiresAt = getTrueTime() + (durasiJam * 60 * 60 * 1000); 

    kirimPayloadRTDB(center.lat, center.lng, 'standby', expiresAt).then(sukses => {
        if(sukses) {
            isSystemOnline = true; isPendingPower = false; updateUIState();
            if(driverMarker) driverMarker.dragging.disable();
            standbyTimeout = setTimeout(() => matikanSinkronisasi("Durasi operasi mangkal usai."), durasiJam * 60 * 60 * 1000);
            window.__BGT_TELEMETRY_CACHE.mode = 'standby'; window.__BGT_TELEMETRY_CACHE.expiresAt = expiresAt;
            window.__BGT_TELEMETRY_CACHE.targetLat = center.lat; window.__BGT_TELEMETRY_CACHE.targetLng = center.lng;
            window.dispatchEvent(new CustomEvent('hud-mode-update'));
        } else matikanSinkronisasi("Gagal mengunci lokasi. Periksa koneksi.");
    });
}

async function kirimPayloadRTDB(lat, lng, mode, expiresAt) {
    if (!auth.currentUser) return false;
    try {
        const bgtGeohash = encodeGeohash(lat, lng, 6); 
        const token = await auth.currentUser.getIdToken();
        const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;
        await fetch(dbUrl, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            // MENGIRIM PAYLOAD RADIUS DINAMIS KE KLIEN
            body: JSON.stringify({ isOnline: true, mode: mode, lat: lat, lng: lng, geohash: bgtGeohash, radius: currentRadiusKm, timestamp: getTrueTime(), expiresAt: expiresAt })
        });
        return true;
    } catch (error) { return false; }
}

function matikanProsesLatar() {
    if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
    if (standbyTimeout) { clearTimeout(standbyTimeout); standbyTimeout = null; }
}

export async function matikanSinkronisasi(pesan = "") {
    if (btnPower) { btnPower.classList.add('pointer-events-none'); btnPower.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xl"></i>'; }
    if (statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span> <span class="text-yellow-400 font-bold tracking-widest">MEMUTUS KONEKSI...</span>';

    if (auth.currentUser) {
        try {
            const token = await auth.currentUser.getIdToken();
            const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;
            await fetch(dbUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOnline: false, mode: 'offline', expiresAt: 0 }) });
        } catch (err) {}
    }

    if (pesan && window.showToast) window.showToast(pesan, "error"); 
    
    isSystemOnline = false; window.__BGT_TELEMETRY_CACHE.mode = 'offline'; window.dispatchEvent(new CustomEvent('hud-mode-update'));
    isPendingPower = false; currentMode = 'aktif'; 
    
    const microCapsule = document.getElementById('bgt-micro-capsule');
    if (microCapsule) microCapsule.classList.add('hidden-state');
    const targetUi = document.getElementById('bgt-targeting-ui');
    if (targetUi) targetUi.classList.add('hidden-state');
    
    const hudPanel = document.getElementById('telemetry-panel-container');
    if (hudPanel && hudPanel.classList.contains('telemetry-active') && typeof window.toggleHudConsole === 'function') window.toggleHudConsole();
    
    const bottomNav = document.querySelector('.pb-safe');
    if (bottomNav) bottomNav.style.transform = 'translateY(0)';
    
    // KINETIK AUTO-HIDE: Munculkan kembali tombol Power & Recenter
    if (btnPower) btnPower.classList.remove('btn-auto-hide');
    if (btnRecenter) btnRecenter.classList.remove('btn-auto-hide');
    
    if (mapSystem) mapSystem.off('move', updateRadiusKeCenter);
    if (standbyRadiusLayer && mapSystem) { mapSystem.removeLayer(standbyRadiusLayer); standbyRadiusLayer = null; }
    
    if (driverMarker) { driverMarker.setOpacity(1); driverMarker.setIcon(dapatkanIkonMarker('aktif')); }
    if (physicalGpsMarker && mapSystem) { mapSystem.removeLayer(physicalGpsMarker); physicalGpsMarker = null; }
    
    matikanProsesLatar();
    if (btnPower) btnPower.classList.remove('pointer-events-none');
    updateUIState(); 
}

// EKSPOS MUTLAK AGAR TIDAK MATI SURI SAAT DIPANGGIL HUD CONSOLE
window.matikanSinkronisasi = matikanSinkronisasi; 

// ==========================================================================
// 6. PENGENDALI VISUAL KINETIK
// ==========================================================================
function updateUIState() {
    const btnFisik = document.getElementById('btn-recenter-fisik');
    if (btnFisik) { if (currentMode === 'standby') btnFisik.classList.remove('hidden-state'); else btnFisik.classList.add('hidden-state'); }

    // PENYELAMATAN KELAS SPASIAL ABSOLUT (Anti-Tenggelam Auto-Hide Safe)
    const baseBtnClass = "absolute bottom-[80px] left-[20px] z-[9999] w-14 h-14 rounded-full bg-[#030712] flex items-center justify-center transition-all duration-500 shadow-[0_10px_25px_rgba(0,0,0,0.9)] pointer-events-auto cursor-pointer";
    const baseBadgeClass = "bg-[#030712] backdrop-blur-md px-4 py-1.5 rounded-full shadow-lg border";

    if (!isSocketConnected) {
        if(statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> <span class="text-red-500 font-bold tracking-widest">TERPUTUS</span>';
        if(statusBadge) statusBadge.className = `${baseBadgeClass} border-red-500/50`;
        if(btnPower) {
            btnPower.className = `${baseBtnClass} text-red-500 border-2 border-red-500/50`;
            btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl"></i>';
        }
        return;
    }
    if (!isSystemOnline) {
        if (isPendingPower) {
            if(statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span> <span class="text-yellow-400 font-bold tracking-widest">MENUNGGU...</span>';
            if(statusBadge) statusBadge.className = `${baseBadgeClass} border-yellow-500/50`;
            if(btnPower) {
                btnPower.className = `${baseBtnClass} text-yellow-400 border-2 border-yellow-500/80 animate-pulse shadow-[0_0_25px_rgba(234,179,8,0.5)]`;
                btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl"></i>';
            }
        } else {
            if(statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-gray-500"></span> <span class="text-gray-400 font-bold tracking-widest">OFFLINE</span>';
            if(statusBadge) statusBadge.className = `${baseBadgeClass} border-gray-600`;
            if(btnPower) {
                btnPower.className = `${baseBtnClass} text-gray-400 border border-gray-600`;
                btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl"></i>';
            }
        }
    } else if (currentMode === 'standby') {
        if(statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span> <span class="text-blue-400 font-bold tracking-widest">MANGKAL</span>';
        if(statusBadge) statusBadge.className = `${baseBadgeClass} border-blue-500/50`;
        if(btnPower) {
            btnPower.className = `${baseBtnClass} text-blue-400 border-2 border-blue-500/80 shadow-[0_0_25px_rgba(59,130,246,0.5)]`;
            btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl"></i>';
        }
    } else {
        if(statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span> <span class="text-green-400 font-bold tracking-widest">AKTIF</span>';
        if(statusBadge) statusBadge.className = `${baseBadgeClass} border-green-500/50`;
        if(btnPower) {
            btnPower.className = `${baseBtnClass} text-green-400 border-2 border-green-500/80 shadow-[0_0_25px_rgba(16,185,129,0.5)]`;
            btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl"></i>';
        }
    }
}

export function segarkanPeta() { if (mapSystem) mapSystem.invalidateSize(); }
