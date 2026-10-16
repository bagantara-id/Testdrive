// ==========================================================================
// FILE: js/modules/dashboard.js
// FUNGSI: Logika Operasional Antarmuka, Smart Fields, & Sinkronisasi Cache Profil 7 Hari
// ==========================================================================

import { auth } from '../core/firebase-config.js';
import { toggleBiometrikManual, perbaruiCacheProfilTerverifikasi } from '../core/auth.js';
import { inisialisasiPeta, segarkanPeta } from './gps-engine.js';
import { inisialisasiInboxChat } from '../../chat/app-chat.js';

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

function sinkronisasiTampilanTokenPeta(statusOverride = null) {
    const savedMapKey = (localStorage.getItem('bgt_maptiler_key') || '').trim();
    const elMapKey = document.getElementById('dash-map-key');
    const elBadge = document.getElementById('map-key-status-badge');

    if (elMapKey) {
        elMapKey.value = savedMapKey;
    }

    if (!elBadge) return;

    if (statusOverride === 'FALLBACK_LIMIT') {
        elBadge.className = 'font-mono font-bold text-[0.6rem] bg-amber-500/15 text-amber-400 border border-amber-500/40 px-2 py-0.5 rounded';
        elBadge.innerText = 'LIMIT -> CADANGAN OSM';
    } else if (savedMapKey) {
        const maskPreview = savedMapKey.length > 8
            ? `${savedMapKey.substring(0, 4)}...${savedMapKey.substring(savedMapKey.length - 3)}`
            : savedMapKey;
        elBadge.className = 'font-mono font-bold text-[0.6rem] bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded';
        elBadge.innerText = `MAPTILER AKTIF (${maskPreview})`;
    } else {
        elBadge.className = 'font-mono font-bold text-[0.6rem] bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded';
        elBadge.innerText = 'DEFAULT: OSM GRATIS';
    }
}

window.addEventListener('map-provider-fallback', () => {
    sinkronisasiTampilanTokenPeta('FALLBACK_LIMIT');
});

export function hydrateUI() {
    const savedKategori = localStorage.getItem('bgt_driver_kategori');
    const isMobil = savedKategori ? (savedKategori === 'Mobil') : (kategoriArmada === 'Mobil');
    const defaultLayanan = isMobil ? ['CAR'] : ['RIDE', 'EXPRESS'];

    const localSettings = JSON.parse(localStorage.getItem('bgt_ops_settings')) || {
        info: '',
        tarif: 10000,
        radius: 7.0,
        layanan: defaultLayanan
    };

    if (savedKategori === 'Mobil' || savedKategori === 'Motor') {
        kategoriArmada = savedKategori;
        window.__BGT_KATEGORI_ARMADA = savedKategori.toUpperCase();
    } else if (localSettings.layanan && localSettings.layanan.some(l => String(l).toUpperCase() === 'CAR')) {
        kategoriArmada = 'Mobil';
        window.__BGT_KATEGORI_ARMADA = 'MOBIL';
    } else {
        kategoriArmada = 'Motor';
        window.__BGT_KATEGORI_ARMADA = 'MOTOR';
    }

    if (kategoriArmada === 'Mobil') {
        localSettings.layanan = ['CAR'];
    } else if (Array.isArray(localSettings.layanan)) {
        localSettings.layanan = localSettings.layanan.filter(l => String(l).toUpperCase() !== 'CAR');
        if (localSettings.layanan.length === 0) localSettings.layanan = ['RIDE'];
    }

    const elInfo = document.getElementById('dash-info');
    if (elInfo) elInfo.value = localSettings.info || '';

    const elTarif = document.getElementById('dash-tarif');
    if (elTarif) elTarif.value = localSettings.tarif || '';

    sinkronisasiTampilanTokenPeta();

    const elOpsRadius = document.getElementById('ops-slider-radius');
    const elOpsRadiusVal = document.getElementById('ops-radius-val');
    if (elOpsRadius && elOpsRadiusVal && localSettings.radius) {
        elOpsRadius.value = localSettings.radius;
        elOpsRadiusVal.innerText = parseFloat(localSettings.radius).toFixed(1) + ' KM';
        window.dispatchEvent(new CustomEvent('update-global-radius', { detail: parseFloat(localSettings.radius) }));
    }

    renderLayananOptions(localSettings.layanan || []);

    window.__BGT_ACTIVE_SERVICES = (localSettings.layanan || []).map(l => String(l).trim().toUpperCase()).join(',');
    window.__BGT_MIN_TARIF = localSettings.tarif ? parseInt(localSettings.tarif) : 10000;
    window.__BGT_AGENDA_INFO = localSettings.info || '';
}

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

        if (target !== 'map-only') {
            const tgtEl = document.getElementById(target);
            if (tgtEl) tgtEl.classList.remove('hidden-state');
            if (target === 'panel-ops') sinkronisasiTampilanTokenPeta();
            if (target === 'panel-inbox') {
                // Tarik daftar inbox_mitra menggunakan REST fetch sekali jalan (0 WebSocket permanen)
                inisialisasiInboxChat();
            }
            kunciSemuaSmartFields();
            floaters.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden-state'); });
        } else {
            floaters.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (id === 'btn-recenter-fisik') {
                    if (window.__BGT_TELEMETRY_CACHE && window.__BGT_TELEMETRY_CACHE.mode === 'standby') {
                        el.classList.remove('hidden-state');
                    }
                } else {
                    el.classList.remove('hidden-state');
                }
            });
        }
    });
});

document.querySelectorAll('.btn-close-panel').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.panel-overlay').forEach(p => p.classList.add('hidden-state'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.replace('text-theme-gold', 'text-gray-500'));
        const mapBtn = document.querySelector('[data-target="map-only"]');
        if (mapBtn) mapBtn.classList.replace('text-gray-500', 'text-theme-gold');

        const floaters = ['btn-telemetry-hud', 'btn-power', 'btn-recenter', 'btn-recenter-fisik'];
        floaters.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (id === 'btn-recenter-fisik') {
                if (window.__BGT_TELEMETRY_CACHE && window.__BGT_TELEMETRY_CACHE.mode === 'standby') {
                    el.classList.remove('hidden-state');
                }
            } else {
                el.classList.remove('hidden-state');
            }
        });
    });
});

window.__BGT_DATA_LOADED = false;

async function muatDataPengemudi(data) {
    if (!data || window.__BGT_DATA_LOADED) return;
    window.__BGT_DATA_LOADED = true;

    const profil = data.profile || {};
    kategoriArmada = profil.kategori || 'Motor';
    localStorage.setItem('bgt_driver_kategori', kategoriArmada);

    const elNama = document.getElementById('lock-nama');
    if (elNama) elNama.innerText = profil.nama || '';

    const elKendaraan = document.getElementById('lock-kendaraan');
    if (elKendaraan) elKendaraan.value = profil.kendaraan || '';

    const elPlat = document.getElementById('lock-plat');
    if (elPlat) elPlat.value = profil.plat || '';

    const elWa = document.getElementById('lock-wa');
    if (elWa) elWa.value = profil.wa || '';

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

    window.__BGT_KATEGORI_ARMADA = kategoriArmada.toUpperCase();

    if (auth.currentUser) {
        try {
            const token = await auth.currentUser.getIdToken();
            const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${auth.currentUser.uid}/status.json?auth=${token}`;
            const res = await fetch(dbUrl);
            const rtdbData = await res.json();

            // Simpan snapshot boot RTDB agar periksaResureksiStatus di gps-engine.js tidak melakukan GET ulang (Hemat 50% Read RTDB saat boot)
            window.__BGT_RTDB_STATUS_BOOT = rtdbData || null;

            if (rtdbData) {
                const sinkronSettings = {
                    info: rtdbData.agenda || "",
                    tarif: rtdbData.tarif_min ? parseInt(rtdbData.tarif_min) : 10000,
                    radius: rtdbData.radius ? parseFloat(rtdbData.radius) : 7.0,
                    layanan: rtdbData.layanan ? rtdbData.layanan.split(',') : (kategoriArmada === 'Mobil' ? ['CAR'] : ['RIDE'])
                };

                localStorage.setItem('bgt_ops_settings', JSON.stringify(sinkronSettings));
            }
        } catch (err) {
            console.warn("Gagal menarik sinkronisasi RTDB, menggunakan cache lokal:", err);
        }
    }

    hydrateUI();

    try {
        // Inisialisasi peta (Radar dbRadar futaqi-ali akan otomatis dinyalakan oleh gps-engine.js hanya saat status Online aktif/standby)
        inisialisasiPeta();
    } catch (err) { console.error("[SISTEM] Gagal inisialisasi peta:", err); }
}

window.addEventListener('driverDataLoaded', (e) => muatDataPengemudi(e.detail));
if (window.__BGT_DRIVER_DATA_BUFFER) muatDataPengemudi(window.__BGT_DRIVER_DATA_BUFFER);

function renderLayananOptions(layananAktif) {
    const container = document.getElementById('layanan-options-container');
    if (!container) return;
    container.innerHTML = '';
    const opsi = kategoriArmada === 'Mobil' ? [{ val: 'Car', label: 'Car (Mobil)' }] : [{ val: 'Ride', label: 'Ride (Motor)' }, { val: 'Jastip', label: 'Jasa Titip' }, { val: 'Express', label: 'Express (Paket)' }];

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
        if (input && btn) {
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
if (btnSave) {
    btnSave.addEventListener('click', async () => {
        if (!auth.currentUser || isSaving) return;

        const selectedLayanan = Array.from(document.querySelectorAll('.chk-layanan:checked')).map(chk => chk.value);
        const elTarif = document.getElementById('dash-tarif');
        const elInfo = document.getElementById('dash-info');

        const tarif = elTarif ? Number(elTarif.value) : 10000;
        const info = elInfo ? elInfo.value.trim().substring(0, 150) : "";
        const opsSliderEl = document.getElementById('ops-slider-radius');
        const radius = opsSliderEl ? parseFloat(opsSliderEl.value) : 7.0;

        if (selectedLayanan.length === 0) return window.alert("Pilih minimal 1 Layanan!", "warning");
        if (tarif < 3000) return window.alert("Tarif minimal adalah Rp 3.000", "warning");

        isSaving = true;
        btnSave.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> MENYIMPAN...';
        btnSave.classList.add('opacity-80', 'cursor-not-allowed');
        kunciSemuaSmartFields();

        try {
            const elMapKey = document.getElementById('dash-map-key');
            const inputKey = elMapKey ? elMapKey.value.trim() : '';
            const savedMapKey = (localStorage.getItem('bgt_maptiler_key') || '').trim();
            let pesanToastPeta = '';
            let tipeToastPeta = 'success';

            if (inputKey === '') {
                localStorage.removeItem('bgt_maptiler_key');
                sinkronisasiTampilanTokenPeta();
                window.dispatchEvent(new CustomEvent('map-key-updated', { detail: { key: '' } }));
                if (savedMapKey !== '') {
                    pesanToastPeta = 'Token dihapus. Peta beralih ke OSM Gratis.';
                }
            } else if (inputKey !== savedMapKey) {
                try {
                    const testRes = await fetch(`https://api.maptiler.com/maps/streets-v2/256/0/0/0.png?key=${encodeURIComponent(inputKey)}`, { cache: 'no-store' });
                    if (testRes.ok && testRes.status === 200) {
                        localStorage.setItem('bgt_maptiler_key', inputKey);
                        sinkronisasiTampilanTokenPeta();
                        window.dispatchEvent(new CustomEvent('map-key-updated', { detail: { key: inputKey } }));
                        const kodeSingkat = inputKey.length > 6 ? `${inputKey.substring(0, 4)}...${inputKey.substring(inputKey.length - 2)}` : inputKey;
                        pesanToastPeta = `Token MapTiler (${kodeSingkat}) aktif & tersimpan!`;
                    } else {
                        sinkronisasiTampilanTokenPeta();
                        tipeToastPeta = 'warning';
                        pesanToastPeta = 'Token MapTiler tidak valid atau kuota habis.';
                    }
                } catch (mapErr) {
                    sinkronisasiTampilanTokenPeta();
                    tipeToastPeta = 'warning';
                    pesanToastPeta = 'Token MapTiler tidak valid atau kuota habis.';
                }
            } else {
                sinkronisasiTampilanTokenPeta();
            }

            const newSettings = {
                layanan: selectedLayanan,
                tarif: tarif,
                radius: radius,
                info: info
            };
            localStorage.setItem('bgt_ops_settings', JSON.stringify(newSettings));

            window.__BGT_ACTIVE_SERVICES = selectedLayanan.join(',').toUpperCase();
            window.__BGT_MIN_TARIF = parseInt(tarif);
            window.__BGT_AGENDA_INFO = info;

            window.dispatchEvent(new CustomEvent('ops-settings-saved', { detail: newSettings }));

            btnSave.classList.remove('opacity-80', 'cursor-not-allowed');
            btnSave.classList.add('btn-state-success');
            btnSave.innerHTML = '<i class="fa-solid fa-check"></i> TERSIMPAN ✓';
            if (window.showToast) {
                if (pesanToastPeta) {
                    window.showToast(pesanToastPeta, tipeToastPeta);
                } else {
                    window.showToast("Pengaturan operasional disimpan.", "success");
                }
            }
        } catch (err) {
            window.alert("Gagal sinkronisasi: " + err.message, "error");
            btnSave.classList.remove('opacity-80', 'cursor-not-allowed');
            btnSave.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> SIMPAN PENGATURAN';
        } finally {
            setTimeout(() => {
                if (btnSave.classList.contains('btn-state-success')) {
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
if (btnSaveProfile) {
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
            const token = await auth.currentUser.getIdToken();
            const projectId = "bagantara-core";

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

            // Sinkronkan juga ke cache profil 7 hari di localStorage
            perbaruiCacheProfilTerverifikasi({ kendaraan: kendaraan, plat: plat, wa: wa });

            btnSaveProfile.classList.remove('opacity-80', 'cursor-not-allowed');
            btnSaveProfile.classList.add('btn-state-success');
            btnSaveProfile.innerHTML = '<i class="fa-solid fa-check"></i> PROFIL TERSIMPAN ✓';
            if (window.showToast) window.showToast("Profil berhasil diperbarui.", "success");
        } catch (err) {
            window.alert("Gagal sinkronisasi profil: " + err.message, "error");
            btnSaveProfile.classList.remove('opacity-80', 'cursor-not-allowed');
            btnSaveProfile.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> SIMPAN PROFIL';
        } finally {
            setTimeout(() => {
                if (btnSaveProfile.classList.contains('btn-state-success')) {
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
                inisialisasiInboxChat();
            }
        } catch (err) { window.alert("Sistem Komunikasi (Radar) luring.", "info"); }
    });
}
