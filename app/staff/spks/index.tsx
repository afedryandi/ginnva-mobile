import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StaffBottomNav, NAV_CLEARANCE } from '@/components/staff/StaffBottomNav';
import { useHideNavOnScroll } from '@/lib/staff-nav-visibility';
import { AppText as Text } from '@/components/ui/AppText';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';

interface SpkListItem {
  id: number;
  spk_number: string;
  customer_name: string;
  vehicle_plate: string | null;
  booking: { booking_number: string } | null;
  store: { name: string } | null;
  checked_in_at: string | null;
  created_at: string;
}

interface SpkListResponse {
  data: SpkListItem[];
  meta: { current_page: number; last_page: number; total: number };
}

// "08:40, 12 Nov" untuk waktu check-in; tanggal pembuatan dipakai bila belum ada check-in.
function formatCheckIn(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  const date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

  return `${time}, ${date}`;
}

function formatCreated(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// SPK (Surat Perintah Kerja) diisi langsung dari HP saat inspeksi
// kendaraan di lapangan (diminta user 2026-09-16) -- analog modul Memo
// Barang, tapi 1 booking cuma bisa punya 1 SPK (lihat SpkService).
// Tampilan dirancang ulang 2026-11-13: judul besar, kartu putih berlatar abu-putih, plat bergaya plat, status check-in berupa pil.
export default function SpkListScreen() {
  const hideNavOnScroll = useHideNavOnScroll();
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  // SPK baru boleh dibuat installer, leader installer, dan atasannya (sesi lama tanpa flag: tebak dari nama role).
  const { staff } = useStaffAuth();
  const canCreateSpk = staff?.can_create_spk
    ?? ['super_admin', 'direksi', 'store_manager', 'installer_leader', 'installer'].includes(staff?.role ?? '');

  const [spks, setSpks] = useState<SpkListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const fetchSpks = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<SpkListResponse>('/api/staff/spks?page=1');
      setSpks(res.data ?? []);
      setPage(res.meta?.current_page ?? 1);
      setLastPage(res.meta?.last_page ?? 1);
      setTotal(res.meta?.total ?? (res.data ?? []).length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar SPK.');
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || page >= lastPage) return;
    setLoadingMore(true);
    try {
      const res = await staffApiFetch<SpkListResponse>(`/api/staff/spks?page=${page + 1}`);
      setSpks((prev) => [...prev, ...(res.data ?? [])]);
      setPage(res.meta?.current_page ?? page + 1);
      setLastPage(res.meta?.last_page ?? lastPage);
    } catch {
      // Senyap — user masih bisa coba lagi dengan scroll/tap lagi.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, page, lastPage]);

  const hasLoadedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) setLoading(true);
      fetchSpks().finally(() => {
        hasLoadedOnce.current = true;
        setLoading(false);
      });
    }, [fetchSpks])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSpks();
    setRefreshing(false);
  }, [fetchSpks]);

  const goToCreate = () => router.push('/staff/spks/create' as never);

  const subtitle = loading || error ? '' : spks.length === 0 ? 'Belum ada SPK' : `${total} SPK`;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>Surat Perintah Kerja</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {canCreateSpk ? (
          <PressableScale onPress={goToCreate} style={styles.addButton} accessibilityRole="button" accessibilityLabel="Buat SPK baru">
            <Ionicons name="add" size={26} color="#ffffff" />
          </PressableScale>
        ) : null}
      </View>

      {loading ? (
        <SkeletonCards count={4} />
      ) : error ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="alert-circle-outline" size={36} color={colors.danger} />
          </View>
          <Text style={styles.emptyTitle}>Daftar belum termuat</Text>
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={onRefresh} accessibilityRole="button">
            <Text style={styles.retryBtnText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : spks.length === 0 ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="clipboard-outline" size={38} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Belum ada SPK</Text>
          <Text style={styles.centerStateText}>
            {canCreateSpk
              ? 'Buat SPK untuk mulai inspeksi kendaraan pelanggan di lapangan.'
              : 'SPK untuk booking yang ditugaskan akan muncul di sini.'}
          </Text>
          {canCreateSpk ? (
            <PressableScale style={styles.emptyCta} onPress={goToCreate} accessibilityRole="button">
              <Ionicons name="add" size={20} color="#ffffff" />
              <Text style={styles.emptyCtaText}>Buat SPK Baru</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : (
        <FlatList
          onScroll={hideNavOnScroll}
          scrollEventThrottle={16}
          data={spks}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} /> : null}
          renderItem={({ item, index }) => {
            const checkedIn = !!item.checked_in_at;

            return (
              <FadeInUp index={index} enabled={index < 8}>
                <PressableScale
                  style={styles.card}
                  onPress={() => router.push({ pathname: '/staff/spks/[id]', params: { id: String(item.id) } } as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.spk_number}, ${item.customer_name}`}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.plate}>
                      <Text style={styles.plateText} numberOfLines={1}>{item.vehicle_plate || 'Tanpa plat'}</Text>
                    </View>
                    <View style={[styles.statusPill, checkedIn ? styles.statusDone : styles.statusPending]}>
                      <View style={[styles.statusDot, { backgroundColor: checkedIn ? colors.success : colors.textMuted }]} />
                      <Text style={[styles.statusText, { color: checkedIn ? colors.success : colors.textSecondary }]} numberOfLines={1}>
                        {checkedIn ? `Check-in ${formatCheckIn(item.checked_in_at as string)}` : 'Belum check-in'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardBody}>
                    <Text style={styles.customer} numberOfLines={1}>{item.customer_name}</Text>
                    <Text style={styles.numbers} numberOfLines={1}>
                      {item.spk_number}{item.booking?.booking_number ? ` · ${item.booking.booking_number}` : ''}
                    </Text>
                  </View>

                  <View style={styles.cardFoot}>
                    <View style={styles.footLeft}>
                      <Ionicons name="location-outline" size={15} color={colors.textMuted} />
                      <Text style={styles.footText} numberOfLines={1}>{item.store?.name ?? 'Toko tidak diketahui'}</Text>
                    </View>
                    <Text style={styles.footText}>{formatCreated(item.created_at)}</Text>
                  </View>
                </PressableScale>
              </FadeInUp>
            );
          }}
        />
      )}
      <StaffBottomNav active="work" />
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan Beranda dan Notifikasi: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: 20, paddingTop: spacing.md, paddingBottom: spacing.md },
    headerText: { flex: 1, gap: 4 },
    title: { fontSize: 30, fontWeight: '800', letterSpacing: -1, lineHeight: 34, color: colors.textPrimary },
    subtitle: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
    addButton: {
      width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 4,
    },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    centerStateText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: {
      width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
      backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow,
    },
    emptyTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    emptyCta: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 52, paddingHorizontal: spacing.lg, borderRadius: radius.pill, marginTop: spacing.sm,
      backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 4,
    },
    emptyCtaText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.base },
    retryBtn: { marginTop: spacing.xs, height: 46, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    retryBtnText: { color: colors.textPrimary, fontWeight: '700', fontSize: fontSize.sm },

    listContent: { paddingHorizontal: 20, paddingBottom: NAV_CLEARANCE, gap: 12 },
    card: { gap: 12, padding: 16, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    plate: { flexShrink: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textSecondary },
    plateText: { fontSize: 13, fontWeight: '800', letterSpacing: 1, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    statusPill: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    statusDone: { backgroundColor: colors.successBg },
    statusPending: { backgroundColor: chip },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { flexShrink: 1, fontSize: 12, fontWeight: '700' },

    cardBody: { gap: 2 },
    customer: { fontSize: fontSize.base + 1, fontWeight: '700', color: colors.textPrimary },
    numbers: { fontSize: 13, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },

    cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingTop: 12, borderTopWidth: 1, borderTopColor: line },
    footLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
    footText: { flexShrink: 1, fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
  });
}
