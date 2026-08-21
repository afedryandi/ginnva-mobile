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
  const [error, setError] = useState<string | null>(null);

  const fetchMemos = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ data: MemoListItem[] }>('/api/staff/memos');
      setMemos(res.data ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar memo.');
    }
  }, []);

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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Memo Pengambilan/Pengembalian</Text>
        <Pressable onPress={onRefresh} style={styles.sideButton} disabled={refreshing}>
          <Ionicons name="refresh" size={22} color={refreshing ? colors.textMuted : colors.textPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error}</Text>
        </View>
      ) : memos.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="clipboard-outline" size={36} color={colors.textMuted} />
          <Text style={styles.centerStateText}>Belum ada memo. Ketuk tombol + untuk buat memo baru.</Text>
        </View>
      ) : (
        <FlatList
          data={memos}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/staff/memos/[id]', params: { id: String(item.id) } } as never)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowNumber}>{item.memo_number}</Text>
                <Text style={styles.rowInfo}>
                  {[item.vehicle_info, item.spk_number ? `SPK ${item.spk_number}` : null].filter(Boolean).join(' · ') || 'Tanpa info kendaraan'}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.creator?.name ?? '—'} · {formatDate(item.created_at)}
                </Text>
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

      <Pressable style={styles.fab} onPress={() => router.push('/staff/memos/create' as never)}>
        <Ionicons name="add" size={26} color="#ffffff" />
      </Pressable>
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
    headerTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    listContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.xs },
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
    rowNumber: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    rowInfo: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    rowMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
    rowBadge: { alignItems: 'center', paddingHorizontal: spacing.xs },
    rowBadgeText: { fontSize: fontSize.base, fontWeight: '800', color: colors.accent },
    rowBadgeLabel: { fontSize: 10, color: colors.textMuted },
    fab: {
      position: 'absolute',
      right: spacing.md,
      bottom: spacing.lg,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
    },
  });
}
