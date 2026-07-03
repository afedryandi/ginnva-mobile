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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

interface StoreItem {
  id: number;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  opening_hours: string | null;
  latitude: number | null;
  longitude: number | null;
}

function openMaps(store: StoreItem) {
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
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadStores = () => {
    setLoading(true);
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
      .finally(() => setLoading(false));
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cari Toko</Text>
        <Text style={styles.headerSubtitle}>
          Temukan dealer & bengkel resmi Ginnva terdekat
        </Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.mutedLight} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nama toko atau kota..."
          placeholderTextColor={colors.mutedLight}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.mutedLight} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={loadStores}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : filteredStores.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="storefront-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.emptyText}>Tidak ada toko yang cocok.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredStores}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card style={styles.storeCard}>
              <Text style={styles.storeName}>{item.name}</Text>
              <View style={styles.cityBadge}>
                <Text style={styles.cityBadgeText}>{item.city}</Text>
              </View>

              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={colors.muted} />
                <Text style={styles.infoText}>{item.address}</Text>
              </View>

              {item.opening_hours && (
                <View style={styles.infoRow}>
                  <Ionicons name="time-outline" size={16} color={colors.muted} />
                  <Text style={styles.infoText}>{item.opening_hours}</Text>
                </View>
              )}

              {item.phone && (
                <View style={styles.infoRow}>
                  <Ionicons name="call-outline" size={16} color={colors.muted} />
                  <Text style={styles.infoText}>{item.phone}</Text>
                </View>
              )}

              <View style={styles.actionRow}>
                <Pressable style={styles.actionButton} onPress={() => openMaps(item)}>
                  <Ionicons name="navigate-outline" size={16} color={colors.accent} />
                  <Text style={styles.actionText}>Buka Peta</Text>
                </Pressable>
                {item.phone && (
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => callStore(item.phone as string)}
                  >
                    <Ionicons name="call-outline" size={16} color={colors.accent} />
                    <Text style={styles.actionText}>Telepon</Text>
                  </Pressable>
                )}
                <Pressable
                  style={styles.actionButton}
                  onPress={() =>
                    router.push(
                      `/booking?store_id=${item.id}&store_name=${encodeURIComponent(item.name + ' — ' + item.city)}` as never
                    )
                  }
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                  <Text style={styles.actionText}>Booking</Text>
                </Pressable>
              </View>
            </Card>
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
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.ink,
  },
  headerSubtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
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
    backgroundColor: colors.alt,
    borderRadius: radius.pill,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.ink,
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
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  storeCard: {
    gap: spacing.xs,
  },
  storeName: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
  },
  cityBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.alt,
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
    color: colors.muted,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
  },
});