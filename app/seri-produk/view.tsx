import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { PinchZoomImage } from '@/components/ui/PinchZoomImage';

// Gambar kartu "Seri Produk" di beranda/list cuma potongan (dipotong cover
// supaya rapi di grid) — layar ini yang menampilkan gambar ASLI utuh,
// bisa di-pinch-zoom, geser saat sudah zoom, dan double-tap untuk
// toggle zoom (lihat components/ui/PinchZoomImage.tsx).
export default function SeriProdukViewScreen() {
  const { image, title, subtitle, link_url } = useLocalSearchParams<{
    image?: string;
    title?: string;
    subtitle?: string;
    link_url?: string;
  }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // SEBELUMNYA field "Link" di Filament (FeaturedProductResource) sama
  // sekali tidak berefek apa pun di mobile — helper text-nya menjanjikan
  // tombol "Lihat Selengkapnya" yang ternyata tidak pernah dibangun.
  // Ditemukan saat audit modul Marketing > Seri Produk (Beranda).
  const handleOpenLink = async () => {
    if (!link_url) return;
    try {
      const canOpen = await Linking.canOpenURL(link_url);
      if (!canOpen) {
        Alert.alert('Tidak Bisa Membuka Link', 'Link pada kartu ini tidak valid atau tidak didukung.');
        return;
      }
      await Linking.openURL(link_url);
    } catch {
      Alert.alert('Gagal Membuka Link', 'Terjadi kesalahan saat membuka link ini.');
    }
  };

  return (
    // 'bottom' cuma ditambahkan kalau ada tombol "Lihat Selengkapnya" —
    // sebelumnya SELALU tidak ada, jadi tombolnya ketiban navigation bar
    // Android (gesture nav/tombol fisik) karena area aman bawah tidak
    // dihitung sama sekali. Tanpa tombol, area gambar biar tetap penuh
    // sampai bawah layar (tidak perlu inset kosong).
    <SafeAreaView style={styles.container} edges={link_url ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}>
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

      {!!link_url && (
        <View style={styles.footer}>
          <Pressable style={styles.linkButton} onPress={handleOpenLink}>
            <Text style={styles.linkButtonText}>Lihat Selengkapnya</Text>
            <Ionicons name="arrow-forward" size={18} color="#ffffff" />
          </Pressable>
        </View>
      )}
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
    footer: {
      padding: spacing.md, backgroundColor: colors.bg,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    linkButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accent, borderRadius: radius.pill, height: 50,
    },
    linkButtonText: { color: '#ffffff', fontSize: fontSize.base, fontWeight: '700' },
  });
}
