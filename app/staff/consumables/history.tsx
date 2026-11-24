import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator, RefreshControl, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
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
  item: { id: number; name: string; unit: string } | null;
  user: { name: string } | null;
  store: { name: string } | null;
}

interface HistoryResponse {
  data: HistoryRow[];
  has_more: boolean;
  summary: { out_today: number; in_today: number };
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
 * Riwayat Barang Habis Pakai lintas bahan untuk staf gudang (sebelumnya hanya 20 baris terakhir per bahan). Isinya dibatasi server: akses
 * penuh melihat semua toko, staf lain hanya baris bertanda tokonya; harga hanya bila akunnya berizin Lihat.
 */
export default function ConsumableHistoryScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [period, setPeriod] = useState<Period>('week');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [summary, setSummary] = useState<HistoryResponse['summary'] | null>(null);
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
      return `/api/staff/consumable-movements?${params.toString()}`;
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
      setSummary(res.summary);
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
    return `${sign}${row.quantity.toLocaleString('id-ID')} ${row.item?.unit ?? ''}`.trim();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Riwayat Barang Habis Pakai</Text>
        <Pressable onPress={() => router.push('/staff/stock/write-offs' as never)} style={styles.sideButton} accessibilityLabel="Daftar stok terbuang">
          <Ionicons name="trash-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nama barang, kode, atau catatan..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View style={styles.chipRow}>
        {TYPES.map((t) => (
          <Pressable key={t.key} style={[styles.chip, typeFilter === t.key && styles.chipActive]} onPress={() => setTypeFilter(t.key)}>
            <Text style={[styles.chipText, typeFilter === t.key && styles.chipTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chipRow}>
        {PERIODS.map((p) => (
          <Pressable key={p.key} style={[styles.chip, period === p.key && styles.chipActive]} onPress={() => setPeriod(p.key)}>
            <Text style={[styles.chipText, period === p.key && styles.chipTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {summary ? <Text style={styles.summary}>Hari ini: {summary.out_today} keluar · {summary.in_today} masuk</Text> : null}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => String(row.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Ionicons name="swap-vertical-outline" size={36} color={colors.textMuted} />
              <Text style={styles.centerStateText}>Tidak ada pergerakan yang cocok.</Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <Pressable style={styles.loadMore} onPress={loadMore} disabled={loadingMore}>
                {loadingMore ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.loadMoreText}>Muat Riwayat Lainnya</Text>}
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, item.reversed && { opacity: 0.55 }]}
              disabled={!item.item}
              onPress={() => item.item && router.push({ pathname: '/staff/consumables/[id]', params: { id: String(item.item.id) } } as never)}
            >
              <Ionicons
                name={item.type === 'in' ? 'arrow-down-circle' : item.type === 'out' ? 'arrow-up-circle' : item.type === 'correction' ? 'arrow-undo-circle' : 'swap-vertical'}
                size={22}
                color={item.type === 'in' ? colors.success : item.type === 'out' ? colors.danger : item.type === 'correction' ? colors.textMuted : colors.warning}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, item.reversed && styles.struck]} numberOfLines={1}>
                  {item.item ? item.item.name : '(barang sudah dihapus)'}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {[label(item.type), qtyText(item), item.store?.name, item.user?.name].filter(Boolean).join(' · ')}
                </Text>
                {item.unit_cost !== null ? (
                  <Text style={styles.rowNote}>Rp {item.unit_cost.toLocaleString('id-ID')} / {item.item?.unit ?? 'satuan'}</Text>
                ) : null}
                {item.source ? <Text style={styles.rowSource}>{item.source}</Text> : null}
                {item.note ? <Text style={styles.rowNote} numberOfLines={2}>{item.note}</Text> : null}
                {item.reversed ? <Text style={styles.reversedNote}>Dibatalkan{item.reversed_reason ? `: ${item.reversed_reason}` : ''}</Text> : null}
                <Text style={styles.rowDate}>{formatDateTime(item.created_at)}</Text>
              </View>
              {item.item ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
            </Pressable>
          )}
        />
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.sm, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    chipRow: { flexDirection: 'row', gap: spacing.xs, marginHorizontal: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
    chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
    chipTextActive: { color: '#ffffff' },
    summary: { marginHorizontal: spacing.md, marginTop: spacing.sm, fontSize: fontSize.xs, color: colors.textMuted },
    centerState: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    listContent: { padding: spacing.md, gap: spacing.xs, flexGrow: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border },
    rowTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    struck: { textDecorationLine: 'line-through' },
    rowMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    rowSource: { fontSize: fontSize.xs, color: colors.accent, marginTop: 2, fontWeight: '600' },
    rowNote: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    reversedNote: { fontSize: fontSize.xs, color: colors.danger, marginTop: 2, fontWeight: '600' },
    rowDate: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },
    loadMore: { alignItems: 'center', paddingVertical: spacing.md },
    loadMoreText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.accent },
  });
}
