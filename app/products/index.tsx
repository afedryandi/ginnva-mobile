import React, { useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Produk</Text>
        <Text style={styles.headerSubtitle}>
          Pilih kategori untuk lihat detail & spesifikasi produk
        </Text>
      </View>
      <FlatList
        data={CATEGORIES}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/products/${item.key}` as never)}
          >
            <Image source={item.image} style={styles.cardImage} contentFit="cover" />
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.82)']}
              locations={[0, 0.45, 1]}
              style={styles.cardOverlay}
            />
            {item.comingSoon && (
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonBadgeText}>Segera Hadir</Text>
              </View>
            )}
            <View style={styles.cardText}>
              <View style={styles.cardTextRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardEnTitle}>{item.enTitle}</Text>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {item.desc}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#ffffff" style={styles.cardChevron} />
              </View>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    headerTitle: {
      fontSize: fontSize.xxl,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    headerSubtitle: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginTop: spacing.xs,
    },
    listContent: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
    },
    card: {
      height: 160,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    cardImage: {
      ...StyleSheet.absoluteFillObject,
    },
    cardOverlay: {
      ...StyleSheet.absoluteFillObject,
    },
    cardText: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.md,
    },
    cardTextRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
    },
    comingSoonBadge: {
      position: 'absolute',
      top: spacing.md,
      left: spacing.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.4)',
    },
    comingSoonBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: '#ffffff',
    },
    cardEnTitle: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: 'rgba(255,255,255,0.75)',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    cardTitle: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: '#ffffff',
      marginTop: 2,
    },
    cardDesc: {
      fontSize: fontSize.xs,
      color: 'rgba(255,255,255,0.85)',
      marginTop: spacing.xs,
      lineHeight: 16,
    },
    cardChevron: {
      marginBottom: 2,
    },
  });
}
