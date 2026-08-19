import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
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

export default function VerifyOtpScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const { login } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const isValidCode = code.trim().length === 6;

  const handleVerify = () => {
    if (!isValidCode || !email) return;

    setLoading(true);
    setError(null);

    apiFetch<VerifyOtpResponse>('/api/customer/auth/verify-otp', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email, code: code.trim() }),
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
            : 'Gagal memverifikasi kode. Periksa koneksi internet Anda.'
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
      body: JSON.stringify({ email }),
    })
      .then(() => setResendMessage('Kode verifikasi baru telah dikirim.'))
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal mengirim ulang kode.'
        );
      })
      .finally(() => setResending(false));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Verifikasi</Text>
        <View style={styles.sideButton} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <Ionicons name="shield-checkmark-outline" size={32} color={colors.accent} />
        </View>
        <Text style={styles.title}>Masukkan Kode Verifikasi</Text>
        <Text style={styles.subtitle}>
          Kode 6 digit telah dikirim ke{' '}
          <Text style={styles.emailText}>{email}</Text>
        </Text>

        <TextInput
          style={styles.otpInput}
          placeholder="000000"
          placeholderTextColor={colors.textMuted}
          value={code}
          onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          onSubmitEditing={handleVerify}
        />

        {error && <Text style={styles.errorText}>{error}</Text>}
        {resendMessage && <Text style={styles.successText}>{resendMessage}</Text>}

        <Button
          label="Verifikasi"
          onPress={handleVerify}
          disabled={!isValidCode}
          loading={loading}
          style={styles.submitButton}
        />

        <Pressable onPress={handleResend} disabled={resending} style={styles.resendButton}>
          <Text style={styles.resendText}>
            {resending ? 'Mengirim ulang...' : 'Tidak menerima kode? Kirim ulang'}
          </Text>
        </Pressable>
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
  emailText: {
    fontWeight: '700',
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
  successText: {
    width: '100%',
    fontSize: fontSize.sm,
    color: colors.success,
    marginTop: spacing.sm,
  },
  submitButton: {
    width: '100%',
    marginTop: spacing.lg,
  },
  resendButton: {
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
