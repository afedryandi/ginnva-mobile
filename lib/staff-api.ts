import * as storage from './storage';
import { API_BASE_URL, ApiError, buildErrorMessage } from './api';

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
    ...(headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = await getStaffToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(buildErrorMessage(json), res.status, json?.errors);
  }

  return json as T;
}
