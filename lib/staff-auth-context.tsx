import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import * as storage from './storage';
import { staffApiFetch, getStaffToken, setStaffToken, clearStaffToken, ApiError } from './staff-api';
import { onSessionEnded } from './staff-session';
import { getCurrentPushToken } from './notifications';

interface StaffUser {
  id: number;
  name: string;
  email: string | null; // kosong untuk karyawan yang masuk dengan No. HP
  phone?: string | null;
  role: string; // role utama (prioritas tertinggi): 'super_admin' | 'direksi' | 'store_manager' | dll (role divisi dinamis)
  // Semua role akun (opsional: sesi lama belum memilikinya); dipakai untuk label jabatan.
  roles?: string[];
  store_id: number | null;
  // Direksi tidak wajib absen (2026-11-02): tab dan kartu absensi disembunyikan. Opsional: sesi lama belum memilikinya (lihat isAttendanceRequired).
  attendance_required?: boolean;
  // Dipakai buat putuskan halaman awal setelah login (lihat app/auth/login.tsx)
  has_booking_access: boolean;
  // Opsional: sesi lama (sebelum flag ada) belum memilikinya.
  has_spk_access?: boolean;
  // Membuat SPK baru hanya leader installer dan atasannya. Opsional: sesi lama belum memilikinya.
  can_create_spk?: boolean;
  // Opsional: sesi lama (sebelum flag ada) belum memilikinya.
  can_decide_booking_requests?: boolean;
  has_quotation_access: boolean;
  // Layar Jadwal Kerja: hanya bila karyawan punya jadwal dan fitur dinyalakan di server. Opsional: sesi lama belum memilikinya.
  has_work_schedule?: boolean;
  // Lead Masuk (Inquiry Produk & Kemitraan). Opsional: sesi lama belum memilikinya.
  has_lead_inbox_access?: boolean;
  has_inventory_access: boolean;
  // Granular per-submenu — dipakai buat filter menu di grid Beranda (lihat app/staff/index.tsx)
  has_ppf_wf_access: boolean;
  // Boleh mencatat masuk/keluar, pemakaian meter, dan tandai habis di Produk PPF/WF. Opsional: sesi lama belum memilikinya (dianggap boleh; server tetap menolak).
  can_modify_ppf_wf?: boolean;
  has_material_access: boolean;
  has_asset_access: boolean;
  has_consumable_access: boolean;
  has_material_memo_access: boolean;
  // Installer / Installer Leader: boleh mengajukan memo barang tanpa menu Memo di Hak Akses.
  can_request_memo?: boolean;
  has_purchase_request_access: boolean;
  // Layar K3 & Penilaian: hanya bila APD, pelatihan, atau penilaian dinyalakan di server. Opsional: sesi lama dianggap mati.
  has_safety_access?: boolean;
  // Slip Gaji dan tab Gaji; false bila payroll dimatikan di server (2026-11-10). Opsional: sesi lama belum memilikinya.
  has_payroll?: boolean;
  // Tile Lembur di layar Absensi; false bila lembur belum diberlakukan (2026-11-13). Opsional: sesi lama dianggap mati.
  has_overtime?: boolean;
  // Keuangan di aplikasi (Keuangan Fase 5); sesi lama tanpa flag dianggap tidak punya akses.
  has_finance_access?: boolean;
}

interface StaffAuthContextValue {
  staff: StaffUser | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (token: string, staffData: StaffUser) => Promise<void>;
  logout: () => Promise<void>;
}

// Salinan profil staf terakhir, dipakai bila aplikasi dibuka tanpa sinyal.
const STAFF_PROFILE_KEY = 'ginnva_staff_profile';

const StaffAuthContext = createContext<StaffAuthContextValue | undefined>(undefined);

export function StaffAuthProvider({ children }: { children: React.ReactNode }) {
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loggingOut = useRef(false);

  useEffect(() => {
    (async () => {
      const token = await getStaffToken();
      if (token) {
        try {
          const res = await staffApiFetch<{ user: StaffUser }>('/api/staff/auth/me');
          setStaff(res.user);
          storage.setItem(STAFF_PROFILE_KEY, JSON.stringify(res.user)).catch(() => {});
        } catch (err) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            // Token ditolak server: sesi diakhiri oleh handler onSessionEnded di bawah.
            await clearStaffToken();
            setStaff(null);
          } else {
            // Tanpa sinyal / server lambat: tetap masuk memakai profil terakhir yang tersimpan, jangan logout.
            const cached = await storage.getItem(STAFF_PROFILE_KEY).catch(() => null);
            setStaff(cached ? (JSON.parse(cached) as StaffUser) : null);
          }
        }
      }
      setIsLoading(false);
    })();
  }, []);

  // Server mengakhiri sesi (token kedaluwarsa/dicabut, akun dinonaktifkan): bersihkan dan kembali ke layar login.
  useEffect(() => {
    return onSessionEnded((message) => {
      if (loggingOut.current) return;
      loggingOut.current = true;
      clearStaffToken()
        .then(() => storage.deleteItem(STAFF_PROFILE_KEY))
        .catch(() => {})
        .finally(() => {
          setStaff(null);
          router.replace('/auth/login' as never);
          Alert.alert('Sesi berakhir', message);
          loggingOut.current = false;
        });
    });
  }, []);

  const login = useCallback(async (token: string, staffData: StaffUser) => {
    await setStaffToken(token);
    setStaff(staffData);
    storage.setItem(STAFF_PROFILE_KEY, JSON.stringify(staffData)).catch(() => {});

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
    loggingOut.current = true;
    try {
      // push_token dikirim supaya server unlink device_tokens device ini
      // dari akun yang logout — sama alasan dengan link-token saat login
      // di atas, cegah notifikasi bertarget nyasar di HP bersama/demo
      // unit toko begitu staff/partner logout.
      const pushToken = await getCurrentPushToken().catch(() => null);
      await staffApiFetch('/api/staff/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ push_token: pushToken }),
      });
    } catch {
      // Tetap hapus token lokal meski request logout ke server gagal.
    }
    await clearStaffToken();
    await storage.deleteItem(STAFF_PROFILE_KEY).catch(() => {});
    setStaff(null);
    loggingOut.current = false;
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

/** Apakah akun ini wajib absen. Sesi lama tanpa flag memakai role: direksi tidak wajib. */
export function isAttendanceRequired(staff: Pick<StaffUser, 'attendance_required' | 'role' | 'roles'> | null | undefined): boolean {
  if (!staff) return true;
  return staff.attendance_required ?? !(staff.roles ?? [staff.role]).includes('direksi');
}
