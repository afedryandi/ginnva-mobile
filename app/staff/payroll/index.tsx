import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface PayrollRecord {
  id: number;
  period_month: string;
  base_salary: number;
  prorated_base_salary: number;
  working_days_in_month: number;
  total_late_minutes: number;
  late_violation_days: number;
  alpha_days: number;
  alpha_deduction: number;
  total_deduction: number;
  net_pay: number;
  paid_at: string | null;
}

function formatRupiah(amount: number): string {
  return 'Rp' + Math.round(amount).toLocaleString('id-ID');
}

function formatMonthYear(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

export default function StaffPayrollScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPayrolls = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ payrolls: PayrollRecord[] }>('/api/staff/payroll');
      setPayrolls(res.payrolls);
    } catch {
      setError('Gagal memuat slip gaji. Periksa koneksi internet Anda.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadPayrolls().finally(() => setLoading(false));
  }, [loadPayrolls]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPayrolls();
    setRefreshing(false);
  }, [loadPayrolls]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Slip Gaji</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={payrolls}
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
              <Ionicons name="cash-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>Belum ada slip gaji yang tercatat.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const expanded = expandedId === item.id;
            return (
              <Pressable style={styles.card} onPress={() => setExpandedId(expanded ? null : item.id)}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardMonth}>{formatMonthYear(item.period_month)}</Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                </View>
                <Text style={styles.cardNetPay}>{formatRupiah(item.net_pay)}</Text>

                {expanded ? (
                  <View style={styles.breakdown}>
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Gaji Pokok</Text>
                      <Text style={styles.breakdownValue}>{formatRupiah(item.base_salary)}</Text>
                    </View>
                    {item.prorated_base_salary < item.base_salary ? (
                      <View style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>Gaji Berjalan (diproporsikan)</Text>
                        <Text style={styles.breakdownValue}>{formatRupiah(item.prorated_base_salary)}</Text>
                      </View>
                    ) : null}
                    {item.late_violation_days > 0 ? (
                      <View style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>Potongan Telat ({item.late_violation_days} hari)</Text>
                        <Text style={[styles.breakdownValue, styles.breakdownNegative]}>
                          -{formatRupiah(item.total_deduction - item.alpha_deduction)}
                        </Text>
                      </View>
                    ) : null}
                    {item.alpha_days > 0 ? (
                      <View style={styles.breakdownRow}>
                        <Text style={styles.breakdownLabel}>Potongan Alpha ({item.alpha_days} hari)</Text>
                        <Text style={[styles.breakdownValue, styles.breakdownNegative]}>
                          -{formatRupiah(item.alpha_deduction)}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.breakdownDivider} />
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabelBold}>Gaji Bersih</Text>
                      <Text style={styles.breakdownValueBold}>{formatRupiah(item.net_pay)}</Text>
                    </View>
                    {item.paid_at ? (
                      <Text style={styles.paidAtText}>
                        Dibayar {new Date(item.paid_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
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
    listContent: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.sm,
    },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardMonth: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, textTransform: 'capitalize' },
    cardNetPay: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.accent, marginTop: 4, fontVariant: ['tabular-nums'] },
    breakdown: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
    breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    breakdownLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
    breakdownValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    breakdownNegative: { color: colors.danger },
    breakdownDivider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
    breakdownLabelBold: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    breakdownValueBold: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    paidAtText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted },
  });
}
