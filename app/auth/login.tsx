import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { staffApiFetch } from '@/lib/staff-api';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { useAppTheme } from '@/lib/theme-context';

// Layar login TERPADU — user cukup masukkan email, app otomatis deteksi
// apakah ini akun staff (tampilkan password) atau customer (lanjut ke
// OTP seperti biasa). Tidak perlu lagi ada 2 pintu login terpisah yang
// harus dipilih manual oleh user.
export default function LoginScreen() {
  const { login: staffLogin } = useStaffAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [step, setStep] = useState<'email' | 'staff-password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleContinue = () => {
    if (!isValidEmail || loading) return;

    setLoading(true);
    setError(null);

    apiFetch<{ role: 'staff' | 'customer' }>('/api/auth/detect-role', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email: email.trim() }),
    })
      .then((res) => {
        if (res.role === 'staff') {
          setStep('staff-password');
          return;
        }
        return requestOtp();
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal memproses. Periksa koneksi internet Anda.'
        );
      })
      .finally(() => setLoading(false));
  };

  const requestOtp = () => {
    return apiFetch<{ message: string }>('/api/customer/auth/request-otp', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email: email.trim() }),
    }).then(() => {
      router.push({
        pathname: '/auth/verify',
        params: { email: email.trim() },
      } as never);
    });
  };

  const handleStaffLogin = () => {
    if (!password || loading) return;

    setLoading(true);
    setError(null);

    staffApiFetch<{ token: string; user: any }>('/api/staff/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email: email.trim(), password }),
    })
      .then(async (res) => {
        await staffLogin(res.token, res.user);
        // Partner (mitra referral) login lewat endpoint yang sama dengan
        // staff, tapi diarahkan ke dashboard partner. Staff yang cuma
        // punya akses inventaris (tidak ada akses booking sama sekali —
        // mis. akun khusus staff gudang) diarahkan langsung ke menu
        // Inventaris, bukan Booking Toko yang tidak relevan buat mereka.
        let destination = '/staff/bookings';
        if (res.user.role === 'partner') {
          destination = '/partner/dashboard';
        } else if (!res.user.has_booking_access && res.user.has_inventory_access) {
          destination = '/staff/inventory';
        }
        router.replace(destination as never);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal masuk. Periksa koneksi internet Anda.'
        );
      })
      .finally(() => setLoading(false));
  };

  const isStaffStep = step === 'staff-password';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {isStaffStep && router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {isStaffStep ? 'Login Staff' : 'Masuk / Daftar'}
        </Text>
        {isStaffStep ? (
          <Pressable
            onPress={() => { setStep('email'); setPassword(''); setError(null); }}
            style={styles.sideButton}
          >
            <Ionicons name="close" size={24} color={colors.accent} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <Ionicons name={isStaffStep ? 'briefcase-outline' : 'mail-outline'} size={32} color={colors.accent} />
        </View>

        {isStaffStep ? (
          <>
            <Text style={styles.title}>Login Admin Toko</Text>
            <Text style={styles.subtitle}>
              Email {email.trim()} terdaftar sebagai akun staff. Masukkan password akun Anda.
            </Text>

            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoFocus
              onSubmitEditing={handleStaffLogin}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Button
              label="Masuk"
              onPress={handleStaffLogin}
              disabled={!password}
              loading={loading}
              style={styles.submitButton}
            />

            <Pressable
              style={styles.forgotPasswordLink}
              onPress={() => router.push({ pathname: '/auth/staff-forgot-password', params: { email: email.trim() } } as never)}
            >
              <Text style={styles.forgotPasswordText}>Lupa Password?</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Masuk dengan Email</Text>
            <Text style={styles.subtitle}>
              Masukkan email Anda untuk melanjutkan.
            </Text>

            <Text style={styles.fieldLabel}>Alamat Email</Text>
            <TextInput
              style={styles.input}
              placeholder="nama@email.com"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleContinue}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Button
              label="Lanjutkan"
              onPress={handleContinue}
              disabled={!isValidEmail}
              loading={loading}
              style={styles.submitButton}
            />
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
  forgotPasswordLink: {
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  forgotPasswordText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
  },
  });
}
