import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

interface MyBooking {
  id: number;
  booking_number: string;
  service_type: string;
  preferred_date: string;
  preferred_time: string | null;
  notes: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  store: {
    id: number;
    name: string;
    city: string;
  };
}

function getStatusMeta(colors: typeof darkColors): Record<
  MyBooking['status'],
  { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> {
  return {
    pending:   { label: 'Menunggu Konfirmasi', color: colors.warning,  bg: colors.warningBg, icon: 'time-outline' },
    confirmed: { label: 'Dikonfirmasi',        color: colors.success,  bg: colors.successBg, icon: 'checkmark-circle-outline' },
    completed: { label: 'Selesai',             color: colors.textMuted, bg: colors.surface,  icon: 'checkmark-done-outline' },
    cancelled: { label: 'Dibatalkan',          color: colors.danger,   bg: colors.dangerBg,  icon: 'close-circle-outline' },
  };
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export default function MyBookingsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);

  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const { isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: MyBooking[] }>('/api/customer/bookings')
      .then((res) => {
        setBookings(res.data);
        if (isRefresh) hapticSuccess();
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat data booking Anda.'
        );
        if (isRefresh) hapticError();
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => load(true)}
      colors={[colors.accent]}
      tintColor={colors.accent}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Booking Saya</Text>
        <View style={styles.sideButton} />
      </View>

      {!isLoggedIn ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.textMuted} />
          <Text style={styles.centerStateTitle}>Login Diperlukan</Text>
          <Text style={styles.centerStateText}>
            Masuk ke akun Anda untuk melihat booking Anda.
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => router.push('/auth/login' as never)}
          >
            <Text style={styles.retryText}>Masuk Sekarang</Text>
          </Pressable>
        </ScrollView>
      ) : loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => { hapticLight(); load(); }}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </ScrollView>
      ) : bookings.length === 0 ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <Ionicons name="calendar-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>
            Belum ada booking yang terhubung ke akun ini.
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => router.push('/booking' as never)}
          >
            <Text style={styles.retryText}>Buat Booking</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={refreshControl}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.pending;
            return (
              <View style={styles.card}>
                {/* Header: nomor booking + badge status */}
                <View style={styles.cardHeader}>
                  <Text style={styles.bookingNumber}>{item.booking_number}</Text>
                  <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={12} color={meta.color} />
                    <Text style={[styles.badgeText, { color: meta.color }]}>
                      {meta.label}
                    </Text>
                  </View>
                </View>

                {/* Nama toko */}
                <Text style={styles.storeName}>{item.store.name}</Text>
                <Text style={styles.storeCity}>{item.store.city}</Text>

                <View style={styles.divider} />

                {/* Detail jadwal */}
                <View style={styles.detailRow}>
                  <Ionicons name="construct-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.detailText}>{item.service_type}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.detailText}>{formatDate(item.preferred_date)}</Text>
                </View>
                {item.preferred_time ? (
                  <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                    <Text style={styles.detailText}>{item.preferred_time}</Text>
                  </View>
                ) : null}
                {item.notes ? (
                  <View style={styles.detailRow}>
                    <Ionicons name="document-text-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>{item.notes}</Text>
                  </View>
                ) : null}

                {item.status !== 'cancelled' && (
                  <Pressable
                    style={styles.chatBtn}
                    onPress={() => router.push(`/booking/${item.id}/chat` as never)}
                  >
                    <Ionicons name="chatbubbles-outline" size={16} color={colors.accent} />
                    <Text style={styles.chatBtnText}>Progress & Chat dengan Toko</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  centerState: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centerStateTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  bookingNumber: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  storeName: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.accent,
    marginTop: spacing.xs,
  },
  storeCity: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginBottom: 4,
  },
  detailText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  chatBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.accent,
  },
  });
}
