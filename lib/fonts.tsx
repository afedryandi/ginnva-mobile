import React, { createContext, useContext } from 'react';
import { useFonts } from 'expo-font';
// Diimpor per bobot (bukan dari berkas induk paket): berkas induk memuat semua 14 varian termasuk huruf miring, yang tidak dipakai dan
// membuat bundel Metro lebih besar serta gagal bila salah satu berkasnya tidak ada.
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';

/**
 * Font aplikasi: Plus Jakarta Sans (2026-11-13, bagian redesain visual). React Native tidak memilih bobot huruf dari `fontWeight`
 * untuk font kustom, jadi tiap bobot adalah nama keluarga sendiri; AppText (components/ui/AppText.tsx) memetakan fontWeight ke nama ini.
 * Font dimuat saat aplikasi dibuka tanpa menahan layar: selama belum siap, teks memakai font sistem seperti sebelumnya.
 */
const FontsReadyContext = createContext(false);

export function FontsProvider({ children }: { children: React.ReactNode }) {
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // Gagal memuat (jarang): tetap pakai font sistem, tidak mengganggu aplikasi.
  return <FontsReadyContext.Provider value={loaded && !error}>{children}</FontsReadyContext.Provider>;
}

export function useFontsReady(): boolean {
  return useContext(FontsReadyContext);
}

const FAMILY_BY_WEIGHT: Record<number, string> = {
  400: 'PlusJakartaSans_400Regular',
  500: 'PlusJakartaSans_500Medium',
  600: 'PlusJakartaSans_600SemiBold',
  700: 'PlusJakartaSans_700Bold',
  800: 'PlusJakartaSans_800ExtraBold',
};

/** Nama keluarga font untuk sebuah fontWeight (angka, 'bold', 'normal'); bobot di atas 800 memakai 800, di bawah 400 memakai 400. */
export function fontFamilyForWeight(weight: unknown): string {
  const numeric = weight === 'bold' ? 700 : weight === 'normal' || weight === undefined || weight === null ? 400 : Number(weight);
  const snapped = Number.isFinite(numeric) ? Math.min(800, Math.max(400, Math.round(numeric / 100) * 100)) : 400;

  return FAMILY_BY_WEIGHT[snapped] ?? FAMILY_BY_WEIGHT[400];
}
