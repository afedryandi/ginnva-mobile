import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';

// Link App Link (domain sendiri, lihat android.intentFilters di
// app.json + routes/web.php di backend) — MENGGANTIKAN link Play Store
// langsung supaya 2 kasus sama-sama ke-cover:
// - App belum terinstall -> Android tidak bisa intercept, browser yang
//   buka, lalu redirect ke Play Store dengan parameter `referrer`
//   (Install Referrer API otomatis titipkan kodenya, lihat
//   lib/referral-attribution.ts).
// - App SUDAH terinstall  -> Android intercept URL ini LANGSUNG ke
//   app/r/[code].tsx, kode langsung diterapkan tanpa lewat Play Store
//   sama sekali.
function buildReferralInstallLink(code: string): string {
  return `https://api.ginnva.id/r/${code}`;
}

interface PointTransaction {
  id: number;
  type: 'earn' | 'spend';
  points: number;
  description: string;
  created_at: string;
}

interface PointsResponse {
  balance: number;
  transactions: PointTransaction[];
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PointsScreen() {
  const { customer, isLoggedIn } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleShareReferral = () => {
    if (!customer?.referral_code) return;
    Share.share({
      message: `Yuk pasang kaca film/PPF di Ginnva! Download Ginnva App lewat link ini, kode referral saya "${customer.referral_code}" otomatis kepakai:\n${buildReferralInstallLink(customer.referral_code)}`,
    }).catch(() => {
      // Pengguna membatalkan share sheet — tidak perlu ditangani sebagai error.
    });
  };

  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPoints = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PointsResponse>('/api/customer/points');
      setBalance(res.balance ?? 0);
      setTransactions(res.transactions ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data poin.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchPoints();
  }, [isLoggedIn, fetchPoints]);

  const renderItem = ({ item, index }: { item: PointTransaction; index: number }) => {
    const isEarn = item.type === 'earn';
    return (
      <View style={[styles.txRow, index > 0 && styles.txBorder]}>
        <View style={[styles.txIcon, { backgroundColor: isEarn ? colors.successBg : colors.dangerBg }]}>
          <Ionicons
            name={isEarn ? 'add-circle-outline' : 'remove-circle-outline'}
            size={20}
            color={isEarn ? colors.success : colors.danger}
          />
        </View>
        <View style={styles.txInfo}>
          <Text style={styles.txDesc}>{item.description}</Text>
          <Text style={styles.txTime}>{timeAgo(item.created_at)}</Text>
        </View>
        <Text style={[styles.txPoints, { color: isEarn ? colors.success : colors.danger }]}>
          {isEarn ? '+' : '-'}{item.points}
        </Text>
      </View>
    );
  };

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
        <Text style={styles.headerTitle} numberOfLines={1}>Poin Saya</Text>
        <View style={styles.sideButton} />
      </View>

      {!isLoggedIn ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Login Diperlukan</Text>
          <Text style={styles.errorText}>Masuk ke akun Anda untuk melihat poin Anda.</Text>
          <Pressable style={styles.retryBtn} onPress={() => router.push('/auth/login' as never)}>
            <Text style={styles.retryText}>Masuk Sekarang</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchPoints()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchPoints(true)}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <>
              {/* Kartu saldo — gradient, konsisten dengan elemen "angka
                  penting dalam kotak berwarna" lain di app (banner promo
                  Beranda, kartu saldo Partner Dashboard), bukan lagi
                  warna solid flat. */}
              <LinearGradient
                colors={[colors.accent, colors.gold]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.balanceCard}
              >
                <View style={styles.balanceIcon}>
                  <Ionicons name="star" size={28} color="#ffffff" />
                </View>
                <Text style={styles.balanceLabel}>Total Poin Anda</Text>
                <Text style={styles.balanceValue}>{balance.toLocaleString('id-ID')}</Text>
                <Text style={styles.balanceNote}>Poin didapat dari setiap garansi yang disetujui</Text>
                <Pressable
                  style={styles.redeemCta}
                  onPress={() => router.push('/rewards?for=customer' as never)}
                >
                  <Ionicons name="gift-outline" size={16} color={colors.accent} />
                  <Text style={styles.redeemCtaText}>Tukar Poin dengan Hadiah</Text>
                </Pressable>
              </LinearGradient>

              {/* Cara dapat poin */}
              <View style={styles.howCard}>
                <Text style={styles.howTitle}>Cara Mendapatkan Poin</Text>
                <View style={styles.howRow}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
                  <Text style={styles.howText}>Garansi disetujui → <Text style={styles.howBold}>+100 poin</Text></Text>
                </View>
                <View style={styles.howRow}>
                  <Ionicons name="person-add-outline" size={18} color={colors.accent} />
                  <Text style={styles.howText}>Ajak teman pakai kode referral Anda → <Text style={styles.howBold}>poin setiap teman booking</Text></Text>
                </View>
              </View>

              {/* Kode referral sendiri — bagikan ke teman lewat WhatsApp/dsb */}
              {!!customer?.referral_code && (
                <View style={styles.referralCard}>
                  <View style={styles.referralInfo}>
                    <Text style={styles.referralLabel}>Kode Referral Anda</Text>
                    <Text style={styles.referralCode}>{customer.referral_code}</Text>
                    <Text style={styles.referralHint}>
                      Ajak teman pakai kode ini — dapat poin setiap teman Anda booking & selesai.
                    </Text>
                  </View>
                  <Pressable style={styles.referralShareBtn} onPress={handleShareReferral}>
                    <Ionicons name="share-social-outline" size={16} color="#ffffff" />
                    <Text style={styles.referralShareText}>Bagikan</Text>
                  </Pressable>
                </View>
              )}

              {transactions.length > 0 && (
                <Text style={styles.historyTitle}>Riwayat Poin</Text>
              )}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="star-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum Ada Poin</Text>
              <Text style={styles.emptyText}>
                Daftarkan kendaraan Anda dan dapatkan 100 poin saat garansi disetujui.
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },

  listContent: { paddingBottom: spacing.xxl },

  balanceCard: {
    margin: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  balanceIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  balanceLabel: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.8)' },
  balanceValue: {
    fontSize: 40,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -1,
  },
  balanceNote: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  redeemCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  redeemCtaText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent },

  howCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  howTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  howText: { fontSize: fontSize.sm, color: colors.textSecondary },
  howBold: { fontWeight: '700', color: colors.textPrimary },

  referralCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  referralInfo: {
    flex: 1,
    gap: 2,
  },
  referralLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  referralCode: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.accent,
    letterSpacing: 2,
  },
  referralHint: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  referralShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  referralShareText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: '#ffffff',
  },

  historyTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  txBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  txInfo: { flex: 1, gap: 2 },
  txDesc: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500' },
  txTime: { fontSize: fontSize.xs, color: colors.textMuted },
  txPoints: { fontSize: fontSize.base, fontWeight: '700', flexShrink: 0 },

  emptyBox: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  });
}
