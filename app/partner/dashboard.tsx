import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  Alert,
  Linking,
  Animated,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { useAppTheme } from '@/lib/theme-context';

// Penukaran poin dilakukan langsung di toko, bukan lewat app — tombol
// "Tukarkan Poin" cuma antar partner ke lokasi flagship store-nya.
const GINNVA_HOUSE_MAPS_URL = 'https://maps.app.goo.gl/USCYspDTS3Wy53JZ8';

// Aksen kedua untuk section Partner — rose gold/copper, sengaja BUKAN
// emas kuning (supaya tidak bentrok sama identitas merah brand), dipakai
// tipis-tipis untuk garis/border/ikon supaya terasa premium tanpa
// menggantikan merah sebagai warna utama CTA.
const COPPER = '#c9916a';
const COPPER_SOFT = 'rgba(201,145,106,0.16)';

interface PartnerProfile {
  id: number;
  business_name: string;
  phone: string | null;
  referral_code: string;
  points_balance: number;
  status: 'active' | 'inactive';
  joined_at: string;
}

function formatJoinDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

interface PromoBanner {
  id: number;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  link_url: string | null;
}

type QuickAction = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

export default function PartnerDashboardScreen() {
  const { logout } = useStaffAuth();
  const { theme, colors } = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const promoWidth = screenWidth - spacing.md * 2;
  const promoHeight = Math.round(promoWidth * 0.42);
  const styles = useMemo(
    () => createStyles(colors, promoWidth, promoHeight),
    [colors, promoWidth, promoHeight]
  );

  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [promos, setPromos] = useState<PromoBanner[]>([]);
  const [activePromo, setActivePromo] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enterAnim = useRef(new Animated.Value(0)).current;
  const promoScrollRef = useRef<ScrollView>(null);

  const fetchProfile = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await staffApiFetch<{ data: PartnerProfile }>('/api/partner/me');
      setProfile(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data partner.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchPromos = useCallback(async () => {
    try {
      const res = await staffApiFetch<{ data: PromoBanner[] }>('/api/partner/promos');
      setPromos(res.data);
    } catch {
      // Promo bersifat opsional — kegagalan tidak boleh mengganggu dashboard.
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await staffApiFetch<{ unread_count: number }>('/api/partner/notifications');
      setUnreadCount(res.unread_count);
    } catch {
      // Badge notifikasi bersifat opsional — kegagalan tidak boleh mengganggu dashboard.
    }
  }, []);

  useEffect(() => { fetchProfile(); fetchPromos(); fetchUnreadCount(); }, [fetchProfile, fetchPromos, fetchUnreadCount]);

  // Poin & badge notifikasi bisa berubah di layar lain (mis. baca
  // notifikasi, dapat poin baru) — refresh saat kembali fokus ke
  // dashboard, sama seperti pola di Beranda/Akun Saya customer.
  useFocusEffect(
    useCallback(() => {
      fetchProfile();
      fetchUnreadCount();
    }, [fetchProfile, fetchUnreadCount])
  );

  // Auto-scroll banner promo tiap 4 detik, sama seperti carousel beranda Customer.
  useEffect(() => {
    if (promos.length < 2) return;
    const timer = setInterval(() => {
      setActivePromo((prev) => {
        const next = (prev + 1) % promos.length;
        promoScrollRef.current?.scrollTo({ x: next * promoWidth, animated: true });
        return next;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [promos.length, promoWidth]);

  const onPromoScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setActivePromo(Math.round(e.nativeEvent.contentOffset.x / promoWidth));
  };

  useEffect(() => {
    if (profile && !refreshing) {
      enterAnim.setValue(0);
      Animated.timing(enterAnim, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }).start();
    }
  }, [profile, refreshing, enterAnim]);

  const handleShare = () => {
    if (!profile) return;
    Share.share({
      message: `Pakai kode referral saya "${profile.referral_code}" saat booking instalasi PPF/Kaca Film Ginnva ya! Booking lewat aplikasi Ginnva atau langsung ke dealer terdekat.`,
    });
  };

  const handleRedeem = () => Linking.openURL(GINNVA_HOUSE_MAPS_URL);

  const handleLogout = () => {
    Alert.alert('Keluar', 'Yakin ingin keluar dari akun partner?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Keluar', style: 'destructive', onPress: () => logout().then(() => router.replace('/auth/login' as never)) },
    ]);
  };

  const quickActions: QuickAction[] = profile ? [
    { key: 'share', label: 'Bagikan Kode', icon: 'share-social-outline', onPress: handleShare },
    { key: 'referrals', label: 'Riwayat Referral', icon: 'people-outline', onPress: () => router.push('/partner/referrals' as never) },
    { key: 'points', label: 'Riwayat Poin', icon: 'time-outline', onPress: () => router.push('/partner/points' as never) },
    { key: 'redemptions', label: 'Penukaran Poin', icon: 'receipt-outline', onPress: () => router.push('/partner/redemptions' as never) },
    { key: 'redeem', label: 'Tukar di Toko', icon: 'storefront-outline', onPress: handleRedeem },
  ] : [];

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { fetchProfile(true); fetchPromos(); fetchUnreadCount(); }}
            tintColor={colors.accent}
          />
        }
      >
        <LinearGradient
          colors={['#0b0b16', colors.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroEyebrowRow}>
              <View style={styles.heroEyebrowBar} />
              <Text style={styles.heroEyebrow}>Akun Mitra</Text>
            </View>
            <View style={styles.heroActions}>
              <Pressable
                onPress={() => router.push('/partner/edit-profile' as never)}
                hitSlop={10}
                style={styles.logoutButton}
              >
                <Ionicons name="settings-outline" size={20} color="#ffffff" />
              </Pressable>
              <Pressable
                onPress={() => router.push('/partner/notifications' as never)}
                hitSlop={10}
                style={styles.logoutButton}
              >
                <Ionicons name="notifications-outline" size={20} color="#ffffff" />
                {unreadCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                  </View>
                )}
              </Pressable>
              <Pressable onPress={handleLogout} hitSlop={10} style={styles.logoutButton}>
                <Ionicons name="log-out-outline" size={20} color="#ffffff" />
              </Pressable>
            </View>
          </View>

          {error ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline-outline" size={32} color="rgba(255,255,255,0.7)" />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retryBtn} onPress={() => fetchProfile()}>
                <Text style={styles.retryText}>Coba Lagi</Text>
              </Pressable>
            </View>
          ) : profile ? (
            <>
              <View style={styles.heroNameRow}>
                <Text style={styles.businessName} numberOfLines={1}>{profile.business_name}</Text>
                <View style={[styles.statusPill, profile.status !== 'active' && styles.statusPillInactive]}>
                  <View style={[styles.statusDot, profile.status !== 'active' && styles.statusDotInactive]} />
                  <Text style={styles.statusPillText}>{profile.status === 'active' ? 'Aktif' : 'Nonaktif'}</Text>
                </View>
              </View>
              {profile.joined_at && (
                <Text style={styles.joinDate}>Mitra sejak {formatJoinDate(profile.joined_at)}</Text>
              )}

              <Animated.View
                style={[
                  styles.balanceCard,
                  {
                    opacity: enterAnim,
                    transform: [{ translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
                  },
                ]}
              >
                <View style={styles.balanceRow}>
                  <View style={styles.balanceIconWrap}>
                    <Ionicons name="star" size={22} color={COPPER} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.balanceLabel}>Poin Reward</Text>
                    <Text style={styles.balanceValue}>{profile.points_balance.toLocaleString('id-ID')}</Text>
                  </View>
                  <Pressable style={styles.redeemCta} onPress={handleRedeem}>
                    <Text style={styles.redeemCtaText}>Tukar</Text>
                    <Ionicons name="chevron-forward" size={14} color="#ffffff" />
                  </Pressable>
                </View>
              </Animated.View>
            </>
          ) : null}
        </LinearGradient>

        {profile ? (
          <Animated.View
            style={{
              opacity: enterAnim,
              transform: [{ translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
            }}
          >
            {/* Kode referral */}
            <View style={styles.codeCard}>
              <View style={styles.codeCardHeader}>
                <Ionicons name="pricetag-outline" size={16} color={COPPER} />
                <Text style={styles.codeLabel}>Kode Referral Anda</Text>
              </View>

              <View style={styles.codeBox}>
                {profile.referral_code.split('').map((char, idx) => (
                  <View key={idx} style={styles.codeCell}>
                    <Text style={styles.codeCellText}>{char}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.codeHint}>
                Bagikan kode ini ke teman & kerabatmu. Setiap mereka booking dan bayar di toko dengan kode ini, kamu langsung dapat poin reward.
              </Text>
              <Pressable style={styles.shareBtn} onPress={handleShare}>
                <Ionicons name="share-social-outline" size={16} color="#ffffff" />
                <Text style={styles.shareBtnText}>Bagikan Kode</Text>
              </Pressable>
            </View>

            {/* Banner promo — khusus Partner, dikelola dari Filament (Carousel, audience=partner/both) */}
            {promos.length > 0 && (
              <View style={styles.promoWrap}>
                <ScrollView
                  ref={promoScrollRef}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={onPromoScroll}
                  scrollEventThrottle={16}
                >
                  {promos.map((promo) => (
                    <Pressable
                      key={promo.id}
                      style={styles.promoSlide}
                      disabled={!promo.link_url}
                      onPress={() => promo.link_url && Linking.openURL(promo.link_url)}
                    >
                      <Image source={{ uri: promo.image ?? undefined }} style={styles.promoImage} contentFit="cover" />
                      {(promo.title || promo.subtitle) && (
                        <LinearGradient
                          colors={['transparent', 'rgba(0,0,0,0.75)']}
                          style={styles.promoGradient}
                        >
                          {promo.title && <Text style={styles.promoTitle} numberOfLines={1}>{promo.title}</Text>}
                          {promo.subtitle && <Text style={styles.promoSubtitle} numberOfLines={2}>{promo.subtitle}</Text>}
                        </LinearGradient>
                      )}
                    </Pressable>
                  ))}
                </ScrollView>
                {promos.length > 1 && (
                  <View style={styles.promoDots}>
                    {promos.map((_, idx) => (
                      <View key={idx} style={[styles.promoDot, idx === activePromo && styles.promoDotActive]} />
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Quick actions */}
            <Text style={styles.sectionTitle}>Menu Cepat</Text>
            <View style={styles.quickGrid}>
              {quickActions.map((action) => (
                <Pressable
                  key={action.key}
                  onPress={action.onPress}
                  style={({ pressed }) => [styles.quickItem, pressed && styles.quickItemPressed]}
                >
                  <View style={styles.quickIconWrap}>
                    <Ionicons name={action.icon} size={22} color={COPPER} />
                  </View>
                  <Text style={styles.quickItemText}>{action.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Info card */}
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.infoCardText}>
                Penukaran poin dilakukan langsung di Ginnva House bersama tim kami — proses ini sengaja tatap muka supaya lebih aman dan personal untukmu.
              </Text>
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, promoWidth: number, promoHeight: number) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  errorText: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: '#ffffff',
    borderRadius: radius.pill,
  },
  retryText: { color: colors.accent, fontWeight: '700', fontSize: fontSize.sm },

  scrollContent: { paddingBottom: spacing.xxl },

  hero: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.lg * 1.5,
    borderBottomRightRadius: radius.lg * 1.5,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroEyebrowBar: { width: 3, height: 12, borderRadius: 2, backgroundColor: COPPER },
  heroEyebrow: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  logoutButton: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 16, height: 16, borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#f87171',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#1a1332',
  },
  bellBadgeText: { fontSize: 9, fontWeight: '800', color: '#ffffff' },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: 2,
  },
  businessName: { flex: 1, fontSize: fontSize.xl, fontWeight: '800', color: '#ffffff' },
  joinDate: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.65)',
    marginBottom: spacing.lg,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(52,211,153,0.2)',
  },
  statusPillInactive: { backgroundColor: 'rgba(248,113,113,0.2)' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34d399' },
  statusDotInactive: { backgroundColor: '#f87171' },
  statusPillText: { fontSize: fontSize.xs, fontWeight: '700', color: '#ffffff' },

  balanceCard: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: radius.lg,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  balanceIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: COPPER_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  balanceLabel: { fontSize: fontSize.xs, color: '#8a8a8a', fontWeight: '600' },
  balanceValue: { fontSize: fontSize.xxl, fontWeight: '800', color: '#1a1a1a', letterSpacing: -0.5 },
  redeemCta: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm, paddingVertical: 8,
    borderRadius: radius.pill,
  },
  redeemCtaText: { fontSize: fontSize.xs, fontWeight: '700', color: '#ffffff' },

  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 2,
    borderTopColor: COPPER,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  codeCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  codeLabel: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  codeBox: { flexDirection: 'row', gap: 6, marginVertical: spacing.xs },
  codeCell: {
    width: 30, height: 40, borderRadius: radius.sm,
    backgroundColor: COPPER_SOFT,
    borderWidth: 1, borderColor: COPPER,
    alignItems: 'center', justifyContent: 'center',
  },
  codeCellText: { fontSize: fontSize.lg, fontWeight: '800', color: COPPER },
  codeHint: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: spacing.xs },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, marginTop: spacing.sm,
  },
  shareBtnText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },

  promoWrap: { marginHorizontal: spacing.md, marginTop: spacing.lg },
  promoSlide: { width: promoWidth, height: promoHeight, borderRadius: radius.lg, overflow: 'hidden' },
  promoImage: { width: promoWidth, height: promoHeight, backgroundColor: colors.surface },
  promoGradient: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  promoTitle: { fontSize: fontSize.base, fontWeight: '800', color: '#ffffff' },
  promoSubtitle: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  promoDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  promoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  promoDotActive: { backgroundColor: colors.accent, width: 16 },

  sectionTitle: {
    fontSize: fontSize.xs, fontWeight: '800', color: COPPER,
    letterSpacing: 1.2, textTransform: 'uppercase',
    marginHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  quickGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: spacing.md - spacing.xs / 2,
    gap: spacing.xs,
  },
  quickItem: {
    width: '48%',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.xs / 2,
    marginBottom: spacing.xs,
  },
  quickItemPressed: { opacity: 0.7 },
  quickIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COPPER_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  quickItemText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },

  infoCard: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderLeftWidth: 3,
    borderLeftColor: COPPER,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  infoCardText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18 },
  });
}
