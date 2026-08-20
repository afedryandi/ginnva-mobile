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
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

// Voucher sekarang FISIK — dicetak dengan kode unik, dibagikan ke customer
// yang sudah bayar DP, lalu staff assign kodenya ke akun customer lewat
// Filament. Layar ini murni READ-ONLY, tidak ada aksi klaim apa pun dari
// customer (fitur klaim self-service sudah dihapus).

interface VoucherClaim {
  id: number;
  code: string;
  status: 'active' | 'used';
  created_at: string;
  voucher: { name: string; discount_amount: number };
}

function formatRupiah(n: number): string {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

export default function VouchersScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [claims, setClaims] = useState<VoucherClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: VoucherClaim[] }>('/api/customer/vouchers');
      setClaims(res.data ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data voucher.');
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
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Voucher Saya</Text>
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
          data={claims}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={colors.accent} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.voucherRow}>
              <View style={[styles.voucherIcon, item.status === 'used' && styles.voucherIconUsed]}>
                <Ionicons name="ticket-outline" size={20} color={item.status === 'used' ? colors.textMuted : colors.accent} />
              </View>
              <View style={styles.voucherInfo}>
                <Text style={styles.voucherName}>{item.voucher.name}</Text>
                <Text style={styles.voucherCode}>{item.code}</Text>
              </View>
              <View style={styles.voucherRight}>
                <Text style={styles.voucherAmount}>{formatRupiah(item.voucher.discount_amount)}</Text>
                <Text style={[styles.voucherStatus, item.status === 'used' && styles.voucherStatusUsed]}>
                  {item.status === 'used' ? 'Sudah Dipakai' : 'Aktif'}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="ticket-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum Ada Voucher</Text>
              <Text style={styles.emptyText}>Voucher yang diberikan toko akan muncul di sini.</Text>
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

  listContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },

  voucherRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  voucherIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  // SENGAJA bukan colors.bg — warna dasar halaman di atas kartu
  // colors.surface bikin lingkaran ikon ini terlihat seperti "lubang"
  // menembus ke background, bukan kesan pudar/nonaktif yang dimaksud.
  voucherIconUsed: { backgroundColor: colors.border },
  voucherInfo: { flex: 1, gap: 2 },
  voucherName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  voucherCode: { fontSize: fontSize.xs, color: colors.textMuted, letterSpacing: 1 },
  voucherRight: { alignItems: 'flex-end', gap: 2 },
  voucherAmount: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  voucherStatus: { fontSize: fontSize.xs, fontWeight: '600', color: colors.success },
  voucherStatusUsed: { color: colors.textMuted },

  emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, marginTop: spacing.lg },
  emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  });
}
