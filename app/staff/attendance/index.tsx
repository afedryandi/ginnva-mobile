import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface AttendanceRecord {
  id: number;
  date: string;
  entry_type: 'clock' | 'manual' | 'field_duty' | 'alpha' | 'leave';
  clock_in_at: string | null;
  clock_out_at: string | null;
  clock_in_distance_meters: number | null;
  late_minutes: number;
  early_leave_minutes: number;
  note: string | null;
}

interface StoreInfo {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
}

const ENTRY_TYPE_LABEL: Record<AttendanceRecord['entry_type'], string> = {
  clock: 'Normal',
  manual: 'Manual',
  field_duty: 'Dinas Luar',
  alpha: 'Alpha (Tanpa Keterangan)',
  leave: 'Izin/Cuti',
};

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
}

function toMonthParam(month: Date): string {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(month: Date): string {
  return month.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Haversine — SAMA PERSIS rumus Store::distanceMetersTo() di backend,
 * dipakai buat pre-check jarak SEBELUM staff menekan Absen Masuk/Keluar
 * (bukan pengganti validasi backend, cuma supaya staff tahu lebih awal
 * kalau bakal ditolak, tanpa perlu tambah dependency peta baru).
 */
function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const latDelta = toRad(lat2 - lat1);
  const lngDelta = toRad(lng2 - lng1);

  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(lngDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function StaffAttendanceScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [today, setToday] = useState<AttendanceRecord | null>(null);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [totalLateMinutes, setTotalLateMinutes] = useState(0);
  const [historyMonth, setHistoryMonth] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingDistance, setCheckingDistance] = useState(false);
  const [checkedDistance, setCheckedDistance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setError(null);
    try {
      const todayRes = await staffApiFetch<{ attendance: AttendanceRecord | null; store: StoreInfo | null }>('/api/staff/attendance/today');
      setToday(todayRes.attendance);
      setStore(todayRes.store);
    } catch {
      setError('Gagal memuat data absensi. Periksa koneksi internet Anda.');
    }
  }, []);

  const loadHistory = useCallback(async (month: Date) => {
    try {
      const historyRes = await staffApiFetch<{ attendances: AttendanceRecord[]; total_late_minutes: number }>(
        `/api/staff/attendance/history?month=${toMonthParam(month)}`
      );
      setHistory(historyRes.attendances);
      setTotalLateMinutes(historyRes.total_late_minutes);
    } catch {
      setError('Gagal memuat riwayat absensi. Periksa koneksi internet Anda.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadToday(), loadHistory(historyMonth)]).finally(() => setLoading(false));
    // historyMonth SENGAJA tidak dimasukkan dependency di sini — navigasi
    // bulan ditangani goToMonth() sendiri (lihat di bawah), efek ini cuma
    // untuk load pertama kali layar dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadToday]);

  const goToMonth = useCallback(async (delta: number) => {
    const next = new Date(historyMonth.getFullYear(), historyMonth.getMonth() + delta, 1);
    if (delta > 0 && next > new Date()) return; // tidak boleh maju ke bulan depan
    setHistoryMonth(next);
    setHistoryLoading(true);
    await loadHistory(next);
    setHistoryLoading(false);
  }, [historyMonth, loadHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadToday(), loadHistory(historyMonth)]);
    setRefreshing(false);
  }, [loadToday, loadHistory, historyMonth]);

  const getLocationOrAlert = useCallback(async (): Promise<Location.LocationObject | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Izin Lokasi Diperlukan',
        'Ginnva memerlukan akses lokasi untuk mencatat absensi dari lokasi toko. Aktifkan izin lokasi di pengaturan HP.'
      );
      return null;
    }

    try {
      // Highest (bukan Balanced) — absen cuma minta 1 titik lokasi sesaat,
      // jadi trade-off baterai/waktu tunggu sedikit lebih lama sepadan
      // dengan akurasi jarak yang jauh lebih presisi (Balanced bisa
      // meleset ratusan meter, terutama di dalam ruangan).
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    } catch {
      Alert.alert('Gagal Ambil Lokasi', 'Tidak bisa mendapatkan lokasi saat ini. Pastikan GPS aktif lalu coba lagi.');
      return null;
    }
  }, []);

  const handleClockIn = useCallback(async () => {
    const position = await getLocationOrAlert();
    if (!position) return;

    setSubmitting(true);
    try {
      const res = await staffApiFetch<{ attendance: AttendanceRecord }>('/api/staff/attendance/clock-in', {
        method: 'POST',
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          // Android saja — expo-location tidak melaporkan status mock di
          // iOS sama sekali, `mocked` akan undefined dan tidak ikut
          // terkirim (backend anggap null: tidak bisa dinilai).
          is_mocked: position.mocked,
        }),
      });
      setToday(res.attendance);
      // Backend MENOLAK (lempar error, ditangkap di catch) kalau lokasi di
      // luar radius toko — sampai baris ini pasti sudah dalam radius,
      // jadi tidak perlu cek jarak lagi di sisi app.
      Alert.alert('Berhasil', 'Absen masuk tercatat.');
      setCheckedDistance(null);
      loadToday();
      loadHistory(historyMonth);
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [getLocationOrAlert, loadToday, loadHistory, historyMonth]);

  const handleClockOut = useCallback(async () => {
    const position = await getLocationOrAlert();
    if (!position) return;

    setSubmitting(true);
    try {
      const res = await staffApiFetch<{ attendance: AttendanceRecord }>('/api/staff/attendance/clock-out', {
        method: 'POST',
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          is_mocked: position.mocked,
        }),
      });
      setToday(res.attendance);
      Alert.alert('Berhasil', 'Absen keluar tercatat.');
      setCheckedDistance(null);
      loadToday();
      loadHistory(historyMonth);
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [getLocationOrAlert, loadToday, loadHistory, historyMonth]);

  const handleCheckDistance = useCallback(async () => {
    if (!store || store.latitude === null || store.longitude === null) return;

    setCheckingDistance(true);
    const position = await getLocationOrAlert();
    if (position) {
      setCheckedDistance(Math.round(
        haversineDistanceMeters(position.coords.latitude, position.coords.longitude, store.latitude, store.longitude)
      ));
    }
    setCheckingDistance(false);
  }, [getLocationOrAlert, store]);

  const renderPrimaryButton = () => {
    if (!store) {
      return (
        <View style={styles.noStoreBox}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
          <Text style={styles.noStoreText}>Akun ini belum terhubung ke toko mana pun. Hubungi admin.</Text>
        </View>
      );
    }

    // Entri manual/dinas luar dibuat admin lewat Filament, bukan lewat
    // tombol ini — kalau hari ini SUDAH ada entri jenis itu, tombol
    // absen normal disembunyikan supaya tidak bikin baris ganda.
    if (today && today.entry_type !== 'clock') {
      return (
        <View style={styles.doneBox}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <Text style={styles.doneText}>
            Hari ini tercatat sebagai "{ENTRY_TYPE_LABEL[today.entry_type]}" oleh admin.
          </Text>
        </View>
      );
    }

    if (!today || !today.clock_in_at) {
      return (
        <Pressable
          style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
          onPress={handleClockIn}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Ionicons name="log-in-outline" size={22} color="#ffffff" />
              <Text style={styles.primaryButtonText}>Absen Masuk</Text>
            </>
          )}
        </Pressable>
      );
    }

    if (!today.clock_out_at) {
      return (
        <Pressable
          style={[styles.primaryButton, styles.primaryButtonOut, submitting && styles.primaryButtonDisabled]}
          onPress={handleClockOut}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={22} color="#ffffff" />
              <Text style={styles.primaryButtonText}>Absen Keluar</Text>
            </>
          )}
        </Pressable>
      );
    }

    return (
      <View style={styles.doneBox}>
        <Ionicons name="checkmark-done-circle" size={22} color={colors.success} />
        <Text style={styles.doneText}>Absensi hari ini sudah lengkap.</Text>
      </View>
    );
  };

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
        <Text style={styles.headerTitle} numberOfLines={1}>Absensi</Text>
        <Pressable onPress={() => router.push('/staff/attendance/leave' as never)} style={styles.sideButton}>
          <Ionicons name="calendar-outline" size={22} color={colors.textPrimary} />
        </Pressable>
      </View>

      <FlatList
        data={history}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListHeaderComponent={
          <View>
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.todayCard}>
              <Text style={styles.todayDate}>{formatDate(new Date().toISOString())}</Text>
              {store ? (
                <Text style={styles.todayStore}>
                  {store.name} · absen wajib dalam radius {store.radius_meters} m
                </Text>
              ) : null}

              <View style={styles.timeRow}>
                <View style={styles.timeBlock}>
                  <Text style={styles.timeLabel}>Jam Masuk</Text>
                  <Text style={styles.timeValue}>{formatTime(today?.clock_in_at ?? null)}</Text>
                </View>
                <View style={styles.timeDivider} />
                <View style={styles.timeBlock}>
                  <Text style={styles.timeLabel}>Jam Keluar</Text>
                  <Text style={styles.timeValue}>{formatTime(today?.clock_out_at ?? null)}</Text>
                </View>
              </View>

              {today && today.late_minutes > 0 ? (
                <View style={styles.lateBadge}>
                  <Ionicons name="time-outline" size={14} color={colors.warning} />
                  <Text style={styles.lateBadgeText}>Telat {today.late_minutes} menit</Text>
                </View>
              ) : null}

              {today && today.early_leave_minutes > 0 ? (
                <View style={styles.lateBadge}>
                  <Ionicons name="time-outline" size={14} color={colors.warning} />
                  <Text style={styles.lateBadgeText}>Pulang cepat {today.early_leave_minutes} menit</Text>
                </View>
              ) : null}

              {store && store.latitude !== null && store.longitude !== null && !(today?.clock_in_at && today?.clock_out_at) ? (
                <View style={styles.distanceCheckWrap}>
                  <Pressable
                    style={styles.distanceCheckButton}
                    onPress={handleCheckDistance}
                    disabled={checkingDistance}
                  >
                    {checkingDistance ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <>
                        <Ionicons name="locate-outline" size={16} color={colors.accent} />
                        <Text style={styles.distanceCheckText}>Cek Jarak Saya ke Toko</Text>
                      </>
                    )}
                  </Pressable>
                  {checkedDistance !== null ? (
                    <Text style={[
                      styles.distanceResultText,
                      { color: checkedDistance > store.radius_meters ? colors.danger : colors.success },
                    ]}>
                      {checkedDistance} m dari toko {checkedDistance > store.radius_meters ? `(melebihi radius ${store.radius_meters} m — absen akan ditolak)` : '(dalam radius)'}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.primaryButtonWrap}>{renderPrimaryButton()}</View>
            </View>

            {totalLateMinutes > 0 ? (
              <View style={styles.summaryRow}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                <Text style={styles.summaryText}>
                  Total telat bulan ini: {totalLateMinutes} menit
                </Text>
              </View>
            ) : null}

            <Pressable style={styles.leaveLink} onPress={() => router.push('/staff/attendance/leave' as never)}>
              <Ionicons name="calendar-outline" size={18} color={colors.accent} />
              <Text style={styles.leaveLinkText}>Ajukan / Lihat Izin & Cuti</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>

            <View style={styles.monthNavRow}>
              <Pressable onPress={() => goToMonth(-1)} hitSlop={8} disabled={historyLoading}>
                <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
              </Pressable>
              <Text style={styles.historyTitle}>Riwayat {formatMonthLabel(historyMonth)}</Text>
              <Pressable
                onPress={() => goToMonth(1)}
                hitSlop={8}
                disabled={historyLoading || isSameMonth(historyMonth, new Date())}
              >
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={isSameMonth(historyMonth, new Date()) ? colors.textMuted : colors.textPrimary}
                />
              </Pressable>
            </View>
            {historyLoading ? <ActivityIndicator style={{ marginBottom: spacing.sm }} color={colors.accent} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.historyRow}>
            <View style={styles.historyDateCol}>
              <Text style={styles.historyDate}>
                {new Date(item.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
              </Text>
              {item.entry_type !== 'clock' ? (
                <Text style={styles.historyType}>{ENTRY_TYPE_LABEL[item.entry_type]}</Text>
              ) : null}
            </View>
            <Text style={styles.historyTime}>{formatTime(item.clock_in_at)}</Text>
            <Text style={styles.historyTimeSep}>–</Text>
            <Text style={styles.historyTime}>{formatTime(item.clock_out_at)}</Text>
            {item.late_minutes > 0 || item.early_leave_minutes > 0 ? (
              <Text style={styles.historyLate}>
                {item.late_minutes > 0 ? `+${item.late_minutes}m` : ''}
                {item.late_minutes > 0 && item.early_leave_minutes > 0 ? ' / ' : ''}
                {item.early_leave_minutes > 0 ? `-${item.early_leave_minutes}m` : ''}
              </Text>
            ) : (
              <View style={{ width: 40 }} />
            )}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Belum ada riwayat absensi bulan ini.</Text>
        }
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
    errorBox: {
      backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md,
    },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    todayCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    todayDate: { fontSize: fontSize.sm, color: colors.textSecondary, textTransform: 'capitalize' },
    todayStore: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
    timeRow: {
      flexDirection: 'row', alignItems: 'center', width: '100%',
      marginTop: spacing.lg, marginBottom: spacing.sm,
    },
    timeBlock: { flex: 1, alignItems: 'center' },
    timeDivider: { width: 1, height: 36, backgroundColor: colors.border },
    timeLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: 4 },
    timeValue: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    lateBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.warningBg, borderRadius: radius.pill,
      paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.sm,
    },
    lateBadgeText: { fontSize: fontSize.xs, color: colors.warning, fontWeight: '600' },
    primaryButtonWrap: { width: '100%', marginTop: spacing.sm },
    primaryButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accent, borderRadius: radius.pill, height: 52,
    },
    // Warna beda dari tombol "Absen Masuk" — penanda visual cepat "Anda
    // sedang berjalan, jangan lupa absen keluar nanti", bukan sekadar
    // variasi tanpa arti.
    primaryButtonOut: { backgroundColor: colors.warning },
    primaryButtonDisabled: { opacity: 0.6 },
    primaryButtonText: { color: '#ffffff', fontSize: fontSize.base, fontWeight: '700' },
    noStoreBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.sm, width: '100%',
    },
    noStoreText: { flex: 1, fontSize: fontSize.xs, color: colors.warning },
    doneBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: colors.successBg, borderRadius: radius.md, padding: spacing.sm, width: '100%',
    },
    doneText: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    summaryRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      marginBottom: spacing.md, paddingHorizontal: spacing.xs,
    },
    summaryText: { fontSize: fontSize.xs, color: colors.textMuted },
    leaveLink: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: colors.accentSoft, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, marginBottom: spacing.lg,
    },
    leaveLinkText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.accent },
    monthNavRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm,
    },
    historyTitle: { flex: 1, textAlign: 'center', fontSize: fontSize.sm, fontWeight: '700', color: colors.textMuted },
    distanceCheckWrap: { width: '100%', alignItems: 'center', marginTop: spacing.sm, gap: 4 },
    distanceCheckButton: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.sm, paddingVertical: 6,
    },
    distanceCheckText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.accent },
    distanceResultText: { fontSize: fontSize.xs, fontWeight: '600', textAlign: 'center' },
    historyRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.xs,
    },
    historyDateCol: { width: 56 },
    historyDate: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textPrimary },
    historyType: { fontSize: 10, color: colors.textMuted },
    historyTime: { fontSize: fontSize.sm, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    historyTimeSep: { fontSize: fontSize.sm, color: colors.textMuted },
    historyLate: { marginLeft: 'auto', fontSize: fontSize.xs, color: colors.warning, fontWeight: '700' },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  });
}
