import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Linking, RefreshControl, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { SALES_WA_NUMBER, SALES_WA_DISPLAY } from '@/constants/contact';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

const HOTLINE_DISPLAY = SALES_WA_DISPLAY;
const HOTLINE_WA = `https://wa.me/${SALES_WA_NUMBER}`;
const ANDROID_PACKAGE = 'id.ginnva.shield';

function openAppStoreRating() {
  const url = Platform.OS === 'android'
    ? `market://details?id=${ANDROID_PACKAGE}`
    : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`)
  );
}

type MenuItem = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  route?: string;
  onPress?: () => void;
  rightLabel?: string;
  // Item yang datanya melekat ke akun customer (histori, poin, dst) —
  // disembunyikan total kalau belum login, supaya tidak tap ke layar
  // yang cuma akan gagal fetch data / kosong percuma.
  requiresAuth?: boolean;
};

type MenuGroup = {
  title: string;
  items: MenuItem[];
};

// Dikelompokkan pakai section header (bukan submenu bersarang — nambah
// tap ekstra untuk ~12 item itu kurang worth it) supaya lebih gampang
// di-scan dibanding 1 list rata panjang seperti sebelumnya. Item
// "Galeri Mobil Saya" SENGAJA tidak dimasukkan di sini — baru disisipkan
// secara dinamis (lihat menuGroups di bawah) kalau customer sudah punya
// booking yang diterima admin toko (status confirmed/completed).
const MENU_GROUPS: MenuGroup[] = [
  {
    title: 'Aktivitas Saya',
    items: [
      { key: 'warranties', label: 'Garansi Saya', icon: 'shield-checkmark-outline', route: '/account/my-warranties', requiresAuth: true },
      { key: 'bookings', label: 'Booking Saya', icon: 'calendar-outline', route: '/account/my-bookings', requiresAuth: true },
      { key: 'vouchers', label: 'Voucher Saya', icon: 'ticket-outline', route: '/account/vouchers', requiresAuth: true },
      { key: 'notifications', label: 'Notifikasi', icon: 'notifications-outline', route: '/account/notifications', requiresAuth: true },
    ],
  },
  {
    title: 'Promo & Layanan',
    items: [
      // Promo TIDAK requiresAuth — customer yang belum login pun boleh
      // lihat promo yang berjalan, supaya bisa terdorong datang ke toko
      // (lihat banner ajakan di app/account/promo.tsx).
      { key: 'promo', label: 'Promo', icon: 'pricetags-outline', route: '/account/promo' },
      { key: 'check', label: 'Cek Garansi', icon: 'search-outline', route: '/warranty/check' },
      { key: 'stores', label: 'Cari Toko', icon: 'storefront-outline', route: '/(tabs)/stores' },
      { key: 'quotation', label: 'Ajukan Penawaran', icon: 'document-text-outline', route: '/quotation' },
      { key: 'partnership', label: 'Ajukan Kemitraan', icon: 'business-outline', route: '/partnership' },
    ],
  },
  {
    title: 'Bantuan',
    items: [
      {
        key: 'hotline',
        label: 'Hotline',
        icon: 'call-outline',
        rightLabel: HOTLINE_DISPLAY,
        onPress: () => Linking.openURL(HOTLINE_WA),
      },
      {
        key: 'rate-app',
        label: 'Beri Rating Aplikasi',
        icon: 'star-outline',
        onPress: openAppStoreRating,
      },
      {
        key: 'privacy',
        label: 'Kebijakan Privasi',
        icon: 'document-lock-outline',
        onPress: () => Linking.openURL('https://ginnva.id/privacy'),
      },
    ],
  },
];

const POINTS_PER_WARRANTY = 100;

export default function AccountScreen() {
  const { customer, isLoading, isLoggedIn, logout } = useAuth();
  const { theme, colors, toggleTheme } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [points, setPoints] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Sama seperti di beranda: galeri cuma relevan setelah admin toko
  // menerima booking (status confirmed/completed).
  const [hasConfirmedBooking, setHasConfirmedBooking] = useState(false);

  const fetchPoints = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const res = await apiFetch<{ balance: number }>('/api/customer/points');
      setPoints(res.balance);
    } catch { /* silent */ }
  }, [isLoggedIn]);

  const fetchBookingStatus = useCallback(async () => {
    if (!isLoggedIn) { setHasConfirmedBooking(false); return; }
    try {
      const res = await apiFetch<{ data: { status: string }[] }>('/api/customer/bookings');
      setHasConfirmedBooking(res.data.some((b) => b.status === 'confirmed' || b.status === 'completed'));
    } catch { /* silent */ }
  }, [isLoggedIn]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchPoints(), fetchBookingStatus()]);
    setRefreshing(false);
  }, [fetchPoints, fetchBookingStatus]);

  useEffect(() => { fetchPoints(); }, [fetchPoints]);
  useEffect(() => { fetchBookingStatus(); }, [fetchBookingStatus]);

  // Refresh tiap kali tab Akun kembali fokus — tanpa ini, poin & status
  // booking bisa basi kalau berubah (mis. klaim garansi dapat poin) sambil
  // customer sedang membuka tab lain (sama seperti bug badge notifikasi
  // yang sudah diperbaiki di Beranda).
  useFocusEffect(
    useCallback(() => {
      fetchPoints();
      fetchBookingStatus();
    }, [fetchPoints, fetchBookingStatus])
  );

  // "Galeri Mobil Saya" disisipkan di grup "Aktivitas Saya", tepat setelah
  // "Voucher Saya" — cuma kalau customer sudah punya booking yang diterima
  // admin toko (status confirmed/completed).
  const menuGroups: MenuGroup[] = MENU_GROUPS.map((group) => {
    if (group.title !== 'Aktivitas Saya' || !hasConfirmedBooking) return group;
    const galleryItem: MenuItem = {
      key: 'gallery', label: 'Galeri Mobil Saya', icon: 'images-outline',
      route: '/account/my-gallery', requiresAuth: true,
    };
    return { ...group, items: [...group.items.slice(0, 2), galleryItem, ...group.items.slice(2)] };
  })
    // Sembunyikan total item yang butuh akun kalau belum login — bukan
    // cuma disabled, supaya tidak ada yang tap ke layar yang pasti gagal
    // fetch data karena tidak ada token customer. Grup yang jadi kosong
    // (semua isinya requiresAuth) ikut disembunyikan headernya.
    .map((group) => ({
      ...group,
      items: isLoggedIn ? group.items : group.items.filter((item) => !item.requiresAuth),
    }))
    .filter((group) => group.items.length > 0);

  const handleLogout = () => {
    Alert.alert('Keluar Akun', 'Anda yakin ingin keluar?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Keluar', style: 'destructive', onPress: logout },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerState} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Akun</Text>
        </View>

        {isLoggedIn && customer ? (
          <>
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(customer.name || customer.email || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{customer.name || 'Pengguna Ginnva'}</Text>
              <Text style={styles.profileEmail}>{customer.email}</Text>
              {customer.phone_number ? (
                <Text style={styles.profilePhone}>+62 {customer.phone_number}</Text>
              ) : (
                <Text style={styles.profilePhoneMissing}>Belum ada nomor WA</Text>
              )}
            </View>
            <Pressable
              style={styles.editButton}
              hitSlop={12}
              onPress={() => router.push('/account/edit-profile' as never)}
            >
              <Ionicons name="pencil-outline" size={18} color={colors.accent} />
            </Pressable>
          </View>

          {/* Kartu poin */}
          <Pressable
            style={styles.pointsCard}
            onPress={() => router.push('/account/points' as never)}
          >
            <View style={styles.pointsLeft}>
              <Ionicons name="star" size={20} color={colors.gold} />
              <View>
                <Text style={styles.pointsLabel}>Poin Saya</Text>
                <Text style={styles.pointsValue}>{points.toLocaleString('id-ID')} poin</Text>
              </View>
            </View>
            <View style={styles.pointsRight}>
              <Text style={styles.pointsHint}>+{POINTS_PER_WARRANTY} per garansi</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </View>
          </Pressable>
          </>) : (
          <View style={styles.loginCard}>
            <Ionicons name="person-circle-outline" size={40} color={colors.accent} />
            <Text style={styles.loginTitle}>Masuk untuk Pengalaman Lebih Lengkap</Text>
            <Text style={styles.loginSubtitle}>
              Simpan riwayat garansi Anda dan dapatkan akses lebih cepat ke layanan
              after-sales.
            </Text>
            <Button
              label="Masuk / Daftar"
              onPress={() => router.push('/auth/login' as never)}
              style={styles.loginButton}
            />
          </View>
        )}

        {/* Toggle instan, bukan navigasi ke halaman lain — sengaja berdiri
            sendiri, bukan bagian dari grup menu route manapun, tapi tetap
            dikasih judul section supaya konsisten dengan grup lain di
            bawahnya (bukan floating tanpa label). */}
        <Text style={styles.groupTitle}>Tampilan</Text>
        <View style={styles.menuList}>
          <View style={styles.menuRow}>
            <Ionicons name={theme === 'dark' ? 'moon' : 'sunny-outline'} size={20} color={colors.textPrimary} />
            <Text style={styles.menuLabel}>Mode Gelap</Text>
            <Switch
              value={theme === 'dark'}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {menuGroups.map((group) => (
          <View key={group.title}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.menuList}>
              {group.items.map((item) => (
                <Pressable
                  key={item.key}
                  style={styles.menuRow}
                  onPress={item.onPress ?? (() => router.push(item.route as never))}
                >
                  <Ionicons name={item.icon} size={20} color={colors.textPrimary} />
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  {item.rightLabel ? (
                    <Text style={styles.menuRightLabel}>{item.rightLabel}</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {isLoggedIn && (
          <Pressable style={styles.logoutRow} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={colors.accent} />
            <Text style={styles.logoutLabel}>Keluar</Text>
          </Pressable>
        )}

        <Text style={styles.versionText}>Ginnva House · v{APP_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centerState: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    // SENGAJA hardcode putih (bukan colors.textPrimary) — teks ini duduk
    // di atas background colors.accent (merah), yang sama di kedua tema.
    // colors.textPrimary di tema terang adalah abu gelap, kontrasnya
    // buruk di atas merah pekat.
    color: '#ffffff',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  profileEmail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  profilePhone: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  profilePhoneMissing: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  editButton: {
    padding: spacing.xs,
  },
  pointsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  pointsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pointsLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  pointsValue: {
    fontSize: fontSize.base,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  pointsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pointsHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  loginCard: {
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loginTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  loginSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 19,
  },
  loginButton: {
    marginTop: spacing.md,
    width: '100%',
  },
  menuList: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: spacing.md + spacing.xs,
    marginBottom: spacing.xs,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuLabel: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  menuRightLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoutLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.accent,
  },
  versionText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  });
}
