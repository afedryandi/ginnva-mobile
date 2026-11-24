/**
 * Pengecil foto sebelum diunggah (2026-11-18): foto kamera HP, walaupun sudah dikompres picker, sering 2-5 MB; server dev membatasi unggahan 2 MB sehingga
 * foto itu ditolak. Sisi terpanjang dikecilkan ke 1600 piksel dan disimpan sebagai JPEG (sekitar 300-600 KB), cukup jelas untuk foto progres dan
 * jauh lebih cepat di sinyal lemah.
 *
 * Modul expo-image-manipulator dimuat saat dipakai (bukan di bagian atas berkas): di aplikasi pengembangan yang dibangun sebelum modul ini ada, modul
 * native-nya belum tersedia, dan pemuatan di awal akan menjatuhkan seluruh layar. Bila pengecilan gagal karena alasan apa pun, foto asli tetap dikirim.
 */

const MAX_SIDE = 1600;
const QUALITY = 0.7;

export interface ShrinkOptions {
  maxSide?: number;
  quality?: number;
}

// Foto absen (selfie) dan foto lokasi dinas luar (2026-11-23): cukup untuk mengenali wajah dan tempat, sekitar 80-200 KB per foto.
export const SELFIE_UPLOAD: ShrinkOptions = { maxSide: 1024, quality: 0.6 };
export const LOCATION_PHOTO_UPLOAD: ShrinkOptions = { maxSide: 1280, quality: 0.6 };

export interface UploadImage {
  uri: string;
  name: string;
  type: string;
}

interface PickedAsset {
  uri: string;
  width?: number;
  height?: number;
  fileName?: string | null;
  mimeType?: string | null;
}

export async function shrinkForUpload(asset: PickedAsset, fallbackName: string, options: ShrinkOptions = {}): Promise<UploadImage> {
  const maxSide = options.maxSide ?? MAX_SIDE;
  const quality = options.quality ?? QUALITY;
  const original: UploadImage = { uri: asset.uri, name: asset.fileName || fallbackName, type: asset.mimeType || 'image/jpeg' };
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;

  // Ukuran asli tidak diketahui, atau sudah cukup kecil: kirim apa adanya (menghindari memperbesar atau mengompres ulang tanpa perlu).
  if (!width || !height || Math.max(width, height) <= maxSide) {
    return original;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
    const context = ImageManipulator.manipulate(asset.uri).resize(width >= height ? { width: maxSide } : { height: maxSide });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });

    return { uri: saved.uri, name: original.name.replace(/\.[^./]+$/, '') + '.jpg', type: 'image/jpeg' };
  } catch {
    return original;
  }
}

/** Beberapa foto sekaligus, berurutan (satu per satu agar memori tidak melonjak bila banyak foto besar). */
export async function shrinkAllForUpload(assets: PickedAsset[], namePrefix: string): Promise<UploadImage[]> {
  const out: UploadImage[] = [];

  for (let i = 0; i < assets.length; i++) {
    out.push(await shrinkForUpload(assets[i], `${namePrefix}-${Date.now()}-${i}.jpg`));
  }

  return out;
}
