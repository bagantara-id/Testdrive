// ==========================================================================
// FILE: chat/app-chat.js
// FUNGSI: Mesin Obrolan Real-Time, Parser Omni-Card, & Kendali Sesi Manual
// ARSITEKTUR: Enterprise Grade - Zero Auto-Delete (Manual Control)
// ==========================================================================

import { dbChat } from './config-chat.js';
import { auth } from '../js/core/firebase-config.js'; 
import { ref, push, onChildAdded, onChildChanged, onValue, remove, update, query, limitToLast, get, goOnline as rtdbGoOnline, goOffline as rtdbGoOffline } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Definisi fungsi jaringan secara eksplisit
function goOnline(dbInstance) { try { rtdbGoOnline(dbInstance); } catch(e) {} }
function goOffline(dbInstance) { try { rtdbGoOffline(dbInstance); } catch(e) {} }

const IZINKAN_MEDIA = true; 
const CLOUDINARY_CLOUD_NAME = "wuw7hvjo"; 
const CLOUDINARY_PRESET = "bagantara-chat"; 
const FITUR_MEDIA_AKTIF = true; 

let idRuangObrolanAktif = null;
let pemantauPesan = null;
let perakamAudio = null;
let potonganAudio = [];
let isDOMEventBound = false; 
let isInboxListening = false;
let pemantauPesanUbah = null;
let pemantauInbox = null; 
let intervalRekamanGlobal = null; 

// ==========================================================================
// 1. MESIN INBOX (KOTAK MASUK DRIVER)
// ==========================================================================
export function inisialisasiInboxChat() {
    if (!auth.currentUser) return;
    
    if (pemantauInbox) { 
        pemantauInbox(); 
        pemantauInbox = null; 
    }
    isInboxListening = true;
    
    const referensiInbox = ref(dbChat, `inbox_mitra/${auth.currentUser.uid}`);
    
    setTimeout(() => {
        pemantauInbox = onValue(referensiInbox, (snapshot) => {
            const container = document.getElementById('inbox-list-container');
            const emptyState = document.getElementById('inbox-empty-state');
            const countEl = document.getElementById('inbox-count');
            
            if (!container || !emptyState || !countEl) return;
            
            const cards = container.querySelectorAll('.inbox-card');
            cards.forEach(el => el.remove());
            
            if (!snapshot.exists() || !snapshot.hasChildren()) {
                emptyState.classList.remove('hidden-state');
                countEl.innerText = '0 Sesi';
                return;
            }
            
            let sesiAktif = 0;
            
            snapshot.forEach((childSnap) => {
                const tiket = childSnap.val();
                const idTiket = childSnap.key;
                
                if (!tiket || !tiket.waktu_dibuat) return;
                
                sesiAktif++;
                
                const waktuFormat = new Date(tiket.waktu_update || tiket.waktu_dibuat).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'});
                const nama = tiket.nama_klien || "Klien";
                const inisial = nama.substring(0,1).toUpperCase();
                const pesanTerakhir = tiket.pesan_terakhir || "Memulai percakapan...";
                const layananTag = tiket.layanan === 'RIDE' ? 'inbox-tag-ride' : 'inbox-tag-express';
                
                const cardHTML = `
                    <div class="inbox-card" data-id="${idTiket}">
                        <div class="inbox-avatar">${inisial}</div>
                        <div class="inbox-content">
                            <div class="inbox-header">
                                <span class="inbox-name">${nama} <span class="inbox-tag ${layananTag} ml-1">${tiket.layanan || 'ORDER'}</span></span>
                                <span class="inbox-time">${waktuFormat}</span>
                            </div>
                            <span class="inbox-preview">${pesanTerakhir}</span>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', cardHTML);
            });
            
            if (sesiAktif > 0) {
                emptyState.classList.add('hidden-state');
            } else {
                emptyState.classList.remove('hidden-state');
            }
            
            countEl.innerText = `${sesiAktif} Sesi`;
            
            const newCards = container.querySelectorAll('.inbox-card');
            newCards.forEach(card => {
                card.addEventListener('click', () => {
                    bukaRuangKomunikasi(card.getAttribute('data-id'), card.querySelector('.inbox-name').innerText);
                });
            });
        });
    }, 500); 
}

auth.onAuthStateChanged(user => { if(user) inisialisasiInboxChat(); });

// ==========================================================================
// 2. CONTROLLER RUANG OBROLAN
// ==========================================================================
export function bukaRuangKomunikasi(idTiketMasuk, namaKlien = "Klien") {
    if (!idTiketMasuk) return;
    
    // KILL SWITCH: Matikan notifikasi berdering seketika saat chat dibuka
    hentikanNotifChat();

    idRuangObrolanAktif = idTiketMasuk; 

    const panelChat = document.getElementById('panel-komunikasi-utama');
    const titleChat = document.getElementById('chat-session-title');
    const bodyChat = document.getElementById('chat-body');
    
    if (panelChat && titleChat && bodyChat) {
        titleChat.innerText = namaKlien.split(' ')[0]; 
        bodyChat.innerHTML = '<div style="text-align:center; font-size:0.65rem; color:#64748b; margin:10px 0;">Sesi Privat. Hapus pesan melalui tombol tong sampah.</div>';
        panelChat.classList.remove('hidden-state');
    }

    pasangSarafInteraksi();
    mulaiDengarPesan();
}

function pasangSarafInteraksi() {
    if (isDOMEventBound) return; 
    isDOMEventBound = true;

    const wadahChat = document.getElementById('chat-body');
    const btnBack = document.getElementById('chat-btn-back');   
    const btnHapus = document.getElementById('chat-btn-tutup'); 
    const btnKirim = document.getElementById('chat-btn-send');
    const inputTeks = document.getElementById('chat-teks');
    const btnToggle = document.getElementById('btn-toggle-tools');
    const menuAlat = document.getElementById('menu-alat-ekspansi');
    const btnMic = document.getElementById('tool-audio');
    const btnLokasi = document.getElementById('tool-lokasi');
    const btnKamera = document.getElementById('tool-kamera');
    const btnGaleri = document.getElementById('tool-galeri');
    const inpKamera = document.getElementById('input-kamera');
    const inpGaleri = document.getElementById('input-galeri');

    if (!FITUR_MEDIA_AKTIF) {
        if (btnToggle) btnToggle.style.display = 'none'; 
        if (btnMic) btnMic.style.display = 'none';       
        if (menuAlat) {
            const btnCam = document.getElementById('tool-kamera');
            const btnGal = document.getElementById('tool-galeri');
            if (btnCam) btnCam.style.display = 'none';
            if (btnGal) btnGal.style.display = 'none';
        }
    }

    btnBack.addEventListener('click', akhiriSesiKomunikasi); 

    btnHapus.addEventListener('click', () => {
        if (confirm("PERINGATAN!\n\nApakah Anda yakin ingin menghapus sesi ini? Pesanan akan dihapus dari Inbox Anda secara permanen.")) {
            hapusSesiObrolanMutlak();
        }
    });

    wadahChat.addEventListener('click', async (e) => {
        const btnForensik = e.target.closest('.btn-buka-forensik');
        if (btnForensik) {
            bukaBottomSheetForensik(btnForensik.getAttribute('data-info'), btnForensik.getAttribute('data-log'));
            return; 
        }

        const btnTolak = e.target.closest('.btn-tolak-order');
        const btnTerima = e.target.closest('.btn-terima-order');

        if (btnTolak) {
            if (confirm("Tolak pesanan ini? Sesi akan dihapus dan penumpang akan diberitahu.")) {
                if (idRuangObrolanAktif && auth.currentUser) {
                    const uid = auth.currentUser.uid;
                    const idSesi = idRuangObrolanAktif;
                    
                    push(ref(dbChat, `sesi_komunikasi/${idSesi}/pesan`), {
                        pengirim: "mitra", tipe: "sistem_tolak", konten: "Driver menolak pesanan", waktu: Date.now(), status: "sent"
                    });

                    setTimeout(() => {
                        remove(ref(dbChat, `radar_tiket/${uid}/${idSesi}`)).catch(()=>{});
                        remove(ref(dbChat, `inbox_mitra/${uid}/${idSesi}`)).catch(()=>{});
                        remove(ref(dbChat, `sesi_komunikasi/${idSesi}`)).catch(()=>{});
                    }, 1500);
                }
                akhiriSesiKomunikasi(); 
            }
            return;
        }

        if (btnTerima) {
            const actionArea = btnTerima.closest('.katalog-action-area');
            
            try {
                let noWaKlien = '';
                if (auth.currentUser && idRuangObrolanAktif) {
                    const snapTiket = await get(ref(dbChat, `radar_tiket/${auth.currentUser.uid}/${idRuangObrolanAktif}`));
                    if (snapTiket.exists()) noWaKlien = snapTiket.val().wa_klien || '';
                }
                
                if (auth.currentUser && idRuangObrolanAktif) {
                    const refRadar = ref(dbChat, `radar_tiket/${auth.currentUser.uid}/${idRuangObrolanAktif}`);
                    await update(refRadar, { status: 'ACCEPTED' });
                    setTimeout(() => { remove(refRadar).catch(()=>{}); }, 5000);
                }

                if (actionArea) {
                    actionArea.innerHTML = `
                        <div style="width:100%; display:flex; flex-direction:column; gap:8px;">
                            <div style="background:rgba(16, 185, 129, 0.15); border:1px dashed #10b981; color:#10b981; text-align:center; padding:8px; border-radius:8px; font-weight:bold; font-size:0.75rem; letter-spacing:1px;">
                                <i class="fa-solid fa-check-double"></i> ORDER DIAMBIL
                            </div>
                            ${noWaKlien ? `<a href="https://wa.me/${noWaKlien}" target="_blank" style="background:#10b981; color:#0b101a; text-align:center; padding:10px; border-radius:8px; font-weight:bold; font-size:0.75rem; text-decoration:none; display:flex; justify-content:center; align-items:center; gap:6px; box-shadow:0 4px 10px rgba(16,185,129,0.3); transition:all 0.2s;"><i class="fa-brands fa-whatsapp text-lg"></i> CHAT PENUMPANG</a>` : ''}
                        </div>
                    `;
                }

                const waDriver = actionArea ? actionArea.getAttribute('data-wadriver') : '';
                const pesanTeks = waDriver ? `Pesanan Anda telah saya terima, saya segera meluncur. Hubungi WA saya jika perlu: https://wa.me/${waDriver}` : "Pesanan Anda telah saya terima, saya segera meluncur.";
                await kirimPayloadPesan(pesanTeks, "teks");
                
            } catch (err) {
                if(window.showToast) window.showToast("Gagal menyetujui pesanan", "error");
            }
            return;
        }

        const seleksiTeks = window.getSelection();
        if (seleksiTeks && seleksiTeks.toString().length > 0) return; 

        const triggerImg = e.target.closest('.image-fullscreen-trigger');
        if (triggerImg) bukaLayarPenuhGambar(triggerImg.getAttribute('data-img'));
    });

    btnToggle.addEventListener('click', () => {
        menuAlat.classList.toggle('show-tools');
        btnToggle.style.transform = menuAlat.classList.contains('show-tools') ? 'rotate(45deg)' : 'rotate(0deg)';
    });

    inputTeks.addEventListener('input', () => {
        const nodeMic = document.getElementById('tool-audio');
        if(inputTeks.value.trim() !== '') { nodeMic.classList.add('hidden-state'); btnKirim.classList.remove('hidden-state'); } 
        else { nodeMic.classList.remove('hidden-state'); btnKirim.classList.add('hidden-state'); }
    });

    btnKirim.addEventListener('click', () => {
        if (inputTeks.value.trim() !== '') {
            kirimPayloadPesan(inputTeks.value, "teks");
            inputTeks.value = '';
            document.getElementById('tool-audio').classList.remove('hidden-state'); btnKirim.classList.add('hidden-state');
        }
    });

    btnLokasi.addEventListener('click', () => {
        btnLokasi.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const kordinat = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
                kirimPayloadPesan(kordinat, "lokasi");
                btnLokasi.innerHTML = '<i class="fa-solid fa-location-dot"></i> Lokasi';
                menuAlat.classList.remove('show-tools');
            },
            (err) => {
                if(window.showToast) window.showToast("Akses GPS Ditolak.", "error");
                btnLokasi.innerHTML = '<i class="fa-solid fa-location-dot"></i> Lokasi';
            }, { enableHighAccuracy: true }
        );
    });

    btnKamera.addEventListener('click', () => inpKamera.click());
    btnGaleri.addEventListener('click', () => inpGaleri.click());

    inpKamera.addEventListener('change', (e) => { if (e.target.files.length > 0) ekstrakForensikDanKirim(e.target.files[0], "Kamera Langsung"); menuAlat.classList.remove('show-tools'); });
    inpGaleri.addEventListener('change', (e) => { if (e.target.files.length > 0) ekstrakForensikDanKirim(e.target.files[0], "Galeri Perangkat"); menuAlat.classList.remove('show-tools'); });

    const uiDefault = document.getElementById('ui-chat-default');
    const uiRecording = document.getElementById('ui-chat-recording');
    const btnTrash = document.getElementById('bgt-btn-trash');
    const btnSendRecord = document.getElementById('bgt-btn-send-record');
    const btnPause = document.getElementById('bgt-btn-pause');
    const stateActive = document.getElementById('bgt-state-active');
    const stateLocked = document.getElementById('bgt-state-locked');
    const slideHint = document.getElementById('bgt-slide-hint');
    const lockIndicator = document.getElementById('bgt-lock-indicator');
    const timerText = document.getElementById('teks-timer-record');
    const canvasWave = document.getElementById('bgt-canvas-wave');

    if (uiRecording) uiRecording.classList.remove('hidden-state');

    let isRecording = false;
    let isLocked = false;
    let isPaused = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let streamGlobal = null;
    let idAnimasiCanvas = null;
    let konteksAudio = null;
    let waktuRekaman = 0;
    let timerLongPress = null;

    if (wadahChat && !wadahChat.dataset.instruksiAktif) {
        wadahChat.insertAdjacentHTML('beforeend', `
            <div style="text-align:center; background:rgba(206,171,107,0.1); border:1px dashed #ceab6b; border-radius:8px; padding:10px; margin:10px 0; font-size:0.7rem; color:#ceab6b; font-weight:bold;">
                <i class="fa-solid fa-circle-info"></i> INSTRUKSI REKAMAN SUARA:<br>
                Tahan tombol <i class="fa-solid fa-microphone"></i> untuk merekam.<br>Geser kiri untuk Batal | Geser atas untuk Kunci.
            </div>
        `);
        wadahChat.dataset.instruksiAktif = "true";
        setTimeout(() => wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' }), 100);
    }

    const matikanRekaman = () => {
        if (!isRecording) return;
        isRecording = false;
        if(streamGlobal) streamGlobal.getTracks().forEach(track => track.stop());
        clearInterval(intervalRekamanGlobal);
        cancelAnimationFrame(idAnimasiCanvas);
        if(konteksAudio && konteksAudio.state !== 'closed') konteksAudio.close();

        if (uiRecording) uiRecording.classList.remove('active');
        if (lockIndicator) lockIndicator.classList.remove('show');
        if (uiDefault) uiDefault.style.opacity = '1';
        btnMic.style.transform = 'scale(1)';
    };

    const kirimDataSuara = async (dataBlob) => {
        const idLoading = 'load_audio_' + Date.now();
        const templateLoading = document.getElementById('tpl-chat-loading');
        if (templateLoading && wadahChat) {
            const cloneLoad = templateLoading.content.cloneNode(true);
            cloneLoad.querySelector('.msg-bubble').id = idLoading;
            wadahChat.appendChild(cloneLoad);
            wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' });
        }
        try {
            const url = await unggahMediaKeCloudinary(dataBlob, 'audio');
            if (url) {
                await kirimPayloadPesan(url, "audio");
            }
            const loadEl = document.getElementById(idLoading);
            if (loadEl) loadEl.remove();
        } catch(e) {
            if(window.showToast) window.showToast("Gagal kirim audio.", "error");
            const loadEl = document.getElementById(idLoading);
            if (loadEl) loadEl.remove();
        }
    };

    const mulaiPerekamanUI = async () => {
        if (isRecording) return;
        isRecording = true;
        isLocked = false;
        isPaused = false;
        waktuRekaman = 0;
        
        try {
            streamGlobal = await navigator.mediaDevices.getUserMedia({ audio: true });
            perakamAudio = new MediaRecorder(streamGlobal);
            potonganAudio = [];
            window.batalKirimSuara = false;
            
            if (uiDefault) uiDefault.style.opacity = '0';
            if (uiRecording) uiRecording.classList.add('active');
            if (lockIndicator) lockIndicator.classList.add('show');
            
            if (stateActive) { stateActive.classList.remove('bgt-hidden'); stateActive.style.display = 'flex'; }
            if (stateLocked) stateLocked.classList.add('bgt-hidden');
            if (slideHint) slideHint.style.opacity = '1';
            if (btnSendRecord) btnSendRecord.style.transform = 'scale(0)';
            if (timerText) timerText.innerText = "0:00";

            if (canvasWave) {
                const canvasCtx = canvasWave.getContext('2d');
                konteksAudio = new (window.AudioContext || window.webkitAudioContext)();
                const source = konteksAudio.createMediaStreamSource(streamGlobal);
                const analyser = konteksAudio.createAnalyser();
                analyser.fftSize = 64;
                source.connect(analyser);
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);

                function drawWave() {
                    if (!isRecording || isPaused) return;
                    idAnimasiCanvas = requestAnimationFrame(drawWave);
                    analyser.getByteFrequencyData(dataArray);
                    canvasWave.width = canvasWave.offsetWidth;
                    canvasWave.height = canvasWave.offsetHeight;
                    canvasCtx.clearRect(0, 0, canvasWave.width, canvasWave.height);
                    const barWidth = 3;
                    const gap = 2;
                    let x = 0;
                    for (let i = 0; i < bufferLength; i++) {
                        const barHeight = Math.max(2, (dataArray[i] / 255) * canvasWave.height);
                        const y = (canvasWave.height / 2) - (barHeight / 2);
                        canvasCtx.fillStyle = '#10b981';
                        canvasCtx.beginPath();
                        if(canvasCtx.roundRect) canvasCtx.roundRect(x, y, barWidth, barHeight, 2);
                        else canvasCtx.fillRect(x, y, barWidth, barHeight);
                        canvasCtx.fill();
                        x += barWidth + gap;
                    }
                }
                drawWave();
            }

            perakamAudio.ondataavailable = e => { if (e.data.size > 0) potonganAudio.push(e.data); };
            
            perakamAudio.onstop = () => {
                matikanRekaman();
                if (window.batalKirimSuara) return;
                const blobAudio = new Blob(potonganAudio, { type: 'audio/webm' });
                kirimDataSuara(blobAudio);
            };

            perakamAudio.start();

            intervalRekamanGlobal = setInterval(() => {
                waktuRekaman++;
                const s = waktuRekaman % 60;
                const m = Math.floor(waktuRekaman / 60);
                if (timerText) timerText.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
                if (waktuRekaman >= 60 && perakamAudio.state === "recording") {
                    window.batalKirimSuara = false;
                    perakamAudio.stop();
                }
            }, 1000);

        } catch (err) {
            isRecording = false;
            if (window.showToast) window.showToast("Akses Mikrofon Ditolak", "error");
        }
    };

    const handleTouchStart = (e) => {
        if (isRecording) return;
        e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        
        const nodeMic = document.getElementById('tool-audio');
        if (nodeMic) nodeMic.style.transform = 'scale(1.1)'; 

        timerLongPress = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(50); 
            if (nodeMic) nodeMic.style.transform = 'scale(1.3)'; 
            mulaiPerekamanUI();
        }, 400);
    };

    const handleTouchMove = (e) => {
        const touch = e.touches ? e.touches[0] : e;
        
        if (!isRecording) {
            const geserX = Math.abs(touch.clientX - touchStartX);
            const geserY = Math.abs(touch.clientY - touchStartY);
            if (geserX > 15 || geserY > 15) {
                clearTimeout(timerLongPress);
                const nodeMic = document.getElementById('tool-audio');
                if (nodeMic) nodeMic.style.transform = 'scale(1)';
            }
            return;
        }

        if (isLocked) return;
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;

        if (deltaY < -60) {
            isLocked = true;
            if (lockIndicator) lockIndicator.classList.remove('show');
            if (slideHint) slideHint.style.opacity = '0';
            if (stateActive) stateActive.classList.add('bgt-hidden');
            if (stateLocked) { stateLocked.classList.remove('bgt-hidden'); stateLocked.style.display = 'flex'; }
            if (btnSendRecord) btnSendRecord.style.transform = 'scale(1)';
            return;
        }

        if (deltaX < -50) {
            window.batalKirimSuara = true;
            if (perakamAudio && perakamAudio.state === "recording") perakamAudio.stop();
            return;
        }

        if (deltaX < 0 && deltaX > -50) {
            if (slideHint) slideHint.style.opacity = 1 - (Math.abs(deltaX) / 50);
        }
    };

    const handleTouchEnd = (e) => {
        clearTimeout(timerLongPress);
        
        const nodeMic = document.getElementById('tool-audio');
        if (nodeMic) nodeMic.style.transform = 'scale(1)';
        
        if (!isRecording) return;
        
        if (!isLocked) {
            window.batalKirimSuara = false;
            if (perakamAudio && (perakamAudio.state === "recording" || perakamAudio.state === "paused")) perakamAudio.stop();
        }
    };

    const newBtnMic = btnMic.cloneNode(true);
    btnMic.parentNode.replaceChild(newBtnMic, btnMic);
    const btnMicAktif = newBtnMic;

    btnMicAktif.addEventListener('touchstart', handleTouchStart, { passive: false });
    btnMicAktif.addEventListener('mousedown', handleTouchStart);

    window.DriverChat_handleTouchMove = handleTouchMove;
    window.DriverChat_handleTouchEnd = handleTouchEnd;

    document.addEventListener('touchmove', window.DriverChat_handleTouchMove, { passive: false });
    document.addEventListener('mousemove', window.DriverChat_handleTouchMove);
    document.addEventListener('touchend', window.DriverChat_handleTouchEnd);
    document.addEventListener('mouseup', window.DriverChat_handleTouchEnd);

    if(btnTrash) {
        btnTrash.addEventListener('click', (e) => {
            e.preventDefault();
            if (isRecording) {
                window.batalKirimSuara = true;
                if (perakamAudio && (perakamAudio.state === "recording" || perakamAudio.state === "paused")) perakamAudio.stop();
            }
        });
    }

    if(btnSendRecord) {
        btnSendRecord.addEventListener('click', (e) => {
            e.preventDefault();
            if (isRecording) {
                window.batalKirimSuara = false;
                if (perakamAudio && (perakamAudio.state === "recording" || perakamAudio.state === "paused")) perakamAudio.stop();
            }
        });
    }

    if(btnPause) {
        btnPause.addEventListener('click', (e) => {
            e.preventDefault();
            if (!perakamAudio) return;
            if (isPaused) {
                isPaused = false;
                btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Jeda';
                perakamAudio.resume();
                
                intervalRekamanGlobal = setInterval(() => {
                    waktuRekaman++;
                    const s = waktuRekaman % 60;
                    const m = Math.floor(waktuRekaman / 60);
                    if (timerText) timerText.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
                    if (waktuRekaman >= 60 && perakamAudio.state === "recording") {
                        window.batalKirimSuara = false;
                        perakamAudio.stop();
                    }
                }, 1000);
            } else {
                isPaused = true;
                btnPause.innerHTML = '<i class="fa-solid fa-microphone"></i> Lanjut';
                perakamAudio.pause();
                clearInterval(intervalRekamanGlobal);
            }
        });
    }
    
    const btnSalinLog = document.getElementById('btn-bs-salin');
    if (btnSalinLog) {
        btnSalinLog.addEventListener('click', async (e) => {
            const b64 = e.target.closest('button').getAttribute('data-log');
            if(!b64) return;
            try {
                await navigator.clipboard.writeText(decodeURIComponent(escape(atob(b64))));
                if (window.showToast) window.showToast("Log disalin", "success");
                tutupBottomSheetForensik();
            } catch(err) { if (window.showToast) window.showToast("Gagal menyalin", "error"); }
        });
    }

    document.getElementById('btn-tutup-modal-img').addEventListener('click', tutupLayarPenuhGambar);
    document.getElementById('modal-fullscreen-img').addEventListener('click', (e) => { if(e.target.id === 'modal-fullscreen-img') tutupLayarPenuhGambar(); });
    document.getElementById('bs-backdrop').addEventListener('click', tutupBottomSheetForensik);
}

export function akhiriSesiKomunikasi() {
    idRuangObrolanAktif = null;
    if (typeof pemantauPesan === 'function') { pemantauPesan(); pemantauPesan = null; }
    if (typeof pemantauPesanUbah === 'function') { pemantauPesanUbah(); pemantauPesanUbah = null; }
    
    if (intervalRekamanGlobal) { clearInterval(intervalRekamanGlobal); intervalRekamanGlobal = null; }
    
    if (perakamAudio && (perakamAudio.state === "recording" || perakamAudio.state === "paused")) { 
        perakamAudio.stop(); 
    }

    if (window.DriverChat_handleTouchMove) {
        document.removeEventListener('touchmove', window.DriverChat_handleTouchMove);
        document.removeEventListener('mousemove', window.DriverChat_handleTouchMove);
    }
    if (window.DriverChat_handleTouchEnd) {
        document.removeEventListener('touchend', window.DriverChat_handleTouchEnd);
        document.removeEventListener('mouseup', window.DriverChat_handleTouchEnd);
    }
    
    const panel = document.getElementById('panel-komunikasi-utama');
    if (panel) panel.classList.add('hidden-state');
    
    const indikatorKedip = document.getElementById('chat-notif-dot');
    if (indikatorKedip) indikatorKedip.classList.add('hidden-state');
}

function hapusSesiObrolanMutlak() {
    if (!idRuangObrolanAktif || !auth.currentUser) return;
    const idSesi = idRuangObrolanAktif;
    
    try {
        remove(ref(dbChat, `radar_tiket/${auth.currentUser.uid}/${idSesi}`)); 
        remove(ref(dbChat, `inbox_mitra/${auth.currentUser.uid}/${idSesi}`));
        remove(ref(dbChat, `sesi_komunikasi/${idSesi}`));
        if(window.showToast) window.showToast("Sesi berhasil dihapus.", "success");
    } catch(err) {
        console.error("Gagal menghapus:", err);
    }
    akhiriSesiKomunikasi(); 
}

// ==========================================================================
// 3. PARSER PESAN & OMNI-CARD ENGINE
// ==========================================================================
function renderSmartReplyDriver(teksPesan) {
    let container = document.getElementById('bgt-smart-reply');
    if (!container) {
        const footer = document.querySelector('.chat-footer');
        if(!footer) return;
        footer.insertAdjacentHTML('afterbegin', `<div id="bgt-smart-reply" style="display:flex; gap:8px; overflow-x:auto; margin-bottom:8px; padding-bottom:4px; scrollbar-width:none;"></div>`);
        container = document.getElementById('bgt-smart-reply');
    }
    container.innerHTML = '';
    
    let opsiBalasan = [];
    const teks = teksPesan.toLowerCase();
    
    if (teks.includes('di mana') || teks.includes('dimana') || teks.includes('posisi')) {
        opsiBalasan = [{ label: '📍 Kirim Lokasi', aksi: 'lokasi' }, { label: 'Saya sedang meluncur kak', aksi: 'teks' }];
    } else if (teks.includes('sesuai') || teks.includes('map')) {
        opsiBalasan = [{ label: 'Baik, sesuai aplikasi ya', aksi: 'teks' }, { label: 'Oke siap', aksi: 'teks' }];
    } else if (teks.includes('tunggu') || teks.includes('sebentar')) {
        opsiBalasan = [{ label: 'Oke, saya tunggu', aksi: 'teks' }, { label: 'Siap kak', aksi: 'teks' }];
    } else if (teks === 'p' || teks.includes('halo') || teks.includes('ping')) {
        opsiBalasan = [{ label: 'Halo kak, titik jemput sesuai?', aksi: 'teks' }, { label: 'Iya kak, otw', aksi: 'teks' }];
    }
    
    if (opsiBalasan.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    opsiBalasan.forEach(opt => {
        const btn = document.createElement('button');
        btn.innerText = opt.label;
        btn.style.cssText = "background:rgba(206,171,107,0.1); border:1px solid #ceab6b; color:#ceab6b; padding:6px 12px; border-radius:14px; font-size:0.7rem; font-weight:bold; white-space:nowrap; cursor:pointer;";
        btn.onclick = () => {
            if (opt.aksi === 'lokasi') {
                const btnLokasi = document.getElementById('tool-lokasi');
                if(btnLokasi) btnLokasi.click();
            } else {
                kirimPayloadPesan(opt.label, "teks");
            }
            container.innerHTML = '';
            container.style.display = 'none';
        };
        container.appendChild(btn);
    });
}

function mulaiDengarPesan() {
    // ====================================================================
    // PERBAIKAN ZERO-SOCKET: Bunuh pemantau zombie sebelum membuat yang baru
    // ====================================================================
    if (typeof pemantauPesan === 'function') {
        pemantauPesan(); 
        pemantauPesan = null;
    }
    if (typeof pemantauPesanUbah === 'function') {
        pemantauPesanUbah();
        pemantauPesanUbah = null;
    }

    const referensi = query(ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/pesan`), limitToLast(50));
    const wadahChat = document.getElementById('chat-body');
    
    pemantauPesan = onChildAdded(referensi, (snapshot) => {
        const pesan = snapshot.val();
        
        if (pesan.pengirim === 'klien') {
            mainkanNotifikasiPesanMasuk();
            const indikatorKedip = document.getElementById('chat-notif-dot');
            if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');
            
            if (pesan.tipe === 'teks') {
                renderSmartReplyDriver(pesan.konten);
            }

            if (auth.currentUser && idRuangObrolanAktif) {
                let previewTeks = pesan.tipe === 'teks' ? pesan.konten : (pesan.tipe === 'lokasi' ? '桃 Lokasi Baru' : (pesan.tipe === 'audio' ? '痔 Suara Baru' : (pesan.tipe === 'katalog_order' ? '📜 Mengirim Katalog Order' : '胴 Gambar Baru')));
                update(ref(dbChat, `inbox_mitra/${auth.currentUser.uid}/${idRuangObrolanAktif}`), {
                    pesan_terakhir: previewTeks,
                    waktu_update: Date.now()
                }).catch(()=>{});
            }
        }

        const posisiKelas = pesan.pengirim === 'mitra' ? 'msg-mitra' : 'msg-klien';
        let htmlKonten = '';
        
        if (pesan.tipe === 'teks') htmlKonten = `<p>${pesan.konten}</p>`;
        else if (pesan.tipe === 'katalog_order') {
            try {
                const k = JSON.parse(pesan.konten);
                const formatRp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(k.harga);
                const warnaLayanan = k.layanan === 'RIDE' ? '#3b82f6' : (k.layanan === 'EXPRESS' ? '#f59e0b' : '#10b981');
                
                let mapsUrl = `https://www.google.com/maps/dir/?api=1`;
                if (k.pickup_coord) mapsUrl += `&origin=${k.pickup_coord}`;
                else mapsUrl += `&origin=${encodeURIComponent(k.jemput)}`;

                if (k.dropoff_coord) mapsUrl += `&destination=${k.dropoff_coord}`;
                else mapsUrl += `&destination=${encodeURIComponent(k.tujuan)}`;

                if (k.waypoints) mapsUrl += `&waypoints=${k.waypoints}`;

                const isJastip = k.layanan === 'JASTIP' && k.belanjaan && k.belanjaan.length > 0;
                let htmlJastip = '';
                if (isJastip) {
                    htmlJastip = `<div style="border-top:1px dashed rgba(255,255,255,0.2); margin:8px 0; padding-top:8px;">
                        <span style="font-size:0.6rem; color:#94a3b8; display:block; margin-bottom:4px;">DAFTAR BELANJA:</span>
                        <ul style="margin:0; padding-left:14px; font-size:0.75rem; color:#f8fafc;">
                            ${k.belanjaan.map(i => `<li><b>\${i.qty}x</b> ${i.name} (@ Rp${i.price})</li>`).join('')}
                        </ul>
                    </div>`;
                }

                let htmlCatatan = '';
                if (k.catatan && k.catatan.trim() !== '') {
                    htmlCatatan = `<div style="background:rgba(255,255,255,0.05); border-left:3px solid #94a3b8; padding:8px; border-radius:4px; margin-top:8px;">
                        <span style="font-size:0.65rem; color:#94a3b8; font-weight:bold; display:block; margin-bottom:2px;"><i class="fa-solid fa-comment-dots"></i> CATATAN DRIVER:</span>
                        <span style="font-size:0.75rem; color:#f8fafc; font-style:italic;">"${k.catatan}"</span>
                    </div>`;
                }

                let htmlBadgeTip = '';
                if (k.tip_nominal && k.tip_nominal > 0) {
                    const formatTip = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(k.tip_nominal);
                    htmlBadgeTip = `<div style="margin-top:4px; display:inline-block; background:rgba(212, 175, 55, 0.15); border:1px solid #ceab6b; color:#ceab6b; font-size:0.6rem; font-weight:bold; padding:2px 8px; border-radius:12px;">
                        <i class="fa-solid fa-bolt"></i> Termasuk Tip ${formatTip}
                    </div>`;
                }

                const actionButtons = `
                    <div class="katalog-action-area" data-wadriver="${k.wa_driver || ''}" style="display:flex; gap:8px; margin-top:8px;">
                        <button class="btn-tolak-order" style="flex:1; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); color:#ef4444; padding:10px; border-radius:8px; font-weight:bold; font-size:0.75rem; cursor:pointer; transition:all 0.2s;"><i class="fa-solid fa-xmark"></i> TOLAK</button>
                        <button class="btn-terima-order" style="flex:1; background:#10b981; color:#0b101a; border:none; padding:10px; border-radius:8px; font-weight:bold; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 10px rgba(16,185,129,0.3); transition:all 0.2s;"><i class="fa-solid fa-check"></i> TERIMA</button>
                    </div>
                `;

                htmlKonten = `
                    <div style="background:#0f1624; border:1px solid ${warnaLayanan}; border-radius:12px; padding:12px; width:240px; display:flex; flex-direction:column; gap:6px; box-shadow:0 8px 20px rgba(0,0,0,0.4);">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px;">
                            <span style="font-size:0.65rem; color:${warnaLayanan}; font-weight:900; letter-spacing:1px;"><i class="fa-solid fa-receipt mr-1"></i> ORDER: ${k.layanan}</span>
                            <span style="font-size:0.65rem; color:#94a3b8; font-family:monospace;">${k.jarak} KM</span>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
                            <div style="display:flex; gap:6px;">
                                <i class="fa-solid fa-circle-up" style="color:#10b981; font-size:0.7rem; margin-top:3px;"></i>
                                <span style="font-size:0.75rem; color:#f8fafc; line-height:1.3;"><b>Jemput:</b><br>${k.jemput}</span>
                            </div>
                            <div style="width:2px; height:10px; background:rgba(255,255,255,0.2); margin-left:4px;"></div>
                            <div style="display:flex; gap:6px;">
                                <i class="fa-solid fa-location-dot" style="color:#ef4444; font-size:0.7rem; margin-top:3px;"></i>
                                <span style="font-size:0.75rem; color:#f8fafc; line-height:1.3;"><b>Tujuan:</b><br>${k.tujuan}</span>
                            </div>
                        </div>
                        ${htmlJastip}
                        ${htmlCatatan}
                        <div style="background:rgba(212,175,55,0.1); border:1px dashed #ceab6b; border-radius:6px; padding:8px; text-align:center; margin-top:6px;">
                            <span style="font-size:0.6rem; color:#ceab6b; display:block;">ESTIMASI TARIF</span>
                            <span style="font-size:1.2rem; color:#ceab6b; font-weight:900; font-family:monospace;">${formatRp}</span>
                            ${htmlBadgeTip}
                        </div>
                        <a href="${mapsUrl}" target="_blank" style="background:#2563eb; color:#fff; text-align:center; padding:8px; border-radius:8px; margin-top:4px; font-weight:bold; font-size:0.7rem; text-decoration:none; display:flex; justify-content:center; align-items:center; gap:6px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">
                            <i class="fa-solid fa-diamond-turn-right"></i> CEK PETA NAVIGASI
                        </a>
                        ${actionButtons}
                    </div>
                `;
            } catch(e) { htmlKonten = `<p><i>[Katalog Order Error]</i></p>`; }
        }
        else if (pesan.tipe === 'lokasi') {
            const [lat, lng] = pesan.konten.split(',');
            htmlKonten = `
                <div style="background:#0f1624; border:1px solid #ceab6b; border-radius:12px; padding:12px; width:220px; display:flex; flex-direction:column; gap:10px; box-shadow:0 4px 15px rgba(0,0,0,0.3);">
                    <div style="display:flex; align-items:center; gap:10px; border-bottom:1px solid rgba(206,171,107,0.2); padding-bottom:8px;">
                        <div style="width:36px; height:36px; border-radius:50%; background:rgba(206,171,107,0.1); display:flex; justify-content:center; align-items:center; color:#ceab6b; font-size:1.1rem; flex-shrink:0;">
                            <i class="fa-solid fa-map-pin"></i>
                        </div>
                        <div style="display:flex; flex-direction:column; overflow:hidden;">
                            <span style="font-size:0.75rem; color:#ceab6b; font-weight:bold;">Titik Koordinat</span>
                            <span style="font-size:0.6rem; color:#94a3b8; font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Lat: ${parseFloat(lat).toFixed(5)}</span>
                            <span style="font-size:0.6rem; color:#94a3b8; font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Lng: ${parseFloat(lng).toFixed(5)}</span>
                        </div>
                    </div>
                    <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" style="background:#ceab6b; color:#0b101a; padding:10px; border-radius:8px; text-align:center; font-size:0.8rem; font-weight:bold; text-decoration:none; display:flex; justify-content:center; align-items:center; gap:6px;">
                        <i class="fa-solid fa-diamond-turn-right"></i> BUKA MAPS
                    </a>
                </div>
            `;
        }
        else if (pesan.tipe === 'audio') htmlKonten = `<audio controls src="${pesan.konten}" style="height:32px; width:180px;"></audio>`;
        else if (pesan.tipe === 'gambar') {
            let teksSalin = `SUMBER: ${pesan.forensik?.sumber}\nIP SAAT INI: ${pesan.forensik?.ip}\nNET: ${pesan.forensik?.jaringan}\nRAM/CPU: ${pesan.forensik?.ram_cpu}\nGPS SAAT UPLOAD: ${pesan.forensik?.lokasi}\nOS: ${pesan.forensik?.browser}`;
            if (pesan.forensik?.exif) teksSalin += `\n\n--- METADATA ASLI (GALERI) ---\nKAMERA: ${pesan.forensik.exif.kamera}\nWAKTU DIAMBIL: ${pesan.forensik.exif.waktu_diambil}\nGPS ASLI: ${pesan.forensik.exif.lokasi_asli}`;

            const b64Teks = btoa(unescape(encodeURIComponent(teksSalin)));
            const dataForensikStr = btoa(unescape(encodeURIComponent(JSON.stringify(pesan.forensik || {}))));
            
            htmlKonten = `
                <div class="media-container" style="position:relative; width:200px;">
                    <div class="image-wrapper image-fullscreen-trigger" data-img="${pesan.konten}" style="position:relative; border-radius:6px; overflow:hidden; cursor:pointer; height: 260px;">
                        <img src="${pesan.konten}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; -webkit-touch-callout:none; user-select:none;">
                        <div style="position:absolute; inset:0; z-index:10;" oncontextmenu="return false;"></div>
                    </div>
                    <div class="btn-buka-forensik" data-log="${b64Teks}" data-info="${dataForensikStr}" style="position:absolute; bottom:8px; right:8px; background:rgba(15,22,36,0.8); border:1px solid #ceab6b; color:#ceab6b; width:28px; height:28px; border-radius:50%; display:flex; justify-content:center; align-items:center; z-index:20; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.5); backdrop-filter:blur(4px);">
                        <i class="fa-solid fa-shield-halved" style="font-size:0.75rem; pointer-events:none;"></i>
                    </div>
                </div>`;
        }

        const idUnik = snapshot.key;
        
        if (pesan.pengirim === 'klien' && pesan.status !== 'read') {
            update(ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/pesan/${idUnik}`), { status: 'read' });
        }

        let statusIkon = '';
        if (pesan.pengirim === 'mitra') {
            statusIkon = pesan.status === 'read' 
                ? `<i class="fa-solid fa-check-double" style="color: #3b82f6; font-size: 0.65rem; margin-left: 4px;"></i>` 
                : `<i class="fa-solid fa-check" style="color: #9ca3af; font-size: 0.65rem; margin-left: 4px;"></i>`;
        }

        wadahChat.insertAdjacentHTML('beforeend', `<div id="${idUnik}" class="msg-bubble ${posisiKelas}"><div class="msg-content">${htmlKonten}</div><span class="msg-time" style="display: flex; align-items: center; justify-content: flex-end; margin-top: 2px;">${new Date(pesan.waktu).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'})}${statusIkon}</span></div>`);
        
        clearTimeout(wadahChat.scrollTimer);
        wadahChat.scrollTimer = setTimeout(() => wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' }), 150);
    }); 

    if (pemantauPesanUbah) pemantauPesanUbah();
    pemantauPesanUbah = onChildChanged(referensi, (snapshot) => {
        const pesanUbah = snapshot.val();
        if (pesanUbah.pengirim === 'mitra' && pesanUbah.status === 'read') {
            const elemenPesan = document.getElementById(snapshot.key);
            if (elemenPesan) {
                const timeSpan = elemenPesan.querySelector('.msg-time');
                if (timeSpan) {
                    timeSpan.innerHTML = `${new Date(pesanUbah.waktu).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'})} <i class="fa-solid fa-check-double" style="color: #3b82f6; font-size: 0.65rem; margin-left: 4px;"></i>`;
                }
            }
        }
    });
}

// ==========================================================================
// 4. MESIN PENGIRIM PESAN & MEDIA
// ==========================================================================
async function kirimPayloadPesan(kontenPesan, tipePesan = "teks", metadataForensik = null) {
    if (!idRuangObrolanAktif || idRuangObrolanAktif.trim() === "" || !kontenPesan) return;
    
    try {
        const referensi = ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/pesan`);
        const payload = { pengirim: "mitra", tipe: tipePesan, konten: kontenPesan, waktu: Date.now(), status: "sent" };
        if (metadataForensik) payload.forensik = metadataForensik;
        await push(referensi, payload);

        if (auth.currentUser) {
            let previewTeks = tipePesan === 'teks' ? kontenPesan : (tipePesan === 'lokasi' ? '桃 Mengirim Lokasi' : (tipePesan === 'audio' ? '痔 Pesan Suara' : '胴 Mengirim Gambar'));
            await update(ref(dbChat, `inbox_mitra/${auth.currentUser.uid}/${idRuangObrolanAktif}`), {
                pesan_terakhir: "Anda: " + previewTeks,
                waktu_update: Date.now()
            });
        }
    } catch(err) { console.error("Gagal kirim pesan:", err); }
}

// ==========================================================================
// NEW: WEB AUDIO API SYNTHESIZER (PENGGANTI RINGTONE URL)
// ==========================================================================
let audioCtxChat = null;
let chatAlarmInterval = null;
let isChatAlarmPlaying = false;

// Fungsi Global Kill Switch: Mati seketika saat dipanggil
export function hentikanNotifChat() {
    if (chatAlarmInterval) { clearInterval(chatAlarmInterval); chatAlarmInterval = null; }
    isChatAlarmPlaying = false;
}

// Mengikat Kill Switch ke seluruh ketukan layar
document.addEventListener('click', hentikanNotifChat, { passive: true });
document.addEventListener('touchstart', hentikanNotifChat, { passive: true });

export function mainkanNotifikasiPesanMasuk() {
    if (isChatAlarmPlaying) return; 
    
    if (!audioCtxChat) { audioCtxChat = new (window.AudioContext || window.webkitAudioContext)(); }
    if (audioCtxChat.state === 'suspended') audioCtxChat.resume();
    
    isChatAlarmPlaying = true;
    
    // Desain Suara: Dentingan Sonar Futuristik yang Elegan (G6 ke G7)
    const playPing = () => {
        if (!isChatAlarmPlaying) return;
        const osc = audioCtxChat.createOscillator();
        const gain = audioCtxChat.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1567.98, audioCtxChat.currentTime); 
        osc.frequency.exponentialRampToValueAtTime(3135.96, audioCtxChat.currentTime + 0.1); 
        
        // Membentuk amplop volume agar tidak pecah (Attack cepat, Decay halus)
        gain.gain.setValueAtTime(0, audioCtxChat.currentTime);
        gain.gain.linearRampToValueAtTime(1, audioCtxChat.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtxChat.currentTime + 0.5);
        
        osc.connect(gain);
        gain.connect(audioCtxChat.destination);
        
        osc.start(audioCtxChat.currentTime);
        osc.stop(audioCtxChat.currentTime + 0.5);
    };

    playPing(); // Bunyikan tarikan pertama
    // Mengulang ping setiap 3 detik hingga pengemudi menyentuh layar / buka chat
    chatAlarmInterval = setInterval(playPing, 3000); 
}

async function unggahMediaKeCloudinary(fileBiner, jenisMedia) {
    const formData = new FormData();
    formData.append('file', fileBiner);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    const tipe = jenisMedia === 'audio' ? 'video' : 'image';
    const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${tipe}/upload`;

    try {
        const respon = await fetch(endpoint, { method: 'POST', body: formData });
        const data = await respon.json();
        if (!respon.ok) throw new Error(data.error?.message || "Ditolak Cloudinary");
        return data.secure_url; 
    } catch (error) { throw error; }
}

function dapatkanKunciLokasiForensik() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) resolve("GPS_TIDAK_DIDUKUNG");
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve(`https://www.google.com/maps/search/?api=1&query=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`),
            (err) => resolve("AKSES_GPS_DITOLAK"),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 } 
        );
    });
}

async function ekstrakForensikDanKirim(fileGambar, asalTangkapan) {
    if(window.showToast) window.showToast("Mengekstrak Metadata...", "info");
    
    const idLoading = 'load_img_' + Date.now();
    const wadahChat = document.getElementById('chat-body');
    const templateLoading = document.getElementById('tpl-chat-loading');
    if (templateLoading && wadahChat) {
        const cloneLoad = templateLoading.content.cloneNode(true);
        cloneLoad.querySelector('.msg-bubble').id = idLoading;
        wadahChat.appendChild(cloneLoad);
        wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' });
    }

    let ipPublik = "Gagal memuat";
    try { const res = await fetch('https://api.ipify.org?format=json'); const d = await res.json(); ipPublik = d.ip; } catch(e){}
    
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const infoJaringan = conn ? `${conn.effectiveType || 'N/A'} (${conn.downlink || 0}Mbps)` : "N/A";
    const ram = navigator.deviceMemory ? `${navigator.deviceMemory}GB+` : "N/A";
    const cpu = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} Core` : "N/A";
    const lokasiFaktual = await dapatkanKunciLokasiForensik();
    
    let dataExifAsli = null;
    if (asalTangkapan === "Galeri Perangkat") {
        try {
            const exifr = await import('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.js');
            const exifData = await exifr.default.parse(fileGambar);
            if (exifData) {
                let linkPetaExif = "Tidak tersimpan di gambar";
                if (exifData.latitude && exifData.longitude) linkPetaExif = `https://www.google.com/maps/search/?api=1&query=${exifData.latitude.toFixed(6)},${exifData.longitude.toFixed(6)}`;
                dataExifAsli = {
                    kamera: (exifData.Make || exifData.Model) ? `${exifData.Make || ''} ${exifData.Model || ''}`.trim() : "Tidak diketahui",
                    waktu_diambil: exifData.DateTimeOriginal ? new Date(exifData.DateTimeOriginal).toLocaleString('id-ID') : "Tidak diketahui",
                    lokasi_asli: linkPetaExif
                };
            }
        } catch(e) {}
    }

    const dataForensik = { sumber: asalTangkapan, ip: ipPublik, jaringan: infoJaringan, ram_cpu: `${ram} / ${cpu}`, lokasi: lokasiFaktual, browser: navigator.userAgent.substring(0, 50) + "..." };
    if (dataExifAsli) dataForensik.exif = dataExifAsli;

    try {
        const urlGambar = await unggahMediaKeCloudinary(fileGambar, 'image');
        await kirimPayloadPesan(urlGambar, "gambar", dataForensik);
        const loadEl = document.getElementById(idLoading);
        if (loadEl) loadEl.remove();
    } catch (e) {
        if (window.showToast) window.showToast("Gagal Unggah: " + e.message, "error");
        const loadEl = document.getElementById(idLoading);
        if (loadEl) loadEl.remove();
    }
}

// ==========================================================================
// 5. DOM MODAL FORENSIK & GAMBAR LAYAR PENUH
// ==========================================================================
function bukaLayarPenuhGambar(urlGambar) {
    const modal = document.getElementById('modal-fullscreen-img');
    const targetImg = document.getElementById('fullscreen-img-target');
    if(modal && targetImg) {
        targetImg.src = urlGambar;
        modal.classList.remove('hidden-state');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
    }
}

function tutupLayarPenuhGambar() {
    const modal = document.getElementById('modal-fullscreen-img');
    if(modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => { modal.classList.add('hidden-state'); document.getElementById('fullscreen-img-target').src = ''; }, 300);
    }
}

function bukaBottomSheetForensik(b64Info, b64Log) {
    const sheetEl = document.getElementById('bottom-sheet-forensik');
    const contentEl = document.getElementById('bs-content');
    if (!sheetEl || !contentEl) return;

    const info = JSON.parse(decodeURIComponent(escape(atob(b64Info))));
    
    document.getElementById('fs-sumber').innerText = info.sumber || '-';
    document.getElementById('fs-ip').innerText = info.ip || '-';
    document.getElementById('fs-hardware').innerText = info.ram_cpu || '-';
    document.getElementById('fs-lokasi').href = info.lokasi;
    
    const exifContainer = document.getElementById('fs-exif-container');
    if (info.exif) {
        exifContainer.classList.remove('hidden-state');
        document.getElementById('fs-exif-kamera').innerText = info.exif.kamera;
        document.getElementById('fs-exif-waktu').innerText = info.exif.waktu_diambil;
        document.getElementById('fs-exif-gps').innerHTML = info.exif.lokasi_asli.startsWith('http') ? `<a href="${info.exif.lokasi_asli}" target="_blank" class="text-[#ceab6b] underline font-bold"><i class="fa-solid fa-map-pin"></i> Buka Peta Asli</a>` : `<b>${info.exif.lokasi_asli}</b>`;
    } else {
        exifContainer.classList.add('hidden-state');
    }

    document.getElementById('btn-bs-salin').setAttribute('data-log', b64Log);

    sheetEl.classList.remove('hidden-state');
    requestAnimationFrame(() => {
        sheetEl.classList.remove('opacity-0');
        contentEl.classList.remove('translate-y-full');
    });
}

function tutupBottomSheetForensik() {
    const sheetEl = document.getElementById('bottom-sheet-forensik');
    const contentEl = document.getElementById('bs-content');
    if(sheetEl && contentEl) {
        contentEl.classList.add('translate-y-full');
        sheetEl.classList.add('opacity-0');
        setTimeout(() => sheetEl.classList.add('hidden-state'), 300);
    }
}

// ==========================================================================
// 6. MANAJEMEN KONEKSI CERDAS
// ==========================================================================
let timerPemutusKoneksi = null;
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'hidden') {
        timerPemutusKoneksi = setTimeout(() => { 
            const modeDriver = window.__BGT_TELEMETRY_CACHE ? window.__BGT_TELEMETRY_CACHE.mode : 'offline';
            if (modeDriver === 'offline' || modeDriver === 'persiapan') {
                goOffline(dbChat); 
            } else {
                // Pengaman String() untuk mencegah error toUpperCase jika modeDriver belum siap
                console.log(`[SISTEM] PWA disembunyikan. Koneksi dipertahankan (Mode: ${String(modeDriver).toUpperCase()})`);
            }
        }, 10000);
    } else {
        clearTimeout(timerPemutusKoneksi);
        goOnline(dbChat);
    }
});