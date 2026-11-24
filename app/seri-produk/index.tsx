import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

// Halaman "Lihat Semua" dari section Seri Produk di beranda — SEMUA kartu
// aktif (tidak dibatasi 4), tap salah satu untuk lihat gambar utuhnya
// (lihat app/seri-produk/view.tsx).
interface FeaturedProduct {
  id: number;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  content_image: string | null;
  link_url: string | null;
}

export default function SeriProdukListScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [products, setProducts] = useState<FeaturedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: FeaturedProduct[] }>('/api/featured-products/all', { skipAuth: true });
      setProducts(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data produk.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openProduct = (item: FeaturedProduct) => {
    router.push({
      pathname: '/seri-produk/view',
      params: {
        image: item.content_image ?? item.image ?? '',
        title: item.title ?? '',
        subtitle: item.subtitle ?? '',
        // SEBELUMNYA tidak dikirim sama sekali — field "Link" di Filament
        // (FeaturedProductResource) menjanjikan tombol "Lihat Selengkapnya"
        // yang sebenarnya tidak pernah dibangun di mobile, jadi link_url
        // yang diisi admin tidak pernah berefek apa pun. Lihat seri-produk/view.tsx.
        link_url: item.link_url ?? '',
      },
    } as never);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Seri Produk</Text>
        <Text style={styles.headerSubtitle}>Ketuk untuk melihat gambar selengkapnya</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.errorText}>{error}</Text>
          <PressableScale style={styles.retryBtn} onPress={() => fetchData()} accessibilityRole="button">
            <Text style={styles.retryText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={colors.accent} colors={[colors.accent]} />
          }
          renderItem={({ item, index }) => (
            <FadeInUp index={index} enabled={index < 4}>
              <PressableScale style={styles.card} onPress={() => openProduct(item)} accessibilityRole="button" accessibilityLabel={item.title ?? 'Seri produk'}>
                {item.image && (
                  <Image source={{ uri: item.image }} style={styles.cardImage} contentFit="cover" transition={300} />
                )}
                {(item.title || item.subtitle) && (
                  <View style={styles.cardInfo}>
                    <View style={styles.cardTextWrap}>
                      {item.title && <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>}
                      {item.subtitle && <Text style={styles.cardSubtitle} numberOfLines={1}>{item.subtitle}</Text>}
                    </View>
                    <View style={styles.cardArrow}>
                      <Ionicons name="arrow-forward" size={16} color={colors.accent} />
                    </View>
                  </View>
                )}
              </PressableScale>
            </FadeInUp>
          )}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <View style={styles.centerIcon}>
                <Ionicons name="images-outline" size={30} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>Belum Ada Produk</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },

    header: { paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.md, gap: 6 },
    headerTitle: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    headerSubtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 80 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    errorText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    retryBtn: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    retryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },

    listContent: { paddingHorizontal: 24, paddingBottom: 40, gap: 16 },
    card: { borderRadius: 28, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
    // Lebar penuh, 1 kartu per baris, rasio 16:9.
    cardImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bg },
    cardInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 18 },
    cardTextWrap: { flex: 1, gap: 2 },
    cardTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    cardSubtitle: { fontSize: 13, color: colors.textSecondary },
    cardArrow: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },

    emptyBox: { alignItems: 'center', padding: 32, gap: 12, marginTop: 24 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  });
}
