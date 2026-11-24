import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import StockScanner from '@/components/stock/StockScanner';
import { spacing } from '@/constants/theme';

/**
 * Scan label QR Bahan Baku / Barang Habis Pakai (dicetak dari panel: pilih bahan → Cetak Label QR). Dengan ?mode=count, hasil scan
 * ditambahkan ke daftar hitung Opname Massal alih-alih membuka detail, jadi gudang bisa menghitung rak demi rak tanpa mengetik nama.
 * Pemindainya sendiri ada di components/stock/StockScanner.tsx (dipakai juga oleh tab Scan QR di halaman Bahan Baku).
 */
export default function StockScanScreen() {
  const params = useLocalSearchParams<{ mode?: string; type?: string }>();
  const countMode = params.mode === 'count';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color="#ffffff" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{countMode ? 'Scan untuk Hitung' : 'Scan Stok'}</Text>
          <Text style={styles.subtitle}>{countMode ? 'Tiap scan menambah bahan ke daftar hitung' : 'Label bahan baku'}</Text>
        </View>
      </View>

      <StockScanner countMode={countMode} type={params.type} />
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
});
