import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { StatusBar } from 'expo-status-bar';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';

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
  // Voucher kini ditukar dengan poin lewat menu Reward (2026-10-10).
  points_cost?: number;
  voucher_valid_days?: number | null;
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
  const { isLoggedIn } = useAuth();

  const [promos, setPromos] = useState<PromoVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // UX diperbaiki 2026-09-26 (audit Voucher Promo) -- SEBELUMNYA card promo
  // yang customer SUDAH punya voucher-nya tampil identik dengan yang belum,
  // membingungkan kenapa promo yang sudah dipegang masih tampil sebagai
  // ajakan datang toko. Cross-check ke "Voucher Saya" HANYA kalau sudah
  // login (endpoint ini sendiri sengaja publik) -- gagal diam-diam kalau
  // request itu error, ini murni enhancement UI, bukan data inti halaman.
  const [ownedVoucherIds, setOwnedVoucherIds] = useState<Set<number>>(new Set());

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

    if (isLoggedIn) {
      try {
        // Voucher hasil tukar poin diterbitkan dari Reward (reward_id); id promo di halaman ini adalah id reward itu.
        const claimsRes = await apiFetch<{ data: { reward_id: number | null }[] }>('/api/customer/vouchers');
        setOwnedVoucherIds(new Set(claimsRes.data.map((c) => c.reward_id).filter((id): id is number => id !== null)));
      } catch {
        // Diamkan -- lihat catatan di atas state ownedVoucherIds.
      }
    }
  }, [isLoggedIn]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
        <Text style={styles.topTitle} numberOfLines={1}>Promo</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.errorText}>{error}</Text>
          <PressableScale style={styles.primaryButton} onPress={() => fetchData()} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : (
        <FlatList
          data={promos}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={colors.accent} colors={[colors.accent]} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={promos.length > 0 ? <Text style={styles.count}>{promos.length} promo sedang berjalan</Text> : null}
          renderItem={({ item, index }) => {
            const expiringSoon = isExpiringSoon(item.expires_at);
            const owned = ownedVoucherIds.has(item.id);
            const hasDiscount = Number(item.discount_amount) > 0;

            return (
              <FadeInUp index={index} enabled={index < 6}>
                <PressableScale style={styles.promoCard} onPress={() => router.push('/rewards' as never)} accessibilityRole="button">
                  <View style={styles.promoTop}>
                    {hasDiscount ? (
                      <View style={styles.discountBadge}>
                        <Ionicons name="pricetag" size={13} color="#ffffff" />
                        <Text style={styles.discountBadgeText}>Potongan {formatDiscount(item.discount_amount)}</Text>
                      </View>
                    ) : null}
                    {owned ? (
                      <View style={styles.ownedBadge}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                        <Text style={styles.ownedBadgeText}>Sudah kamu punya</Text>
                      </View>
                    ) : null}
                  </View>

                  <Text style={styles.promoName} numberOfLines={3}>{item.name}</Text>
                  {item.description ? <Text style={styles.promoDesc}>{item.description}</Text> : null}

                  <View style={styles.promoBottom}>
                    {item.expires_at ? (
                      <View style={[styles.expiryChip, expiringSoon && styles.expiryChipUrgent]}>
                        <Ionicons name={expiringSoon ? 'hourglass-outline' : 'calendar-outline'} size={14} color={expiringSoon ? colors.danger : colors.textSecondary} />
                        <Text style={[styles.expiryText, expiringSoon && styles.expiryTextUrgent]} numberOfLines={1}>
                          Sampai {formatExpiry(item.expires_at)}
                        </Text>
                      </View>
                    ) : <View />}
                    <View style={styles.promoCta}>
                      <Text style={styles.promoCtaText}>{item.points_cost ? `Tukar ${item.points_cost.toLocaleString('id-ID')} poin` : 'Tukar Poin'}</Text>
                      <Ionicons name="arrow-forward" size={14} color="#ffffff" />
                    </View>
                  </View>
                </PressableScale>
              </FadeInUp>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <View style={styles.centerIcon}>
                <Ionicons name="pricetags-outline" size={30} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>Belum ada promo</Text>
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
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { flex: 1, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    errorText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56, gap: 14, flexGrow: 1 },
    count: { fontSize: 13, color: colors.textMuted, marginLeft: 4, marginBottom: 2 },

    promoCard: { gap: 12, padding: 18, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    promoTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    discountBadge: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.accent },
    discountBadgeText: { fontSize: 12, fontWeight: '800', color: '#ffffff' },
    ownedBadge: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.successBg },
    ownedBadgeText: { fontSize: 11, fontWeight: '800', color: colors.success },
    promoName: { fontSize: 19, lineHeight: 25, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    promoDesc: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },

    promoBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 },
    expiryChip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.bg },
    expiryChipUrgent: { backgroundColor: colors.dangerBg },
    expiryText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    expiryTextUrgent: { color: colors.danger },
    promoCta: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: colors.accent },
    promoCtaText: { fontSize: 13, fontWeight: '800', color: '#ffffff' },

    emptyBox: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 56, gap: 12 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    emptyText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
  });
}
