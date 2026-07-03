import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getCurrentPushToken, linkTokenToCustomer } from '@/lib/notifications';
import { hapticSuccess, hapticError } from '@/lib/haptics';
import { useAuth } from '@/lib/auth-context';

interface VerifyOtpResponse {
  message: string;
  token: string;
  data: {
    id: number;
    name: string | null;
    email: string | null;
    phone_number: string | null;
  };
}

export default function VerifyOtpScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const { login } = useAuth();

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

        // Link push token yang sudah terdaftar sebagai guest ke customer
        // yang baru saja login, supaya notifikasi targeted bisa dikirim
        // ke perangkat ini. Fire-and-forget — tidak perlu await, gagal
        // pun tidak mengganggu flow login.
        getCurrentPushToken().then((pushToken) => {
          if (pushToken) linkTokenToCustomer(pushToken);
        });

        router.replace('/(tabs)/account' as never);
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
      <ScreenHeader title="Verifikasi" />
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
          placeholderTextColor={colors.mutedLight}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    padding: spacing.md,
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.alt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.ink,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 19,
    paddingHorizontal: spacing.md,
  },
  emailText: {
    fontWeight: '700',
    color: colors.ink,
  },
  otpInput: {
    width: '100%',
    height: 56,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.ink,
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