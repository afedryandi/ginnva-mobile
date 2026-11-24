import React, { useMemo } from 'react';
import { View, Pressable, StyleSheet, Animated } from 'react-native';
import { AppText as Text } from '@/components/ui/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth, isAttendanceRequired } from '@/lib/staff-auth-context';
import { useReduceMotion } from '@/lib/motion';
import { useNavHidden, showNav } from '@/lib/staff-nav-visibility';

/** Ikon tab: tab yang baru aktif melonjak sebentar (2026-11-12) sebagai tanda terpilih. Tanpa animasi bila gerak dikurangi. */
function TabIcon({ active, icon, iconActive, color }: {
  active: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconActive: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();

  React.useEffect(() => {
    if (!active || reduce) return;

    scale.setValue(0.8);
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [active, reduce, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons name={active ? iconActive : icon} size={22} color={color} />
    </Animated.View>
  );
}

// Bilah melayang di ATAS isi layar (area di kiri, kanan, dan bawahnya transparan, isi terlihat menembus), jadi daftar di layar utama memberi
// ruang kosong sebesar ini di ujung bawahnya supaya item terakhir tidak tertutup.
export const NAV_CLEARANCE = 128;

export type StaffTab = 'home' | 'attendance' | 'work' | 'payroll' | 'profile';

interface TabDef {
  key: StaffTab;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconActive: React.ComponentProps<typeof Ionicons>['name'];
  href: string;
}

// Navigasi bawah halaman utama staff. Hanya dipasang di 5 layar tingkat atas (Beranda, Absensi, Booking/SPK, Slip Gaji, Profil); layar
// detail dan modul lain tetap memakai tombol kembali. Pindah antar-tab memakai replace supaya tumpukan layar tidak menumpuk. Tab
// "Booking" memakai Booking Toko bila akunnya punya akses booking, jika tidak SPK bila punya akses SPK, dan disembunyikan bila keduanya
// tidak ada. Modul lain (inventaris, lead, dst.) tetap di grid Beranda; Kotak Masuk ada di header Beranda, sedangkan K3, peraturan, dan panduan ada di Profil.
// Scan QR umum untuk gudang ada di pintasan Beranda (bukan di bilah ini: tombol tambahan membuat teks tab terpotong).
export function StaffBottomNav({ active }: { active: StaffTab }) {
  const { theme, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { staff } = useStaffAuth();
  const isDark = theme === 'dark';
  // Teks merah kecil memakai versi sedikit lebih gelap (terang) atau lebih muda (gelap) supaya kontrasnya cukup.
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const styles = useMemo(() => createStyles(colors, insets.bottom, isDark, accentText), [colors, insets.bottom, isDark, accentText]);

  const hidden = useNavHidden();
  const reduce = useReduceMotion();
  const slide = React.useRef(new Animated.Value(0)).current;

  // Layar baru selalu mulai dengan bilah terlihat.
  React.useEffect(() => {
    showNav();
  }, []);

  React.useEffect(() => {
    Animated.timing(slide, { toValue: hidden ? 1 : 0, duration: reduce ? 0 : 220, useNativeDriver: true }).start();
  }, [hidden, reduce, slide]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, NAV_CLEARANCE] });

  const workTab: TabDef | null = staff?.has_booking_access
    ? { key: 'work', label: 'Booking', icon: 'calendar-outline', iconActive: 'calendar', href: '/staff/bookings' }
    : (staff?.has_spk_access ?? false)
      ? { key: 'work', label: 'SPK', icon: 'document-text-outline', iconActive: 'document-text', href: '/staff/spks' }
      : null;

  const tabs: TabDef[] = [
    { key: 'home', label: 'Beranda', icon: 'home-outline', iconActive: 'home', href: '/staff' },
    // Direksi tidak wajib absen; izin/cuti mereka tetap lewat Profil.
    ...(isAttendanceRequired(staff) ? [{ key: 'attendance' as const, label: 'Absensi', icon: 'time-outline' as const, iconActive: 'time' as const, href: '/staff/attendance' }] : []),
    ...(workTab ? [workTab] : []),
    // Gaji tidak dihitung di sistem (FEATURE_PAYROLL mati, 2026-11-10): tab hilang bila server menyatakan payroll mati. Sesi lama tanpa flag tetap menampilkannya sampai profil diperbarui.
    ...(staff?.has_payroll === false ? [] : [{ key: 'payroll' as const, label: 'Gaji', icon: 'cash-outline' as const, iconActive: 'cash' as const, href: '/staff/payroll' }]),
    { key: 'profile', label: 'Profil', icon: 'person-outline', iconActive: 'person', href: '/staff/profile' },
  ];

  return (
    <Animated.View style={[styles.overlay, { transform: [{ translateY }] }]} pointerEvents={hidden ? 'none' : 'box-none'}>
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;

        return (
          <Pressable
            key={tab.key}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            onPress={() => {
              if (!isActive) router.replace(tab.href as never);
            }}
          >
            <View style={[styles.pill, isActive && styles.pillActive]}>
              <TabIcon active={isActive} icon={tab.icon} iconActive={tab.iconActive} color={isActive ? accentText : colors.textMuted} />
              <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>{tab.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
    </Animated.View>
  );
}

function createStyles(colors: typeof darkColors, insetsBottom: number, isDark: boolean, accentText: string) {
  return StyleSheet.create({
    // Bilah tampak melayang: berujung bulat, berjarak dari tepi layar, dan berbayangan halus. Tetap berada DI DALAM alur tata letak (bukan
    // menumpuk di atas isi), jadi daftar di 5 layar utama tidak tertutup dan tidak perlu ruang tambahan di bawahnya.
    overlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    bar: {
      flexDirection: 'row',
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      marginBottom: Math.max(insetsBottom, spacing.sm + 4),
      paddingVertical: 6,
      paddingHorizontal: spacing.xs,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: isDark ? colors.border : '#ececf1',
      backgroundColor: isDark ? colors.surface : colors.bg,
      shadowColor: '#14141b',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.4 : 0.12,
      shadowRadius: 20,
      elevation: 8,
    },
    item: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
    // Tab aktif diberi latar lembut berbentuk pil: terlihat jelas tanpa bergantung pada warna ikon saja.
    pill: { alignItems: 'center', gap: 2, minWidth: 64, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 18 },
    pillActive: { backgroundColor: colors.accentSoft },
    label: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
    labelActive: { color: accentText, fontWeight: '700' },
  });
}
