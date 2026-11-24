import React, { useMemo, useRef, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform, type TextInput as RNTextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getCurrentPushToken, linkTokenToCustomer } from '@/lib/notifications';
import { hapticSuccess, hapticError } from '@/lib/haptics';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';

interface VerifyOtpResponse {
  message: string;
  token: string;
  is_new: boolean;
  data: {
    id: number;
    name: string | null;
    email: string | null;
    phone_number: string | null;
    referral_code: string | null;
  };
}

const CODE_LENGTH = 6;

// Tampilan disamakan dengan layar masuk (2026-11-24): logo kiri atas, judul besar rata kiri, kode dalam 6 kotak, tombol utama besar.
// Alur dan panggilan API tidak berubah.
export default function VerifyOtpScreen() {
  // login = email atau No. HP yang diketik di layar masuk; hint = email tujuan kode yang disamarkan (untuk login dengan No. HP).
  // "email" dipertahankan untuk tautan lama.
  const { login: loginParam, email: emailParam, hint } = useLocalSearchParams<{ login?: string; email?: string; hint?: string }>();
  const email = loginParam || emailParam;
  const { login } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);
  const inputRef = useRef<RNTextInput>(null);

  const isValidCode = code.trim().length === CODE_LENGTH;

  const handleVerify = () => {
    if (!isValidCode || !email) return;

    setLoading(true);
    setError(null);

    apiFetch<VerifyOtpResponse>('/api/customer/auth/verify-otp', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ login: email, code: code.trim() }),
    })
      .then(async (res) => {
        hapticSuccess();
        await login(res.token, res.data);

        getCurrentPushToken().then((pushToken) => {
          if (pushToken) linkTokenToCustomer(pushToken);
        });

        // User baru (atau lama yang belum punya nama) wajib isi profil dulu.
        if (res.is_new || !res.data.name) {
          router.replace({
            pathname: '/auth/complete-profile',
            params: { isNew: res.is_new ? '1' : '0' },
          } as never);
        } else {
          router.replace('/(tabs)/account' as never);
        }
      })
      .catch((err) => {
        hapticError();
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal memverifikasi kode. Periksa koneksi internetmu.'
        );
      })
      .finally(() => setLoading(false));
  };

  const handleResend = () => {
    if (!email) return;
    setResending(true);
    setResendMessage(null);
    setError(null);

    apiFetch<{ message: string }>('/api/customer/auth/request-otp', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ login: email }),
    })
      .then(() => setResendMessage('Kode verifikasi baru telah dikirim.'))
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal mengirim ulang kode.'
        );
      })
      .finally(() => setResending(false));
  };

  const activeIndex = Math.min(code.length, CODE_LENGTH - 1);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient
        pointerEvents="none"
        colors={[colors.accentSoft, 'transparent']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 1 }}
        style={styles.glow}
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            {router.canGoBack() ? (
              <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
                <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
              </Pressable>
            ) : null}
            <Image source={require('@/assets/images/ginnva-logo-red.webp')} style={styles.logo} contentFit="contain" accessibilityLabel="Ginnva" />
          </View>

          <FadeInUp style={styles.hero}>
            <View style={styles.eyebrow}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.accent} />
              <Text style={styles.eyebrowText}>Verifikasi</Text>
            </View>
            <Text style={styles.title}>{'Masukkan\nkode verifikasi'}</Text>
            <Text style={styles.subtitle}>
              Kode 6 digit sudah dikirim ke <Text style={styles.emailText}>{hint || email}</Text>
            </Text>
          </FadeInUp>

          <FadeInUp delay={90} style={styles.form}>
            {/* Satu kolom isian tak terlihat menampung kode; enam kotak hanya menampilkannya, jadi kode dari SMS/email bisa terisi otomatis. */}
            <Pressable onPress={() => inputRef.current?.focus()} style={styles.codeRow} accessibilityLabel="Kolom kode verifikasi">
              {Array.from({ length: CODE_LENGTH }, (_, i) => {
                const digit = code[i] ?? '';
                const isActive = focused && i === activeIndex && !loading;

                return (
                  <View key={i} style={[styles.codeBox, digit !== '' && styles.codeBoxFilled, isActive && styles.codeBoxActive, error ? styles.codeBoxError : null]}>
                    <Text style={styles.codeDigit}>{digit}</Text>
                  </View>
                );
              })}
              <TextInput
                ref={inputRef as never}
                style={styles.hiddenInput}
                value={code}
                onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH))}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                importantForAutofill="yes"
                caretHidden
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSubmitEditing={handleVerify}
              />
            </Pressable>

            {error ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            {resendMessage ? (
              <View style={styles.successBox}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
                <Text style={styles.successText}>{resendMessage}</Text>
              </View>
            ) : null}

            <Button
              label="Verifikasi"
              onPress={handleVerify}
              disabled={!isValidCode}
              loading={loading}
              style={[styles.submitButton, isValidCode && !loading ? styles.submitGlow : null] as never}
            />

            <Pressable onPress={handleResend} disabled={resending} style={styles.resendButton} accessibilityRole="button">
              <Text style={styles.resendText}>
                {resending ? 'Mengirim ulang...' : 'Tidak menerima kode? Kirim ulang'}
              </Text>
            </Pressable>
          </FadeInUp>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
    scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.xl },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    logo: { width: 124, height: 32 },

    hero: { marginTop: 48, gap: 12 },
    eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.accentSoft },
    eyebrowText: { fontSize: 12, fontWeight: '700', color: colors.accent },
    title: { fontSize: 34, lineHeight: 42, fontWeight: '800', letterSpacing: -1, color: colors.textPrimary },
    subtitle: { fontSize: 15, lineHeight: 23, color: colors.textSecondary, maxWidth: 340 },
    emailText: { fontWeight: '800', color: colors.textPrimary },

    form: { marginTop: 36 },
    codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    codeBox: { flex: 1, height: 64, maxWidth: 56, borderRadius: 18, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    codeBoxFilled: { backgroundColor: colors.bg, borderColor: colors.borderStrong },
    codeBoxActive: { backgroundColor: colors.bg, borderColor: colors.accent },
    codeBoxError: { borderColor: colors.danger },
    codeDigit: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
    hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: 'transparent' },

    errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: colors.dangerBg },
    errorText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.danger, fontWeight: '600' },
    successBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: colors.successBg },
    successText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.success, fontWeight: '600' },

    submitButton: { height: 58, borderRadius: 29, marginTop: 24, width: '100%' },
    submitGlow: { shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 16, elevation: 6 },

    resendButton: { alignSelf: 'center', marginTop: 12, paddingVertical: 10, paddingHorizontal: 16 },
    resendText: { fontSize: 14, fontWeight: '700', color: colors.accent },
  });
}
