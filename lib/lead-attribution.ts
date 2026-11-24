/**
 * lib/lead-attribution.ts
 *
 * Atribusi lead dari aplikasi (Marketing/Konten Fase 0): kalau aplikasi dipasang lewat tautan Play Store yang membawa parameter
 * kampanye (`referrer=utm_source%3D...%26utm_campaign%3D...`), parameter itu dibaca sekali dari Install Referrer saat pertama
 * dibuka (lihat referral-attribution.ts), disimpan, lalu dikirim bersama formulir lead (quotation, inquiry, kemitraan) sebagai objek
 * `attribution`. Server menyaring nilainya dan menetapkan kanal "app" sendiri.
 *
 * ANDROID-ONLY (Install Referrer murni fitur Google Play). Di iOS/web tidak ada data, `getLeadAttribution()` mengembalikan
 * undefined dan formulir tetap terkirim seperti biasa.
 */

import * as storage from './storage';

const STORAGE_KEY = 'ginnva_install_attribution';

export type LeadAttribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  click_id?: string;
};

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
const CLICK_ID_KEYS = ['gclid', 'fbclid', 'ttclid', 'msclkid'] as const;

/** Mengurai string Install Referrer (format query string) menjadi atribusi kampanye; null bila tidak ada parameter kampanye. */
export function parseInstallAttribution(installReferrer: string): LeadAttribution | null {
  const params = new URLSearchParams(installReferrer);
  const out: LeadAttribution = {};

  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value.slice(0, 150);
  }

  for (const key of CLICK_ID_KEYS) {
    const value = params.get(key)?.trim();
    if (value) {
      out.click_id = value.slice(0, 191);
      break;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

export async function saveInstallAttribution(installReferrer: string): Promise<void> {
  try {
    const attribution = parseInstallAttribution(installReferrer);
    if (attribution) await storage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Non-kritis: pengukuran tidak boleh mengganggu aplikasi.
  }
}

export async function getLeadAttribution(): Promise<LeadAttribution | undefined> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LeadAttribution) : undefined;
  } catch {
    return undefined;
  }
}
