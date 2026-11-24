import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, FlatList, ActivityIndicator, RefreshControl, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface Guide {
  id: string;
  title: string;
  summary: string;
  category?: string;
  category_label?: string;
  steps: string[];
  tips: string[];
  note: string | null;
  version: string;
  reviewed_at: string;
  overdue: boolean;
}

// Teks panduan memakai penanda **tebal** sederhana (sama dengan panel); dipecah jadi potongan Text bertumpuk.
function RichText({ text, style, boldStyle }: { text: string; style: object; boldStyle: object }) {
  const parts = text.split('**');
  return (
    <Text style={style}>
      {parts.map((part, index) => (index % 2 === 1 ? <Text key={index} style={boldStyle}>{part}</Text> : part))}
    </Text>
  );
}

function formatReviewed(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Row =
  | { type: 'header'; key: string; category: string; label: string; count: number; open: boolean }
  | { type: 'guide'; key: string; guide: Guide };

function searchText(guide: Guide): string {
  return [guide.title, guide.summary, ...guide.steps, ...guide.tips, guide.note ?? ''].join(' ').replace(/\*\*/g, '').toLowerCase();
}

// Panduan Penggunaan di aplikasi staf (Panduan Fase 3). Isinya dari API yang sama dengan panel; daftar sudah disaring server menurut
// peran dan akses menu. Pencarian berjalan di perangkat karena isinya statis dan kecil.
export default function StaffGuidesScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  // Kelompok yang dibuka. null = bawaan: hanya kelompok pertama (peran Anda). Saat mencari, semua kelompok yang cocok dibuka.
  const [openCats, setOpenCats] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ guides: Guide[] }>('/api/staff/guides');
      setGuides(res.guides);
    } catch {
      setError('Gagal memuat panduan. Periksa koneksi internet.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === '' ? guides : guides.filter((guide) => searchText(guide).includes(needle));
  }, [guides, query]);

  const searching = query.trim() !== '';

  const rows = useMemo<Row[]>(() => {
    const keys: string[] = [];
    visible.forEach((g) => {
      const k = g.category ?? 'lainnya';
      if (!keys.includes(k)) keys.push(k);
    });
    const out: Row[] = [];
    keys.forEach((k, i) => {
      const items = visible.filter((g) => (g.category ?? 'lainnya') === k);
      const open = searching || (openCats === null ? i === 0 : openCats.includes(k));
      out.push({ type: 'header', key: `h-${k}`, category: k, label: items[0].category_label ?? 'Lainnya', count: items.length, open });
      if (open) items.forEach((g) => out.push({ type: 'guide', key: g.id, guide: g }));
    });
    return out;
  }, [visible, openCats, searching]);

  const toggleCat = useCallback(
    (category: string) => {
      const currentlyOpen = rows.filter((r) => r.type === 'header' && r.open).map((r) => (r as Extract<Row, { type: 'header' }>).category);
      setOpenCats(currentlyOpen.includes(category) ? currentlyOpen.filter((c) => c !== category) : [...currentlyOpen, category]);
    },
    [rows]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Panduan Penggunaan</Text>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Cari panduan"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query !== '' ? (
          <Pressable onPress={() => setQuery('')} accessibilityLabel="Hapus pencarian" hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            error ? null : (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="book-outline" size={34} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyText}>{query === '' ? 'Belum ada panduan untuk akun ini' : 'Tidak ada panduan yang cocok'}</Text>
              </View>
            )
          }
          renderItem={({ item: row }) => {
            if (row.type === 'header') {
              return (
                <Pressable style={styles.groupHead} onPress={() => (searching ? undefined : toggleCat(row.category))} accessibilityRole="button" accessibilityState={{ expanded: row.open }}>
                  <Text style={styles.groupTitle}>{row.label}</Text>
                  <View style={styles.groupCount}><Text style={styles.groupCountText}>{row.count}</Text></View>
                  <View style={{ flex: 1 }} />
                  {searching ? null : <Ionicons name={row.open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />}
                </Pressable>
              );
            }
            const item = row.guide;
            const open = openId === item.id || searching;
            return (
              <View style={styles.card}>
                <Pressable style={styles.cardHead} onPress={() => setOpenId(openId === item.id ? null : item.id)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
                  <View style={styles.cardHeadText}>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.summary}>{item.summary}</Text>
                  </View>
                  <View style={styles.chevronWrap}>
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                  </View>
                </Pressable>

                {open ? (
                  <View style={styles.body}>
                    {item.steps.map((step, index) => (
                      <View key={index} style={styles.stepRow}>
                        <View style={styles.stepNumber}>
                          <Text style={styles.stepNumberText}>{index + 1}</Text>
                        </View>
                        <View style={styles.stepText}>
                          <RichText text={step} style={styles.stepBody} boldStyle={styles.bold} />
                        </View>
                      </View>
                    ))}
                    {item.tips.length > 0 ? <Text style={styles.tipsLabel}>Catatan</Text> : null}
                    {item.tips.map((tip, index) => (
                      <View key={`tip-${index}`} style={styles.tipRow}>
                        <View style={styles.tipDot} />
                        <View style={styles.stepText}>
                          <RichText text={tip} style={styles.tipBody} boldStyle={styles.bold} />
                        </View>
                      </View>
                    ))}
                    {item.note ? (
                      <View style={styles.noteBox}>
                        <Text style={styles.tipsLabel}>Catatan perusahaan</Text>
                        <RichText text={item.note} style={styles.stepBody} boldStyle={styles.bold} />
                      </View>
                    ) : null}
                    <Text style={styles.footer}>
                      Versi {item.version} · ditinjau {formatReviewed(item.reviewed_at)}
                      {item.overdue ? ' · Perlu ditinjau ulang' : ''}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan halaman lain yang sudah dirombak: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
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
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerTitle: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, height: 52, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: card, ...shadow },
    searchInput: { flex: 1, height: 52, fontSize: fontSize.sm + 1, color: colors.textPrimary },
    listContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: spacing.xxl, flexGrow: 1, gap: 12 },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: 20, padding: spacing.md, marginBottom: 6 },
    errorText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: '600' },
    emptyState: { alignItems: 'center', paddingVertical: 64, gap: 14 },
    emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    emptyText: { fontSize: fontSize.sm + 1, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },

    groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingVertical: 6, paddingHorizontal: 4 },
    groupTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    groupCount: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    groupCountText: { fontSize: 11.5, fontWeight: '800', color: colors.textMuted },

    card: { padding: 20, borderRadius: 26, backgroundColor: card, ...shadow },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardHeadText: { flex: 1, gap: 4 },
    title: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22, color: colors.textPrimary },
    summary: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    chevronWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },

    body: { marginTop: 18, gap: 14, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line },
    stepRow: { flexDirection: 'row', gap: 12 },
    stepNumber: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    stepNumberText: { fontSize: 12.5, fontWeight: '800', color: accentText },
    stepText: { flex: 1 },
    stepBody: { fontSize: 14.5, lineHeight: 22, color: colors.textPrimary },
    tipsLabel: { marginTop: 6, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    tipRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    tipDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, marginHorizontal: 10, backgroundColor: colors.textMuted },
    tipBody: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
    bold: { fontWeight: '800' },
    noteBox: { marginTop: 6, padding: 16, borderRadius: 20, backgroundColor: chip, gap: 6 },
    footer: { marginTop: 4, fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
  });
}
