// ==========================================================================
// FILE: js/modules/gps-engine.js
// FUNGSI: Mesin Peta Hydra Multi-CDN, Transmisi Delta-Split, Geofencing Taktis,
//         Rute Jalan Raya OSRM (Inovasi 3), OLED Blackout (Inovasi 4), & Wake-Lock (Inovasi 5)
// ==========================================================================

import { auth } from '../core/firebase-config.js';
import { hitungJarakHaversine, encodeGeohash, getTrueTime, hitungBearingKinetik } from '../utils/math-engine.js';
import { mintaIzinPushNotifikasi } from '../core/auth.js';
import { hidupkanRadar, matikanRadar } from '../../chat/radar-tiket.js';

export const INTERVAL_SINKRONISASI_AKTIF = 5000;
const OLED_IDLE_TIMEOUT_MS = 60000; // 60 Detik Inaktivitas pada Mode Mangkal (Standby)

window.__BGT_TELEMETRY_CACHE = window.__BGT_TELEMETRY_CACHE || { connected: false, accuracy: 0, jarak: 0, txTime: Date.now() };

const btnPower = document.getElementById('btn-power');
const btnRecenter = document.getElementById('btn-recenter');
const statusText = document.getElementById('status-text');
const statusBadge = document.getElementById('status-badge');

let mapSystem = null;
let currentTileLayer = null;
let currentProviderIndex = 0;
let consecutiveTileErrors = 0;

let driverMarker = null;
let standbyRadiusLayer = null;
let physicalGpsMarker = null;
let gpsWatchId = null;
let syncInterval = null;
let standbyTimeout = null;
let lastCoord = null;
let visualCoord = null;
let currentMode = 'aktif';
let isSystemOnline = false;
let isSocketConnected = false;
let isPendingPower = false;

let durasiMangkalMemori = 1;
let currentRadiusKm = 7.0;
let isLightModeGlobal = false;
let koordinatLokal = null;
let isGeofenceValid = true;

// Variabel Inovasi 3: Layer Rute Jalan Raya OSRM
let orderRouteLayer = null;
let orderPickupMarker = null;
let orderDropoffMarker = null;
let orderMultiMarkers = [];

// Variabel Inovasi 4: Mode Hantu Penghemat Baterai (OLED Tactical Blackout)
let oledInactivityTimer = null;
let oledClockInterval = null;
let isOledBlackoutActive = false;

// Variabel Inovasi 5: Kunci Layar Anti-Mati (Screen Wake-Lock API)
let wakeLockSentinel = null;

// ==========================================================================
// INOVASI 5: KUNCI LAYAR ANTI-MATI (SCREEN WAKE-LOCK API)
// ==========================================================================
export async function aktifkanWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        if (wakeLockSentinel && !wakeLockSentinel.released) return;
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
            wakeLockSentinel = null;
        });
    } catch (err) {
        // Abaikan jika browser menolak karena baterai sangat lemah atau tab tersembunyi
    }
}

export async function lepaskanWakeLock() {
    try {
        if (wakeLockSentinel) {
            await wakeLockSentinel.release();
            wakeLockSentinel = null;
        }
    } catch (err) {
        wakeLockSentinel = null;
    }
}

// ==========================================================================
// INOVASI 4: MODE HANTU PENGHEMAT BATERAI (OLED TACTICAL BLACKOUT)
// ==========================================================================
function formatCountdownMangkal(expiresAt) {
    if (!expiresAt) return "00:00:00";
    const sisaMs = Math.max(0, expiresAt - getTrueTime());
    const totalDetik = Math.floor(sisaMs / 1000);
    const jam = String(Math.floor(totalDetik / 3600)).padStart(2, '0');
    const menit = String(Math.floor((totalDetik % 3600) / 60)).padStart(2, '0');
    const detik = String(totalDetik % 60).padStart(2, '0');
    return `${jam}:${menit}:${detik}`;
}

function perbaruiTampilanJamOLED() {
    const elClock = document.getElementById('oled-clock-time');
    const elCountdown = document.getElementById('oled-standby-countdown');
    const elBox = document.getElementById('oled-content-box');

    const now = new Date();
    if (elClock) {
        elClock.innerText = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (elCountdown) {
        const exp = window.__BGT_TELEMETRY_CACHE ? window.__BGT_TELEMETRY_CACHE.expiresAt : null;
        elCountdown.innerText = formatCountdownMangkal(exp);
    }
    // Pergeseran mikro anti-burn-in setiap menit
    if (elBox && now.getSeconds() === 0) {
        const shiftX = Math.floor(Math.random() * 16) - 8;
        const shiftY = Math.floor(Math.random() * 24) - 12;
        elBox.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
    }
}

function tampilkanLayarHitamOLED() {
    if (!isSystemOnline || currentMode !== 'standby') return;
    const modalSergap = document.getElementById('bgt-order-intercept-modal');
    if (modalSergap && !modalSergap.classList.contains('hidden-state')) return;

    const overlay = document.getElementById('oled-blackout-overlay');
    if (!overlay) return;

    isOledBlackoutActive = true;
    overlay.classList.remove('hidden-state');
    perbaruiTampilanJamOLED();

    if (oledClockInterval) clearInterval(oledClockInterval);
    oledClockInterval = setInterval(perbaruiTampilanJamOLED, 1000);
}

export function bangunkanLayarOLED() {
    if (oledInactivityTimer) {
        clearTimeout(oledInactivityTimer);
        oledInactivityTimer = null;
    }
    if (oledClockInterval) {
        clearInterval(oledClockInterval);
        oledClockInterval = null;
    }
    if (isOledBlackoutActive) {
        isOledBlackoutActive = false;
        const overlay = document.getElementById('oled-blackout-overlay');
        if (overlay) overlay.classList.add('hidden-state');
    }
    if (isSystemOnline && currentMode === 'standby') {
        oledInactivityTimer = setTimeout(tampilkanLayarHitamOLED, OLED_IDLE_TIMEOUT_MS);
    }
}

function matikanPemantauOLED() {
    if (oledInactivityTimer) {
        clearTimeout(oledInactivityTimer);
        oledInactivityTimer = null;
    }
    if (oledClockInterval) {
        clearInterval(oledClockInterval);
        oledClockInterval = null;
    }
    isOledBlackoutActive = false;
    const overlay = document.getElementById('oled-blackout-overlay');
    if (overlay) overlay.classList.add('hidden-state');
}

window.bangunkanLayarOLED = bangunkanLayarOLED;

['touchstart', 'mousedown', 'keydown', 'pointerdown'].forEach(evtName => {
    document.addEventListener(evtName, () => {
        if (isSystemOnline && currentMode === 'standby') {
            bangunkanLayarOLED();
        }
    }, { passive: true });
});

// ==========================================================================
// INOVASI 3: GARIS RUTE JALAN RAYA OSRM GRATIS DI PETA DRIVER
// ==========================================================================
function parseKoordinatTiket(coordInput) {
    if (!coordInput) return null;
    if (typeof coordInput === 'object' && coordInput.lat !== undefined && coordInput.lng !== undefined) {
        const lat = parseFloat(coordInput.lat);
        const lng = parseFloat(coordInput.lng);
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    }
    if (typeof coordInput === 'string') {
        const parts = coordInput.split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return { lat: parts[0], lng: parts[1] };
        }
    }
    return null;
}

export function bersihkanRutePesanan() {
    if (!mapSystem) return;
    if (orderRouteLayer) {
        mapSystem.removeLayer(orderRouteLayer);
        orderRouteLayer = null;
    }
    if (orderPickupMarker) {
        mapSystem.removeLayer(orderPickupMarker);
        orderPickupMarker = null;
    }
    if (orderDropoffMarker) {
        mapSystem.removeLayer(orderDropoffMarker);
        orderDropoffMarker = null;
    }
    if (Array.isArray(orderMultiMarkers) && orderMultiMarkers.length > 0) {
        orderMultiMarkers.forEach(m => {
            try { mapSystem.removeLayer(m); } catch (e) {}
        });
        orderMultiMarkers = [];
    }
    const btnClear = document.getElementById('btn-clear-route');
    if (btnClear) btnClear.classList.add('hidden-state');
}

export async function gambarRutePesananOSRM(tiket) {
    if (!mapSystem || !tiket) return;
    bersihkanRutePesanan();

    const pickup = parseKoordinatTiket(tiket.pickup_coord);
    const dropoff = parseKoordinatTiket(tiket.dropoff_coord);
    if (!pickup) return;

    let driverPos = null;
    if (koordinatLokal && koordinatLokal.coords) {
        driverPos = { lat: koordinatLokal.coords.latitude, lng: koordinatLokal.coords.longitude };
    } else if (driverMarker) {
        const ll = driverMarker.getLatLng();
        driverPos = { lat: ll.lat, lng: ll.lng };
    } else if (lastCoord) {
        driverPos = { lat: lastCoord.lat, lng: lastCoord.lng };
    }

    const waypoints = [];
    if (driverPos) waypoints.push(driverPos);
    waypoints.push(pickup);

    if (Array.isArray(tiket.multi_dropoffs)) {
        tiket.multi_dropoffs.forEach(pt => {
            const parsedPt = parseKoordinatTiket(pt);
            if (parsedPt) waypoints.push(parsedPt);
        });
    }

    if (dropoff) waypoints.push(dropoff);

    // Pasang Marker Jemput, Multi-Stop, & Tujuan
    const pickupIcon = L.divIcon({
        className: 'bgt-route-pin-pickup',
        html: `<div style="background:#10b981; color:#030712; width:30px; height:30px; border-radius:50%; border:2px solid #ffffff; display:flex; align-items:center; justify-content:center; font-weight:900; box-shadow:0 4px 12px rgba(16,185,129,0.7);"><i class="fa-solid fa-person-hail"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    orderPickupMarker = L.marker([pickup.lat, pickup.lng], { icon: pickupIcon })
        .bindPopup(`<b>Titik Jemput:</b><br>${String(tiket.pickup_alamat || 'Lokasi Penumpang')}`)
        .addTo(mapSystem);

    if (Array.isArray(tiket.multi_dropoffs)) {
        tiket.multi_dropoffs.forEach((pt, idx) => {
            const parsedPt = parseKoordinatTiket(pt);
            if (parsedPt) {
                const stopIcon = L.divIcon({
                    className: 'bgt-route-pin-stop',
                    html: `<div style="background:#f59e0b; color:#030712; width:26px; height:26px; border-radius:50%; border:2px solid #ffffff; display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:900; box-shadow:0 4px 10px rgba(245,158,11,0.6);">${idx + 1}</div>`,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                });
                const m = L.marker([parsedPt.lat, parsedPt.lng], { icon: stopIcon })
                    .bindPopup(`<b>Pemberhentian ${idx + 1}:</b><br>${String(pt.name || 'Titik Singgah')}`)
                    .addTo(mapSystem);
                orderMultiMarkers.push(m);
            }
        });
    }

    if (dropoff) {
        const dropoffIcon = L.divIcon({
            className: 'bgt-route-pin-dropoff',
            html: `<div style="background:#ef4444; color:#ffffff; width:30px; height:30px; border-radius:50%; border:2px solid #ffffff; display:flex; align-items:center; justify-content:center; font-weight:900; box-shadow:0 4px 12px rgba(239,68,68,0.7);"><i class="fa-solid fa-flag-checkered"></i></div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        orderDropoffMarker = L.marker([dropoff.lat, dropoff.lng], { icon: dropoffIcon })
            .bindPopup(`<b>Titik Tujuan:</b><br>${String(tiket.dropoff_alamat || 'Tujuan Penumpang')}`)
            .addTo(mapSystem);
    }

    const btnClear = document.getElementById('btn-clear-route');
    if (btnClear) btnClear.classList.remove('hidden-state');

    if (waypoints.length < 2) {
        mapSystem.setView([pickup.lat, pickup.lng], 16);
        return;
    }

    const coordQuery = waypoints.map(w => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordQuery}?overview=full&geometries=geojson`;

    try {
        const ctrl = new AbortController();
        const tId = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(osrmUrl, { signal: ctrl.signal });
        clearTimeout(tId);
        const data = await res.json();

        if (data && data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const routeGeoJSON = data.routes[0].geometry;
            orderRouteLayer = L.geoJSON(routeGeoJSON, {
                style: {
                    color: '#10b981',
                    weight: 6,
                    opacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(mapSystem);

            mapSystem.fitBounds(orderRouteLayer.getBounds(), { padding: [55, 55], maxZoom: 17 });
            return;
        }
    } catch (err) {
        // Jika OSRM timeout/gagal, gambar garis hubung taktis langsung
    }

    const latLngs = waypoints.map(w => [w.lat, w.lng]);
    orderRouteLayer = L.polyline(latLngs, {
        color: '#10b981',
        weight: 4,
        dashArray: '8, 8',
        opacity: 0.85
    }).addTo(mapSystem);
    mapSystem.fitBounds(orderRouteLayer.getBounds(), { padding: [55, 55], maxZoom: 17 });
}

window.gambarRutePesananOSRM = gambarRutePesananOSRM;
window.bersihkanRutePesanan = bersihkanRutePesanan;

// ==========================================================================
// 0. HYDRA MULTI-CDN TILE ENGINE (DEFAULT AWAL: OSM GRATIS | OPSIONAL: BYOK MAPTILER PRIBADI)
// ==========================================================================
function dapatkanUrlTileProvider(index, isLight) {
    if (index === 0) {
        // Indeks 0: Murni menggunakan Token MapTiler Pribadi Driver dari localStorage (Bukan Token Aplikasi Publik)
        const key = (localStorage.getItem('bgt_maptiler_key') || '').trim();
        return isLight
            ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${key}`
            : `https://api.maptiler.com/maps/streets-v2-dark/{z}/{x}/{y}.png?key=${key}`;
    } else if (index === 1) {
        // Indeks 1 (Default Awal Tanpa Token): OpenStreetMap (OSM) Standar Gratis
        return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    } else {
        // Indeks 2 (Fallback Sekunder Tanpa Token): ArcGIS World Street Map
        return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
    }
}

function sinkronisasiFilterFallbackPeta() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    if (currentProviderIndex === 0) {
        mapEl.classList.remove('map-fallback-filter');
    } else {
        mapEl.classList.add('map-fallback-filter');
    }
}

function pasangTileLayerHydra(providerIdx = 0) {
    if (!mapSystem) return;

    // Smart Circuit-Breaker: Saat awal aplikasi dibuka (belum ada token pribadi di localStorage),
    // langsung gunakan Indeks 1 (OSM Gratis) tanpa menyentuh server MapTiler sama sekali.
    if (providerIdx === 0) {
        const savedKey = (localStorage.getItem('bgt_maptiler_key') || '').trim();
        if (!savedKey) {
            return pasangTileLayerHydra(1);
        }
    }

    if (currentTileLayer) {
        mapSystem.removeLayer(currentTileLayer);
        currentTileLayer = null;
    }

    currentProviderIndex = providerIdx;
    consecutiveTileErrors = 0;
    sinkronisasiFilterFallbackPeta();

    const targetUrl = dapatkanUrlTileProvider(currentProviderIndex, isLightModeGlobal);
    const tileOptions = currentProviderIndex === 0
        ? {
            tileSize: 512,
            zoomOffset: -1,
            maxNativeZoom: 17,
            maxZoom: 19,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 2
        }
        : {
            tileSize: 256,
            zoomOffset: 0,
            maxNativeZoom: 18,
            maxZoom: 19,
            updateWhenIdle: true,
            updateWhenZooming: false
        };

    currentTileLayer = L.tileLayer(targetUrl, tileOptions);

    currentTileLayer.on('tileload', () => {
        consecutiveTileErrors = 0;
    });

    currentTileLayer.on('tileerror', () => {
        consecutiveTileErrors++;
        if (currentProviderIndex === 0 && consecutiveTileErrors >= 2) {
            consecutiveTileErrors = 0;
            window.dispatchEvent(new CustomEvent('map-provider-fallback'));
            if (window.showToast) window.showToast("Beralih ke peta OSM cadangan (Token MapTiler limit/bermasalah).", "warning");
            pasangTileLayerHydra(1);
        } else if (currentProviderIndex > 0 && consecutiveTileErrors > 4 && currentProviderIndex < 2) {
            consecutiveTileErrors = 0;
            pasangTileLayerHydra(currentProviderIndex + 1);
        }
    });

    currentTileLayer.addTo(mapSystem);
}

// ==========================================================================
// 1. SARAF NAVIGASI DOM & KAPSUL MIKRO
// ==========================================================================
function inisialisasiEventDOM() {
    const btnClearRoute = document.getElementById('btn-clear-route');
    if (btnClearRoute) {
        btnClearRoute.addEventListener('click', () => {
            bersihkanRutePesanan();
            if (window.showToast) window.showToast("Garis rute pesanan dibersihkan dari peta.", "info");
        });
    }

    const oledOverlay = document.getElementById('oled-blackout-overlay');
    if (oledOverlay) {
        oledOverlay.addEventListener('click', () => bangunkanLayarOLED());
        oledOverlay.addEventListener('touchstart', () => bangunkanLayarOLED(), { passive: true });
    }

    const btnCancelTarget = document.getElementById('btn-cancel-target');
    if (btnCancelTarget) {
        btnCancelTarget.addEventListener('click', () => {
            document.getElementById('bgt-targeting-ui').classList.add('hidden-state');
            const bottomNav = document.querySelector('.pb-safe');
            if (bottomNav) bottomNav.style.transform = 'translateY(0)';

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
            if (!isGeofenceValid) return window.showToast("Pelanggaran Jarak! Kunci dibatalkan.", "error");

            document.getElementById('bgt-targeting-ui').classList.add('hidden-state');
            kunciLokasiStandby(durasiMangkalMemori);
        });
    }

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
            if (microCapsule) microCapsule.classList.add('hidden-state');
            if (capDurations) capDurations.classList.replace('flex', 'hidden');
            isPendingPower = false;
            mulaiModeAktif();
        });
    }

    if (capMangkal) {
        capMangkal.addEventListener('click', () => {
            if (capDurations) capDurations.classList.replace('hidden', 'flex');
            capMangkal.className = aktifMangkalClass;
            if (capAktif) capAktif.className = pasifAktifClass;
        });
    }

    if (durBtns) {
        durBtns.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                durasiMangkalMemori = parseInt(ev.target.getAttribute('data-val'));
                if (microCapsule) microCapsule.classList.add('hidden-state');
                setTimeout(() => {
                    if (capDurations) capDurations.classList.replace('flex', 'hidden');
                    if (capAktif) capAktif.className = defaultAktifClass;
                    if (capMangkal) capMangkal.className = defaultMangkalClass;
                }, 300);
                isPendingPower = false;
                mulaiFasePersiapan();
            });
        });
    }

    if (capClose) {
        capClose.addEventListener('click', () => {
            if (microCapsule) microCapsule.classList.add('hidden-state');
            if (capDurations) capDurations.classList.replace('flex', 'hidden');
            setTimeout(() => {
                if (capAktif) capAktif.className = defaultAktifClass;
                if (capMangkal) capMangkal.className = defaultMangkalClass;
            }, 300);
            isPendingPower = false;
            updateUIState();
        });
    }

    const btnFisik = document.getElementById('btn-recenter-fisik');
    if (btnFisik) {
        btnFisik.addEventListener('click', () => {
            if (koordinatLokal && mapSystem) {
                const targetLat = koordinatLokal.coords.latitude;
                const targetLng = koordinatLokal.coords.longitude;
                const center = mapSystem.getCenter();
                const jarakKamera = hitungJarakHaversine(center.lat, center.lng, targetLat, targetLng);
                if (jarakKamera > 2000) {
                    mapSystem.setView([targetLat, targetLng], 17, { animate: false });
                } else {
                    mapSystem.flyTo([targetLat, targetLng], 17, { animate: true, duration: 1.5 });
                }
                if (window.showToast) window.showToast("Menyorot GPS Fisik Anda", "success");
            } else {
                if (window.showToast) window.showToast("Sinyal GPS Fisik belum terkunci", "error");
            }
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (isSystemOnline) {
                aktifkanWakeLock();
            }
            if (currentMode === 'aktif' && driverMarker && visualCoord) {
                driverMarker.setLatLng([visualCoord.lat, visualCoord.lng]);
                const arrowElement = document.getElementById('nav-arrow');
                if (arrowElement && visualCoord.heading !== null && !isNaN(visualCoord.heading)) {
                    requestAnimationFrame(() => {
                        arrowElement.style.transform = `rotate(${visualCoord.heading}deg)`;
                    });
                }
            }
        }
    });
}
document.addEventListener('DOMContentLoaded', inisialisasiEventDOM);

window.addEventListener('theme-toggled', (e) => {
    isLightModeGlobal = e.detail.isLight;
    if (currentTileLayer) {
        if (currentProviderIndex === 0) {
            sinkronisasiFilterFallbackPeta();
            currentTileLayer.setUrl(dapatkanUrlTileProvider(0, isLightModeGlobal));
        } else {
            sinkronisasiFilterFallbackPeta();
        }
    }
    if (standbyRadiusLayer && driverMarker) validasiGeofencingSetup();
});

window.addEventListener('map-key-updated', () => pasangTileLayerHydra(0));

window.addEventListener('update-global-radius', (e) => {
    currentRadiusKm = e.detail;
    const sliderRadius = document.getElementById('slider-radius');
    const sliderVal = document.getElementById('slider-radius-val');
    if (sliderRadius && sliderVal) {
        sliderRadius.value = currentRadiusKm;
        sliderVal.innerText = currentRadiusKm.toFixed(1) + ' KM';
    }
    if (standbyRadiusLayer) {
        standbyRadiusLayer.setRadius(currentRadiusKm * 1000);
        validasiGeofencingSetup();
    }
});

// SPESIFIKASI 2.1: Sinkronisasi Penuh ke RTDB hanya saat pengaturan operasional disimpan
window.addEventListener('ops-settings-saved', () => {
    if (!isSystemOnline || !auth.currentUser) return;
    if (currentMode === 'standby') {
        const targetLat = window.__BGT_TELEMETRY_CACHE.targetLat || (driverMarker ? driverMarker.getLatLng().lat : null);
        const targetLng = window.__BGT_TELEMETRY_CACHE.targetLng || (driverMarker ? driverMarker.getLatLng().lng : null);
        const expiresAt = window.__BGT_TELEMETRY_CACHE.expiresAt || null;
        if (targetLat !== null && targetLng !== null) {
            kirimPayloadPenuhRTDB(targetLat, targetLng, 'standby', expiresAt);
        }
    } else if (currentMode === 'aktif') {
        const lat = koordinatLokal ? koordinatLokal.coords.latitude : (lastCoord ? lastCoord.lat : null);
        const lng = koordinatLokal ? koordinatLokal.coords.longitude : (lastCoord ? lastCoord.lng : null);
        if (lat !== null && lng !== null) {
            kirimPayloadPenuhRTDB(lat, lng, 'aktif', null);
        }
    }
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

                if (data.radius) currentRadiusKm = data.radius;

                tetapkanPosisiPeta(data.lat, data.lng, false);
                if (mapSystem) mapSystem.off('move', updateRadiusKeCenter);

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

                // Nyalakan Radar futaqi-ali, Wake-Lock, dan Timer OLED Blackout
                hidupkanRadar(auth.currentUser.uid);
                aktifkanWakeLock();
                bangunkanLayarOLED();
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
    isLightModeGlobal = document.body.classList.contains('theme-light');
    mapSystem = L.map('map', { zoomControl: false, attributionControl: false }).setView([-6.200000, 106.816666], 15);
    pasangTileLayerHydra(0);

    const statusResureksi = await periksaResureksiStatus();

    if (statusResureksi === true) {
        nyalakanRadarGeofencingSiluman();
    } else {
        const initialLocWatch = navigator.geolocation.watchPosition(
            (pos) => {
                koordinatLokal = pos;
                const lat = pos.coords.latitude, lng = pos.coords.longitude;
                localStorage.setItem('bgt_last_coord', JSON.stringify({ lat, lng }));
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
            localStorage.setItem('bgt_last_coord', JSON.stringify({ lat, lng }));
            if (currentMode !== 'aktif') lastCoord = { lat, lng };

            window.__BGT_TELEMETRY_CACHE.accuracy = akurasi;
            window.dispatchEvent(new CustomEvent('hud-telemetry-gps', { detail: { accuracy: akurasi } }));

            if (currentMode === 'standby') {
                const nowEdge = Date.now();
                if (window.__BGT_TELEMETRY_CACHE.expiresAt && nowEdge > window.__BGT_TELEMETRY_CACHE.expiresAt) {
                    matikanSinkronisasi("Waktu mangkal telah habis. Sistem otomatis dimatikan.");
                    return;
                }

                if (window.__BGT_TELEMETRY_CACHE.targetLat) {
                    const jarakFisik = hitungJarakHaversine(window.__BGT_TELEMETRY_CACHE.targetLat, window.__BGT_TELEMETRY_CACHE.targetLng, lat, lng);
                    if (jarakFisik > 7000) {
                        matikanSinkronisasi("PELANGGARAN LOKASI: Anda menjauh > 7 KM dari Area Mangkal. Radar diputus paksa!");
                        return;
                    }
                }
            }

            if (currentMode === 'aktif' && driverMarker) {
                let jarakKinetik = 0;
                let headingAkurat = heading;

                if (visualCoord) {
                    jarakKinetik = hitungJarakHaversine(visualCoord.lat, visualCoord.lng, lat, lng);
                    if (!headingAkurat || headingAkurat === 0 || isNaN(headingAkurat)) {
                        if (jarakKinetik > 2) {
                            headingAkurat = hitungBearingKinetik(visualCoord.lat, visualCoord.lng, lat, lng);
                            visualCoord.heading = headingAkurat;
                        } else {
                            headingAkurat = visualCoord.heading || 0;
                        }
                    }
                }

                if (!visualCoord || jarakKinetik > 1) {
                    visualCoord = { lat, lng, heading: headingAkurat };

                    if (document.visibilityState === 'visible') {
                        driverMarker.setLatLng([lat, lng]);
                        const arrowElement = document.getElementById('nav-arrow');
                        if (arrowElement && headingAkurat !== null && !isNaN(headingAkurat)) {
                            requestAnimationFrame(() => {
                                arrowElement.style.transform = `rotate(${headingAkurat}deg)`;
                            });
                        }
                    }
                }
            }

            if (currentMode === 'standby' || currentMode === 'persiapan') {
                if (!physicalGpsMarker) {
                    physicalGpsMarker = L.marker([lat, lng], {
                        icon: L.divIcon({ className: 'bgt-physical-pin', html: `<img src="./assets/pin-gps.png" style="width:36px; height:36px; object-fit:contain; filter:drop-shadow(0 4px 6px rgba(0,0,0,0.6));" onerror="this.src='./assets/pin_standby.png'">`, iconSize: [36, 36], iconAnchor: [18, 18] }), interactive: false, zIndexOffset: 999
                    }).addTo(mapSystem);
                } else { physicalGpsMarker.setLatLng([lat, lng]); }

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
    if (animate && mapSystem) {
        const center = mapSystem.getCenter();
        const jarakKamera = hitungJarakHaversine(center.lat, center.lng, lat, lng);
        if (jarakKamera > 2000) {
            mapSystem.setView([lat, lng], 17, { animate: false });
        } else {
            mapSystem.flyTo([lat, lng], 17, { animate: true, duration: 1.5 });
        }
    } else if (mapSystem) {
        mapSystem.setView([lat, lng], 17, { animate: false });
    }

    if (!driverMarker) driverMarker = L.marker([lat, lng], { icon: dapatkanIkonMarker(currentMode), draggable: false }).addTo(mapSystem);
    else driverMarker.setLatLng([lat, lng]);
    perbaruiRadiusStandby(lat, lng);
}

// ==========================================================================
// 3. KONTROL RADIUS & EDGE AI VALIDATION
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
        validasiGeofencingSetup();
    } else {
        if (standbyRadiusLayer) { mapSystem.removeLayer(standbyRadiusLayer); standbyRadiusLayer = null; }
    }
}

function validasiGeofencingSetup() {
    if (!mapSystem || !standbyRadiusLayer || currentMode !== 'persiapan') return;

    let isValid = true;
    if (koordinatLokal) {
        const center = mapSystem.getCenter();
        const jarak = hitungJarakHaversine(koordinatLokal.coords.latitude, koordinatLokal.coords.longitude, center.lat, center.lng);
        if (jarak > 7000) isValid = false;
    } else {
        isValid = false;
    }

    const btnLock = document.getElementById('btn-lock-target');

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

    if (isValid !== isGeofenceValid) {
        isGeofenceValid = isValid;
        if (!isValid && koordinatLokal) {
            if (window.showToast) window.showToast("Batas 7 KM Terlampaui! Kunci Mangkal diblokir.", "error");
        }
    }
}

function updateRadiusKeCenter() {
    if (currentMode === 'persiapan' && standbyRadiusLayer && mapSystem) {
        standbyRadiusLayer.setLatLng(mapSystem.getCenter());
        validasiGeofencingSetup();
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
            if (driverMarker && mapSystem) {
                const targetPos = driverMarker.getLatLng();
                const center = mapSystem.getCenter();
                const jarakKamera = hitungJarakHaversine(center.lat, center.lng, targetPos.lat, targetPos.lng);
                if (jarakKamera > 2000) {
                    mapSystem.setView([targetPos.lat, targetPos.lng], 17, { animate: false });
                } else {
                    mapSystem.flyTo(targetPos, 17, { animate: true, duration: 1.5 });
                }
                if (window.showToast) window.showToast("Kamera dikembalikan ke Titik Mangkal.", "success");
            }
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
                    if (driverMarker && mapSystem) {
                        const targetPos = driverMarker.getLatLng();
                        const center = mapSystem.getCenter();
                        const jarakKamera = hitungJarakHaversine(center.lat, center.lng, targetPos.lat, targetPos.lng);
                        if (jarakKamera > 2000) {
                            mapSystem.setView([targetPos.lat, targetPos.lng], 17, { animate: false });
                        } else {
                            mapSystem.flyTo(targetPos, 17, { animate: true, duration: 1 });
                        }
                    } else if (window.showToast) window.showToast("Sinyal satelit gagal ditangkap.", "error");
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

        if ('Notification' in window && Notification.permission !== 'granted') {
            await mintaIzinPushNotifikasi(auth.currentUser.uid);
        } else if ('Notification' in window && Notification.permission === 'granted') {
            mintaIzinPushNotifikasi(auth.currentUser.uid);
        }

        if (isSystemOnline) {
            await matikanSinkronisasi("Sistem dialihkan ke mode Luring (Offline).");
            const microCapsule = document.getElementById('bgt-micro-capsule');
            if (microCapsule) microCapsule.classList.add('hidden-state');
            isPendingPower = false;
        } else {
            isPendingPower = !isPendingPower;
            const microCapsule = document.getElementById('bgt-micro-capsule');
            const capDurations = document.getElementById('cap-durations');
            if (isPendingPower) {
                if (microCapsule) microCapsule.classList.remove('hidden-state');
            } else {
                if (microCapsule) microCapsule.classList.add('hidden-state');
                if (capDurations) capDurations.classList.replace('flex', 'hidden');
            }
            updateUIState();
        }
    });
}

// ==========================================================================
// 5. MESIN STATE MODE & TRANSMISI DELTA-SPLIT + ADAPTIVE VELOCITY THROTTLING
// ==========================================================================
function mulaiModeAktif() {
    isSystemOnline = true; isPendingPower = false; matikanProsesLatar(); currentMode = 'aktif';
    matikanPemantauOLED();

    window.__BGT_TELEMETRY_CACHE.mode = 'aktif'; window.dispatchEvent(new CustomEvent('hud-mode-update'));
    updateUIState();

    // Nyalakan Radar futaqi-ali & Screen Wake-Lock API
    if (auth.currentUser) hidupkanRadar(auth.currentUser.uid);
    aktifkanWakeLock();

    if (mapSystem) mapSystem.off('move', updateRadiusKeCenter);
    const uiTarget = document.getElementById('bgt-targeting-ui');
    if (uiTarget) uiTarget.classList.add('hidden-state');

    if (driverMarker) {
        driverMarker.setOpacity(1); driverMarker.setIcon(dapatkanIkonMarker(currentMode));
        perbaruiRadiusStandby(driverMarker.getLatLng().lat, driverMarker.getLatLng().lng);
    }

    if (physicalGpsMarker && mapSystem) { mapSystem.removeLayer(physicalGpsMarker); physicalGpsMarker = null; }

    lastCoord = null;
    nyalakanRadarGeofencingSiluman();
    let waktuTransmisiTerakhir = Date.now();
    let hasSentInitialFullPayload = false;

    // Kirim Payload Penuh 1 kali saat awal mulaiModeAktif() jika koordinat sudah tersedia
    const savedCoord = JSON.parse(localStorage.getItem('bgt_last_coord') || 'null');
    const initLat = koordinatLokal ? koordinatLokal.coords.latitude : (savedCoord ? savedCoord.lat : null);
    const initLng = koordinatLokal ? koordinatLokal.coords.longitude : (savedCoord ? savedCoord.lng : null);

    if (initLat !== null && initLng !== null) {
        kirimPayloadPenuhRTDB(initLat, initLng, 'aktif', null);
        lastCoord = { lat: initLat, lng: initLng };
        waktuTransmisiTerakhir = Date.now();
        hasSentInitialFullPayload = true;
        window.__BGT_TELEMETRY_CACHE.txTime = waktuTransmisiTerakhir;
        if (document.visibilityState === 'visible') {
            window.dispatchEvent(new CustomEvent('hud-telemetry-tx'));
        }
    }

    let idleTicks = 0;
    let lowSpeedTicks = 0;

    syncInterval = setInterval(async () => {
        if (document.visibilityState === 'hidden') {
            idleTicks++;
            if (idleTicks < 3) return;
            idleTicks = 0;
        } else {
            idleTicks = 0;
        }

        if (!koordinatLokal || !isSocketConnected) return;
        const currentLat = koordinatLokal.coords.latitude, currentLng = koordinatLokal.coords.longitude;
        const waktuSekarangEdge = Date.now();

        // Jika saat awal mulaiModeAktif() sinyal GPS belum terkunci, kirim Payload Penuh 1 kali begitu sinyal dikunci
        if (!hasSentInitialFullPayload) {
            await kirimPayloadPenuhRTDB(currentLat, currentLng, 'aktif', null);
            lastCoord = { lat: currentLat, lng: currentLng };
            waktuTransmisiTerakhir = waktuSekarangEdge;
            hasSentInitialFullPayload = true;
            window.__BGT_TELEMETRY_CACHE.txTime = waktuSekarangEdge;
            if (document.visibilityState === 'visible') {
                window.dispatchEvent(new CustomEvent('hud-telemetry-tx'));
            }
            return;
        }

        let pergeseranJarak = 0;
        const butuhPacuJantung = (waktuSekarangEdge - waktuTransmisiTerakhir) > 120000;

        if (lastCoord) {
            pergeseranJarak = hitungJarakHaversine(lastCoord.lat, lastCoord.lng, currentLat, currentLng);
            window.__BGT_TELEMETRY_CACHE.jarak = pergeseranJarak;

            if (document.visibilityState === 'visible') {
                window.dispatchEvent(new CustomEvent('hud-telemetry-haversine', { detail: { jarak: pergeseranJarak } }));
            }

            // SPESIFIKASI 2.1: Adaptive Velocity Throttling
            if (pergeseranJarak < 10) {
                // Berhenti (< 10m): Tahan pengiriman dan hanya kirim heartbeat setiap 120 detik
                if (!butuhPacuJantung) return;
                lowSpeedTicks = 0;
            } else if (pergeseranJarak >= 10 && pergeseranJarak <= 25) {
                // Kecepatan rendah / macet (10m s/d 25m): Kirim data setiap 2 tik (10 detik)
                lowSpeedTicks++;
                if (lowSpeedTicks < 2 && !butuhPacuJantung) return;
                lowSpeedTicks = 0;
            } else {
                // Melaju cepat (> 25m): Kirim setiap 1 tik (5 detik)
                lowSpeedTicks = 0;
            }
        }

        await kirimPulseKinetikRTDB(currentLat, currentLng);
        lastCoord = { lat: currentLat, lng: currentLng };
        waktuTransmisiTerakhir = waktuSekarangEdge;

        window.__BGT_TELEMETRY_CACHE.txTime = waktuSekarangEdge;
        if (document.visibilityState === 'visible') {
            window.dispatchEvent(new CustomEvent('hud-telemetry-tx'));
        }
    }, INTERVAL_SINKRONISASI_AKTIF);
}

function mulaiFasePersiapan() {
    isSystemOnline = false; isPendingPower = true;
    matikanPemantauOLED();
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
    if (standbyTimeout) { clearTimeout(standbyTimeout); standbyTimeout = null; }

    currentMode = 'persiapan'; updateUIState();
    if (!gpsWatchId) nyalakanRadarGeofencingSiluman();

    const bottomNav = document.querySelector('.pb-safe');
    if (bottomNav) { bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)'; bottomNav.style.transform = 'translateY(150%)'; }

    if (btnPower) btnPower.classList.add('btn-auto-hide');
    if (btnRecenter) btnRecenter.classList.add('btn-auto-hide');

    if (driverMarker) driverMarker.setOpacity(0);
    const uiTarget = document.getElementById('bgt-targeting-ui');
    if (uiTarget) uiTarget.classList.remove('hidden-state');

    if (mapSystem) {
        const center = mapSystem.getCenter();
        perbaruiRadiusStandby(center.lat, center.lng);
        mapSystem.on('move', updateRadiusKeCenter);
    }
}

function kunciLokasiStandby(durasiJam) {
    if (!mapSystem) return;
    const center = mapSystem.getCenter();

    if (koordinatLokal) {
        const fisikLat = koordinatLokal.coords.latitude, fisikLng = koordinatLokal.coords.longitude;
        const jarakTarget = hitungJarakHaversine(fisikLat, fisikLng, center.lat, center.lng);
        if (jarakTarget > 7000) {
            if (window.showToast) window.showToast(`Gagal! Titik ini ${Math.round(jarakTarget / 1000)} KM dari Anda (Max 7 KM).`, "error");
            document.getElementById('btn-cancel-target').click();
            return;
        }
    } else {
        if (window.showToast) window.showToast("Sinyal fisik sedang dikalibrasi. Tunggu 3 detik lalu coba lagi.", "error"); return;
    }

    mapSystem.off('move', updateRadiusKeCenter); currentMode = 'standby';
    if (window.showToast) window.showToast("Target Terkunci. Memulai Mangkal...", "success");

    const bottomNav = document.querySelector('.pb-safe');
    if (bottomNav) bottomNav.style.transform = 'translateY(0)';

    if (btnPower) btnPower.classList.remove('btn-auto-hide');
    if (btnRecenter) btnRecenter.classList.remove('btn-auto-hide');

    if (driverMarker) { driverMarker.setLatLng(center); driverMarker.setIcon(dapatkanIkonMarker(currentMode)); driverMarker.setOpacity(1); }
    perbaruiRadiusStandby(center.lat, center.lng);

    const expiresAt = getTrueTime() + (durasiJam * 60 * 60 * 1000);

    kirimPayloadPenuhRTDB(center.lat, center.lng, 'standby', expiresAt).then(sukses => {
        if (sukses) {
            isSystemOnline = true; isPendingPower = false; updateUIState();
            if (driverMarker) driverMarker.dragging.disable();
            standbyTimeout = setTimeout(() => matikanSinkronisasi("Durasi operasi mangkal usai."), durasiJam * 60 * 60 * 1000);
            window.__BGT_TELEMETRY_CACHE.mode = 'standby'; window.__BGT_TELEMETRY_CACHE.expiresAt = expiresAt;
            window.__BGT_TELEMETRY_CACHE.targetLat = center.lat; window.__BGT_TELEMETRY_CACHE.targetLng = center.lng;
            window.dispatchEvent(new CustomEvent('hud-mode-update'));

            // Nyalakan Radar futaqi-ali, Wake-Lock, dan Timer OLED Blackout (60 detik)
            if (auth.currentUser) hidupkanRadar(auth.currentUser.uid);
            aktifkanWakeLock();
            bangunkanLayarOLED();
        } else matikanSinkronisasi("Gagal mengunci lokasi. Periksa koneksi.");
    });
}

// SPESIFIKASI 2.1: Payload Penuh (Hanya dipanggil 1x saat mulaiModeAktif, kunciLokasiStandby, atau ops-settings-saved)
export async function kirimPayloadPenuhRTDB(lat, lng, mode, expiresAt) {
    if (!auth.currentUser) return false;
    try {
        const bgtGeohash = encodeGeohash(lat, lng, 5);
        const token = await auth.currentUser.getIdToken();
        const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;

        const strArmada = String(window.__BGT_KATEGORI_ARMADA || "MOTOR").substring(0, 15);
        const strLayanan = String(window.__BGT_ACTIVE_SERVICES || (strArmada === "MOBIL" ? "CAR" : "RIDE")).substring(0, 50);
        const numTarif = Number(window.__BGT_MIN_TARIF) || 10000;
        const strAgenda = String(window.__BGT_AGENDA_INFO || "").substring(0, 150);
        const savedSessionId = String(localStorage.getItem('bgt_session') || `SES_${auth.currentUser.uid.substring(0, 8)}`).substring(0, 40);
        const safeRadius = Math.min(15, Math.max(1, Number(currentRadiusKm) || 7.0));

        await fetch(dbUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isOnline: true,
                mode: mode,
                lat: Number(lat),
                lng: Number(lng),
                geohash: bgtGeohash,
                radius: safeRadius,
                timestamp: getTrueTime(),
                expiresAt: expiresAt ? Number(expiresAt) : null,
                session_id: savedSessionId,
                armada: strArmada,
                layanan: strLayanan,
                tarif_min: numTarif,
                agenda: strAgenda
            })
        });
        return true;
    } catch (error) { return false; }
}

// SPESIFIKASI 2.1: Payload Pulse Kinetik Mikro (Hanya PATCH 4 field di dalam syncInterval)
export async function kirimPulseKinetikRTDB(lat, lng) {
    if (!auth.currentUser) return false;
    try {
        const bgtGeohash = encodeGeohash(lat, lng, 5);
        const token = await auth.currentUser.getIdToken();
        const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;

        await fetch(dbUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lat: lat,
                lng: lng,
                geohash: bgtGeohash,
                timestamp: getTrueTime()
            })
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

    // Putus Radar futaqi-ali (goOffline(dbRadar)), lepaskan Wake-Lock, dan matikan OLED Blackout
    matikanRadar();
    lepaskanWakeLock();
    matikanPemantauOLED();

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

window.matikanSinkronisasi = matikanSinkronisasi;

// ==========================================================================
// 6. PENGENDALI VISUAL KINETIK
// ==========================================================================
function updateUIState() {
    const btnFisik = document.getElementById('btn-recenter-fisik');
    if (btnFisik) { if (currentMode === 'standby') btnFisik.classList.remove('hidden-state'); else btnFisik.classList.add('hidden-state'); }

    const baseBtnClass = "absolute bottom-[80px] left-[20px] z-[9999] w-14 h-14 rounded-full flex items-center justify-center transition-all duration-500 shadow-[0_10px_25px_rgba(0,0,0,0.9)] pointer-events-auto cursor-pointer";
    const baseBadgeClass = "bg-[#030712] backdrop-blur-md px-4 py-1.5 rounded-full shadow-lg border";

    if (!isSocketConnected) {
        if (statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> <span class="text-red-500 font-bold tracking-widest">TERPUTUS</span>';
        if (statusBadge) statusBadge.className = `${baseBadgeClass} border-red-500/50`;
        if (btnPower) {
            btnPower.className = `${baseBtnClass} bg-[#030712] text-red-500 border-2 border-red-500/50`;
            btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl drop-shadow-md"></i>';
        }
        return;
    }
    if (!isSystemOnline) {
        if (isPendingPower) {
            if (statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span> <span class="text-yellow-400 font-bold tracking-widest">MENUNGGU...</span>';
            if (statusBadge) statusBadge.className = `${baseBadgeClass} border-yellow-500/50`;
            if (btnPower) {
                btnPower.className = `${baseBtnClass} bg-[#030712] text-yellow-400 border-2 border-yellow-500/80 animate-pulse shadow-[0_0_25px_rgba(234,179,8,0.5)]`;
                btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl drop-shadow-md"></i>';
            }
        } else {
            if (statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-theme-gold opacity-50"></span> <span class="text-theme-gold opacity-60 font-bold tracking-widest drop-shadow-sm">OFFLINE</span>';
            if (statusBadge) statusBadge.className = `${baseBadgeClass} border-theme-gold/20`;
            if (btnPower) {
                btnPower.className = `${baseBtnClass} btn-power-idle`;
                btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl drop-shadow-lg"></i>';
            }
        }
    } else if (currentMode === 'standby') {
        if (statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span> <span class="text-blue-400 font-bold tracking-widest">MANGKAL</span>';
        if (statusBadge) statusBadge.className = `${baseBadgeClass} border-blue-500/50`;
        if (btnPower) {
            btnPower.className = `${baseBtnClass} bg-[#030712] text-blue-400 border-2 border-blue-500/80 shadow-[0_0_25px_rgba(59,130,246,0.5)]`;
            btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl drop-shadow-md"></i>';
        }
    } else {
        if (statusText) statusText.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span> <span class="text-green-400 font-bold tracking-widest">AKTIF</span>';
        if (statusBadge) statusBadge.className = `${baseBadgeClass} border-green-500/50`;
        if (btnPower) {
            btnPower.className = `${baseBtnClass} bg-[#030712] text-green-400 border-2 border-green-500/80 shadow-[0_0_25px_rgba(16,185,129,0.5)]`;
            btnPower.innerHTML = '<i class="fa-solid fa-power-off pointer-events-none text-xl drop-shadow-md"></i>';
        }
    }
}

export function segarkanPeta() { if (mapSystem) mapSystem.invalidateSize(); }
