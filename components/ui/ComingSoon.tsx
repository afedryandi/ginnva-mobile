import React, { useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { darkColors, spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

interface ComingSoonProps {
  title: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

/**
 * Gate "Coming Soon" sementara (2026-09-30, diminta user) untuk fitur
 * Poin & Tukar Reward -- fitur BACKEND-nya sendiri tetap live & jalan
 * diam-diam (poin tetap terkumpul dari garansi/referral/booking), cuma
 * layarnya yang ditutup sementara sampai katalog reward/tim siap.
 * Halaman asli TIDAK dihapus -- lihat komentar "GATE COMING SOON" di
 * setiap file yang pakai komponen ini utk cara mencabutnya nanti.
 *
 * Tampilan didesain ulang (2026-11-24): sorotan merah lembut, ikon di tengah cincin berlapis, judul layar sebagai judul besar.
 */
export default function ComingSoon({ title, message, icon = 'time-outline' }: ComingSoonProps) {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>

      <FadeInUp style={styles.center}>
        <View style={styles.ringOuter}>
          <View style={styles.ringInner}>
            <Ionicons name={icon} size={38} color={colors.accent} />
          </View>
        </View>

        <View style={styles.badge}>
          <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
          <Text style={styles.badgeText}>Segera hadir</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>
          {message ?? 'Fitur ini sedang disiapkan dan segera bisa dipakai.'}
        </Text>
      </FadeInUp>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
    topRow: { minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, justifyContent: 'center' },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32, paddingBottom: 72 },
    ringOuter: { width: 148, height: 148, borderRadius: 74, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, marginBottom: 12 },
    ringInner: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.accentSoft },
    badgeText: { fontSize: 12, fontWeight: '700', color: colors.accent },
    title: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary, textAlign: 'center' },
    message: { fontSize: 15, lineHeight: 23, color: colors.textSecondary, textAlign: 'center', maxWidth: 300 },
  });
}
