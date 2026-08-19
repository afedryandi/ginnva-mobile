/**
 * lib/app-review.ts
 *
 * Native in-app review prompt (Play Store In-App Review API / iOS
 * StoreKit) — TIDAK membawa user keluar dari app, beda dari tombol
 * "Beri Rating Aplikasi" manual di tab Akun yang deep-link ke Play Store.
 *
 * Dipicu SEKALI SEUMUR AKUN: begitu booking pertama customer mencapai
 * tahap "Selesai" (momen kepuasan tertinggi). Setelah itu tidak pernah
 * diminta otomatis lagi — sesuai keputusan produk, supaya tidak
 * mengganggu.
 *
 * Catatan: Google/Apple membatasi sendiri seberapa sering dialog ini
 * benar-benar tampil (di luar kendali kita) — requestReview() hanya
 * "meminta", platform yang putuskan apakah ditampilkan.
 */

import * as StoreReview from 'expo-store-review';
import * as storage from './storage';

const FLAG_KEY = 'ginnva_review_prompted';

export async function maybePromptAppReview(): Promise<void> {
  try {
    const alreadyPrompted = await storage.getItem(FLAG_KEY);
    if (alreadyPrompted) return;

    const isAvailable = await StoreReview.isAvailableAsync();
    if (!isAvailable) return;

    // Tandai dulu SEBELUM memanggil requestReview — supaya walau
    // dialognya sendiri tidak jadi tampil (dibatasi platform), kita
    // tetap tidak akan mencoba lagi di sesi-sesi berikutnya.
    await storage.setItem(FLAG_KEY, '1');
    await StoreReview.requestReview();
  } catch {
    // Non-kritis — jangan sampai fitur review mengganggu flow utama.
  }
}
