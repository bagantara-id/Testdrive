// ==========================================================================
// FILE: js/utils/ui-components.js
// FUNGSI: Pengendali Kinetik UI (Micro-HUD Avionik & Modal Statis)
// ==========================================================================

let toastTimeout = null;
let toastFoldTimeout = null;

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
    
    // Memberikan jeda 50ms agar peramban merender ikon terlebih dahulu sebelum teks meluncur keluar
    requestAnimationFrame(() => {
        setTimeout(() => {
            textWrap.style.maxWidth = '300px'; 
            textWrap.style.paddingLeft = '16px'; 
        }, 50);
    });

    // 5. Mekanisme Kinetik: Auto-Close & Melipat (Collapse) dalam 3 Detik
    toastTimeout = setTimeout(() => {
        // Teks melipat masuk ke dalam ikon terlebih dahulu
        textWrap.style.maxWidth = '0px';
        textWrap.style.paddingLeft = '12px';
        
        // Setelah teks terlipat, hilangkan seluruh elemen HUD ke arah kiri
        toastFoldTimeout = setTimeout(() => {
            toast.classList.add('opacity-0');
            toast.style.transform = 'translateX(-20px)';
        }, 400); // 400ms adalah waktu tunggu teks melipat sempurna
    }, 3000);
};

// Pengendali Modal Statis
window.showModal = function(title, message, iconClass = 'fa-circle-info text-theme-gold', isError = false) {
    const modal = document.getElementById('app-modal');
    const titleEl = document.getElementById('app-modal-title');
    const msgEl = document.getElementById('app-modal-msg');
    const iconEl = document.getElementById('app-modal-icon');
    const boxEl = document.getElementById('app-modal-box');
    const btnClose = document.getElementById('btn-close-modal');

    if(!modal) return;

    titleEl.innerText = title;
    msgEl.innerText = message;
    iconEl.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;

    if (isError) {
        titleEl.classList.replace('text-white', 'text-red-400');
        iconEl.classList.replace('text-theme-gold', 'text-red-500');
        btnClose.classList.replace('btn-primary', 'bg-red-500/20');
        btnClose.classList.add('text-red-500', 'border', 'border-red-500/50');
    } else {
        titleEl.classList.replace('text-red-400', 'text-white');
        iconEl.classList.replace('text-red-500', 'text-theme-gold');
        btnClose.classList.replace('bg-red-500/20', 'btn-primary');
        btnClose.classList.remove('text-red-500', 'border-red-500/50');
    }

    modal.classList.remove('hidden-state');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        boxEl.classList.remove('scale-95');
    });
};

document.addEventListener('DOMContentLoaded', () => {
    const btnCloseModal = document.getElementById('btn-close-modal');
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            const modal = document.getElementById('app-modal');
            const boxEl = document.getElementById('app-modal-box');
            if (modal) {
                modal.classList.add('opacity-0');
                boxEl.classList.add('scale-95');
                setTimeout(() => modal.classList.add('hidden-state'), 300);
            }
        });
    }
});
