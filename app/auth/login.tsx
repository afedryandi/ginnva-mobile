import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

// Login & register digabung jadi satu alur OTP email — kalau email
// belum punya akun, akun baru otomatis dibuat saat verify-otp berhasil
// (lihat catatan di AuthController backend). Jadi screen ini tidak
// perlu tahu apakah user baru atau lama.
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleRequestOtp = () => {
    if (!isValidEmail) return;

    setLoading(true);
    setError(null);

    apiFetch<{ message: string }>('/api/customer/auth/request-otp', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email: email.trim() }),
    })
      .then(() => {
        router.push({
          pathname: '/auth/verify',
          params: { email: email.trim() },
        } as never);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal mengirim kode verifikasi. Periksa koneksi internet Anda.'
        );
      })
      .finally(() => setLoading(false));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Masuk / Daftar" />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <Ionicons name="mail-outline" size={32} color={colors.accent} />
        </View>
        <Text style={styles.title}>Masuk dengan Email</Text>
        <Text style={styles.subtitle}>
          Kami akan mengirim kode verifikasi 6 digit ke email Anda. Tidak perlu
          kata sandi.
        </Text>

        <Text style={styles.fieldLabel}>Alamat Email</Text>
        <TextInput
          style={styles.input}
          placeholder="nama@email.com"
          placeholderTextColor={colors.mutedLight}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleRequestOtp}
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Button
          label="Kirim Kode Verifikasi"
          onPress={handleRequestOtp}
          disabled={!isValidEmail}
          loading={loading}
          style={styles.submitButton}
        />
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
  fieldLabel: {
    alignSelf: 'flex-start',
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    marginBottom: spacing.xs,
  },
  input: {
    width: '100%',
    height: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.ink,
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
});
