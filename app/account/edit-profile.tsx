import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

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
  const { customer, isLoggedIn, refreshProfile } = useAuth();

  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

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

  if (!customer) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Edit Profil" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info email — read only, tidak bisa diubah */}
        <View style={styles.emailRow}>
          <Ionicons name="mail-outline" size={16} color={colors.muted} />
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
              placeholderTextColor={colors.mutedLight}
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
                placeholderTextColor={colors.mutedLight}
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
    paddingBottom: spacing.xxl,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface ?? '#f5f5f5',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  emailText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.muted,
    fontWeight: '600',
  },
  emailNote: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
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
    color: colors.ink,
  },
  required: {
    color: colors.accent,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.sm,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  inputError: {
    borderColor: colors.danger,
  },
  phoneInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  phonePrefix: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.sm,
    color: colors.muted,
    fontWeight: '600',
    backgroundColor: colors.surface ?? '#f5f5f5',
    borderRightWidth: 1,
    borderRightColor: colors.line,
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
    color: colors.mutedLight,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#fef2f2',
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
});