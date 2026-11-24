import React, { useMemo } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

// Sumber konten sama persis dengan 4 halaman /product/* di ginnva-web,
// supaya copywriting konsisten antara web dan mobile. Foto sama dengan
// hero image di halaman detail produk (app/products/[category].tsx).
const CATEGORIES = [
  {
    key: 'kaca-film-mobil',
    title: 'Kaca Film Mobil',
    enTitle: 'Car Window Film',
    desc: 'Penolakan panas inframerah optimal & perlindungan UV hingga 99%.',
    image: require('@/assets/images/car-window-film.webp'),
    comingSoon: false,
  },
  {
    key: 'film-pelindung-cat',
    title: 'Film Pelindung Cat',
    enTitle: 'Paint Protection Film',
    desc: 'Lapisan TPU Generasi 3 self-healing yang melindungi cat asli dari goresan.',
    image: require('@/assets/images/paint-protection-film.webp'),
    comingSoon: false,
  },
  {
    key: 'film-pengubah-warna',
    title: 'Film Pengubah Warna',
    enTitle: 'Color Change Film',
    desc: 'Ubah tampilan kendaraan dengan berbagai pilihan warna tanpa cat ulang.',
    image: require('@/assets/images/color-change-film.webp'),
    // Sama dengan `comingSoon: true` di PRODUCT_DETAILS
    // (app/products/[category].tsx) — belum dijual resmi di Indonesia.
    comingSoon: true,
  },
  {
    key: 'film-kaca-bangunan',
    title: 'Film Kaca Bangunan',
    enTitle: 'Architectural Film',
    desc: 'Solusi efisiensi energi untuk kaca jendela gedung & hunian.',
    image: require('@/assets/images/architectural-window-film.webp'),
    comingSoon: true,
  },
];

export default function ProductCategoriesScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Produk</Text>
        <Text style={styles.headerSubtitle}>Pilih kategori untuk lihat detail dan spesifikasi produk</Text>
      </View>

      <FlatList
        data={CATEGORIES}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <FadeInUp index={index} enabled={index < 4}>
            <PressableScale style={styles.card} onPress={() => router.push(`/products/${item.key}` as never)} accessibilityRole="button" accessibilityLabel={item.title}>
              <Image source={item.image} style={styles.cardImage} contentFit="cover" />
              <LinearGradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.78)']}
                locations={[0.15, 0.55, 1]}
                style={styles.cardOverlay}
              />
              {item.comingSoon && (
                <View style={styles.comingSoonBadge}>
                  <Ionicons name="time-outline" size={13} color="#ffffff" />
                  <Text style={styles.comingSoonBadgeText}>Segera Hadir</Text>
                </View>
              )}
              <View style={styles.cardText}>
                <View style={styles.cardTextBody}>
                  <Text style={styles.cardEnTitle}>{item.enTitle}</Text>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardDesc} numberOfLines={2}>{item.desc}</Text>
                </View>
                <View style={styles.cardArrow}>
                  <Ionicons name="arrow-forward" size={18} color={colors.accent} />
                </View>
              </View>
            </PressableScale>
          </FadeInUp>
        )}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    header: { paddingHorizontal: 24, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 6 },
    headerTitle: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    headerSubtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },

    // Ruang bawah menyisakan tempat untuk bilah tab.
    listContent: { paddingHorizontal: 24, paddingBottom: 120, gap: 16 },

    card: { height: 200, borderRadius: 28, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
    cardImage: { ...StyleSheet.absoluteFillObject },
    cardOverlay: { ...StyleSheet.absoluteFillObject },
    cardText: { position: 'absolute', left: 20, right: 16, bottom: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
    cardTextBody: { flex: 1, gap: 2 },
    cardArrow: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },

    comingSoonBadge: { position: 'absolute', top: 16, left: 16, flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.5)' },
    comingSoonBadgeText: { fontSize: 12, fontWeight: '800', color: '#ffffff' },

    cardEnTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' },
    cardTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5, color: '#ffffff' },
    cardDesc: { fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.88)' },
  });
}
