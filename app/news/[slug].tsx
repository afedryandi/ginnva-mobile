import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

interface NewsDetail {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string | null;
  image: string | null;
  published_at: string | null;
}

const FALLBACK_IMAGE = 'https://via.placeholder.com/600x300?text=Ginnva+News';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function NewsDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [news, setNews] = useState<NewsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    apiFetch<{ data: NewsDetail }>(`/api/news/${slug}`, { skipAuth: true })
      .then((res) => setNews(res.data))
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat artikel.'
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [slug]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Berita & Info" />

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : news ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Hero image */}
          <Image
            source={{ uri: news.image || FALLBACK_IMAGE }}
            style={styles.heroImage}
            contentFit="cover"
          />

          <View style={styles.body}>
            {/* Meta */}
            {news.published_at && (
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={13} color={colors.mutedLight} />
                <Text style={styles.metaText}>{formatDate(news.published_at)}</Text>
              </View>
            )}

            {/* Title */}
            <Text style={styles.title}>{news.title}</Text>

            {/* Excerpt (jika ada, tampilkan sebagai lead paragraph) */}
            {news.excerpt && (
              <Text style={styles.excerpt}>{news.excerpt}</Text>
            )}

            {/* Divider */}
            <View style={styles.divider} />

            {/* Content — plain text (API diharapkan mengirim teks bersih,
                bukan HTML. Kalau API berubah mengirim HTML, ganti dengan
                WebView atau react-native-render-html di sini.) */}
            {news.content ? (
              <Text style={styles.content}>{news.content}</Text>
            ) : (
              <Text style={styles.noContent}>Konten artikel tidak tersedia.</Text>
            )}
          </View>
        </ScrollView>
      ) : null}
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
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
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
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  heroImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.alt,
  },
  body: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: 30,
  },
  excerpt: {
    fontSize: fontSize.base,
    color: colors.muted,
    lineHeight: 24,
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: spacing.xs,
  },
  content: {
    fontSize: fontSize.base,
    color: colors.ink,
    lineHeight: 26,
  },
  noContent: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    fontStyle: 'italic',
  },
});