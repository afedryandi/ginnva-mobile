/**
 * lib/referral-attribution.ts
 *
 * "Ajak Teman" tanpa perlu customer B ketik manual kode temannya —
 * Customer A share link Play Store yang sudah dibubuhi parameter
 * `referrer=ref%3D<KODE>`. Play Store menitipkan parameter itu lewat
 * proses install (Google Play Install Referrer API), dan begitu app
 * dibuka pertama kali, kode itu bisa dibaca dari sini lalu otomatis
 * dipakai untuk mengisi field "Kode Referral Teman" di Lengkapi Profil
 * — customer B tidak perlu ketik apa-apa.
 *
 * ANDROID-ONLY — Install Referrer API murni fitur Google Play, tidak
 * ada di iOS. Di iOS/web, semua fungsi di sini no-op (aman dipanggil
 * dari mana saja tanpa perlu Platform.OS check di pemanggilnya).
 */

import { Platform } from 'react-native';
import * as storage from './storage';

const CHECKED_FLAG_KEY = 'ginnva_install_referrer_checked';
const PENDING_CODE_KEY = 'ginnva_pending_referral_code';

// Kode referral Customer selalu 6 karakter A-Z0-9 (lihat
// Customer::generateReferralCode() di backend) — divalidasi di sini
// juga supaya string acak dari installReferrer yang tidak relevan
// (mis. campaign lain, UTM Ads) tidak ikut ke-parse jadi kode.
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,10}$/;

function parseReferralCode(installReferrer: string): string | null {
  const params = new URLSearchParams(installReferrer);
  const code = params.get('ref')?.trim().toUpperCase();
  return code && REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Dipanggil SEKALI di root layout saat app baru dibuka. Aman dipanggil
 * berkali-kali — begitu sudah pernah dicek (baik ketemu kode atau
 * tidak), tidak akan mencoba lagi (installReferrer cuma valid untuk
 * sesaat setelah instalasi baru, memanggilnya lagi di sesi berikutnya
 * cuma buang waktu).
 */
export async function checkInstallReferrerOnce(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    const alreadyChecked = await storage.getItem(CHECKED_FLAG_KEY);
    if (alreadyChecked) return;

    // Tandai dulu SEBELUM baca — supaya kalau library ini gagal/crash,
    // kita tidak coba-coba lagi terus setiap app dibuka.
    await storage.setItem(CHECKED_FLAG_KEY, '1');

    const { PlayInstallReferrer } = await import('react-native-play-install-referrer');

    await new Promise<void>((resolve) => {
      PlayInstallReferrer.getInstallReferrerInfo((info, error) => {
        if (!error && info?.installReferrer) {
          const code = parseReferralCode(info.installReferrer);
          if (code) {
            storage.setItem(PENDING_CODE_KEY, code).catch(() => {});
          }
        }
        resolve();
      });
    });
  } catch {
    // Non-kritis — kegagalan di sini tidak boleh mengganggu app startup.
  }
}

/**
 * Dipanggil dari layar App Link (app/r/[code].tsx) saat customer B
 * TERNYATA sudah pernah install app sebelumnya (jadi tidak lewat alur
 * Install Referrer sama sekali — App Link intercept lebih dulu). Kalau
 * dia belum login, kode disimpan di sini dulu supaya otomatis terisi
 * nanti di Lengkapi Profil lewat consumePendingReferralCode() di bawah
 * — jalur pipa-nya sama persis dengan alur install baru.
 */
export async function savePendingReferralCode(code: string): Promise<void> {
  try {
    await storage.setItem(PENDING_CODE_KEY, code);
  } catch {
    // Non-kritis.
  }
}

/**
 * Dipanggil dari layar Lengkapi Profil untuk mengisi otomatis field
 * kode referral. SEKALI PAKAI — begitu dibaca, langsung dihapus supaya
 * tidak ke-apply lagi ke akun lain kalau customer logout/login ulang
 * di device yang sama.
 */
export async function consumePendingReferralCode(): Promise<string | null> {
  try {
    const code = await storage.getItem(PENDING_CODE_KEY);
    if (code) await storage.deleteItem(PENDING_CODE_KEY);
    return code;
  } catch {
    return null;
  }
}
