import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
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
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import ComingSoon from '@/components/ui/ComingSoon';

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
  reference_type: string | null;
  created_at: string;
}

interface PointsResponse {
  balance: number;
  transactions: PointTransaction[];
  current_page: number;
  has_more: boolean;
}

// Label sumber poin (2026-09-26, audit Riwayat Poin Customer) -- SEBELUMNYA
// reference_type sudah dikirim backend tapi sama sekali tidak dipakai di
// sini, cuma description mentah yang tampil. Sama daftar label dengan
// PointTransactionResource.php (Filament) supaya konsisten di kedua sisi.
const SOURCE_LABEL: Record<string, string> = {
  booking: 'Booking',
  customer_referral: 'Ajak Teman',
  warranty: 'Registrasi Garansi',
  reward_redemption: 'Tukar Reward',
  reward_redemption_refund: 'Refund Reward',
  reward_redemption_reversal: 'Reward Dibatalkan Ulang',
  manual: 'Penyesuaian Admin',
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// GATE COMING SOON (diminta user, 2026-09-30) -- backend poin TETAP live &
// jalan diam-diam (garansi/referral/booking tetap menambah saldo), cuma
// layar ini yang ditutup sementara. Implementasi asli TETAP UTUH di bawah
// sebagai PointsScreenReal, tidak dihapus -- untuk mencabut gate ini nanti,
// ganti baris `export default` di bawah supaya menunjuk ke PointsScreenReal.
export default function PointsScreen() {
  return <ComingSoon title="Poin Saya" message="Fitur Poin & Reward sedang kami persiapkan dan akan segera bisa kamu gunakan." icon="gift-outline" />;
}

// Tampilan didesain ulang (2026-11-24): kartu saldo merah besar, cara mendapat poin dengan ikon bulat, kode referral yang mudah dibagikan,
// dan riwayat sebagai kartu lembut. Data, pagination, dan aturan tidak berubah. Tetap di balik gerbang di atas.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PointsScreenReal() {
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pagination (2026-09-26, audit Riwayat Poin Customer) -- SEBELUMNYA
  // backend cuma limit(50) tanpa cara melihat riwayat lebih lama sama
  // sekali; sekarang backend dukung ?page=, layar ini konsumsi lewat
  // load-more (bukan infinite auto-scroll, supaya jelas ada aksi customer
  // sebelum request tambahan jalan).
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const fetchPoints = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PointsResponse>('/api/customer/points');
      setBalance(res.balance ?? 0);
      setTransactions(res.transactions ?? []);
      setPage(res.current_page ?? 1);
      setHasMore(res.has_more ?? false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data poin.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch<PointsResponse>(`/api/customer/points?page=${page + 1}`);
      setTransactions((prev) => [...prev, ...(res.transactions ?? [])]);
      setPage(res.current_page ?? page + 1);
      setHasMore(res.has_more ?? false);
    } catch {
      // Diamkan -- riwayat yang sudah tampil tetap valid, customer bisa
      // coba tarik lagi lewat tombol "Muat Lagi".
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page]);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchPoints();
  }, [isLoggedIn, fetchPoints]);

  const renderItem = ({ item }: { item: PointTransaction }) => {
    const isEarn = item.type === 'earn';
    return (
      <View style={styles.txRow}>
        <View style={[styles.txIcon, { backgroundColor: isEarn ? colors.successBg : colors.dangerBg }]}>
          <Ionicons
            name={isEarn ? 'arrow-down-outline' : 'arrow-up-outline'}
            size={18}
            color={isEarn ? colors.success : colors.danger}
          />
        </View>
        <View style={styles.txInfo}>
          <Text style={styles.txDesc} numberOfLines={2}>{item.description}</Text>
          <View style={styles.txMetaRow}>
            {item.reference_type && SOURCE_LABEL[item.reference_type] ? (
              <View style={styles.sourceBadge}>
                <Text style={styles.sourceBadgeText}>{SOURCE_LABEL[item.reference_type]}</Text>
              </View>
            ) : null}
            <Text style={styles.txTime}>{timeAgo(item.created_at)}</Text>
          </View>
        </View>
        <Text style={[styles.txPoints, { color: isEarn ? colors.success : colors.danger }]}>
          {isEarn ? '+' : '-'}{item.points}
        </Text>
      </View>
    );
  };

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
        <Text style={styles.topTitle}>Poin Saya</Text>
      </View>

      {!isLoggedIn ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="lock-closed-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>Masuk dulu</Text>
          <Text style={styles.emptyText}>Masuk ke akunmu untuk melihat poinmu.</Text>
          <PressableScale style={styles.primaryBtn} onPress={() => router.push('/auth/login' as never)} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>Masuk Sekarang</Text>
          </PressableScale>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.emptyText}>{error}</Text>
          <PressableScale style={styles.primaryBtn} onPress={() => fetchPoints()} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchPoints(true)}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListHeaderComponent={
            <FadeInUp>
              {/* Kartu saldo: angka poin paling besar, satu tombol tukar. */}
              <LinearGradient
                colors={[colors.accent, '#c4123f']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.balanceCard}
              >
                <View style={styles.balanceDecoA} />
                <View style={styles.balanceDecoB} />
                <View style={styles.balanceBadge}>
                  <Ionicons name="star" size={14} color="#ffffff" />
                  <Text style={styles.balanceBadgeText}>Total poinmu</Text>
                </View>
                <Text style={styles.balanceValue}>{balance.toLocaleString('id-ID')}</Text>
                <Text style={styles.balanceNote}>Poin didapat dari setiap garansi yang disetujui</Text>
                <PressableScale style={styles.redeemCta} onPress={() => router.push('/rewards?for=customer' as never)} accessibilityRole="button">
                  <Ionicons name="gift-outline" size={18} color={colors.accent} />
                  <Text style={styles.redeemCtaText}>Tukar Poin dengan Hadiah</Text>
                </PressableScale>
              </LinearGradient>

              {/* Cara dapat poin */}
              <Text style={styles.sectionTitle}>Cara mendapatkan poin</Text>
              <View style={styles.howCard}>
                <View style={styles.howRow}>
                  <View style={styles.howIcon}>
                    <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
                  </View>
                  <Text style={styles.howText}>Garansi disetujui <Text style={styles.howBold}>+100 poin</Text></Text>
                </View>
                <View style={styles.howRow}>
                  <View style={styles.howIcon}>
                    <Ionicons name="person-add-outline" size={18} color={colors.accent} />
                  </View>
                  <Text style={styles.howText}>Ajak teman pakai kode referralmu, <Text style={styles.howBold}>poin setiap teman booking</Text></Text>
                </View>
                {/* Ditambah 2026-09-26 (audit Riwayat Poin Customer) --
                    SEBELUMNYA cuma 2 sumber disebut, padahal riwayat bisa
                    berisi baris refund/pembatalan reward yang tidak match
                    penjelasan manapun di kartu ini. */}
                <View style={styles.howRow}>
                  <View style={styles.howIcon}>
                    <Ionicons name="gift-outline" size={18} color={colors.accent} />
                  </View>
                  <Text style={styles.howText}>Batalkan penukaran reward, <Text style={styles.howBold}>poin dikembalikan</Text></Text>
                </View>
              </View>

              {/* Kode referral sendiri — bagikan ke teman lewat WhatsApp/dsb */}
              {!!customer?.referral_code && (
                <View style={styles.referralCard}>
                  <Text style={styles.referralLabel}>Kode referralmu</Text>
                  <Text style={styles.referralCode} selectable>{customer.referral_code}</Text>
                  <Text style={styles.referralHint}>
                    Ajak teman pakai kode ini, dapat poin setiap temanmu booking & selesai.
                  </Text>
                  <PressableScale style={styles.referralShareBtn} onPress={handleShareReferral} accessibilityRole="button">
                    <Ionicons name="share-social-outline" size={18} color="#ffffff" />
                    <Text style={styles.referralShareText}>Bagikan</Text>
                  </PressableScale>
                </View>
              )}

              {transactions.length > 0 && (
                <Text style={styles.sectionTitle}>Riwayat poin</Text>
              )}
            </FadeInUp>
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <View style={styles.centerIcon}>
                <Ionicons name="star-outline" size={30} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>Belum ada poin</Text>
              <Text style={styles.emptyText}>
                Daftarkan kendaraanmu dan dapatkan 100 poin saat garansi disetujui.
              </Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <PressableScale style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore} accessibilityRole="button">
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.loadMoreText}>Muat Riwayat Lebih Lama</Text>
                )}
              </PressableScale>
            ) : null
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
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    primaryBtn: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryBtnText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 24, paddingTop: spacing.sm, paddingBottom: 56 },

    balanceCard: { borderRadius: 32, padding: 24, alignItems: 'flex-start', gap: 6, overflow: 'hidden' },
    balanceDecoA: { position: 'absolute', top: -50, right: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.10)' },
    balanceDecoB: { position: 'absolute', bottom: -60, right: 50, width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(255,255,255,0.07)' },
    // Teks di atas kartu merah memakai putih tetap: merah yang sama di kedua tema.
    balanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)' },
    balanceBadgeText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
    balanceValue: { fontSize: 52, lineHeight: 62, fontWeight: '800', letterSpacing: -1.5, color: '#ffffff', marginTop: 6 },
    balanceNote: { fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.8)' },
    redeemCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', height: 50, borderRadius: 25, backgroundColor: '#ffffff', marginTop: 16 },
    redeemCtaText: { fontSize: 14, fontWeight: '800', color: colors.accent },

    sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted, marginTop: 28, marginBottom: 10, marginLeft: 6 },

    howCard: { padding: 8, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    howRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, paddingVertical: 10 },
    howIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    howText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    howBold: { fontWeight: '800', color: colors.textPrimary },

    referralCard: { marginTop: 14, padding: 20, gap: 4, borderRadius: 28, backgroundColor: colors.accentSoft },
    referralLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    referralCode: { fontSize: 28, fontWeight: '800', letterSpacing: 4, color: colors.accent },
    referralHint: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 2 },
    referralShareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 24, backgroundColor: colors.accent, marginTop: 14 },
    referralShareText: { fontSize: 14, fontWeight: '800', color: '#ffffff' },

    txRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 10, borderRadius: 22, backgroundColor: colors.surfaceElevated },
    txIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    txInfo: { flex: 1, gap: 4 },
    txDesc: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    txMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    sourceBadge: { height: 22, paddingHorizontal: 8, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    sourceBadgeText: { fontSize: 11, fontWeight: '700', color: colors.accent },
    txTime: { fontSize: 12, color: colors.textMuted },
    txPoints: { fontSize: 17, fontWeight: '800', flexShrink: 0 },

    loadMoreBtn: { alignItems: 'center', justifyContent: 'center', height: 48, marginTop: 4, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    loadMoreText: { fontSize: 14, fontWeight: '800', color: colors.accent },

    emptyBox: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 40, gap: 12 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    emptyText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
  });
}
