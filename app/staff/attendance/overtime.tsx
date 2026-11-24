import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import BookingPicker, { BookingOption } from '@/components/staff/BookingPicker';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { toLocalDateString } from '@/lib/dates';
import { useAppTheme } from '@/lib/theme-context';
import { formatTimeInput, isInvalidTime, INVALID_TIME_MESSAGE } from '@/lib/time-input';

// Pengajuan Lembur (2026-11-12, keputusan pemilik): lembur tidak boleh seenaknya. Wajib diajukan SEBELUM dimulai, dengan pekerjaan yang jelas
// (pilih Booking atau tulis uraian), lalu disetujui store manager atau admin. Hanya jam yang disetujui diakui sebagai lembur. Aturan penuh
// ada di server (OvertimeRequestService); layar ini hanya memberi umpan balik cepat sebelum kirim.

interface OvertimeRecord {
  id: number;
  date: string;
  starts_at: string;
  ends_at: string;
  minutes: number;
  booking_number: string | null;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  review_notes: string | null;
  reviewer_name: string | null;
  can_cancel: boolean;
}

interface Limits {
  min_minutes: number;
  max_hours_per_day: number;
  max_hours_per_week: number;
  max_days_ahead: number;
}

const DEFAULT_LIMITS: Limits = { min_minutes: 30, max_hours_per_day: 4, max_hours_per_week: 18, max_days_ahead: 14 };

const STATUS_META: Record<OvertimeRecord['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu Persetujuan', color: 'warning', bg: 'warningBg' },
  approved: { label: 'Disetujui', color: 'success', bg: 'successBg' },
  rejected: { label: 'Ditolak', color: 'danger', bg: 'dangerBg' },
  cancelled: { label: 'Dibatalkan', color: 'textMuted', bg: 'surface' },
};

const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace('.', ',')} jam`;
}

export default function StaffOvertimeScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [requests, setRequests] = useState<OvertimeRecord[]>([]);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(() => new Date());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [booking, setBooking] = useState<BookingOption | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ overtime_requests: OvertimeRecord[]; limits: Limits }>('/api/staff/overtime-requests');
      setRequests(res.overtime_requests);
      setLimits(res.limits);
    } catch {
      setError('Gagal memuat pengajuan lembur. Periksa koneksi internet.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const today = new Date();
  const todayKey = toLocalDateString(today);
  const maxDate = addDays(today, limits.max_days_ahead);
  const isMaxDate = toLocalDateString(date) >= toLocalDateString(maxDate);

  const stepDate = (delta: number) => {
    const next = addDays(date, delta);
    if (toLocalDateString(next) < todayKey || toLocalDateString(next) > toLocalDateString(maxDate)) return;
    setDate(next);
  };

  const timesValid = TIME_FORMAT.test(startTime.trim()) && TIME_FORMAT.test(endTime.trim());
  const durationMinutes = timesValid ? toMinutes(endTime.trim()) - toMinutes(startTime.trim()) : 0;
  const durationOk = timesValid && durationMinutes >= limits.min_minutes && durationMinutes <= limits.max_hours_per_day * 60;
  const workOk = booking !== null || description.trim().length > 0;
  const isFormValid = durationOk && workOk;

  const timeHint = !timesValid
    ? `Format 24 jam (HH:MM), mulai dan selesai di hari yang sama.`
    : durationMinutes <= 0
      ? 'Jam selesai harus setelah jam mulai.'
      : durationMinutes < limits.min_minutes
        ? `Lembur minimal ${limits.min_minutes} menit.`
        : durationMinutes > limits.max_hours_per_day * 60
          ? `Lembur paling banyak ${limits.max_hours_per_day} jam per hari.`
          : `Durasi ${formatHours(durationMinutes)}.`;

  const handleSubmit = useCallback(async () => {
    if (!isFormValid || submitting) return;

    setSubmitting(true);
    try {
      const res = await staffApiFetch<{ message: string }>('/api/staff/overtime-requests', {
        method: 'POST',
        body: JSON.stringify({
          date: toLocalDateString(date),
          start_time: startTime.trim(),
          end_time: endTime.trim(),
          booking_id: booking?.id ?? null,
          description: description.trim() || null,
        }),
      });
      Alert.alert('Terkirim', res.message);
      setStartTime('');
      setEndTime('');
      setBooking(null);
      setDescription('');
      load();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [isFormValid, submitting, date, startTime, endTime, booking, description, load]);

  const handleCancel = useCallback((item: OvertimeRecord) => {
    Alert.alert('Batalkan Pengajuan', `Batalkan lembur ${new Date(item.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} pukul ${formatTime(item.starts_at)}–${formatTime(item.ends_at)}?`, [
      { text: 'Tidak', style: 'cancel' },
      {
        text: 'Ya, Batalkan', style: 'destructive', onPress: async () => {
          setCancellingId(item.id);
          try {
            await staffApiFetch(`/api/staff/overtime-requests/${item.id}/cancel`, { method: 'POST' });
            load();
          } catch (err) {
            Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
          } finally {
            setCancellingId(null);
          }
        },
      },
    ]);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <SkeletonCards count={3} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Pengajuan Lembur</Text>
        <View style={styles.sideButton} />
      </View>

      <FlatList
        data={requests}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.rulesBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
              <Text style={styles.rulesText}>
                Lembur harus diajukan dan disetujui SEBELUM dikerjakan. Hanya jam yang disetujui diakui sebagai lembur. Batas {limits.max_hours_per_day} jam per hari dan {limits.max_hours_per_week} jam per minggu.
              </Text>
            </View>

            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Pengajuan Baru</Text>

              <Text style={styles.fieldLabel}>Tanggal Lembur</Text>
              <View style={styles.dateStepper}>
                <Pressable style={styles.dateStepButton} onPress={() => stepDate(-1)} hitSlop={8} disabled={toLocalDateString(date) <= todayKey}>
                  <Ionicons name="chevron-back" size={18} color={toLocalDateString(date) <= todayKey ? colors.textMuted : colors.textPrimary} />
                </Pressable>
                <Text style={styles.dateStepperText}>{formatDateLabel(date)}</Text>
                <Pressable style={styles.dateStepButton} onPress={() => stepDate(1)} hitSlop={8} disabled={isMaxDate}>
                  <Ionicons name="chevron-forward" size={18} color={isMaxDate ? colors.textMuted : colors.textPrimary} />
                </Pressable>
              </View>

              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>Jam Mulai</Text>
                  <TextInput
                    style={[styles.timeInput, isInvalidTime(startTime) && { color: colors.danger, borderColor: colors.danger }]}
                    value={startTime}
                    onChangeText={(v) => setStartTime((prev) => formatTimeInput(v, prev))}
                    placeholder="18:00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>Jam Selesai</Text>
                  <TextInput
                    style={[styles.timeInput, isInvalidTime(endTime) && { color: colors.danger, borderColor: colors.danger }]}
                    value={endTime}
                    onChangeText={(v) => setEndTime((prev) => formatTimeInput(v, prev))}
                    placeholder="20:00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                </View>
              </View>
              <Text style={[styles.formHint, (isInvalidTime(startTime) || isInvalidTime(endTime) || (timesValid && !durationOk)) ? { color: colors.danger } : null]}>{isInvalidTime(startTime) || isInvalidTime(endTime) ? INVALID_TIME_MESSAGE : timeHint}</Text>

              <Text style={styles.fieldLabel}>Pekerjaan yang Dilembur</Text>
              <BookingPicker
                value={booking}
                onChange={setBooking}
                endpoint="/api/staff/overtime-requests/bookings"
                colors={colors}
              />
              <TextInput
                style={styles.textArea}
                value={description}
                onChangeText={setDescription}
                placeholder="Contoh: menyelesaikan pemasangan PPF mobil pelanggan yang tertunda"
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
              />

              <Button
                label={submitting ? 'Mengirim...' : 'Ajukan Lembur'}
                onPress={handleSubmit}
                disabled={!isFormValid || submitting}
                style={styles.submitButton}
              />
            </View>

            <Text style={styles.historyTitle}>Riwayat Pengajuan</Text>
          </View>
        }
        renderItem={({ item }) => {
          const meta = STATUS_META[item.status];
          return (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.rowDate}>{new Date(item.date).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                <View style={[styles.statusBadge, { backgroundColor: colors[meta.bg] as string }]}>
                  <Text style={[styles.statusText, { color: colors[meta.color] as string }]}>{meta.label}</Text>
                </View>
              </View>
              <Text style={styles.rowTimes}>{formatTime(item.starts_at)}–{formatTime(item.ends_at)} · {formatHours(item.minutes)}</Text>
              <Text style={styles.rowWork}>
                {[item.booking_number ? `Booking ${item.booking_number}` : null, item.description].filter(Boolean).join(' — ') || '—'}
              </Text>
              {item.can_cancel ? (
                <Pressable style={styles.cancelButton} onPress={() => handleCancel(item)} disabled={cancellingId === item.id}>
                  {cancellingId === item.id ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <Text style={styles.cancelButtonText}>Batalkan Pengajuan</Text>
                  )}
                </Pressable>
              ) : null}
              {item.status !== 'pending' && item.review_notes ? (
                <Text style={styles.rowReviewNote}>Catatan {item.reviewer_name ?? 'atasan'}: {item.review_notes}</Text>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>Belum ada pengajuan lembur.</Text>}
        contentContainerStyle={styles.listContent}
      />
      </KeyboardAvoidingView>
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
    listContent: { padding: spacing.md, paddingBottom: spacing.xxl },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },

    rulesBox: {
      flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
      backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md,
    },
    rulesText: { flex: 1, fontSize: fontSize.xs, color: colors.warning, lineHeight: 16 },

    formCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.lg,
      gap: spacing.xs,
    },
    formTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    formHint: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs, lineHeight: 16 },
    fieldLabel: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
    dateStepper: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    },
    dateStepButton: { padding: spacing.xs },
    dateStepperText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary, textTransform: 'capitalize' },
    timeRow: { flexDirection: 'row', gap: spacing.sm },
    timeField: { flex: 1 },
    timeInput: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.base,
      color: colors.textPrimary, backgroundColor: colors.bg, textAlign: 'center', fontVariant: ['tabular-nums'],
    },
    textArea: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.sm,
      color: colors.textPrimary, backgroundColor: colors.bg, minHeight: 72, textAlignVertical: 'top', marginTop: spacing.xs,
    },
    submitButton: { marginTop: spacing.md },

    historyTitle: {
      fontSize: fontSize.xs, fontWeight: '800', color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
    },
    row: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.sm, gap: 4,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowDate: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
    statusText: { fontSize: fontSize.xs, fontWeight: '700' },
    rowTimes: { fontSize: fontSize.xs, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    rowWork: { fontSize: fontSize.sm, color: colors.textPrimary },
    rowReviewNote: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic' },
    cancelButton: { alignSelf: 'flex-start', paddingVertical: 4, marginTop: spacing.xs },
    cancelButtonText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.danger },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  });
}
