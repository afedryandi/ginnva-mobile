import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface MemoListItem {
  id: number;
  memo_number: string;
  vehicle_info: string | null;
  spk_number: string | null;
  items_count: number;
  creator: { name: string } | null;
  store: { name: string } | null;
  created_at: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MemoListScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [memos, setMemos] = useState<MemoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMemos = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ data: MemoListItem[]; has_more?: boolean }>('/api/staff/memos');
      setMemos(res.data ?? []);
      setHasMore(res.has_more ?? false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar memo.');
    }
  }, []);

  // Halaman berikutnya lewat offset — daftar sebelumnya dibatasi 50 tanpa
  // cara lihat yang lebih lama sama sekali kalau toko sudah punya >50 memo.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await staffApiFetch<{ data: MemoListItem[]; has_more?: boolean }>(`/api/staff/memos?offset=${memos.length}`);
      setMemos((prev) => [...prev, ...(res.data ?? [])]);
      setHasMore(res.has_more ?? false);
    } catch {
      // Senyap — user masih bisa coba lagi dengan scroll/tap lagi.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, memos.length]);

  // Refetch tiap kali layar ini kembali dapat fokus (mis. balik dari buat
  // memo baru / dari detail) — bukan cuma sekali saat mount, supaya daftar
  // tidak basi. Spinner penuh cuma ditampilkan kalau belum pernah berhasil
  // load sama sekali (hasLoadedOnce, BUKAN dibaca dari state memos yang
  // bisa stale closure di useCallback ini); refetch berikutnya jalan
  // senyap di background.
  const hasLoadedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) setLoading(true);
      fetchMemos().finally(() => {
        hasLoadedOnce.current = true;
        setLoading(false);
      });
    }, [fetchMemos])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMemos();
    setRefreshing(false);
  }, [fetchMemos]);

  const goToCreate = () => router.push('/staff/memos/create' as never);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      {/* Header flat — SEBELUMNYA gradient hero + FAB melayang, satu-
          satunya modul inventaris bergaya "generasi baru" berbeda dari
          4 modul lain (Produk PPF/WF, Bahan Baku, Barang Habis Pakai,
          Aset) yang semuanya flat, padahal diakses dari hub yang sama. */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Memo Pengambilan/Pengembalian</Text>
        <Pressable onPress={goToCreate} style={styles.sideButton}>
          <Ionicons name="add" size={24} color={colors.accent} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.danger} />
          </View>
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={onRefresh}>
            <Text style={styles.retryBtnText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : memos.length === 0 ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="clipboard-outline" size={40} color={colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>Belum Ada Memo</Text>
          <Text style={styles.centerStateText}>Buat memo untuk catat barang keluar-masuk 1 instalasi sekaligus.</Text>
          <Pressable style={styles.emptyCta} onPress={goToCreate}>
            <Ionicons name="add" size={18} color="#ffffff" />
            <Text style={styles.emptyCtaText}>Buat Memo Baru</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={memos}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
            ) : hasMore ? (
              <Pressable style={styles.loadMoreBtn} onPress={loadMore}>
                <Text style={styles.loadMoreBtnText}>Muat Lebih Banyak</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => router.push({ pathname: '/staff/memos/[id]', params: { id: String(item.id) } } as never)}
            >
              <View style={styles.cardIconWrap}>
                <Ionicons name="document-text-outline" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowNumber}>{item.memo_number}</Text>
                <Text style={styles.rowInfo} numberOfLines={1}>
                  {[item.vehicle_info, item.spk_number ? `SPK ${item.spk_number}` : null].filter(Boolean).join(' · ') || 'Tanpa info kendaraan'}
                </Text>
                <View style={styles.rowMetaRow}>
                  <Ionicons name="person-circle-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.rowMeta}>{item.creator?.name ?? '—'}</Text>
                  <Text style={styles.rowMetaDot}>·</Text>
                  <Text style={styles.rowMeta}>{formatDate(item.created_at)}</Text>
                </View>
              </View>
              <View style={styles.rowBadge}>
                <Text style={styles.rowBadgeText}>{item.items_count}</Text>
                <Text style={styles.rowBadgeLabel}>barang</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}
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
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
    emptyIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xs,
    },
    emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
    emptyCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.accent,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      marginTop: spacing.sm,
    },
    emptyCtaText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },
    retryBtn: {
      marginTop: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    retryBtnText: { color: colors.textPrimary, fontWeight: '600', fontSize: fontSize.sm },

    listContent: { padding: spacing.md, gap: spacing.sm },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardPressed: { opacity: 0.85 },
    cardIconWrap: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowNumber: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary, letterSpacing: 0.2 },
    rowInfo: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 3 },
    rowMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
    rowMeta: { fontSize: 11, color: colors.textMuted },
    rowMetaDot: { fontSize: 11, color: colors.textMuted },
    rowBadge: {
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      backgroundColor: colors.accentSoft,
      borderRadius: radius.md,
    },
    rowBadgeText: { fontSize: fontSize.base, fontWeight: '800', color: colors.accent },
    rowBadgeLabel: { fontSize: 9, color: colors.accent, fontWeight: '600' },
    loadMoreBtn: {
      alignItems: 'center',
      paddingVertical: spacing.sm,
      marginTop: spacing.xs,
    },
    loadMoreBtnText: { color: colors.accent, fontWeight: '700', fontSize: fontSize.sm },
  });
}
