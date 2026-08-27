import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface StaffQuotation {
  id: number;
  quotation_number: string;
  customer_name: string;
  customer_phone: string;
  status: 'new' | 'contacted' | 'closed' | 'cancelled';
  source: 'customer' | 'staff';
  created_at: string;
  vehicle: { brand: string; model: string } | null;
  store: { id: number; name: string } | null;
}

const STATUS_META: Record<StaffQuotation['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  new: { label: 'New', color: 'accent', bg: 'accentSoft' },
  contacted: { label: 'Contacted', color: 'warning', bg: 'warningBg' },
  closed: { label: 'Closed', color: 'success', bg: 'successBg' },
  cancelled: { label: 'Cancelled', color: 'danger', bg: 'dangerBg' },
};

type StatusFilter = 'all' | StaffQuotation['status'];

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'closed', label: 'Closed' },
];

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function StaffQuotationListScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [quotations, setQuotations] = useState<StaffQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fetchQuotations = useCallback((filter: StatusFilter) => {
    const query = filter === 'all' ? '' : `?status=${filter}`;
    setError(null);
    return staffApiFetch<{ data: StaffQuotation[] }>(`/api/staff/quotations${query}`)
      .then((res) => setQuotations(res.data))
      .catch(() => setError('Gagal memuat daftar lead. Periksa koneksi internet Anda.'));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchQuotations(statusFilter).finally(() => setLoading(false));
  }, [fetchQuotations, statusFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchQuotations(statusFilter);
    setRefreshing(false);
  }, [fetchQuotations, statusFilter]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Lead Quotation</Text>
        <View style={styles.sideButton} />
      </View>

      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={[styles.filterChip, statusFilter === f.key && styles.filterChipActive]}
            onPress={() => setStatusFilter(f.key)}
          >
            <Text style={[styles.filterChipText, statusFilter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={quotations}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>Belum ada lead quotation.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            const vehicleLabel = item.vehicle ? `${item.vehicle.brand} ${item.vehicle.model}` : '—';
            return (
              <Pressable
                style={styles.card}
                onPress={() => router.push(`/staff/quotations/${item.id}` as never)}
              >
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardName} numberOfLines={1}>{item.customer_name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: colors[meta.bg] }]}>
                    <Text style={[styles.statusBadgeText, { color: colors[meta.color] }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardVehicle}>{vehicleLabel}</Text>
                <View style={styles.cardBottomRow}>
                  <Text style={styles.cardMeta}>{item.store?.name ?? 'Toko tidak diketahui'}</Text>
                  <Text style={styles.cardMeta}>{formatDate(item.created_at)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    filterRow: {
      flexDirection: 'row', gap: spacing.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    },
    filterChip: {
      paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    filterChipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
    filterChipTextActive: { color: '#ffffff' },
    listContent: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.sm,
    },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    cardName: { flex: 1, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, marginLeft: spacing.sm },
    statusBadgeText: { fontSize: fontSize.xs, fontWeight: '700' },
    cardVehicle: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: 6 },
    cardBottomRow: { flexDirection: 'row', justifyContent: 'space-between' },
    cardMeta: { fontSize: fontSize.xs, color: colors.textMuted },
    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted },
  });
}
