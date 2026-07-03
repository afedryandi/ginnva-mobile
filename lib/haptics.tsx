/**
 * lib/haptics.ts
 *
 * Wrapper tipis di atas expo-haptics supaya:
 * 1. Tidak crash di simulator/device yang tidak support haptic
 * 2. Satu tempat kalau mau ganti implementasi
 *
 * Perlu install: expo install expo-haptics
 * Sudah support Expo Go tanpa rebuild.
 */

import * as Haptics from 'expo-haptics';

// Ketuk ringan — untuk select item, toggle chip
export function hapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// Ketuk medium — untuk tombol utama (Lanjut, Kirim, dll)
export function hapticMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

// Notifikasi sukses — setelah submit berhasil
export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

// Notifikasi error — setelah submit gagal / validasi error
export function hapticError() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

// Notifikasi warning — untuk konfirmasi / peringatan
export function hapticWarning() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}