import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
// SDK 54 memindahkan API utama expo-file-system ke sistem baru
// (File/Directory classes). Import default sekarang cuma lewat shim
// kompatibilitas yang perilakunya tidak selalu identik (terutama soal
// headers & status code di downloadAsync) — jadi sengaja import dari
// subpath /legacy supaya pakai implementasi penuh yang teruji.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError, API_BASE_URL, getToken } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hapticLight, hapticSuccess, hapticError } from '@/lib/haptics';

interface WarrantyData {
  id: number;
  warranty_code: string;
  customer_name: string;
  phone_number: string;
  car_plate: string;
  car_type: string;
  product_series: string;
  product_category: string | null;
  vin: string | null;
  // PPF
  installation_position: string | null;
  installation_position_detail: string | null;
  roll_number: string | null;
  // Window Film
  roll_number_front: string | null;
  roll_number_side_rear: string | null;
  film_model_front: string | null;
  film_model_side_rear: string | null;
  installation_date: string;
  expiry_date: string;
  dealer_name: string;
  status: string;
  review_status: string;
  remaining_days: number;
  has_owner: boolean;
}

// Status yang dikembalikan accessor getStatusAttribute() di backend.
// Mapping label & warna supaya konsisten dengan arti sebenarnya —
// bukan cuma menampilkan status mentah dari kolom database.
const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  active: { label: 'Aktif', color: colors.success, bg: '#e7f8ef', icon: 'checkmark-circle' },
  pending_review: {
    label: 'Menunggu Review Admin',
    color: colors.warning,
    bg: '#fef3e2',
    icon: 'time',
  },
  rejected: { label: 'Ditolak', color: colors.danger, bg: '#fde8e8', icon: 'close-circle' },
  expired: { label: 'Kedaluwarsa', color: colors.mutedLight, bg: colors.alt, icon: 'alert-circle' },
};

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

type InputMode = 'manual' | 'scan';

export default function WarrantyCheckScreen() {
  const [mode, setMode] = useState<InputMode>('manual');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WarrantyData | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const { isLoggedIn } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);

  // Animasi sukses ringan — ikon status muncul dengan pop scale, bukan
  // library animasi tambahan (Lottie dst), supaya tetap ringan.
  const successScale = useRef(new Animated.Value(0.6)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  const runSearch = (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setHasSearched(true);
    setDownloadError(null);

    apiFetch<{ success: boolean; data: WarrantyData }>(
      `/api/warranty/check?code=${encodeURIComponent(trimmed)}`,
      { skipAuth: true }
    )
      .then((res) => {
        hapticSuccess();
        setResult(res.data);
        successScale.setValue(0.6);
        successOpacity.setValue(0);
        Animated.parallel([
          Animated.spring(successScale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 14,
            bounciness: 10,
          }),
          Animated.timing(successOpacity, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
        ]).start();
      })
      .catch((err) => {
        hapticError();
        setError(
          err instanceof ApiError
            ? err.message
            : 'Terjadi kesalahan koneksi. Periksa internet Anda dan coba lagi.'
        );
      })
      .finally(() => setLoading(false));
  };

  const handleSearch = () => runSearch(code);

  // QR/barcode di stiker pemasangan berisi teks polos warranty_code yang
  // sama dengan yang bisa diketik manual — jadi hasil scan langsung dipakai
  // sebagai query ke endpoint yang sama, tidak ada endpoint terpisah.
  // QR di sertifikat PDF berisi URL lengkap (https://ginnva.id/warranty?code=GNV-xxx)
  // supaya bisa dibuka di browser. Saat di-scan di app, kita extract kode-nya saja.
  const extractWarrantyCode = (raw: string): string => {
    try {
      const url = new URL(raw);
      const code = url.searchParams.get('code');
      if (code) return code;
    } catch {
      // Bukan URL — langsung pakai nilai mentah (input manual / QR lama)
    }
    return raw.trim();
  };

  const handleBarcodeScanned = (scan: BarcodeScanningResult) => {
    if (scanLocked) return;
    setScanLocked(true);
    const extracted = extractWarrantyCode(scan.data);
    setCode(extracted);
    setMode('manual');
    runSearch(extracted);
    // Re-lock dilepas saat user balik ke mode scan lagi lewat toggle,
    // supaya satu kali scan tidak memicu pencarian berulang-ulang.
    setTimeout(() => setScanLocked(false), 1500);
  };

  const switchToScan = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setMode('scan');
  };

  const handleClaim = async () => {
    if (!result) return;
    setClaiming(true);
    try {
      await apiFetch('/api/warranty/claim', {
        method: 'POST',
        body: JSON.stringify({ warranty_code: result.warranty_code }),
      });
      hapticSuccess();
      setClaimSuccess(true);
      // Update local state supaya tombol hilang
      setResult((prev) => prev ? { ...prev, has_owner: true } : prev);
    } catch (err) {
      setDownloadError(
        err instanceof ApiError ? err.message : 'Gagal menghubungkan garansi. Coba lagi.'
      );
    } finally {
      setClaiming(false);
    }
  };

  const handleDownload = async () => {
    if (!result) return;
    setDownloading(true);
    setDownloadError(null);

    try {
      const token = await getToken();
      const fileUri = `${FileSystem.cacheDirectory}E-Warranty-Ginnva-${result.warranty_code}.pdf`;

      const downloadRes = await FileSystem.downloadAsync(
        `${API_BASE_URL}/api/warranty/download/${result.warranty_code}`,
        fileUri,
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );

      if (downloadRes.status !== 200) {
        throw new Error('not_approved');
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(downloadRes.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Sertifikat Garansi ${result.warranty_code}`,
        });
      } else {
        setDownloadError(
          Platform.OS === 'web'
            ? 'Berbagi file tidak didukung di web.'
            : `File tersimpan di perangkat: ${downloadRes.uri}`
        );
      }
    } catch (e) {
      console.error('Gagal unduh sertifikat garansi:', e);
      setDownloadError(
        'Gagal mengunduh sertifikat. Pastikan garansi sudah disetujui admin dan koneksi internet stabil.'
      );
    } finally {
      setDownloading(false);
    }
  };

  const statusMeta = result ? STATUS_META[result.status] ?? STATUS_META.active : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Cek Garansi" />

      {/* ===== Toggle Manual / Scan ===== */}
      <View style={styles.modeToggle}>
        <Pressable
          style={[styles.modeButton, mode === 'manual' && styles.modeButtonActive]}
          onPress={() => setMode('manual')}
        >
          <Ionicons
            name="create-outline"
            size={16}
            color={mode === 'manual' ? colors.white : colors.muted}
          />
          <Text style={[styles.modeButtonText, mode === 'manual' && styles.modeButtonTextActive]}>
            Input Manual
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeButton, mode === 'scan' && styles.modeButtonActive]}
          onPress={switchToScan}
        >
          <Ionicons
            name="scan-outline"
            size={16}
            color={mode === 'scan' ? colors.white : colors.muted}
          />
          <Text style={[styles.modeButtonText, mode === 'scan' && styles.modeButtonTextActive]}>
            Scan QR/Barcode
          </Text>
        </Pressable>
      </View>

      {mode === 'scan' ? (
        <View style={styles.scannerWrap}>
          {!permission?.granted ? (
            <View style={styles.permissionState}>
              <Ionicons name="camera-outline" size={32} color={colors.mutedLight} />
              <Text style={styles.permissionText}>
                Izin kamera diperlukan untuk memindai kode garansi.
              </Text>
              <Pressable style={styles.retryButton} onPress={switchToScan}>
                <Text style={styles.retryText}>Izinkan Kamera</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr', 'code128', 'code39', 'ean13'],
                }}
                onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
              />
              <View style={styles.scanFrame} pointerEvents="none" />
              <Text style={styles.scanHint}>
                Arahkan kamera ke kode QR/barcode pada stiker garansi
              </Text>
            </>
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.intro}>
            Masukkan nomor E-Warranty atau plat nomor kendaraan, atau ketuk
            "Scan QR/Barcode" untuk memindai kode pada stiker pemasangan.
          </Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              placeholder="Contoh: GNV-2026XXXXXXXX"
              placeholderTextColor={colors.mutedLight}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            <Button label="Cari" onPress={handleSearch} loading={loading} style={styles.searchButton} />
          </View>

          {loading && (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.centerStateText}>Mencari data garansi...</Text>
            </View>
          )}

          {hasSearched && !loading && error && (
            <Card style={styles.errorCard}>
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </Card>
          )}

          {hasSearched && !loading && !error && result && statusMeta && (
            <Animated.View
              style={{
                opacity: successOpacity,
                transform: [{ scale: successScale }],
              }}
            >
              <Card style={styles.resultCard}>
                <View style={styles.resultHeader}>
                  <View>
                    <Text style={styles.resultCaption}>NOMOR SERTIFIKAT</Text>
                    <Text style={styles.resultCode}>{result.warranty_code}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusMeta.bg }]}>
                    <Ionicons name={statusMeta.icon} size={14} color={statusMeta.color} />
                    <Text style={[styles.statusText, { color: statusMeta.color }]}>
                      {statusMeta.label}
                    </Text>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Nama Pemilik</Text>
                  <Text style={styles.fieldValue}>{result.customer_name}</Text>
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Produk Terpasang</Text>
                  <Text style={[styles.fieldValue, { color: colors.accent }]}>
                    {result.product_series}
                  </Text>
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Kendaraan</Text>
                  <Text style={styles.fieldValue}>
                    {result.car_type} ({result.car_plate})
                  </Text>
                </View>
                {result.vin ? (
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>VIN (No. Rangka)</Text>
                    <Text style={styles.fieldValue}>{result.vin}</Text>
                  </View>
                ) : null}

                {result.product_category === 'ppf' && (result.installation_position || result.roll_number) ? (
                  <View style={styles.techSection}>
                    <Text style={styles.techSectionTitle}>SPESIFIKASI PPF</Text>
                    {result.installation_position ? (
                      <View style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>Posisi Pemasangan</Text>
                        <Text style={styles.fieldValue}>
                          {result.installation_position === 'full_body' ? 'Seluruh Bodi' : 'Parsial'}
                          {result.installation_position === 'partial' && result.installation_position_detail
                            ? ` (${result.installation_position_detail})`
                            : ''}
                        </Text>
                      </View>
                    ) : null}
                    {result.roll_number ? (
                      <View style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>Roll/ID Material</Text>
                        <Text style={styles.fieldValue}>{result.roll_number}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {result.product_category === 'window_film' &&
                  (result.roll_number_front || result.roll_number_side_rear) ? (
                  <View style={styles.techSection}>
                    <Text style={styles.techSectionTitle}>SPESIFIKASI WINDOW FILM</Text>
                    {result.roll_number_front ? (
                      <View style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>Roll No. Kaca Depan</Text>
                        <Text style={styles.fieldValue}>{result.roll_number_front}</Text>
                        {result.film_model_front ? (
                          <Text style={styles.fieldSub}>{result.film_model_front}</Text>
                        ) : null}
                      </View>
                    ) : null}
                    {result.roll_number_side_rear ? (
                      <View style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>Roll No. Kaca Samping &amp; Belakang</Text>
                        <Text style={styles.fieldValue}>{result.roll_number_side_rear}</Text>
                        {result.film_model_side_rear ? (
                          <Text style={styles.fieldSub}>{result.film_model_side_rear}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Dealer Pelaksana</Text>
                  <Text style={styles.fieldValue}>{result.dealer_name}</Text>
                </View>
                <View style={styles.fieldRowSplit}>
                  <View style={styles.fieldHalf}>
                    <Text style={styles.fieldLabel}>Tgl. Pemasangan</Text>
                    <Text style={styles.fieldValue}>{formatDate(result.installation_date)}</Text>
                  </View>
                  <View style={styles.fieldHalf}>
                    <Text style={styles.fieldLabel}>Masa Berlaku Hingga</Text>
                    <Text style={[styles.fieldValue, { color: colors.danger }]}>
                      {formatDate(result.expiry_date)}
                    </Text>
                  </View>
                </View>

                {result.status === 'active' && result.remaining_days > 0 && (
                  <View style={styles.remainingBox}>
                    <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                    <Text style={styles.remainingText}>
                      Sisa {result.remaining_days} hari masa garansi
                    </Text>
                  </View>
                )}

                {/* Tombol hubungkan ke akun — muncul kalau login & warranty belum ada pemilik */}
                {isLoggedIn && !result.has_owner && !claimSuccess && (
                  <Pressable
                    style={[styles.claimButton, claiming && styles.downloadButtonDisabled]}
                    onPress={handleClaim}
                    disabled={claiming}
                  >
                    {claiming ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <>
                        <Ionicons name="link-outline" size={18} color={colors.white} />
                        <Text style={styles.downloadButtonText}>Hubungkan ke Akun Saya</Text>
                      </>
                    )}
                  </Pressable>
                )}
                {claimSuccess && (
                  <View style={styles.claimSuccessBox}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <Text style={styles.claimSuccessText}>Garansi berhasil dihubungkan ke akun Anda!</Text>
                  </View>
                )}

                {result.status === 'pending_review' && (
                  <Text style={styles.noteText}>
                    Pendaftaran garansi Anda sedang diverifikasi oleh tim admin. Sertifikat
                    resmi akan tersedia untuk diunduh setelah disetujui.
                  </Text>
                )}

                {result.status === 'rejected' && (
                  <Text style={styles.noteText}>
                    Pendaftaran garansi ini ditolak oleh admin. Silakan hubungi dealer
                    tempat pemasangan untuk informasi lebih lanjut.
                  </Text>
                )}

                {result.review_status === 'approved' && (
                  <Pressable
                    style={[styles.downloadButton, downloading && styles.downloadButtonDisabled]}
                    onPress={handleDownload}
                    disabled={downloading}
                  >
                    {downloading ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <>
                        <Ionicons name="download-outline" size={18} color={colors.white} />
                        <Text style={styles.downloadButtonText}>Unduh Sertifikat PDF</Text>
                      </>
                    )}
                  </Pressable>
                )}

                {downloadError && <Text style={styles.downloadErrorText}>{downloadError}</Text>}
              </Card>
            </Animated.View>
          )}

          {!hasSearched && (
            <View style={styles.placeholder}>
              <Ionicons name="shield-checkmark-outline" size={36} color={colors.mutedLight} />
              <Text style={styles.placeholderText}>
                Hasil pencarian data garansi akan muncul di sini.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  modeToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.alt,
  },
  modeButtonActive: {
    backgroundColor: colors.accent,
  },
  modeButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.muted,
  },
  modeButtonTextActive: {
    color: colors.white,
  },
  scannerWrap: {
    flex: 1,
    margin: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
  camera: {
    flex: 1,
  },
  scanFrame: {
    position: 'absolute',
    top: '30%',
    left: '15%',
    right: '15%',
    bottom: '35%',
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: radius.lg,
  },
  scanHint: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    textAlign: 'center',
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  permissionState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  permissionText: {
    fontSize: fontSize.sm,
    color: colors.white,
    textAlign: 'center',
  },
  intro: {
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  searchButton: {
    paddingHorizontal: spacing.lg,
  },
  centerState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#fde8e8',
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  resultCard: {
    gap: 0,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  resultCaption: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  resultCode: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: spacing.md,
  },
  fieldRow: {
    marginBottom: spacing.sm,
  },
  fieldRowSplit: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  fieldHalf: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.ink,
  },
  remainingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.alt,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  remainingText: {
    fontSize: fontSize.sm,
    color: colors.ink,
    fontWeight: '600',
  },
  noteText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: 46,
    marginTop: spacing.md,
  },
  downloadButtonDisabled: {
    opacity: 0.7,
  },
  downloadButtonText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  downloadErrorText: {
    fontSize: fontSize.xs,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  claimButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    height: 46,
    marginTop: spacing.sm,
  },
  claimSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#e7f8ef',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  claimSuccessText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.success,
    fontWeight: '600',
  },
  techSection: {
    backgroundColor: colors.alt,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 0,
  },
  techSectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  fieldSub: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 1,
  },
  placeholder: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  placeholderText: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
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
});