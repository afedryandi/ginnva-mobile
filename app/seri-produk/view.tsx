import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
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
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Seri Produk'}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>}
        </View>
      </View>

      <View style={styles.imageWrap}>
        {image && <PinchZoomImage uri={image} />}
      </View>

      {!!link_url && (
        <View style={styles.footer}>
          <PressableScale style={styles.linkButton} onPress={handleOpenLink} accessibilityRole="button">
            <Text style={styles.linkButtonText}>Lihat Selengkapnya</Text>
            <Ionicons name="arrow-forward" size={18} color="#ffffff" />
          </PressableScale>
        </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    headerText: { flex: 1, gap: 2 },
    headerTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    subtitle: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    imageWrap: { flex: 1, backgroundColor: colors.bg },
    footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12, backgroundColor: colors.bg },
    linkButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 56, borderRadius: 28, backgroundColor: colors.accent },
    linkButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  });
}
