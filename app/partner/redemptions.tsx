import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface Redemption {
  id: number;
  points_spent: number;
  status: 'pending' | 'fulfilled' | 'cancelled';
  created_at: string;
  reward: { name: string } | null;
}

const STATUS_LABEL: Record<Redemption['status'], string> = {
  pending: 'Menunggu Diproses',
  fulfilled: 'Sudah Dikirim',
  cancelled: 'Dibatalkan',
};

export default function PartnerRedemptionsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await staffApiFetch<{ data: Redemption[] }>('/api/partner/redemptions');
      setItems(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat riwayat penukaran.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statusColor = (status: Redemption['status']) => {
    if (status === 'fulfilled') return colors.success;
    if (status === 'cancelled') return colors.danger;
    return colors.textMuted;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Riwayat Penukaran Hadiah</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchData()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={colors.accent} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{item.reward?.name ?? 'Reward'}</Text>
                <Text style={[styles.rowStatus, { color: statusColor(item.status) }]}>
                  {STATUS_LABEL[item.status]}
                </Text>
              </View>
              <Text style={styles.rowPoints}>-{item.points_spent}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="gift-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum Ada Penukaran</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.pill },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },
  listContent: { padding: spacing.md, gap: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  rowInfo: { gap: 2 },
  rowName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  rowStatus: { fontSize: fontSize.xs, fontWeight: '600' },
  rowPoints: { fontSize: fontSize.base, fontWeight: '700', color: colors.danger },
  emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, marginTop: spacing.lg },
  emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  });
}
