import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Modal,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

interface CaseStudyItem {
  id: number;
  title: string;
  short_title: string;
  image: string | null;
  vehicle: { id: number; brand: string; model: string } | null;
  film_product: { id: number; name: string } | null;
}

const FALLBACK_IMAGE = 'https://via.placeholder.com/400x300?text=Ginnva';
const SCREEN_WIDTH = Dimensions.get('window').width;

export default function CaseGalleryScreen() {
  const [cases, setCases] = useState<CaseStudyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CaseStudyItem | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiFetch<{ data: CaseStudyItem[] }>('/api/case-studies', { skipAuth: true })
      .then((res) => setCases(res.data))
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat galeri pemasangan.'
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Galeri Pemasangan" />

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
      ) : cases.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="images-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>Belum ada galeri pemasangan.</Text>
        </View>
      ) : (
        <FlatList
          data={cases}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
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
              <Ionicons name="close" size={22} color={colors.white} />
            </Pressable>
            {selected && (
              <>
                <Image
                  source={{ uri: selected.image || FALLBACK_IMAGE }}
                  style={styles.modalImage}
                  contentFit="cover"
                />
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
    backgroundColor: colors.alt,
  },
  cardTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    marginTop: spacing.xs,
  },
  cardSubtitle: {
    fontSize: fontSize.xs,
    color: colors.muted,
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
    width: SCREEN_WIDTH - spacing.lg * 2,
    backgroundColor: colors.white,
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
  modalImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.alt,
  },
  modalBody: {
    padding: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
  },
  modalSubtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
});
