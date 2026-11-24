import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import StockScanner from '@/components/stock/StockScanner';
import { spacing } from '@/constants/theme';
import { useStaffAuth } from '@/lib/staff-auth-context';

/**
 * Scan QR umum untuk gudang (2026-11-13): satu pemindai untuk QR Produk PPF/WF (berawalan INV-) dan label Bahan Baku. Dibuka dari tombol
 * tengah di navigasi bawah, yang hanya tampil bagi akun yang mengurus gudang. Hasilnya langsung membuka detail barang atau bahannya.
 * Pemindainya ada di components/stock/StockScanner.tsx (dipakai juga oleh halaman Produk PPF/WF dan Bahan Baku).
 */
export default function StaffGeneralScanScreen() {
  const { staff } = useStaffAuth();
  const allowed = !!staff && (staff.has_ppf_wf_access || staff.has_material_access);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/staff' as never))} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color="#ffffff" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>Scan QR</Text>
          <Text style={styles.subtitle}>Produk PPF/WF dan bahan baku</Text>
        </View>
      </View>

      {allowed ? (
        <StockScanner allowInventory />
      ) : (
        <View style={styles.denied}>
          <View style={styles.deniedIcon}>
            <Ionicons name="lock-closed-outline" size={32} color="#ffffff" />
          </View>
          <Text style={styles.deniedText}>Akun ini belum diberi akses ke gudang. Minta admin membuka menu Produk PPF/WF atau Bahan Baku di Hak Akses.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b10' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
  roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: '#ffffff' },
  subtitle: { fontSize: 12.5, fontWeight: '500', color: 'rgba(255,255,255,0.65)' },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: 60 },
  deniedIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  deniedText: { fontSize: 14, color: '#ffffff', textAlign: 'center', lineHeight: 22 },
});
