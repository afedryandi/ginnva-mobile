import React, { useState, useEffect, useMemo } from 'react';
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
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';

interface UpdateProfilePayload {
  name: string;
  phone_number: string | null;
}

interface UpdateProfileResponse {
  message: string;
  data: {
    id: number;
    name: string | null;
    email: string | null;
    phone_number: string | null;
  };
}

export default function EditProfileScreen() {
  const { customer, isLoggedIn, refreshProfile, logout } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Guard: belum login → redirect ke login
  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login' as never);
    }
  }, [isLoggedIn]);

  // Isi form dari data customer yang sudah ada
  useEffect(() => {
    if (customer) {
      setName(customer.name ?? '');
      setPhoneNumber(customer.phone_number ?? '');
    }
  }, [customer]);

  const isFormValid = name.trim().length > 0;

  const handleSave = () => {
    if (!isFormValid) return;

    setSaving(true);
    setFieldErrors({});
    setSaveError(null);

    const payload: UpdateProfilePayload = {
      name: name.trim(),
      phone_number: phoneNumber.trim() || null,
    };

    apiFetch<UpdateProfileResponse>('/api/customer/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
      .then(async () => {
        await refreshProfile();
        Alert.alert('Berhasil', 'Profil berhasil diperbarui.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 422 && err.errors) {
          const mapped: Record<string, string> = {};
          Object.entries(err.errors).forEach(([key, msgs]) => {
            mapped[key] = Array.isArray(msgs) ? msgs[0] : String(msgs);
          });
          setFieldErrors(mapped);
        } else {
          setSaveError(
            err instanceof ApiError
              ? err.message
              : 'Gagal menyimpan. Periksa koneksi internet Anda dan coba lagi.'
          );
        }
      })
      .finally(() => setSaving(false));
  };

  // Wajib ada per kebijakan Google Play — app dengan sistem akun harus
  // sediakan cara hapus akun DARI DALAM app (bukan cuma lewat web).
  // Konfirmasi 2 langkah karena aksi ini permanen & tidak bisa dibatalkan.
  const handleDeleteAccount = () => {
    Alert.alert(
      'Hapus Akun',
      'Semua data pribadi (nama, email, nomor WhatsApp) akan dihapus permanen dan tidak bisa dikembalikan. Riwayat booking & garansi tetap tersimpan di toko untuk keperluan layanan purnajual, tapi tidak lagi terhubung ke identitas Anda. Yakin ingin melanjutkan?',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus Akun',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Konfirmasi Terakhir',
              'Tindakan ini permanen. Lanjutkan hapus akun?',
              [
                { text: 'Batal', style: 'cancel' },
                {
                  text: 'Ya, Hapus',
                  style: 'destructive',
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      await apiFetch('/api/customer/auth/account', { method: 'DELETE' });
                      await logout();
                      router.replace('/(tabs)' as never);
                    } catch (err) {
                      Alert.alert(
                        'Gagal Menghapus Akun',
                        err instanceof ApiError
                          ? err.message
                          : 'Periksa koneksi internet Anda dan coba lagi.'
                      );
                    } finally {
                      setDeleting(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  if (!customer) return null;

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
        <Text style={styles.headerTitle} numberOfLines={1}>Edit Profil</Text>
        <View style={styles.sideButton} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info email — read only, tidak bisa diubah */}
        <View style={styles.emailRow}>
          <Ionicons name="mail-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.emailText}>{customer.email}</Text>
          <Text style={styles.emailNote}>Tidak dapat diubah</Text>
        </View>

        <View style={styles.form}>
          {/* Nama */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Nama Lengkap <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, !!fieldErrors.name && styles.inputError]}
              value={name}
              onChangeText={(v) => {
                setName(v);
                if (fieldErrors.name) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.name;
                    return next;
                  });
                }
              }}
              placeholder="Masukkan nama lengkap Anda"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              returnKeyType="next"
            />
            {!!fieldErrors.name && (
              <Text style={styles.fieldError}>{fieldErrors.name}</Text>
            )}
          </View>

          {/* No. WhatsApp */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>No. WhatsApp</Text>
            <View style={styles.phoneInputWrap}>
              <Text style={styles.phonePrefix}>+62</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.phoneInput,
                  !!fieldErrors.phone_number && styles.inputError,
                ]}
                value={phoneNumber}
                onChangeText={(v) => {
                  setPhoneNumber(v);
                  if (fieldErrors.phone_number) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.phone_number;
                      return next;
                    });
                  }
                }}
                placeholder="81234567890"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                returnKeyType="done"
              />
            </View>
            {!!fieldErrors.phone_number && (
              <Text style={styles.fieldError}>{fieldErrors.phone_number}</Text>
            )}
            <Text style={styles.hint}>
              Digunakan untuk konfirmasi booking & notifikasi garansi
            </Text>
          </View>
        </View>

        {!!saveError && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.errorBannerText}>{saveError}</Text>
          </View>
        )}

        <Button
          label={saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          onPress={handleSave}
          disabled={!isFormValid || saving}
          style={styles.saveButton}
        />

        <View style={styles.dangerZone}>
          <Text style={styles.dangerZoneTitle}>Zona Berbahaya</Text>
          <Pressable
            style={styles.deleteAccountBtn}
            onPress={handleDeleteAccount}
            disabled={deleting}
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.deleteAccountText}>
              {deleting ? 'Menghapus...' : 'Hapus Akun'}
            </Text>
          </Pressable>
        </View>
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
  emailRow: {
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
  emailText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  emailNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  form: {
    gap: spacing.md,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  required: {
    color: colors.accent,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.danger,
  },
  phoneInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  phonePrefix: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '600',
    backgroundColor: colors.surfaceElevated,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  phoneInput: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 0,
  },
  fieldError: {
    fontSize: fontSize.xs,
    color: colors.danger,
    marginTop: 2,
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  errorBannerText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  saveButton: {
    marginTop: spacing.lg,
  },
  dangerZone: {
    marginTop: spacing.xxl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dangerZoneTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteAccountText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.danger,
  },
  });
}
