import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
  Platform,
  Linking,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
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
import { darkColors, spacing } from '@/constants/theme';
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
        <View style={styles.resultTop}>
          <View style={[styles.statusBadge, { backgroundColor: statusMeta.bg }]}>
            <Ionicons name={statusMeta.icon} size={14} color={statusMeta.color} />
            <Text style={[styles.statusText, { color: statusMeta.color }]}>
              {statusMeta.label}
            </Text>
          </View>
          {productLabel ? (
            <View style={styles.productChip}>
              <Text style={styles.productChipText}>{productLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.codeBox}>
          <Text style={styles.resultCaption}>Nomor sertifikat</Text>
          <Text style={styles.resultCode} selectable>{warranty.warranty_code}</Text>
        </View>

        <View style={styles.infoList}>
          <InfoRow icon="person-outline" label="Nama Pemilik" value={warranty.customer_name} styles={styles} colors={colors} />
          <InfoRow icon="shield-checkmark-outline" label="Produk Terpasang" value={warranty.product_series} accent styles={styles} colors={colors} />
          <InfoRow icon="car-sport-outline" label="Kendaraan" value={`${warranty.car_type} (${warranty.car_plate})`} styles={styles} colors={colors} />
          {warranty.vin ? <InfoRow icon="barcode-outline" label="VIN (No. Rangka)" value={warranty.vin} styles={styles} colors={colors} /> : null}
          <InfoRow icon="storefront-outline" label="Dealer Pelaksana" value={warranty.dealer_name} styles={styles} colors={colors} />
        </View>

        <View style={styles.dateRow}>
          <View style={styles.dateTile}>
            <Text style={styles.fieldLabel}>Tgl. Pemasangan</Text>
            <Text style={styles.fieldValue}>{formatDate(warranty.installation_date)}</Text>
          </View>
          <View style={styles.dateTile}>
            <Text style={styles.fieldLabel}>Berlaku Hingga</Text>
            <Text style={[styles.fieldValue, { color: colors.danger }]}>{formatDate(warranty.expiry_date)}</Text>
          </View>
        </View>

        {warranty.status === 'active' && warranty.remaining_days > 0 && (
          <View style={styles.remainingBox}>
            <Ionicons name="time-outline" size={18} color={colors.accent} />
            <Text style={styles.remainingText}>
              Sisa {warranty.remaining_days} hari masa garansi
            </Text>
          </View>
        )}

        {/* Tombol hubungkan ke akun — muncul kalau login & warranty belum ada pemilik */}
        {isLoggedIn && !warranty.has_owner && !claimSuccess && !warranty.masked && (
          <PressableScale
            style={[styles.claimButton, claiming && styles.downloadButtonDisabled]}
            onPress={handleClaim}
            disabled={claiming}
            accessibilityRole="button"
          >
            {claiming ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="link-outline" size={20} color="#ffffff" />
                <Text style={styles.downloadButtonText}>Hubungkan ke Akun Saya</Text>
              </>
            )}
          </PressableScale>
        )}
        {claimError && <Text style={styles.downloadErrorText}>{claimError}</Text>}
        {claimSuccess && (
          <View style={styles.claimSuccessBox}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.claimSuccessText}>Garansi berhasil dihubungkan ke akunmu!</Text>
          </View>
        )}

        {warranty.status === 'pending_review' && (
          <Text style={styles.noteText}>
            Pendaftaran garansimu sedang diverifikasi oleh tim admin. Sertifikat
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
          <PressableScale
            style={[styles.downloadButton, downloading && styles.downloadButtonDisabled]}
            onPress={handleDownload}
            disabled={downloading}
            accessibilityRole="button"
          >
            {downloading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="download-outline" size={20} color="#ffffff" />
                <Text style={styles.downloadButtonText}>Unduh Garansi</Text>
              </>
            )}
          </PressableScale>
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
            kendaraan/sertifikat, atau login ke akunmu (garansi
            yang sudah dihubungkan otomatis muncul lengkap di
            "Garansi Saya").
          </Text>
        )}

        {downloadError && <Text style={styles.downloadErrorText}>{downloadError}</Text>}
      </View>
    </Animated.View>
  );
}

// Satu baris info berikon (pemilik, produk, kendaraan, dealer).
function InfoRow({ icon, label, value, accent, styles, colors }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  accent?: boolean;
  styles: Styles;
  colors: typeof darkColors;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={[styles.fieldValue, accent && { color: colors.accent }]}>{value}</Text>
      </View>
    </View>
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
  const [fieldFocused, setFieldFocused] = useState(false);

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
            : 'Terjadi kesalahan koneksi. Periksa internetmu dan coba lagi.'
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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.topTitle} numberOfLines={1}>Cek Garansi</Text>
      </View>

      {/* ===== Toggle Manual / Scan ===== */}
      <View style={styles.modeWrap}>
        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeButton, mode === 'manual' && styles.modeButtonActive]}
            onPress={() => setMode('manual')}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'manual' }}
          >
            <Ionicons name="create-outline" size={16} color={mode === 'manual' ? '#ffffff' : colors.textSecondary} />
            <Text style={[styles.modeButtonText, mode === 'manual' && styles.modeButtonTextActive]}>Input Manual</Text>
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === 'scan' && styles.modeButtonActive]}
            onPress={switchToScan}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'scan' }}
          >
            <Ionicons name="scan-outline" size={16} color={mode === 'scan' ? '#ffffff' : colors.textSecondary} />
            <Text style={[styles.modeButtonText, mode === 'scan' && styles.modeButtonTextActive]}>Scan QR/Barcode</Text>
          </Pressable>
        </View>
      </View>

      {mode === 'scan' ? (
        <View style={styles.scannerWrap}>
          {!permission?.granted ? (
            <View style={styles.permissionState}>
              <View style={styles.permissionIcon}>
                <Ionicons name="camera-outline" size={30} color="#ffffff" />
              </View>
              <Text style={styles.permissionText}>
                {permission && !permission.canAskAgain
                  ? 'Izin kamera ditolak permanen. Aktifkan lewat Pengaturan untuk memindai kode garansi.'
                  : 'Izin kamera diperlukan untuk memindai kode garansi.'}
              </Text>
              <PressableScale
                style={styles.retryButton}
                onPress={permission && !permission.canAskAgain ? Linking.openSettings : switchToScan}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>
                  {permission && !permission.canAskAgain ? 'Buka Pengaturan' : 'Izinkan Kamera'}
                </Text>
              </PressableScale>
            </View>
          ) : cameraError ? (
            <View style={styles.permissionState}>
              <View style={styles.permissionIcon}>
                <Ionicons name="alert-circle-outline" size={30} color="#ffffff" />
              </View>
              <Text style={styles.permissionText}>
                Kamera gagal dibuka. Coba restart aplikasi atau periksa izin kamera di pengaturan.
              </Text>
              <PressableScale style={styles.retryButton} onPress={() => setCameraError(false)} accessibilityRole="button">
                <Text style={styles.retryText}>Coba Lagi</Text>
              </PressableScale>
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
              <View style={styles.scanHintWrap} pointerEvents="none">
                <Text style={styles.scanHint}>
                  Arahkan kamera ke kode QR/barcode pada stiker garansi
                </Text>
              </View>
            </>
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>
            Masukkan nomor E-Warranty atau plat nomor kendaraan, atau ketuk
            "Scan QR/Barcode" untuk memindai kode pada stiker pemasangan.
          </Text>

          <View style={styles.searchRow}>
            <View style={[styles.field, fieldFocused && styles.fieldFocused]}>
              <Ionicons name="search-outline" size={20} color={fieldFocused ? colors.accent : colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Masukkan kode garansimu"
                placeholderTextColor={colors.textMuted}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                onSubmitEditing={handleSearch}
                returnKeyType="search"
                onFocus={() => setFieldFocused(true)}
                onBlur={() => setFieldFocused(false)}
              />
            </View>
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
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
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
              <View style={styles.placeholderIcon}>
                <Ionicons name="shield-checkmark-outline" size={30} color={colors.accent} />
              </View>
              <Text style={styles.placeholderText}>
                Hasil pencarian data garansi akan muncul di sini.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, scanFrameSize: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { flex: 1, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    // Pilihan cara mencari: satu pil abu muda berisi dua segmen; yang dipilih merah.
    modeWrap: { paddingHorizontal: 24, paddingBottom: spacing.sm },
    modeToggle: { flexDirection: 'row', padding: 4, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    modeButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 20 },
    modeButtonActive: { backgroundColor: colors.accent },
    modeButtonText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    modeButtonTextActive: { color: '#ffffff', fontWeight: '800' },

    scrollContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56 },
    intro: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginBottom: 18 },
    searchRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
    field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 56, paddingHorizontal: 18, borderRadius: 28, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    fieldFocused: { borderColor: colors.accent, backgroundColor: colors.bg },
    input: { flex: 1, height: 54, fontSize: 15, fontWeight: '600', color: colors.textPrimary, padding: 0 },
    searchButton: { height: 56, borderRadius: 28, paddingHorizontal: 24 },

    // Pemindai: sudut besar dan bingkai bidik merah merek.
    scannerWrap: { flex: 1, marginHorizontal: 24, marginBottom: 24, borderRadius: 32, overflow: 'hidden', backgroundColor: '#000000' },
    camera: { flex: 1 },
    scanFrameContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', paddingBottom: 40 },
    scanFrame: { width: scanFrameSize, height: scanFrameSize, borderWidth: 3, borderColor: colors.accent, borderRadius: 28 },
    scanHintWrap: { position: 'absolute', bottom: 20, left: 20, right: 20, alignItems: 'center' },
    scanHint: { textAlign: 'center', color: '#ffffff', fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.55)' },
    permissionState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
    permissionIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
    permissionText: { fontSize: 14, lineHeight: 21, color: '#ffffff', textAlign: 'center' },
    retryButton: { height: 48, paddingHorizontal: 28, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    retryText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },

    centerState: { alignItems: 'center', paddingVertical: spacing.xl, gap: 10 },
    centerStateText: { fontSize: 14, color: colors.textSecondary },
    errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 16, borderRadius: 20, backgroundColor: colors.dangerBg },
    errorText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.danger },
    multiResultNote: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginLeft: 4 },

    // Kartu hasil.
    resultCard: { gap: 16, padding: 20, borderRadius: 32, backgroundColor: colors.surfaceElevated },
    resultTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15 },
    statusText: { fontSize: 12, fontWeight: '800' },
    productChip: { height: 28, paddingHorizontal: 12, borderRadius: 14, justifyContent: 'center', backgroundColor: colors.accentSoft },
    productChipText: { fontSize: 12, fontWeight: '800', color: colors.accent },
    codeBox: { alignItems: 'center', gap: 4, paddingVertical: 16, borderRadius: 22, backgroundColor: colors.bg },
    resultCaption: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    resultCode: { fontSize: 24, fontWeight: '800', letterSpacing: 2, color: colors.accent },

    infoList: { gap: 12 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    infoIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    fieldLabel: { fontSize: 12, color: colors.textMuted },
    fieldValue: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
    dateRow: { flexDirection: 'row', gap: 10 },
    dateTile: { flex: 1, padding: 14, borderRadius: 20, backgroundColor: colors.bg },

    remainingBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 20, backgroundColor: colors.accentSoft },
    remainingText: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    noteText: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },

    downloadButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 27, backgroundColor: colors.accent },
    claimButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 27, backgroundColor: colors.textPrimary },
    downloadButtonDisabled: { opacity: 0.7 },
    downloadButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
    downloadErrorText: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: colors.danger, textAlign: 'center' },
    claimSuccessBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.successBg },
    claimSuccessText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.success },

    placeholder: { alignItems: 'center', paddingVertical: 48, gap: 14 },
    placeholderIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    placeholderText: { fontSize: 14, lineHeight: 21, color: colors.textMuted, textAlign: 'center' },
  });
}
