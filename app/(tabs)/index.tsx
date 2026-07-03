import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch } from '@/lib/api';

const PRODUCT_CATEGORIES = [
  { key: 'kaca-film-mobil', label: 'Kaca Film Mobil' },
  { key: 'film-pelindung-cat', label: 'Pelindung Cat (PPF)' },
  { key: 'film-pengubah-warna', label: 'Color Change' },
  { key: 'film-kaca-bangunan', label: 'Film Kaca Bangunan' },
];

// 5 menu utama dari referensi mini app China (质保查询/门店查询/车型报价/
// 品牌介绍). "门店系统" SENGAJA tidak diikutkan — setelah dicek lewat
// screenshot, itu cuma menu cari toko yang sama dengan "门店查询",
// bukan portal terpisah, jadi tidak perlu didupliksi di sini.
const QUICK_MENU = [
  { key: 'warranty', label: 'Cek Garansi', icon: 'shield-checkmark', route: '/warranty/check' },
  { key: 'stores', label: 'Cari Toko', icon: 'storefront', route: '/(tabs)/stores' },
  { key: 'quotation', label: 'Ajukan Penawaran', icon: 'document-text', route: '/quotation' },
  { key: 'brand', label: 'Tentang Brand', icon: 'pricetag', route: '/brand' },
];

interface CaseStudyItem {
  id: number;
  title: string;
  short_title: string;
  image: string | null;
}

interface NewsItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  image: string | null;
  published_at: string | null;
}

const FALLBACK_IMAGE = 'https://via.placeholder.com/400x250?text=Ginnva';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function HomeScreen() {
  const [cases, setCases] = useState<CaseStudyItem[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);

  useEffect(() => {
    apiFetch<{ data: CaseStudyItem[] }>('/api/case-studies')
      .then((res) => setCases(res.data.slice(0, 6)))
      .catch(() => {
        // Dibiarkan kosong kalau gagal — halaman tetap bisa dipakai
        // tanpa galeri, daripada menampilkan error blocking.
      });

    apiFetch<{ data: NewsItem[] }>('/api/news', { skipAuth: true })
      .then((res) => setNews(res.data.slice(0, 3)))
      .catch(() => {
        // Sama — biarkan kosong kalau gagal, tidak blocking.
      });
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ===== Header brand ===== */}
        <View style={styles.brandHeader}>
          <Text style={styles.brandName}>Ginnva</Text>
          <Text style={styles.brandTagline}>Shield Indonesia</Text>
        </View>

        {/* ===== Kategori produk ===== */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
        >
          {PRODUCT_CATEGORIES.map((cat) => (
            <Pressable
              key={cat.key}
              style={styles.categoryChip}
              onPress={() => router.push(`/products/${cat.key}` as never)}
            >
              <Text style={styles.categoryChipText}>{cat.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* ===== Menu utama (5 ikon) ===== */}
        <View style={styles.quickMenuGrid}>
          {QUICK_MENU.map((menu) => (
            <Pressable
              key={menu.key}
              style={styles.quickMenuItem}
              onPress={() => router.push(menu.route as never)}
            >
              <View style={styles.quickMenuIconWrap}>
                <Ionicons name={menu.icon as never} size={26} color={colors.accent} />
              </View>
              <Text style={styles.quickMenuLabel}>{menu.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* ===== Galeri Pemasangan (Case Populer) ===== */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Galeri Pemasangan</Text>
          <Pressable onPress={() => router.push('/case' as never)}>
            <Text style={styles.sectionMore}>Lihat Semua</Text>
          </Pressable>
        </View>

        {cases.length === 0 ? (
          <View style={styles.comingSoonBox}>
            <Ionicons name="images-outline" size={28} color={colors.mutedLight} />
            <Text style={styles.comingSoonTitle}>Segera Hadir</Text>
            <Text style={styles.comingSoonText}>Galeri pemasangan akan segera tersedia.</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.caseRow}
          >
            {cases.map((item) => (
              <Pressable key={item.id} style={styles.caseCard} onPress={() => router.push('/case' as never)}>
                <Image
                  source={{ uri: item.image || FALLBACK_IMAGE }}
                  style={styles.caseImage}
                  contentFit="cover"
                />
                <Text style={styles.caseTitle} numberOfLines={2}>
                  {item.short_title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* ===== Berita Terbaru ===== */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Berita Terbaru</Text>
          <Pressable onPress={() => router.push('/news' as never)}>
            <Text style={styles.sectionMore}>Lihat Semua</Text>
          </Pressable>
        </View>

        {news.length === 0 ? (
          <View style={styles.comingSoonBox}>
            <Ionicons name="newspaper-outline" size={28} color={colors.mutedLight} />
            <Text style={styles.comingSoonTitle}>Segera Hadir</Text>
            <Text style={styles.comingSoonText}>Berita dan info terbaru akan muncul di sini.</Text>
          </View>
        ) : (
          <View style={styles.newsList}>
            {news.map((item) => (
              <Pressable
                key={item.id}
                style={styles.newsCard}
                onPress={() => router.push(`/news/${item.slug}` as never)}
              >
                <Image
                  source={{ uri: item.image || FALLBACK_IMAGE }}
                  style={styles.newsImage}
                  contentFit="cover"
                />
                <View style={styles.newsBody}>
                  {item.published_at && (
                    <Text style={styles.newsDate}>{formatDate(item.published_at)}</Text>
                  )}
                  <Text style={styles.newsTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  brandName: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.accent,
  },
  brandTagline: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  categoryRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.alt,
    borderRadius: radius.pill,
  },
  categoryChipText: {
    fontSize: fontSize.sm,
    color: colors.ink,
    fontWeight: '600',
  },
  quickMenuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  quickMenuItem: {
    width: '25%',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  quickMenuIconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.alt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickMenuLabel: {
    fontSize: fontSize.xs,
    color: colors.ink,
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.ink,
  },
  sectionMore: {
    fontSize: fontSize.sm,
    color: colors.accent,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    paddingHorizontal: spacing.md,
  },
  caseRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  caseCard: {
    width: 180,
  },
  caseImage: {
    width: 180,
    height: 120,
    borderRadius: radius.md,
    backgroundColor: colors.alt,
    marginBottom: spacing.xs,
  },
  caseTitle: {
    fontSize: fontSize.sm,
    color: colors.ink,
    fontWeight: '600',
  },
  comingSoonBox: {
    marginHorizontal: spacing.md,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.alt,
  },
  comingSoonTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
  },
  comingSoonText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
  },
  newsList: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  newsCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  newsImage: {
    width: 90,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.alt,
    flexShrink: 0,
  },
  newsBody: {
    flex: 1,
    gap: 3,
    justifyContent: 'center',
  },
  newsDate: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
  },
  newsTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 20,
  },
});