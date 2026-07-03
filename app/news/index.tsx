import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors, fontSize, spacing, radius, shadow } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { SkeletonNewsCard } from '@/components/ui/Skeleton';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

interface NewsItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  image: string | null;
  published_at: string | null;
}

const FALLBACK_IMAGE = 'https://via.placeholder.com/600x300?text=Ginnva+News';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function NewsListScreen() {
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
      <ScreenHeader title="Berita & Info" />

      {loading ? (
        <View style={styles.skeletonList}>
          {[1, 2, 3].map((i) => <SkeletonNewsCard key={i} style={styles.skeletonItem} />)}
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => { hapticLight(); load(); }}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : news.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="newspaper-outline" size={40} color={colors.mutedLight} />
          <Text style={styles.centerStateTitle}>Segera Hadir</Text>
          <Text style={styles.centerStateText}>
            Berita dan informasi terbaru Ginnva Shield Indonesia akan segera tersedia di sini.
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
                source={{ uri: item.image || FALLBACK_IMAGE }}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
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
    color: colors.ink,
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.muted,
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
    color: colors.white,
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
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.alt,
  },
  cardBody: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  date: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 22,
  },
  excerpt: {
    fontSize: fontSize.sm,
    color: colors.muted,
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
  skeletonList: {
    padding: 16,
    gap: 16,
  },
  skeletonItem: {
    marginBottom: 4,
  },
});