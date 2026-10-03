// ==========================================================================
// FILE: js/modules/dashboard.js
// FUNGSI: Logika Operasional Antarmuka & Smart Fields (Bebas Radius)
// ==========================================================================

import { auth, dbFirestore } from '../core/firebase-config.js';
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
document.addEventListener('DOMContentLoaded', inisialisasiTemaOtomatis);

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
        if(target !== 'map-only') {
            const tgtEl = document.getElementById(target);
            if(tgtEl) tgtEl.classList.remove('hidden-state');
            kunciSemuaSmartFields(); 
        }
    });
});

document.querySelectorAll('.btn-close-panel').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.panel-overlay').forEach(p => p.classList.add('hidden-state'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.replace('text-theme-gold', 'text-gray-500'));
        const mapBtn = document.querySelector('[data-target="map-only"]');
        if(mapBtn) mapBtn.classList.replace('text-gray-500', 'text-theme-gold');
    });
});

window.__BGT_DATA_LOADED = false; 

function muatDataPengemudi(data) {
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

    // PEMBERSIHAN RADIUS: dash-radius dihapus dari logika parser
    if (data.settings) {
        const elInfo = document.getElementById('dash-info');
        if(elInfo) elInfo.value = data.settings.info || '';
        
        const elTarif = document.getElementById('dash-tarif');
        if(elTarif) elTarif.value = data.settings.tarif || '';
        
        renderLayananOptions(data.settings.layanan || []);
    }

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
        
    opsi.forEach(item => {
        const isChecked = layananAktif.includes(item.val) ? 'checked' : '';
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

        if (selectedLayanan.length === 0) return window.alert("Pilih minimal 1 Layanan!", "warning");
        if (tarif < 3000) return window.alert("Tarif minimal adalah Rp 3.000", "warning");

        isSaving = true;
        btnSave.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> MENYIMPAN...';
        btnSave.classList.add('opacity-80', 'cursor-not-allowed');
        kunciSemuaSmartFields(); 

        try {
            // PEMBERSIHAN RADIUS: Payload Firestore hanya mengirim 3 Data murni
            await updateDoc(doc(dbFirestore, "drivers", auth.currentUser.uid), { 
                "settings.layanan": selectedLayanan, 
                "settings.tarif": tarif, 
                "settings.info": info 
            });
            
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
            await updateDoc(doc(dbFirestore, "drivers", auth.currentUser.uid), { "profile.kendaraan": kendaraan, "profile.plat": plat, "profile.wa": wa });
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
