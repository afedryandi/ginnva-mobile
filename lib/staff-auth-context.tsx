import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { staffApiFetch, getStaffToken, setStaffToken, clearStaffToken } from './staff-api';
import { getCurrentPushToken } from './notifications';

interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: string; // 'super_admin' | 'direksi' | 'store_manager' | dll (role divisi dinamis)
  store_id: number | null;
  // Dipakai buat putuskan halaman awal setelah login (lihat app/auth/login.tsx)
  has_booking_access: boolean;
  has_quotation_access: boolean;
  has_inventory_access: boolean;
  // Granular per-submenu — dipakai buat filter menu Inventaris
  // (lihat app/staff/inventory/index.tsx & app/staff/bookings/index.tsx)
  has_ppf_wf_access: boolean;
  has_material_access: boolean;
  has_asset_access: boolean;
  has_consumable_access: boolean;
  has_material_memo_access: boolean;
  has_purchase_request_access: boolean;
}

interface StaffAuthContextValue {
  staff: StaffUser | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (token: string, staffData: StaffUser) => Promise<void>;
  logout: () => Promise<void>;
}

const StaffAuthContext = createContext<StaffAuthContextValue | undefined>(undefined);

export function StaffAuthProvider({ children }: { children: React.ReactNode }) {
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await getStaffToken();
      if (token) {
        try {
          const res = await staffApiFetch<{ user: StaffUser }>('/api/staff/auth/me');
          setStaff(res.user);
        } catch {
          await clearStaffToken();
          setStaff(null);
        }
      }
      setIsLoading(false);
    })();
  }, []);

  const login = useCallback(async (token: string, staffData: StaffUser) => {
    await setStaffToken(token);
    setStaff(staffData);

    // Tautkan push token device ini ke akun staff yang baru login, supaya
    // notifikasi booking/chat baru sampai ke HP staff — bukan cuma
    // tersimpan sebagai token anonim.
    try {
      const pushToken = await getCurrentPushToken();
      if (pushToken) {
        await staffApiFetch('/api/staff/notifications/link-token', {
          method: 'POST',
          body: JSON.stringify({ token: pushToken }),
        });
      }
    } catch {
      // Non-kritis — login staff tetap lanjut meski link token gagal.
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await staffApiFetch('/api/staff/auth/logout', { method: 'POST' });
    } catch {
      // Tetap hapus token lokal meski request logout ke server gagal.
    }
    await clearStaffToken();
    setStaff(null);
  }, []);

  return (
    <StaffAuthContext.Provider
      value={{ staff, isLoading, isLoggedIn: staff !== null, login, logout }}
    >
      {children}
    </StaffAuthContext.Provider>
  );
}

export function useStaffAuth(): StaffAuthContextValue {
  const ctx = useContext(StaffAuthContext);
  if (!ctx) {
    throw new Error('useStaffAuth must be used within StaffAuthProvider');
  }
  return ctx;
}
