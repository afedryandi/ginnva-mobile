import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
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
  const styles = useMemo(() => createStyles(colors), [colors]);
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
              : 'Gagal mengubah password. Periksa koneksi internet Anda dan coba lagi.'
          );
        }
      })
      .finally(() => setSaving(false));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Akun Saya</Text>
        <View style={styles.sideButton} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.identityCard}>
            <Text style={styles.identityName}>{staff?.name}</Text>
            <Text style={styles.identityEmail}>{staff?.email}</Text>
          </View>

          <Text style={styles.sectionTitle}>Ganti Password</Text>
          <View style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password Lama</Text>
              <TextInput
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
                secureTextEntry
                returnKeyType="next"
              />
              {!!fieldErrors.current_password && (
                <Text style={styles.fieldError}>{fieldErrors.current_password}</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password Baru</Text>
              <TextInput
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
                secureTextEntry
                returnKeyType="next"
              />
              <Text style={styles.helperText}>Wajib ada huruf besar, huruf kecil, dan angka.</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Konfirmasi Password Baru</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Ulangi password baru"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                returnKeyType="done"
              />
              {!!fieldErrors.password && (
                <Text style={styles.fieldError}>{fieldErrors.password}</Text>
              )}
            </View>

            {!!formError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={styles.errorBannerText}>{formError}</Text>
              </View>
            )}

            <Button
              label={saving ? 'Menyimpan...' : 'Ganti Password'}
              onPress={handleChangePassword}
              disabled={!isFormFilled || saving}
              style={styles.saveButton}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },

  identityCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    gap: 2,
  },
  identityName: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  identityEmail: { fontSize: fontSize.sm, color: colors.textSecondary },

  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  fieldGroup: { gap: spacing.xs },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    backgroundColor: colors.bg,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { fontSize: fontSize.xs, color: colors.danger, marginTop: 2 },
  helperText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorBannerText: { flex: 1, fontSize: fontSize.sm, color: colors.danger },
  saveButton: { marginTop: spacing.xs },
  });
}
