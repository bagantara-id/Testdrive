// ==========================================================================
// FILE: js/utils/ui-components.js
// FUNGSI: Pengendali Komponen Antarmuka Global (Toast & Modal Alert)
// ==========================================================================

/**
 * Sistem Modal Pemberitahuan Global (Ekstraksi dari dashboard.js)
 * Mengendalikan elemen #app-modal yang akan dipusatkan di index.html
 */
window.alert = function(msg, type = 'warning') {
    const modal = document.getElementById('app-modal');
    const modalBox = document.getElementById('app-modal-box');
    const title = document.getElementById('app-modal-title');
    const msgEl = document.getElementById('app-modal-msg');
    const icon = document.getElementById('app-modal-icon');

    if (!modal || !modalBox) return; // Mencegah crash jika DOM belum siap

    msgEl.innerText = msg;
    modal.classList.remove('hidden-state');
    
    if (type === 'error') {
        icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
        icon.className = 'text-4xl mb-3 text-red-500';
        title.className = 'font-bold text-lg mb-2 text-red-500 font-display tracking-wide uppercase';
        title.innerText = 'SISTEM MENOLAK';
    } else if (type === 'success') {
        icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        icon.className = 'text-4xl mb-3 text-green-500';
        title.className = 'font-bold text-lg mb-2 text-green-500 font-display tracking-wide uppercase';
        title.innerText = 'BERHASIL';
    } else {
        icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
        icon.className = 'text-4xl mb-3 text-theme-gold';
        title.className = 'font-bold text-lg mb-2 text-white font-display tracking-wide uppercase';
        title.innerText = 'PEMBERITAHUAN';
    }

    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modalBox.classList.remove('scale-95');
    });
};

// Delegasi Event Penutupan Modal Global
document.addEventListener('DOMContentLoaded', () => {
    const btnCloseModal = document.getElementById('btn-close-modal');
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            const modal = document.getElementById('app-modal');
            const modalBox = document.getElementById('app-modal-box');
            if(modal && modalBox) {
                modal.classList.add('opacity-0');
                modalBox.classList.add('scale-95');
                setTimeout(() => modal.classList.add('hidden-state'), 300);
            }
        });
    }
});

/**
 * Sistem Toast Notification (Ekstraksi dari gps-engine.js)
 * Pemberitahuan melayang dinamis tanpa merusak alur UI
 */
window.showToast = function(message, type = 'error') {
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-600/90' : 'bg-[#10b981]/90';
    const icon = type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check';
    
    toast.className = `fixed top-6 left-1/2 -translate-x-1/2 z-[999999] ${bgColor} text-white px-5 py-3 rounded-full shadow-2xl flex items-center gap-3 text-[0.7rem] font-bold tracking-widest uppercase backdrop-blur-md border border-white/20 transition-all duration-300 transform -translate-y-24 opacity-0 w-max max-w-[90%] text-center pointer-events-none`;
    toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i> <span>${message}</span>`;
    
    document.body.appendChild(toast);
    
    // Animasi Masuk Kinetik
    requestAnimationFrame(() => {
        toast.classList.remove('-translate-y-24', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });
    
    // Pembersihan Otomatis dari DOM
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('-translate-y-24', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
};
