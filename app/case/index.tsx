import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Modal,
  useWindowDimensions,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { PinchZoomImage } from '@/components/ui/PinchZoomImage';

interface CaseStudyItem {
  id: number;
  title: string;
  short_title: string;
  image: string | null;
  vehicle: { id: number; brand: string; model: string } | null;
  film_product: { id: number; name: string } | null;
}

// Sama gaya dengan FALLBACK_IMAGE di app/(tabs)/index.tsx (placehold.co,
// warna brand) — bukan via.placeholder.com yang beda gaya & pernah tidak
// stabil/down di masa lalu.
const FALLBACK_IMAGE = 'https://placehold.co/400x300/161226/e8c078?text=Ginnva';

export default function CaseGalleryScreen() {
  const { theme, colors } = useAppTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const styles = useMemo(
    () => createStyles(colors, screenWidth, screenHeight),
    [colors, screenWidth, screenHeight]
  );

  const [cases, setCases] = useState<CaseStudyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CaseStudyItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: CaseStudyItem[] }>('/api/case-studies', { skipAuth: true })
      .then((res) => setCases(res.data))
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat galeri pemasangan.'
        );
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
        <Text style={styles.headerTitle} numberOfLines={1}>Galeri Pemasangan</Text>
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
          <Pressable style={styles.retryButton} onPress={() => load()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : cases.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="images-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>Belum ada galeri pemasangan.</Text>
        </View>
      ) : (
        <FlatList
          data={cases}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <Image
                source={{ uri: item.image || FALLBACK_IMAGE }}
                style={styles.image}
                contentFit="cover"
              />
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.short_title}
              </Text>
              {(item.vehicle || item.film_product) && (
                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  {[
                    item.vehicle ? `${item.vehicle.brand} ${item.vehicle.model}` : null,
                    item.film_product?.name,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              )}
            </Pressable>
          )}
        />
      )}

      {/* ===== Lightbox detail ===== */}
      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Pressable style={styles.modalClose} onPress={() => setSelected(null)}>
              <Ionicons name="close" size={22} color="#ffffff" />
            </Pressable>
            {selected && (
              <>
                {/* Bisa pinch-zoom & geser — galeri showcase yang tujuannya
                    justru menonjolkan detail hasil pemasangan (kerapian,
                    kejernihan tint, dll), sama seperti komponen yang sudah
                    dipakai di Seri Produk (app/seri-produk/view.tsx). */}
                <View style={styles.modalImageWrap}>
                  <PinchZoomImage uri={selected.image ?? ''} fallback={FALLBACK_IMAGE} />
                </View>
                <View style={styles.modalBody}>
                  <Text style={styles.modalTitle}>{selected.title}</Text>
                  {(selected.vehicle || selected.film_product) && (
                    <Text style={styles.modalSubtitle}>
                      {[
                        selected.vehicle
                          ? `${selected.vehicle.brand} ${selected.vehicle.model}`
                          : null,
                        selected.film_product?.name,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  )}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, screenWidth: number, screenHeight: number) {
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
  listContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  row: {
    gap: spacing.md,
  },
  card: {
    flex: 1,
  },
  image: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  cardSubtitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: Math.min(screenWidth - spacing.lg * 2, 480),
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  modalClose: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 1,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalImageWrap: {
    width: '100%',
    // Clamp: SCREEN_HEIGHT*0.5 saja jadi terlalu pendek di landscape
    // (tinggi layar kecil), jadi dibatasi minimum & juga relatif ke lebar.
    height: Math.max(220, Math.min(screenHeight * 0.5, screenWidth * 0.6)),
    backgroundColor: colors.bg,
  },
  modalBody: {
    padding: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  });
}
