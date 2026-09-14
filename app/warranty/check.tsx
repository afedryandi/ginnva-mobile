import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
// SDK 54 memindahkan API utama expo-file-system ke sistem baru
// (File/Directory classes). Import default sekarang cuma lewat shim
// kompatibilitas yang perilakunya tidak selalu identik (terutama soal
// headers & status code di downloadAsync) — jadi sengaja import dari
// subpath /legacy supaya pakai implementasi penuh yang teruji.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError, API_BASE_URL, getToken } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
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
  installation_date: string;
  expiry_date: string;
  dealer_name: string;
  status: string;
  review_status: string;
  remaining_days: number;
  has_owner: boolean;
  // true kalau match lewat nomor telepon — data (termasuk warranty_code)
  // di-mask sebagian oleh backend, TIDAK bisa dipakai untuk unduh
  // sertifikat. Lihat audit modul Garansi 2026-08-27 &
  // WarrantyController::check().
  masked: boolean;
}

function getStatusMeta(colors: typeof darkColors): Record<
  string,
  { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> {
  return {
    active: { label: 'Aktif', color: colors.success, bg: colors.successBg, icon: 'checkmark-circle' },
    // Beda dari 'pending_review' — ini kolom `status` mentah, dipakai
    // saat garansi sudah disetujui admin (review_status: approved) tapi
    // belum ditandai 'active' di database. Lihat WarrantyResource.php
    // filter status utk konfirmasi nilai ini memang ada & valid.
    pending: {
      label: 'Menunggu Aktivasi',
      color: colors.warning,
      bg: colors.warningBg,
      icon: 'hourglass',
    },
    pending_review: {
      label: 'Menunggu Review Admin',
      color: colors.warning,
      bg: colors.warningBg,
      icon: 'time',
    },
    rejected: { label: 'Ditolak', color: colors.danger, bg: colors.dangerBg, icon: 'close-circle' },
    expired: { label: 'Kedaluwarsa', color: colors.textMuted, bg: colors.surface, icon: 'alert-circle' },
  };
}

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
type Styles = ReturnType<typeof createStyles>;
type StatusMetaMap = Record<string, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }>;

// 1 mobil bisa punya LEBIH DARI 1 garansi (mis. PPF + Window Film
// terdaftar terpisah, plat/VIN/nomor HP-nya identik) —
// WarrantyController::check() SEKARANG selalu return array (bisa >1
// baris), bukan lagi 1 object tunggal. Sebelumnya cek pakai plat/VIN/HP
// cuma menampilkan garansi PERTAMA yang ketemu di DB, garansi satunya
// tidak pernah terlihat sama sekali dari pencarian itu. Komponen ini
// merender 1 kartu hasil, dipakai berkali-kali (satu per garansi yang
// ditemukan) — state unduh/klaim jadi per-kartu, bukan digabung.
// Ditemukan & diperbaiki 2026-08-31.
function WarrantyResultCard({
  warranty,
  onUpdate,
  isLoggedIn,
  colors,
  styles,
  statusMeta,
}: {
  warranty: WarrantyData;
  onUpdate: (updated: WarrantyData) => void;
  isLoggedIn: boolean;
  colors: typeof darkColors;
  styles: Styles;
  statusMeta: StatusMetaMap[string];
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const successScale = useRef(new Animated.Value(0.6)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
      Animated.timing(successOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClaim = async () => {
    setClaiming(true);
    setClaimError(null);
    try {
      await apiFetch('/api/warranty/claim', {
        method: 'POST',
        body: JSON.stringify({ warranty_code: warranty.warranty_code }),
      });
      hapticSuccess();
      setClaimSuccess(true);
      onUpdate({ ...warranty, has_owner: true });
    } catch (err) {
      hapticError();
      setClaimError(err instanceof ApiError ? err.message : 'Gagal menghubungkan garansi. Coba lagi.');
    } finally {
      setClaiming(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);

    try {
      const token = await getToken();
      const fileUri = `${FileSystem.cacheDirectory}E-Warranty-Ginnva-${warranty.warranty_code}.pdf`;

      const downloadRes = await FileSystem.downloadAsync(
        `${API_BASE_URL}/api/warranty/download/${warranty.warranty_code}`,
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
          dialogTitle: `Sertifikat Garansi ${warranty.warranty_code}`,
        });
      } else {
        setDownloadError(`File tersimpan di perangkat: ${downloadRes.uri}`);
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

  const productLabel = warranty.product_category === 'ppf'
    ? 'PPF'
    : warranty.product_category === 'window_film'
      ? 'Window Film'
      : null;

  return (
    <Animated.View
      style={{
        opacity: successOpacity,
        transform: [{ scale: successScale }],
      }}
    >
      <View style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <View>
            <Text style={styles.resultCaption}>
              NOMOR SERTIFIKAT{productLabel ? ` — ${productLabel}` : ''}
            </Text>
            <Text style={styles.resultCode}>{warranty.warranty_code}</Text>
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
          <Text style={styles.fieldValue}>{warranty.customer_name}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Produk Terpasang</Text>
          <Text style={[styles.fieldValue, { color: colors.accent }]}>
            {warranty.product_series}
          </Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Kendaraan</Text>
          <Text style={styles.fieldValue}>
            {warranty.car_type} ({warranty.car_plate})
          </Text>
        </View>
        {warranty.vin ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>VIN (No. Rangka)</Text>
            <Text style={styles.fieldValue}>{warranty.vin}</Text>
          </View>
        ) : null}

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Dealer Pelaksana</Text>
          <Text style={styles.fieldValue}>{warranty.dealer_name}</Text>
        </View>
        <View style={styles.fieldRowSplit}>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Tgl. Pemasangan</Text>
            <Text style={styles.fieldValue}>{formatDate(warranty.installation_date)}</Text>
          </View>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Masa Berlaku Hingga</Text>
            <Text style={[styles.fieldValue, { color: colors.danger }]}>
              {formatDate(warranty.expiry_date)}
            </Text>
          </View>
        </View>

        {warranty.status === 'active' && warranty.remaining_days > 0 && (
          <View style={styles.remainingBox}>
            <Ionicons name="calendar-outline" size={16} color={colors.accent} />
            <Text style={styles.remainingText}>
              Sisa {warranty.remaining_days} hari masa garansi
            </Text>
          </View>
        )}

        {/* Tombol hubungkan ke akun — muncul kalau login & warranty belum ada pemilik */}
        {isLoggedIn && !warranty.has_owner && !claimSuccess && !warranty.masked && (
          <Pressable
            style={[styles.claimButton, claiming && styles.downloadButtonDisabled]}
            onPress={handleClaim}
            disabled={claiming}
          >
            {claiming ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="link-outline" size={18} color="#ffffff" />
                <Text style={styles.downloadButtonText}>Hubungkan ke Akun Saya</Text>
              </>
            )}
          </Pressable>
        )}
        {claimError && <Text style={styles.downloadErrorText}>{claimError}</Text>}
        {claimSuccess && (
          <View style={styles.claimSuccessBox}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.claimSuccessText}>Garansi berhasil dihubungkan ke akun Anda!</Text>
          </View>
        )}

        {warranty.status === 'pending_review' && (
          <Text style={styles.noteText}>
            Pendaftaran garansi Anda sedang diverifikasi oleh tim admin. Sertifikat
            resmi akan tersedia untuk diunduh setelah disetujui.
          </Text>
        )}

        {warranty.status === 'rejected' && (
          <Text style={styles.noteText}>
            Pendaftaran garansi ini ditolak oleh admin. Silakan hubungi dealer
            tempat pemasangan untuk informasi lebih lanjut.
          </Text>
        )}

        {warranty.status === 'expired' && (
          <Text style={styles.noteText}>
            Masa garansi produk ini sudah berakhir. Hubungi dealer tempat
            pemasangan untuk informasi perpanjangan atau layanan lanjutan.
          </Text>
        )}

        {warranty.review_status === 'approved' && !warranty.masked && (
          <Pressable
            style={[styles.downloadButton, downloading && styles.downloadButtonDisabled]}
            onPress={handleDownload}
            disabled={downloading}
          >
            {downloading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="download-outline" size={18} color="#ffffff" />
                <Text style={styles.downloadButtonText}>Unduh Garansi</Text>
              </>
            )}
          </Pressable>
        )}

        {/* Hasil dari pencarian via nomor telepon disamarkan
            sebagian (bukan bug — lihat WarrantyController::check())
            — kode garansi & sebagian data disembunyikan, tidak bisa
            dipakai unduh sertifikat langsung dari sini. */}
        {warranty.masked && (
          <Text style={styles.noteText}>
            Hasil pencarian lewat nomor telepon disamarkan sebagian.
            Untuk melihat data lengkap & mengunduh sertifikat, cari
            dengan nomor E-Warranty/plat nomor/VIN yang tertera di
            kendaraan/sertifikat, atau login ke akun Anda (garansi
            yang sudah dihubungkan otomatis muncul lengkap di
            "Garansi Saya").
          </Text>
        )}

        {downloadError && <Text style={styles.downloadErrorText}>{downloadError}</Text>}
      </View>
    </Animated.View>
  );
}

export default function WarrantyCheckScreen() {
  const { theme, colors } = useAppTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const scanFrameSize = Math.round(Math.min(screenWidth, screenHeight) * 0.62);
  const styles = useMemo(
    () => createStyles(colors, scanFrameSize),
    [colors, scanFrameSize]
  );
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);

  const [mode, setMode] = useState<InputMode>('manual');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // SEBELUMNYA state tunggal WarrantyData | null -- 1 mobil bisa punya
  // >1 garansi (PPF + Window Film terpisah), jadi sekarang array.
  const [results, setResults] = useState<WarrantyData[] | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const { isLoggedIn } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  const runSearch = (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setHasSearched(true);

    apiFetch<{ success: boolean; data: WarrantyData[] }>(
      `/api/warranty/check?code=${encodeURIComponent(trimmed)}`,
      { skipAuth: true }
    )
      .then((res) => {
        hapticSuccess();
        setResults(res.data);
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

  const updateResult = (updated: WarrantyData) => {
    setResults((prev) => prev?.map((w) => (w.id === updated.id ? updated : w)) ?? prev);
  };

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

  // SENGAJA selalu mencoba requestPermission() lagi tiap tombol ditekan
  // (bukan cuma sekali lalu `return` diam-diam kalau ditolak) — supaya
  // dialog izin OS punya kesempatan muncul lagi tiap kali user menekan
  // "Scan QR/Barcode", bukan cuma di percobaan pertama. Kalau memang
  // sudah ditolak permanen di level OS, requestPermission() akan
  // langsung resolve tanpa dialog (no-op yang aman) dan UI status izin
  // di bawah (termasuk tombol "Buka Pengaturan") tetap jadi jalan keluar.
  const switchToScan = async () => {
    if (!permission?.granted) {
      await requestPermission();
    }
    setCameraError(false);
    setMode('scan');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Cek Garansi</Text>
        <View style={styles.sideButton} />
      </View>

      {/* ===== Toggle Manual / Scan ===== */}
      <View style={styles.modeToggle}>
        <Pressable
          style={[styles.modeButton, mode === 'manual' && styles.modeButtonActive]}
          onPress={() => setMode('manual')}
        >
          <Ionicons
            name="create-outline"
            size={16}
            color={mode === 'manual' ? '#ffffff' : colors.textSecondary}
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
            color={mode === 'scan' ? '#ffffff' : colors.textSecondary}
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
              <Ionicons name="camera-outline" size={32} color={colors.textMuted} />
              <Text style={styles.permissionText}>
                {permission && !permission.canAskAgain
                  ? 'Izin kamera ditolak permanen. Aktifkan lewat Pengaturan untuk memindai kode garansi.'
                  : 'Izin kamera diperlukan untuk memindai kode garansi.'}
              </Text>
              <Pressable
                style={styles.retryButton}
                onPress={permission && !permission.canAskAgain ? Linking.openSettings : switchToScan}
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
                barcodeScannerSettings={{
                  barcodeTypes: ['qr', 'code128', 'code39', 'ean13'],
                }}
                onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
                onMountError={() => setCameraError(true)}
              />
              <View style={styles.scanFrameContainer} pointerEvents="none">
                <View style={styles.scanFrame} />
              </View>
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
              placeholder="Masukkan kode garansi Anda"
              placeholderTextColor={colors.textMuted}
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
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Bisa lebih dari 1 hasil (mis. 1 mobil terdaftar PPF &
              Window Film terpisah) — render 1 kartu per garansi. */}
          {hasSearched && !loading && !error && results && results.length > 0 && (
            <View style={{ gap: spacing.md }}>
              {results.length > 1 && (
                <Text style={styles.multiResultNote}>
                  Ditemukan {results.length} garansi terdaftar untuk kendaraan ini.
                </Text>
              )}
              {results.map((warranty) => {
                const statusMeta = STATUS_META[warranty.status] ?? {
                  label: warranty.status,
                  color: colors.textSecondary,
                  bg: colors.border,
                  icon: 'help-circle' as const,
                };
                return (
                  <WarrantyResultCard
                    key={warranty.id}
                    warranty={warranty}
                    onUpdate={updateResult}
                    isLoggedIn={isLoggedIn}
                    colors={colors}
                    styles={styles}
                    statusMeta={statusMeta}
                  />
                );
              })}
            </View>
          )}

          {!hasSearched && (
            <View style={styles.placeholder}>
              <Ionicons name="shield-checkmark-outline" size={36} color={colors.textMuted} />
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

function createStyles(colors: typeof darkColors, scanFrameSize: number) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modeButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeButtonTextActive: {
    color: '#ffffff',
  },
  scannerWrap: {
    flex: 1,
    margin: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  scanFrameContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40, // slight upward offset so hint text has room below
  },
  scanFrame: {
    width: scanFrameSize,
    height: scanFrameSize,
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
  permissionState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  permissionText: {
    fontSize: fontSize.sm,
    color: '#ffffff',
    textAlign: 'center',
  },
  intro: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
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
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
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
    color: colors.textSecondary,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  multiResultNote: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  resultCard: {
    gap: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  resultCaption: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  resultCode: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
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
    backgroundColor: colors.border,
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
    color: colors.textMuted,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  remainingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  remainingText: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  noteText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
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
    color: '#ffffff',
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
    backgroundColor: colors.textMuted,
    borderRadius: radius.pill,
    height: 46,
    marginTop: spacing.sm,
  },
  claimSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.successBg,
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
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 0,
  },
  techSectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  fieldSub: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  placeholder: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  placeholderText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
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
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  });
}
