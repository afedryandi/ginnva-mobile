import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError, API_BASE_URL, getToken } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import DateGrid from '@/components/ui/DateGrid';
import { hapticLight, hapticError, hapticSuccess } from '@/lib/haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

interface WarrantyClaimSummary {
  claim_number: string;
  category: string;
  description: string;
  status: 'pending' | 'pass' | 'reject';
  rejection_reason: string | null;
  created_at: string;
}

interface WarrantyDetail {
  id: number;
  warranty_code: string;
  customer_name: string;
  car_type: string;
  car_plate: string;
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
  // Toko/dealer terkait (kalau warranty ditautkan ke Store, bukan cuma
  // teks dealer_name) — dipakai untuk CTA "Hubungi Toko untuk Klaim".
  // Riwayat klaim after-sales — SEBELUMNYA tidak pernah dikirim ke
  // customer sama sekali walau datanya sudah ada di database (staff isi
  // lewat Filament). Lihat audit modul Garansi 2026-08-27.
  store: { name: string; phone: string | null } | null;
  claims: WarrantyClaimSummary[];
  // Fitur "Kuota Maintenance" (2026-09-25) -- semuanya null kalau garansi
  // ini memang tidak ditawarkan maintenance (lihat WarrantyResource,
  // field "Kuota Maintenance").
  maintenance_quota: number | null;
  maintenance_used: number | null;
  maintenance_remaining: number | null;
  maintenance_visits: { visited_at: string; note: string | null }[];
  // Bagian C, "Klaim Garansi & Maintenance PPF" (2026-10-01) -- occurrence
  // jadwal yang SEDANG aktif, null kalau belum pernah diaktifkan staff
  // ATAU kuota sudah habis tanpa occurrence tersisa.
  maintenance_schedule: {
    id: number;
    sequence: number;
    scheduled_date: string;
    status: 'pending' | 'confirmation_sent' | 'confirmed' | 'forfeited' | 'completed';
    // Masa toleransi 30 hari setelah scheduled_date; lewat dari valid_until (expired) customer wajib pilih tanggal baru.
    valid_until: string;
    expired: boolean;
    store_id: number | null;
  } | null;
  // Dipakai untuk bedakan "siklus otomatis belum pernah diaktifkan" (null)
  // vs "sudah diaktifkan tapi sekarang sudah selesai" (terisi, tapi
  // maintenance_schedule di atas null) -- lihat state kosong di bawah.
  maintenance_interval_months: number | null;
}

const CLAIM_STATUS_LABEL: Record<WarrantyClaimSummary['status'], string> = {
  pending: 'Menunggu Review',
  pass: 'Disetujui',
  reject: 'Ditolak',
};

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
    // Gap "revoke/void" diperbaiki 2026-09-25 (audit Garansi) -- sama
    // alasan dengan my-warranties.tsx, tanpa ini fallback ke badge hijau
    // "Aktif" yang menyesatkan untuk garansi yang baru dibatalkan.
    revoked:        { label: 'Dibatalkan',      color: colors.danger,   bg: colors.dangerBg,   icon: 'close-circle' },
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
  // Bagian C, "Klaim Garansi & Maintenance PPF" (2026-10-01).
  const [scheduleActionLoading, setScheduleActionLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const fetchWarranty = () => {
    if (!id) return;
    apiFetch<{ data: WarrantyDetail }>(`/api/customer/warranties/${id}`)
      .then((res) => setWarranty(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Gagal memuat detail garansi.'))
      .finally(() => setLoading(false));
  };

  useEffect(fetchWarranty, [id]);

  // Pemilih tanggal baru (reschedule): dibuka manual, atau wajib kalau jadwal sudah lewat masa toleransi.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState('');
  const [unavailableDates, setUnavailableDates] = useState<string[]>([]);
  const [datesLoading, setDatesLoading] = useState(false);
  const scheduleStoreId = warranty?.maintenance_schedule?.store_id ?? null;

  const scheduleExpired = warranty?.maintenance_schedule?.expired ?? false;

  useEffect(() => {
    if (!(pickerOpen || scheduleExpired) || !scheduleStoreId) return;
    let cancelled = false;
    setDatesLoading(true);
    apiFetch<{ data: string[] }>(`/api/stores/${scheduleStoreId}/unavailable-dates`, { skipAuth: true })
      .then((res) => { if (!cancelled) setUnavailableDates(res.data); })
      .catch(() => { if (!cancelled) setScheduleError('Ketersediaan tanggal gagal dimuat. Tanggal penuh bisa saja belum tertandai.'); })
      .finally(() => { if (!cancelled) setDatesLoading(false); });
    return () => { cancelled = true; };
  }, [pickerOpen, scheduleExpired, scheduleStoreId]);

  const handleScheduleConfirm = async (newDate?: string) => {
    if (!warranty?.maintenance_schedule) return;
    setScheduleActionLoading(true);
    setScheduleError(null);
    try {
      await apiFetch(`/api/customer/maintenance-schedules/${warranty.maintenance_schedule.id}/confirm`, {
        method: 'POST',
        ...(newDate ? { body: JSON.stringify({ preferred_date: newDate }) } : {}),
      });
      hapticSuccess();
      setPickerOpen(false);
      setPickedDate('');
      fetchWarranty();
    } catch (err) {
      hapticError();
      setScheduleError(err instanceof ApiError ? err.message : 'Gagal mengonfirmasi jadwal. Periksa koneksi internetmu.');
    } finally {
      setScheduleActionLoading(false);
    }
  };

  // Gap ditutup 2026-10-01 (audit Maintenance PPF, sisi mobile) --
  // SEBELUMNYA tombol Tolak langsung memanggil API tanpa konfirmasi apa
  // pun, padahal forfeit lewat app TIDAK reversibel (tidak ada undo untuk
  // customer, cuma staff lewat Histori Aktivitas). Pola Alert.alert sama
  // persis dengan handleCancel() di my-bookings.tsx.
  const handleScheduleDecline = () => {
    if (!warranty?.maintenance_schedule) return;

    Alert.alert(
      'Tolak Jadwal Maintenance?',
      'Jadwal ini akan dianggap tidak jadi datang. Kalau kuota masih tersisa, jadwal berikutnya akan otomatis disiapkan.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Ya, Tolak',
          style: 'destructive',
          onPress: async () => {
            setScheduleActionLoading(true);
            setScheduleError(null);
            try {
              await apiFetch(`/api/customer/maintenance-schedules/${warranty.maintenance_schedule!.id}/decline`, {
                method: 'POST',
              });
              hapticLight();
              fetchWarranty();
            } catch (err) {
              hapticError();
              setScheduleError(err instanceof ApiError ? err.message : 'Gagal memproses. Periksa koneksi internetmu.');
            } finally {
              setScheduleActionLoading(false);
            }
          },
        },
      ]
    );
  };

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
  const expiring = !!warranty && warranty.status === 'active' && warranty.remaining_days <= 30;

  // Satu bagian = judul kecil di luar kartu + kartu lembut di bawahnya.
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );

  const Row = ({ label, value, first, valueStyle }: { label: string; value: string; first?: boolean; valueStyle?: object }) => (
    <View style={[styles.row, !first && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueStyle]}>{value || '-'}</Text>
    </View>
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
        <Text style={styles.topTitle}>Detail Garansi</Text>
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
          <Text style={styles.errorText}>{error}</Text>
          <PressableScale style={styles.primaryBtn} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>Kembali</Text>
          </PressableScale>
        </View>
      ) : warranty && meta ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Kartu utama: status, produk, kendaraan, dan nomor E-Warranty dalam satu tampilan. */}
          <FadeInUp>
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon as never} size={14} color={meta.color} />
                  <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                </View>
                {warranty.status === 'active' && (
                  // Peringatan kuning kalau sisa hari <= 30 — sama pola dengan
                  // my-warranties.tsx. Lihat audit modul Garansi 2026-08-27.
                  <View style={[styles.daysChip, expiring && { backgroundColor: colors.warningBg }]}>
                    <Ionicons name={expiring ? 'alert-circle-outline' : 'time-outline'} size={14} color={expiring ? colors.warning : colors.textSecondary} />
                    <Text style={[styles.daysChipText, expiring && { color: colors.warning }]}>Sisa {warranty.remaining_days} hari</Text>
                  </View>
                )}
              </View>

              <Text style={styles.heroProduct}>{warranty.product_series}</Text>
              <View style={styles.heroCar}>
                <Text style={styles.heroCarText} numberOfLines={1}>{warranty.car_type}</Text>
                {warranty.car_plate ? (
                  <View style={styles.plate}>
                    <Text style={styles.plateText}>{warranty.car_plate}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Nomor E-Warranty</Text>
                {/* SEBELUMNYA render warranty.warranty_code langsung — kalau
                    masih null (garansi belum diisi Detail Instalasi oleh
                    staff, lihat WarrantyResource: kode di-generate otomatis
                    begitu kode gulungan dipilih), <Text> cuma render string
                    kosong, jadi kotak nomor tampil blank tanpa penjelasan
                    sama sekali. Ditemukan lewat testing manual 2026-08-31. */}
                <Text style={warranty.warranty_code ? styles.code : styles.codePending} selectable>
                  {warranty.warranty_code || 'Menunggu diproses staff toko'}
                </Text>
              </View>
            </View>
          </FadeInUp>

          {/* Detail rows */}
          <Section title="Informasi garansi">
            <Row first label="Nama Pemilik" value={warranty.customer_name} />
            {/* GAP DIPERBAIKI 2026-09-25 (audit Garansi) -- car_year
                SEBELUMNYA dipakai di sini tapi kolom itu tidak pernah
                ada di backend (model/migrasi/API) sama sekali, jadi
                selalu kosong. Dihapus daripada dibiarkan jadi field
                hantu yang tidak pernah tampil. */}
            <Row label="Dealer Pemasang" value={warranty.dealer_name} />
            <Row label="Tgl. Pemasangan" value={formatDate(warranty.installation_date)} />
            {/* Cuma ditonjolkan (merah aksen + tebal) kalau garansinya
                masih aktif — tanggal kedaluwarsa dari garansi yang
                sudah 'expired' tidak lagi relevan/berlaku, jadi tidak
                seharusnya diberi penekanan visual yang sama mencoloknya. */}
            <Row
              label="Berlaku Hingga"
              value={formatDate(warranty.expiry_date)}
              valueStyle={warranty.status === 'active' ? { color: colors.accent, fontWeight: '800' } : undefined}
            />
          </Section>

          {/* Spesifikasi teknis (kode gulungan) — cuma tampil kalau
              memang ada data-nya (mis. warranty lama belum dilengkapi
              staff, atau belum masuk tahap approve). */}
          {warranty.product_category === 'ppf' && (warranty.roll_number || warranty.roll_number_2) && (
            <Section title="Spesifikasi PPF">
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
                .map((row, i) => <Row key={i} first={i === 0} label={row.label} value={row.value} />)}
            </Section>
          )}

          {warranty.product_category === 'window_film' &&
            (warranty.roll_number_front || warranty.roll_number_side_rear) && (
            <Section title="Spesifikasi Window Film">
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
                .map((row, i) => <Row key={i} first={i === 0} label={row.label} value={row.value} />)}
            </Section>
          )}

          {/* Kuota Maintenance (2026-09-25) — cuma tampil kalau garansi ini
              memang ditawarkan maintenance (maintenance_quota terisi). */}
          {warranty.maintenance_quota !== null && (
            <Section title="Maintenance">
              <Row
                first
                label="Sisa Kunjungan"
                value={`${warranty.maintenance_remaining} dari ${warranty.maintenance_quota} kali`}
                valueStyle={{ color: (warranty.maintenance_remaining ?? 0) > 0 ? colors.accent : colors.textMuted, fontWeight: '800' }}
              />
              {warranty.maintenance_visits.length > 0 && warranty.maintenance_visits.map((visit, i) => (
                <Row key={i} label={formatDate(visit.visited_at)} value={visit.note || 'Kunjungan tercatat'} />
              ))}
            </Section>
          )}

          {/* Bagian C, "Klaim Garansi & Maintenance PPF" (2026-10-01) --
              occurrence jadwal yang sedang aktif. Tombol Konfirmasi/Tolak
              cuma tampil kalau status 'confirmation_sent' (push sudah
              terkirim) -- 'pending' murni menunggu masuk window pengingat,
              belum perlu aksi apa pun dari customer. */}
          {warranty.maintenance_schedule && (
            <View style={styles.scheduleCard}>
              <View style={styles.scheduleHeader}>
                <View style={styles.scheduleIcon}>
                  <Ionicons name="calendar-outline" size={22} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scheduleTitle}>
                    Jadwal Maintenance Ke-{warranty.maintenance_schedule.sequence}
                  </Text>
                  <Text style={styles.scheduleDate}>{formatDate(warranty.maintenance_schedule.scheduled_date)}</Text>
                </View>
              </View>
              <Text style={styles.scheduleHint}>
                {warranty.maintenance_schedule.expired
                  ? 'Jadwal ini sudah terlewat. Pilih tanggal baru untuk maintenance.'
                  : warranty.maintenance_schedule.status === 'confirmation_sent'
                    ? `Mohon konfirmasi kedatanganmu untuk jadwal ini (berlaku sampai ${formatDate(warranty.maintenance_schedule.valid_until)}).`
                    : 'Menunggu window konfirmasi dibuka.'}
              </Text>
              {scheduleError && <Text style={[styles.scheduleHint, { color: colors.danger }]}>{scheduleError}</Text>}
              {(warranty.maintenance_schedule.status === 'confirmation_sent' || warranty.maintenance_schedule.expired) && (
                <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
                  {!warranty.maintenance_schedule.expired && (
                    <PressableScale
                      style={styles.scheduleBtnPrimary}
                      onPress={() => handleScheduleConfirm()}
                      disabled={scheduleActionLoading}
                      accessibilityRole="button"
                    >
                      {scheduleActionLoading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
                          <Text style={styles.scheduleBtnPrimaryText}>Konfirmasi Kedatangan</Text>
                        </>
                      )}
                    </PressableScale>
                  )}
                  {!warranty.maintenance_schedule.expired && (
                    <Pressable
                      style={styles.scheduleBtnGhost}
                      onPress={() => setPickerOpen((open) => !open)}
                      disabled={scheduleActionLoading}
                    >
                      <Text style={styles.scheduleBtnGhostText}>{pickerOpen ? 'Tutup pilihan tanggal' : 'Pilih tanggal lain'}</Text>
                    </Pressable>
                  )}
                  {(pickerOpen || warranty.maintenance_schedule.expired) && (
                    <View style={{ marginTop: spacing.xs, gap: spacing.sm }}>
                      <DateGrid
                        value={pickedDate}
                        onChange={setPickedDate}
                        disabledDates={unavailableDates}
                        loading={datesLoading}
                        colors={colors}
                      />
                      <PressableScale
                        style={[styles.scheduleBtnPrimary, !pickedDate && { opacity: 0.5 }]}
                        onPress={() => handleScheduleConfirm(pickedDate)}
                        disabled={scheduleActionLoading || !pickedDate}
                        accessibilityRole="button"
                      >
                        {scheduleActionLoading ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <>
                            <Ionicons name="calendar-outline" size={20} color="#ffffff" />
                            <Text style={styles.scheduleBtnPrimaryText}>Konfirmasi Tanggal Ini</Text>
                          </>
                        )}
                      </PressableScale>
                    </View>
                  )}
                  <Pressable
                    style={styles.scheduleBtnGhost}
                    onPress={handleScheduleDecline}
                    disabled={scheduleActionLoading}
                  >
                    <Text style={styles.scheduleBtnGhostText}>Tidak bisa datang</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {/* Gap ditutup 2026-10-01 (audit Maintenance PPF, sisi mobile) --
              SEBELUMNYA kalau siklus otomatis sudah pernah diaktifkan staff
              (maintenance_interval_months terisi) tapi sudah selesai/berhenti
              (tidak ada occurrence aktif tersisa, forfeited/completed semua),
              bagian ini cuma hilang begitu saja tanpa penjelasan apa pun. */}
          {!warranty.maintenance_schedule && warranty.maintenance_interval_months !== null && (
            <View style={styles.scheduleCard}>
              <View style={styles.scheduleHeader}>
                <View style={[styles.scheduleIcon, { backgroundColor: colors.bg }]}>
                  <Ionicons name="checkmark-done-outline" size={22} color={colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scheduleTitle}>Siklus Maintenance Selesai</Text>
                </View>
              </View>
              <Text style={styles.scheduleHint}>
                Tidak ada jadwal maintenance otomatis yang aktif saat ini. Hubungi toko langsung kalau masih butuh maintenance.
              </Text>
            </View>
          )}

          {/* CTA klaim after-sales — Bagian B rancangan "Klaim Garansi &
              Maintenance PPF" (2026-10-01): SEBELUMNYA cuma buka WhatsApp
              manual (customer tetap harus jelaskan ulang semua detail ke
              staff). Sekarang warranty yang punya store_id langsung diarahkan
              ke form klaim in-app (warranty-claim.tsx), yang otomatis bikin
              WarrantyClaim + Booking sekaligus. Fallback WhatsApp/datangi
              dealer TETAP dipertahankan untuk warranty tanpa store_id (data
              lama/import, tidak terhubung toko manapun). Cuma tampil untuk
              garansi yang sudah aktif/approved — belum ada gunanya kalau
              garansinya sendiri belum sah. */}
          {warranty.status === 'active' && warranty.store && (
            <PressableScale
              style={styles.claimCta}
              onPress={() => {
                hapticLight();
                router.push(`/account/warranty-claim?id=${id}` as never);
              }}
              accessibilityRole="button"
            >
              <View style={styles.claimCtaIcon}>
                <Ionicons name="build-outline" size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.claimCtaTitle}>Ajukan Klaim Garansi</Text>
                <Text style={styles.claimCtaText}>
                  Isi detail klaim dan pilih jadwal kunjungan ke {warranty.store.name}.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </PressableScale>
          )}

          {warranty.status === 'active' && !warranty.store && warranty.dealer_name && (
            <View style={styles.claimCta}>
              <View style={styles.claimCtaIcon}>
                <Ionicons name="build-outline" size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.claimCtaTitle}>Butuh Klaim After-Sales?</Text>
                <Text style={styles.claimCtaText}>
                  Datangi langsung {warranty.dealer_name} untuk mengajukan klaim after-sales.
                </Text>
              </View>
            </View>
          )}

          {/* Riwayat klaim — SEBELUMNYA tidak pernah ditampilkan sama
              sekali walau staff sudah bisa mencatatnya lewat Filament. */}
          {warranty.claims.length > 0 && (
            <Section title="Riwayat klaim after-sales">
              {warranty.claims.map((claim, i) => (
                <View key={claim.claim_number} style={[styles.claimRow, i > 0 && styles.rowBorder]}>
                  <View style={styles.claimRowHeader}>
                    <Text style={styles.claimNumber}>{claim.claim_number}</Text>
                    <View
                      style={[
                        styles.claimBadge,
                        {
                          backgroundColor:
                            claim.status === 'pass' ? colors.successBg
                              : claim.status === 'reject' ? colors.dangerBg
                              : colors.warningBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.claimBadgeText,
                          {
                            color:
                              claim.status === 'pass' ? colors.success
                                : claim.status === 'reject' ? colors.danger
                                : colors.warning,
                          },
                        ]}
                      >
                        {CLAIM_STATUS_LABEL[claim.status]}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.claimCategory}>{claim.category}</Text>
                  {claim.description ? <Text style={styles.claimDescription}>{claim.description}</Text> : null}
                  {claim.status === 'reject' && claim.rejection_reason ? (
                    <Text style={[styles.claimDescription, { color: colors.danger }]}>
                      Alasan ditolak: {claim.rejection_reason}
                    </Text>
                  ) : null}
                </View>
              ))}
            </Section>
          )}

          {/* Download PDF — hanya kalau sudah approved */}
          {warranty.status === 'active' && (
            <PressableScale
              style={[styles.downloadBtn, downloading && styles.downloadDisabled]}
              onPress={() => { hapticLight(); handleDownload(); }}
              disabled={downloading}
              accessibilityRole="button"
            >
              {downloading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={20} color="#ffffff" />
                  <Text style={styles.downloadText}>Unduh Garansi</Text>
                </>
              )}
            </PressableScale>
          )}

          {downloadError && (
            <View style={[styles.note, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text style={[styles.noteText, { color: colors.danger }]}>{downloadError}</Text>
            </View>
          )}

          {warranty.status === 'pending_review' && (
            <View style={[styles.note, { backgroundColor: colors.warningBg }]}>
              <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
              <Text style={[styles.noteText, { color: colors.warning }]}>
                Garansi sedang diverifikasi admin. Sertifikat PDF tersedia setelah disetujui.
              </Text>
            </View>
          )}

          {warranty.status === 'rejected' && (
            <View style={[styles.note, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
              <Text style={[styles.noteText, { color: colors.danger }]}>
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
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    errorText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryBtn: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryBtnText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    scroll: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56, gap: 20 },

    hero: { padding: 20, gap: 14, borderRadius: 32, backgroundColor: colors.surfaceElevated },
    heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15 },
    statusPillText: { fontSize: 12, fontWeight: '800' },
    daysChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.bg },
    daysChipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    heroProduct: { fontSize: 24, lineHeight: 31, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary },
    heroCar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    heroCarText: { flexShrink: 1, fontSize: 14, color: colors.textSecondary },
    plate: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textPrimary, backgroundColor: colors.bg },
    plateText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textPrimary },

    codeBox: { alignItems: 'center', gap: 4, paddingVertical: 16, borderRadius: 22, backgroundColor: colors.bg },
    codeLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    code: { fontSize: 24, fontWeight: '800', letterSpacing: 2, color: colors.accent },
    codePending: { fontSize: 14, fontWeight: '600', color: colors.textMuted },

    sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted, marginBottom: 10, marginLeft: 6 },
    card: { borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 15, gap: 12 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowLabel: { fontSize: 14, color: colors.textSecondary, flex: 1 },
    rowValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '700', flex: 1.3, textAlign: 'right' },

    scheduleCard: { padding: 18, gap: 12, borderRadius: 28, backgroundColor: colors.accentSoft },
    scheduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    scheduleIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    scheduleTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    scheduleDate: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
    scheduleHint: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
    scheduleBtnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 26, backgroundColor: colors.accent },
    scheduleBtnPrimaryText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },
    scheduleBtnGhost: { alignItems: 'center', justifyContent: 'center', height: 44 },
    scheduleBtnGhostText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },

    claimCta: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    claimCtaIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    claimCtaTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    claimCtaText: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 2 },

    claimRow: { padding: 18, gap: 6 },
    claimRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
    claimNumber: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    claimBadge: { height: 24, paddingHorizontal: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    claimBadgeText: { fontSize: 11, fontWeight: '800' },
    claimCategory: { fontSize: 14, color: colors.textSecondary },
    claimDescription: { fontSize: 13, lineHeight: 19, color: colors.textMuted },

    downloadBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 58,
      borderRadius: 29,
      backgroundColor: colors.accent,
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.32,
      shadowRadius: 16,
      elevation: 6,
    },
    downloadDisabled: { opacity: 0.6 },
    downloadText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },

    note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 16, borderRadius: 20 },
    noteText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  });
}
