// ==========================================================================
// FILE: js/utils/ui-components.js
// FUNGSI: Pengendali Kinetik UI (Micro-HUD Avionik & Sistem Modal Glassmorphism)
// ==========================================================================

let toastTimeout = null;
let toastFoldTimeout = null;
let activeModalResolver = null;

function tutupModalDOM() {
    const modal = document.getElementById('app-modal');
    const boxEl = document.getElementById('app-modal-box');
    const btnCancel = document.getElementById('btn-cancel-modal');
    if (modal && boxEl) {
        modal.classList.add('opacity-0');
        boxEl.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden-state');
            if (btnCancel) btnCancel.classList.add('hidden-state');
        }, 300);
    }
}

window.showToast = function(message, type = 'info') {
    const toast = document.getElementById('micro-hud-toast');
    const iconWrap = document.getElementById('hud-toast-icon-wrap');
    const icon = document.getElementById('hud-toast-icon');
    const textWrap = document.getElementById('hud-toast-text-wrap');
    const msgEl = document.getElementById('hud-toast-msg');

    if (!toast || !iconWrap || !icon || !textWrap || !msgEl) return;

    // 1. Reset Animasi Sebelumnya (Mencegah Glitch Beruntun)
    clearTimeout(toastTimeout);
    clearTimeout(toastFoldTimeout);

    // 2. Konfigurasi Tema Avionik (Glassmorphism & Glow)
    let themeColor, iconClass, borderColor, glowColor;

    if (type === 'success') {
        themeColor = 'text-emerald-400';
        borderColor = 'border-emerald-500/40';
        glowColor = 'rgba(16, 185, 129, 0.5)';
        iconClass = 'fa-shield-check';
    } else if (type === 'error') {
        themeColor = 'text-red-400';
        borderColor = 'border-red-500/40';
        glowColor = 'rgba(239, 68, 68, 0.5)';
        iconClass = 'fa-triangle-exclamation';
    } else if (type === 'warning') {
        themeColor = 'text-amber-400';
        borderColor = 'border-amber-500/40';
        glowColor = 'rgba(245, 158, 11, 0.5)';
        iconClass = 'fa-circle-exclamation';
    } else {
        themeColor = 'text-theme-gold';
        borderColor = 'border-theme-gold/40';
        glowColor = 'rgba(197, 168, 128, 0.5)';
        iconClass = 'fa-satellite-dish';
    }

    // 3. Terapkan Gaya Dinamis (Warna & Border Kaca)
    iconWrap.className = `w-8 h-8 rounded-full bg-[#0a0a0a]/95 backdrop-blur-md border ${borderColor} flex items-center justify-center z-10 relative transition-colors duration-300`;
    iconWrap.style.boxShadow = `0 0 12px ${glowColor}`;
    icon.className = `fa-solid ${iconClass} ${themeColor} text-[0.7rem]`;

    textWrap.className = `bg-[#0a0a0a]/85 backdrop-blur-md border-y border-r ${borderColor} rounded-r-md overflow-hidden flex items-center transition-all duration-500 ease-out`;
    msgEl.className = `text-[0.6rem] font-bold uppercase tracking-widest whitespace-nowrap px-3 py-1.5 ${themeColor} drop-shadow-md`;
    msgEl.innerText = message;

    // 4. Mekanisme Kinetik: Muncul & Melebar (Expand)
    toast.classList.remove('opacity-0');
    toast.style.transform = 'translateX(0)';

    requestAnimationFrame(() => {
        setTimeout(() => {
            textWrap.style.maxWidth = '300px';
            textWrap.style.paddingLeft = '16px';
        }, 50);
    });

    // 5. Mekanisme Kinetik: Auto-Close & Melipat (Collapse) dalam 3 Detik
    toastTimeout = setTimeout(() => {
        textWrap.style.maxWidth = '0px';
        textWrap.style.paddingLeft = '12px';

        toastFoldTimeout = setTimeout(() => {
            toast.classList.add('opacity-0');
            toast.style.transform = 'translateX(-20px)';
        }, 400);
    }, 3000);
};

// Pengendali Modal Statis Satu Tombol
window.showModal = function(title, message, iconClass = 'fa-circle-info text-theme-gold', isError = false) {
    const modal = document.getElementById('app-modal');
    const titleEl = document.getElementById('app-modal-title');
    const msgEl = document.getElementById('app-modal-msg');
    const iconEl = document.getElementById('app-modal-icon');
    const boxEl = document.getElementById('app-modal-box');
    const btnClose = document.getElementById('btn-close-modal');
    const btnCancel = document.getElementById('btn-cancel-modal');

    if (!modal || !titleEl || !msgEl || !iconEl || !boxEl || !btnClose) return;

    if (activeModalResolver) {
        activeModalResolver(false);
        activeModalResolver = null;
    }

    if (btnCancel) btnCancel.classList.add('hidden-state');
    btnClose.innerText = 'Mengerti';

    titleEl.innerText = title;
    msgEl.innerText = message;
    iconEl.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;

    if (isError) {
        titleEl.className = 'font-bold text-lg mb-2 text-red-400 font-display';
        iconEl.className = 'text-4xl mb-3 text-red-500';
        btnClose.className = 'bg-red-500/20 text-red-500 border border-red-500/50 rounded-xl py-3.5 px-5 font-semibold uppercase tracking-wider flex-1 w-full text-sm cursor-pointer transition-all';
    } else {
        titleEl.className = 'font-bold text-lg mb-2 text-white font-display';
        iconEl.className = 'text-4xl mb-3 text-theme-gold';
        btnClose.className = 'btn-primary flex-1 w-full text-sm cursor-pointer';
    }

    modal.classList.remove('hidden-state');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        boxEl.classList.remove('scale-95');
    });
};

// SPESIFIKASI 4.1: Sistem Konfirmasi Asinkron Glassmorphism (Zero Native Confirm)
window.showConfirm = function(title, message, confirmText = 'Ya, Lanjutkan', isDanger = true) {
    return new Promise((resolve) => {
        const modal = document.getElementById('app-modal');
        const titleEl = document.getElementById('app-modal-title');
        const msgEl = document.getElementById('app-modal-msg');
        const iconEl = document.getElementById('app-modal-icon');
        const boxEl = document.getElementById('app-modal-box');
        const btnClose = document.getElementById('btn-close-modal');
        const btnCancel = document.getElementById('btn-cancel-modal');

        if (!modal || !titleEl || !msgEl || !iconEl || !boxEl || !btnClose || !btnCancel) {
            resolve(false);
            return;
        }

        if (activeModalResolver) {
            activeModalResolver(false);
        }
        activeModalResolver = resolve;

        titleEl.innerText = title || 'KONFIRMASI';
        msgEl.innerText = message || '';
        btnClose.innerText = confirmText;
        btnCancel.innerText = 'Batal';
        btnCancel.classList.remove('hidden-state');

        if (isDanger) {
            titleEl.className = 'font-bold text-lg mb-2 text-red-400 font-display';
            iconEl.className = 'text-4xl mb-3 text-red-500';
            iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            btnClose.className = 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 rounded-xl py-3.5 px-4 font-bold uppercase tracking-wider flex-1 text-xs cursor-pointer transition-all';
        } else {
            titleEl.className = 'font-bold text-lg mb-2 text-white font-display';
            iconEl.className = 'text-4xl mb-3 text-theme-gold';
            iconEl.innerHTML = '<i class="fa-solid fa-circle-question"></i>';
            btnClose.className = 'btn-primary flex-1 text-xs cursor-pointer';
        }

        modal.classList.remove('hidden-state');
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            boxEl.classList.remove('scale-95');
        });
    });
};

// SPESIFIKASI 4.1: Override Global window.alert (Zero Native Alert)
window.alert = function(message, type = 'info') {
    const cleanMsg = String(message || '').replace(/\n+/g, ' — ');
    if (typeof window.showToast === 'function' && document.getElementById('micro-hud-toast')) {
        window.showToast(cleanMsg, type);
    } else if (typeof window.showModal === 'function') {
        const isErr = (type === 'error' || type === 'warning');
        const icon = isErr ? 'fa-triangle-exclamation text-red-500' : 'fa-circle-info text-theme-gold';
        window.showModal(isErr ? 'PERINGATAN' : 'PEMBERITAHUAN', String(message || ''), icon, isErr);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelModal = document.getElementById('btn-cancel-modal');

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            tutupModalDOM();
            if (activeModalResolver) {
                const resolver = activeModalResolver;
                activeModalResolver = null;
                resolver(true);
            }
        });
    }

    if (btnCancelModal) {
        btnCancelModal.addEventListener('click', () => {
            tutupModalDOM();
            if (activeModalResolver) {
                const resolver = activeModalResolver;
                activeModalResolver = null;
                resolver(false);
            }
        });
    }
});
