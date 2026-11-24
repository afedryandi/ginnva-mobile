import * as storage from './storage';
import { API_BASE_URL, ApiError, appVersionHeaders, buildErrorMessage } from './api';
import { notifyUpgradeRequired } from './upgrade';
import { notifySessionEnded } from './staff-session';

// Re-export supaya layar staff cukup import dari satu file ('@/lib/staff-api')
// tanpa perlu tahu bahwa ApiError sebenarnya didefinisikan di lib/api.ts.
export { ApiError };

// Token staff disimpan TERPISAH dari token customer (key beda) —
// supaya di HP yang sama, seseorang bisa saja pernah login sebagai
// staff dan sebagai customer tanpa saling menimpa token satu sama lain.
const STAFF_TOKEN_KEY = 'ginnva_staff_token';

export async function getStaffToken(): Promise<string | null> {
  return storage.getItem(STAFF_TOKEN_KEY);
}

export async function setStaffToken(token: string): Promise<void> {
  await storage.setItem(STAFF_TOKEN_KEY, token);
}

export async function clearStaffToken(): Promise<void> {
  await storage.deleteItem(STAFF_TOKEN_KEY);
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

/**
 * Sama seperti apiFetch di lib/api.ts, tapi menyisipkan token STAFF
 * (guard 'api' di backend), bukan token customer.
 */
export async function staffApiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipAuth, headers, ...rest } = options;

  const isFormData = rest.body instanceof FormData;

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    // FormData butuh browser/RN yang set boundary sendiri — jangan
    // dipaksa 'application/json' kalau body-nya FormData (upload foto).
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...appVersionHeaders(),
    ...(headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = await getStaffToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  // Timeout: unggah foto (FormData) diberi waktu lebih panjang. Tanpa ini
  // koneksi yang menggantung membuat tombol "Kirim" berputar selamanya.
  const controller = new AbortController();
  const timeoutMs = isFormData ? 120_000 : 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const timeoutError = () => new ApiError(
    isFormData
      ? 'Pengiriman terlalu lama. Periksa koneksi internet, atau kirim lebih sedikit foto sekaligus.'
      : 'Permintaan terlalu lama. Periksa koneksi internet lalu coba lagi.',
    0
  );

  let res: Response;
  let json: any = null;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      signal: controller.signal,
      ...rest,
      headers: finalHeaders,
    });
    // Timer TETAP berjalan sampai body selesai dibaca (respons yang menggantung
    // setelah header juga kena timeout).
    json = await res.json().catch(() => null);
  } catch (err) {
    if (controller.signal.aborted) throw timeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (controller.signal.aborted && json === null) throw timeoutError();

  if (!res.ok) {
    // 413 dari server (batas ukuran upload) sering tanpa body JSON.
    if (res.status === 413 && !json) {
      throw new ApiError('Ukuran foto terlalu besar. Kirim lebih sedikit foto sekaligus atau pilih foto yang lebih kecil.', 413);
    }
    if (res.status === 426) notifyUpgradeRequired(json);
    // Token ditolak server (kedaluwarsa/dicabut) atau akun dinonaktifkan: akhiri sesi. 403 lain (tanpa izin menu) tidak.
    if (!skipAuth && finalHeaders.Authorization && (res.status === 401 || (res.status === 403 && json?.code === 'account_inactive'))) {
      notifySessionEnded(json);
    }
    throw new ApiError(buildErrorMessage(json), res.status, json?.errors);
  }

  return json as T;
}
