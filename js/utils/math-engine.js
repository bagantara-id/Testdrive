// ==========================================================================
// FILE: js/utils/math-engine.js
// FUNGSI: Ekstraksi Rumus Matematika Murni, Geohash, dan Algoritma Jarak
// ==========================================================================

/**
 * Menghitung jarak fisis (dalam meter) antara dua titik koordinat GPS
 */
export function hitungJarakHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radius bumi dalam meter
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Algoritma Geohash Edge Native (Tanpa Pustaka Eksternal)
 */
export function encodeGeohash(lat, lon, precision = 6) {
    const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    let idx = 0, bit = 0, evenBit = true, hash = "";
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
    
    while (hash.length < precision) {
        if (evenBit) {
            let lonMid = (lonMin + lonMax) / 2;
            if (lon >= lonMid) { idx = idx * 2 + 1; lonMin = lonMid; }
            else { idx = idx * 2; lonMax = lonMid; }
        } else {
            let latMid = (latMin + latMax) / 2;
            if (lat >= latMid) { idx = idx * 2 + 1; latMin = latMid; }
            else { idx = idx * 2; latMax = latMid; }
        }
        evenBit = !evenBit;
        if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
    }
    return hash;
}

/**
 * Mengambil waktu lokal untuk operasi Serverless / Edge NTP
 */
export function getTrueTime() {
    return Date.now();
}

// Ekspos global agar modul lama yang belum dimigrasikan penuh tetap berjalan normal
window.getTrueTime = getTrueTime;
