import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

// Voucher sekarang FISIK — dicetak dengan kode unik, dibagikan ke customer
// yang sudah bayar DP, lalu staff assign kodenya ke akun customer lewat
// Filament. Layar ini murni READ-ONLY, tidak ada aksi klaim apa pun dari
// customer (fitur klaim self-service sudah dihapus).
//
// Tampilan didesain ulang (2026-11-24): voucher sebagai tiket dengan potongan di sisi dan garis putus-putus; nominal diskon di kiri,
// nama, kode, dan status di kanan. Voucher yang sudah dipakai atau kedaluwarsa tampil pudar.

interface VoucherClaim {
  id: number;
  code: string;
  status: 'active' | 'used';
  // 'expired' = voucher aktif yang sudah lewat masa berlaku (dihitung server).
  effective_status?: 'active' | 'used' | 'expired';
  name?: string;
  discount_amount?: number | string;
  expires_at?: string | null;
  created_at: string;
  // Dipertahankan server untuk kompatibilitas versi lama.
  voucher?: { name: string; discount_amount: number };
}

function formatRupiah(n: number): string {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

const DASHES = 11;

export default function VouchersScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [claims, setClaims] = useState<VoucherClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: VoucherClaim[] }>('/api/customer/vouchers');
      setClaims(res.data ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data voucher.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const activeCount = claims.filter((c) => (c.effective_status ?? c.status) === 'active').length;

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
        <Text style={styles.topTitle} numberOfLines={1}>Voucher Saya</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.errorText}>{error}</Text>
          <PressableScale style={styles.primaryButton} onPress={() => fetchData()} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : (
        <FlatList
          data={claims}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={colors.accent} colors={[colors.accent]} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={claims.length > 0 ? <Text style={styles.count}>{activeCount} voucher aktif · {claims.length} total</Text> : null}
          renderItem={({ item, index }) => {
            const state = item.effective_status ?? item.status;
            const inactive = state !== 'active';
            const name = item.name ?? item.voucher?.name ?? 'Voucher';
            const amount = Number(item.discount_amount ?? item.voucher?.discount_amount ?? 0);
            const expiry = item.expires_at
              ? new Date(item.expires_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
              : null;
            const statusLabel = state === 'used' ? 'Sudah Dipakai' : state === 'expired' ? 'Kedaluwarsa' : 'Aktif';

            return (
              <FadeInUp index={index} enabled={index < 6}>
                <View style={[styles.ticket, inactive && styles.ticketInactive]}>
                  {/* Bagian kiri: nominal diskon. */}
                  <View style={styles.stub}>
                    <View style={[styles.stubIcon, inactive && styles.stubIconInactive]}>
                      <Ionicons name="ticket-outline" size={20} color={inactive ? colors.textMuted : colors.accent} />
                    </View>
                    <Text style={styles.stubLabel}>DISKON</Text>
                    <Text style={[styles.stubAmount, inactive && styles.textInactive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {formatRupiah(amount)}
                    </Text>
                  </View>

                  {/* Garis putus-putus dengan potongan setengah lingkaran di atas dan bawah. */}
                  <View style={styles.tear}>
                    <View style={[styles.notch, styles.notchTop]} />
                    <View style={styles.dashes}>
                      {Array.from({ length: DASHES }, (_, i) => <View key={i} style={styles.dash} />)}
                    </View>
                    <View style={[styles.notch, styles.notchBottom]} />
                  </View>

                  {/* Bagian kanan: nama, kode, dan status. */}
                  <View style={styles.body}>
                    <Text style={styles.name} numberOfLines={2}>{name}</Text>
                    <View style={styles.codeChip}>
                      <Text style={styles.codeText} selectable>{item.code}</Text>
                    </View>
                    <View style={styles.foot}>
                      <View style={[styles.statusPill, inactive ? styles.statusPillInactive : styles.statusPillActive]}>
                        <Text style={[styles.statusText, { color: inactive ? colors.textMuted : colors.success }]}>{statusLabel}</Text>
                      </View>
                      {expiry && state === 'active' ? <Text style={styles.expiry} numberOfLines={1}>s/d {expiry}</Text> : null}
                    </View>
                  </View>
                </View>
              </FadeInUp>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <View style={styles.centerIcon}>
                <Ionicons name="ticket-outline" size={30} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>Belum ada voucher</Text>
              <Text style={styles.emptyText}>Tukar poinmu dengan voucher di menu Reward. Vouchernya langsung muncul di sini, lalu tunjukkan kodenya ke staf saat booking.</Text>
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
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { flex: 1, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    errorText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56, gap: 14, flexGrow: 1 },
    count: { fontSize: 13, color: colors.textMuted, marginLeft: 4, marginBottom: 2 },

    // Tiket: dua bagian dipisah garis putus-putus; potongan bulat di tepi atas dan bawah garis memakai warna latar layar.
    ticket: { flexDirection: 'row', alignItems: 'stretch', minHeight: 132, borderRadius: 26, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
    ticketInactive: { opacity: 0.6 },
    stub: { width: 116, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 16, paddingHorizontal: 8 },
    stubIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, marginBottom: 4 },
    stubIconInactive: { backgroundColor: colors.bg },
    stubLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.textMuted },
    stubAmount: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: colors.accent, alignSelf: 'stretch', textAlign: 'center' },
    textInactive: { color: colors.textMuted },

    tear: { width: 20, alignItems: 'center', justifyContent: 'center' },
    notch: { position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: colors.bg },
    notchTop: { top: -10 },
    notchBottom: { bottom: -10 },
    dashes: { flex: 1, justifyContent: 'space-evenly', alignItems: 'center', paddingVertical: 14 },
    dash: { width: 2, height: 5, borderRadius: 1, backgroundColor: colors.borderStrong },

    body: { flex: 1, justifyContent: 'center', gap: 8, paddingVertical: 16, paddingRight: 18, paddingLeft: 4 },
    name: { fontSize: 15, lineHeight: 20, fontWeight: '800', color: colors.textPrimary },
    codeChip: { alignSelf: 'flex-start', height: 30, paddingHorizontal: 12, borderRadius: 15, justifyContent: 'center', backgroundColor: colors.bg },
    codeText: { fontSize: 13, fontWeight: '800', letterSpacing: 1.5, color: colors.textPrimary },
    foot: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    statusPill: { height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center' },
    statusPillActive: { backgroundColor: colors.successBg },
    statusPillInactive: { backgroundColor: colors.bg },
    statusText: { fontSize: 11, fontWeight: '800' },
    expiry: { flexShrink: 1, fontSize: 12, color: colors.textMuted },

    emptyBox: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 56, gap: 12 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    emptyText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
  });
}
