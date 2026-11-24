import React, { useEffect, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, Pressable, RefreshControl, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

interface MyWarranty {
  id: number;
  warranty_code: string;
  car_type: string;
  car_plate: string;
  product_series: string;
  expiry_date: string;
  status: string;
  remaining_days: number;
  // Fitur "Kuota Maintenance" (2026-09-25) -- null kalau garansi ini
  // memang tidak ditawarkan maintenance.
  maintenance_quota: number | null;
  maintenance_remaining: number | null;
}

function getStatusMeta(colors: typeof darkColors): Record<string, { label: string; color: string; bg: string }> {
  return {
    active: { label: 'Aktif', color: colors.success, bg: colors.successBg },
    pending_review: { label: 'Menunggu Review', color: colors.warning, bg: colors.warningBg },
    rejected: { label: 'Ditolak', color: colors.danger, bg: colors.dangerBg },
    expired: { label: 'Kedaluwarsa', color: colors.textMuted, bg: colors.bg },
    // Gap "revoke/void" diperbaiki 2026-09-25 (audit Garansi) -- SEBELUMNYA
    // tidak ada entri ini sama sekali, jadi garansi 'revoked' jatuh ke
    // fallback STATUS_META.active (badge hijau "Aktif") -- MENYESATKAN,
    // customer yang garansinya baru dibatalkan malah lihat badge hijau.
    revoked: { label: 'Dibatalkan', color: colors.danger, bg: colors.dangerBg },
  };
}

// Tampilan didesain ulang (2026-11-24): kartu garansi lapang dengan produk sebagai judul, plat nomor tampil seperti pelat, dan sisa masa
// garansi/maintenance sebagai chip. Data, status, dan peringatan 30 hari tidak berubah.
export default function MyWarrantiesScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);

  const [warranties, setWarranties] = useState<MyWarranty[]>([]);
  const { isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: MyWarranty[] }>('/api/customer/warranties')
      .then((res) => {
        setWarranties(res.data);
        if (isRefresh) hapticSuccess();
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat data garansimu.'
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

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => load(true)}
      colors={[colors.accent]}
      tintColor={colors.accent}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.topTitle}>Garansi Saya</Text>
      </View>

      {!isLoggedIn ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="lock-closed-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateTitle}>Masuk dulu</Text>
          <Text style={styles.centerStateText}>Masuk ke akunmu untuk melihat garansimu.</Text>
          <PressableScale style={styles.primaryButton} onPress={() => router.push('/auth/login' as never)} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Masuk Sekarang</Text>
          </PressableScale>
        </ScrollView>
      ) : loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateText}>{error}</Text>
          <PressableScale style={styles.primaryButton} onPress={() => { hapticLight(); load(); }} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Coba Lagi</Text>
          </PressableScale>
        </ScrollView>
      ) : warranties.length === 0 ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="shield-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateTitle}>Belum ada garansi</Text>
          <Text style={styles.centerStateText}>Garansimu akan muncul di sini setelah admin menghubungkannya ke akunmu.</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={warranties}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          ListHeaderComponent={<Text style={styles.count}>{warranties.length} garansi terdaftar</Text>}
          renderItem={({ item, index }) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.active;
            const expiring = item.status === 'active' && item.remaining_days <= 30;

            return (
              <FadeInUp index={index} enabled={index < 6}>
                <PressableScale
                  style={styles.card}
                  onPress={() => {
                    hapticLight();
                    router.push(`/account/warranty-detail?id=${item.id}` as never);
                  }}
                  accessibilityRole="button"
                >
                  <View style={styles.cardTop}>
                    {/* SEBELUMNYA render item.warranty_code langsung —
                        kalau masih null (garansi belum diisi Detail
                        Instalasi oleh staff, kode di-generate otomatis
                        begitu kode gulungan dipilih), <Text> render
                        string kosong, kartu tampil ada ruang kosong di
                        pojok kiri atas tanpa penjelasan. Ditemukan lewat
                        testing manual 2026-08-31. */}
                    <Text style={item.warranty_code ? styles.code : styles.codePending} numberOfLines={1}>
                      {item.warranty_code || 'Menunggu diproses'}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>

                  <View style={styles.productRow}>
                    <View style={styles.productIcon}>
                      <Ionicons name="shield-checkmark-outline" size={22} color={colors.accent} />
                    </View>
                    <View style={styles.productInfo}>
                      <Text style={styles.productText} numberOfLines={2}>{item.product_series}</Text>
                      <View style={styles.carRow}>
                        <Text style={styles.subText} numberOfLines={1}>{item.car_type}</Text>
                        {item.car_plate ? (
                          <View style={styles.plate}>
                            <Text style={styles.plateText}>{item.car_plate}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </View>

                  {item.status === 'active' || item.maintenance_quota !== null ? (
                    <View style={styles.chips}>
                      {item.status === 'active' ? (
                        // Peringatan kuning kalau sisa hari <= 30 — SEBELUMNYA
                        // semua garansi aktif ditampilkan sama (hijau/normal)
                        // sampai benar-benar expired, tidak ada dorongan
                        // visual buat customer yang garansinya mau habis.
                        // Lihat audit modul Garansi 2026-08-27.
                        <View style={[styles.chip, expiring && { backgroundColor: colors.warningBg }]}>
                          <Ionicons name={expiring ? 'alert-circle-outline' : 'time-outline'} size={14} color={expiring ? colors.warning : colors.textSecondary} />
                          <Text style={[styles.chipText, expiring && { color: colors.warning }]}>
                            Sisa {item.remaining_days} hari
                          </Text>
                        </View>
                      ) : null}
                      {item.maintenance_quota !== null ? (
                        <View style={styles.chip}>
                          <Ionicons name="construct-outline" size={14} color={colors.textSecondary} />
                          <Text style={styles.chipText}>
                            Maintenance {item.maintenance_remaining}/{item.maintenance_quota}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </PressableScale>
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

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    centerState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    centerStateTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    centerStateText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56, gap: 14 },
    count: { fontSize: 13, color: colors.textMuted, marginLeft: 4, marginBottom: 2 },

    card: { padding: 18, gap: 16, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    code: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textMuted },
    codePending: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.textMuted },
    badge: { height: 26, paddingHorizontal: 12, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontSize: 12, fontWeight: '800' },

    productRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    productIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    productInfo: { flex: 1, gap: 6 },
    productText: { fontSize: 17, lineHeight: 22, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    carRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    subText: { flexShrink: 1, fontSize: 13, color: colors.textSecondary },
    plate: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textPrimary, backgroundColor: colors.bg },
    plateText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textPrimary },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.bg },
    chipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  });
}
