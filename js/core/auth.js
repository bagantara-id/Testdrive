// ==========================================================================
// FILE: js/core/auth.js
// FUNGSI: Otorisasi Google Hibrida, Biometrik, Cache Profil 7 Hari (0 Read Harian), & Isolasi FCM
// ==========================================================================

import { auth, dbFirestore, provider, messaging, getToken, VAPID_KEY } from './firebase-config.js';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

import { mainkanNotifikasiPesanMasuk } from '../../chat/app-chat.js';
import { matikanRadar } from '../../chat/radar-tiket.js';

export const VERIFIED_CACHE_KEY = 'bgt_verified_driver_cache';
export const VERIFIED_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Hari (0 Firestore Read Harian)

export function bacaCacheProfilTerverifikasi(uid, emailKey) {
    try {
        const raw = localStorage.getItem(VERIFIED_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.uid !== uid || parsed.email !== emailKey) return null;
        if (!parsed.timestamp || (Date.now() - parsed.timestamp) >= VERIFIED_CACHE_TTL_MS) {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            return null;
        }
        const data = parsed.profileData;
        if (!data || !data.admin_status || data.admin_status.isApproved !== true || data.admin_status.isBanned === true) {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            return null;
        }
        return data;
    } catch (e) {
        return null;
    }
}

export function simpanCacheProfilTerverifikasi(uid, emailKey, profileData) {
    try {
        if (!uid || !emailKey || !profileData) return;
        const payload = {
            uid: uid,
            email: emailKey,
            profileData: profileData,
            timestamp: Date.now()
        };
        localStorage.setItem(VERIFIED_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {}
}

export function perbaruiCacheProfilTerverifikasi(partialProfile) {
    try {
        const raw = localStorage.getItem(VERIFIED_CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.profileData) return;
        parsed.profileData.profile = {
            ...(parsed.profileData.profile || {}),
            ...partialProfile
        };
        parsed.timestamp = Date.now();
        localStorage.setItem(VERIFIED_CACHE_KEY, JSON.stringify(parsed));
    } catch (e) {}
}

if (localStorage.getItem('bgt_session')) {
    const portalLogin = document.getElementById('state-login');
    if (portalLogin) { portalLogin.style.opacity = '0'; portalLogin.style.pointerEvents = 'none'; }
}

export function switchState(stateName) {
    ['login', 'rejected', 'registration', 'dashboard'].forEach(state => {
        const el = document.getElementById(`state-${state}`);
        if (el) el.classList.add('hidden-state');
    });

    const targetEl = document.getElementById(`state-${stateName}`);
    if (targetEl) {
        targetEl.classList.remove('hidden-state');
        if (stateName === 'login') {
            targetEl.style.opacity = '1';
            targetEl.style.pointerEvents = 'auto';
        }
    }
}

let currentUser = null;
let pendingUser = null;
let currentSessionId = null;

setPersistence(auth, browserLocalPersistence).catch(console.warn);

getRedirectResult(auth).catch((error) => {
    if (error.code !== 'auth/redirect-cancelled-by-user') {
        console.warn("[SISTEM] Error Redirect Fallback:", error.message);
    }
});

async function verifikasiBiometrik() {
    const savedCredId = localStorage.getItem('bgt_bio_id');
    if (!savedCredId || !window.PublicKeyCredential) return true;

    try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        const rawId = Uint8Array.from(atob(savedCredId), c => c.charCodeAt(0));

        await navigator.credentials.get({
            publicKey: { challenge: challenge, allowCredentials: [{ type: "public-key", id: rawId }], userVerification: "required" }
        });
        return true;
    } catch (err) { return false; }
}

provider.setCustomParameters({ prompt: 'select_account' });

document.getElementById('btnGoogleLogin').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const isiAwal = btn.innerHTML;

    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span class="tracking-wide text-[0.9rem]">Membuka Akses...</span>';
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.8';

    signInWithPopup(auth, provider).catch(error => {
        btn.innerHTML = isiAwal;
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';

        if (error.code === 'auth/popup-blocked' || error.code === 'auth/web-storage-unsupported') {
            signInWithRedirect(auth, provider);
        } else if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
            if (typeof window.alert === 'function') window.alert("Otorisasi Gagal: " + error.message, "error");
        }
    });
});

document.getElementById('btnBioLogin').addEventListener('click', async () => {
    if (!pendingUser) return;
    const btn = document.getElementById('btnBioLogin');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-theme-gold"></i> MEMINDAI...';

    const lolos = await verifikasiBiometrik();
    if (lolos) {
        btn.innerHTML = '<i class="fa-solid fa-check text-green-500"></i> BERHASIL';
        jalankanPipelineValidasi(pendingUser);
    } else {
        btn.innerHTML = '<i class="fa-solid fa-fingerprint text-theme-gold text-lg"></i> MASUK DENGAN BIOMETRIK';
        window.alert("Pemindaian biometrik dibatalkan atau tidak dikenali.", "error");
    }
});

document.getElementById('btn-force-logout').addEventListener('click', () => {
    localStorage.removeItem('bgt_bio_id');
    localStorage.removeItem('bgt_session');
    localStorage.removeItem(VERIFIED_CACHE_KEY);
    try { matikanRadar(); } catch (e) {}
    signOut(auth);
});

document.getElementById('btn-back-login').addEventListener('click', () => {
    localStorage.removeItem(VERIFIED_CACHE_KEY);
    signOut(auth).then(() => switchState('login'));
});

document.querySelectorAll('.btn-logout').forEach(btn => {
    btn.addEventListener('click', async () => {
        localStorage.removeItem('bgt_bio_id');
        localStorage.removeItem('bgt_session');
        localStorage.removeItem(VERIFIED_CACHE_KEY);
        try { matikanRadar(); } catch (e) {}
        if (currentUser) {
            try {
                const token = await currentUser.getIdToken();
                const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${currentUser.uid}/status.json?auth=${token}`;
                await fetch(dbUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOnline: false, session_id: null }) });
            } catch (e) {}
        }
        signOut(auth);
    });
});

async function jalankanPipelineValidasi(user, forceNetwork = false) {
    currentUser = user;
    const emailKey = user.email.toLowerCase().trim();

    // MITIGASI KUOTA FIRESTORE (0 READ HARIAN): Gunakan cache lokal jika masih berlaku (< 7 Hari)
    if (!forceNetwork) {
        const cachedData = bacaCacheProfilTerverifikasi(user.uid, emailKey);
        if (cachedData) {
            console.log("[AUTH CACHE] Menggunakan profil terverifikasi dari localStorage (0 Firestore Read).");
            inisialisasiSesiDriver(user.uid, cachedData);
            return;
        }
    }

    try {
        const whitelistSnap = await getDoc(doc(dbFirestore, "whitelist_emails", emailKey));
        if (!whitelistSnap.exists() || whitelistSnap.data().allowed !== true) {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            switchState('rejected');
            return;
        }

        const profileSnap = await getDoc(doc(dbFirestore, "drivers", user.uid));
        if (!profileSnap.exists()) {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            document.getElementById('reg-email').value = user.email;
            bukaFormRegistrasi();
            return;
        }

        const data = profileSnap.data();
        if (data.admin_status && data.admin_status.isApproved === true && data.admin_status.isBanned !== true) {
            simpanCacheProfilTerverifikasi(user.uid, emailKey, data);
            inisialisasiSesiDriver(user.uid, data);
        } else {
            localStorage.removeItem(VERIFIED_CACHE_KEY);
            kunciFormRegistrasi(data);
        }
    } catch (err) {
        window.alert("Gagal memuat data server: " + err.message, "error");
        switchState('rejected');
    }
}

onAuthStateChanged(auth, async (user) => {
    const btnGoogle = document.getElementById('btnGoogleLogin');
    const btnBio = document.getElementById('btnBioLogin');
    const btnForceLogout = document.getElementById('btn-force-logout');
    const loginSubtitle = document.getElementById('login-subtitle');

    if (user && user.email) {
        const requiresBio = !!localStorage.getItem('bgt_bio_id');
        if (requiresBio) {
            pendingUser = user;
            loginSubtitle.innerText = "SESI TERKUNCI";
            btnGoogle.classList.add('hidden-state');
            btnBio.classList.remove('hidden-state');
            btnForceLogout.classList.remove('hidden-state');
            switchState('login');

            if (document.visibilityState === 'visible') {
                setTimeout(() => { btnBio.click(); }, 300);
            }
        } else {
            jalankanPipelineValidasi(user);
        }
    } else {
        pendingUser = null;
        loginSubtitle.innerText = "DRIVER PORTAL";
        btnBio.classList.add('hidden-state');
        btnForceLogout.classList.add('hidden-state');
        btnGoogle.classList.remove('hidden-state');

        const portalLogin = document.getElementById('state-login');
        if (portalLogin) { portalLogin.style.opacity = '1'; portalLogin.style.pointerEvents = 'auto'; }

        switchState('login');
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingUser) {
        const btnBio = document.getElementById('btnBioLogin');
        const portalLogin = document.getElementById('state-login');

        if (portalLogin && !portalLogin.classList.contains('hidden-state') && btnBio && !btnBio.innerHTML.includes('MEMINDAI')) {
            setTimeout(() => { btnBio.click(); }, 150);
        }
    }
});

async function inisialisasiSesiDriver(uid, profileData) {
    currentSessionId = "SES_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    localStorage.setItem('bgt_session', currentSessionId);

    try {
        const token = await auth.currentUser.getIdToken();
        const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${uid}/status.json?auth=${token}`;
        await fetch(dbUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: currentSessionId }) });
    } catch (e) { console.warn("Gagal set sesi awal:", e); }

    switchState('dashboard');
    window.__BGT_DRIVER_DATA_BUFFER = profileData;
    requestAnimationFrame(() => {
        setTimeout(() => window.dispatchEvent(new CustomEvent('driverDataLoaded', { detail: profileData })), 50);
    });
}

// =========================================================================
// SPESIFIKASI 2.2: ISOLASI & DEDUPLIKASI WRITE TOKEN FCM
// =========================================================================
async function prosesEksekusiFCM(uid) {
    const lacak = (stepNum) => {
        window.dispatchEvent(new CustomEvent('fcm-step', { detail: { step: stepNum } }));
    };

    try {
        lacak(1);

        const lokasiSaatIni = window.location.pathname;
        const pathFolder = lokasiSaatIni.substring(0, lokasiSaatIni.lastIndexOf('/'));
        const swPath = pathFolder === '' ? '/service-worker.js' : pathFolder + '/service-worker.js';

        const registerPromise = navigator.serviceWorker.register(swPath);
        const registerTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout Pendaftaran.")), 5000)
        );
        const registration = await Promise.race([registerPromise, registerTimeout]);

        lacak(2);

        const pastikanSwAktif = (reg) => new Promise((resolve, reject) => {
            if (reg.active) return resolve(reg);
            const worker = reg.installing || reg.waiting;
            if (worker) {
                worker.addEventListener('statechange', (e) => {
                    if (e.target.state === 'activated') resolve(reg);
                });
            } else {
                navigator.serviceWorker.ready.then(resolve).catch(reject);
            }
            setTimeout(() => reject(new Error("SW lambat merespons.")), 5000);
        });

        const activeRegistration = await pastikanSwAktif(registration);

        lacak(3);

        const tokenPromise = getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: activeRegistration
        });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout Google.")), 10000)
        );
        const fcmToken = await Promise.race([tokenPromise, timeoutPromise]);

        if (!fcmToken) throw new Error("Token Kosong.");

        const cachedFcmToken = localStorage.getItem('bgt_fcm_token');
        if (cachedFcmToken && cachedFcmToken === fcmToken) {
            lacak(5);
            return;
        }

        lacak(4);

        const authToken = await auth.currentUser.getIdToken();
        const projectId = "bagantara-core";
        const updateMasks = "updateMask.fieldPaths=fcmToken&updateMask.fieldPaths=lastTokenUpdate";
        const firestoreRestUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fcm_tokens/${uid}?${updateMasks}`;

        const payload = {
            fields: {
                fcmToken: { stringValue: fcmToken },
                lastTokenUpdate: { integerValue: Date.now().toString() }
            }
        };

        const response = await fetch(firestoreRestUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        localStorage.setItem('bgt_fcm_token', fcmToken);
        lacak(5);

    } catch (err) {
        console.warn("[FCM BYPASSED] Mengalihkan ke Radar Lokal:", err.message);
        if (typeof window.showToast === 'function') {
            window.showToast("Radar Lokal Aktif (Hemat Daya).", "info");
        }
    }
}

export async function mintaIzinPushNotifikasi(uid) {
    if (!('Notification' in window)) return false;

    if (Notification.permission === 'granted') {
        prosesEksekusiFCM(uid);
        return true;
    } else if (Notification.permission === 'denied') {
        if (window.showToast) window.showToast("Izin Notifikasi diblokir. Harap ubah di pengaturan browser Anda.", "error");
        return false;
    } else {
        if (window.showToast) window.showToast("Ketuk area Peta/Layar untuk menghidupkan Radar Notifikasi.", "info");

        const pemicuKetukan = async () => {
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    if (window.showToast) window.showToast("Mendaftarkan Radar ke Server...", "info");
                    prosesEksekusiFCM(uid);
                } else {
                    if (window.showToast) window.showToast("Izin ditolak, notifikasi pesanan dimatikan.", "warning");
                }
            } catch (err) {
                console.error("Gagal meminta izin:", err);
            }
        };

        document.body.addEventListener('click', pemicuKetukan, { once: true });
        document.body.addEventListener('touchstart', pemicuKetukan, { once: true });
        return false;
    }
}

function bukaFormRegistrasi() {
    switchState('registration');
    const alertBox = document.getElementById('reg-status-alert');
    alertBox.className = "mb-5 p-3 rounded-lg text-[0.8rem] text-center border border-gray-600 text-gray-300 bg-black/20";
    alertBox.innerHTML = "Lengkapi profil Anda. Formulir akan dikunci untuk peninjauan Admin.";

    ['reg-kategori', 'reg-nama', 'reg-plat', 'reg-wa', 'reg-kendaraan'].forEach(id => document.getElementById(id).disabled = false);
    document.getElementById('btn-submit-reg').classList.remove('hidden-state');
}

function kunciFormRegistrasi(data) {
    switchState('registration');
    const alertBox = document.getElementById('reg-status-alert');

    if (data.admin_status && data.admin_status.isBanned === true) {
        alertBox.className = "mb-5 p-3 rounded-lg text-[0.8rem] text-center border font-bold border-red-500 text-red-500 bg-red-500/10";
        alertBox.innerText = "AKUN DITANGGUHKAN. Silakan hubungi Administrator.";
    } else {
        alertBox.className = "mb-5 p-3 rounded-lg text-[0.8rem] text-center border font-bold border-theme-gold text-theme-gold bg-theme-gold/10";
        alertBox.innerText = "MENUNGGU PERSETUJUAN. Data sedang ditinjau Admin.";
    }

    const profil = data.profile || {};
    document.getElementById('reg-kategori').value = profil.kategori || 'Motor';
    document.getElementById('reg-nama').value = profil.nama || '';
    document.getElementById('reg-plat').value = profil.plat || '';
    document.getElementById('reg-wa').value = profil.wa || '';
    document.getElementById('reg-kendaraan').value = profil.kendaraan || '';

    ['reg-kategori', 'reg-nama', 'reg-plat', 'reg-wa', 'reg-kendaraan'].forEach(id => document.getElementById(id).disabled = true);
    document.getElementById('btn-submit-reg').classList.add('hidden-state');
}

document.getElementById('btn-submit-reg').addEventListener('click', async () => {
    if (!currentUser) return;
    const btnSubmit = document.getElementById('btn-submit-reg');
    const armadaPilihan = document.getElementById('reg-kategori').value;

    const payload = {
        profile: {
            kategori: armadaPilihan,
            nama: document.getElementById('reg-nama').value.trim(),
            email: currentUser.email,
            plat: document.getElementById('reg-plat').value.trim().toUpperCase(),
            wa: document.getElementById('reg-wa').value.trim(),
            kendaraan: document.getElementById('reg-kendaraan').value.trim(),
            fotoUrl: ""
        },
        admin_status: { isApproved: false, isBanned: false }
    };

    localStorage.setItem('bgt_driver_kategori', armadaPilihan);
    const defaultLayanan = armadaPilihan === 'Mobil' ? ['CAR'] : ['RIDE', 'EXPRESS'];
    localStorage.setItem('bgt_ops_settings', JSON.stringify({
        layanan: defaultLayanan,
        tarif: 10000,
        radius: 7.0,
        info: ""
    }));

    if (!payload.profile.nama || !payload.profile.plat || !payload.profile.wa || !payload.profile.kendaraan) {
        return window.alert("Seluruh kolom wajib diisi dengan akurat.", "warning");
    }

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';
    try {
        await setDoc(doc(dbFirestore, "drivers", currentUser.uid), payload);
        btnSubmit.innerHTML = '<i class="fa-solid fa-check"></i> Berhasil';
        window.alert("Profil tersimpan. Menunggu persetujuan Admin.", "success");
        setTimeout(() => location.reload(), 2000);
    } catch (err) {
        btnSubmit.disabled = false;
        window.alert("Koneksi gagal: " + err.message, "error");
        btnSubmit.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Profil';
    }
});

export async function toggleBiometrikManual(aktifkan) {
    if (!aktifkan) { localStorage.removeItem('bgt_bio_id'); return false; }
    if (!window.PublicKeyCredential || !currentUser) { window.alert("Perangkat ini tidak mendukung kunci biometrik.", "warning"); return false; }

    try {
        const challenge = new Uint8Array(32); window.crypto.getRandomValues(challenge);
        const userId = new TextEncoder().encode(currentUser.uid);

        const cred = await navigator.credentials.create({
            publicKey: {
                challenge: challenge, rp: { name: "Bagantara Driver" },
                user: { id: userId, name: currentUser.email, displayName: "Driver Bagantara" },
                pubKeyCredParams: [{ type: "public-key", alg: -7 }],
                authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
                timeout: 60000
            }
        });
        localStorage.setItem('bgt_bio_id', btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
        return true;
    } catch (err) {
        window.alert("Registrasi biometrik gagal atau dibatalkan.", "error"); return false;
    }
}

// SINKRONISASI FCM FOREGROUND TANPA BENTROKAN DENGAN LAYAR SERGAP RADAR
if (messaging) {
    onMessage(messaging, (payload) => {
        if (typeof window.bangunkanLayarOLED === 'function') {
            window.bangunkanLayarOLED();
        }
        if (navigator.vibrate) {
            navigator.vibrate([600, 200, 600, 200, 800, 200, 600]);
        }

        const isOrderAlert = payload.data && (payload.data.type === 'NEW_ORDER' || payload.data.idTiket);
        const modalSergap = document.getElementById('bgt-order-intercept-modal');
        const isModalSergapOpen = modalSergap && !modalSergap.classList.contains('hidden-state');

        // Jika bukan order baru (mis. pesan chat biasa) dan modal sergap tidak sedang berbunyi, bunyikan ping chat
        if (!isOrderAlert && !isModalSergapOpen && typeof mainkanNotifikasiPesanMasuk === 'function') {
            mainkanNotifikasiPesanMasuk();
        }

        const judul = payload.notification?.title || payload.data?.title || "🚨 PESANAN BARU!";
        const isi = payload.notification?.body || payload.data?.body || "Silakan cek layar sergap pesanan Anda.";

        if (!isModalSergapOpen && typeof window.showToast === 'function') {
            window.showToast(`${judul} - ${isi}`, "success");
        }
    });
}
