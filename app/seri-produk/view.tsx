import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { PinchZoomImage } from '@/components/ui/PinchZoomImage';

// Gambar kartu "Seri Produk" di beranda/list cuma potongan (dipotong cover
// supaya rapi di grid) — layar ini yang menampilkan gambar ASLI utuh,
// bisa di-pinch-zoom, geser saat sudah zoom, dan double-tap untuk
// toggle zoom (lihat components/ui/PinchZoomImage.tsx).
export default function SeriProdukViewScreen() {
  const { image, title, subtitle } = useLocalSearchParams<{
    image?: string;
    title?: string;
    subtitle?: string;
  }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Seri Produk'}</Text>
        <View style={styles.sideButton} />
      </View>

      {!!subtitle && (
        <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
      )}

      <View style={styles.imageWrap}>
        {image && <PinchZoomImage uri={image} />}
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    subtitle: {
      fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center',
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs,
      backgroundColor: colors.bg,
    },
    imageWrap: { flex: 1, backgroundColor: colors.bg },
  });
}
