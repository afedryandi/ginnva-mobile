import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

type Phase = 'form' | 'submitting' | 'success';

export default function PartnershipScreen() {
  const insets = useSafeAreaInsets();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [phase, setPhase] = useState<Phase>('form');

  const [applicantName, setApplicantName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [message, setMessage] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!applicantName.trim()) errors.applicant_name = 'Nama wajib diisi.';
    if (!phoneNumber.trim()) errors.phone_number = 'Nomor WhatsApp wajib diisi.';
    if (!email.trim()) errors.email = 'Email wajib diisi.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Format email tidak valid.';
    if (!city.trim()) errors.city = 'Kota wajib diisi.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setPhase('submitting');
    setSubmitError(null);

    try {
      // Sengaja TIDAK skipAuth — endpoint ini publik (tetap bisa diakses
      // guest tanpa token), tapi backend akan otomatis mengaitkan
      // customer_id kalau ada token customer yang valid (lihat
      // PartnershipInquiryController::submit()). skipAuth:true di sini
      // akan selalu menghilangkan header Authorization walau user sudah
      // login, sehingga fitur atribusi itu tidak pernah jalan.
      await apiFetch('/api/partnership/submit', {
        method: 'POST',
        body: JSON.stringify({
          applicant_name: applicantName.trim(),
          phone_number: phoneNumber.trim(),
          email: email.trim(),
          city: city.trim(),
          message: message.trim() || null,
        }),
      });
      setPhase('success');
    } catch (err) {
      setPhase('form');
      if (err instanceof ApiError && err.errors) {
        const mapped: Record<string, string> = {};
        Object.entries(err.errors).forEach(([k, v]) => {
          mapped[k] = Array.isArray(v) ? v[0] : String(v);
        });
        setFieldErrors(mapped);
      } else {
        setSubmitError(
          err instanceof ApiError
            ? err.message
            : 'Gagal mengirim. Periksa koneksi internet Anda dan coba lagi.'
        );
      }
    }
  };

  const HeaderBar = () => (
    <View style={styles.header}>
      {router.canGoBack() ? (
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.sideButton} />
      )}
      <Text style={styles.headerTitle} numberOfLines={1}>Ajukan Kemitraan</Text>
      <View style={styles.sideButton} />
    </View>
  );

  // ===== Success =====
  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <HeaderBar />
        <View style={styles.centerState}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark" size={36} color="#ffffff" />
          </View>
          <Text style={styles.successTitle}>Pengajuan Terkirim!</Text>
          <Text style={styles.successNote}>
            Terima kasih atas minat Anda menjadi mitra Ginnva House.
            Tim kami akan menghubungi Anda dalam 1–3 hari kerja untuk mendiskusikan
            peluang kemitraan lebih lanjut.
          </Text>
          <Button
            label="Kembali ke Beranda"
            onPress={() => router.replace('/(tabs)' as never)}
            style={styles.successButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ===== Form =====
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <HeaderBar />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 80, 100) }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info banner */}
        <View style={styles.noticeBox}>
          <Ionicons name="business-outline" size={20} color={colors.accent} />
          <Text style={styles.noticeText}>
            Bergabunglah sebagai dealer atau mitra resmi Ginnva House.
            Isi formulir berikut dan tim kami akan menghubungi Anda untuk
            mendiskusikan peluang kerja sama.
          </Text>
        </View>

        <View style={styles.formCard}>
          {/* Nama */}
          <Text style={styles.fieldLabel}>Nama Lengkap / Nama Perusahaan *</Text>
          <TextInput
            style={[styles.input, fieldErrors.applicant_name && styles.inputError]}
            placeholder="Nama Anda atau perusahaan"
            placeholderTextColor={colors.textMuted}
            value={applicantName}
            onChangeText={(v) => {
              setApplicantName(v);
              setFieldErrors((e) => ({ ...e, applicant_name: '' }));
            }}
          />
          {fieldErrors.applicant_name ? (
            <Text style={styles.errorText}>{fieldErrors.applicant_name}</Text>
          ) : null}

          {/* WhatsApp */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
            Nomor WhatsApp *
          </Text>
          <TextInput
            style={[styles.input, fieldErrors.phone_number && styles.inputError]}
            placeholder="08xxxxxxxxxx"
            placeholderTextColor={colors.textMuted}
            value={phoneNumber}
            onChangeText={(v) => {
              setPhoneNumber(v);
              setFieldErrors((e) => ({ ...e, phone_number: '' }));
            }}
            keyboardType="phone-pad"
          />
          {fieldErrors.phone_number ? (
            <Text style={styles.errorText}>{fieldErrors.phone_number}</Text>
          ) : null}

          {/* Email */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Email *</Text>
          <TextInput
            style={[styles.input, fieldErrors.email && styles.inputError]}
            placeholder="email@perusahaan.com"
            placeholderTextColor={colors.textMuted}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setFieldErrors((e) => ({ ...e, email: '' }));
            }}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {fieldErrors.email ? (
            <Text style={styles.errorText}>{fieldErrors.email}</Text>
          ) : null}

          {/* Kota */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Kota *</Text>
          <TextInput
            style={[styles.input, fieldErrors.city && styles.inputError]}
            placeholder="Mis. Jakarta, Surabaya, Bandung"
            placeholderTextColor={colors.textMuted}
            value={city}
            onChangeText={(v) => {
              setCity(v);
              setFieldErrors((e) => ({ ...e, city: '' }));
            }}
          />
          {fieldErrors.city ? (
            <Text style={styles.errorText}>{fieldErrors.city}</Text>
          ) : null}

          {/* Pesan */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
            Pesan / Informasi Tambahan <Text style={styles.optional}>(opsional)</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Mis. pengalaman di industri otomotif, luas bengkel, dsb."
            placeholderTextColor={colors.textMuted}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {submitError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorBannerText}>{submitError}</Text>
          </View>
        ) : null}

        <Button
          label={phase === 'submitting' ? 'Mengirim...' : 'Kirim Pengajuan'}
          onPress={handleSubmit}
          loading={phase === 'submitting'}
          style={styles.submitButton}
        />
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
    paddingBottom: spacing.xxl,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  formCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  optional: {
    fontWeight: '400',
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.danger,
  },
  textArea: {
    height: 100,
    paddingTop: spacing.sm,
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorBannerText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  successIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  successTitle: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  successNote: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  successButton: {
    marginTop: spacing.lg,
    width: '100%',
  },
  });
}
