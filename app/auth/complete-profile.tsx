import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { AuthShell, AuthField, AuthNotice, useAuthSubmitStyle } from '@/components/auth/AuthShell';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';
import { consumePendingReferralCode } from '@/lib/referral-attribution';

// Tampilan disamakan dengan layar masuk (2026-11-24) lewat AuthShell; alur dan panggilan API tidak berubah.
export default function CompleteProfileScreen() {
  const { isNew } = useLocalSearchParams<{ isNew?: string }>();
  const { refreshProfile } = useAuth();
  const { colors } = useAppTheme();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = name.trim().length > 0 && phone.trim().length >= 8;
  const submitStyle = useAuthSubmitStyle(isValid && !loading);

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
            : 'Gagal menyimpan profil. Periksa koneksi internetmu.'
        );
      })
      .finally(() => setLoading(false));
  };

  return (
    <AuthShell
      eyebrowIcon="person-add-outline"
      eyebrow={isNew === '1' ? 'Akun baru' : 'Profil'}
      title={'Lengkapi\nprofil kamu'}
      subtitle="Sebelum mulai, kami perlu nama dan nomor WhatsApp agar tim kami mudah menghubungi."
    >
      <AuthField label="Nama lengkap" icon="person-outline">
        {(input) => (
          <TextInput
            {...input}
            placeholder="Nama lengkap"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
          />
        )}
      </AuthField>

      <AuthField label="Nomor WhatsApp" prefix="+62" hint="Contoh: 81234567890 (tanpa angka 0 di depan)" gap>
        {(input) => (
          <TextInput
            {...input}
            placeholder="8xxxxxxxxxx"
            placeholderTextColor={colors.textMuted}
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, ''))}
            keyboardType="phone-pad"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
        )}
      </AuthField>

      {isNew === '1' ? (
        <AuthField label="Kode referral teman (opsional)" icon="gift-outline" hint="Diajak teman pakai Ginnva App? Masukkan kode referral-nya di sini." gap>
          {(input) => (
            <TextInput
              {...input}
              placeholder="Contoh: AB12CD"
              placeholderTextColor={colors.textMuted}
              value={referralCode}
              onChangeText={(v) => setReferralCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          )}
        </AuthField>
      ) : null}

      {error ? <AuthNotice kind="error" message={error} /> : null}

      <Button label="Simpan & Mulai" onPress={handleSubmit} disabled={!isValid} loading={loading} style={submitStyle as never} />

      <Text style={[styles.note, { color: colors.textMuted }]}>Informasi ini bisa diubah kapan saja di halaman Akun.</Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 18 },
});
