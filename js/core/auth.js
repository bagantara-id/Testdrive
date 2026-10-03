// ==========================================================================
// FILE: js/core/auth.js
// FUNGSI: Otorisasi Google Hibrida, Biometrik, & Validasi Server
// ==========================================================================

import { auth, dbFirestore, provider } from './firebase-config.js';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export function switchState(stateName) {
    ['login', 'rejected', 'registration', 'dashboard'].forEach(state => {
        document.getElementById(`state-${state}`).classList.add('hidden-state');
    });
    document.getElementById(`state-${stateName}`).classList.remove('hidden-state');
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

document.getElementById('btnGoogleLogin').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(error => {
        if (error.code === 'auth/popup-blocked') {
            signInWithRedirect(auth, provider);
        } else if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
            window.alert("Otorisasi Gagal: " + error.message, "error");
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
    signOut(auth);
});

document.getElementById('btn-back-login').addEventListener('click', () => {
    signOut(auth).then(() => switchState('login'));
});

document.querySelectorAll('.btn-logout').forEach(btn => {
    btn.addEventListener('click', async () => {
        localStorage.removeItem('bgt_bio_id'); 
        if (currentUser) {
            try {
                const token = await currentUser.getIdToken();
                const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${currentUser.uid}/status.json?auth=${token}`;
                await fetch(dbUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOnline: false, session_id: null }) });
            } catch(e) {}
        }
        signOut(auth);
    });
});

async function jalankanPipelineValidasi(user) {
    currentUser = user;
    const emailKey = user.email.toLowerCase().trim();
    
    try {
        const whitelistSnap = await getDoc(doc(dbFirestore, "whitelist_emails", emailKey));
        if (!whitelistSnap.exists() || whitelistSnap.data().allowed !== true) {
            switchState('rejected');
            return; 
        }

        const profileSnap = await getDoc(doc(dbFirestore, "drivers", user.uid));
        if (!profileSnap.exists()) {
            document.getElementById('reg-email').value = user.email;
            bukaFormRegistrasi();
            return; 
        }

        const data = profileSnap.data();
        if (data.admin_status && data.admin_status.isApproved === true) {
            inisialisasiSesiDriver(user.uid, data);
        } else {
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
        } else {
            jalankanPipelineValidasi(user);
        }
    } else {
        pendingUser = null;
        loginSubtitle.innerText = "DRIVER PORTAL";
        btnBio.classList.add('hidden-state');
        btnForceLogout.classList.add('hidden-state');
        btnGoogle.classList.remove('hidden-state');
        switchState('login');
    }
});

async function inisialisasiSesiDriver(uid, profileData) {
    currentSessionId = "SES_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    localStorage.setItem('bgt_session', currentSessionId);

    try {
        const token = await auth.currentUser.getIdToken();
        const dbUrl = `https://bagantara-core-default-rtdb.asia-southeast1.firebasedatabase.app/drivers/${uid}/status.json?auth=${token}`;
        await fetch(dbUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: currentSessionId }) });
    } catch(e) { console.warn("Gagal set sesi awal:", e); }

    switchState('dashboard');
    window.__BGT_DRIVER_DATA_BUFFER = profileData;
    requestAnimationFrame(() => {
        setTimeout(() => window.dispatchEvent(new CustomEvent('driverDataLoaded', { detail: profileData })), 50);
    });
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
    const payload = { 
        profile: {
            kategori: document.getElementById('reg-kategori').value, 
            nama: document.getElementById('reg-nama').value.trim(), 
            email: currentUser.email, 
            plat: document.getElementById('reg-plat').value.trim().toUpperCase(), 
            wa: document.getElementById('reg-wa').value.trim(), 
            kendaraan: document.getElementById('reg-kendaraan').value.trim(),
            fotoUrl: ""
        },
        agenda_publik: "", admin_status: { isApproved: false, isBanned: false },
        settings: { layanan: document.getElementById('reg-kategori').value === 'Mobil' ? ['Car'] : ['Ride', 'Express'], tarif: 10000, radius: 10, info: "" }
    };

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
