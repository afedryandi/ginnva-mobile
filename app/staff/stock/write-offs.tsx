import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Modal } from 'react-native';
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

interface WriteOffRow {
  id: number;
  number: string | null;
  created_at: string;
  item_name: string;
  item_id: number;
  jenis: 'raw_material' | 'consumable_item';
  quantity: number;
  unit: string | null;
  reason: string;
  reason_label: string;
  note: string | null;
  value: number | null;
  by: string | null;
  store: string | null;
  cancelled: boolean;
  cancelled_reason: string | null;
}

interface Response {
  data: WriteOffRow[];
  has_more: boolean;
  summary: { month_count: number; month_value: number | null };
  // Jumlah dan kerugian pada periode yang dipilih (tidak mengikuti filter alasan). Server lama belum mengirimnya.
  period_summary?: { count: number; value: number | null };
  show_value: boolean;
}

type Period = 'week' | 'month' | 'all';
type Reason = 'all' | 'damaged' | 'expired' | 'lost' | 'other';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: '7 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'all', label: 'Semua' },
];

// Kata penutup label kartu ringkasan menurut periode, mis. "Kejadian 7 hari".
const PERIOD_SUFFIX: Record<Period, string> = { week: '7 hari', month: 'bulan ini', all: '(semua)' };

const REASONS: { key: Reason; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'damaged', label: 'Rusak' },
  { key: 'expired', label: 'Kedaluwarsa' },
  { key: 'lost', label: 'Hilang' },
  { key: 'other', label: 'Lainnya' },
];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodStart(period: Period): string | null {
  const now = new Date();
  if (period === 'week') return dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  if (period === 'month') return dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  return null;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Daftar Stok Terbuang untuk staf gudang (padanan menu Stok Terbuang di panel): yang pernah dicatat, alasan, dan pencatatnya. Dibatasi
 * toko oleh server; nilai rupiah hanya bila akunnya berizin Lihat pada menu Stok Terbuang. Membatalkan yang salah catat dilakukan akses
 * penuh lewat panel.
 *
 * Tampilan dirancang ulang 2026-11-13, selaras dengan layar Riwayat: judul besar, ringkasan bulan ini berbentuk kartu ringkas, filter alasan
 * berupa chip, periode berupa segmen, dan tiap kejadian sebagai kartu dengan jumlah yang menonjol.
 */
export default function WriteOffsScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [period, setPeriod] = useState<Period>('month');
  const [reason, setReason] = useState<Reason>('all');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [rows, setRows] = useState<WriteOffRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [summary, setSummary] = useState<(Response['summary'] & { period?: Response['period_summary'] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hanya respons permintaan terbaru yang dipakai: filter yang berganti cepat tidak boleh ditimpa respons lama yang telat.
  const latest = useRef(0);

  const buildUrl = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (reason !== 'all') params.set('reason', reason);
      const from = periodStart(period);
      if (from) params.set('from', from);
      if (offset > 0) params.set('offset', String(offset));
      return `/api/staff/stock-write-offs?${params.toString()}`;
    },
    [period, reason]
  );

  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setError(null);
    try {
      const res = await staffApiFetch<Response>(buildUrl(0));
      if (requestId !== latest.current) return;
      setRows(res.data);
      setHasMore(res.has_more);
      setSummary({ ...res.summary, period: res.period_summary });
    } catch (err) {
      if (requestId !== latest.current) return;
      setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar. Periksa koneksi internet.');
    }
  }, [buildUrl]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const requestId = latest.current;
    setLoadingMore(true);
    try {
      const res = await staffApiFetch<Response>(buildUrl(rows.length));
      if (requestId !== latest.current) return;
      setRows((current) => [...current, ...res.data]);
      setHasMore(res.has_more);
    } catch {
      // Biarkan daftar yang sudah tampil; tombol Muat Lagi tetap ada.
    } finally {
      setLoadingMore(false);
    }
  };

  const openItem = (row: WriteOffRow) =>
    router.push({ pathname: row.jenis === 'raw_material' ? '/staff/materials/[id]' : '/staff/consumables/[id]', params: { id: String(row.item_id) } } as never);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>Stok Terbuang</Text>
          <Text style={styles.subtitle}>Bahan rusak, kedaluwarsa, atau hilang</Text>
        </View>
      </View>

      {summary ? (
        <FadeInUp style={styles.summaryRow}>
          <View style={styles.summaryTile}>
            <View style={[styles.summaryIcon, { backgroundColor: colors.warningBg }]}>
              <Ionicons name="trash-outline" size={16} color={colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryValue}>{summary.period ? summary.period.count : summary.month_count}</Text>
              <Text style={styles.summaryLabel}>Kejadian {summary.period ? PERIOD_SUFFIX[period] : 'bulan ini'}</Text>
            </View>
          </View>
          {(summary.period ? summary.period.value : summary.month_value) !== null ? (
            <View style={[styles.summaryTile, { flex: 1.4 }]}>
              <View style={[styles.summaryIcon, { backgroundColor: colors.dangerBg }]}>
                <Ionicons name="trending-down" size={16} color={colors.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>Rp {((summary.period ? summary.period.value : summary.month_value) ?? 0).toLocaleString('id-ID')}</Text>
                <Text style={styles.summaryLabel}>Kerugian {summary.period ? PERIOD_SUFFIX[period] : 'bulan ini'}</Text>
              </View>
            </View>
          ) : null}
        </FadeInUp>
      ) : null}

      <View style={styles.tabs}>
        {REASONS.map((r) => {
          const active = reason === r.key;

          return (
            <Pressable key={r.key} style={styles.tab} onPress={() => setReason(r.key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{r.label}</Text>
              <View style={[styles.tabBar, active && styles.tabBarActive]} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.periodRow}>
        <Pressable style={styles.periodChip} onPress={() => setPeriodOpen(true)} accessibilityRole="button" accessibilityLabel="Ubah periode">
          <Ionicons name="calendar-outline" size={15} color={colors.textSecondary} />
          <Text style={styles.periodChipText}>{PERIODS.find((p) => p.key === period)?.label}</Text>
          <Ionicons name="chevron-down" size={15} color={colors.textMuted} />
        </Pressable>
      </View>

      <Modal visible={periodOpen} animationType="slide" transparent onRequestClose={() => setPeriodOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropFill} onPress={() => setPeriodOpen(false)} accessibilityLabel="Tutup" />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Periode</Text>
            <View style={styles.optionList}>
              {PERIODS.map((p) => {
                const selected = period === p.key;

                return (
                  <Pressable
                    key={p.key}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => {
                      setPeriod(p.key);
                      setPeriodOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={styles.optionText}>{p.label}</Text>
                    <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

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
                <Ionicons name="trash-outline" size={34} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>Belum ada stok terbuang</Text>
              <Text style={styles.centerStateText}>Tidak ada catatan yang cocok dengan filter ini.</Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <PressableScale style={styles.loadMore} onPress={loadMore} disabled={loadingMore}>
                {loadingMore ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.loadMoreText}>Muat lainnya</Text>}
              </PressableScale>
            ) : null
          }
          renderItem={({ item, index }) => (
            <FadeInUp index={index} enabled={index < 8}>
              <PressableScale style={[styles.row, item.cancelled && { opacity: 0.55 }]} onPress={() => openItem(item)} accessibilityRole="button">
                <View style={styles.rowIcon}>
                  <Ionicons name="trash-outline" size={20} color={colors.warning} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.rowName, item.cancelled && styles.struck]} numberOfLines={2}>{item.item_name}</Text>
                  <View style={styles.reasonTag}>
                    <Text style={styles.reasonTagText}>{item.reason_label}</Text>
                  </View>
                  <Text style={styles.rowMeta} numberOfLines={1}>{[item.number, item.store, item.by].filter(Boolean).join(' · ')}</Text>
                  {item.note ? <Text style={styles.rowNote} numberOfLines={2}>{item.note}</Text> : null}
                  {item.cancelled ? (
                    <View style={styles.cancelledPill}>
                      <Text style={styles.cancelledText}>Dibatalkan{item.cancelled_reason ? `: ${item.cancelled_reason}` : ''}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.rowDate}>{formatDateTime(item.created_at)}</Text>
                </View>
                <View style={styles.qtyCol}>
                  <Text style={styles.qtyValue}>{item.quantity.toLocaleString('id-ID')}</Text>
                  <Text style={styles.qtyUnit}>{item.unit ?? ''}</Text>
                  {item.value !== null ? <Text style={styles.rowValue}>Rp {item.value.toLocaleString('id-ID')}</Text> : null}
                </View>
              </PressableScale>
            </FadeInUp>
          )}
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
    title: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted },

    summaryRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: 20, marginBottom: spacing.xs },
    summaryTile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    summaryIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    summaryValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, lineHeight: 24, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    summaryLabel: { fontSize: 11.5, fontWeight: '600', color: colors.textMuted },

    tabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: spacing.sm, borderBottomWidth: 1, borderBottomColor: line },
    tab: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 8 },
    tabText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
    tabTextActive: { color: colors.textPrimary },
    tabBar: { height: 3, width: '60%', borderRadius: 2, backgroundColor: 'transparent' },
    tabBarActive: { backgroundColor: colors.accent },

    periodRow: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: spacing.sm + 2 },
    periodChip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: chip },
    periodChipText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },

    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    backdropFill: { flex: 1 },
    sheet: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, gap: spacing.md, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: isDark ? colors.bg : '#ffffff' },
    sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: line },
    sheetTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary },
    optionList: { gap: 8 },
    option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: line, backgroundColor: card },
    optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    optionText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: colors.accent },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },

    centerState: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.xs, paddingBottom: spacing.xxl, flexGrow: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, padding: 16, marginBottom: spacing.sm + 2, backgroundColor: card, borderRadius: 24, borderWidth: 1, borderColor: line, ...shadow },
    rowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.warningBg },
    rowName: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    struck: { textDecorationLine: 'line-through' },
    reasonTag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.warningBg },
    reasonTagText: { fontSize: 11.5, fontWeight: '800', color: colors.warning },
    rowMeta: { fontSize: 12.5, fontWeight: '500', color: colors.textSecondary },
    rowNote: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
    cancelledPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.dangerBg, marginTop: 2 },
    cancelledText: { fontSize: 12, fontWeight: '700', color: colors.danger },
    rowDate: { fontSize: 11.5, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    qtyCol: { alignItems: 'flex-end', maxWidth: 110 },
    qtyValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    qtyUnit: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    rowValue: { fontSize: 11.5, fontWeight: '700', color: colors.danger, marginTop: 4, fontVariant: ['tabular-nums'] },
    loadMore: { alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.pill, backgroundColor: chip, marginTop: spacing.xs },
    loadMoreText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  });
}
