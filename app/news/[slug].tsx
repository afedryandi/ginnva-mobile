import React, { useEffect, useMemo, useState } from 'react';
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
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import RenderHtml from 'react-native-render-html';
import { useWindowDimensions } from 'react-native';
import HtmlImageRenderer from '@/components/ui/HtmlImageRenderer';

const htmlRenderers = { img: HtmlImageRenderer };

interface NewsDetail {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string | null;
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

export default function NewsDetailScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
          <Pressable style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : news ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Hero image */}
          <Image
            source={{ uri: news.cover_image || FALLBACK_IMAGE }}
            style={styles.heroImage}
            contentFit="cover"
          />

          <View style={styles.body}>
            {/* Meta */}
            {news.published_at && (
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
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

            {news.content ? (
              <RenderHtml
                contentWidth={windowWidth - 32}
                source={{ html: news.content }}
                renderers={htmlRenderers}
                tagsStyles={{
                  p: { marginBottom: 12, lineHeight: 24, color: colors.textPrimary, fontSize: 15 },
                  h1: { fontSize: 20, fontWeight: '700', marginBottom: 8, color: colors.textPrimary },
                  h2: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: colors.textPrimary },
                  h3: { fontSize: 16, fontWeight: '700', marginBottom: 6, color: colors.textPrimary },
                  li: { marginBottom: 4, lineHeight: 22, color: colors.textPrimary },
                  a: { color: colors.accent },
                  img: { borderRadius: 8, marginVertical: 8 },
                }}
                baseStyle={{ fontSize: 15, lineHeight: 24, color: colors.textPrimary }}
              />
            ) : (
              <Text style={styles.noContent}>Konten artikel tidak tersedia.</Text>
            )}
          </View>
        </ScrollView>
      ) : null}
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
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
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
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  heroImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface,
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
    color: colors.textMuted,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 30,
  },
  excerpt: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    lineHeight: 24,
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  content: {
    fontSize: fontSize.base,
    color: colors.textPrimary,
    lineHeight: 26,
  },
  noContent: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  });
}
