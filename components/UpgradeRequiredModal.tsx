import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { onUpgradeRequired, UpgradeInfo } from '@/lib/upgrade';

// Layar pemblokir "Perbarui Aplikasi" (Fase 0 pengerjaan ulang booking, 2026-10-14). Tampil ketika server menjawab 426
// (versi aplikasi di bawah versi minimum, lihat lib/upgrade.ts). Sengaja tanpa tombol tutup: aplikasi lama tidak boleh
// dilanjutkan karena kontrak API-nya sudah tidak cocok.
export default function UpgradeRequiredModal() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [info, setInfo] = useState<UpgradeInfo | null>(null);

  useEffect(() => onUpgradeRequired(setInfo), []);

  if (!info) return null;

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="cloud-download-outline" size={40} color={colors.accent} />
        </View>
        <Text style={styles.title}>Perbarui Aplikasi</Text>
        <Text style={styles.message}>{info.message}</Text>
        {info.minVersion ? <Text style={styles.hint}>Versi minimum: {info.minVersion}</Text> : null}
        {info.storeUrl ? (
          <Pressable
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
            onPress={() => Linking.openURL(info.storeUrl as string).catch(() => {})}
            accessibilityRole="button"
            accessibilityLabel="Perbarui aplikasi di toko aplikasi"
          >
            <Text style={styles.buttonText}>Perbarui Sekarang</Text>
          </Pressable>
        ) : (
          <Text style={styles.hint}>Buka toko aplikasi di HPmu lalu perbarui aplikasi Ginnva.</Text>
        )}
      </View>
    </Modal>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.sm,
    },
    iconWrap: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    message: { fontSize: fontSize.base, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
    hint: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
    button: {
      marginTop: spacing.md,
      minHeight: 48,
      paddingHorizontal: spacing.xl,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: { color: '#ffffff', fontSize: fontSize.base, fontWeight: '700' },
  });
}
