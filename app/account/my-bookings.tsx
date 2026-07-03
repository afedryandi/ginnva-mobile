import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

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

const STATUS_META: Record<
  MyBooking['status'],
  { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  pending:   { label: 'Menunggu Konfirmasi', color: colors.warning,    bg: '#fef3e2', icon: 'time-outline' },
  confirmed: { label: 'Dikonfirmasi',        color: colors.success,    bg: '#e7f8ef', icon: 'checkmark-circle-outline' },
  completed: { label: 'Selesai',             color: colors.mutedLight, bg: colors.alt, icon: 'checkmark-done-outline' },
  cancelled: { label: 'Dibatalkan',          color: colors.danger,     bg: '#fde8e8', icon: 'close-circle-outline' },
};

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
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiFetch<{ data: MyBooking[] }>('/api/customer/bookings')
      .then((res) => setBookings(res.data))
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat data booking Anda.'
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Booking Saya" />

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : bookings.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="calendar-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>
            Belum ada booking yang terhubung ke akun ini.
          </Text>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.pending;
            return (
              <Card style={styles.card}>
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
                  <Ionicons name="construct-outline" size={14} color={colors.muted} />
                  <Text style={styles.detailText}>{item.service_type}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="calendar-outline" size={14} color={colors.muted} />
                  <Text style={styles.detailText}>{formatDate(item.preferred_date)}</Text>
                </View>
                {item.preferred_time ? (
                  <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={14} color={colors.muted} />
                    <Text style={styles.detailText}>{item.preferred_time}</Text>
                  </View>
                ) : null}
                {item.notes ? (
                  <View style={styles.detailRow}>
                    <Ionicons name="document-text-outline" size={14} color={colors.muted} />
                    <Text style={[styles.detailText, { color: colors.muted }]}>{item.notes}</Text>
                  </View>
                ) : null}
              </Card>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.muted,
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
    color: colors.white,
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
    color: colors.ink,
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
    color: colors.muted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
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
    color: colors.ink,
    lineHeight: 20,
  },
});