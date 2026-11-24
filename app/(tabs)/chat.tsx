/**
 * app/(tabs)/chat.tsx
 *
 * Hub tab "Asisten" — dipecah jadi 2 pilihan sesuai arahan product owner:
 * 1. Asisten AI (app/assistant/ai.tsx) — chatbot produk/garansi/FAQ.
 * 2. Chat dengan Toko — percakapan + progress instalasi per booking
 *    (app/booking/[id]/chat.tsx). Kalau customer cuma punya SATU booking
 *    aktif (non-cancelled), langsung diarahkan ke chat booking itu —
 *    bukan ke daftar Booking Saya dulu — supaya "Chat dengan Toko" benar-
 *    benar membuka chat seperti yang dijanjikan labelnya, bukan cuma
 *    daftar. Kalau 0 atau lebih dari 1 booking, tetap ke daftar Booking
 *    Saya (app/account/my-bookings.tsx) seperti biasa.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';

interface BookingSummary {
  id: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
}

export default function AssistantHubScreen() {
  const { isLoggedIn } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [checkingBookings, setCheckingBookings] = useState(false);

  const handleStorePress = async () => {
    // Guest — my-bookings.tsx sudah menampilkan prompt login sendiri,
    // tidak perlu dicek di sini.
    if (!isLoggedIn || checkingBookings) {
      router.push('/account/my-bookings' as never);
      return;
    }

    setCheckingBookings(true);
    try {
      const res = await apiFetch<{ data: BookingSummary[] }>('/api/customer/bookings');
      const eligible = res.data.filter((b) => b.status !== 'cancelled');
      if (eligible.length === 1) {
        router.push(`/booking/${eligible[0].id}/chat` as never);
      } else {
        router.push('/account/my-bookings' as never);
      }
    } catch {
      // Gagal cek — fallback ke daftar booking seperti biasa, biar
      // customer tetap bisa lanjut dari sana (ada retry di layar itu).
      router.push('/account/my-bookings' as never);
    } finally {
      setCheckingBookings(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Asisten & Chat</Text>
        <Text style={styles.headerSubtitle}>Pilih cara kamu ingin terhubung dengan kami</Text>
      </View>

      <View style={styles.list}>
        <FadeInUp index={0}>
          <PressableScale style={styles.card} onPress={() => router.push('/assistant/ai' as never)} accessibilityRole="button">
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, styles.iconWrapPrimary]}>
                <Ionicons name="sparkles-outline" size={26} color="#ffffff" />
              </View>
              <View style={styles.badge}>
                <View style={styles.badgeDot} />
                <Text style={styles.badgeText}>Online 24 jam</Text>
              </View>
            </View>
            <Text style={styles.cardTitle}>Asisten AI</Text>
            <Text style={styles.cardSubtitle}>Tanya produk, garansi, dan perawatan film Ginnva. Dijawab otomatis kapan saja.</Text>
            <View style={styles.cardAction}>
              <Text style={styles.cardActionText}>Mulai bertanya</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.accent} />
            </View>
          </PressableScale>
        </FadeInUp>

        <FadeInUp index={1}>
          <PressableScale style={styles.card} onPress={handleStorePress} disabled={checkingBookings} accessibilityRole="button">
            <View style={styles.cardTop}>
              <View style={styles.iconWrap}>
                <Ionicons name="chatbubbles-outline" size={26} color={colors.accent} />
              </View>
            </View>
            <Text style={styles.cardTitle}>Chat Booking Instalasi</Text>
            <Text style={styles.cardSubtitle}>Lihat progress instalasi dan chat langsung dengan toko tempat bookingmu.</Text>
            <View style={styles.cardAction}>
              {checkingBookings ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <>
                  <Text style={styles.cardActionText}>Buka chat</Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.accent} />
                </>
              )}
            </View>
          </PressableScale>
        </FadeInUp>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    header: { paddingHorizontal: 24, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 6 },
    headerTitle: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    headerSubtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },

    list: { paddingHorizontal: 24, gap: 14 },
    card: { gap: 8, padding: 20, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    iconWrapPrimary: { backgroundColor: colors.accent },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.successBg },
    badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
    badgeText: { fontSize: 12, fontWeight: '800', color: colors.success },
    cardTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    cardSubtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
    cardAction: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, minHeight: 22 },
    cardActionText: { fontSize: 14, fontWeight: '800', color: colors.accent },
  });
}
