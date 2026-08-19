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
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Asisten & Chat</Text>
        <Text style={styles.headerSubtitle}>Pilih cara Anda ingin terhubung dengan kami</Text>
      </View>

      <View style={styles.list}>
        <Pressable style={styles.card} onPress={() => router.push('/assistant/ai' as never)}>
          <View style={styles.iconWrap}>
            <Ionicons name="sparkles" size={26} color={colors.accent} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Asisten AI</Text>
            <Text style={styles.cardSubtitle}>
              Tanya produk, garansi, dan perawatan film Ginnva — dijawab otomatis 24 jam
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <Pressable style={styles.card} onPress={handleStorePress} disabled={checkingBookings}>
          <View style={styles.iconWrap}>
            <Ionicons name="storefront" size={26} color={colors.accent} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Chat dengan Toko</Text>
            <Text style={styles.cardSubtitle}>
              Lihat progress instalasi & chat langsung dengan toko tempat booking Anda
            </Text>
          </View>
          {checkingBookings ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
    headerTitle: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary },
    headerSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 4 },
    list: { paddingHorizontal: spacing.md, gap: spacing.md },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    iconWrap: {
      width: 52,
      height: 52,
      borderRadius: radius.lg,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBody: { flex: 1 },
    cardTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    cardSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  });
}
