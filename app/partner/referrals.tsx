import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface Referral {
  id: number;
  booking_number: string;
  customer_name: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  transaction_amount: number | null;
  points_earned: number;
  created_at: string;
}

function getStatusMeta(colors: typeof darkColors): Record<
  Referral['status'],
  { label: string; color: string; bg: string }
> {
  return {
    pending: { label: 'Menunggu Konfirmasi', color: colors.warning, bg: colors.warningBg },
    confirmed: { label: 'Dikonfirmasi', color: colors.success, bg: colors.successBg },
    completed: { label: 'Selesai', color: colors.textMuted, bg: colors.surface },
    cancelled: { label: 'Dibatalkan', color: colors.danger, bg: colors.dangerBg },
  };
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatRupiah(n: number) {
  return `Rp${n.toLocaleString('id-ID')}`;
}

export default function PartnerReferralsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);

  const [items, setItems] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await staffApiFetch<{ data: Referral[] }>('/api/partner/referrals');
      setItems(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat riwayat referral.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Riwayat Referral</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchData()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={colors.accent} />}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.pending;
            return (
              <View style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowCustomer} numberOfLines={1}>
                    {item.customer_name ?? 'Pelanggan'}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.rowBooking}>#{item.booking_number} · {formatDate(item.created_at)}</Text>
                <View style={styles.rowBottom}>
                  <Text style={styles.rowAmount}>
                    {item.transaction_amount !== null ? formatRupiah(item.transaction_amount) : '-'}
                  </Text>
                  <View style={styles.pointsBadge}>
                    <Ionicons name="star" size={12} color={colors.accent} />
                    <Text style={styles.pointsText}>+{item.points_earned} poin</Text>
                  </View>
                </View>
              </View>
            );
          }}
          ListHeaderComponent={
            items.length > 0 ? (
              <Text style={styles.listIntro}>
                Booking pelanggan yang direferensikan lewat kode referral Anda.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum Ada Referral</Text>
              <Text style={styles.emptyText}>
                Bagikan kode referral Anda — booking pelanggan yang memakainya akan muncul di sini.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.pill },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },

  listContent: { padding: spacing.md, gap: spacing.sm },
  listIntro: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 19 },

  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rowCustomer: { flex: 1, fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: fontSize.xs, fontWeight: '700' },
  rowBooking: { fontSize: fontSize.xs, color: colors.textMuted },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  rowAmount: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  pointsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  pointsText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent },

  emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, marginTop: spacing.lg },
  emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  });
}
