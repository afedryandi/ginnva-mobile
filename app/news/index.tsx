import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

interface NewsItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image: string | null;
  source_url: string | null;
  published_at: string | null;
}

// Sama gaya dengan FALLBACK_IMAGE di app/(tabs)/index.tsx (placehold.co,
// warna brand) — bukan via.placeholder.com yang beda gaya & pernah tidak
// stabil/down di masa lalu.
const FALLBACK_IMAGE = 'https://placehold.co/600x300/161226/e8c078?text=Ginnva+News';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function NewsListScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: NewsItem[] }>('/api/news', { skipAuth: true })
      .then((res) => {
        setNews(res.data);
        if (isRefresh) hapticSuccess();
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat berita.'
        );
        if (isRefresh) hapticError();
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Berita & Info</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => { hapticLight(); load(); }}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : news.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="newspaper-outline" size={40} color={colors.textMuted} />
          <Text style={styles.centerStateTitle}>Segera Hadir</Text>
          <Text style={styles.centerStateText}>
            Berita dan informasi terbaru Ginnva House akan segera tersedia di sini.
          </Text>
        </View>
      ) : (
        <FlatList
          data={news}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/news/${item.slug}` as never)}
            >
              <Image
                source={{ uri: item.cover_image || FALLBACK_IMAGE }}
                style={styles.image}
                contentFit="cover"
              />
              <View style={styles.cardBody}>
                {item.published_at && (
                  <Text style={styles.date}>{formatDate(item.published_at)}</Text>
                )}
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.excerpt && (
                  <Text style={styles.excerpt} numberOfLines={2}>
                    {item.excerpt}
                  </Text>
                )}
                <View style={styles.readMore}>
                  <Text style={styles.readMoreText}>Baca Selengkapnya</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.accent} />
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centerStateTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  listContent: {
    padding: spacing.md,
  },
  separator: {
    height: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface,
  },
  cardBody: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  date: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 22,
  },
  excerpt: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.xs,
  },
  readMoreText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
  },
  });
}
