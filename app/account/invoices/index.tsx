import React, { useEffect, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, Pressable, RefreshControl, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
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

function getStatusMeta(colors: typeof darkColors): Record<string, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> {
  return {
    unpaid: { label: 'Belum Lunas', color: colors.warning, bg: colors.warningBg, icon: 'time-outline' },
    paid: { label: 'Lunas', color: colors.success, bg: colors.successBg, icon: 'checkmark-circle-outline' },
    void: { label: 'Void', color: colors.danger, bg: colors.dangerBg, icon: 'close-circle-outline' },
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
//
// Tampilan didesain ulang (2026-11-24): ringkasan tagihan di atas, kartu invoice dengan nominal besar, status berikon, dan chip sisa tagihan.
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
        setError(err instanceof ApiError ? err.message : 'Gagal memuat data invoicemu.');
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

  // Ringkasan: jumlah dan total sisa tagihan dari invoice yang belum lunas.
  const unpaid = invoices.filter((i) => i.status === 'unpaid' && Number(i.total) - Number(i.amount_paid) > 0);
  const unpaidTotal = unpaid.reduce((sum, i) => sum + (Number(i.total) - Number(i.amount_paid)), 0);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.topTitle}>Invoice Saya</Text>
      </View>

      {!isLoggedIn ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="lock-closed-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateTitle}>Masuk dulu</Text>
          <Text style={styles.centerStateText}>Masuk ke akunmu untuk melihat invoicemu.</Text>
          <PressableScale style={styles.primaryButton} onPress={() => router.push('/auth/login' as never)} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Masuk Sekarang</Text>
          </PressableScale>
        </ScrollView>
      ) : loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateText}>{error}</Text>
          <PressableScale style={styles.primaryButton} onPress={() => { hapticLight(); load(); }} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Coba Lagi</Text>
          </PressableScale>
        </ScrollView>
      ) : invoices.length === 0 ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="document-text-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateTitle}>Belum ada invoice</Text>
          <Text style={styles.centerStateText}>Invoicemu akan muncul di sini setelah toko menerbitkannya.</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          ListHeaderComponent={
            unpaid.length > 0 ? (
              <View style={styles.summary}>
                <View style={styles.summaryIcon}>
                  <Ionicons name="wallet-outline" size={22} color="#ffffff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryLabel}>Sisa tagihan belum lunas · {unpaid.length} invoice</Text>
                  <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatRupiah(String(unpaidTotal))}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.count}>{invoices.length} invoice</Text>
            )
          }
          renderItem={({ item, index }) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.unpaid;
            const remaining = Number(item.total) - Number(item.amount_paid);
            return (
              <FadeInUp index={index} enabled={index < 6}>
                <PressableScale
                  style={styles.card}
                  onPress={() => {
                    hapticLight();
                    router.push(`/account/invoices/${item.id}` as never);
                  }}
                  accessibilityRole="button"
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.code} numberOfLines={1}>{item.invoice_number}</Text>
                    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon} size={13} color={meta.color} />
                      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>

                  <View style={styles.amountRow}>
                    <Text style={styles.amount}>{formatRupiah(item.total)}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="storefront-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.metaText} numberOfLines={1}>{item.store?.name ?? 'Toko tidak diketahui'}</Text>
                    <View style={styles.dot} />
                    <Text style={[styles.metaText, { flexShrink: 0 }]} numberOfLines={1}>{formatDate(item.issue_date)}</Text>
                  </View>

                  {item.status === 'unpaid' && remaining > 0 ? (
                    <View style={styles.remaining}>
                      <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
                      <Text style={styles.remainingText}>Sisa tagihan {formatRupiah(String(remaining))}</Text>
                      {item.due_date ? <Text style={styles.dueText}>Jatuh tempo {formatDate(item.due_date)}</Text> : null}
                    </View>
                  ) : null}
                </PressableScale>
              </FadeInUp>
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
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    centerState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    centerStateTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    centerStateText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56, gap: 14 },
    count: { fontSize: 13, color: colors.textMuted, marginLeft: 4, marginBottom: 2 },

    // Ringkasan tagihan: satu kartu merah dengan total sisa tagihan sebagai angka utama (teks putih tetap di atas merah).
    summary: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 28, backgroundColor: colors.accent, marginBottom: 2 },
    summaryIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
    summaryLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
    summaryValue: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: '#ffffff', marginTop: 2 },

    card: { gap: 12, padding: 18, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    code: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textMuted },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 12, borderRadius: 14 },
    badgeText: { fontSize: 12, fontWeight: '800' },
    amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    amount: { fontSize: 26, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    metaText: { flexShrink: 1, fontSize: 13, color: colors.textSecondary },
    dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textMuted },
    remaining: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: 16, backgroundColor: colors.warningBg },
    remainingText: { fontSize: 13, fontWeight: '800', color: colors.warning },
    dueText: { fontSize: 12, fontWeight: '600', color: colors.warning },
  });
}
