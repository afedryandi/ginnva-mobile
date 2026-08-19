import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing } from '@/constants/theme';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { savePendingReferralCode } from '@/lib/referral-attribution';

// Kode referral Customer selalu 6 karakter A-Z0-9 (lihat
// Customer::generateReferralCode() di backend).
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,10}$/;

/**
 * app/r/[code].tsx — tujuan App Link https://api.ginnva.id/r/{code}
 * (lihat android.intentFilters di app.json).
 *
 * Layar ini CUMA kejalanin kalau app SUDAH terinstall (kalau belum,
 * Android tidak bisa intercept URL-nya sama sekali, browser yang
 * buka — lihat routes/web.php di backend untuk kasus itu). Karena app
 * sudah terinstall, customer B TIDAK lewat alur Install Referrer API
 * (lib/referral-attribution.ts) sama sekali, jadi kode referral perlu
 * ditangani terpisah di sini:
 * - Sudah login  -> langsung apply ke profil (aman dipanggil berkali-
 *   kali, backend menolak kalau customer sudah pernah punya referrer).
 * - Belum login  -> simpan sebagai pending, nanti otomatis terisi di
 *   Lengkapi Profil lewat consumePendingReferralCode() (pipa yang sama
 *   dengan alur install baru).
 */
export default function ReferralLinkScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { customer, isLoading, refreshProfile } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = createStyles(colors);
  const [message, setMessage] = useState('Menerapkan kode referral...');

  useEffect(() => {
    if (isLoading) return; // tunggu auth-context selesai cek token tersimpan

    const normalized = (code ?? '').trim().toUpperCase();
    if (!REFERRAL_CODE_PATTERN.test(normalized)) {
      router.replace('/(tabs)' as never);
      return;
    }

    (async () => {
      // PUT /api/customer/auth/profile MEWAJIBKAN name & phone_number
      // (lihat AuthController::updateProfile) — endpoint ini didesain
      // untuk form Edit Profil yang selalu mengirim keduanya, bukan
      // sekadar "tempel referral_code". Kalau cuma referral_code yang
      // dikirim, request ini SELALU gagal validasi 422 terlepas dari
      // valid tidaknya kode, dan sebelumnya kegagalan itu tertelan diam-
      // diam seolah "kode sudah dipakai" — customer login tidak pernah
      // benar-benar dapat atribusi referral. Kalau profil belum lengkap
      // (name/phone_number kosong), jatuh ke alur pending yang sama
      // dengan customer belum login, supaya tetap konsisten diproses
      // nanti lewat Lengkapi Profil.
      if (customer && customer.name && customer.phone_number) {
        try {
          await apiFetch('/api/customer/auth/profile', {
            method: 'PUT',
            body: JSON.stringify({
              name: customer.name,
              phone_number: customer.phone_number,
              referral_code: normalized,
            }),
          });
          await refreshProfile();
        } catch {
          // Kode tidak valid / customer sudah pernah punya referrer —
          // bukan error fatal, cukup lanjut ke akun seperti biasa.
        }
        setMessage('Berhasil!');
        router.replace('/(tabs)/account' as never);
      } else {
        await savePendingReferralCode(normalized);
        if (customer) {
          router.replace('/(tabs)/account' as never);
        } else {
          router.replace('/auth/login' as never);
        }
      }
    })();
  }, [code, customer, isLoading]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.text}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
    text: { fontSize: fontSize.sm, color: colors.textSecondary },
  });
}
