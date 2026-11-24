import React, { useMemo, useRef, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform, type TextInput as RNTextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { darkColors, spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface AuthShellProps {
  eyebrowIcon: IconName;
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
  /** Bila diisi, tombol kembali bulat muncul di sebelah logo. */
  onBack?: () => void;
  /** Kunci animasi: ganti nilainya saat tahap berganti supaya judul dan formulir muncul lagi. */
  stepKey?: string;
  children: React.ReactNode;
}

/**
 * Kerangka layar masuk/verifikasi/reset/lengkapi profil (2026-11-24): sorotan merah lembut di sudut atas, logo kiri atas, label kecil,
 * judul besar rata kiri, lalu formulir. Dipakai bersama supaya semua layar di alur masuk terasa satu rangkaian.
 */
export function AuthShell({ eyebrowIcon, eyebrow, title, subtitle, onBack, stepKey = 'main', children }: AuthShellProps) {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            {onBack ? (
              <Pressable onPress={onBack} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
                <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
              </Pressable>
            ) : null}
            <Image source={require('@/assets/images/ginnva-logo-red.webp')} style={styles.logo} contentFit="contain" accessibilityLabel="Ginnva" />
          </View>

          <FadeInUp key={stepKey} style={styles.hero}>
            <View style={styles.eyebrow}>
              <Ionicons name={eyebrowIcon} size={14} color={colors.accent} />
              <Text style={styles.eyebrowText}>{eyebrow}</Text>
            </View>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </FadeInUp>

          <FadeInUp key={`${stepKey}-form`} delay={90} style={styles.form}>
            {children}
          </FadeInUp>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface AuthFieldProps {
  label: string;
  icon?: IconName;
  /** Teks tetap di kiri isian (mis. +62). */
  prefix?: string;
  hint?: string;
  /** Pesan galat per kolom: bingkai jadi merah dan menggantikan petunjuk. */
  error?: string;
  gap?: boolean;
  /** Isian beberapa baris: tinggi menyesuaikan, ikon di atas. */
  multiline?: boolean;
  children: (input: { onFocus: () => void; onBlur: () => void; style: object }) => React.ReactNode;
}

/** Kolom isian berlatar abu muda; bingkai dan ikonnya menjadi merah saat sedang diisi. */
export function AuthField({ label, icon, prefix, hint, error, gap, multiline, children }: AuthFieldProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);

  return (
    <View style={gap ? styles.fieldGap : undefined}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.field, multiline && styles.fieldMulti, focused && styles.fieldFocused, error ? styles.fieldError : null]}>
        {icon ? <Ionicons name={icon} size={20} color={error ? colors.danger : focused ? colors.accent : colors.textMuted} /> : null}
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <View style={styles.fieldInputWrap}>{children({ onFocus: () => setFocused(true), onBlur: () => setFocused(false), style: multiline ? styles.fieldInputMulti : styles.fieldInput })}</View>
      </View>
      {error ? <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Pesan galat (merah) atau keberhasilan (hijau) dengan ikon. */
export function AuthNotice({ kind, message }: { kind: 'error' | 'success'; message: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isError = kind === 'error';

  return (
    <View style={[styles.notice, { backgroundColor: isError ? colors.dangerBg : colors.successBg }]} accessibilityRole={isError ? 'alert' : undefined}>
      <Ionicons name={isError ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={18} color={isError ? colors.danger : colors.success} />
      <Text style={[styles.noticeText, { color: isError ? colors.danger : colors.success }]}>{message}</Text>
    </View>
  );
}

interface OtpBoxesProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  hasError?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
}

/** Kode verifikasi dalam kotak-kotak; satu isian tak terlihat menampungnya, jadi kode dari SMS/email bisa terisi otomatis. */
export function OtpBoxes({ value, onChange, length = 6, hasError, disabled, autoFocus, onSubmit }: OtpBoxesProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [focused, setFocused] = useState(!!autoFocus);
  const inputRef = useRef<RNTextInput>(null);
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.codeRow} accessibilityLabel="Kolom kode verifikasi">
      {Array.from({ length }, (_, i) => {
        const digit = value[i] ?? '';
        const isActive = focused && i === activeIndex && !disabled;

        return (
          <View key={i} style={[styles.codeBox, digit !== '' && styles.codeBoxFilled, isActive && styles.codeBoxActive, hasError ? styles.codeBoxError : null]}>
            <Text style={styles.codeDigit}>{digit}</Text>
          </View>
        );
      })}
      <TextInput
        ref={inputRef as never}
        style={styles.hiddenInput}
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9]/g, '').slice(0, length))}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={autoFocus}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        importantForAutofill="yes"
        caretHidden
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmit}
      />
    </Pressable>
  );
}

/** Gaya tombol utama besar: dipakai bersama `Button` supaya sama di semua layar masuk. */
export function useAuthSubmitStyle(active: boolean) {
  const { colors } = useAppTheme();

  return useMemo(
    () => ({
      height: 58,
      borderRadius: 29,
      marginTop: 24,
      width: '100%' as const,
      ...(active ? { shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 16, elevation: 6 } : null),
    }),
    [active, colors.accent]
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
    fieldGap: { marginTop: 18 },
    fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 8, marginLeft: 4 },
    field: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 58, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    fieldFocused: { borderColor: colors.accent, backgroundColor: colors.bg },
    fieldError: { borderColor: colors.danger },
    fieldInputWrap: { flex: 1 },
    // Tanpa flex: pembungkusnya tidak bertinggi tetap, flex:1 membuat kolom runtuh jadi tinggi nol.
    fieldMulti: { height: undefined, minHeight: 58, alignItems: 'flex-start', paddingVertical: 17 },
    fieldInputMulti: { minHeight: 90, fontSize: 16, lineHeight: 22, color: colors.textPrimary, padding: 0, textAlignVertical: 'top' },
    fieldInput: { height: 56, fontSize: 16, color: colors.textPrimary, padding: 0 },
    prefix: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    hint: { fontSize: 12, lineHeight: 18, color: colors.textMuted, marginTop: 8, marginLeft: 4 },

    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16, padding: 14, borderRadius: 16 },
    noticeText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },

    codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    codeBox: { flex: 1, height: 64, maxWidth: 56, borderRadius: 18, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    codeBoxFilled: { backgroundColor: colors.bg, borderColor: colors.borderStrong },
    codeBoxActive: { backgroundColor: colors.bg, borderColor: colors.accent },
    codeBoxError: { borderColor: colors.danger },
    codeDigit: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
    hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: 'transparent' },
  });
}
