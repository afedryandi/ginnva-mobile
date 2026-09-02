import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';

// Halaman awal untuk staff yang TIDAK punya akses booking sama sekali
// (mis. akun khusus staff gudang) — lihat app/auth/login.tsx untuk
// logika pengarahan ke sini. Staff yang punya akses booking tetap masuk
// ke Booking Toko dulu, dan membuka 3 menu ini lewat tombol kubus di
// header (lihat app/staff/bookings/index.tsx).
export default function InventoryHomeScreen() {
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
  // supaya tidak ada yang bisa di-tap tapi ujungnya ditolak (403) oleh
  // backend. Lihat AuthController::transform() untuk asal flag ini.
  const menuItems = [
    {
      key: 'attendance',
      icon: 'finger-print-outline' as const,
      title: 'Absensi & Izin',
      description: 'Absen masuk/keluar dan ajukan izin/cuti',
      onPress: () => router.push('/staff/attendance' as never),
      // SENGAJA selalu true (tidak dibatasi hasMenuAccess seperti item
      // lain di bawah) — absen kewajiban dasar semua staff, lihat catatan
      // di AttendanceController.
      visible: true,
    },
    {
      key: 'payroll',
      icon: 'cash-outline' as const,
      title: 'Slip Gaji',
      description: 'Lihat rincian gaji bulanan sendiri',
      onPress: () => router.push('/staff/payroll' as never),
      visible: true,
    },
    {
      key: 'quotations',
      icon: 'document-text-outline' as const,
      title: 'Lead Quotation',
      description: 'Kelola lead permintaan penawaran dari customer',
      onPress: () => router.push('/staff/quotations' as never),
      visible: staff?.has_quotation_access,
    },
    {
      key: 'inventory',
      icon: 'cube-outline' as const,
      title: 'Barang (Produk PPF/WF)',
      description: 'Scan QR untuk lihat detail & catat keluar/masuk',
      onPress: () => router.push('/staff/inventory/scan' as never),
      visible: staff?.has_ppf_wf_access,
    },
    {
      key: 'assets',
      icon: 'construct-outline' as const,
      title: 'Aset Tetap',
      description: 'Scan QR untuk lihat detail & ubah status/lokasi',
      onPress: () => router.push('/staff/assets/scan' as never),
      visible: staff?.has_asset_access,
    },
    {
      key: 'materials',
      icon: 'flask-outline' as const,
      title: 'Bahan Baku',
      description: 'Cari nama bahan & catat masuk/keluar',
      onPress: () => router.push('/staff/materials' as never),
      visible: staff?.has_material_access,
    },
    {
      key: 'consumables',
      icon: 'layers-outline' as const,
      title: 'Barang Habis Pakai',
      description: 'Cari nama/kode barang & catat masuk/keluar',
      onPress: () => router.push('/staff/consumables' as never),
      visible: staff?.has_consumable_access,
    },
    {
      key: 'memos',
      icon: 'clipboard-outline' as const,
      title: 'Memo Pengambilan/Pengembalian',
      description: 'Catat barang keluar-masuk untuk 1 instalasi sekaligus',
      onPress: () => router.push('/staff/memos' as never),
      visible: staff?.has_material_memo_access,
    },
    {
      key: 'purchase-requests',
      icon: 'cart-outline' as const,
      title: 'Permohonan Pembelian',
      description: 'Ajukan permintaan restock/aset baru & pantau statusnya',
      onPress: () => router.push('/staff/purchase-requests' as never),
      visible: staff?.has_purchase_request_access,
    },
  ].filter((item) => item.visible);

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
        <Text style={styles.headerTitle} numberOfLines={1}>Inventaris</Text>
        <Pressable onPress={handleLogout} style={styles.sideButton}>
          <Ionicons name="log-out-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.subheader}>
        <Text style={styles.subheaderText}>{staff?.name}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {menuItems.map((item) => (
          <Pressable key={item.key} style={styles.card} onPress={item.onPress}>
            <View style={styles.cardIcon}>
              <Ionicons name={item.icon} size={24} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDescription}>{item.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        ))}
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
    subheader: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm },
    subheaderText: { fontSize: fontSize.sm, color: colors.textSecondary },
    scrollContent: { padding: spacing.md, gap: spacing.sm },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardIcon: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    cardDescription: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  });
}
