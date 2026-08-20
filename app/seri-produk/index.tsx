import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
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
      },
    } as never);
  };

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
        <Text style={styles.headerTitle} numberOfLines={1}>Seri Produk</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchData()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchData(true)} tintColor={colors.accent} />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => openProduct(item)}>
              {item.image && (
                <Image source={{ uri: item.image }} style={styles.cardImage} contentFit="cover" />
              )}
              {(item.title || item.subtitle) && (
                <View style={styles.cardInfo}>
                  {item.title && <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>}
                  {item.subtitle && <Text style={styles.cardSubtitle} numberOfLines={1}>{item.subtitle}</Text>}
                </View>
              )}
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="images-outline" size={36} color={colors.textMuted} />
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
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.pill },
    retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },

    listContent: { padding: spacing.md, gap: spacing.md },
    card: {
      width: '100%', borderRadius: radius.lg, overflow: 'hidden',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    // Lebar penuh, 1 kartu per baris — rasio 16:9 supaya lebih proporsional
    // dibanding persegi (1:1) yang dipakai sebelumnya untuk grid 2 kolom.
    cardImage: { width: '100%', aspectRatio: 16 / 9 },
    cardInfo: { padding: spacing.sm, gap: 2 },
    cardTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    cardSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary },

    emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, marginTop: spacing.lg },
    emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  });
}
