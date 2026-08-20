import React, { useEffect, useMemo, useState } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface PartnerProfile {
  id: number;
  business_name: string;
  phone: string | null;
  referral_code: string;
}

export default function PartnerEditProfileScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PartnerProfile | null>(null);

  // --- Informasi bisnis ---
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [profileError, setProfileError] = useState<string | null>(null);

  // --- Ganti password ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    staffApiFetch<{ data: PartnerProfile }>('/api/partner/me')
      .then((res) => {
        setProfile(res.data);
        setBusinessName(res.data.business_name);
        setPhone(res.data.phone ?? '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isProfileValid = businessName.trim().length > 0;
  const isPasswordFormFilled =
    currentPassword.length > 0 && newPassword.length > 0 && confirmPassword.length > 0;

  const handleSaveProfile = () => {
    if (!isProfileValid) return;
    setSavingProfile(true);
    setProfileErrors({});
    setProfileError(null);

    staffApiFetch<{ message: string }>('/api/partner/profile', {
      method: 'PUT',
      body: JSON.stringify({
        business_name: businessName.trim(),
        phone: phone.trim() || null,
      }),
    })
      .then((res) => {
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 422 && err.errors) {
          const mapped: Record<string, string> = {};
          Object.entries(err.errors).forEach(([key, msgs]) => {
            mapped[key] = Array.isArray(msgs) ? msgs[0] : String(msgs);
          });
          setProfileErrors(mapped);
        } else {
          setProfileError(
            err instanceof ApiError
              ? err.message
              : 'Gagal menyimpan. Periksa koneksi internet Anda dan coba lagi.'
          );
        }
      })
      .finally(() => setSavingProfile(false));
  };

  const handleChangePassword = () => {
    if (!isPasswordFormFilled) return;
    if (newPassword !== confirmPassword) {
      setPasswordErrors({ password: 'Konfirmasi password baru tidak cocok.' });
      return;
    }
    setSavingPassword(true);
    setPasswordErrors({});
    setPasswordError(null);

    staffApiFetch<{ message: string }>('/api/partner/change-password', {
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
          setPasswordErrors(mapped);
        } else {
          setPasswordError(
            err instanceof ApiError
              ? err.message
              : 'Gagal mengubah password. Periksa koneksi internet Anda dan coba lagi.'
          );
        }
      })
      .finally(() => setSavingPassword(false));
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
        <Text style={styles.headerTitle} numberOfLines={1}>Edit Profil</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {profile && (
              <View style={styles.codeRow}>
                <Ionicons name="pricetag-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.codeText}>{profile.referral_code}</Text>
                <Text style={styles.codeNote}>Kode referral · tidak dapat diubah</Text>
              </View>
            )}

            {/* ===== Informasi Bisnis ===== */}
            <Text style={styles.sectionTitle}>Informasi Bisnis</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Nama Usaha <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, !!profileErrors.business_name && styles.inputError]}
                  value={businessName}
                  onChangeText={(v) => {
                    setBusinessName(v);
                    if (profileErrors.business_name) {
                      setProfileErrors((prev) => {
                        const next = { ...prev };
                        delete next.business_name;
                        return next;
                      });
                    }
                  }}
                  placeholder="Nama usaha Anda"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="next"
                />
                {!!profileErrors.business_name && (
                  <Text style={styles.fieldError}>{profileErrors.business_name}</Text>
                )}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Nomor Telepon</Text>
                <TextInput
                  style={[styles.input, !!profileErrors.phone && styles.inputError]}
                  value={phone}
                  onChangeText={(v) => {
                    setPhone(v);
                    if (profileErrors.phone) {
                      setProfileErrors((prev) => {
                        const next = { ...prev };
                        delete next.phone;
                        return next;
                      });
                    }
                  }}
                  placeholder="08xxxxxxxxxx"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                />
                {!!profileErrors.phone && (
                  <Text style={styles.fieldError}>{profileErrors.phone}</Text>
                )}
              </View>

              {!!profileError && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                  <Text style={styles.errorBannerText}>{profileError}</Text>
                </View>
              )}

              <Button
                label={savingProfile ? 'Menyimpan...' : 'Simpan Informasi Bisnis'}
                onPress={handleSaveProfile}
                disabled={!isProfileValid || savingProfile}
                style={styles.saveButton}
              />
            </View>

            {/* ===== Ganti Password ===== */}
            <Text style={styles.sectionTitle}>Ganti Password</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Password Lama</Text>
                <TextInput
                  style={[styles.input, !!passwordErrors.current_password && styles.inputError]}
                  value={currentPassword}
                  onChangeText={(v) => {
                    setCurrentPassword(v);
                    if (passwordErrors.current_password) {
                      setPasswordErrors((prev) => {
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
                {!!passwordErrors.current_password && (
                  <Text style={styles.fieldError}>{passwordErrors.current_password}</Text>
                )}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Password Baru</Text>
                <TextInput
                  style={[styles.input, !!passwordErrors.password && styles.inputError]}
                  value={newPassword}
                  onChangeText={(v) => {
                    setNewPassword(v);
                    if (passwordErrors.password) {
                      setPasswordErrors((prev) => {
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
                {!!passwordErrors.password && (
                  <Text style={styles.fieldError}>{passwordErrors.password}</Text>
                )}
              </View>

              {!!passwordError && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                  <Text style={styles.errorBannerText}>{passwordError}</Text>
                </View>
              )}

              <Button
                label={savingPassword ? 'Menyimpan...' : 'Ganti Password'}
                variant="outline"
                onPress={handleChangePassword}
                disabled={!isPasswordFormFilled || savingPassword}
                style={styles.saveButton}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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

  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '700' },
  codeNote: { flex: 1, fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'right' },

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
    marginBottom: spacing.lg,
  },
  fieldGroup: { gap: spacing.xs },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  required: { color: colors.accent },
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
