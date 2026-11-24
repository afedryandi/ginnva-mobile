import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { staffApiFetch } from '@/lib/staff-api';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { useAppTheme } from '@/lib/theme-context';

// Layar login TERPADU — user cukup masukkan email, app otomatis deteksi
// apakah ini akun staff (tampilkan password) atau customer (lanjut ke
// OTP seperti biasa). Tidak perlu lagi ada 2 pintu login terpisah yang
// harus dipilih manual oleh user.
//
// Tampilan didesain ulang (2026-11-24): tanpa bilah judul, logo di kiri atas, judul besar rata kiri, kolom isian berisi
// ikon dengan sorotan merah saat aktif, dan tombol utama besar. Alur dan panggilan API tidak berubah.
export default function LoginScreen() {
  const { login: staffLogin } = useStaffAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [step, setStep] = useState<'email' | 'staff-password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<'login' | 'password' | null>(null);
  // Satu layar untuk pelanggan dan karyawan. Teksnya ditujukan ke pelanggan (email), tetapi isian tetap menerima No. HP untuk karyawan;
  // server menentukan jalurnya (lihat handleContinue).
  const isEmailInput = email.includes('@');
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isValidPhone = /^[+\d\s\-()]+$/.test(email.trim()) && email.replace(/\D/g, '').length >= 9;
  const isValidLogin = isEmailInput ? isValidEmail : isValidPhone;

  const handleContinue = () => {
    if (!isValidLogin || loading) return;

    setLoading(true);
    setError(null);

    apiFetch<{ role: 'staff' | 'customer' | 'unknown' }>('/api/auth/detect-role', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ login: email.trim() }),
    })
      .then((res) => {
        if (res.role === 'staff') {
          setStep('staff-password');
          return;
        }
        if (res.role === 'unknown') {
          setError('Nomor ini belum terdaftar. Masukkan email untuk daftar atau masuk.');
          return;
        }
        return requestOtp();
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal memproses. Periksa koneksi internetmu.'
        );
      })
      .finally(() => setLoading(false));
  };

  const requestOtp = () => {
    // Email atau No. HP dikirim apa adanya; untuk No. HP pelanggan, server mengirim kode ke email akunnya dan mengembalikan email tersamar.
    return apiFetch<{ message: string; email_hint?: string }>('/api/customer/auth/request-otp', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ login: email.trim() }),
    }).then((res) => {
      router.push({
        pathname: '/auth/verify',
        params: { login: email.trim(), hint: res.email_hint ?? '' },
      } as never);
    });
  };

  const handleStaffLogin = () => {
    if (!password || loading) return;

    setLoading(true);
    setError(null);

    staffApiFetch<{ token: string; user: any }>('/api/staff/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ login: email.trim(), password }),
    })
      .then(async (res) => {
        await staffLogin(res.token, res.user);
        // Partner (mitra referral) login lewat endpoint yang sama dengan
        // staff, tapi diarahkan ke dashboard partner. Staff APA PUN
        // kombinasi aksesnya (booking, inventaris, atau keduanya) sekarang
        // SELALU diarahkan ke halaman awal staff terpusat — grid menu di
        // sana sendiri yang menyaring kotak mana yang tampil sesuai
        // has_*_access, bukan lagi dipilihkan lewat 2 destinasi berbeda
        // seperti sebelumnya (diminta user 2026-09-07).
        const destination = res.user.role === 'partner' ? '/partner/dashboard' : '/staff';
        router.replace(destination as never);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal masuk. Periksa koneksi internetmu.'
        );
      })
      .finally(() => setLoading(false));
  };

  const isStaffStep = step === 'staff-password';
  const backToEmail = () => { setStep('email'); setPassword(''); setError(null); };
  const account = email.trim();
  const loginIcon = isEmailInput || email === '' ? 'mail-outline' : 'call-outline';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      {/* Sorotan merah lembut di sudut atas: satu-satunya dekorasi, supaya layar tetap bersih. */}
      <LinearGradient
        pointerEvents="none"
        colors={[colors.accentSoft, 'transparent']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 1 }}
        style={styles.glow}
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            {isStaffStep ? (
              <Pressable onPress={backToEmail} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
                <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
              </Pressable>
            ) : null}
            <Image source={require('@/assets/images/ginnva-logo-red.webp')} style={styles.logo} contentFit="contain" accessibilityLabel="Ginnva" />
          </View>

          <FadeInUp key={step} style={styles.hero}>
            <View style={styles.eyebrow}>
              <Ionicons name={isStaffStep ? 'briefcase-outline' : 'sparkles-outline'} size={14} color={colors.accent} />
              <Text style={styles.eyebrowText}>{isStaffStep ? 'Akun karyawan' : 'Selamat datang'}</Text>
            </View>
            <Text style={styles.title}>{isStaffStep ? 'Masukkan\npassword' : 'Masuk atau\ndaftar di Ginnva'}</Text>
            {isStaffStep ? null : (
              <Text style={styles.subtitle}>Pakai email untuk masuk atau mendaftar. Kode verifikasi dikirim ke email tersebut.</Text>
            )}
          </FadeInUp>

          <FadeInUp key={`${step}-form`} delay={90} style={styles.form}>
            {isStaffStep ? (
              <>
                {/* Akun tetap berupa kolom (hanya baca) supaya pengelola password di HP tahu pasangan username-password yang disimpan. */}
                <Text style={styles.fieldLabel}>Akun</Text>
                <View style={styles.accountChip}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(account[0] ?? '?').toUpperCase()}</Text>
                  </View>
                  <TextInput
                    style={styles.accountInput}
                    value={account}
                    editable={false}
                    autoComplete="username"
                    textContentType="username"
                    importantForAutofill="yes"
                  />
                  <Pressable onPress={backToEmail} hitSlop={8} accessibilityRole="button" accessibilityLabel="Ganti akun">
                    <Text style={styles.changeText}>Ganti</Text>
                  </Pressable>
                </View>

                <Text style={[styles.fieldLabel, styles.fieldGap]}>Password</Text>
                <View style={[styles.field, focused === 'password' && styles.fieldFocused]}>
                  <Ionicons name="lock-closed-outline" size={20} color={focused === 'password' ? colors.accent : colors.textMuted} />
                  <View style={styles.fieldInputWrap}>
                    <PasswordInput
                      style={styles.fieldInput}
                      autoComplete="current-password"
                      textContentType="password"
                      importantForAutofill="yes"
                      placeholder="Password akun"
                      placeholderTextColor={colors.textMuted}
                      value={password}
                      onChangeText={setPassword}
                      autoFocus
                      onFocus={() => setFocused('password')}
                      onBlur={() => setFocused((f) => (f === 'password' ? null : f))}
                      onSubmitEditing={handleStaffLogin}
                    />
                  </View>
                </View>

                {error ? <ErrorNote message={error} styles={styles} color={colors.danger} /> : null}

                <Button label="Masuk" onPress={handleStaffLogin} disabled={!password} loading={loading} style={[styles.submitButton, password && !loading ? styles.submitGlow : null] as never} />

                <Pressable
                  style={styles.forgotPasswordLink}
                  onPress={() => {
                    if (!isEmailInput) {
                      // Reset lewat kode dikirim ke email; karyawan yang masuk dengan No. HP meminta admin mengatur ulang.
                      setError('Lupa password? Hubungi admin untuk mengatur ulang password akunmu.');
                      return;
                    }
                    router.push({ pathname: '/auth/staff-forgot-password', params: { email: account } } as never);
                  }}
                >
                  <Text style={styles.forgotPasswordText}>Lupa password?</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Email</Text>
                <View style={[styles.field, focused === 'login' && styles.fieldFocused]}>
                  <Ionicons name={loginIcon} size={20} color={focused === 'login' ? colors.accent : colors.textMuted} />
                  <TextInput
                    style={[styles.fieldInput, styles.fieldInputWrap]}
                    placeholder="nama@email.com"
                    placeholderTextColor={colors.textMuted}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="default"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    importantForAutofill="yes"
                    onFocus={() => setFocused('login')}
                    onBlur={() => setFocused((f) => (f === 'login' ? null : f))}
                    onSubmitEditing={handleContinue}
                  />
                </View>

                {error ? <ErrorNote message={error} styles={styles} color={colors.danger} /> : null}

                <Button label="Lanjutkan" onPress={handleContinue} disabled={!isValidLogin} loading={loading} style={[styles.submitButton, isValidLogin && !loading ? styles.submitGlow : null] as never} />

                <View style={styles.hint}>
                  <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
                  <Text style={styles.hintText}>Belum punya akun? Akun dibuat otomatis setelah verifikasi.</Text>
                </View>
              </>
            )}
          </FadeInUp>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ErrorNote({ message, styles, color }: { message: string; styles: ReturnType<typeof createStyles>; color: string }) {
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={18} color={color} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
    scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.xl },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    logo: { width: 124, height: 32 },

    hero: { marginTop: 48, gap: 12 },
    eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.accentSoft },
    eyebrowText: { fontSize: 12, fontWeight: '700', color: colors.accent },
    title: { fontSize: 34, lineHeight: 42, fontWeight: '800', letterSpacing: -1, color: colors.textPrimary },
    subtitle: { fontSize: 15, lineHeight: 23, color: colors.textSecondary, maxWidth: 340 },

    form: { marginTop: 36 },
    fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 8, marginLeft: 4 },
    fieldGap: { marginTop: 18 },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      height: 58,
      paddingHorizontal: 18,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: 'transparent',
      backgroundColor: colors.surfaceElevated,
    },
    fieldFocused: { borderColor: colors.accent, backgroundColor: colors.bg },
    fieldInputWrap: { flex: 1 },
    // Tanpa flex: di dalam pembungkus tanpa tinggi tetap (PasswordInput) flex:1 membuat kolom runtuh jadi tinggi nol.
    fieldInput: { height: 56, fontSize: 16, color: colors.textPrimary, padding: 0 },

    accountChip: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingLeft: 10, paddingRight: 18, borderRadius: 20, backgroundColor: colors.surfaceElevated },
    avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    avatarText: { fontSize: 15, fontWeight: '800', color: colors.accent },
    accountInput: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },
    changeText: { fontSize: 13, fontWeight: '800', color: colors.accent },

    errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: colors.dangerBg },
    errorText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.danger, fontWeight: '600' },

    submitButton: { height: 58, borderRadius: 29, marginTop: 24, width: '100%' },
    submitGlow: { shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 16, elevation: 6 },

    hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22, paddingHorizontal: 8 },
    hintText: { flexShrink: 1, fontSize: 13, lineHeight: 19, color: colors.textMuted, textAlign: 'center' },

    forgotPasswordLink: { alignSelf: 'center', marginTop: 12, paddingVertical: 10, paddingHorizontal: 16 },
    forgotPasswordText: { fontSize: 14, fontWeight: '700', color: colors.accent },
  });
}
