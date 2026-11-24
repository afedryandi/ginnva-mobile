import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  StyleSheet,
  Linking,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

interface StoreItem {
  id: number;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  opening_hours_lines: string[];
  // Status hari ini dari server (zona WIB): null = toko belum punya jadwal hari ini.
  open_now?: boolean | null;
  today_hours?: string | null;
  latitude: number | null;
  longitude: number | null;
  maps_url: string | null;
  // SEBELUMNYA review internal (sentimen+tag+komentar) yang customer isi
  // tidak pernah diagregasi/ditampilkan di mana pun — "silo data mati".
  // null = belum ada review sama sekali (beda dari 0%). Lihat audit
  // modul Review Toko 2026-08-27.
  reviews_count: number;
  positive_rate_percent: number | null;
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
  const [searchFocused, setSearchFocused] = useState(false);

  const loadStores = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: StoreItem[] }>('/api/stores', { skipAuth: true })
      .then((res) => {
        // Ginnva House ditaruh paling atas (diminta user 2026-09-25, sama
        // perubahan yang sudah dilakukan di ginnva-web/app/dealers) —
        // sisa urutan dari API tetap dipertahankan (stable sort).
        const sorted = [...res.data].sort((a, b) => {
          const aIsDefault = a.name === 'Ginnva House';
          const bIsDefault = b.name === 'Ginnva House';
          if (aIsDefault === bIsDefault) return 0;
          return aIsDefault ? -1 : 1;
        });
        setStores(sorted);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Gagal memuat daftar toko. Periksa koneksi internetmu.'
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

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cari Toko</Text>
        <Text style={styles.headerSubtitle}>
          Temukan dealer & bengkel resmi Ginnva terdekat
        </Text>
      </View>

      <View style={[styles.searchBar, searchFocused && styles.searchBarFocused]}>
        <Ionicons name="search-outline" size={20} color={searchFocused ? colors.accent : colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nama toko atau kota..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Hapus pencarian">
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.errorText}>{error}</Text>
          <PressableScale style={styles.retryButton} onPress={() => loadStores()} accessibilityRole="button">
            <Text style={styles.retryText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : filteredStores.length === 0 ? (
        <View style={styles.centerState}>
          <View style={styles.centerIcon}>
            <Ionicons name="storefront-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.emptyText}>Tidak ada toko yang cocok.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredStores}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<Text style={styles.count}>{filteredStores.length} toko</Text>}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadStores(true)} tintColor={colors.accent} colors={[colors.accent]} />
          }
          renderItem={({ item, index }) => {
            const hasStatus = item.open_now !== null && item.open_now !== undefined;
            const statusDetail = item.today_hours === 'Libur' ? 'Libur hari ini' : item.today_hours ?? null;

            return (
              <FadeInUp index={index} enabled={index < 5}>
                <View style={styles.storeCard}>
                  <View style={styles.cardTop}>
                    <View style={styles.storeIcon}>
                      <Ionicons name="storefront-outline" size={22} color={colors.accent} />
                    </View>
                    <View style={styles.storeTitleWrap}>
                      <Text style={styles.storeName} numberOfLines={2}>{item.name}</Text>
                      <Text style={styles.storeCity}>{item.city}</Text>
                    </View>
                  </View>

                  {hasStatus || item.positive_rate_percent !== null ? (
                    <View style={styles.badgeRow}>
                      {hasStatus ? (
                        <View style={[styles.statusBadge, item.open_now ? styles.statusOpen : styles.statusClosed]}>
                          <View style={[styles.statusDot, { backgroundColor: item.open_now ? colors.success : colors.danger }]} />
                          <Text style={[styles.statusBadgeText, item.open_now ? styles.statusOpenText : styles.statusClosedText]} numberOfLines={1}>
                            {item.open_now ? 'Buka' : 'Tutup'}{statusDetail ? ` · ${statusDetail}` : ''}
                          </Text>
                        </View>
                      ) : null}
                      {item.positive_rate_percent !== null ? (
                        <View style={styles.ratingBadge}>
                          <Ionicons name="thumbs-up" size={12} color={colors.success} />
                          <Text style={styles.ratingBadgeText}>
                            {item.positive_rate_percent}% positif ({item.reviews_count})
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.infoList}>
                    <View style={styles.infoRow}>
                      <View style={styles.infoIcon}><Ionicons name="location-outline" size={16} color={colors.accent} /></View>
                      <Text style={styles.infoText}>{item.address}</Text>
                    </View>

                    {item.opening_hours_lines?.length > 0 && (
                      <View style={styles.infoRow}>
                        <View style={styles.infoIcon}><Ionicons name="time-outline" size={16} color={colors.accent} /></View>
                        <View style={{ flex: 1 }}>
                          {item.opening_hours_lines.map((line, i) => (
                            <Text key={i} style={styles.infoText}>{line}</Text>
                          ))}
                        </View>
                      </View>
                    )}

                    {item.phone && (
                      <View style={styles.infoRow}>
                        <View style={styles.infoIcon}><Ionicons name="call-outline" size={16} color={colors.accent} /></View>
                        <Text style={styles.infoText}>{item.phone}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.actionRow}>
                    <PressableScale style={styles.secondaryButton} onPress={() => openMaps(item)} accessibilityRole="button">
                      <Ionicons name="navigate-outline" size={17} color={colors.textPrimary} />
                      <Text style={styles.secondaryButtonText}>Peta</Text>
                    </PressableScale>
                    {item.phone && (
                      <PressableScale style={styles.secondaryButton} onPress={() => callStore(item.phone as string)} accessibilityRole="button">
                        <Ionicons name="call-outline" size={17} color={colors.textPrimary} />
                        <Text style={styles.secondaryButtonText}>Telepon</Text>
                      </PressableScale>
                    )}
                    <PressableScale
                      style={styles.primaryButton}
                      onPress={() =>
                        router.push(
                          `/booking?store_id=${item.id}&store_name=${encodeURIComponent(item.name + ' — ' + item.city)}` as never
                        )
                      }
                      accessibilityRole="button"
                    >
                      <Ionicons name="calendar-outline" size={17} color="#ffffff" />
                      <Text style={styles.primaryButtonText}>Booking</Text>
                    </PressableScale>
                  </View>
                </View>
              </FadeInUp>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    header: { paddingHorizontal: 24, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 6 },
    headerTitle: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    headerSubtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },

    searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 24, marginBottom: spacing.md, paddingHorizontal: 18, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    searchBarFocused: { borderColor: colors.accent, backgroundColor: colors.bg },
    searchInput: { flex: 1, height: 52, fontSize: 15, fontWeight: '600', color: colors.textPrimary, padding: 0 },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 120 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    errorText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    retryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    retryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
    emptyText: { fontSize: 14, lineHeight: 21, color: colors.textMuted, textAlign: 'center' },

    // Ruang bawah menyisakan tempat untuk bilah tab.
    listContent: { paddingHorizontal: 24, paddingBottom: 120, gap: 14 },
    count: { fontSize: 13, color: colors.textMuted, marginLeft: 4, marginBottom: 2 },

    storeCard: { gap: 14, padding: 18, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    storeIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    storeTitleWrap: { flex: 1, gap: 2 },
    storeName: { fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    storeCity: { fontSize: 13, fontWeight: '700', color: colors.accent },

    badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    statusBadge: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 12, borderRadius: 14 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusOpen: { backgroundColor: colors.successBg },
    statusClosed: { backgroundColor: colors.dangerBg },
    statusBadgeText: { flexShrink: 1, fontSize: 12, fontWeight: '800' },
    statusOpenText: { color: colors.success },
    statusClosedText: { color: colors.danger },
    ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.bg },
    ratingBadgeText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },

    infoList: { gap: 10 },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    infoIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    infoText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textSecondary, paddingTop: 5 },

    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
    secondaryButton: { flex: 1, minWidth: 120, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: 24, backgroundColor: colors.bg },
    secondaryButtonText: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
    primaryButton: { flexBasis: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 26, backgroundColor: colors.accent },
    primaryButtonText: { fontSize: 14, fontWeight: '800', color: '#ffffff' },
  });
}
