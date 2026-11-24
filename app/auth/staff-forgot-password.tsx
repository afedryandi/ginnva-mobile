import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { AuthShell, AuthField, AuthNotice, OtpBoxes, useAuthSubmitStyle } from '@/components/auth/AuthShell';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

// Alur reset password untuk akun non-customer (staff/admin toko/direksi/
// installer, DAN partner referral GIIAS yang akunnya dibuat dengan
// password acak lewat Become a Partner — endpoint backend cuma cek email
// di tabel users, tidak dibatasi role tertentu) — beda dari customer yang
// pakai OTP untuk login itu sendiri, di sini kode OTP dipakai murni untuk
// verifikasi identitas sebelum ganti password, akun tetap pakai
// email+password seperti biasa setelahnya.
//
// Tampilan disamakan dengan layar masuk (2026-11-24) lewat AuthShell; alur dan panggilan API tidak berubah.
type Step = 'request' | 'reset';

export default function StaffForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { colors } = useAppTheme();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isValidCode = code.trim().length === 6;
  const isValidPassword = newPassword.length >= 8 && newPassword === confirmPassword;
  const canRequest = isValidEmail && !loading;
  const canReset = isValidCode && isValidPassword && !loading;
  const requestStyle = useAuthSubmitStyle(canRequest);
  const resetStyle = useAuthSubmitStyle(canReset);
  const doneStyle = useAuthSubmitStyle(true);

  const handleRequestCode = () => {
    if (!isValidEmail || loading) return;
    setLoading(true);
    setError(null);

    staffApiFetch<{ message: string }>('/api/staff/auth/forgot-password', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email: email.trim() }),
    })
      .then((res) => {
        setSuccessMessage(res.message);
        setStep('reset');
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memproses. Periksa koneksi internetmu.'
        );
      })
      .finally(() => setLoading(false));
  };

  const handleResetPassword = () => {
    if (!isValidCode || !isValidPassword || loading) return;
    setLoading(true);
    setError(null);

    staffApiFetch<{ message: string }>('/api/staff/auth/reset-password', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({
        email: email.trim(),
        code: code.trim(),
        password: newPassword,
        password_confirmation: confirmPassword,
      }),
    })
      .then(() => {
        setDone(true);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal mengubah password. Periksa koneksi internetmu.'
        );
      })
      .finally(() => setLoading(false));
  };

  if (done) {
    return (
      <AuthShell
        stepKey="done"
        eyebrowIcon="checkmark-circle-outline"
        eyebrow="Selesai"
        title={'Password\nberhasil diubah'}
        subtitle="Silakan masuk kembali dengan password baru."
      >
        <Button label="Kembali ke Login" onPress={() => router.replace('/auth/login' as never)} style={doneStyle as never} />
      </AuthShell>
    );
  }

  const mismatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <AuthShell
      stepKey={step}
      onBack={() => (step === 'reset' ? setStep('request') : router.back())}
      eyebrowIcon={step === 'request' ? 'key-outline' : 'shield-checkmark-outline'}
      eyebrow="Reset password"
      title={step === 'request' ? 'Lupa\npassword?' : 'Kode dan\npassword baru'}
      subtitle={
        step === 'request'
          ? 'Masukkan email akun karyawan. Kode verifikasi 6 digit dikirim ke email itu untuk memastikan ini memang kamu.'
          : successMessage ?? `Kode 6 digit sudah dikirim ke ${email.trim()}.`
      }
    >
      {step === 'request' ? (
        <>
          <AuthField label="Alamat email" icon="mail-outline">
            {(input) => (
              <TextInput
                {...input}
                placeholder="nama@ginnva.id"
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleRequestCode}
              />
            )}
          </AuthField>

          {error ? <AuthNotice kind="error" message={error} /> : null}

          <Button label="Kirim Kode Verifikasi" onPress={handleRequestCode} disabled={!isValidEmail} loading={loading} style={requestStyle as never} />
        </>
      ) : (
        <>
          <Text style={styles.sectionLabel}>Kode verifikasi</Text>
          <OtpBoxes value={code} onChange={setCode} hasError={!!error && !isValidCode} autoFocus />

          <AuthField label="Password baru" icon="lock-closed-outline" gap>
            {(input) => (
              <PasswordInput {...input} placeholder="Minimal 8 karakter" placeholderTextColor={colors.textMuted} value={newPassword} onChangeText={setNewPassword} />
            )}
          </AuthField>

          <AuthField label="Konfirmasi password baru" icon="lock-closed-outline" gap>
            {(input) => (
              <PasswordInput
                {...input}
                placeholder="Ulangi password baru"
                placeholderTextColor={colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onSubmitEditing={handleResetPassword}
              />
            )}
          </AuthField>

          {mismatch ? <AuthNotice kind="error" message="Password tidak sama." /> : null}
          {error ? <AuthNotice kind="error" message={error} /> : null}

          <Button label="Ubah Password" onPress={handleResetPassword} disabled={!isValidCode || !isValidPassword} loading={loading} style={resetStyle as never} />

          <Pressable style={styles.resendLink} onPress={handleRequestCode} disabled={loading} accessibilityRole="button">
            <Text style={[styles.resendText, { color: colors.accent }]}>Tidak menerima kode? Kirim ulang</Text>
          </Pressable>
        </>
      )}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 13, fontWeight: '700', marginBottom: 8, marginLeft: 4, opacity: 0.7 },
  resendLink: { alignSelf: 'center', marginTop: 12, paddingVertical: 10, paddingHorizontal: 16 },
  resendText: { fontSize: 14, fontWeight: '700' },
});
