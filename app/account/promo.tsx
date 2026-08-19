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

// Terpisah dari "Voucher Saya" (app/account/vouchers.tsx) — di sana isinya
// voucher fisik yang SUDAH di-assign staff ke akun ini, di sini isinya
// daftar KAMPANYE promo yang sedang berjalan (informasi umum), tetap
// tampil walaupun customer sudah punya voucher tersebut. Murni informasi,
// tidak ada aksi klaim dari sini.

interface PromoVoucher {
  id: number;
  name: string;
  description: string | null;
  // Backend cast 'decimal:2' (lihat Voucher.php) SELALU di-serialize
  // sebagai string di JSON (mis. "150000.00"), bukan number — perilaku
  // standar Laravel supaya presisi desimal tidak hilang lewat JSON.
  discount_amount: string;
  expires_at: string | null;
}

function formatExpiry(dateStr: string | null): string | null {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDiscount(amount: string): string {
  return `Rp${Number(amount).toLocaleString('id-ID')}`;
}

// Promo dianggap "segera berakhir" kalau sisa <= 7 hari — dikasih warna
// peringatan supaya urgensinya kelihatan, bukan cuma teks abu-abu datar
// yang sama untuk promo 1 hari lagi maupun 6 bulan lagi.
function isExpiringSoon(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const diffDays = (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 7;
}

export default function PromoScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [promos, setPromos] = useState<PromoVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: PromoVoucher[] }>('/api/customer/vouchers/available');
      setPromos(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data promo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Promo</Text>
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
          data={promos}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={colors.accent} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const expiringSoon = isExpiringSoon(item.expires_at);
            return (
              <Pressable style={styles.promoCard} onPress={() => router.push('/(tabs)/stores' as never)}>
                <View style={styles.promoTopRow}>
                  <Text style={styles.promoName} numberOfLines={2}>{item.name}</Text>
                  {Number(item.discount_amount) > 0 && (
                    <View style={styles.discountBadge}>
                      <Text style={styles.discountBadgeText}>{formatDiscount(item.discount_amount)}</Text>
                    </View>
                  )}
                </View>
                {item.description && (
                  <Text style={styles.promoDesc}>{item.description}</Text>
                )}
                <View style={styles.promoBottomRow}>
                  {item.expires_at ? (
                    <Text style={[styles.promoExpiry, expiringSoon && styles.promoExpiryUrgent]}>
                      {expiringSoon ? '⏳ ' : ''}Berlaku sampai {formatExpiry(item.expires_at)}
                    </Text>
                  ) : <View />}
                  <View style={styles.promoCta}>
                    <Text style={styles.promoCtaText}>Ke Toko</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.accent} />
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="pricetags-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum Ada Promo</Text>
              <Text style={styles.emptyText}>Promo yang sedang berjalan akan muncul di sini.</Text>
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

  promoCard: {
    gap: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  promoTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  promoName: { flex: 1, fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, lineHeight: 19 },
  discountBadge: {
    backgroundColor: colors.accent, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 3, flexShrink: 0,
  },
  discountBadgeText: { fontSize: fontSize.xs, fontWeight: '800', color: '#ffffff' },
  promoDesc: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 16 },
  promoBottomRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.xs, gap: spacing.sm,
  },
  promoExpiry: { flex: 1, fontSize: fontSize.xs, color: colors.textMuted },
  promoExpiryUrgent: { color: colors.danger, fontWeight: '700' },
  promoCta: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  promoCtaText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent },

  emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, marginTop: spacing.lg },
  emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  });
}
