import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, useWindowDimensions, Linking, ActivityIndicator, RefreshControl, KeyboardAvoidingView } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { staffApiFetch, ApiError } from '@/lib/staff-api';

interface InventoryListItem {
  id: number;
  code: string;
  name: string;
  category: string | null;
  status: 'in_stock' | 'out';
  scroll_code: { id: number; code: string; remaining_length_meters?: string | null } | null;
}

type StatusFilter = 'all' | 'in_stock' | 'out';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'in_stock', label: 'Ada Stok' },
  { key: 'out', label: 'Sudah Keluar' },
];

type Mode = 'scan' | 'search';

// Layar scan QR barang inventaris — pola kamera/scanner sama persis
// dengan app/warranty/check.tsx (sudah teruji), bedanya hasil scan di
// sini langsung dianggap KODE barang (bukan URL/warranty code) dan
// diarahkan ke halaman detail barang, bukan query warranty.
//
// Mode "Cari Manual" ditambahkan untuk skenario staff belum bisa scan
// QR langsung di tempat (mis. mencatat dari jarak jauh) — cari nama/
// kode barang lewat GET /api/staff/inventory?search=..., lalu pilih
// dari hasilnya, diarahkan ke halaman detail yang sama seperti scan.
//
// Tampilan dirancang ulang 2026-11-13: mode Scan imersif (kamera bersudut membulat dengan bingkai sudut), pindah mode lewat segmen
// Scan QR / Cari Manual yang selalu terlihat, mode Cari berlatar terang dengan kartu hasil. Logika scan dan pencarian tidak berubah.
export default function InventoryScanScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const scanFrameSize = Math.round(Math.min(screenWidth, screenHeight) * 0.6);

  const [mode, setMode] = useState<Mode>('scan');
  const styles = useMemo(() => createStyles(colors, isDark, scanFrameSize, mode === 'scan'), [colors, isDark, scanFrameSize, mode]);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Pesan singkat saat yang dipindai bukan QR barang (awalan INV-); pemindaian dibuka lagi setelah jeda.
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [items, setItems] = useState<InventoryListItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Diisi backend cuma kalau hasil kosong DAN kata kunci itu persis kode
  // gulungan yang sudah terdaftar tapi belum dikaitkan ke barang fisik
  // apa pun — SEBELUMNYA staff cuma lihat "Tidak ada barang ditemukan."
  // tanpa penjelasan, tidak tahu apakah salah ketik atau memang belum
  // dikaitkan. Ditemukan lewat testing manual 2026-09-01.
  const [searchHint, setSearchHint] = useState<string | null>(null);
  // SEBELUMNYA FlatList hasil pencarian tidak bisa ditarik-refresh sama
  // sekali — beda dari Bahan Baku/Barang Habis Pakai yang polanya identik.
  const [refreshing, setRefreshing] = useState(false);

  React.useEffect(() => {
    if (mode === 'scan' && !permission?.granted) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const fetchItems = useCallback((query: string, status: StatusFilter) => {
    setSearchError(null);
    return staffApiFetch<{ data: InventoryListItem[]; hint: string | null }>(
      `/api/staff/inventory?search=${encodeURIComponent(query)}${status !== 'all' ? `&status=${status}` : ''}`
    )
      .then((res) => {
        setItems(res.data);
        setSearchHint(res.hint ?? null);
      })
      .catch((err) => {
        setSearchError(err instanceof ApiError ? err.message : 'Gagal memuat daftar barang.');
      });
  }, []);

  useEffect(() => {
    if (mode !== 'search') return;
    setSearchLoading(true);
    const timeout = setTimeout(() => fetchItems(search, statusFilter).finally(() => setSearchLoading(false)), 300);
    return () => clearTimeout(timeout);
  }, [mode, search, statusFilter, fetchItems]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItems(search, statusFilter);
    setRefreshing(false);
  }, [fetchItems, search, statusFilter]);

  const handleBarcodeScanned = (scan: BarcodeScanningResult) => {
    if (scanLocked) return;
    setScanLocked(true);
    const code = scan.data.trim();

    // QR barang berisi kode polos berawalan INV-. QR lain (URL, QR toko, dll.) tidak dikirim ke server, cukup diberi tahu.
    if (!/^INV-\S+$/i.test(code)) {
      setScanMessage('Bukan QR barang. QR barang berawalan INV-.');
      setTimeout(() => { setScanMessage(null); setScanLocked(false); }, 2000);
      return;
    }

    router.replace({ pathname: '/staff/inventory/[code]', params: { code } } as never);
  };

  const iconColor = mode === 'scan' ? '#ffffff' : colors.textSecondary;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <StatusBar style={mode === 'scan' || isDark ? 'light' : 'dark'} />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={iconColor} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{mode === 'scan' ? 'Scan Barang' : 'Cari Barang'}</Text>
          <Pressable onPress={() => router.push('/staff/inventory/history' as never)} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Riwayat keluar masuk">
            <Ionicons name="time-outline" size={22} color={iconColor} />
          </Pressable>
        </View>

        {/* Pindah mode: selalu terlihat di kedua mode, jadi tidak perlu menebak ikon di pojok. */}
        <View style={styles.segment}>
          {([
            { key: 'scan', label: 'Scan QR', icon: 'qr-code-outline' },
            { key: 'search', label: 'Cari Manual', icon: 'search-outline' },
          ] as const).map((m) => {
            const active = mode === m.key;
            return (
              <Pressable
                key={m.key}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                onPress={() => setMode(m.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Ionicons name={m.icon} size={16} color={active ? styles.segmentTextActive.color : styles.segmentText.color} />
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {mode === 'search' ? (
          <>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Nama, kode barang, atau kode gulungan"
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
              />
              {search ? (
                <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Hapus pencarian">
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.tabs}>
              {STATUS_FILTERS.map((f) => {
                const active = statusFilter === f.key;

                return (
                  <Pressable key={f.key} style={styles.tab} onPress={() => setStatusFilter(f.key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{f.label}</Text>
                    <View style={[styles.tabBar, active && styles.tabBarActive]} />
                  </Pressable>
                );
              })}
            </View>

            {searchLoading ? (
              <SkeletonCards count={4} />
            ) : searchError ? (
              <View style={styles.centerState}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="alert-circle-outline" size={34} color={colors.danger} />
                </View>
                <Text style={styles.centerStateText}>{searchError}</Text>
              </View>
            ) : items.length === 0 ? (
              <View style={styles.centerState}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="cube-outline" size={34} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>Barang tidak ditemukan</Text>
                <Text style={styles.centerStateText}>{searchHint ?? 'Coba kata kunci lain, atau scan QR pada barangnya.'}</Text>
              </View>
            ) : (
              <FlatList
                data={items}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
                renderItem={({ item, index }) => {
                  const inStock = item.status === 'in_stock';
                  return (
<FadeInUp index={index} enabled={index < 8}>
                    <PressableScale
                      style={styles.row}
                      onPress={() => router.push({ pathname: '/staff/inventory/[code]', params: { code: item.code } } as never)}
                      accessibilityRole="button"
                    >
                      <View style={styles.rowIcon}>
                        <Ionicons name="cube-outline" size={20} color={colors.textSecondary} />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
                        <Text style={styles.rowCategory} numberOfLines={2}>
                          {[item.code, item.category, item.scroll_code ? `Gulungan: ${item.scroll_code.code}${item.scroll_code.remaining_length_meters != null ? ` (sisa ${parseFloat(item.scroll_code.remaining_length_meters).toLocaleString('id-ID')} m)` : ''}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                        <View style={[styles.statusBadge, inStock ? styles.statusOk : styles.statusOut]}>
                          <Ionicons name={inStock ? 'checkmark-circle' : 'arrow-up-circle'} size={13} color={inStock ? colors.success : colors.textSecondary} />
                          <Text style={[styles.statusText, { color: inStock ? colors.success : colors.textSecondary }]}>{inStock ? 'Ada Stok' : 'Sudah Keluar'}</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </PressableScale>
                  </FadeInUp>
);
                }}
              />
            )}
          </>
        ) : (
          <View style={styles.scannerWrap}>
            {scanMessage ? (
              <View style={styles.scanBanner}>
                <Ionicons name="information-circle" size={18} color={colors.warning} />
                <Text style={styles.scanBannerText}>{scanMessage}</Text>
              </View>
            ) : null}
            {!permission?.granted ? (
              <View style={styles.permissionState}>
                <View style={styles.permissionIcon}>
                  <Ionicons name="camera-outline" size={32} color="#ffffff" />
                </View>
                <Text style={styles.permissionText}>
                  {permission && !permission.canAskAgain
                    ? 'Izin kamera ditolak permanen. Aktifkan lewat Pengaturan untuk memindai QR barang.'
                    : 'Aplikasi butuh izin kamera untuk memindai QR barang.'}
                </Text>
                <PressableScale style={styles.retryButton} onPress={permission && !permission.canAskAgain ? Linking.openSettings : requestPermission}>
                  <Text style={styles.retryText}>{permission && !permission.canAskAgain ? 'Buka Pengaturan' : 'Izinkan Kamera'}</Text>
                </PressableScale>
              </View>
            ) : cameraError ? (
              <View style={styles.permissionState}>
                <View style={styles.permissionIcon}>
                  <Ionicons name="alert-circle-outline" size={32} color="#ffffff" />
                </View>
                <Text style={styles.permissionText}>Kamera gagal dibuka. Coba restart aplikasi atau periksa izin kamera di pengaturan.</Text>
                <PressableScale style={styles.retryButton} onPress={() => setCameraError(false)}>
                  <Text style={styles.retryText}>Coba Lagi</Text>
                </PressableScale>
              </View>
            ) : (
              <>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
                  onMountError={() => setCameraError(true)}
                />
                <View style={styles.scanFrameContainer} pointerEvents="none">
                  <View style={styles.scanFrame}>
                    <View style={[styles.corner, styles.cornerTL]} />
                    <View style={[styles.corner, styles.cornerTR]} />
                    <View style={[styles.corner, styles.cornerBL]} />
                    <View style={[styles.corner, styles.cornerBR]} />
                  </View>
                </View>
                <View style={styles.hintWrap} pointerEvents="none">
                  <View style={styles.hintPill}>
                    <Ionicons name="qr-code-outline" size={16} color="#ffffff" />
                    <Text style={styles.scanHint}>Arahkan kamera ke QR</Text>
                  </View>
                </View>
              </>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean, scanFrameSize: number, scanMode: boolean) {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };
  const CORNER = 34;
  const CORNER_W = 5;

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: scanMode ? '#0b0b10' : screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    roundButton: {
      width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
      backgroundColor: scanMode ? 'rgba(255,255,255,0.14)' : card, borderWidth: scanMode ? 0 : 1, borderColor: line,
    },
    title: { flex: 1, fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: scanMode ? '#ffffff' : colors.textPrimary },

    segment: { flexDirection: 'row', marginHorizontal: 20, padding: 4, borderRadius: radius.pill, backgroundColor: scanMode ? 'rgba(255,255,255,0.12)' : chip },
    segmentItem: { flex: 1, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.pill },
    segmentItemActive: { backgroundColor: scanMode ? '#ffffff' : card, ...(scanMode ? {} : shadow) },
    segmentText: { fontSize: 14, fontWeight: '700', color: scanMode ? 'rgba(255,255,255,0.75)' : colors.textMuted },
    segmentTextActive: { color: scanMode ? '#14141b' : colors.textPrimary },

    // Mode Scan
    scannerWrap: { flex: 1, margin: 20, borderRadius: 32, overflow: 'hidden', backgroundColor: '#000000' },
    camera: { flex: 1 },
    scanFrameContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', paddingBottom: 40 },
    scanFrame: { width: scanFrameSize, height: scanFrameSize },
    corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#ffffff' },
    cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_W, borderLeftWidth: CORNER_W, borderTopLeftRadius: 18 },
    cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_W, borderRightWidth: CORNER_W, borderTopRightRadius: 18 },
    cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_W, borderLeftWidth: CORNER_W, borderBottomLeftRadius: 18 },
    cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_W, borderRightWidth: CORNER_W, borderBottomRightRadius: 18 },
    hintWrap: { position: 'absolute', bottom: spacing.lg, left: spacing.md, right: spacing.md, alignItems: 'center' },
    hintPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)' },
    scanHint: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
    scanBanner: {
      position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, zIndex: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, backgroundColor: colors.warningBg,
    },
    scanBannerText: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: '700', color: colors.warning },
    permissionState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
    permissionIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
    permissionText: { fontSize: fontSize.sm, color: '#ffffff', textAlign: 'center', lineHeight: 22 },
    retryButton: { paddingHorizontal: spacing.xl, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.pill },
    retryText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '700' },

    // Mode Cari
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: 20, marginTop: spacing.md, paddingHorizontal: 16, height: 52,
      borderRadius: 26, borderWidth: 1, borderColor: line, backgroundColor: card, ...shadow,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    tabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: spacing.md, borderBottomWidth: 1, borderBottomColor: line },
    tab: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 8 },
    tabText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    tabTextActive: { color: colors.textPrimary },
    tabBar: { height: 3, width: '60%', borderRadius: 2, backgroundColor: 'transparent' },
    tabBarActive: { backgroundColor: colors.accent },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    centerStateText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, padding: 16, marginBottom: spacing.sm + 2,
      backgroundColor: card, borderRadius: 24, borderWidth: 1, borderColor: line, ...shadow,
    },
    rowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    rowName: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    rowCategory: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    statusBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 2 },
    statusOk: { backgroundColor: colors.successBg },
    // "Sudah Keluar" adalah keadaan normal, bukan galat: netral, tidak merah.
    statusOut: { backgroundColor: chip },
    statusText: { fontSize: 12, fontWeight: '700' },
  });
}
