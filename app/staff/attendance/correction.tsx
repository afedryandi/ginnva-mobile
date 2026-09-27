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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

// Gap ditutup 2026-09-26 (audit Absensi Karyawan, "tidak ada jalur
// pengajuan koreksi dari mobile app") -- SEBELUMNYA staff yang salah
// tekan/lupa absen harus minta admin/store manager buatkan koreksi
// manual di Filament. Layar ini titik masuk baru ke
// AttendanceCorrectionService::submit() yang sudah ada -- alur approval
// berjenjang (store_manager/full-access) TIDAK berubah sama sekali.
// Dibatasi entry_type='manual' saja (isi jam masuk/keluar yang lupa
// tercatat) -- jenis lain (Dinas Luar/Alpha/Izin) tetap khusus admin.

interface CorrectionRecord {
  id: number;
  date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  review_notes: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const STATUS_META: Record<CorrectionRecord['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu Persetujuan', color: 'warning', bg: 'warningBg' },
  approved: { label: 'Disetujui', color: 'success', bg: 'successBg' },
  rejected: { label: 'Ditolak', color: 'danger', bg: 'dangerBg' },
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
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
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [requests, setRequests] = useState<CorrectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(new Date());
  const [clockInTime, setClockInTime] = useState('');
  const [clockOutTime, setClockOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }, [loadRequests]);

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

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

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
        <Text style={styles.headerTitle} numberOfLines={1}>Ajukan Koreksi Absensi</Text>
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

            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Pengajuan Baru</Text>
              <Text style={styles.formHint}>
                Untuk lupa absen masuk/keluar atau salah jam. Perlu persetujuan admin/store manager sebelum tercatat.
              </Text>

              <Text style={styles.fieldLabel}>Tanggal</Text>
              <View style={styles.dateStepper}>
                <Pressable style={styles.dateStepButton} onPress={() => stepDate(-1)} hitSlop={8}>
                  <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
                </Pressable>
                <Text style={styles.dateStepperText}>{formatDateLabel(date)}</Text>
                <Pressable
                  style={styles.dateStepButton}
                  onPress={() => stepDate(1)}
                  hitSlop={8}
                  disabled={toDateInputValue(date) === toDateInputValue(new Date())}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={toDateInputValue(date) === toDateInputValue(new Date()) ? colors.textMuted : colors.textPrimary}
                  />
                </Pressable>
              </View>

              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>Jam Masuk</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={clockInTime}
                    onChangeText={setClockInTime}
                    placeholder="08:00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>Jam Keluar</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={clockOutTime}
                    onChangeText={setClockOutTime}
                    placeholder="17:00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
              </View>
              <Text style={styles.formHint}>Format 24 jam (HH:MM). Isi minimal salah satu.</Text>

              <Text style={styles.fieldLabel}>Alasan</Text>
              <TextInput
                style={styles.textArea}
                value={reason}
                onChangeText={setReason}
                placeholder="Contoh: lupa absen keluar karena HP mati"
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
              />

              <Button
                label={submitting ? 'Mengirim...' : 'Kirim Pengajuan'}
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
                <Text style={styles.rowDate}>{formatDateShort(item.date)}</Text>
                <View style={[styles.statusBadge, { backgroundColor: colors[meta.bg] as string }]}>
                  <Text style={[styles.statusText, { color: colors[meta.color] as string }]}>{meta.label}</Text>
                </View>
              </View>
              <Text style={styles.rowTimes}>
                Masuk {formatTime(item.clock_in_at)} · Keluar {formatTime(item.clock_out_at)}
              </Text>
              <Text style={styles.rowReason}>{item.reason}</Text>
              {item.status !== 'pending' && item.review_notes ? (
                <Text style={styles.rowReviewNote}>
                  Catatan {item.reviewer_name ?? 'admin'}: {item.review_notes}
                </Text>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>Belum ada pengajuan koreksi.</Text>}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
      color: colors.textPrimary, backgroundColor: colors.bg, minHeight: 72, textAlignVertical: 'top',
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
    rowReason: { fontSize: fontSize.sm, color: colors.textPrimary },
    rowReviewNote: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic' },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  });
}
