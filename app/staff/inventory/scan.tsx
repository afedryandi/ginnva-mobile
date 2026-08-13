import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, Linking } from 'react-native';

const SCAN_FRAME_SIZE = Math.round(Dimensions.get('window').width * 0.62);

import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

// Layar scan QR barang inventaris — pola kamera/scanner sama persis
// dengan app/warranty/check.tsx (sudah teruji), bedanya hasil scan di
// sini langsung dianggap KODE barang (bukan URL/warranty code) dan
// diarahkan ke halaman detail barang, bukan query warranty.
export default function InventoryScanScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  React.useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBarcodeScanned = (scan: BarcodeScanningResult) => {
    if (scanLocked) return;
    setScanLocked(true);
    const code = scan.data.trim();
    router.replace({ pathname: '/staff/inventory/[code]', params: { code } } as never);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Scan Barang</Text>
        <View style={styles.sideButton} />
      </View>

      <View style={styles.scannerWrap}>
        {!permission?.granted ? (
          <View style={styles.permissionState}>
            <Ionicons name="camera-outline" size={32} color={colors.textMuted} />
            <Text style={styles.permissionText}>
              {permission && !permission.canAskAgain
                ? 'Izin kamera ditolak permanen. Aktifkan lewat Pengaturan untuk memindai QR barang.'
                : 'Izin kamera diperlukan untuk memindai QR barang.'}
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
            <Text style={styles.scanHint}>Arahkan kamera ke QR pada kardus/barang</Text>
          </>
        )}
      </View>
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
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: '#ffffff', flex: 1, textAlign: 'center' },
    scannerWrap: { flex: 1, margin: spacing.md, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000000' },
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
