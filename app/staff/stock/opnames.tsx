import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface OpnameItem {
  item_type: string;
  item_id: number;
  name: string;
  unit: string | null;
  system: number;
  actual: number;
  delta: number;
  note: string | null;
}

interface OpnameRow {
  id: number;
  number: string;
  status: 'draft' | 'applied' | 'cancelled';
  status_label: string;
  date: string | null;
  store: string | null;
  by: string | null;
  notes: string | null;
  items_count: number;
  diff_count: number;
  cancel_reason: string | null;
  items: OpnameItem[] | null;
}

type StatusFilter = 'all' | 'draft' | 'applied' | 'cancelled';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'draft', label: 'Draf' },
  { key: 'applied', label: 'Diterapkan' },
  { key: 'cancelled', label: 'Dibuang' },
];

function fmt(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

/**
 * Daftar sesi Stok Opname di toko akun (akses penuh: semua toko). Rincian (stok sistem saat dihitung, hasil hitung, selisih, catatan) dibuka
 * dengan mengetuk sesi: hitung buta berarti selisih baru terlihat di sini, setelah hasil hitung terkirim. Menerapkan atau membuang draf
 * dilakukan akses penuh di panel.
 *
 * Tampilan dirancang ulang 2026-11-13, selaras dengan layar stok lainnya: judul besar, filter status berupa chip, tiap sesi sebagai kartu dengan
 * status berwarna dan jumlah item, dan rincian yang dibuka berupa daftar baris dengan selisih sebagai pil berwarna.
 */
export default function StockOpnamesScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [rows, setRows] = useState<OpnameRow[]>([]);
  // Jumlah sesi per status dari server (server lama belum mengirimnya: chip tampil tanpa angka).
  const [summary, setSummary] = useState<Record<StatusFilter, number> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, OpnameItem[]>>({});
  // Hanya respons permintaan terbaru yang dipakai.
  const latest = useRef(0);

  const url = useCallback((offset: number) => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (offset > 0) params.set('offset', String(offset));
    return `/api/staff/stock-opnames?${params.toString()}`;
  }, [filter]);

  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setError(null);
    try {
      const res = await staffApiFetch<{ data: OpnameRow[]; has_more: boolean; summary?: Record<StatusFilter, number> }>(url(0));
      if (requestId !== latest.current) return;
      setRows(res.data);
      setHasMore(res.has_more);
      if (res.summary) setSummary(res.summary);
    } catch (err) {
      if (requestId !== latest.current) return;
      setError(err instanceof ApiError ? err.message : 'Gagal memuat sesi. Periksa koneksi internet.');
    }
  }, [url]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setDetails({});
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const requestId = latest.current;
    setLoadingMore(true);
    try {
      const res = await staffApiFetch<{ data: OpnameRow[]; has_more: boolean }>(url(rows.length));
      if (requestId !== latest.current) return;
      setRows((current) => [...current, ...res.data]);
      setHasMore(res.has_more);
    } catch {
      // Biarkan daftar yang sudah tampil.
    } finally {
      setLoadingMore(false);
    }
  };

  const toggle = async (row: OpnameRow) => {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    if (details[row.id]) return;
    try {
      const res = await staffApiFetch<{ data: OpnameRow }>(`/api/staff/stock-opnames/${row.id}`);
      setDetails((d) => ({ ...d, [row.id]: res.data.items ?? [] }));
    } catch {
      setDetails((d) => ({ ...d, [row.id]: [] }));
    }
  };

  const neutralBg = isDark ? colors.surfaceElevated : '#efeff4';
  const statusTone = (s: OpnameRow['status']) =>
    s === 'draft'
      ? { fg: colors.warning, bg: colors.warningBg, icon: 'create-outline' as const }
      : s === 'applied'
        ? { fg: colors.success, bg: colors.successBg, icon: 'checkmark-done-outline' as const }
        : { fg: colors.textMuted, bg: neutralBg, icon: 'trash-outline' as const };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>Sesi Stok Opname</Text>
          <Text style={styles.subtitle}>Ketuk sesi untuk melihat selisihnya</Text>
        </View>
      </View>

      {/* Pola sama dengan filter halaman Bahan Baku: tab selebar layar, jumlah di samping nama, dan garis aksen di bawah tab terpilih. */}
      <View style={styles.tabs}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = summary ? summary[f.key] : 0;

          return (
            <Pressable key={f.key} style={styles.tab} onPress={() => setFilter(f.key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <View style={styles.tabTop}>
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{f.label}</Text>
                {count > 0 ? (
                  <View style={[styles.tabCount, f.key === 'draft' && styles.tabCountAlert]}>
                    <Text style={[styles.tabCountText, f.key === 'draft' && styles.tabCountTextAlert]}>{count}</Text>
                  </View>
                ) : null}
              </View>
              <View style={[styles.tabBar, active && styles.tabBarActive]} />
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <SkeletonCards count={4} />
      ) : error ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="alert-circle-outline" size={34} color={colors.danger} />
          </View>
          <Text style={styles.centerStateText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => String(row.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          ListEmptyComponent={
            <View style={styles.centerState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="clipboard-outline" size={34} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>Belum ada sesi</Text>
              <Text style={styles.centerStateText}>Sesi stok opname yang dikirim dari Hitung Stok akan muncul di sini.</Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <PressableScale style={styles.loadMore} onPress={loadMore} disabled={loadingMore}>
                {loadingMore ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.loadMoreText}>Muat lainnya</Text>}
              </PressableScale>
            ) : null
          }
          renderItem={({ item, index }) => {
            const tone = statusTone(item.status);
            const open = openId === item.id;
            return (
              <FadeInUp index={index} enabled={index < 8}>
                <View style={[styles.row, item.status === 'cancelled' && { opacity: 0.65 }]}>
                  <PressableScale onPress={() => toggle(item)} scaleTo={0.985} accessibilityRole="button" accessibilityState={{ expanded: open }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{item.number}</Text>
                      <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                        <Ionicons name={tone.icon} size={13} color={tone.fg} />
                        <Text style={[styles.statusText, { color: tone.fg }]}>{item.status_label}</Text>
                      </View>
                    </View>
                    <Text style={styles.rowMeta} numberOfLines={1}>{[item.store, item.date, item.by].filter(Boolean).join(' · ')}</Text>
                    <View style={styles.statsRow}>
                      <View style={styles.statChip}>
                        <Ionicons name="cube-outline" size={14} color={colors.textSecondary} />
                        <Text style={styles.statText}>{item.items_count} item</Text>
                      </View>
                      <View style={[styles.statChip, item.diff_count > 0 && { backgroundColor: colors.warningBg }]}>
                        <Ionicons name="swap-vertical" size={14} color={item.diff_count > 0 ? colors.warning : colors.textSecondary} />
                        <Text style={[styles.statText, item.diff_count > 0 && { color: colors.warning }]}>{item.diff_count} berselisih</Text>
                      </View>
                      <View style={{ flex: 1 }} />
                      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                    </View>
                    {item.cancel_reason ? (
                      <View style={styles.cancelPill}>
                        <Text style={styles.cancelText}>Dibuang: {item.cancel_reason}</Text>
                      </View>
                    ) : null}
                  </PressableScale>

                  {open ? (
                    <View style={styles.detail}>
                      {!details[item.id] ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : details[item.id].length === 0 ? (
                        <Text style={styles.rowMeta}>Rincian tidak tersedia.</Text>
                      ) : (
                        details[item.id].map((line, i) => {
                          const up = line.delta > 0;
                          const down = line.delta < 0;
                          return (
                            <View key={`${line.item_type}-${line.item_id}`} style={[styles.line, i > 0 && styles.lineDivider]}>
                              <View style={{ flex: 1, gap: 2 }}>
                                <Text style={styles.lineName} numberOfLines={2}>{line.name}</Text>
                                <Text style={styles.lineNums}>
                                  Sistem {fmt(line.system)} → Hitung {fmt(line.actual)} {line.unit ?? ''}
                                </Text>
                                {line.note ? <Text style={styles.lineNote}>{line.note}</Text> : null}
                              </View>
                              <View style={[styles.deltaPill, { backgroundColor: down ? colors.dangerBg : up ? colors.successBg : neutralBg }]}>
                                <Text style={[styles.deltaText, { color: down ? colors.danger : up ? colors.success : colors.textMuted }]}>
                                  {up ? '+' : ''}{fmt(line.delta)}
                                </Text>
                              </View>
                            </View>
                          );
                        })
                      )}
                    </View>
                  ) : null}
                </View>
              </FadeInUp>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.9, lineHeight: 32, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted },

    tabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: spacing.xs, marginBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: line },
    tab: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 8 },
    tabTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    tabText: { fontSize: 13.5, fontWeight: '700', color: colors.textMuted },
    tabTextActive: { color: colors.textPrimary },
    tabCount: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    tabCountAlert: { backgroundColor: colors.warningBg },
    tabCountText: { fontSize: 11, fontWeight: '800', color: colors.textSecondary },
    tabCountTextAlert: { color: colors.warning },
    tabBar: { height: 3, width: '60%', borderRadius: 2, backgroundColor: 'transparent' },
    tabBarActive: { backgroundColor: colors.accent },

    centerState: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.xs, paddingBottom: spacing.xxl, flexGrow: 1 },
    row: { padding: 16, marginBottom: spacing.sm + 2, backgroundColor: card, borderRadius: 24, borderWidth: 1, borderColor: line, ...shadow },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    rowTitle: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    statusText: { fontSize: 11.5, fontWeight: '800' },
    rowMeta: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted, marginTop: 4 },
    statsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm + 2 },
    statChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: chip },
    statText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    cancelPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.dangerBg, marginTop: spacing.sm },
    cancelText: { fontSize: 12, fontWeight: '700', color: colors.danger },

    detail: { marginTop: spacing.md, borderRadius: 18, backgroundColor: chip, paddingHorizontal: 14, paddingVertical: 4 },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12 },
    lineDivider: { borderTopWidth: 1, borderTopColor: line },
    lineName: { fontSize: fontSize.sm, fontWeight: '800', letterSpacing: -0.1, color: colors.textPrimary },
    lineNums: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    lineNote: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
    deltaPill: { minWidth: 56, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
    deltaText: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },

    loadMore: { alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.pill, backgroundColor: chip, marginTop: spacing.xs },
    loadMoreText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  });
}
