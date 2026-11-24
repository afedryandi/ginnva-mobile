import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert, Linking, RefreshControl, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { Button } from '@/components/ui/Button';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
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

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type MenuItem = {
  key: string;
  label: string;
  icon: IconName;
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
      // Kendaraan Saya (Fase 1 pengerjaan ulang booking, 2026-10-15): kendaraan tersimpan untuk booking berikutnya.
      { key: 'vehicles', label: 'Kendaraan Saya', icon: 'car-sport-outline', route: '/account/vehicles', requiresAuth: true },
      // Portal Invoice (gap "standar enterprise" diperbaiki 2026-09-25,
      // audit Invoice) — sebelumnya customer sama sekali tidak bisa
      // lihat/unduh invoice sendiri lewat app.
      { key: 'invoices', label: 'Invoice Saya', icon: 'document-text-outline', route: '/account/invoices', requiresAuth: true },
      { key: 'vouchers', label: 'Voucher Saya', icon: 'ticket-outline', route: '/account/vouchers', requiresAuth: true },
      { key: 'reward-redemptions', label: 'Riwayat Tukar Reward', icon: 'gift-outline', route: '/account/reward-redemptions', requiresAuth: true },
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

// Empat menu yang paling sering dibuka naik jadi pintasan kotak di bagian atas (hanya saat sudah masuk); sisanya tetap di daftar.
const SHORTCUT_KEYS = ['warranties', 'bookings', 'vehicles', 'invoices'];
const SHORTCUT_SHORT_LABEL: Record<string, string> = { warranties: 'Garansi', bookings: 'Booking', vehicles: 'Kendaraan', invoices: 'Invoice' };

// Tampilan didesain ulang (2026-11-24): profil sebagai kepala halaman, pintasan kotak, daftar menu dalam kartu lembut dengan ikon bulat.
// Data, menu, dan aturan tampil (masuk/belum masuk, galeri) tidak berubah.
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

  const shortcuts = isLoggedIn
    ? SHORTCUT_KEYS.map((key) => menuGroups.flatMap((g) => g.items).find((item) => item.key === key)).filter((item): item is MenuItem => !!item)
    : [];
  const listGroups = menuGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !shortcuts.some((s) => s.key === item.key)) }))
    .filter((group) => group.items.length > 0);

  const open = (item: MenuItem) => (item.onPress ? item.onPress() : router.push(item.route as never));

  const handleLogout = () => {
    Alert.alert('Keluar Akun', 'Yakin mau keluar?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Keluar', style: 'destructive', onPress: logout },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centerState} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      {/* Sorotan merah lembut di sudut atas, sama seperti layar masuk. */}
      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {isLoggedIn && customer ? (
          <>
            <FadeInUp style={styles.profile}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(customer.name || customer.email || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName} numberOfLines={1}>{customer.name || 'Pengguna Ginnva'}</Text>
                <Text style={styles.profileEmail} numberOfLines={1}>{customer.email}</Text>
                {customer.phone_number ? (
                  <View style={styles.phoneChip}>
                    <Ionicons name="logo-whatsapp" size={13} color={colors.textSecondary} />
                    <Text style={styles.phoneText}>+62 {customer.phone_number}</Text>
                  </View>
                ) : (
                  <Text style={styles.profilePhoneMissing}>Belum ada nomor WA</Text>
                )}
              </View>
              <Pressable
                style={styles.editButton}
                hitSlop={10}
                onPress={() => router.push('/account/edit-profile' as never)}
                accessibilityRole="button"
                accessibilityLabel="Ubah profil"
              >
                <Ionicons name="pencil-outline" size={18} color={colors.textPrimary} />
              </Pressable>
            </FadeInUp>

            {/* Kartu poin */}
            <FadeInUp delay={60}>
              <PressableScale style={styles.pointsCard} onPress={() => router.push('/account/points' as never)} accessibilityRole="button">
                {/* GATE COMING SOON (diminta user, 2026-09-30) -- angka saldo asli
                    (`points`) sengaja TIDAK ditampilkan dulu, diganti badge, biar
                    tidak kelihatan "hidup" padahal layar tujuannya sudah di-gate
                    (lihat app/account/points.tsx). State `points`/fetchPoints()
                    TIDAK dihapus, tetap jalan diam-diam di background. */}
                <View style={styles.pointsIcon}>
                  <Ionicons name="star" size={20} color={colors.accent} />
                </View>
                <View style={styles.pointsText}>
                  <Text style={styles.pointsLabel}>Poin Saya</Text>
                  <Text style={styles.pointsValue}>Segera Hadir</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </PressableScale>
            </FadeInUp>

            {shortcuts.length > 0 ? (
              <FadeInUp delay={120} style={styles.shortcutRow}>
                {shortcuts.map((item) => (
                  <PressableScale key={item.key} style={styles.shortcut} onPress={() => open(item)} accessibilityRole="button" accessibilityLabel={item.label}>
                    <View style={styles.shortcutIcon}>
                      <Ionicons name={item.icon} size={22} color={colors.accent} />
                    </View>
                    <Text style={styles.shortcutLabel} numberOfLines={1}>{SHORTCUT_SHORT_LABEL[item.key] ?? item.label}</Text>
                  </PressableScale>
                ))}
              </FadeInUp>
            ) : null}
          </>
        ) : (
          <FadeInUp style={styles.guest}>
            <View style={styles.guestIcon}>
              <Ionicons name="person-outline" size={30} color={colors.accent} />
            </View>
            <Text style={styles.guestTitle}>{'Masuk untuk pengalaman\nyang lebih lengkap'}</Text>
            <Text style={styles.guestSubtitle}>
              Simpan riwayat garansi dan dapatkan akses lebih cepat ke layanan after-sales.
            </Text>
            <Button
              label="Masuk / Daftar"
              onPress={() => router.push('/auth/login' as never)}
              style={styles.guestButton}
            />
          </FadeInUp>
        )}

        {/* Toggle instan, bukan navigasi ke halaman lain — sengaja berdiri
            sendiri, bukan bagian dari grup menu route manapun, tapi tetap
            dikasih judul section supaya konsisten dengan grup lain di
            bawahnya (bukan floating tanpa label). */}
        <Text style={styles.groupTitle}>Tampilan</Text>
        <View style={styles.menuList}>
          <View style={styles.menuRow}>
            <View style={styles.menuIcon}>
              <Ionicons name={theme === 'dark' ? 'moon-outline' : 'sunny-outline'} size={18} color={colors.accent} />
            </View>
            <Text style={styles.menuLabel}>Mode Gelap</Text>
            <Switch
              value={theme === 'dark'}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {listGroups.map((group) => (
          <View key={group.title}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.menuList}>
              {group.items.map((item, i) => (
                <Pressable
                  key={item.key}
                  style={[styles.menuRow, i < group.items.length - 1 && styles.menuRowDivider]}
                  onPress={() => open(item)}
                  accessibilityRole="button"
                >
                  <View style={styles.menuIcon}>
                    <Ionicons name={item.icon} size={18} color={colors.accent} />
                  </View>
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
          <PressableScale style={styles.logoutButton} onPress={handleLogout} accessibilityRole="button">
            <Ionicons name="log-out-outline" size={20} color={colors.accent} />
            <Text style={styles.logoutLabel}>Keluar</Text>
          </PressableScale>
        )}

        <Text style={styles.versionText}>Ginnva House · v{APP_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centerState: { flex: 1 },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
    scrollContent: { paddingHorizontal: 20, paddingTop: spacing.lg, paddingBottom: 120 },

    // Profil sebagai kepala halaman: avatar besar, nama tebal, email dan nomor WA di bawahnya.
    profile: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
    avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    // SENGAJA putih tetap: duduk di atas merah pekat yang sama di kedua tema.
    avatarText: { fontSize: 28, fontWeight: '800', color: '#ffffff' },
    profileInfo: { flex: 1, gap: 2 },
    profileName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
    profileEmail: { fontSize: 14, color: colors.textSecondary },
    phoneChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 6, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: colors.surfaceElevated },
    phoneText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    profilePhoneMissing: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
    editButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },

    pointsCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 24, backgroundColor: colors.accentSoft },
    pointsIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    pointsText: { flex: 1, gap: 1 },
    pointsLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    pointsValue: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },

    shortcutRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
    shortcut: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, borderRadius: 22, backgroundColor: colors.surfaceElevated },
    shortcutIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    shortcutLabel: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },

    guest: { alignItems: 'flex-start', gap: 12, paddingTop: spacing.md, paddingBottom: spacing.lg },
    guestIcon: { width: 64, height: 64, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    guestTitle: { fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    guestSubtitle: { fontSize: 15, lineHeight: 23, color: colors.textSecondary, maxWidth: 340 },
    guestButton: { width: '100%', height: 56, borderRadius: 28, marginTop: 8 },

    groupTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted, marginTop: 28, marginBottom: 10, marginLeft: 6 },
    menuList: { borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
    menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 16, paddingVertical: 10 },
    menuRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    menuIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    menuLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
    menuRightLabel: { fontSize: 13, color: colors.textSecondary },

    logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, marginTop: 28, borderRadius: 27, backgroundColor: colors.accentSoft },
    logoutLabel: { fontSize: 15, fontWeight: '800', color: colors.accent },
    versionText: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 20 },
  });
}
