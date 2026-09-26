import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

interface MyInvoice {
  id: number;
  invoice_number: string;
  store: { id: number; name: string } | null;
  issue_date: string;
  due_date: string | null;
  status: 'unpaid' | 'paid' | 'void';
  total: string;
  amount_paid: string;
}

function getStatusMeta(colors: typeof darkColors): Record<string, { label: string; color: string; bg: string }> {
  return {
    unpaid: { label: 'Belum Lunas', color: colors.warning, bg: colors.warningBg },
    paid: { label: 'Lunas', color: colors.success, bg: colors.successBg },
    void: { label: 'Void', color: colors.danger, bg: colors.dangerBg },
  };
}

function formatRupiah(value: string): string {
  return 'Rp' + Math.round(Number(value)).toLocaleString('id-ID');
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Portal Invoice untuk customer (gap "standar enterprise" diperbaiki
// 2026-09-25, audit Invoice) — SEBELUMNYA modul Invoice sama sekali
// tidak terhubung ke customer app, staff harus kirim PDF manual.
export default function MyInvoicesScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);

  const [invoices, setInvoices] = useState<MyInvoice[]>([]);
  const { isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: MyInvoice[] }>('/api/customer/invoices')
      .then((res) => {
        setInvoices(res.data);
        if (isRefresh) hapticSuccess();
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Gagal memuat data invoice Anda.');
        if (isRefresh) hapticError();
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.accent]} tintColor={colors.accent} />
  );

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
        <Text style={styles.headerTitle} numberOfLines={1}>Invoice Saya</Text>
        <View style={styles.sideButton} />
      </View>

      {!isLoggedIn ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.textMuted} />
          <Text style={styles.centerStateTitle}>Login Diperlukan</Text>
          <Text style={styles.centerStateText}>Masuk ke akun Anda untuk melihat invoice Anda.</Text>
          <Pressable style={styles.retryButton} onPress={() => router.push('/auth/login' as never)}>
            <Text style={styles.retryText}>Masuk Sekarang</Text>
          </Pressable>
        </ScrollView>
      ) : loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => { hapticLight(); load(); }}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </ScrollView>
      ) : invoices.length === 0 ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <Ionicons name="document-text-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateTitle}>Belum Ada Invoice</Text>
          <Text style={styles.centerStateText}>Invoice Anda akan muncul di sini setelah toko menerbitkannya.</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={refreshControl}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.unpaid;
            const remaining = Number(item.total) - Number(item.amount_paid);
            return (
              <Pressable
                onPress={() => {
                  hapticLight();
                  router.push(`/account/invoices/${item.id}` as never);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.code}>{item.invoice_number}</Text>
                    <View style={styles.cardHeaderRight}>
                      <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </View>
                  </View>
                  <Text style={styles.productText}>{formatRupiah(item.total)}</Text>
                  <Text style={styles.subText}>
                    {item.store?.name ?? 'Toko tidak diketahui'} · {formatDate(item.issue_date)}
                  </Text>
                  {item.status === 'unpaid' && remaining > 0 && (
                    <Text style={[styles.remainingText, { color: colors.warning, fontWeight: '700' }]}>
                      Sisa tagihan {formatRupiah(String(remaining))}
                    </Text>
                  )}
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  centerState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  centerStateTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryButton: { marginTop: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.pill },
  retryText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '600' },
  listContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  code: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: fontSize.xs, fontWeight: '700' },
  productText: { fontSize: fontSize.base, fontWeight: '700', color: colors.accent },
  subText: { fontSize: fontSize.sm, color: colors.textSecondary },
  remainingText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  });
}
