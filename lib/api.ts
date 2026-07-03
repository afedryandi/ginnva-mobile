import * as SecureStore from 'expo-secure-store';

// Ganti ke domain produksi — saat development bisa override lewat env
// EXPO_PUBLIC_API_URL kalau perlu test ke server lain.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://api.ginnva.id';

const TOKEN_KEY = 'ginnva_customer_token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Record<string, string[]>
  ) {
    super(message);
  }
}

interface RequestOptions extends RequestInit {
  // Kalau true, request akan dikirim TANPA token meski ada token
  // tersimpan — dipakai untuk endpoint publik yang sengaja diakses
  // sebagai guest meskipun customer sedang login (jarang dipakai, tapi
  // disiapkan untuk fleksibilitas).
  skipAuth?: boolean;
}

/**
 * Wrapper fetch terpusat — semua panggilan API di app ini lewat sini,
 * supaya: (1) base URL tidak diulang-ulang di tiap file, (2) token
 * customer otomatis disisipkan kalau ada, (3) error format dari backend
 * Laravel (validasi 422, dst) diparse jadi satu bentuk konsisten lewat
 * ApiError, bukan ditangani manual di tiap pemanggilan.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipAuth, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = await getToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
  });

  // Beberapa endpoint (mis. download PDF) tidak mengembalikan JSON —
  // di luar scope client ini, dipanggil langsung via Linking di
  // tempatnya, jadi parsing JSON di sini aman dianggap selalu berlaku.
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      json?.message || 'Terjadi kesalahan. Silakan coba lagi.',
      res.status,
      json?.errors
    );
  }

  return json as T;
}
