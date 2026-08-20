import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';
import { consumePendingReferralCode } from '@/lib/referral-attribution';

export default function CompleteProfileScreen() {
  const { isNew } = useLocalSearchParams<{ isNew?: string }>();
  const { refreshProfile } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = name.trim().length > 0 && phone.trim().length >= 8;

  // Kode referral dari link Play Store ajak-teman (kalau ada) — isi
  // otomatis field-nya supaya customer B tidak perlu ketik manual.
  // Cuma relevan untuk akun BARU (isNew=1, lihat field di bawah).
  useEffect(() => {
    if (isNew !== '1') return;
    consumePendingReferralCode().then((code) => {
      if (code) setReferralCode(code);
    });
  }, [isNew]);

  const handleSubmit = () => {
    if (!isValid) return;

    setLoading(true);
    setError(null);

    apiFetch<{ message: string; data: object }>('/api/customer/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: name.trim(),
        phone_number: phone.trim(),
        referral_code: referralCode.trim() || undefined,
      }),
    })
      .then(async () => {
        hapticSuccess();
        // Refresh context supaya data terbaru (nama, phone) langsung
        // tersedia di seluruh app tanpa perlu restart.
        await refreshProfile();
        router.replace('/(tabs)/account' as never);
      })
      .catch((err) => {
        hapticError();
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal menyimpan profil. Periksa koneksi internet Anda.'
        );
      })
      .finally(() => setLoading(false));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Ionicons name="person-add-outline" size={32} color={colors.accent} />
          </View>

          {/* Heading */}
          <Text style={styles.title}>Lengkapi Profil Anda</Text>
          <Text style={styles.subtitle}>
            Sebelum mulai, kami perlu nama dan nomor WhatsApp Anda agar tim
            kami bisa menghubungi Anda dengan mudah.
          </Text>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.fieldLabel}>Nama Lengkap *</Text>
            <TextInput
              style={styles.input}
              placeholder="Masukkan nama lengkap Anda"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
            />

            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
              Nomor WhatsApp *
            </Text>
            <View style={styles.phoneWrap}>
              <View style={styles.phonePrefix}>
                <Text style={styles.phonePrefixText}>+62</Text>
              </View>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                placeholder="8xxxxxxxxxx"
                placeholderTextColor={colors.textMuted}
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, ''))}
                keyboardType="phone-pad"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>
            <Text style={styles.hint}>
              Contoh: 81234567890 (tanpa angka 0 di depan)
            </Text>

            {isNew === '1' && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
                  Kode Referral Teman (opsional)
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Contoh: AB12CD"
                  placeholderTextColor={colors.textMuted}
                  value={referralCode}
                  onChangeText={(v) => setReferralCode(v.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <Text style={styles.hint}>
                  Diajak teman pakai Ginnva App? Masukkan kode referral-nya di sini.
                </Text>
              </>
            )}

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </View>

          <Button
            label="Simpan & Mulai"
            onPress={handleSubmit}
            disabled={!isValid}
            loading={loading}
            style={styles.submitButton}
          />

          <Text style={styles.note}>
            Anda bisa mengubah informasi ini kapan saja di halaman Akun.
          </Text>
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
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    alignItems: 'center',
    paddingTop: spacing.xxl,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
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
    marginBottom: spacing.xl,
    lineHeight: 20,
    paddingHorizontal: spacing.sm,
  },
  form: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  phoneWrap: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  phonePrefix: {
    height: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phonePrefixText: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  submitButton: {
    width: '100%',
    marginBottom: spacing.md,
  },
  note: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
  },
  });
}
