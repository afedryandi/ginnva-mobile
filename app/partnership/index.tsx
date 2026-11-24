import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthField } from '@/components/auth/AuthShell';
import { AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { getLeadAttribution, LeadAttribution } from '@/lib/lead-attribution';

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

  const [attribution, setAttribution] = useState<LeadAttribution | undefined>(undefined);
  useEffect(() => {
    getLeadAttribution().then(setAttribution);
  }, []);

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
          attribution,
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
            : 'Gagal mengirim. Periksa koneksi internetmu dan coba lagi.'
        );
      }
    }
  };

  const setField = (key: string, setter: (v: string) => void) => (v: string) => {
    setter(v);
    setFieldErrors((e) => ({ ...e, [key]: '' }));
  };

  const glow = (
    <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />
  );

  const backButton = router.canGoBack() ? (
    <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
      <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
    </Pressable>
  ) : (
    <View style={styles.backSpacer} />
  );

  // ===== Success =====
  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        {glow}
        <View style={styles.topRow}>{backButton}</View>
        <View style={styles.centerState}>
          <View style={styles.successRing}>
            <View style={styles.successIconWrap}>
              <Ionicons name="checkmark" size={38} color="#ffffff" />
            </View>
          </View>
          <Text style={styles.successTitle}>Pengajuan Terkirim!</Text>
          <Text style={styles.successNote}>
            Terima kasih atas minatmu menjadi mitra Ginnva House. Tim kami akan menghubungimu dalam 1–3 hari kerja untuk
            mendiskusikan peluang kemitraan lebih lanjut.
          </Text>
          <PressableScale style={styles.primaryButton} onPress={() => router.replace('/(tabs)' as never)} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Kembali ke Beranda</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  const submitting = phase === 'submitting';

  // ===== Form =====
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      {glow}
      <View style={styles.topRow}>{backButton}</View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 40, 56) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Ajukan Kemitraan</Text>
          <Text style={styles.subtitle}>
            Bergabunglah sebagai dealer atau mitra resmi Ginnva House. Isi formulir berikut dan tim kami akan menghubungimu untuk
            mendiskusikan peluang kerja sama.
          </Text>

          <View style={styles.stack}>
            <AuthField label="Nama Lengkap / Nama Perusahaan *" icon="business-outline" error={fieldErrors.applicant_name || undefined}>
              {(input) => (
                <TextInput
                  {...input}
                  placeholder="Namamu atau perusahaan"
                  placeholderTextColor={colors.textMuted}
                  value={applicantName}
                  onChangeText={setField('applicant_name', setApplicantName)}
                />
              )}
            </AuthField>

            <AuthField label="Nomor WhatsApp *" icon="logo-whatsapp" error={fieldErrors.phone_number || undefined}>
              {(input) => (
                <TextInput
                  {...input}
                  placeholder="08xxxxxxxxxx"
                  placeholderTextColor={colors.textMuted}
                  value={phoneNumber}
                  onChangeText={setField('phone_number', setPhoneNumber)}
                  keyboardType="phone-pad"
                />
              )}
            </AuthField>

            <AuthField label="Email *" icon="mail-outline" error={fieldErrors.email || undefined}>
              {(input) => (
                <TextInput
                  {...input}
                  placeholder="email@perusahaan.com"
                  placeholderTextColor={colors.textMuted}
                  value={email}
                  onChangeText={setField('email', setEmail)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              )}
            </AuthField>

            <AuthField label="Kota *" icon="location-outline" error={fieldErrors.city || undefined}>
              {(input) => (
                <TextInput
                  {...input}
                  placeholder="Mis. Jakarta, Surabaya, Bandung"
                  placeholderTextColor={colors.textMuted}
                  value={city}
                  onChangeText={setField('city', setCity)}
                />
              )}
            </AuthField>

            <AuthField label="Pesan / Informasi Tambahan (opsional)" icon="create-outline" multiline>
              {(input) => (
                <TextInput
                  {...input}
                  placeholder="Mis. pengalaman di industri otomotif, luas bengkel, dsb."
                  placeholderTextColor={colors.textMuted}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                />
              )}
            </AuthField>
          </View>

          {submitError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorBannerText}>{submitError}</Text>
            </View>
          ) : null}

          <PressableScale
            style={[styles.primaryButton, submitting && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Kirim Pengajuan</Text>
                <Ionicons name="paper-plane-outline" size={18} color="#ffffff" />
              </>
            )}
          </PressableScale>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    backSpacer: { width: 44, height: 44 },

    scrollContent: { paddingHorizontal: 24, paddingTop: spacing.md, gap: 14 },
    title: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginBottom: 4 },
    stack: { gap: 14 },

    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 20, backgroundColor: colors.dangerBg },
    errorBannerText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.danger },

    primaryButton: { flexDirection: 'row', gap: 8, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, alignSelf: 'stretch', marginTop: 6 },
    primaryButtonText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
    buttonDisabled: { opacity: 0.6 },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24, paddingBottom: 48 },
    successRing: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, marginBottom: 6 },
    successIconWrap: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    successTitle: { fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary, textAlign: 'center' },
    successNote: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center', marginBottom: 6 },
  });
}
