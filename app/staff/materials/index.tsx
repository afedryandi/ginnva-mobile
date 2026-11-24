import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, RefreshControl, KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import StockScanner from '@/components/stock/StockScanner';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface MaterialListItem {
  id: number;
  name: string;
  code: string | null;
  category: string | null;
  unit: string;
  current_stock: string;
  reorder_point: string | null;
  nearest_expiry_date: string | null;
  is_expired: boolean;
  is_near_expiry: boolean;
  is_low_stock?: boolean;
}

interface ListResponse {
  data: MaterialListItem[];
  total?: number;
  limit?: number;
  summary?: { all: number; low: number; expiry: number };
  can_modify?: boolean;
}

type FilterMode = 'all' | 'low' | 'expiry';
type Mode = 'scan' | 'search';

const FILTERS: { key: FilterMode; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'low', label: 'Menipis' },
  { key: 'expiry', label: 'Kedaluwarsa' },
];

// Bahan baku TIDAK punya kode fisik per unit (beda dari Barang/Aset yang
// bisa discan QR) — jadi dicari lewat nama di sini, bukan scan kamera.
//
// Tampilan dirancang ulang 2026-11-13, selaras dengan layar Produk PPF/WF dan Lead: judul besar, empat pintasan berlabel (sebelumnya empat
// ikon tanpa nama di header), chip filter dengan jumlah, dan tiap bahan sebagai kartu dengan jumlah stok yang menonjol.
export default function MaterialsSearchScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  // Dibuka dari kartu "Stok perlu perhatian" di Beranda dengan ?filter=low atau ?filter=expiry.
  const params = useLocalSearchParams<{ filter?: string }>();
  // Pola sama dengan Produk PPF/WF: Scan QR di kiri, Cari Manual di kanan. Dibuka dari kartu stok di Beranda (?filter=...) langsung ke daftar.
  const [mode, setMode] = useState<Mode>(params.filter === 'low' || params.filter === 'expiry' ? 'search' : 'scan');
  const scanMode = mode === 'scan';
  const styles = useMemo(() => createStyles(colors, isDark, scanMode), [colors, isDark, scanMode]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>(params.filter === 'low' || params.filter === 'expiry' ? params.filter : 'all');
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ListResponse['summary']>(undefined);
  const [canModify, setCanModify] = useState(true);

  // Hanya respons permintaan terbaru yang dipakai: ketikan/filter yang berganti cepat tidak boleh ditimpa respons lama yang telat.
  const latestRequest = useRef(0);

  const fetchMaterials = useCallback((query: string, mode: FilterMode) => {
    const requestId = ++latestRequest.current;
    setError(null);
    setDenied(false);
    return staffApiFetch<ListResponse>(`/api/staff/materials?search=${encodeURIComponent(query)}${mode !== 'all' ? `&filter=${mode}` : ''}`)
      .then((res) => {
        if (requestId !== latestRequest.current) return;
        setMaterials(res.data);
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
        setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar bahan baku.');
      });
  }, []);

  useEffect(() => {
    if (mode !== 'search') return;
    setLoading(true);
    const timeout = setTimeout(() => fetchMaterials(search, filter).finally(() => setLoading(false)), 300);
    return () => clearTimeout(timeout);
  }, [mode, search, filter, fetchMaterials]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMaterials(search, filter);
    setRefreshing(false);
  }, [fetchMaterials, search, filter]);

  const isLowStock = (m: MaterialListItem) =>
    m.is_low_stock ?? (m.reorder_point !== null && parseFloat(m.current_stock) <= parseFloat(m.reorder_point));

  const shortcuts: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }[] = [
    { key: 'card', label: 'Rekap Stok', icon: 'stats-chart-outline', onPress: () => router.push('/staff/stock/card' as never) },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <StatusBar style={scanMode || isDark ? 'light' : 'dark'} />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={scanMode ? '#ffffff' : colors.textSecondary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>Bahan Baku</Text>
            {!scanMode && !loading && !denied && !error ? <Text style={styles.subtitle}>{total} bahan</Text> : null}
          </View>
          <Pressable onPress={() => router.push('/staff/materials/history' as never)} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Riwayat bahan baku">
            <Ionicons name="time-outline" size={22} color={scanMode ? '#ffffff' : colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.segment}>
          {([
            { key: 'scan', label: 'Scan QR', icon: 'qr-code-outline' },
            { key: 'search', label: 'Cari Manual', icon: 'search-outline' },
          ] as const).map((m) => {
            const active = mode === m.key;
            return (
              <Pressable key={m.key} style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={() => setMode(m.key)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Ionicons name={m.icon} size={16} color={active ? styles.segmentTextActive.color : styles.segmentText.color} />
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {scanMode ? (
          <StockScanner showManualInput={false} />
        ) : (
        <>
        {/* Pintasan berlabel, lebar sama, tanpa geser: sebelumnya empat ikon polos di header yang harus ditebak fungsinya. */}
        <View style={styles.shortcutRow}>
          {shortcuts.map((s) => (
            <PressableScale key={s.key} style={styles.shortcut} onPress={s.onPress} accessibilityRole="button" accessibilityLabel={s.label}>
              <View style={styles.shortcutIcon}>
                <Ionicons name={s.icon} size={16} color={styles.accentText.color} />
              </View>
              <Text style={styles.shortcutLabel} numberOfLines={1}>{s.label}</Text>
            </PressableScale>
          ))}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Cari nama atau kode bahan"
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
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count = summary ? summary[f.key] : 0;

            return (
              <Pressable key={f.key} style={styles.tab} onPress={() => setFilter(f.key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <View style={styles.tabTop}>
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{f.label}</Text>
                  {count > 0 ? (
                    <View style={[styles.tabCount, f.key !== 'all' && styles.tabCountAlert]}>
                      <Text style={[styles.tabCountText, f.key !== 'all' && styles.tabCountTextAlert]}>{count}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={[styles.tabBar, active && styles.tabBarActive]} />
              </Pressable>
            );
          })}
        </View>

        {!canModify && !denied ? (
          <View style={styles.noticeBox}>
            <Ionicons name="eye-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.noticeText}>Akun ini hanya bisa melihat stok, tidak bisa mencatat bahan masuk/keluar.</Text>
          </View>
        ) : null}

        {loading ? (
          <SkeletonCards count={4} />
        ) : denied ? (
          <View style={styles.centerState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="lock-closed-outline" size={34} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Belum ada akses</Text>
            <Text style={styles.centerStateText}>
              Akun ini belum diberi akses ke menu Bahan Baku. Minta admin mencentang menu Daftar Bahan Baku di Hak Akses.
            </Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="alert-circle-outline" size={34} color={colors.danger} />
            </View>
            <Text style={styles.centerStateText}>{error}</Text>
          </View>
        ) : materials.length === 0 ? (
          <View style={styles.centerState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="flask-outline" size={34} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Bahan tidak ditemukan</Text>
            <Text style={styles.centerStateText}>Coba kata kunci lain atau ganti filternya.</Text>
          </View>
        ) : (
          <FlatList
            data={materials}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            ListFooterComponent={
              total > materials.length ? (
                <Text style={styles.footerNote}>
                  Menampilkan {materials.length} dari {total} bahan. Ketik nama atau kode di kolom cari untuk menemukan yang lain.
                </Text>
              ) : null
            }
            renderItem={({ item, index }) => {
              const low = isLowStock(item);
              return (
<FadeInUp index={index} enabled={index < 8}>
                <PressableScale
                  style={styles.row}
                  onPress={() => router.push({ pathname: '/staff/materials/[id]', params: { id: String(item.id) } } as never)}
                  accessibilityRole="button"
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="flask-outline" size={20} color={colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
                    {item.code || item.category ? (
                      <Text style={styles.rowCategory} numberOfLines={1}>{[item.code, item.category].filter(Boolean).join(' · ')}</Text>
                    ) : null}
                    {low || item.is_expired || item.is_near_expiry ? (
                      <View style={styles.tagRow}>
                        {low ? (
                          <View style={[styles.tag, { backgroundColor: colors.dangerBg }]}>
                            <Text style={[styles.tagText, { color: colors.danger }]}>Stok menipis</Text>
                          </View>
                        ) : null}
                        {item.is_expired || item.is_near_expiry ? (
                          <View style={[styles.tag, { backgroundColor: item.is_expired ? colors.dangerBg : colors.warningBg }]}>
                            <Text style={[styles.tagText, { color: item.is_expired ? colors.danger : colors.warning }]}>
                              {item.is_expired ? 'Sudah kedaluwarsa' : 'Mendekati kedaluwarsa'}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.stockCol}>
                    <Text style={[styles.stockValue, { color: low ? colors.danger : colors.textPrimary }]}>
                      {parseFloat(item.current_stock).toLocaleString('id-ID')}
                    </Text>
                    <Text style={styles.stockUnit}>{item.unit}</Text>
                  </View>
                </PressableScale>
              </FadeInUp>
);
            }}
          />
        )}
        </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean, scanMode: boolean) {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: scanMode ? '#0b0b10' : screenBg },
    accentText: { color: accentText },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: scanMode ? 'rgba(255,255,255,0.14)' : card, borderWidth: scanMode ? 0 : 1, borderColor: line },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: scanMode ? '#ffffff' : colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: scanMode ? 'rgba(255,255,255,0.65)' : colors.textMuted, fontVariant: ['tabular-nums'] },

    segment: { flexDirection: 'row', marginHorizontal: 20, marginBottom: spacing.md, padding: 4, borderRadius: radius.pill, backgroundColor: scanMode ? 'rgba(255,255,255,0.12)' : chip },
    segmentItem: { flex: 1, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.pill },
    segmentItemActive: { backgroundColor: scanMode ? '#ffffff' : card, ...(scanMode ? {} : shadow) },
    segmentText: { fontSize: 14, fontWeight: '700', color: scanMode ? 'rgba(255,255,255,0.75)' : colors.textMuted },
    segmentTextActive: { color: scanMode ? '#14141b' : colors.textPrimary },

    shortcutRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: 20, paddingBottom: spacing.sm },
    shortcut: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, paddingHorizontal: 10, borderRadius: 23,
      backgroundColor: card, borderWidth: 1, borderColor: line,
    },
    shortcutIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    shortcutLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },

    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 20, paddingHorizontal: 16, height: 52,
      borderRadius: 26, borderWidth: 1, borderColor: line, backgroundColor: card, ...shadow,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },

    tabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: spacing.md, borderBottomWidth: 1, borderBottomColor: line },
    tab: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 8 },
    tabTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tabText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    tabTextActive: { color: colors.textPrimary },
    tabCount: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    tabCountAlert: { backgroundColor: colors.dangerBg },
    tabCountText: { fontSize: 11, fontWeight: '800', color: colors.textSecondary },
    tabCountTextAlert: { color: colors.danger },
    tabBar: { height: 3, width: '60%', borderRadius: 2, backgroundColor: 'transparent' },
    tabBarActive: { backgroundColor: colors.accent },

    noticeBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 20, marginTop: spacing.sm, padding: 12, borderRadius: 16, backgroundColor: chip },
    noticeText: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 18, color: colors.textSecondary },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    centerStateText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, padding: 16, marginBottom: spacing.sm + 2, backgroundColor: card, borderRadius: 24, borderWidth: 1, borderColor: line, ...shadow },
    rowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    rowName: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    rowCategory: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
    tagText: { fontSize: 11.5, fontWeight: '800' },
    stockCol: { alignItems: 'flex-end', minWidth: 52 },
    stockValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
    stockUnit: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    footerNote: { fontSize: 12.5, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md, lineHeight: 19 },
  });
}
