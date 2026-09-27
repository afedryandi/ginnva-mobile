import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface PointTransaction {
  id: number;
  type: 'earn' | 'spend';
  points: number;
  description: string;
  reference_type: string | null;
  created_at: string;
}

interface PointsResponse {
  balance: number;
  transactions: PointTransaction[];
  current_page: number;
  has_more: boolean;
}

// Label sumber poin (2026-09-26, audit Riwayat Poin Partner) -- sama pola
// dengan account/points.tsx (customer), disamakan supaya partner dapat
// treatment UX yang setara (reference_type sudah dikirim backend tapi
// sebelumnya tidak dipakai sama sekali di sini).
const SOURCE_LABEL: Record<string, string> = {
  booking: 'Booking',
  reward_redemption: 'Tukar Reward',
  reward_redemption_refund: 'Refund Reward',
  reward_redemption_reversal: 'Reward Dibatalkan Ulang',
  manual: 'Input Manual',
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PartnerPointsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pagination (2026-09-26, audit Riwayat Poin Partner) -- sama pola
  // dengan account/points.tsx (customer).
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const fetchPoints = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await staffApiFetch<PointsResponse>('/api/partner/points');
      setBalance(res.balance);
      setTransactions(res.transactions);
      setPage(res.current_page ?? 1);
      setHasMore(res.has_more ?? false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data poin.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await staffApiFetch<PointsResponse>(`/api/partner/points?page=${page + 1}`);
      setTransactions((prev) => [...prev, ...(res.transactions ?? [])]);
      setPage(res.current_page ?? page + 1);
      setHasMore(res.has_more ?? false);
    } catch {
      // Diamkan -- riwayat yang sudah tampil tetap valid.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page]);

  useEffect(() => { fetchPoints(); }, [fetchPoints]);

  const renderItem = ({ item, index }: { item: PointTransaction; index: number }) => {
    const isEarn = item.type === 'earn';
    return (
      <View style={[styles.txRow, index > 0 && styles.txBorder]}>
        <View style={[styles.txIcon, { backgroundColor: isEarn ? colors.successBg : colors.dangerBg }]}>
          <Ionicons
            name={isEarn ? 'add-circle-outline' : 'remove-circle-outline'}
            size={20}
            color={isEarn ? colors.success : colors.danger}
          />
        </View>
        <View style={styles.txInfo}>
          <Text style={styles.txDesc}>{item.description}</Text>
          <View style={styles.txMetaRow}>
            {item.reference_type && SOURCE_LABEL[item.reference_type] && (
              <View style={styles.sourceBadge}>
                <Text style={styles.sourceBadgeText}>{SOURCE_LABEL[item.reference_type]}</Text>
              </View>
            )}
            <Text style={styles.txTime}>{timeAgo(item.created_at)}</Text>
          </View>
        </View>
        <Text style={[styles.txPoints, { color: isEarn ? colors.success : colors.danger }]}>
          {isEarn ? '+' : '-'}{item.points}
        </Text>
      </View>
    );
  };

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
        <Text style={styles.headerTitle} numberOfLines={1}>Riwayat Poin</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchPoints()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchPoints(true)} tintColor={colors.accent} />
          }
          ListHeaderComponent={
            <>
              <View style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>Total Poin Anda</Text>
                <Text style={styles.balanceValue}>{balance.toLocaleString('id-ID')}</Text>
              </View>

              {/* Ditambah 2026-09-26 (audit Riwayat Poin Partner) -- gap
                  standar enterprise: versi customer sudah punya kartu ini,
                  partner sebelumnya tidak, padahal riwayat bisa berisi
                  baris refund/pembatalan reward yang butuh penjelasan. */}
              <View style={styles.howCard}>
                <Text style={styles.howTitle}>Cara Mendapatkan Poin</Text>
                <View style={styles.howRow}>
                  <Ionicons name="calendar-outline" size={18} color={colors.accent} />
                  <Text style={styles.howText}>Customer booking pakai kode referral Anda & selesai → <Text style={styles.howBold}>poin otomatis</Text></Text>
                </View>
                <View style={styles.howRow}>
                  <Ionicons name="gift-outline" size={18} color={colors.accent} />
                  <Text style={styles.howText}>Batalkan penukaran reward → <Text style={styles.howBold}>poin dikembalikan</Text></Text>
                </View>
              </View>
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="star-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum Ada Poin</Text>
              <Text style={styles.emptyText}>
                Bagikan kode referral Anda — poin masuk otomatis saat customer booking & bayar di toko.
              </Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <Pressable style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.loadMoreText}>Muat Riwayat Lebih Lama</Text>
                )}
              </Pressable>
            ) : null
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },

  listContent: { paddingBottom: spacing.xxl },

  balanceCard: {
    margin: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  balanceLabel: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.8)' },
  balanceValue: { fontSize: 40, fontWeight: '800', color: '#ffffff', letterSpacing: -1 },

  howCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  howTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  howText: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
  howBold: { fontWeight: '700', color: colors.textPrimary },

  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  txBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  txInfo: { flex: 1, gap: 2 },
  txDesc: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500' },
  txMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sourceBadge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  sourceBadgeText: { fontSize: 10, fontWeight: '700', color: colors.accent },
  txTime: { fontSize: fontSize.xs, color: colors.textMuted },
  txPoints: { fontSize: fontSize.base, fontWeight: '700', flexShrink: 0 },

  loadMoreBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md },
  loadMoreText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.accent },

  emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, marginTop: spacing.lg },
  emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  });
}
