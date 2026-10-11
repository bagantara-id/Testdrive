// Anda WAJIB membuat "Upload Preset" bertipe 'Unsigned' di menu Pengaturan Cloudinary Anda
const CLOUDINARY_CLOUD_NAME = "wuw7hvjo"; // Sesuai dengan URL Cloudinary Anda sebelumnya
const CLOUDINARY_UPLOAD_PRESET = "bagantara_kyc"; // Ganti ini setelah Anda membuatnya di Cloudinary

export async function uploadMediaKeCloudinary(fileBlob, tipeData = 'image') {
    const formData = new FormData();
    formData.append('file', fileBlob);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    // Endpoint spesifik Cloudinary membedakan /image/ dan /video/ (Audio masuk ke kategori video/raw)
    const endpointTipe = tipeData === 'audio' ? 'video' : 'image';
    const apiUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${endpointTipe}/upload`;

    try {
        const respon = await fetch(apiUrl, {
            method: 'POST',
            body: formData
        });
        
        if (!respon.ok) throw new Error("Gagal mengunggah media");
        
        const data = await respon.json();
        return data.secure_url; // Mengembalikan HTTPS URL murni dari Cloudinary
    } catch (error) {
        console.error("[MODUL MEDIA] Kegagalan transmisi Cloudinary:", error);
        return null;
    }
}
