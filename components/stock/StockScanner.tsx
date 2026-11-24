import React, { useMemo, useState } from 'react';
import { View, StyleSheet, useWindowDimensions, Linking, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { staffApiFetch, ApiError } from '@/lib/staff-api';

interface ScanResult {
  data: { type: 'raw_material' | 'consumable_item'; id: number; name: string };
}

interface Props {
  /** Mode hitung (Opname Massal): hasil scan ditambahkan ke daftar hitung, bukan membuka detail bahan. */
  countMode?: boolean;
  /** Pada mode hitung: jenis yang boleh dipindai ('materials' | 'consumables'). */
  type?: string;
  /** Kolom ketik kode manual untuk label rusak. Dimatikan di halaman Bahan Baku, yang sudah punya tab Cari Manual. */
  showManualInput?: boolean;
  /** Scan QR umum: kode berawalan INV- (Produk PPF/WF) juga dikenali dan langsung membuka detail barangnya. */
  allowInventory?: boolean;
}

/**
 * Pemindai label QR Bahan Baku / Barang Habis Pakai (dicetak dari panel: pilih bahan → Cetak Label QR), dipakai di layar Scan Stok dan di
 * tab "Scan QR" halaman Bahan Baku. Isi QR dicocokkan di server (GET /api/staff/stock-scan), lalu staf dibawa ke detail bahannya.
 * Diekstrak 2026-11-13 dari app/staff/stock/scan.tsx supaya halaman Bahan Baku punya pola yang sama dengan Produk PPF/WF (Scan QR | Cari Manual).
 */
export default function StockScanner({ countMode = false, type, showManualInput = true, allowInventory = false }: Props) {
  const { colors } = useAppTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const scanFrameSize = Math.round(Math.min(screenWidth, screenHeight) * 0.58);
  const styles = useMemo(() => createStyles(colors, scanFrameSize), [colors, scanFrameSize]);

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraError, setCameraError] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');

  const resolveCode = async (raw: string) => {
    const code = raw.trim();
    if (!code || locked) return;
    setLocked(true);
    setMessage(null);

    // QR Produk PPF/WF berisi kode polos berawalan INV-; tidak perlu bertanya ke server stok.
    if (allowInventory && /^INV-\S+$/i.test(code)) {
      router.replace({ pathname: '/staff/inventory/[code]', params: { code } } as never);
      return;
    }

    try {
      const res = await staffApiFetch<ScanResult>(`/api/staff/stock-scan?code=${encodeURIComponent(code)}`);
      const kind = res.data.type === 'raw_material' ? 'materials' : 'consumables';

      if (countMode) {
        if (type && type !== kind) {
          setMessage(`${res.data.name} bukan ${kind === 'materials' ? 'barang habis pakai' : 'bahan baku'}. Sesi hitung ini untuk ${type === 'materials' ? 'Bahan Baku' : 'Barang Habis Pakai'}.`);
          setLocked(false);
          return;
        }
        router.replace({ pathname: '/staff/stock/count', params: { type: kind, addId: String(res.data.id) } } as never);
        return;
      }

      router.replace({ pathname: kind === 'materials' ? '/staff/materials/[id]' : '/staff/consumables/[id]', params: { id: String(res.data.id) } } as never);
    } catch (err) {
      setMessage(
        err instanceof ApiError
          ? allowInventory && err.status === 404
            ? 'Kode tidak dikenali. Pindai QR Produk PPF/WF atau label Bahan Baku.'
            : err.message
          : 'Gagal memeriksa kode. Periksa koneksi internet.',
      );
      setLocked(false);
    }
  };

  const handleBarcodeScanned = (scan: BarcodeScanningResult) => {
    resolveCode(scan.data);
  };

  React.useEffect(() => {
    if (!permission?.granted) requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Saat keyboard terbuka, kamera menyusut dan kolom ketik kode naik ke atas keyboard (Android edge-to-edge tidak meresize jendela sendiri).
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <View style={styles.scannerWrap}>
        {message ? (
          <View style={styles.banner}>
            <Ionicons name="information-circle" size={18} color={colors.warning} />
            <Text style={styles.bannerText}>{message}</Text>
          </View>
        ) : null}

        {!permission?.granted ? (
          <View style={styles.permissionState}>
            <View style={styles.permissionIcon}>
              <Ionicons name="camera-outline" size={32} color="#ffffff" />
            </View>
            <Text style={styles.permissionText}>
              {permission && !permission.canAskAgain
                ? 'Izin kamera ditolak permanen. Aktifkan lewat Pengaturan untuk memindai label.'
                : 'Aplikasi butuh izin kamera untuk memindai label.'}
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
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
              onBarcodeScanned={locked ? undefined : handleBarcodeScanned}
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
                {locked && !message ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="qr-code-outline" size={16} color="#ffffff" />}
                <Text style={styles.scanHint}>{locked && !message ? 'Memeriksa kode...' : 'Arahkan kamera ke QR'}</Text>
              </View>
            </View>
          </>
        )}
      </View>

      {showManualInput ? (
      <View style={styles.footer}>
        <View style={styles.manualRow}>
          <Ionicons name="keypad-outline" size={18} color="rgba(255,255,255,0.6)" style={styles.manualIcon} />
          <TextInput
            style={styles.manualInput}
            placeholder="Label rusak? Ketik kodenya di sini"
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={manualCode}
            onChangeText={setManualCode}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => resolveCode(manualCode)}
          />
          <PressableScale
            style={[styles.manualButton, (locked || !manualCode.trim()) && styles.manualButtonOff]}
            onPress={() => resolveCode(manualCode)}
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel="Cari kode"
          >
            <Ionicons name="arrow-forward" size={20} color="#ffffff" />
          </PressableScale>
        </View>
      </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: typeof darkColors, scanFrameSize: number) {
  const CORNER = 34;
  const CORNER_W = 5;

  return StyleSheet.create({
    flex: { flex: 1 },
    scannerWrap: { flex: 1, marginHorizontal: 20, marginBottom: spacing.md, borderRadius: 32, overflow: 'hidden', backgroundColor: '#000000' },
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
    banner: {
      position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, backgroundColor: colors.warningBg,
    },
    bannerText: { flex: 1, fontSize: fontSize.sm, fontWeight: '700', color: colors.warning, lineHeight: 20 },

    permissionState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
    permissionIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
    permissionText: { fontSize: fontSize.sm, color: '#ffffff', textAlign: 'center', lineHeight: 22 },
    retryButton: { paddingHorizontal: spacing.xl, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.pill },
    retryText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '700' },

    footer: { paddingHorizontal: 20, paddingBottom: spacing.md },
    manualRow: { flexDirection: 'row', alignItems: 'center', height: 56, paddingLeft: 16, paddingRight: 6, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)' },
    manualIcon: { marginRight: spacing.sm },
    manualInput: { flex: 1, height: 56, color: '#ffffff', fontSize: fontSize.sm },
    manualButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    manualButtonOff: { opacity: 0.45 },
  });
}
