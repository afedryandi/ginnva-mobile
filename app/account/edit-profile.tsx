import React, { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Alert, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { AuthField, AuthNotice, useAuthSubmitStyle } from '@/components/auth/AuthShell';
import { darkColors, spacing } from '@/constants/theme';
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

// Tampilan didesain ulang (2026-11-24): kepala dengan avatar besar, kolom isian berikon yang sama dengan layar masuk, dan area hapus akun
// yang dipisah jelas. Data, validasi, simpan, dan hapus akun tidak berubah.
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
  const submitStyle = useAuthSubmitStyle(isFormValid && !saving);

  const clearError = (key: string) => {
    if (!fieldErrors[key]) return;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

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
              : 'Gagal menyimpan. Periksa koneksi internetmu dan coba lagi.'
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
      'Semua data pribadi (nama, email, nomor WhatsApp) akan dihapus permanen dan tidak bisa dikembalikan. Riwayat booking & garansi tetap tersimpan di toko untuk keperluan layanan purnajual, tapi tidak lagi terhubung ke identitasmu. Yakin ingin melanjutkan?',
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
                          : 'Periksa koneksi internetmu dan coba lagi.'
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

  const initial = (customer.name || customer.email || '?').charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/account' as never))}
              style={styles.backButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Kembali"
            >
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.topTitle}>Edit Profil</Text>
          </View>

          <FadeInUp style={styles.hero}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            {/* Email hanya-baca: tidak bisa diubah, jadi tampil sebagai kartu terkunci, bukan kolom isian. */}
            <View style={styles.emailChip}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
              <Text style={styles.emailText} numberOfLines={1}>{customer.email}</Text>
            </View>
          </FadeInUp>

          <FadeInUp delay={80} style={styles.form}>
            <AuthField label="Nama lengkap" icon="person-outline" error={fieldErrors.name}>
              {(input) => (
                <TextInput
                  {...input}
                  value={name}
                  onChangeText={(v) => {
                    setName(v);
                    clearError('name');
                  }}
                  placeholder="Masukkan nama lengkap"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              )}
            </AuthField>

            <AuthField
              label="No. WhatsApp"
              prefix="+62"
              hint="Dipakai untuk konfirmasi booking dan notifikasi garansi."
              error={fieldErrors.phone_number}
              gap
            >
              {(input) => (
                <TextInput
                  {...input}
                  value={phoneNumber}
                  onChangeText={(v) => {
                    setPhoneNumber(v.replace(/[^0-9]/g, ''));
                    clearError('phone_number');
                  }}
                  placeholder="81234567890"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                />
              )}
            </AuthField>

            {saveError ? <AuthNotice kind="error" message={saveError} /> : null}

            <Button
              label={saving ? 'Menyimpan...' : 'Simpan Perubahan'}
              onPress={handleSave}
              disabled={!isFormValid || saving}
              style={submitStyle as never}
            />
          </FadeInUp>

          <FadeInUp delay={140} style={styles.dangerCard}>
            <View style={styles.dangerHead}>
              <View style={styles.dangerIcon}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </View>
              <View style={styles.dangerText}>
                <Text style={styles.dangerTitle}>Hapus akun</Text>
                <Text style={styles.dangerDesc}>Data pribadi dihapus permanen dan tidak bisa dikembalikan.</Text>
              </View>
            </View>
            <PressableScale style={styles.deleteButton} onPress={handleDeleteAccount} disabled={deleting} accessibilityRole="button">
              <Text style={styles.deleteText}>{deleting ? 'Menghapus...' : 'Hapus Akun'}</Text>
            </PressableScale>
          </FadeInUp>
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
    scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.xl },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },

    hero: { alignItems: 'center', marginTop: 28, gap: 12 },
    avatar: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    // SENGAJA putih tetap: duduk di atas merah pekat yang sama di kedua tema.
    avatarText: { fontSize: 36, fontWeight: '800', color: '#ffffff' },
    emailChip: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.surfaceElevated },
    emailText: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: colors.textSecondary },

    form: { marginTop: 32 },

    dangerCard: { marginTop: 40, padding: 18, gap: 14, borderRadius: 24, backgroundColor: colors.dangerBg },
    dangerHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    dangerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    dangerText: { flex: 1, gap: 2 },
    dangerTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    dangerDesc: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    deleteButton: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.danger },
    deleteText: { fontSize: 14, fontWeight: '800', color: colors.danger },
  });
}
