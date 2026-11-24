import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface HistoryRow {
  id: number;
  type: 'in' | 'out' | 'adjustment' | 'correction';
  quantity: number;
  unit_cost: number | null;
  note: string | null;
  created_at: string;
  reversed: boolean;
  reversed_reason: string | null;
  source: string | null;
  material: { id: number; name: string; unit: string } | null;
  user: { name: string } | null;
  store: { name: string } | null;
}

interface HistoryResponse {
  data: HistoryRow[];
  has_more: boolean;
  summary: { out_today: number; in_today: number };
  // Jumlah keluar/masuk pada periode yang dipilih (tidak mengikuti filter jenis dan pencarian). Server lama belum mengirimnya.
  period_summary?: { out: number; in: number };
}

type TypeFilter = 'all' | 'out' | 'in' | 'adjustment' | 'correction';
type Period = 'today' | 'week' | 'month' | 'all';

const TYPES: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'out', label: 'Keluar' },
  { key: 'in', label: 'Masuk' },
  { key: 'adjustment', label: 'Opname' },
  { key: 'correction', label: 'Koreksi' },
];

// Kata penutup label kartu ringkasan menurut periode, mis. "Keluar 7 hari".
const PERIOD_SUFFIX: Record<Period, string> = { today: 'hari ini', week: '7 hari', month: 'bulan ini', all: '(semua)' };

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Hari ini' },
  { key: 'week', label: '7 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'all', label: 'Semua' },
];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodStart(period: Period): string | null {
  const now = new Date();
  if (period === 'today') return dateKey(now);
  if (period === 'week') return dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  if (period === 'month') return dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  return null;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function label(type: HistoryRow['type']): string {
  return { in: 'Masuk', out: 'Keluar', adjustment: 'Opname', correction: 'Koreksi' }[type];
}

/**
 * Riwayat Bahan Baku lintas bahan untuk staf gudang (sebelumnya hanya 20 baris terakhir per bahan). Isinya dibatasi server: akses
 * penuh melihat semua toko, staf lain hanya baris bertanda tokonya; harga hanya bila akunnya berizin Lihat.
 */
export default function MaterialHistoryScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [period, setPeriod] = useState<Period>('week');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [summary, setSummary] = useState<(HistoryResponse['summary'] & { period?: { out: number; in: number } }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hanya respons permintaan terbaru yang dipakai: filter yang berganti cepat tidak boleh ditimpa respons lama yang telat.
  const latest = useRef(0);

  const buildUrl = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const from = periodStart(period);
      if (from) params.set('from', from);
      if (search.trim()) params.set('search', search.trim());
      if (offset > 0) params.set('offset', String(offset));
      return `/api/staff/material-movements?${params.toString()}`;
    },
    [typeFilter, period, search]
  );

  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setError(null);
    try {
      const res = await staffApiFetch<HistoryResponse>(buildUrl(0));
      if (requestId !== latest.current) return;
      setRows(res.data);
      setHasMore(res.has_more);
      setSummary({ ...res.summary, period: res.period_summary });
    } catch (err) {
      if (requestId !== latest.current) return;
      setError(err instanceof ApiError ? err.message : 'Gagal memuat riwayat. Periksa koneksi internet.');
    }
  }, [buildUrl]);

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => load().finally(() => setLoading(false)), 300);
    return () => clearTimeout(timeout);
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
      const res = await staffApiFetch<HistoryResponse>(buildUrl(rows.length));
      if (requestId !== latest.current) return;
      setRows((current) => [...current, ...res.data]);
      setHasMore(res.has_more);
    } catch {
      // Biarkan daftar yang sudah tampil; tombol Muat Lagi tetap ada.
    } finally {
      setLoadingMore(false);
    }
  };

  const qtyText = (row: HistoryRow) => {
    if (row.type === 'correction') return '';
    const sign = row.type === 'adjustment' && row.quantity > 0 ? '+' : '';
    return `${sign}${row.quantity.toLocaleString('id-ID')} ${row.material?.unit ?? ''}`.trim();
  };

  const neutralBg = isDark ? colors.surfaceElevated : '#efeff4';
  const tone = (t: HistoryRow['type']) =>
    t === 'in'
      ? { fg: colors.success, bg: colors.successBg, icon: 'arrow-down' as const }
      : t === 'out'
        ? { fg: colors.danger, bg: colors.dangerBg, icon: 'arrow-up' as const }
        : t === 'correction'
          ? { fg: colors.textSecondary, bg: neutralBg, icon: 'arrow-undo' as const }
          : { fg: colors.warning, bg: colors.warningBg, icon: 'swap-vertical' as const };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <StatusBar style={isDark ? 'light' : 'dark'} />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>Riwayat</Text>
            <Text style={styles.subtitle}>Keluar dan masuk bahan baku</Text>
          </View>
          <Pressable onPress={() => router.push('/staff/stock/write-offs' as never)} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Daftar stok terbuang">
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        {summary ? (
          <FadeInUp style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <View style={[styles.summaryIcon, { backgroundColor: colors.dangerBg }]}>
                <Ionicons name="arrow-up" size={16} color={colors.danger} />
              </View>
              <View>
                <Text style={styles.summaryValue}>{summary.period?.out ?? summary.out_today}</Text>
                <Text style={styles.summaryLabel}>Keluar {summary.period ? PERIOD_SUFFIX[period] : 'hari ini'}</Text>
              </View>
            </View>
            <View style={styles.summaryTile}>
              <View style={[styles.summaryIcon, { backgroundColor: colors.successBg }]}>
                <Ionicons name="arrow-down" size={16} color={colors.success} />
              </View>
              <View>
                <Text style={styles.summaryValue}>{summary.period?.in ?? summary.in_today}</Text>
                <Text style={styles.summaryLabel}>Masuk {summary.period ? PERIOD_SUFFIX[period] : 'hari ini'}</Text>
              </View>
            </View>
          </FadeInUp>
        ) : null}

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Nama bahan, kode, atau catatan"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Hapus pencarian">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.tabs}>
          {TYPES.map((t) => {
            const active = typeFilter === t.key;

            return (
              <Pressable key={t.key} style={styles.tab} onPress={() => setTypeFilter(t.key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{t.label}</Text>
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
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="swap-vertical-outline" size={34} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>Belum ada pergerakan</Text>
                <Text style={styles.centerStateText}>Tidak ada pergerakan yang cocok dengan filter ini.</Text>
              </View>
            }
            ListFooterComponent={
              hasMore ? (
                <PressableScale style={styles.loadMore} onPress={loadMore} disabled={loadingMore}>
                  {loadingMore ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.loadMoreText}>Muat riwayat lainnya</Text>}
                </PressableScale>
              ) : null
            }
            renderItem={({ item, index }) => {
              const t = tone(item.type);
              const qty = qtyText(item);
              return (
                <FadeInUp index={index} enabled={index < 8}>
                  <PressableScale
                    style={[styles.row, item.reversed && { opacity: 0.55 }]}
                    disabled={!item.material}
                    onPress={() => item.material && router.push({ pathname: '/staff/materials/[id]', params: { id: String(item.material.id) } } as never)}
                    accessibilityRole="button"
                  >
                    <View style={[styles.rowIcon, { backgroundColor: t.bg }]}>
                      <Ionicons name={t.icon} size={20} color={t.fg} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[styles.rowTitle, item.reversed && styles.struck]} numberOfLines={2}>
                        {item.material ? item.material.name : '(bahan sudah dihapus)'}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {[label(item.type), item.store?.name, item.user?.name].filter(Boolean).join(' · ')}
                      </Text>
                      {item.unit_cost !== null ? (
                        <Text style={styles.rowNote}>Rp {item.unit_cost.toLocaleString('id-ID')} / {item.material?.unit ?? 'satuan'}</Text>
                      ) : null}
                      {item.source ? <Text style={styles.rowSource}>{item.source}</Text> : null}
                      {item.note ? <Text style={styles.rowNote} numberOfLines={2}>{item.note}</Text> : null}
                      {item.reversed ? (
                        <View style={styles.reversedPill}>
                          <Text style={styles.reversedNote}>Dibatalkan{item.reversed_reason ? `: ${item.reversed_reason}` : ''}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.rowDate}>{formatDateTime(item.created_at)}</Text>
                    </View>
                    {qty ? (
                      <View style={styles.qtyCol}>
                        <Text style={[styles.qtyValue, { color: t.fg }]}>{qty}</Text>
                      </View>
                    ) : null}
                  </PressableScale>
                </FadeInUp>
              );
            }}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted },

    summaryRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: 20, marginBottom: spacing.md },
    summaryTile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    summaryIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    summaryValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, lineHeight: 24, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    summaryLabel: { fontSize: 11.5, fontWeight: '600', color: colors.textMuted },

    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 20, paddingHorizontal: 16, height: 52,
      borderRadius: 26, borderWidth: 1, borderColor: line, backgroundColor: card, ...shadow,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },

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
    rowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    struck: { textDecorationLine: 'line-through' },
    rowMeta: { fontSize: 12.5, fontWeight: '500', color: colors.textSecondary },
    rowSource: { fontSize: 12.5, fontWeight: '700', color: accentText },
    rowNote: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
    reversedPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.dangerBg, marginTop: 2 },
    reversedNote: { fontSize: 12, color: colors.danger, fontWeight: '700' },
    rowDate: { fontSize: 11.5, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    qtyCol: { alignItems: 'flex-end', maxWidth: 110 },
    qtyValue: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.3, fontVariant: ['tabular-nums'], textAlign: 'right' },
    loadMore: { alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.pill, backgroundColor: chip, marginTop: spacing.xs },
    loadMoreText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  });
}
