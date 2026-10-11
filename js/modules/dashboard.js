// ==========================================================================
// FILE: js/modules/dashboard.js
// FUNGSI: Logika Operasional Antarmuka & Smart Fields (Bebas Radius)
// ==========================================================================

import { auth, dbFirestore } from '../core/firebase-config.js';
import { toggleBiometrikManual } from '../core/auth.js'; 
import { inisialisasiPeta, segarkanPeta } from './gps-engine.js'; 

let kategoriArmada = 'Motor'; 

document.addEventListener('visibilitychange', () => {
    if (!auth.currentUser) return;
    window.dispatchEvent(new CustomEvent(document.visibilityState === 'hidden' ? 'app-background' : 'app-foreground'));
});

const mapContainer = document.getElementById('map');
if (mapContainer) {
    const mapObserver = new ResizeObserver(() => {
        if (!mapContainer.closest('.hidden-state') && mapContainer.clientWidth > 0) segarkanPeta();
    });
    mapObserver.observe(mapContainer);
}

function inisialisasiTemaOtomatis() {
    const isNight = (new Date().getHours() >= 18 || new Date().getHours() < 6);
    const iconTheme = document.getElementById('iconTheme');
    
    if (isNight) {
        document.body.classList.remove('theme-light');
        if (iconTheme) { iconTheme.className = 'fa-solid fa-moon'; iconTheme.style.color = '#9ca3af'; }
    } else {
        document.body.classList.add('theme-light');
        if (iconTheme) { iconTheme.className = 'fa-solid fa-sun'; iconTheme.style.color = '#d97706'; }
    }
    setTimeout(() => window.dispatchEvent(new CustomEvent('theme-toggled', { detail: { isLight: !isNight } })), 800); 
}

// INJEKSI TAHAP 1: FUNGSI HYDRATION (MENYEDOT DATA DARI MEMORI HP SECARA INSTAN)
export function hydrateUI() {
    // 1. Baca memori lokal seketika tanpa menunggu server Firebase
    const localSettings = JSON.parse(localStorage.getItem('bgt_ops_settings')) || {
        info: '',
        tarif: 10000,
        radius: 7.0,
        layanan: ['RIDE'] // Fallback default
    };

    // 2. Tebak Kategori Armada dari cache agar UI langsung tercipta (Omni-casing kebal huruf kecil)
    if (localSettings.layanan && localSettings.layanan.some(l => String(l).toUpperCase() === 'CAR')) {
        kategoriArmada = 'Mobil';
        window.__BGT_KATEGORI_ARMADA = 'MOBIL';
    } else {
        kategoriArmada = 'Motor';
        window.__BGT_KATEGORI_ARMADA = 'MOTOR';
    }

    // 3. Suntikkan nilai ke elemen HTML Form
    const elInfo = document.getElementById('dash-info');
    if(elInfo) elInfo.value = localSettings.info || '';
    
    const elTarif = document.getElementById('dash-tarif');
    if(elTarif) elTarif.value = localSettings.tarif || '';
    
    const elOpsRadius = document.getElementById('ops-slider-radius');
    const elOpsRadiusVal = document.getElementById('ops-radius-val');
    if(elOpsRadius && elOpsRadiusVal && localSettings.radius) {
        // FORCE REFLOW: Menerapkan value secara agresif menimpa cache usang
        elOpsRadius.value = localSettings.radius;
        elOpsRadiusVal.innerText = parseFloat(localSettings.radius).toFixed(1) + ' KM';
        // Kirim event agar radar standby langsung menyesuaikan ukurannya
        window.dispatchEvent(new CustomEvent('update-global-radius', { detail: parseFloat(localSettings.radius) }));
    }
    
    // 4. Centang checklist layanan secara otomatis
    renderLayananOptions(localSettings.layanan || []);

    // 5. Simpan ke saraf global untuk dikonsumsi oleh Mesin GPS
    // Pastikan layanan selalu tersimpan dalam format UPPERCASE yang bersih
    window.__BGT_ACTIVE_SERVICES = (localSettings.layanan || []).map(l => String(l).trim().toUpperCase()).join(',');
    window.__BGT_MIN_TARIF = localSettings.tarif ? parseInt(localSettings.tarif) : 10000;
    window.__BGT_AGENDA_INFO = localSettings.info || '';
}

// Eksekusi kedua fungsi secara bersamaan di detik 0.01 saat aplikasi dibuka
document.addEventListener('DOMContentLoaded', () => {
    inisialisasiTemaOtomatis();
    hydrateUI(); 
});

const btnThemeToggle = document.getElementById('btnThemeToggle');
if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
        document.body.classList.toggle('theme-light');
        const isLight = document.body.classList.contains('theme-light');
        const iconTheme = document.getElementById('iconTheme');
        if (iconTheme) {
            iconTheme.className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
            iconTheme.style.color = isLight ? '#d97706' : '#9ca3af';
        }
        window.dispatchEvent(new CustomEvent('theme-toggled', { detail: { isLight: isLight } }));
    });
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.replace('text-theme-gold', 'text-gray-500'));
        btn.classList.replace('text-gray-500', 'text-theme-gold');
        document.querySelectorAll('.panel-overlay').forEach(p => p.classList.add('hidden-state'));
        
        const hudPanel = document.getElementById('telemetry-panel-container');
        if (hudPanel && hudPanel.classList.contains('telemetry-active') && typeof window.toggleHudConsole === 'function') {
            window.toggleHudConsole();
        }
        
        const target = btn.getAttribute('data-target');
        const floaters = ['btn-telemetry-hud', 'btn-power', 'btn-recenter', 'btn-recenter-fisik'];
        
        if(target !== 'map-only') {
            const tgtEl = document.getElementById(target);
            if(tgtEl) tgtEl.classList.remove('hidden-state');
            kunciSemuaSmartFields(); 
            floaters.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden-state'); });
        } else {
            floaters.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('hidden-state'); });
        }
    });
});

document.querySelectorAll('.btn-close-panel').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.panel-overlay').forEach(p => p.classList.add('hidden-state'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.replace('text-theme-gold', 'text-gray-500'));
        const mapBtn = document.querySelector('[data-target="map-only"]');
        if(mapBtn) mapBtn.classList.replace('text-gray-500', 'text-theme-gold');
        
        const floaters = ['btn-telemetry-hud', 'btn-power', 'btn-recenter', 'btn-recenter-fisik'];
        floaters.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('hidden-state'); });
    });
});

window.__BGT_DATA_LOADED = false; 

// Diubah menjadi async agar bisa menarik data RTDB
async function muatDataPengemudi(data) {
    if (!data || window.__BGT_DATA_LOADED) return;
    window.__BGT_DATA_LOADED = true;

    const profil = data.profile || {}; 
    kategoriArmada = profil.kategori || 'Motor';
    
    const elNama = document.getElementById('lock-nama');
    if(elNama) elNama.innerText = profil.nama || ''; 
    
    const elKendaraan = document.getElementById('lock-kendaraan');
    if(elKendaraan) elKendaraan.value = profil.kendaraan || '';
    
    const elPlat = document.getElementById('lock-plat');
    if(elPlat) elPlat.value = profil.plat || '';
    
    const elWa = document.getElementById('lock-wa');
    if(elWa) elWa.value = profil.wa || '';
    
    const elFoto = document.getElementById('profile-photo-preview');
    if (profil.fotoUrl && elFoto) elFoto.src = profil.fotoUrl;

    const bioToggle = document.getElementById('toggle-biometrik');
    if (bioToggle) {
        const newBioToggle = bioToggle.cloneNode(true);
        bioToggle.parentNode.replaceChild(newBioToggle, bioToggle);
        newBioToggle.checked = !!localStorage.getItem('bgt_bio_id');
        newBioToggle.addEventListener('change', async (ev) => {
            ev.target.disabled = true; 
            const isActivating = ev.target.checked;
            const sukses = await toggleBiometrikManual(isActivating);
            if (sukses && window.alert) window.alert(isActivating ? "Gembok Layar Biometrik diaktifkan." : "Gembok Layar Biometrik dimatikan.", "success");
            else ev.target.checked = !isActivating; 
            ev.target.disabled = false;
        });
    }

    // TAHAP 1 HYDRATION: Update validasi identitas Armada murni dari Firestore tanpa membebani render HTML
    window.__BGT_KATEGORI_ARMADA = kategoriArmada.toUpperCase();

    // =========================================================================
    // SINKRONISASI CERDAS RTDB: Menarik data operasional terakhir (0 Kuota Firestore)
    // =========================================================================
    if (auth.currentUser) {
        try {
            const token = await auth.currentUser.getIdToken();
            const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;
            const res = await fetch(dbUrl);
            const rtdbData = await res.json();

            if (rtdbData) {
                // Konversi data RTDB ke format penyimpanan lokal
                const sinkronSettings = {
                    info: rtdbData.agenda || "",
                    tarif: rtdbData.tarif_min ? parseInt(rtdbData.tarif_min) : 10000,
                    radius: rtdbData.radius ? parseFloat(rtdbData.radius) : 7.0,
                    layanan: rtdbData.layanan ? rtdbData.layanan.split(',') : (kategoriArmada === 'Mobil' ? ['CAR'] : ['RIDE'])
                };
                
                // Timpa memori lokal dengan data akurat dari RTDB
                localStorage.setItem('bgt_ops_settings', JSON.stringify(sinkronSettings));
            }
        } catch (err) {
            console.warn("Gagal menarik sinkronisasi RTDB, menggunakan cache lokal:", err);
        }
    }

    // FORCE REFLOW: Segarkan UI seketika agar slider & layanan menyesuaikan data RTDB terbaru
    hydrateUI();

    try {
        inisialisasiPeta();
        import('../../chat/radar-tiket.js')
            .then(radar => radar.hidupkanRadar(auth.currentUser.uid))
            .catch(() => console.warn("[ISOLASI] Modul Radar tidak terpasang."));
    } catch (err) { console.error("[SISTEM] Gagal inisialisasi peta:", err); }
}

window.addEventListener('driverDataLoaded', (e) => muatDataPengemudi(e.detail));
if (window.__BGT_DRIVER_DATA_BUFFER) muatDataPengemudi(window.__BGT_DRIVER_DATA_BUFFER);

function renderLayananOptions(layananAktif) {
    const container = document.getElementById('layanan-options-container');
    if(!container) return;
    container.innerHTML = '';
    const opsi = kategoriArmada === 'Mobil' ? [{ val: 'Car', label: 'Car (Mobil)' }] : [ { val: 'Ride', label: 'Ride (Motor)' }, { val: 'Jastip', label: 'Jasa Titip' }, { val: 'Express', label: 'Express (Paket)' } ];
        
    // OMNI-CASING FILTER (DIPERBAIKI): Pengaman mutlak anti-crash jika data bukan array
    const rawArray = Array.isArray(layananAktif) ? layananAktif : (typeof layananAktif === 'string' ? layananAktif.split(',') : ['RIDE']);
    const layananUpper = rawArray.map(l => (l ? String(l).trim().toUpperCase() : ''));
        
    opsi.forEach(item => {
        const isChecked = layananUpper.includes(item.val.toUpperCase()) ? 'checked' : '';
        const isDisabled = kategoriArmada === 'Mobil' ? 'disabled' : '';
        container.innerHTML += `<label class="flex items-center gap-3 cursor-pointer"><input type="checkbox" value="${item.val}" class="chk-layanan custom-checkbox" ${isChecked} ${isDisabled}><span class="text-sm font-bold text-gray-300 tracking-wide">${item.label}</span></label>`;
    });
}

function kunciSemuaSmartFields() {
    document.querySelectorAll('.smart-field-container').forEach(container => {
        const input = container.querySelector('.smart-input');
        const btn = container.querySelector('.smart-btn-toggle');
        if(input && btn) {
            input.disabled = true;
            input.classList.remove('smart-edit'); input.classList.add('smart-locked');
            btn.innerHTML = '<i class="fa-solid fa-lock"></i>';
            btn.classList.replace('text-green-500', 'text-theme-gold');
        }
    });
}

document.querySelectorAll('.smart-btn-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const input = btn.previousElementSibling;
        if (!input) return;
        if (input.disabled) {
            input.disabled = false;
            input.classList.remove('smart-locked'); input.classList.add('smart-edit');
            btn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
            btn.classList.replace('text-theme-gold', 'text-green-500');
            input.focus();
        } else {
            input.disabled = true;
            input.classList.remove('smart-edit'); input.classList.add('smart-locked');
            btn.innerHTML = '<i class="fa-solid fa-lock"></i>';
            btn.classList.replace('text-green-500', 'text-theme-gold');
        }
    });
});

// Event Listener untuk Slider Radius Operasional (Real-time Text Update)
const opsSlider = document.getElementById('ops-slider-radius');
const opsSliderVal = document.getElementById('ops-radius-val');
if (opsSlider && opsSliderVal) {
    opsSlider.addEventListener('input', (e) => {
        opsSliderVal.innerText = parseFloat(e.target.value).toFixed(1) + ' KM';
        window.dispatchEvent(new CustomEvent('update-global-radius', { detail: parseFloat(e.target.value) }));
    });
}

let isSaving = false;
const btnSave = document.getElementById('btn-save-settings');
if(btnSave) {
    btnSave.addEventListener('click', async () => {
        if (!auth.currentUser || isSaving) return;
        
        const selectedLayanan = Array.from(document.querySelectorAll('.chk-layanan:checked')).map(chk => chk.value);
        const elTarif = document.getElementById('dash-tarif');
        const elInfo = document.getElementById('dash-info');
        
        const tarif = elTarif ? Number(elTarif.value) : 10000;
        const info = elInfo ? elInfo.value.trim() : "";
        const opsSliderEl = document.getElementById('ops-slider-radius');
        const radius = opsSliderEl ? parseFloat(opsSliderEl.value) : 7.0;

        if (selectedLayanan.length === 0) return window.alert("Pilih minimal 1 Layanan!", "warning");
        if (tarif < 3000) return window.alert("Tarif minimal adalah Rp 3.000", "warning");

        isSaving = true;
        btnSave.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> MENYIMPAN...';
        btnSave.classList.add('opacity-80', 'cursor-not-allowed');
        kunciSemuaSmartFields(); 

        try {
            // TAHAP 3: MENYIMPAN PENGATURAN OPERASIONAL MURNI KE LOCAL STORAGE (0 FIRESTORE WRITE)
            const newSettings = {
                layanan: selectedLayanan,
                tarif: tarif,
                radius: radius,
                info: info
            };
            localStorage.setItem('bgt_ops_settings', JSON.stringify(newSettings));
            
            // SINKRONISASI SARAF: Update RAM secara real-time untuk payload GPS berikutnya
            window.__BGT_ACTIVE_SERVICES = selectedLayanan.join(',').toUpperCase();
            window.__BGT_MIN_TARIF = parseInt(tarif);
            window.__BGT_AGENDA_INFO = info;
            
            btnSave.classList.remove('opacity-80', 'cursor-not-allowed');
            btnSave.classList.add('btn-state-success');
            btnSave.innerHTML = '<i class="fa-solid fa-check"></i> TERSIMPAN ✓';
        } catch (err) {
            window.alert("Gagal sinkronisasi: " + err.message, "error");
            btnSave.classList.remove('opacity-80', 'cursor-not-allowed');
            btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> SIMPAN PENGATURAN';
        } finally {
            setTimeout(() => {
                if(btnSave.classList.contains('btn-state-success')) {
                    btnSave.classList.remove('btn-state-success');
                    btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> SIMPAN PENGATURAN';
                }
                isSaving = false;
            }, 2000);
        }
    });
}

let isSavingProfile = false;
const btnSaveProfile = document.getElementById('btn-save-profile');
if(btnSaveProfile) {
    btnSaveProfile.addEventListener('click', async () => {
        if (!auth.currentUser || isSavingProfile) return;
        
        const elKendaraan = document.getElementById('lock-kendaraan');
        const elPlat = document.getElementById('lock-plat');
        const elWa = document.getElementById('lock-wa');
        
        const kendaraan = elKendaraan ? elKendaraan.value.trim() : "";
        const plat = elPlat ? elPlat.value.trim().toUpperCase() : "";
        const wa = elWa ? elWa.value.trim() : "";

        if (!kendaraan || !plat || !wa) return window.alert("Kendaraan, Plat Nomor, dan WA tidak boleh kosong!", "warning");

        isSavingProfile = true;
        btnSaveProfile.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> MENYIMPAN...';
        btnSaveProfile.classList.add('opacity-80', 'cursor-not-allowed');
        kunciSemuaSmartFields(); 

        try {
            // PERBAIKAN ZERO-SOCKET: Menggunakan REST API murni (tanpa SDK Firestore)
            const token = await auth.currentUser.getIdToken();
            const projectId = "bagantara-core";
            
            // Masking URL untuk mencegah penulisan ulang data lain di dalam objek 'profile'
            const updateMasks = "updateMask.fieldPaths=profile.kendaraan&updateMask.fieldPaths=profile.plat&updateMask.fieldPaths=profile.wa";
            const firestoreRestUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/drivers/${auth.currentUser.uid}?${updateMasks}`;

            const payload = {
                fields: {
                    profile: {
                        mapValue: {
                            fields: {
                                kendaraan: { stringValue: kendaraan },
                                plat: { stringValue: plat },
                                wa: { stringValue: wa }
                            }
                        }
                    }
                }
            };

            const response = await fetch(firestoreRestUrl, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`Server menolak akses. Status: ${response.status}`);

            btnSaveProfile.classList.remove('opacity-80', 'cursor-not-allowed');
            btnSaveProfile.classList.add('btn-state-success');
            btnSaveProfile.innerHTML = '<i class="fa-solid fa-check"></i> PROFIL TERSIMPAN ✓';
        } catch (err) {
            window.alert("Gagal sinkronisasi profil: " + err.message, "error");
            btnSaveProfile.classList.remove('opacity-80', 'cursor-not-allowed');
            btnSaveProfile.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> SIMPAN PROFIL';
        } finally {
            setTimeout(() => {
                if(btnSaveProfile.classList.contains('btn-state-success')) {
                    btnSaveProfile.classList.remove('btn-state-success');
                    btnSaveProfile.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> SIMPAN PROFIL';
                }
                isSavingProfile = false;
            }, 2000);
        }
    });
}

const btnBukaChat = document.getElementById('btn-buka-chat');
if (btnBukaChat) {
    btnBukaChat.addEventListener('click', async () => {
        try {
            const radarModule = await import('../../chat/radar-tiket.js');
            if (radarModule.periksaPintuMasuk()) {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.replace('text-theme-gold', 'text-gray-500'));
                btnBukaChat.classList.replace('text-gray-500', 'text-theme-gold');
                document.querySelectorAll('.panel-overlay').forEach(p => p.classList.add('hidden-state'));
            }
        } catch (err) { window.alert("Sistem Komunikasi (Radar) luring.", "info"); }
    });
}