import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';

// "Akun Saya" untuk staff -- ditambahkan 2026-09-26 (audit fitur User,
// gap "tidak ada profil self-service di mobile staff"). SEBELUMNYA staff
// yang SUDAH login sama sekali tidak punya cara ganti password dari app
// (satu-satunya jalur adalah "Lupa Password" SEBELUM login, lihat
// app/auth/staff-forgot-password.tsx). Cuma ganti password dulu (bukan
// edit profil penuh) -- data lain (nama/toko/no. karyawan) dikelola
// admin lewat Filament, konsisten dengan filosofi resource User yang
// sudah membatasi field mana yang boleh self-service vs admin-only.
export default function StaffChangePasswordScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { staff } = useStaffAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const isFormFilled = currentPassword.length > 0 && newPassword.length > 0 && confirmPassword.length > 0;

  const handleChangePassword = () => {
    if (!isFormFilled) return;
    if (newPassword !== confirmPassword) {
      setFieldErrors({ password: 'Konfirmasi password baru tidak cocok.' });
      return;
    }
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    staffApiFetch<{ message: string }>('/api/staff/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        password: newPassword,
        password_confirmation: confirmPassword,
      }),
    })
      .then((res) => {
        Alert.alert('Berhasil', res.message);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 422 && err.errors) {
          const mapped: Record<string, string> = {};
          Object.entries(err.errors).forEach(([key, msgs]) => {
            mapped[key] = Array.isArray(msgs) ? msgs[0] : String(msgs);
          });
          setFieldErrors(mapped);
        } else {
          setFormError(
            err instanceof ApiError
              ? err.message
              : 'Gagal mengubah password. Periksa koneksi internet dan coba lagi.'
          );
        }
      })
      .finally(() => setSaving(false));
  };

  const canSubmit = isFormFilled && !saving;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.headerTitle} numberOfLines={1}>Akun Saya</Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.identityCard}>
            <View style={styles.avatar} accessible accessibilityLabel="Ginnva">
              <Image source={require('@/assets/icon.png')} style={styles.avatarLogo} contentFit="contain" />
            </View>
            <View style={styles.identityText}>
              <Text style={styles.identityName} numberOfLines={1}>{staff?.name}</Text>
              <Text style={styles.identityEmail} numberOfLines={1}>{staff?.email ?? staff?.phone}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Ganti Password</Text>
          <View style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password Lama</Text>
              <PasswordInput
                style={[styles.input, !!fieldErrors.current_password && styles.inputError]}
                value={currentPassword}
                onChangeText={(v) => {
                  setCurrentPassword(v);
                  if (fieldErrors.current_password) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.current_password;
                      return next;
                    });
                  }
                }}
                placeholder="Masukkan password lama"
                placeholderTextColor={colors.textMuted}
                returnKeyType="next"
              />
              {!!fieldErrors.current_password && (
                <Text style={styles.fieldError}>{fieldErrors.current_password}</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password Baru</Text>
              <PasswordInput
                style={[styles.input, !!fieldErrors.password && styles.inputError]}
                value={newPassword}
                onChangeText={(v) => {
                  setNewPassword(v);
                  if (fieldErrors.password) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.password;
                      return next;
                    });
                  }
                }}
                placeholder="Minimal 8 karakter"
                placeholderTextColor={colors.textMuted}
                returnKeyType="next"
              />
              <Text style={styles.helperText}>Wajib ada huruf besar, huruf kecil, dan angka.</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Konfirmasi Password Baru</Text>
              <PasswordInput
                style={[styles.input, !!fieldErrors.password && styles.inputError]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Ulangi password baru"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
              />
              {!!fieldErrors.password && (
                <Text style={styles.fieldError}>{fieldErrors.password}</Text>
              )}
            </View>

            {!!formError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.errorBannerText}>{formError}</Text>
              </View>
            )}

            <Pressable
              style={[styles.saveButton, !canSubmit && styles.saveButtonDisabled]}
              onPress={handleChangePassword}
              disabled={!canSubmit}
              accessibilityRole="button"
            >
              {saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>Ganti Password</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan halaman lain yang sudah dirombak: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerTitle: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    scrollContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: spacing.xxl, gap: 12 },

    identityCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, ...shadow },
    // Logo G Ginnva dalam lingkaran putih, sama dengan avatar di Beranda dan Profil.
    avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#ffffff', borderWidth: 1, borderColor: line },
    avatarLogo: { width: 48, height: 48 },
    identityText: { flex: 1, gap: 2 },
    identityName: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    identityEmail: { fontSize: 13.5, fontWeight: '500', color: colors.textSecondary },

    sectionTitle: { marginTop: 10, marginLeft: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    card: { gap: 18, padding: 20, borderRadius: 28, backgroundColor: card, ...shadow },
    fieldGroup: { gap: 8 },
    label: { marginLeft: 4, fontSize: 13, fontWeight: '800', color: colors.textPrimary },
    input: { height: 54, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1.5, borderColor: 'transparent', fontSize: fontSize.sm + 1, color: colors.textPrimary, backgroundColor: chip },
    inputError: { borderColor: colors.danger },
    fieldError: { marginLeft: 4, fontSize: 12.5, fontWeight: '600', color: colors.danger },
    helperText: { marginLeft: 4, fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.dangerBg },
    errorBannerText: { flex: 1, fontSize: 13.5, lineHeight: 20, fontWeight: '600', color: colors.danger },
    saveButton: { height: 54, marginTop: 2, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    saveButtonDisabled: { opacity: 0.4 },
    saveButtonText: { fontSize: fontSize.base, fontWeight: '800', color: '#ffffff' },
  });
}
