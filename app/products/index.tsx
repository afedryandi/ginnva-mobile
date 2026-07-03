import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, radius, shadow } from '@/constants/theme';

// Sumber konten sama persis dengan 4 halaman /product/* di ginnva-web,
// supaya copywriting konsisten antara web dan mobile.
const CATEGORIES = [
  {
    key: 'kaca-film-mobil',
    title: 'Film Kaca Mobil',
    enTitle: 'Car Window Film',
    desc: 'Penolakan panas infra merah optimal & perlindungan UV hingga 99%.',
    icon: 'car-sport-outline' as const,
  },
  {
    key: 'film-pelindung-cat',
    title: 'Paint Protection Film (PPF)',
    enTitle: 'Paint Protection Film',
    desc: 'Lapisan TPU self-healing yang melindungi cat asli dari goresan.',
    icon: 'shield-half-outline' as const,
  },
  {
    key: 'film-pengubah-warna',
    title: 'Film Pengubah Warna',
    enTitle: 'Color Changing Film',
    desc: 'Ubah estetika mobil dengan warna eksklusif tanpa cat ulang.',
    icon: 'color-palette-outline' as const,
  },
  {
    key: 'film-kaca-bangunan',
    title: 'Film Kaca Bangunan',
    enTitle: 'Architectural Window Film',
    desc: 'Solusi efisiensi energi untuk kaca jendela gedung & hunian.',
    icon: 'business-outline' as const,
  },
];

export default function ProductCategoriesScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={28} color={colors.accent} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardEnTitle}>{item.enTitle}</Text>
              <Text style={styles.cardDesc} numberOfLines={2}>
                {item.desc}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedLight} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.ink,
  },
  headerSubtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadow.card,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.alt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
  },
  cardEnTitle: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    marginTop: 1,
  },
  cardDesc: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
});
