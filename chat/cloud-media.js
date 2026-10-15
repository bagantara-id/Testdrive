// ==========================================================================
// FILE: chat/cloud-media.js
// FUNGSI: Penyatuan Transmisi Media Cloudinary & On-Device WebP Micro-Compressor
// ==========================================================================

export const CLOUDINARY_CLOUD_NAME = "wuw7hvjo";
export const DEFAULT_UPLOAD_PRESET = "bagantara-chat";

// SPESIFIKASI 3.3: Fungsi Terpadu Unggah Media ke Cloudinary (Mendukung parameter preset)
export async function uploadMediaKeCloudinary(fileBlob, tipeData = 'image', preset = DEFAULT_UPLOAD_PRESET) {
    const formData = new FormData();
    formData.append('file', fileBlob);
    formData.append('upload_preset', preset);

    const endpointTipe = tipeData === 'audio' ? 'video' : 'image';
    const apiUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${endpointTipe}/upload`;

    try {
        const respon = await fetch(apiUrl, {
            method: 'POST',
            body: formData
        });

        const data = await respon.json();
        if (!respon.ok) {
            throw new Error(data.error?.message || "Gagal mengunggah media ke Cloudinary");
        }

        return data.secure_url;
    } catch (error) {
        console.error("[MODUL MEDIA] Kegagalan transmisi Cloudinary:", error);
        throw error;
    }
}

// Alias kompatibilitas untuk modul yang memanggil unggahMediaKeCloudinary
export const unggahMediaKeCloudinary = uploadMediaKeCloudinary;

// SPESIFIKASI 3.3: On-Device WebP Micro-Compressor (FileReader + Image + Canvas, Max 1280px, Quality 0.75)
export function kompresGambarKeWebP(fileGambar, maxDimensi = 1280, kualitas = 0.75) {
    return new Promise((resolve, reject) => {
        if (!fileGambar) return reject(new Error("File gambar tidak ditemukan"));

        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Gagal membaca file gambar lokal"));
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => reject(new Error("Gagal memuat objek gambar"));
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxDimensi || height > maxDimensi) {
                    if (width >= height) {
                        height = Math.round((height * maxDimensi) / width);
                        width = maxDimensi;
                    } else {
                        width = Math.round((width * maxDimensi) / height);
                        height = maxDimensi;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            resolve(fileGambar);
                        }
                    },
                    'image/webp',
                    kualitas
                );
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(fileGambar);
    });
}
