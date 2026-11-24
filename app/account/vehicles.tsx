import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import VehicleFormModal from '@/components/VehicleFormModal';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hapticSuccess } from '@/lib/haptics';
import { useAppTheme } from '@/lib/theme-context';
import {
  CustomerVehicle,
  deleteVehicle,
  fetchVehicleCatalog,
  fetchVehicles,
  VehicleCatalog,
} from '@/lib/vehicles';

// "Kendaraan Saya" (Fase 1 pengerjaan ulang booking, 2026-10-15): daftar kendaraan pelanggan yang dipakai ulang di booking.
// Tampilan didesain ulang (2026-11-24): kartu lapang dengan plat seperti pelat, chip warna dan tahun, dan tombol tambah pil di dasar.
export default function VehiclesScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isLoggedIn } = useAuth();
  const insets = useSafeAreaInsets();

  const [vehicles, setVehicles] = useState<CustomerVehicle[]>([]);
  const [catalog, setCatalog] = useState<VehicleCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<CustomerVehicle | null>(null);

  useEffect(() => {
    if (!isLoggedIn) router.replace('/auth/login' as never);
  }, [isLoggedIn]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setVehicles(await fetchVehicles());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat kendaraan. Periksa koneksi internetmu.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load])
  );

  // Katalog dimuat sekali saat layar dibuka; kegagalannya tidak menghalangi daftar (formulir tetap bisa isi manual).
  useEffect(() => {
    fetchVehicleCatalog().then(setCatalog).catch(() => setCatalog({ brands: [], vehicles: [] }));
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openAdd = () => {
    setEditing(null);
    setFormVisible(true);
  };

  const openEdit = (vehicle: CustomerVehicle) => {
    setEditing(vehicle);
    setFormVisible(true);
  };

  const confirmDelete = (vehicle: CustomerVehicle) => {
    Alert.alert(
      'Hapus Kendaraan',
      `Hapus ${vehicle.label} (${vehicle.plate}) dari Kendaraan Saya? Riwayat bookingmu tidak ikut terhapus.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteVehicle(vehicle.id);
              hapticSuccess();
              await load();
            } catch (err) {
              Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menghapus kendaraan. Coba lagi.');
            }
          },
        },
      ]
    );
  };

  const hasList = !loading && !error && vehicles.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.topTitle}>Kendaraan Saya</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerText}>{error}</Text>
          <PressableScale style={styles.pill} onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }} accessibilityRole="button">
            <Text style={styles.pillText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : vehicles.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="car-sport-outline" size={32} color={colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>Belum ada kendaraan</Text>
          <Text style={styles.centerText}>Simpan mobilmu di sini supaya booking berikutnya lebih cepat.</Text>
          <PressableScale style={styles.pill} onPress={openAdd} accessibilityRole="button">
            <Ionicons name="add" size={20} color="#ffffff" />
            <Text style={styles.pillText}>Tambah Kendaraan</Text>
          </PressableScale>
        </View>
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          ListHeaderComponent={<Text style={styles.count}>{vehicles.length} kendaraan tersimpan</Text>}
          renderItem={({ item, index }) => {
            const chips = [
              item.color ? { icon: 'color-palette-outline' as const, text: item.color } : null,
              item.year ? { icon: 'calendar-outline' as const, text: String(item.year) } : null,
            ].filter((c): c is { icon: 'color-palette-outline' | 'calendar-outline'; text: string } => c !== null);

            return (
              <FadeInUp index={index} enabled={index < 6}>
                <PressableScale style={styles.card} onPress={() => openEdit(item)} accessibilityRole="button" accessibilityLabel={`Ubah ${item.label} ${item.plate}`}>
                  <View style={styles.cardTop}>
                    <View style={styles.cardIcon}>
                      <Ionicons name="car-sport-outline" size={24} color={colors.accent} />
                    </View>
                    <View style={styles.cardInfo}>
                      <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
                      <View style={styles.plateRow}>
                        <View style={styles.plate}>
                          <Text style={styles.plateText}>{item.plate}</Text>
                        </View>
                        {item.is_default ? (
                          <View style={styles.badge}>
                            <Ionicons name="star" size={11} color={colors.accent} />
                            <Text style={styles.badgeText}>Utama</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Pressable onPress={() => confirmDelete(item)} style={styles.deleteButton} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Hapus ${item.plate}`}>
                      <Ionicons name="trash-outline" size={19} color={colors.textMuted} />
                    </Pressable>
                  </View>

                  {chips.length > 0 ? (
                    <View style={styles.chips}>
                      {chips.map((chip) => (
                        <View key={chip.text} style={styles.chip}>
                          <Ionicons name={chip.icon} size={14} color={colors.textSecondary} />
                          <Text style={styles.chipText}>{chip.text}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </PressableScale>
              </FadeInUp>
            );
          }}
        />
      )}

      {/* Tombol tambah selalu terlihat di dasar saat daftar terisi. */}
      {hasList ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} pointerEvents="box-none">
          <PressableScale style={[styles.addButton]} onPress={openAdd} accessibilityRole="button">
            <Ionicons name="add" size={22} color="#ffffff" />
            <Text style={styles.addButtonText}>Tambah Kendaraan</Text>
          </PressableScale>
        </View>
      ) : null}

      <VehicleFormModal
        visible={formVisible}
        vehicle={editing}
        catalog={catalog}
        onClose={() => setFormVisible(false)}
        onSaved={() => {
          setFormVisible(false);
          hapticSuccess();
          load();
        }}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    centerText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, paddingHorizontal: 28, borderRadius: 26, backgroundColor: colors.accent, marginTop: 6 },
    pillText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    list: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 130, gap: 14 },
    count: { fontSize: 13, color: colors.textMuted, marginLeft: 4, marginBottom: 2 },

    card: { gap: 14, padding: 16, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    cardIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    cardInfo: { flex: 1, gap: 8 },
    label: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    plateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    plate: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textPrimary, backgroundColor: colors.bg },
    plateText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textPrimary },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.accentSoft },
    badgeText: { fontSize: 11, fontWeight: '800', color: colors.accent },
    deleteButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.bg },
    chipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },

    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 12, backgroundColor: colors.bg },
    addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 58, borderRadius: 29, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 16, elevation: 6 },
    addButtonText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  });
}
