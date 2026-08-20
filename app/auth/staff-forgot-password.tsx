import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

// Alur reset password untuk akun non-customer (staff/admin toko/direksi/
// installer, DAN partner referral GIIAS yang akunnya dibuat dengan
// password acak lewat Become a Partner — endpoint backend cuma cek email
// di tabel users, tidak dibatasi role tertentu) — beda dari customer yang
// pakai OTP untuk login itu sendiri, di sini kode OTP dipakai murni untuk
// verifikasi identitas sebelum ganti password, akun tetap pakai
// email+password seperti biasa setelahnya.
type Step = 'request' | 'reset';

export default function StaffForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isValidCode = code.trim().length === 6;
  const isValidPassword = newPassword.length >= 8 && newPassword === confirmPassword;

  const handleRequestCode = () => {
    if (!isValidEmail || loading) return;
    setLoading(true);
    setError(null);

    staffApiFetch<{ message: string }>('/api/staff/auth/forgot-password', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email: email.trim() }),
    })
      .then((res) => {
        setSuccessMessage(res.message);
        setStep('reset');
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memproses. Periksa koneksi internet Anda.'
        );
      })
      .finally(() => setLoading(false));
  };

  const handleResetPassword = () => {
    if (!isValidCode || !isValidPassword || loading) return;
    setLoading(true);
    setError(null);

    staffApiFetch<{ message: string }>('/api/staff/auth/reset-password', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({
        email: email.trim(),
        code: code.trim(),
        password: newPassword,
        password_confirmation: confirmPassword,
      }),
    })
      .then(() => {
        setDone(true);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal mengubah password. Periksa koneksi internet Anda.'
        );
      })
      .finally(() => setLoading(false));
  };

  if (done) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <View style={styles.scrollContent}>
          <View style={styles.iconWrap}>
            <Ionicons name="checkmark-circle" size={40} color={colors.success} />
          </View>
          <Text style={styles.title}>Password Berhasil Diubah</Text>
          <Text style={styles.subtitle}>Silakan masuk kembali dengan password baru Anda.</Text>
          <Button
            label="Kembali ke Login"
            onPress={() => router.replace('/auth/login' as never)}
            style={styles.submitButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable
          onPress={() => (step === 'reset' ? setStep('request') : router.back())}
          style={styles.sideButton}
        >
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Reset Password</Text>
        <View style={styles.sideButton} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <Ionicons name={step === 'request' ? 'key-outline' : 'shield-checkmark-outline'} size={32} color={colors.accent} />
        </View>

        {step === 'request' ? (
          <>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Masukkan email akun Anda. Kami kirim kode verifikasi 6 digit untuk konfirmasi identitas sebelum Anda bisa mengganti password.
            </Text>

            <Text style={styles.fieldLabel}>Alamat Email</Text>
            <TextInput
              style={styles.input}
              placeholder="nama@ginnva.id"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleRequestCode}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Button
              label="Kirim Kode Verifikasi"
              onPress={handleRequestCode}
              disabled={!isValidEmail}
              loading={loading}
              style={styles.submitButton}
            />
          </>
        ) : (
          <>
            <Text style={styles.title}>Masukkan Kode & Password Baru</Text>
            <Text style={styles.subtitle}>
              {successMessage ?? `Kode 6 digit telah dikirim ke ${email.trim()}.`}
            </Text>

            <Text style={styles.fieldLabel}>Kode Verifikasi</Text>
            <TextInput
              style={styles.otpInput}
              placeholder="000000"
              placeholderTextColor={colors.textMuted}
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
            />

            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Password Baru</Text>
            <TextInput
              style={styles.input}
              placeholder="Minimal 8 karakter"
              placeholderTextColor={colors.textMuted}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />

            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Konfirmasi Password Baru</Text>
            <TextInput
              style={styles.input}
              placeholder="Ulangi password baru"
              placeholderTextColor={colors.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              onSubmitEditing={handleResetPassword}
            />
            {newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword && (
              <Text style={styles.errorText}>Password tidak sama.</Text>
            )}

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Button
              label="Ubah Password"
              onPress={handleResetPassword}
              disabled={!isValidCode || !isValidPassword}
              loading={loading}
              style={styles.submitButton}
            />

            <Pressable style={styles.resendLink} onPress={handleRequestCode} disabled={loading}>
              <Text style={styles.resendText}>Tidak menerima kode? Kirim ulang</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scrollContent: {
    padding: spacing.md,
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 19,
    paddingHorizontal: spacing.md,
  },
  fieldLabel: {
    alignSelf: 'flex-start',
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  input: {
    width: '100%',
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  otpInput: {
    width: '100%',
    height: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 8,
  },
  errorText: {
    width: '100%',
    fontSize: fontSize.sm,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  submitButton: {
    width: '100%',
    marginTop: spacing.lg,
  },
  resendLink: {
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  resendText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
  },
  });
}
