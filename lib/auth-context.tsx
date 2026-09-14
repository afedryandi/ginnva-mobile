import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch, getToken, setToken, clearToken } from './api';
import { getCurrentPushToken } from './notifications';

interface Customer {
  id: number;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  referral_code: string | null;
}

interface AuthContextValue {
  customer: Customer | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  // login() dipanggil SETELAH verify-otp sukses dan token sudah didapat
  // dari response — context ini tidak menangani pengiriman OTP itu
  // sendiri (itu logic per-screen), hanya menyimpan hasil akhirnya.
  login: (token: string, customerData: Customer) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Customer }>('/api/customer/auth/me');
      setCustomer(res.data);
    } catch {
      // Token tersimpan tapi sudah tidak valid (expired/revoked) ->
      // bersihkan supaya app tidak terus menganggap user login.
      await clearToken();
      setCustomer(null);
    }
  }, []);

  // Saat app dibuka, cek apakah ada token tersimpan dari sesi
  // sebelumnya — kalau ada, coba ambil profil untuk konfirmasi token
  // itu masih valid sebelum menganggap user sudah login.
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        await refreshProfile();
      }
      setIsLoading(false);
    })();
  }, [refreshProfile]);

  const login = useCallback(async (token: string, customerData: Customer) => {
    await setToken(token);
    setCustomer(customerData);
  }, []);

  const logout = useCallback(async () => {
    try {
      // push_token dikirim supaya server unlink device_tokens device ini
      // dari akun yang logout — di HP bersama/demo unit toko, mencegah
      // notifikasi bertarget nyasar ke akun yang sudah keluar. Best-effort:
      // kalau gagal ambil token (Expo Go/emulator), logout tetap lanjut.
      const pushToken = await getCurrentPushToken().catch(() => null);
      await apiFetch('/api/customer/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ push_token: pushToken }),
      });
    } catch {
      // Tetap lanjut hapus token lokal meski request logout ke server
      // gagal (mis. tidak ada koneksi) — yang penting sisi app
      // menganggap user sudah keluar.
    }
    await clearToken();
    setCustomer(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        customer,
        isLoading,
        isLoggedIn: customer !== null,
        login,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
