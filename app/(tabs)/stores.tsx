import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  StyleSheet,
  Linking,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

interface StoreItem {
  id: number;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  opening_hours_lines: string[];
  latitude: number | null;
  longitude: number | null;
  maps_url: string | null;
}

function openMaps(store: StoreItem) {
  // Kalau admin sudah tempel link Google Maps asli di Filament, buka itu
  // apa adanya (paling akurat — persis lokasi yang dipilih admin). Fallback
  // ke URL pencarian generik dari lat/lng atau nama+alamat kalau belum ada.
  if (store.maps_url) {
    Linking.openURL(store.maps_url);
    return;
  }

  const query =
    store.latitude && store.longitude
      ? `${store.latitude},${store.longitude}`
      : encodeURIComponent(`${store.name}, ${store.address}`);
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
}

function callStore(phone: string) {
  Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, '')}`);
}

export default function StoresScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadStores = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: StoreItem[] }>('/api/stores', { skipAuth: true })
      .then((res) => setStores(res.data))
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal memuat daftar toko. Periksa koneksi internet Anda.'
        );
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    loadStores();
  }, []);

  // Filter dilakukan di sisi client terhadap hasil yang sudah dimuat,
  // supaya pencarian terasa instan tanpa nge-spam request tiap ketikan.
  // (Endpoint backend juga mendukung ?city= kalau nanti perlu dipisah
  // jadi server-side search untuk dataset toko yang besar.)
  const filteredStores = useMemo(() => {
    if (!search.trim()) return stores;
    const q = search.trim().toLowerCase();
    return stores.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q)
    );
  }, [stores, search]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cari Toko</Text>
        <Text style={styles.headerSubtitle}>
          Temukan dealer & bengkel resmi Ginnva terdekat
        </Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nama toko atau kota..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => loadStores()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : filteredStores.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="storefront-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>Tidak ada toko yang cocok.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredStores}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadStores(true)} tintColor={colors.accent} colors={[colors.accent]} />
          }
          renderItem={({ item }) => (
            <View style={styles.storeCard}>
              <Text style={styles.storeName}>{item.name}</Text>
              <View style={styles.cityBadge}>
                <Text style={styles.cityBadgeText}>{item.city}</Text>
              </View>

              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.infoText}>{item.address}</Text>
              </View>

              {item.opening_hours_lines?.length > 0 && (
                <View style={styles.infoRow}>
                  <Ionicons name="time-outline" size={16} color={colors.textSecondary} style={{ marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    {item.opening_hours_lines.map((line, i) => (
                      <Text key={i} style={styles.infoText}>{line}</Text>
                    ))}
                  </View>
                </View>
              )}

              {item.phone && (
                <View style={styles.infoRow}>
                  <Ionicons name="call-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.infoText}>{item.phone}</Text>
                </View>
              )}

              <View style={styles.actionRow}>
                <View style={styles.secondaryActions}>
                  <Pressable style={styles.secondaryButton} onPress={() => openMaps(item)}>
                    <Ionicons name="navigate-outline" size={15} color={colors.textSecondary} />
                    <Text style={styles.secondaryButtonText}>Buka Peta</Text>
                  </Pressable>
                  {item.phone && (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => callStore(item.phone as string)}
                    >
                      <Ionicons name="call-outline" size={15} color={colors.textSecondary} />
                      <Text style={styles.secondaryButtonText}>Telepon</Text>
                    </Pressable>
                  )}
                </View>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() =>
                    router.push(
                      `/booking?store_id=${item.id}&store_name=${encodeURIComponent(item.name + ' — ' + item.city)}` as never
                    )
                  }
                >
                  <Ionicons name="calendar-outline" size={15} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>Booking</Text>
                </Pressable>
              </View>
            </View>
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  errorText: {
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
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  storeCard: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  storeName: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cityBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
  },
  cityBadgeText: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  infoText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: spacing.md,
    flexShrink: 1,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  secondaryButtonText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  primaryButtonText: {
    fontSize: fontSize.sm,
    color: '#ffffff',
    fontWeight: '700',
  },
  });
}
