import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { toLocalDateString } from '@/lib/dates';
import { useAppTheme } from '@/lib/theme-context';
import { formatTimeInput, isInvalidTime, INVALID_TIME_MESSAGE } from '@/lib/time-input';

// Gap ditutup 2026-09-26 (audit Absensi Karyawan, "tidak ada jalur
// pengajuan koreksi dari mobile app") -- SEBELUMNYA staff yang salah
// tekan/lupa absen harus minta admin/store manager buatkan koreksi
// manual di Filament. Layar ini titik masuk baru ke
// AttendanceCorrectionService::submit() yang sudah ada -- alur approval
// berjenjang (store_manager/full-access) TIDAK berubah sama sekali.
// Dibatasi entry_type='manual' saja (isi jam masuk/keluar yang lupa
// tercatat) -- jenis lain (Dinas Luar/Alpha/Izin) tetap khusus admin.
// Tampilan dirancang ulang 2026-11-17, selaras dengan Izin & Cuti dan formulir SPK: kartu putih membulat di atas latar abu-putih,
// jam masuk/keluar berupa dua ubin besar, dan tombol kirim yang selalu terlihat di bawah.

interface CorrectionRecord {
  id: number;
  date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  review_notes: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const STATUS_META: Record<CorrectionRecord['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu Persetujuan', color: 'warning', bg: 'warningBg' },
  approved: { label: 'Disetujui', color: 'success', bg: 'successBg' },
  rejected: { label: 'Ditolak', color: 'danger', bg: 'dangerBg' },
  cancelled: { label: 'Dibatalkan Sendiri', color: 'textMuted', bg: 'surfaceElevated' },
};

interface ExistingAttendance {
  date: string;
  entry_type: 'clock' | 'manual' | 'field_duty' | 'alpha' | 'leave';
  clock_in_at: string | null;
  clock_out_at: string | null;
}

const ENTRY_TYPE_LABEL: Record<ExistingAttendance['entry_type'], string> = {
  clock: 'Normal (App)',
  manual: 'Manual',
  field_duty: 'Dinas Luar',
  alpha: 'Alpha (Tanpa Keterangan)',
  leave: 'Izin/Cuti',
};

function toDateInputValue(date: Date): string {
  return toLocalDateString(date);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// Validasi format jam HH:MM sederhana di sisi app -- BUKAN pengganti
// validasi backend (date_format:H:i), cuma supaya staff dapat feedback
// instan sebelum submit.
const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

export default function StaffAttendanceCorrectionScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  const [requests, setRequests] = useState<CorrectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dibuka dari baris riwayat absensi dengan ?date=YYYY-MM-DD agar tanggalnya sudah terisi; tanggal masa depan atau salah format diabaikan.
  const params = useLocalSearchParams<{ date?: string }>();
  const [date, setDate] = useState(() => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.date ?? '');
    const parsed = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;

    return parsed && parsed <= new Date() ? parsed : new Date();
  });
  const [clockInTime, setClockInTime] = useState('');
  const [clockOutTime, setClockOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // UX diperbaiki 2026-09-27 (audit Koreksi Absensi) -- SEBELUMNYA staff
  // sama sekali tidak diberi tahu kalau tanggal yang dipilih sudah punya
  // baris absensi (mis. sudah absen Normal, atau tercatat Izin/Cuti resmi)
  // sebelum submit -- baru admin yang menyadarinya (atau tidak) saat
  // approve. Fetch riwayat bulan berjalan tiap kali tanggal berubah, cari
  // baris yang cocok, tampilkan sebagai konteks di atas form.
  const [existingAttendance, setExistingAttendance] = useState<ExistingAttendance | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);

  const loadRequests = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ corrections: CorrectionRecord[] }>('/api/staff/attendance/corrections');
      setRequests(res.corrections);
    } catch {
      setError('Gagal memuat riwayat pengajuan koreksi.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadRequests().finally(() => setLoading(false));
  }, [loadRequests]);

  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const handleCancel = useCallback((request: CorrectionRecord) => {
    Alert.alert('Batalkan Pengajuan', `Batalkan pengajuan koreksi tanggal ${formatDateShort(request.date)}?`, [
      { text: 'Tidak', style: 'cancel' },
      {
        text: 'Ya, Batalkan', style: 'destructive', onPress: async () => {
          setCancellingId(request.id);
          try {
            await staffApiFetch(`/api/staff/attendance/corrections/${request.id}/cancel`, { method: 'POST' });
            loadRequests();
          } catch (err) {
            Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
          } finally {
            setCancellingId(null);
          }
        },
      },
    ]);
  }, [loadRequests]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }, [loadRequests]);

  useEffect(() => {
    const dateValue = toDateInputValue(date);
    const monthParam = dateValue.slice(0, 7);
    let cancelled = false;
    setCheckingExisting(true);

    staffApiFetch<{ attendances: ExistingAttendance[] }>(`/api/staff/attendance/history?month=${monthParam}`)
      .then((res) => {
        if (cancelled) return;
        setExistingAttendance(res.attendances.find((a) => a.date === dateValue) ?? null);
      })
      .catch(() => {
        if (!cancelled) setExistingAttendance(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingExisting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  const stepDate = (delta: number) => {
    const next = addDays(date, delta);
    if (delta > 0 && next > new Date()) return; // tidak boleh maju ke masa depan
    setDate(next);
  };

  const isFormValid =
    reason.trim().length > 0 &&
    (clockInTime.trim().length > 0 || clockOutTime.trim().length > 0) &&
    (clockInTime.trim().length === 0 || TIME_FORMAT.test(clockInTime.trim())) &&
    (clockOutTime.trim().length === 0 || TIME_FORMAT.test(clockOutTime.trim()));

  const handleSubmit = useCallback(async () => {
    if (!isFormValid) return;

    setSubmitting(true);
    try {
      const res = await staffApiFetch<{ message: string }>('/api/staff/attendance/corrections', {
        method: 'POST',
        body: JSON.stringify({
          date: toDateInputValue(date),
          clock_in_at: clockInTime.trim() || null,
          clock_out_at: clockOutTime.trim() || null,
          reason: reason.trim(),
        }),
      });
      Alert.alert('Terkirim', res.message);
      setClockInTime('');
      setClockOutTime('');
      setReason('');
      loadRequests();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [isFormValid, date, clockInTime, clockOutTime, reason, loadRequests]);

  const isToday = toDateInputValue(date) === toDateInputValue(new Date());

  const header = (
    <View style={styles.header}>
      {router.canGoBack() ? (
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      <Text style={styles.title} numberOfLines={1}>Koreksi Absensi</Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {header}
        <SkeletonCards count={3} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {header}

        <FlatList
          data={requests}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Tanggal */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name="calendar-outline" size={18} color={accentText} />
                  </View>
                  <Text style={styles.sectionTitle}>Tanggal yang dikoreksi</Text>
                </View>

                <View style={styles.dateStepper}>
                  <Pressable style={styles.stepButton} onPress={() => stepDate(-1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Hari sebelumnya">
                    <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
                  </Pressable>
                  <Text style={styles.dateText} numberOfLines={2}>{formatDateLabel(date)}</Text>
                  <Pressable
                    style={[styles.stepButton, isToday && styles.stepButtonDisabled]}
                    onPress={() => stepDate(1)}
                    hitSlop={8}
                    disabled={isToday}
                    accessibilityRole="button"
                    accessibilityLabel="Hari berikutnya"
                  >
                    <Ionicons name="chevron-forward" size={18} color={isToday ? colors.textMuted : colors.textPrimary} />
                  </Pressable>
                </View>

                {checkingExisting ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : existingAttendance ? (
                  <View style={styles.existingBanner}>
                    <Ionicons name="information-circle-outline" size={17} color={colors.warning} />
                    <Text style={styles.existingBannerText}>
                      Tanggal ini sudah tercatat: {ENTRY_TYPE_LABEL[existingAttendance.entry_type]}
                      {existingAttendance.clock_in_at || existingAttendance.clock_out_at
                        ? ` (${formatTime(existingAttendance.clock_in_at)}–${formatTime(existingAttendance.clock_out_at)})`
                        : ''}
                      . Mengajukan koreksi akan MENIMPA data ini kalau disetujui.
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Jam */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name="time-outline" size={18} color={accentText} />
                  </View>
                  <Text style={styles.sectionTitle}>Jam yang benar</Text>
                </View>

                <View style={styles.timeRow}>
                  <View style={styles.timeTile}>
                    <View style={styles.timeTileTop}>
                      <Ionicons name="log-in-outline" size={16} color={colors.textMuted} />
                      <Text style={styles.timeLabel}>Masuk</Text>
                    </View>
                    <AppTextInput
                      style={[styles.timeInput, isInvalidTime(clockInTime) && { color: colors.danger }]}
                      value={clockInTime}
                      onChangeText={(v) => setClockInTime((prev) => formatTimeInput(v, prev))}
                      placeholder="08:00"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={5}
                    />
                  </View>
                  <View style={styles.timeTile}>
                    <View style={styles.timeTileTop}>
                      <Ionicons name="log-out-outline" size={16} color={colors.textMuted} />
                      <Text style={styles.timeLabel}>Keluar</Text>
                    </View>
                    <AppTextInput
                      style={[styles.timeInput, isInvalidTime(clockOutTime) && { color: colors.danger }]}
                      value={clockOutTime}
                      onChangeText={(v) => setClockOutTime((prev) => formatTimeInput(v, prev))}
                      placeholder="17:00"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={5}
                    />
                  </View>
                </View>
                <Text style={[styles.hint, (isInvalidTime(clockInTime) || isInvalidTime(clockOutTime)) && { color: colors.danger }]}>{isInvalidTime(clockInTime) || isInvalidTime(clockOutTime) ? INVALID_TIME_MESSAGE : 'Format 24 jam (HH:MM). Isi minimal salah satu.'}</Text>
              </View>

              {/* Alasan */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name="chatbox-ellipses-outline" size={18} color={accentText} />
                  </View>
                  <Text style={styles.sectionTitle}>Alasan</Text>
                </View>
                <AppTextInput
                  style={styles.textArea}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Contoh: lupa absen keluar karena HP mati"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <Text style={styles.historyTitle}>Riwayat pengajuan</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const meta = STATUS_META[item.status];
            const tone = colors[meta.color];

            return (
              <FadeInUp index={index} enabled={index < 6}>
                <View style={styles.row}>
                  <View style={styles.rowTop}>
                    <Text style={styles.rowDate}>{formatDateShort(item.date)}</Text>
                    <View style={[styles.statusPill, { backgroundColor: colors[meta.bg] }]}>
                      <View style={[styles.statusDot, { backgroundColor: tone }]} />
                      <Text style={[styles.statusText, { color: tone }]}>{meta.label}</Text>
                    </View>
                  </View>

                  <View style={styles.rowTimes}>
                    <View style={styles.rowTimeCell}>
                      <Text style={styles.rowTimeLabel}>Masuk</Text>
                      <Text style={styles.rowTimeValue}>{formatTime(item.clock_in_at)}</Text>
                    </View>
                    <View style={styles.rowTimeDivider} />
                    <View style={styles.rowTimeCell}>
                      <Text style={styles.rowTimeLabel}>Keluar</Text>
                      <Text style={styles.rowTimeValue}>{formatTime(item.clock_out_at)}</Text>
                    </View>
                  </View>

                  <Text style={styles.rowReason}>{item.reason}</Text>

                  {item.status !== 'pending' && item.review_notes ? (
                    <View style={styles.noteBox}>
                      <Text style={styles.noteLabel}>Catatan {item.reviewer_name ?? 'admin'}</Text>
                      <Text style={styles.noteText}>{item.review_notes}</Text>
                    </View>
                  ) : null}

                  {item.status === 'pending' ? (
                    <Pressable style={styles.cancelButton} onPress={() => handleCancel(item)} disabled={cancellingId === item.id} accessibilityRole="button" accessibilityLabel="Batalkan pengajuan">
                      {cancellingId === item.id ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Text style={styles.cancelButtonText}>Batalkan pengajuan</Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              </FadeInUp>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={30} color={colors.textMuted} />
              <Text style={styles.emptyText}>Belum ada pengajuan koreksi.</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <PressableScale
            style={[styles.submit, (!isFormValid || submitting) && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={!isFormValid || submitting}
            accessibilityRole="button"
            accessibilityLabel="Kirim pengajuan koreksi"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="paper-plane-outline" size={20} color="#ffffff" />
                <Text style={styles.submitText}>Kirim Pengajuan</Text>
              </>
            )}
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan Beranda, Izin & Cuti, dan formulir SPK: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    title: { flex: 1, fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.xs, paddingBottom: spacing.xl },
    headerBlock: { gap: 16, marginBottom: 14 },
    errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.dangerBg },
    errorText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.danger, lineHeight: 20 },

    section: { gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sectionIcon: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    sectionTitle: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    dateStepper: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 20, backgroundColor: chip },
    stepButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: card },
    stepButtonDisabled: { opacity: 0.5 },
    dateText: { flex: 1, textAlign: 'center', fontSize: fontSize.sm + 1, fontWeight: '700', lineHeight: 21, color: colors.textPrimary, textTransform: 'capitalize' },
    existingBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 16, backgroundColor: colors.warningBg },
    existingBannerText: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 18, color: colors.warning },

    timeRow: { flexDirection: 'row', gap: 12 },
    timeTile: { flex: 1, gap: 6, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 20, backgroundColor: chip },
    timeTileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    timeLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
    timeInput: { height: 48, padding: 0, textAlign: 'center', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    hint: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },

    textArea: { minHeight: 104, padding: 14, borderRadius: 20, backgroundColor: chip, fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textPrimary },

    historyTitle: { marginTop: 6, fontSize: 13, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },

    row: { gap: 14, padding: 18, marginBottom: 12, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    rowDate: { flexShrink: 1, fontSize: fontSize.base + 1, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { fontSize: 12, fontWeight: '800' },
    rowTimes: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: chip },
    rowTimeCell: { flex: 1, gap: 2 },
    rowTimeDivider: { width: 1, alignSelf: 'stretch', marginHorizontal: 14, backgroundColor: line },
    rowTimeLabel: { fontSize: 11.5, fontWeight: '700', color: colors.textMuted },
    rowTimeValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    rowReason: { fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textSecondary },
    noteBox: { gap: 2, padding: 14, borderRadius: 18, backgroundColor: chip },
    noteLabel: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },
    noteText: { fontSize: fontSize.sm, lineHeight: 20, color: colors.textSecondary },
    cancelButton: { alignSelf: 'flex-start', minWidth: 44, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerBg },
    cancelButtonText: { fontSize: 12.5, fontWeight: '800', color: colors.danger },

    emptyState: { alignItems: 'center', gap: 8, paddingVertical: spacing.xl },
    emptyText: { fontSize: fontSize.sm, fontWeight: '500', textAlign: 'center', color: colors.textMuted },

    footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: screenBg, borderTopWidth: 1, borderTopColor: line },
    submit: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 4,
    },
    submitDisabled: { opacity: 0.5 },
    submitText: { fontSize: fontSize.base, fontWeight: '700', color: '#ffffff' },
  });
}
