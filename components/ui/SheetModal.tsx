import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon: IconName;
  /** danger = ikon dan penekanan merah (pembatalan); accent = merek (jadwal ulang). */
  tone?: 'accent' | 'danger';
  children?: React.ReactNode;
  /** Tombol di dasar lembar (pakai SheetButton). */
  actions: React.ReactNode;
}

/**
 * Lembar bawah bersama (2026-11-24): garis pegangan, ikon dalam lingkaran, judul besar, keterangan, isi yang bisa digulir, dan tombol pil di dasar.
 * Diangkat tepat di atas keyboard lewat useKeyboardLift (tidak dua kali di perangkat yang jendelanya sudah dikecilkan sistem).
 * Dipakai oleh lembar pengajuan pembatalan, pembatalan booking, dan jadwal ulang.
 */
export function SheetModal({ visible, onClose, title, subtitle, icon, tone = 'accent', children, actions }: SheetModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { keyboardVisible, lift, onBoxLayout } = useKeyboardLift();
  const danger = tone === 'danger';

  return (
    <Modal visible={visible} transparent animationType={Platform.OS === 'ios' ? 'slide' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }} onLayout={onBoxLayout}>
        <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Tutup" />
        <View style={[styles.sheet, { marginBottom: lift, paddingBottom: keyboardVisible ? 16 : insets.bottom + 16, maxHeight: keyboardVisible ? '62%' : '90%' }]}>
          <View style={styles.handle} />

          <View style={styles.headRow}>
            <View style={[styles.icon, danger && styles.iconDanger]}>
              <Ionicons name={icon} size={24} color={danger ? colors.danger : colors.accent} />
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Tutup">
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          {children ? (
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          ) : null}

          <View style={styles.actions}>{actions}</View>
        </View>
      </View>
    </Modal>
  );
}

interface SheetButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'ghost' | 'primary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}

/** Tombol pil di dasar lembar; dua tombol berdampingan dengan lebar sama. */
export function SheetButton({ label, onPress, variant = 'ghost', disabled, loading }: SheetButtonProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const filled = variant !== 'ghost';
  const off = disabled || loading;

  return (
    <PressableScale
      style={[styles.btn, variant === 'ghost' && styles.btnGhost, variant === 'primary' && { backgroundColor: colors.accent }, variant === 'danger' && { backgroundColor: colors.danger }, off && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
    >
      {loading ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={[styles.btnText, filled && { color: '#ffffff' }]}>{label}</Text>}
    </PressableScale>
  );
}

interface SheetTextInputProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  multiline?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
}

/** Kolom isian lembut dengan bingkai merah saat diisi, dan hitungan karakter bila ada batas. */
export function SheetTextInput({ label, value, onChangeText, placeholder, multiline, maxLength, autoFocus }: SheetTextInputProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {maxLength ? <Text style={styles.count}>{value.length}/{maxLength}</Text> : null}
      </View>
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <TextInput
          style={[styles.fieldInput, multiline && styles.fieldMulti]}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          maxLength={maxLength}
          multiline={multiline}
          autoFocus={autoFocus}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
    </View>
  );
}

/** Kotak catatan berwarna dengan ikon (info, peringatan, atau bahaya). */
export function SheetNote({ tone, icon, text }: { tone: 'info' | 'warning' | 'danger'; icon: IconName; text: string }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bg = tone === 'danger' ? colors.dangerBg : tone === 'warning' ? colors.warningBg : colors.accentSoft;
  const fg = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.accent;

  return (
    <View style={[styles.note, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={[styles.noteText, { color: tone === 'info' ? colors.textSecondary : fg }]}>{text}</Text>
    </View>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: 24, paddingTop: 10 },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 14 },
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    iconDanger: { backgroundColor: colors.dangerBg },
    close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    title: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary, marginTop: 14 },
    subtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginTop: 6 },
    body: { flexGrow: 0, marginTop: 16 },
    bodyContent: { gap: 14, paddingBottom: 4 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 18 },

    btn: { flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
    btnGhost: { backgroundColor: colors.surfaceElevated },
    btnText: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },

    labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 },
    label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    count: { fontSize: 12, color: colors.textMuted },
    field: { borderRadius: 20, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    fieldFocused: { borderColor: colors.accent, backgroundColor: colors.bg },
    fieldInput: { minHeight: 54, paddingHorizontal: 18, paddingVertical: 14, fontSize: 15, color: colors.textPrimary },
    fieldMulti: { minHeight: 104, lineHeight: 22 },

    note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 18 },
    noteText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  });
}
