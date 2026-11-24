import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator, RefreshControl, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface ConsumableListItem {
  id: number;
  name: string;
  code: string | null;
  category: string | null;
  unit: string;
  current_stock: string;
  reorder_point: string | null;
  is_low_stock?: boolean;
}

type FilterMode = 'all' | 'low';

interface ListResponse {
  data: ConsumableListItem[];
  total?: number;
  limit?: number;
  summary?: { all: number; low: number };
  can_modify?: boolean;
}

const FILTERS: { key: FilterMode; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'low', label: 'Menipis' },
];

// Barang Habis Pakai (lakban, lap, cutter, dll) — sama pola dengan Bahan
// Baku: tidak ada kode fisik per unit, jadi dicari lewat nama/kode, bukan
// scan kamera.
export default function ConsumablesSearchScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Dibuka dari kartu "Stok perlu perhatian" di Beranda dengan ?filter=low.
  const params = useLocalSearchParams<{ filter?: string }>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>(params.filter === 'low' ? 'low' : 'all');
  const [items, setItems] = useState<ConsumableListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ListResponse['summary']>(undefined);
  const [canModify, setCanModify] = useState(true);

  // Hanya respons permintaan terbaru yang dipakai: ketikan/filter yang berganti cepat tidak boleh ditimpa respons lama yang telat.
  const latestRequest = useRef(0);

  const fetchItems = useCallback((query: string, mode: FilterMode) => {
    const requestId = ++latestRequest.current;
    setError(null);
    setDenied(false);
    return staffApiFetch<ListResponse>(`/api/staff/consumables?search=${encodeURIComponent(query)}${mode !== 'all' ? `&filter=${mode}` : ''}`)
      .then((res) => {
        if (requestId !== latestRequest.current) return;
        setItems(res.data);
        setTotal(res.total ?? res.data.length);
        setSummary(res.summary);
        setCanModify(res.can_modify !== false);
      })
      .catch((err) => {
        if (requestId !== latestRequest.current) return;
        if (err instanceof ApiError && err.status === 403) {
          setDenied(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar barang.');
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => fetchItems(search, filter).finally(() => setLoading(false)), 300);
    return () => clearTimeout(timeout);
  }, [search, filter, fetchItems]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItems(search, filter);
    setRefreshing(false);
  }, [fetchItems, search, filter]);

  const isLowStock = (item: ConsumableListItem) =>
    item.is_low_stock ?? (item.reorder_point !== null && parseFloat(item.current_stock) <= parseFloat(item.reorder_point));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Barang Habis Pakai</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/staff/stock/scan' as never)} style={styles.sideButton} accessibilityLabel="Scan label stok">
            <Ionicons name="qr-code-outline" size={22} color={colors.accent} />
          </Pressable>
          <Pressable onPress={() => router.push('/staff/consumables/history' as never)} style={styles.sideButton} accessibilityLabel="Riwayat barang habis pakai">
            <Ionicons name="time-outline" size={22} color={colors.accent} />
          </Pressable>
          <Pressable onPress={() => router.push('/staff/stock/card' as never)} style={styles.sideButton} accessibilityLabel="Rekap stok per periode">
            <Ionicons name="stats-chart-outline" size={22} color={colors.accent} />
          </Pressable>
          {canModify ? (
            <Pressable onPress={() => router.push({ pathname: '/staff/stock/count', params: { type: 'consumables' } } as never)} style={styles.sideButton} accessibilityLabel="Hitung stok sekaligus">
              <Ionicons name="clipboard-outline" size={22} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nama atau kode barang..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View style={styles.chipRow}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)} accessibilityRole="button">
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
              {f.label}
              {summary && summary[f.key] > 0 ? ` (${summary[f.key]})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {!canModify && !denied && (
        <Text style={styles.readOnlyNote}>Akun ini hanya bisa melihat stok, tidak bisa mencatat barang masuk/keluar.</Text>
      )}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : denied ? (
        <View style={styles.centerState}>
          <Ionicons name="lock-closed-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>
            Akun ini belum diberi akses ke menu Barang Habis Pakai. Minta admin mencentang menu Barang Habis Pakai di Hak Akses.
          </Text>
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.centerStateText}>Tidak ada barang ditemukan.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListFooterComponent={
            total > items.length ? (
              <Text style={styles.footerNote}>
                Menampilkan {items.length} dari {total} barang. Ketik nama atau kode di kolom cari untuk menemukan yang lain.
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/staff/consumables/[id]', params: { id: String(item.id) } } as never)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                {(item.code || item.category) && (
                  <Text style={styles.rowCategory}>
                    {[item.code, item.category].filter(Boolean).join(' · ')}
                  </Text>
                )}
                {isLowStock(item) && (
                  <View style={styles.lowBadge}>
                    <Text style={styles.lowBadgeText}>Stok Menipis</Text>
                  </View>
                )}
              </View>
              {/* Pill+ikon — disatukan dengan pola status di modul lain
                  (sebelumnya cuma angka berwarna tanpa badge). */}
              <View style={[styles.stockBadge, isLowStock(item) ? styles.stockDanger : styles.stockOk]}>
                <Ionicons
                  name={isLowStock(item) ? 'alert-circle' : 'checkmark-circle'}
                  size={13}
                  color={isLowStock(item) ? colors.danger : colors.success}
                />
                <Text style={[styles.rowStock, { color: isLowStock(item) ? colors.danger : colors.success }]}>
                  {parseFloat(item.current_stock).toLocaleString('id-ID')} {item.unit}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
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
    headerActions: { flexDirection: 'row' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.sm,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    listContent: { padding: spacing.md, gap: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    rowCategory: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    rowStock: { fontSize: fontSize.sm, fontWeight: '700' },
    lowBadge: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.danger + '22' },
    lowBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.danger },
    chipRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    chip: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
    chipTextActive: { color: '#ffffff' },
    readOnlyNote: { fontSize: fontSize.xs, color: colors.textMuted, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    footerNote: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
    stockBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
    stockOk: { backgroundColor: colors.successBg },
    stockDanger: { backgroundColor: colors.dangerBg },
  });
}
