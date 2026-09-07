import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  direksi: 'Direksi',
  store_manager: 'Store Manager',
  installer: 'Installer',
};

function formatRoleLabel(role?: string): string | null {
  if (!role) return null;
  return ROLE_LABEL[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Halaman awal SATU-SATUNYA untuk semua akun staff, apa pun kombinasi
// aksesnya — SEBELUMNYA menu-menu ini tercerai-berai di 2 tempat (baris
// ikon padat di pojok kiri header Booking Toko, vs daftar list di
// InventoryHomeScreen buat staff tanpa akses booking), keduanya diganti
// jadi 1 grid kotak di tengah layar di sini (diminta user 2026-09-07).
// Booking sendiri sekarang ikut jadi 1 kotak menu (bukan lagi konten
// implisit halaman pertama) — lihat app/auth/login.tsx yang sekarang
// SELALU mengarahkan ke '/staff' terlepas dari kombinasi akses staff itu.
export default function StaffHomeScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { staff, logout } = useStaffAuth();

  const handleLogout = () => {
    Alert.alert('Keluar', 'Anda yakin ingin keluar dari akun staff?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Keluar', style: 'destructive', onPress: () => logout().then(() => router.replace('/auth/login' as never)) },
    ]);
  };

  // Cuma tampilkan menu yang akun ini benar-benar punya aksesnya —
  // supaya tidak ada kotak yang bisa di-tap tapi ujungnya ditolak (403)
  // oleh backend. Lihat AuthController::transform() untuk asal flag ini.
  const menuItems = [
    {
      key: 'bookings',
      icon: 'calendar-outline' as const,
      title: 'Booking Toko',
      onPress: () => router.push('/staff/bookings' as never),
      visible: staff?.has_booking_access,
    },
    {
      key: 'attendance',
      icon: 'finger-print-outline' as const,
      title: 'Absensi & Izin',
      // SENGAJA selalu true (tidak dibatasi hasMenuAccess seperti kotak
      // lain) — absen kewajiban dasar semua staff, lihat catatan di
      // AttendanceController.
      visible: true,
      onPress: () => router.push('/staff/attendance' as never),
    },
    {
      key: 'payroll',
      icon: 'cash-outline' as const,
      title: 'Slip Gaji',
      visible: true,
      onPress: () => router.push('/staff/payroll' as never),
    },
    {
      key: 'quotations',
      icon: 'document-text-outline' as const,
      title: 'Lead Quotation',
      onPress: () => router.push('/staff/quotations' as never),
      visible: staff?.has_quotation_access,
    },
    {
      key: 'inventory',
      icon: 'cube-outline' as const,
      title: 'Produk PPF/WF',
      onPress: () => router.push('/staff/inventory/scan' as never),
      visible: staff?.has_ppf_wf_access,
    },
    {
      key: 'assets',
      icon: 'construct-outline' as const,
      title: 'Aset Tetap',
      onPress: () => router.push('/staff/assets/scan' as never),
      visible: staff?.has_asset_access,
    },
    {
      key: 'materials',
      icon: 'flask-outline' as const,
      title: 'Bahan Baku',
      onPress: () => router.push('/staff/materials' as never),
      visible: staff?.has_material_access,
    },
    {
      key: 'consumables',
      icon: 'layers-outline' as const,
      title: 'Barang Habis Pakai',
      onPress: () => router.push('/staff/consumables' as never),
      visible: staff?.has_consumable_access,
    },
    {
      key: 'memos',
      icon: 'clipboard-outline' as const,
      title: 'Memo Barang',
      onPress: () => router.push('/staff/memos' as never),
      visible: staff?.has_material_memo_access,
    },
    {
      key: 'purchase-requests',
      icon: 'cart-outline' as const,
      title: 'Permohonan Pembelian',
      onPress: () => router.push('/staff/purchase-requests' as never),
      visible: staff?.has_purchase_request_access,
    },
  ].filter((item) => item.visible);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <View style={styles.sideButton} />
        <Text style={styles.headerTitle} numberOfLines={1}>Ginnva Staff</Text>
        <Pressable onPress={handleLogout} style={styles.sideButton} accessibilityLabel="Keluar">
          <Ionicons name="log-out-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.subheader}>
        <Text style={styles.subheaderName}>{staff?.name}</Text>
        <Text style={styles.subheaderRole}>{formatRoleLabel(staff?.role)}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.grid}>
          {menuItems.map((item) => (
            <Pressable key={item.key} style={styles.box} onPress={item.onPress}>
              <View style={styles.boxIconWrap}>
                <Ionicons name={item.icon} size={26} color={colors.accent} />
              </View>
              <Text style={styles.boxTitle} numberOfLines={2}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
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
    subheader: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, alignItems: 'center' },
    subheaderName: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    subheaderRole: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    scrollContent: {
      flexGrow: 1,
      padding: spacing.lg,
      paddingTop: spacing.md,
    },
    // Grid nempel ke atas (bukan lagi justifyContent:'center' vertikal —
    // dulu bikin banyak ruang kosong di atas begitu menu cuma sedikit
    // baris) — 3 kolom, kotak dibiarkan tumbuh tingginya sesuai isi
    // (BUKAN aspectRatio:1 kaku, yang bikin ikon+judul 2 baris meluber
    // keluar kotak untuk menu berjudul panjang) — diperbaiki 2026-09-07.
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    box: {
      width: '28%',
      minHeight: 96,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.sm,
    },
    boxIconWrap: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    boxTitle: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      lineHeight: 15,
    },
  });
}
