import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError, API_BASE_URL, getToken } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticLight, hapticError } from '@/lib/haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

interface WarrantyDetail {
  id: number;
  warranty_code: string;
  customer_name: string;
  car_type: string;
  car_plate: string;
  car_year: string | null;
  product_series: string;
  product_category: string | null;
  dealer_name: string;
  installation_date: string;
  expiry_date: string;
  status: string;
  remaining_days: number;
  review_status: string;
  rejection_reason: string | null;
  // PPF — roll_number_2 cuma terisi kalau mobil butuh 2 gulungan
  // (mis. bodi besar), lihat app-api/app/Observers/WarrantyObserver.php.
  installation_position: string | null;
  installation_position_detail: string | null;
  roll_number: string | null;
  roll_number_2: string | null;
  // Window Film
  roll_number_front: string | null;
  roll_number_side_rear: string | null;
  film_model_front: string | null;
  film_model_side_rear: string | null;
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-';
  // Ambil bagian tanggal saja (YYYY-MM-DD) lalu convert ke dd/mm/yyyy
  const dateStr = raw.split('T')[0]; // Hapus jam kalau ada
  const parts = dateStr.split('-');
  if (parts.length !== 3) return raw;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getStatusMeta(colors: typeof darkColors): Record<string, { label: string; color: string; bg: string; icon: string }> {
  return {
    active:         { label: 'Aktif',           color: colors.success,  bg: colors.successBg, icon: 'shield-checkmark' },
    pending_review: { label: 'Menunggu Review', color: colors.warning,  bg: colors.warningBg,  icon: 'time' },
    rejected:       { label: 'Ditolak',         color: colors.danger,   bg: colors.dangerBg,   icon: 'close-circle' },
    expired:        { label: 'Kedaluwarsa',     color: colors.textMuted, bg: colors.surface,   icon: 'calendar' },
  };
}

export default function WarrantyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);

  const [warranty, setWarranty] = useState<WarrantyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiFetch<{ data: WarrantyDetail }>(`/api/customer/warranties/${id}`)
      .then((res) => setWarranty(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Gagal memuat detail garansi.'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDownload = async () => {
    if (!warranty) return;
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
      if (downloadRes.status !== 200) throw new Error('not_approved');
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(downloadRes.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Sertifikat Garansi ${warranty.warranty_code}`,
        });
      }
    } catch {
      hapticError();
      setDownloadError('Gagal mengunduh sertifikat. Pastikan garansi sudah disetujui dan koneksi internet stabil.');
    } finally {
      setDownloading(false);
    }
  };

  const meta = warranty ? (STATUS_META[warranty.status] ?? STATUS_META.active) : null;

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
        <Text style={styles.headerTitle} numberOfLines={1}>Detail Garansi</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => router.back()}>
            <Text style={styles.retryText}>Kembali</Text>
          </Pressable>
        </View>
      ) : warranty && meta ? (
        <ScrollView contentContainerStyle={styles.scroll}>

          {/* Status badge */}
          <View style={[styles.statusBanner, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.icon as never} size={20} color={meta.color} />
            <Text style={[styles.statusLabel, { color: meta.color }]}>{meta.label}</Text>
            {warranty.status === 'active' && (
              <Text style={[styles.statusSub, { color: meta.color }]}>
                — sisa {warranty.remaining_days} hari
              </Text>
            )}
          </View>

          {/* Nomor garansi */}
          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>Nomor E-Warranty</Text>
            <Text style={styles.code}>{warranty.warranty_code}</Text>
          </View>

          {/* Detail rows */}
          <View style={styles.table}>
            {[
              { label: 'Nama Pemilik',    value: warranty.customer_name },
              { label: 'Produk',          value: warranty.product_series },
              { label: 'Kendaraan',       value: `${warranty.car_type}${warranty.car_year ? ` (${warranty.car_year})` : ''}` },
              { label: 'Plat Nomor',      value: warranty.car_plate },
              { label: 'Dealer Pemasang',  value: warranty.dealer_name },
              { label: 'Tgl. Pemasangan', value: formatDate(warranty.installation_date) },
              { label: 'Berlaku Hingga',  value: formatDate(warranty.expiry_date) },
            ].map((row, i) => (
              <View key={i} style={[styles.row, i > 0 && styles.rowBorder]}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={[
                  styles.rowValue,
                  // Cuma ditonjolkan (merah aksen + tebal) kalau garansinya
                  // masih aktif — tanggal kedaluwarsa dari garansi yang
                  // sudah 'expired' tidak lagi relevan/berlaku, jadi tidak
                  // seharusnya diberi penekanan visual yang sama mencoloknya.
                  row.label === 'Berlaku Hingga' && warranty.status === 'active' && { color: colors.accent, fontWeight: '700' }
                ]}>{row.value || '-'}</Text>
              </View>
            ))}
          </View>

          {/* Spesifikasi teknis (kode gulungan) — cuma tampil kalau
              memang ada data-nya (mis. warranty lama belum dilengkapi
              staff, atau belum masuk tahap approve). */}
          {warranty.product_category === 'ppf' && (warranty.roll_number || warranty.roll_number_2) && (
            <View style={styles.table}>
              <View style={styles.techHeader}>
                <Text style={styles.techHeaderText}>SPESIFIKASI PPF</Text>
              </View>
              {[
                warranty.installation_position && {
                  label: 'Posisi Pemasangan',
                  value: (warranty.installation_position === 'full_body' ? 'Seluruh Bodi' : 'Parsial')
                    + (warranty.installation_position === 'partial' && warranty.installation_position_detail
                      ? ` (${warranty.installation_position_detail})`
                      : ''),
                },
                warranty.roll_number && { label: 'Roll Number / ID Material', value: warranty.roll_number },
                warranty.roll_number_2 && { label: 'Roll Number (Gulungan Kedua)', value: warranty.roll_number_2 },
              ].filter((row): row is { label: string; value: string } => Boolean(row))
                .map((row, i) => (
                  <View key={i} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <Text style={styles.rowLabel}>{row.label}</Text>
                    <Text style={styles.rowValue}>{row.value}</Text>
                  </View>
                ))}
            </View>
          )}

          {warranty.product_category === 'window_film' &&
            (warranty.roll_number_front || warranty.roll_number_side_rear) && (
            <View style={styles.table}>
              <View style={styles.techHeader}>
                <Text style={styles.techHeaderText}>SPESIFIKASI WINDOW FILM</Text>
              </View>
              {[
                warranty.roll_number_front && {
                  label: 'Roll No. Kaca Depan',
                  value: warranty.roll_number_front + (warranty.film_model_front ? ` (${warranty.film_model_front})` : ''),
                },
                warranty.roll_number_side_rear && {
                  label: 'Roll No. Kaca Samping & Belakang',
                  value: warranty.roll_number_side_rear + (warranty.film_model_side_rear ? ` (${warranty.film_model_side_rear})` : ''),
                },
              ].filter((row): row is { label: string; value: string } => Boolean(row))
                .map((row, i) => (
                  <View key={i} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <Text style={styles.rowLabel}>{row.label}</Text>
                    <Text style={styles.rowValue}>{row.value}</Text>
                  </View>
                ))}
            </View>
          )}

          {/* Download PDF — hanya kalau sudah approved */}
          {warranty.status === 'active' && (
            <Pressable
              style={[styles.downloadBtn, downloading && styles.downloadDisabled]}
              onPress={() => { hapticLight(); handleDownload(); }}
              disabled={downloading}
            >
              {downloading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={18} color="#ffffff" />
                  <Text style={styles.downloadText}>Unduh Garansi</Text>
                </>
              )}
            </Pressable>
          )}

          {downloadError && (
            <View style={styles.pendingNote}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
              <Text style={[styles.pendingText, { color: colors.danger }]}>{downloadError}</Text>
            </View>
          )}

          {warranty.status === 'pending_review' && (
            <View style={styles.pendingNote}>
              <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
              <Text style={styles.pendingText}>
                Garansi sedang diverifikasi admin. Sertifikat PDF tersedia setelah disetujui.
              </Text>
            </View>
          )}

          {warranty.status === 'rejected' && (
            <View style={[styles.pendingNote, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
              <Text style={[styles.pendingText, { color: colors.danger }]}>
                {warranty.rejection_reason
                  ? `Garansi ditolak: ${warranty.rejection_reason}`
                  : 'Garansi ditolak admin. Hubungi toko tempat pemasangan untuk informasi lebih lanjut.'}
              </Text>
            </View>
          )}

        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.pill },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statusLabel: { fontWeight: '700', fontSize: fontSize.base },
  statusSub: { fontSize: fontSize.sm },
  codeBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeLabel: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  code: { fontSize: 22, fontWeight: '800', color: colors.accent, letterSpacing: 2, marginTop: 4 },
  table: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  techHeader: { padding: spacing.md, paddingBottom: spacing.xs },
  techHeaderText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
  rowValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600', flex: 1.2, textAlign: 'right' },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: 50,
  },
  downloadDisabled: { opacity: 0.6 },
  downloadText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.base },
  pendingNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pendingText: { flex: 1, fontSize: fontSize.sm, color: colors.warning, lineHeight: 18 },
  });
}
