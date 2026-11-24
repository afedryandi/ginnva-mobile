import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface FinanceAccount {
  id: number;
  name: string;
  kind: 'kas' | 'kas_kecil' | 'bank';
  store_name: string | null;
  balance: number;
  float_amount: number | null;
  voucher_limit: number | null;
  replenish_amount: number | null;
}

interface Overview {
  can_record_expense: boolean;
  can_approve: boolean;
  can_count_cash: boolean;
  accounts: FinanceAccount[];
  today: { expenses_total: number; expenses_count: number };
  receivables_overdue: { count: number; total: number };
  pending_approvals: number;
}

export function formatRupiah(amount: number): string {
  return (amount < 0 ? '-' : '') + 'Rp' + Math.round(Math.abs(amount)).toLocaleString('id-ID');
}

const KIND_LABEL: Record<FinanceAccount['kind'], string> = { kas: 'Kas toko', kas_kecil: 'Kas kecil', bank: 'Bank' };

// Keuangan di aplikasi (Keuangan Fase 5): ringkasan kas toko dan pintu ke catat pengeluaran, hitung kas, dan persetujuan.
export default function StaffFinanceScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await staffApiFetch<Overview>('/api/staff/finance/overview'));
    } catch {
      setError('Gagal memuat keuangan. Periksa koneksi internet atau hak akses akun ini.');
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

  const Action = ({ icon, label, hint, href, badge }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; hint: string; href: string; badge?: number }) => (
    <Pressable style={styles.action} onPress={() => router.push(href as never)}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={22} color={colors.accent} />
      </View>
      <View style={styles.actionText}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.actionHint}>{hint}</Text>
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Keuangan</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {data ? (
            <>
              <Text style={styles.sectionTitle}>Saldo Kas</Text>
              {data.accounts.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>Belum ada rekening kas untuk toko ini. Minta admin keuangan menambahkannya di menu Rekening Kas & Bank.</Text>
                </View>
              ) : (
                data.accounts.map((a) => (
                  <View key={a.id} style={styles.card}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.cardTitle}>{a.name}</Text>
                      <Text style={styles.kind}>{KIND_LABEL[a.kind]}</Text>
                    </View>
                    <Text style={styles.balance}>{formatRupiah(a.balance)}</Text>
                    {a.kind === 'kas_kecil' && a.float_amount !== null ? (
                      <Text style={styles.hint}>
                        Plafon {formatRupiah(a.float_amount)}
                        {a.voucher_limit !== null ? ` · batas per bukti ${formatRupiah(a.voucher_limit)}` : ''}
                        {a.replenish_amount && a.replenish_amount > 0 ? ` · perlu isi ulang ${formatRupiah(a.replenish_amount)}` : ''}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}

              <Text style={styles.sectionTitle}>Hari Ini</Text>
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.label}>Pengeluaran tercatat</Text>
                  <Text style={styles.value}>{formatRupiah(data.today.expenses_total)} ({data.today.expenses_count})</Text>
                </View>
                <View style={styles.rowBetween}>
                  <Text style={styles.label}>Piutang lewat jatuh tempo</Text>
                  <Text style={styles.value}>{data.receivables_overdue.count} · {formatRupiah(data.receivables_overdue.total)}</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Tindakan</Text>
              {data.can_record_expense ? (
                <Action icon="receipt-outline" label="Catat Pengeluaran" hint="Foto nota dan kirim" href="/staff/finance/expense" />
              ) : null}
              {data.can_count_cash ? (
                <Action icon="calculator-outline" label="Hitung Kas" hint="Hitung uang di laci hari ini" href="/staff/finance/cash-count" />
              ) : null}
              {data.can_approve ? (
                <Action icon="checkmark-done-outline" label="Persetujuan Pengeluaran" hint="Setujui atau tolak pengajuan" href="/staff/finance/approvals" badge={data.pending_approvals} />
              ) : null}
            </>
          ) : null}
        </ScrollView>
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
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    sectionTitle: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    cardTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, flex: 1 },
    kind: { fontSize: fontSize.xs, color: colors.textMuted },
    balance: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    hint: { fontSize: fontSize.xs, color: colors.textMuted },
    label: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
    value: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    action: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface,
      borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, minHeight: 64,
    },
    actionIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
    actionText: { flex: 1 },
    actionLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    actionHint: { fontSize: fontSize.xs, color: colors.textMuted },
    badge: { minWidth: 24, paddingHorizontal: 6, height: 24, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: '#ffffff', fontSize: fontSize.xs, fontWeight: '700' },
  });
}
