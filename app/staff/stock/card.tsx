import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Switch, KeyboardAvoidingView, ScrollView } from 'react-native';
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

type Jenis = 'all' | 'raw_material' | 'consumable_item';

interface CardRow {
  id: number;
  source: 'raw_material' | 'consumable_item';
  name: string;
  code: string | null;
  category: string | null;
  jenis: string;
  unit: string;
  awal: number;
  masuk: number;
  keluar: number;
  masuk_detail?: { pembelian: number; pengembalian: number; penyesuaian: number };
  keluar_detail?: { pakai: number; dibuang: number; penyesuaian: number };
  akhir: number;
  low: boolean;
  inactive: boolean;
  anomaly: boolean;
  has_movement: boolean;
}

interface CardResponse {
  data: CardRow[];
  has_more: boolean;
  totals: { masuk: number; keluar: number; masuk_count?: number; keluar_count?: number; count: number; anomalies: number };
  from: string;
  until: string;
  available_jenis: Jenis;
}

type Period = 'today' | 'week' | 'month' | 'last_month';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Hari ini' },
  { key: 'week', label: '7 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'last_month', label: 'Bulan lalu' },
];

const MASUK_LABELS: Record<string, string> = { pembelian: 'Pembelian', pengembalian: 'Pengembalian memo', penyesuaian: 'Penyesuaian' };
const KELUAR_LABELS: Record<string, string> = { pakai: 'Pakai', dibuang: 'Dibuang', penyesuaian: 'Penyesuaian' };

/** Rincian asal Masuk/Keluar, mis. "Masuk: Pembelian 10 · Pengembalian memo 2"; bagian bernilai 0 dihilangkan. */
function breakdown(prefix: string, detail: Record<string, number> | undefined, labels: Record<string, string>, format: (n: number) => string): string {
  if (!detail) return '';
  const parts = Object.keys(labels).filter((key) => (detail[key] ?? 0) > 0).map((key) => `${labels[key]} ${format(detail[key])}`);
  return parts.length > 0 ? `${prefix}: ${parts.join(' · ')}` : '';
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function range(period: Period): { from: string; until: string } {
  const now = new Date();
  if (period === 'today') return { from: dateKey(now), until: dateKey(now) };
  if (period === 'week') return { from: dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), until: dateKey(now) };
  if (period === 'last_month') {
    return { from: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), until: dateKey(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  return { from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), until: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
}

function fmt(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

/**
 * Rekap Stok untuk staf gudang (padanan Daftar Stok di panel, angkanya dari layanan yang sama): Awal, Masuk, Keluar, Akhir per barang
 * untuk satu periode. Tanpa harga. Stok bersifat nasional. Jenis yang tampil mengikuti menu asal akun (Bahan Baku / Barang Habis Pakai).
 *
 * Tampilan dirancang ulang 2026-11-13, selaras dengan layar Riwayat dan Stok Terbuang: judul besar, ringkasan periode berbentuk kartu ringkas,
 * periode berupa segmen, dan tiap barang sebagai kartu dengan empat angka (Awal, Masuk, Keluar, Akhir) dalam satu kotak lembut.
 */
export default function StockCardScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [period, setPeriod] = useState<Period>('month');
  const [jenis, setJenis] = useState<Jenis>('all');
  const [search, setSearch] = useState('');
  const [onlyMoved, setOnlyMoved] = useState(false);
  const [rows, setRows] = useState<CardRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [totals, setTotals] = useState<CardResponse['totals'] | null>(null);
  const [available, setAvailable] = useState<Jenis>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hanya respons permintaan terbaru yang dipakai: filter yang berganti cepat tidak boleh ditimpa respons lama yang telat.
  const latest = useRef(0);

  const buildUrl = useCallback(
    (offset: number) => {
      const { from, until } = range(period);
      const params = new URLSearchParams({ from, until, jenis });
      if (search.trim()) params.set('search', search.trim());
      if (onlyMoved) params.set('only_moved', '1');
      if (offset > 0) params.set('offset', String(offset));
      return `/api/staff/stock-card?${params.toString()}`;
    },
    [period, jenis, search, onlyMoved]
  );

  const load = useCallback(async () => {
    const requestId = ++latest.current;
    setError(null);
    try {
      const res = await staffApiFetch<CardResponse>(buildUrl(0));
      if (requestId !== latest.current) return;
      setRows(res.data);
      setHasMore(res.has_more);
      setTotals(res.totals);
      setAvailable(res.available_jenis);
    } catch (err) {
      if (requestId !== latest.current) return;
      setError(err instanceof ApiError ? err.message : 'Gagal memuat rekap stok. Periksa koneksi internet.');
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
      const res = await staffApiFetch<CardResponse>(buildUrl(rows.length));
      if (requestId !== latest.current) return;
      setRows((current) => [...current, ...res.data]);
      setHasMore(res.has_more);
    } catch {
      // Biarkan daftar yang sudah tampil; tombol Muat Lagi tetap ada.
    } finally {
      setLoadingMore(false);
    }
  };

  const jenisOptions: { key: Jenis; label: string }[] =
    available === 'all'
      ? [{ key: 'all', label: 'Semua' }, { key: 'raw_material', label: 'Bahan Baku' }, { key: 'consumable_item', label: 'Barang Habis Pakai' }]
      : [{ key: available, label: available === 'raw_material' ? 'Bahan Baku' : 'Barang Habis Pakai' }];

  const openItem = (row: CardRow) =>
    router.push({ pathname: row.source === 'raw_material' ? '/staff/materials/[id]' : '/staff/consumables/[id]', params: { id: String(row.id) } } as never);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <StatusBar style={isDark ? 'light' : 'dark'} />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>Rekap Stok</Text>
          </View>
        </View>

        {totals ? (
          <FadeInUp style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <View style={[styles.summaryIcon, { backgroundColor: isDark ? colors.surfaceElevated : '#efeff4' }]}>
                <Ionicons name="cube-outline" size={16} color={colors.textSecondary} />
              </View>
              <View>
                <Text style={styles.summaryValue}>{totals.count}</Text>
                <Text style={styles.summaryLabel}>Barang</Text>
              </View>
            </View>
            <View style={styles.summaryTile}>
              <View style={[styles.summaryIcon, { backgroundColor: colors.successBg }]}>
                <Ionicons name="arrow-down" size={16} color={colors.success} />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={[styles.summaryValue, { color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit>{totals.masuk_count ?? 0}</Text>
                <Text style={styles.summaryLabel}>Barang masuk</Text>
              </View>
            </View>
            <View style={styles.summaryTile}>
              <View style={[styles.summaryIcon, { backgroundColor: colors.dangerBg }]}>
                <Ionicons name="arrow-up" size={16} color={colors.danger} />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={[styles.summaryValue, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>{totals.keluar_count ?? 0}</Text>
                <Text style={styles.summaryLabel}>Barang keluar</Text>
              </View>
            </View>
          </FadeInUp>
        ) : null}

        {totals && totals.anomalies > 0 ? (
          <View style={styles.anomalyBox}>
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <Text style={styles.anomalyText}>
              {totals.anomalies} barang stok dan riwayatnya tidak sinkron (angka negatif). Minta admin menjalankan Cek Rekonsiliasi.
            </Text>
          </View>
        ) : null}

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Nama atau kode barang"
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

        {jenisOptions.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
            {jenisOptions.map((j) => (
              <Pressable key={j.key} style={[styles.chip, jenis === j.key && styles.chipActive]} onPress={() => setJenis(j.key)} accessibilityRole="button">
                <Text style={[styles.chipText, jenis === j.key && styles.chipTextActive]}>{j.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.segment}>
          {PERIODS.map((p) => (
            <Pressable
              key={p.key}
              style={[styles.segmentItem, period === p.key && styles.segmentItemActive]}
              onPress={() => setPeriod(p.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: period === p.key }}
            >
              <Text style={[styles.segmentText, period === p.key && styles.segmentTextActive]} numberOfLines={1}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Hanya yang bergerak di periode</Text>
          <Switch value={onlyMoved} onValueChange={setOnlyMoved} trackColor={{ true: colors.accent }} />
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
            keyExtractor={(row) => `${row.source}-${row.id}`}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="cube-outline" size={34} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>Barang tidak ditemukan</Text>
                <Text style={styles.centerStateText}>Coba kata kunci lain atau ganti periodenya.</Text>
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
                <PressableScale style={[styles.row, !item.has_movement && { opacity: 0.75 }]} onPress={() => openItem(item)} accessibilityRole="button">
                  <View style={styles.rowTop}>
                    <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
                    {item.low ? (
                      <View style={[styles.tag, { backgroundColor: colors.dangerBg }]}>
                        <Text style={[styles.tagText, { color: colors.danger }]}>Menipis</Text>
                      </View>
                    ) : null}
                    {item.inactive ? (
                      <View style={[styles.tag, { backgroundColor: isDark ? colors.surfaceElevated : '#efeff4' }]}>
                        <Text style={[styles.tagText, { color: colors.textMuted }]}>Nonaktif</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.rowMeta} numberOfLines={1}>{[item.code, item.category, item.jenis].filter(Boolean).join(' · ')}</Text>

                  <View style={styles.numbers}>
                    <View style={styles.numCell}>
                      <Text style={styles.numLabel}>Awal</Text>
                      <Text style={[styles.numValue, item.awal < 0 && { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>{fmt(item.awal)}</Text>
                    </View>
                    <View style={styles.numCell}>
                      <Text style={styles.numLabel}>Masuk</Text>
                      <Text style={[styles.numValue, { color: item.masuk > 0 ? colors.success : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                        {item.masuk > 0 ? `+${fmt(item.masuk)}` : '0'}
                      </Text>
                    </View>
                    <View style={styles.numCell}>
                      <Text style={styles.numLabel}>Keluar</Text>
                      <Text style={[styles.numValue, { color: item.keluar > 0 ? colors.danger : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                        {item.keluar > 0 ? `−${fmt(item.keluar)}` : '0'}
                      </Text>
                    </View>
                    <View style={[styles.numCell, styles.numCellEnd]}>
                      <Text style={styles.numLabel}>Akhir</Text>
                      <Text style={[styles.numValue, styles.numStrong, item.akhir < 0 && { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
                        {fmt(item.akhir)} {item.unit}
                      </Text>
                    </View>
                  </View>
                  {item.masuk > 0 || item.keluar > 0 ? (
                    <Text style={styles.rowMeta}>
                      {[breakdown('Masuk', item.masuk_detail, MASUK_LABELS, fmt), breakdown('Keluar', item.keluar_detail, KELUAR_LABELS, fmt)].filter(Boolean).join('\n')}
                    </Text>
                  ) : null}
                </PressableScale>
              </FadeInUp>
            )}
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
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: colors.textPrimary },

    summaryRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: 20, marginBottom: spacing.md },
    summaryTile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 18, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    summaryIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    summaryValue: { fontSize: 17, fontWeight: '800', letterSpacing: -0.4, lineHeight: 22, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    summaryLabel: { fontSize: 11.5, fontWeight: '600', color: colors.textMuted },

    anomalyBox: { flexDirection: 'row', gap: spacing.sm, marginHorizontal: 20, marginBottom: spacing.md, padding: 12, borderRadius: 16, backgroundColor: colors.warningBg },
    anomalyText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18, color: colors.warning },

    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 20, paddingHorizontal: 16, height: 52,
      borderRadius: 26, borderWidth: 1, borderColor: line, backgroundColor: card, ...shadow,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },

    chipScroll: { flexGrow: 0, flexShrink: 0, maxHeight: 56 },
    chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 20, paddingVertical: spacing.sm + 2 },
    chip: { height: 38, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip, flexShrink: 0 },
    chipActive: { backgroundColor: colors.accent },
    chipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    chipTextActive: { color: '#ffffff' },

    segment: { flexDirection: 'row', marginHorizontal: 20, marginTop: spacing.sm, padding: 4, borderRadius: radius.pill, backgroundColor: chip },
    segmentItem: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
    segmentItemActive: { backgroundColor: card, ...shadow },
    segmentText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
    segmentTextActive: { color: colors.textPrimary },

    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 24, marginTop: spacing.sm, marginBottom: spacing.xs },
    switchLabel: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },

    centerState: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.xs, paddingBottom: spacing.xxl, flexGrow: 1 },
    row: { padding: 16, marginBottom: spacing.sm + 2, backgroundColor: card, borderRadius: 24, borderWidth: 1, borderColor: line, gap: 4, ...shadow },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
    rowName: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
    tagText: { fontSize: 11.5, fontWeight: '800' },
    rowMeta: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    numbers: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, padding: 12, borderRadius: 18, backgroundColor: chip },
    numCell: { flex: 1, gap: 2 },
    numCellEnd: { flex: 1.5, alignItems: 'flex-end' },
    numLabel: { fontSize: 11.5, fontWeight: '600', color: colors.textMuted },
    numValue: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    numStrong: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.3 },
    loadMore: { alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.pill, backgroundColor: chip, marginTop: spacing.xs },
    loadMoreText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  });
}
