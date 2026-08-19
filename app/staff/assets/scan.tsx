import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Dimensions, Linking, ActivityIndicator } from 'react-native';

const SCAN_FRAME_SIZE = Math.round(Dimensions.get('window').width * 0.62);

import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { staffApiFetch, ApiError } from '@/lib/staff-api';

interface AssetListItem {
  id: number;
  asset_tag: string;
  name: string;
  category: string | null;
  status: 'aktif' | 'diperbaiki' | 'rusak' | 'dijual' | 'hilang';
}

type Mode = 'scan' | 'search';

// Samakan persis dengan label di assets/[code].tsx & AssetResource
// (Filament) — sebelumnya beda ("Aktif" vs "Aktif Dipakai") padahal
// status yang sama, staff lihat 2 istilah beda antara hasil cari & detail.
function statusLabel(status: AssetListItem['status']): string {
  return {
    aktif: 'Aktif Dipakai',
    diperbaiki: 'Sedang Diperbaiki',
    rusak: 'Rusak',
    dijual: 'Dijual',
    hilang: 'Hilang',
  }[status];
}

// Layar scan QR aset — pola kamera/scanner PERSIS sama dengan
// app/staff/inventory/scan.tsx, cuma diarahkan ke halaman detail aset.
// Mode "Cari Manual" ditambahkan untuk skenario staff belum bisa scan
// QR langsung di tempat — cari nama/kode aset lewat
// GET /api/staff/assets?search=..., lalu pilih dari hasilnya.
export default function AssetScanScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>('scan');

  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  React.useEffect(() => {
    if (mode === 'scan' && !permission?.granted) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const fetchAssets = useCallback((query: string) => {
    setSearchError(null);
    return staffApiFetch<{ data: AssetListItem[] }>(`/api/staff/assets?search=${encodeURIComponent(query)}`)
      .then((res) => setAssets(res.data))
      .catch((err) => {
        setSearchError(err instanceof ApiError ? err.message : 'Gagal memuat daftar aset.');
      });
  }, []);

  useEffect(() => {
    if (mode !== 'search') return;
    setSearchLoading(true);
    const timeout = setTimeout(() => fetchAssets(search).finally(() => setSearchLoading(false)), 300);
    return () => clearTimeout(timeout);
  }, [mode, search, fetchAssets]);

  const handleBarcodeScanned = (scan: BarcodeScanningResult) => {
    if (scanLocked) return;
    setScanLocked(true);
    const code = scan.data.trim();
    router.replace({ pathname: '/staff/assets/[code]', params: { code } } as never);
  };

  return (
    <SafeAreaView style={[styles.container, mode === 'search' && { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar style={mode === 'scan' ? 'light' : theme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.header, mode === 'search' && styles.headerLight]}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={mode === 'scan' ? '#ffffff' : colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, mode === 'search' && { color: colors.textPrimary }]} numberOfLines={1}>
          {mode === 'scan' ? 'Scan Aset Tetap' : 'Cari Aset Tetap'}
        </Text>
        <Pressable onPress={() => setMode(mode === 'scan' ? 'search' : 'scan')} style={styles.sideButton}>
          <Ionicons
            name={mode === 'scan' ? 'search' : 'qr-code-outline'}
            size={22}
            color={mode === 'scan' ? '#ffffff' : colors.textPrimary}
          />
        </Pressable>
      </View>

      {mode === 'search' ? (
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Cari nama atau kode aset..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>

          {searchLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : searchError ? (
            <View style={styles.centerState}>
              <Ionicons name="alert-circle" size={32} color={colors.danger} />
              <Text style={styles.centerStateText}>{searchError}</Text>
            </View>
          ) : assets.length === 0 ? (
            <View style={styles.centerState}>
              <Text style={styles.centerStateText}>Tidak ada aset ditemukan.</Text>
            </View>
          ) : (
            <FlatList
              data={assets}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.row}
                  onPress={() => router.push({ pathname: '/staff/assets/[code]', params: { code: item.asset_tag } } as never)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{item.name}</Text>
                    <Text style={styles.rowCategory}>
                      {[item.asset_tag, item.category].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, item.status === 'aktif' ? styles.statusOk : styles.statusOut]}>
                    <Text style={[styles.statusText, { color: item.status === 'aktif' ? colors.success : colors.danger }]}>
                      {statusLabel(item.status)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              )}
            />
          )}
        </>
      ) : (
      <View style={styles.scannerWrap}>
        {!permission?.granted ? (
          <View style={styles.permissionState}>
            <Ionicons name="camera-outline" size={32} color={colors.textMuted} />
            <Text style={styles.permissionText}>
              {permission && !permission.canAskAgain
                ? 'Izin kamera ditolak permanen. Aktifkan lewat Pengaturan untuk memindai QR aset.'
                : 'Izin kamera diperlukan untuk memindai QR aset.'}
            </Text>
            <Pressable
              style={styles.retryButton}
              onPress={permission && !permission.canAskAgain ? Linking.openSettings : requestPermission}
            >
              <Text style={styles.retryText}>
                {permission && !permission.canAskAgain ? 'Buka Pengaturan' : 'Izinkan Kamera'}
              </Text>
            </Pressable>
          </View>
        ) : cameraError ? (
          <View style={styles.permissionState}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.danger} />
            <Text style={styles.permissionText}>
              Kamera gagal dibuka. Coba restart aplikasi atau periksa izin kamera di pengaturan.
            </Text>
            <Pressable style={styles.retryButton} onPress={() => setCameraError(false)}>
              <Text style={styles.retryText}>Coba Lagi</Text>
            </Pressable>
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
              <View style={styles.scanFrame} />
            </View>
            <Text style={styles.scanHint}>Arahkan kamera ke QR pada aset</Text>
          </>
        )}
      </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000000' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    headerLight: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: '#ffffff', flex: 1, textAlign: 'center' },
    scannerWrap: { flex: 1, margin: spacing.md, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000000' },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.sm,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    listContent: { padding: spacing.md, gap: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    rowCategory: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
    statusOk: { backgroundColor: colors.successBg },
    statusOut: { backgroundColor: colors.dangerBg },
    statusText: { fontSize: fontSize.xs, fontWeight: '700' },
    camera: { flex: 1 },
    scanFrameContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      paddingBottom: 40,
    },
    scanFrame: {
      width: SCAN_FRAME_SIZE,
      height: SCAN_FRAME_SIZE,
      borderWidth: 2,
      borderColor: '#ffffff',
      borderRadius: radius.lg,
    },
    scanHint: {
      position: 'absolute',
      bottom: spacing.lg,
      left: spacing.lg,
      right: spacing.lg,
      textAlign: 'center',
      color: '#ffffff',
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    permissionState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    permissionText: { fontSize: fontSize.sm, color: '#ffffff', textAlign: 'center' },
    retryButton: {
      marginTop: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
    },
    retryText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '600' },
  });
}
