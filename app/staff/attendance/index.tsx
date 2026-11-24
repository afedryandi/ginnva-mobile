import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, FlatList, RefreshControl, Image, Modal, TextProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PinchZoomImage } from '@/components/ui/PinchZoomImage';
import { StaffBottomNav, NAV_CLEARANCE } from '@/components/staff/StaffBottomNav';
import { useHideNavOnScroll } from '@/lib/staff-nav-visibility';
import { AppText } from '@/components/ui/AppText';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { reportAttendanceFailure, flushPendingAttendanceFailures, failureFromStage } from '@/lib/attendance-failure';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { toLocalDateString } from '@/lib/dates';
import { shrinkForUpload, SELFIE_UPLOAD } from '@/lib/image-compress';

interface AttendanceRecord {
  id: number;
  date: string;
  entry_type: 'clock' | 'manual' | 'field_duty' | 'alpha' | 'leave';
  clock_in_at: string | null;
  clock_out_at: string | null;
  clock_in_distance_meters: number | null;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  note: string | null;
}

// Satu tanggal di riwayat: catatan absen, atau keterangan hari tanpa catatan (libur toko, belum absen hari ini, tanpa catatan).
interface HistoryDay {
  date: string;
  kind: 'record' | 'libur' | 'belum' | 'kosong';
  label: string | null;
  attendance: AttendanceRecord | null;
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

// Baris riwayat yang bisa diketuk untuk mengajukan koreksi: Alpha, tanpa jam masuk, atau absen asli yang lupa keluar (bukan hari ini).
function needsCorrection(item: AttendanceRecord): boolean {
  const isToday = item.date.slice(0, 10) === toLocalDateString(new Date());

  return item.entry_type === 'alpha' || (item.entry_type !== 'leave' && item.entry_type !== 'field_duty' && item.clock_in_at === null) || (item.entry_type === 'clock' && item.clock_out_at === null && !isToday);
}

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
  const hideNavOnScroll = useHideNavOnScroll();
  const { theme, colors } = useAppTheme();
  const { staff } = useStaffAuth();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Selfie absen yang sedang dibuka di penampil layar penuh (cubit untuk memperbesar).
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const [today, setToday] = useState<AttendanceRecord | null>(null);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  // Semua tanggal bulan itu tanpa yang lompat; null bila server lama belum mengirimnya (jatuh ke daftar catatan saja).
  const [historyDays, setHistoryDays] = useState<HistoryDay[] | null>(null);
  const [totalLateMinutes, setTotalLateMinutes] = useState(0);
  const [historyMonth, setHistoryMonth] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Tahap absen yang sedang berjalan, untuk teks di tombol. Tanpa ini, tombol tampak tidak bereaksi selama GPS mencari lokasi, pengguna
  // menekannya lagi, dan alur kedua membuka kamera untuk kedua kalinya.
  const [phase, setPhase] = useState<'locating' | 'camera' | 'sending' | null>(null);
  // Penjaga sinkron (state React terlambat satu render): satu absen pada satu waktu, apa pun yang dilakukan jari pengguna.
  const busyRef = useRef(false);
  const [checkingDistance, setCheckingDistance] = useState(false);
  const [checkedDistance, setCheckedDistance] = useState<number | null>(null);
  // Lembur hari ini (menunggu atau disetujui), supaya karyawan tahu jam lembur yang berlaku.
  const [overtimeToday, setOvertimeToday] = useState<{ id: number; starts_at: string; ends_at: string; status: 'pending' | 'approved' }[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Jam di kartu utama; diperbarui tiap 20 detik cukup untuk tampilan menit.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(id);
  }, []);

  const loadToday = useCallback(async () => {
    setError(null);
    try {
      const todayRes = await staffApiFetch<{ attendance: AttendanceRecord | null; store: StoreInfo | null; overtime?: { id: number; starts_at: string; ends_at: string; status: 'pending' | 'approved' }[] }>('/api/staff/attendance/today');
      setToday(todayRes.attendance);
      setOvertimeToday(todayRes.overtime ?? []);
      setStore(todayRes.store);
      // Jaringan hidup: kirim laporan kegagalan absen yang tertunda (lihat lib/attendance-failure.ts).
      flushPendingAttendanceFailures().catch(() => {});
    } catch {
      setError('Gagal memuat data absensi. Periksa koneksi internet.');
    }
  }, []);

  const loadHistory = useCallback(async (month: Date) => {
    try {
      const historyRes = await staffApiFetch<{ attendances: AttendanceRecord[]; days?: HistoryDay[]; total_late_minutes: number }>(
        `/api/staff/attendance/history?month=${toMonthParam(month)}`
      );
      setHistory(historyRes.attendances);
      setHistoryDays(historyRes.days ?? null);
      setTotalLateMinutes(historyRes.total_late_minutes);
    } catch {
      setError('Gagal memuat riwayat absensi. Periksa koneksi internet.');
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

  // `action` null = hanya cek jarak (bukan absen), jadi kegagalannya tidak dilaporkan sebagai kegagalan absen.
  const getLocationOrAlert = useCallback(async (action: 'clock_in' | 'clock_out' | null = null): Promise<Location.LocationObject | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      if (action) reportAttendanceFailure({ action, stage: 'locating', reason: 'location_permission' });
      Alert.alert(
        'Butuh Izin Lokasi',
        'Ginnva butuh akses lokasi untuk mencatat absen dari lokasi toko. Aktifkan izin lokasi di pengaturan HP.'
      );
      return null;
    }

    try {
      // Highest (bukan Balanced) — absen cuma minta 1 titik lokasi sesaat,
      // jadi trade-off baterai/waktu tunggu sedikit lebih lama sepadan
      // dengan akurasi jarak yang jauh lebih presisi (Balanced bisa
      // meleset ratusan meter, terutama di dalam ruangan).
      //
      // Batas waktu 20 detik: tanpa ini, GPS yang belum dapat sinyal (di dalam
      // ruangan / baru dinyalakan) membuat tombol menggantung di "Mencari
      // lokasi…" tanpa batas. Kalau lewat, pakai lokasi terakhir HP yang
      // masih segar (maks 60 detik, akurasi 100 m); kalau tidak ada, beri pesan.
      const fresh = await Promise.race<Location.LocationObject | null>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
      ]);
      if (fresh) return fresh;
      const recent = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 100 });
      if (recent) return recent;
      if (action) reportAttendanceFailure({ action, stage: 'locating', reason: 'gps_timeout' });
      Alert.alert(
        'Lokasi Belum Ditemukan',
        'GPS belum dapat sinyal. Pindah ke tempat terbuka atau dekat jendela, pastikan GPS aktif, lalu coba lagi.'
      );
      return null;
    } catch (err) {
      if (action) reportAttendanceFailure({ action, stage: 'locating', reason: 'location_error', message: err instanceof Error ? err.message : undefined });
      Alert.alert('Gagal Ambil Lokasi', 'Lokasi belum bisa diambil. Aktifkan GPS lalu coba lagi.');
      return null;
    }
  }, []);

  // Fitur "Foto Selfie Absensi" (2026-09-27, diminta user) --
  // launchCameraAsync() (BUKAN launchImageLibraryAsync) membuka kamera
  // native LANGSUNG, tidak ada opsi pilih dari galeri sama sekali --
  // ini yang memenuhi syarat "wajib foto langsung di lokasi" tanpa perlu
  // bikin layar kamera custom. cameraType 'front' minta kamera depan
  // (selfie) sebagai default, TIDAK ada validasi wajah otomatis
  // (keputusan user) -- murni bukti visual utk ditinjau manual admin.
  const getSelfiePhotoOrAlert = useCallback(async (action: 'clock_in' | 'clock_out'): Promise<ImagePicker.ImagePickerAsset | null> => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      reportAttendanceFailure({ action, stage: 'camera', reason: 'camera_permission' });
      Alert.alert(
        'Butuh Izin Kamera',
        'Ginnva butuh akses kamera untuk foto selfie absen. Aktifkan izin kamera di pengaturan HP.'
      );
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      // String literal (bukan enum) -- sesuai signature ImagePickerOptions
      // versi SDK 54 (docs.expo.dev/versions/v54.0.0/sdk/imagepicker),
      // cameraType: 'front' | 'back'.
      cameraType: ImagePicker.CameraType.front,
      quality: 0.5,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.length) return null;
    return result.assets[0];
  }, []);

  const handleClockIn = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    let stage: 'locating' | 'camera' | 'sending' = 'locating';

    try {
      setPhase('locating');
      const position = await getLocationOrAlert('clock_in');
      if (!position) return;

      setPhase('camera');
      stage = 'camera';
      const photo = await getSelfiePhotoOrAlert('clock_in');
      if (!photo) return;

      setPhase('sending');
      stage = 'sending';
      const form = new FormData();
      form.append('latitude', String(position.coords.latitude));
      form.append('longitude', String(position.coords.longitude));
      // Android saja — expo-location tidak melaporkan status mock di
      // iOS sama sekali, `mocked` akan undefined dan tidak ikut terkirim
      // (backend anggap null: tidak bisa dinilai).
      if (position.mocked !== undefined) form.append('is_mocked', String(position.mocked));
      // Selfie dikecilkan sebelum dikirim supaya hemat memori, kuota, dan penyimpanan server.
      const shrunk = await shrinkForUpload(photo, 'selfie-masuk.jpg', SELFIE_UPLOAD);
      form.append('photo', {
        uri: shrunk.uri,
        name: 'selfie-masuk.jpg',
        type: shrunk.type,
      } as unknown as Blob);

      const res = await staffApiFetch<{ attendance: AttendanceRecord }>('/api/staff/attendance/clock-in', {
        method: 'POST',
        body: form,
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
      reportAttendanceFailure({ action: 'clock_in', stage, ...failureFromStage(stage, err) });
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      busyRef.current = false;
      setPhase(null);
      setSubmitting(false);
    }
  }, [getLocationOrAlert, getSelfiePhotoOrAlert, loadToday, loadHistory, historyMonth]);

  const handleClockOut = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    let stage: 'locating' | 'camera' | 'sending' = 'locating';

    try {
      setPhase('locating');
      const position = await getLocationOrAlert('clock_out');
      if (!position) return;

      setPhase('camera');
      stage = 'camera';
      const photo = await getSelfiePhotoOrAlert('clock_out');
      if (!photo) return;

      setPhase('sending');
      stage = 'sending';
      const form = new FormData();
      form.append('latitude', String(position.coords.latitude));
      form.append('longitude', String(position.coords.longitude));
      if (position.mocked !== undefined) form.append('is_mocked', String(position.mocked));
      // Selfie dikecilkan sebelum dikirim supaya hemat memori, kuota, dan penyimpanan server.
      const shrunk = await shrinkForUpload(photo, 'selfie-keluar.jpg', SELFIE_UPLOAD);
      form.append('photo', {
        uri: shrunk.uri,
        name: 'selfie-keluar.jpg',
        type: shrunk.type,
      } as unknown as Blob);

      const res = await staffApiFetch<{ attendance: AttendanceRecord }>('/api/staff/attendance/clock-out', {
        method: 'POST',
        body: form,
      });
      setToday(res.attendance);
      Alert.alert('Berhasil', 'Absen keluar tercatat.');
      setCheckedDistance(null);
      loadToday();
      loadHistory(historyMonth);
    } catch (err) {
      reportAttendanceFailure({ action: 'clock_out', stage, ...failureFromStage(stage, err) });
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      busyRef.current = false;
      setPhase(null);
      setSubmitting(false);
    }
  }, [getLocationOrAlert, getSelfiePhotoOrAlert, loadToday, loadHistory, historyMonth]);

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

  // Absensi Manual (mis. hasil Koreksi Absen yang hanya mengisi jam masuk) yang sudah punya jam masuk tapi belum jam keluar: karyawan tetap bisa
  // absen keluar di aplikasi. Server memvalidasi radius dan lokasi palsu seperti biasa.
  const isOpenManual = today?.entry_type === 'manual' && !!today.clock_in_at && !today.clock_out_at;

  // Tombol absen utama. Keadaan "sudah lengkap" atau "dicatat admin" tidak lagi berupa kotak sendiri: sudah tampil sebagai label status di kartu.
  const renderPrimaryButton = () => {
    if (!store) {
      return (
        <View style={styles.noStoreBox}>
          <Ionicons name="alert-circle" size={20} color="#ffffff" />
          <T style={styles.noStoreText}>Akun ini belum terhubung ke toko mana pun. Hubungi admin.</T>
        </View>
      );
    }

    // Entri manual/dinas luar dibuat admin lewat Filament, bukan lewat
    // tombol ini — kalau hari ini SUDAH ada entri jenis itu, tombol
    // absen normal disembunyikan supaya tidak bikin baris ganda.
    if (today && today.entry_type !== 'clock' && !isOpenManual) return null;

    if (!today || !today.clock_in_at) {
      return (
        <Pressable
          style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
          onPress={handleClockIn}
          disabled={submitting}
          accessibilityRole="button"
        >
          {submitting ? (
            <>
              <ActivityIndicator color={colors.accent} />
              <T style={styles.primaryButtonText}>{phase === 'locating' ? 'Mencari lokasi…' : phase === 'camera' ? 'Membuka kamera…' : 'Mengirim…'}</T>
            </>
          ) : (
            <>
              <Ionicons name="log-in" size={24} color={colors.accent} />
              <T style={styles.primaryButtonText}>Absen Masuk</T>
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
          accessibilityRole="button"
        >
          {submitting ? (
            <>
              <ActivityIndicator color={colors.accent} />
              <T style={styles.primaryButtonText}>{phase === 'locating' ? 'Mencari lokasi…' : phase === 'camera' ? 'Membuka kamera…' : 'Mengirim…'}</T>
            </>
          ) : (
            <>
              <Ionicons name="log-out" size={24} color={colors.accent} />
              <T style={styles.primaryButtonText}>Absen Keluar</T>
            </>
          )}
        </Pressable>
      );
    }

    return null;
  };

  // Label status hari ini di pojok kartu.
  const todayStatus: { label: string; tone: 'success' | 'warning' | 'accent' | 'muted' } = !store
    ? { label: 'Belum terhubung ke toko', tone: 'warning' }
    : today && today.entry_type !== 'clock' && !isOpenManual
      ? { label: `Tercatat: ${ENTRY_TYPE_LABEL[today.entry_type]}`, tone: 'success' }
      : !today?.clock_in_at
        ? { label: 'Belum absen masuk', tone: 'muted' }
        : !today.clock_out_at
          ? { label: 'Sedang bekerja', tone: 'accent' }
          : { label: 'Absensi lengkap', tone: 'success' };

  const toneColor = (tone: 'success' | 'warning' | 'danger' | 'accent' | 'muted') =>
    tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : tone === 'accent' ? colors.accent : colors.textMuted;
  const toneBg = (tone: 'success' | 'warning' | 'danger' | 'accent' | 'muted') =>
    tone === 'success' ? colors.successBg : tone === 'warning' ? colors.warningBg : tone === 'danger' ? colors.dangerBg : tone === 'accent' ? colors.accentSoft : colors.surfaceElevated;

  // Baris daftar riwayat: semua tanggal bila server mengirimnya, kalau tidak hanya yang punya catatan.
  const historyRows: HistoryDay[] = historyDays ?? history.map((h) => ({ date: h.date.slice(0, 10), kind: 'record' as const, label: null, attendance: h }));

  // Ringkasan bulan yang sedang dilihat, dihitung dari riwayat yang sudah dimuat.
  const monthStats = {
    present: history.filter((h) => h.clock_in_at !== null).length,
    lateDays: history.filter((h) => h.late_minutes > 0).length,
    alpha: history.filter((h) => h.entry_type === 'alpha').length,
    leave: history.filter((h) => h.entry_type === 'leave').length,
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <SkeletonCards count={3} />
      </SafeAreaView>
    );
  }

  const quickLinks: { key: string; icon: React.ComponentProps<typeof Ionicons>['name']; label: string; hint: string; route: string; color: string }[] = [
    { key: 'leave', icon: 'calendar', label: 'Izin & Cuti', hint: 'Izin, sakit, cuti', route: '/staff/attendance/leave', color: '#3b82f6' },
    { key: 'correction', icon: 'create', label: 'Koreksi Absen', hint: 'Lupa atau salah jam', route: '/staff/attendance/correction', color: '#f59e0b' },
    ...(staff?.has_overtime ? [{ key: 'overtime', icon: 'moon' as const, label: 'Lembur', hint: 'Ajukan sebelum mulai', route: '/staff/attendance/overtime', color: '#8b5cf6' }] : []),
    { key: 'field-duty', icon: 'navigate', label: 'Dinas Luar', hint: 'Kegiatan di luar toko', route: '/staff/attendance/field-duty', color: '#10b981' },
  ];

  const clockText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateText = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  const showDistanceCheck = !!store && store.latitude !== null && store.longitude !== null && !(today?.clock_in_at && today?.clock_out_at);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <FlatList
        onScroll={hideNavOnScroll}
        scrollEventThrottle={16}
        data={historyRows}
        keyExtractor={(row) => row.date}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <T style={styles.screenTitle}>Absensi</T>

            {error ? (
              <View style={styles.errorBox}>
                <T style={styles.errorText}>{error}</T>
              </View>
            ) : null}

            {/* Kartu utama: jam hidup, status, tombol absen, lalu jam masuk dan keluar hari ini. */}
            <View style={styles.hero}>
              <View style={styles.heroBlobA} />
              <View style={styles.heroBlobB} />

              <View style={styles.heroTop}>
                <View style={styles.heroPill}>
                  <View style={styles.heroDot} />
                  <T style={styles.heroPillText} numberOfLines={1}>{todayStatus.label}</T>
                </View>
              </View>

              <T style={styles.heroClock}>{clockText}</T>
              <T style={styles.heroDate}>{dateText}</T>

              <View style={styles.heroAction}>{renderPrimaryButton()}</View>

              {overtimeToday.map((o) => (
                <View key={o.id} style={styles.heroNote}>
                  <Ionicons name={o.status === 'approved' ? 'moon' : 'moon-outline'} size={14} color="#ffffff" />
                  <T style={styles.heroNoteText}>
                    Lembur {o.status === 'approved' ? 'disetujui' : 'menunggu persetujuan'}: {formatTime(o.starts_at)}–{formatTime(o.ends_at)}
                  </T>
                </View>
              ))}

              <View style={styles.heroTimes}>
                <View style={styles.heroTimeTile}>
                  <T style={styles.heroTimeLabel}>Masuk</T>
                  <View style={styles.heroTimeValueRow}>
                    <T style={styles.heroTimeValue}>{formatTime(today?.clock_in_at ?? null)}</T>
                    {today?.clock_in_photo_url ? (
                      <Pressable onPress={() => setViewerUri(today.clock_in_photo_url)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Perbesar foto absen masuk">
                        <Image source={{ uri: today.clock_in_photo_url }} style={styles.selfieThumb} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <View style={styles.heroTimeTile}>
                  <T style={styles.heroTimeLabel}>Keluar</T>
                  <View style={styles.heroTimeValueRow}>
                    <T style={styles.heroTimeValue}>{formatTime(today?.clock_out_at ?? null)}</T>
                    {today?.clock_out_photo_url ? (
                      <Pressable onPress={() => setViewerUri(today.clock_out_photo_url)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Perbesar foto absen keluar">
                        <Image source={{ uri: today.clock_out_photo_url }} style={styles.selfieThumb} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>

              {(today && today.late_minutes > 0) || (today && today.early_leave_minutes > 0) ? (
                <View style={styles.heroChips}>
                  {today && today.late_minutes > 0 ? (
                    <View style={styles.heroChip}>
                      <Ionicons name="time" size={13} color="#ffffff" />
                      <T style={styles.heroChipText}>Telat {today.late_minutes} menit</T>
                    </View>
                  ) : null}
                  {today && today.early_leave_minutes > 0 ? (
                    <View style={styles.heroChip}>
                      <Ionicons name="time" size={13} color="#ffffff" />
                      <T style={styles.heroChipText}>Pulang cepat {today.early_leave_minutes} menit</T>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>

            {store ? (
              <View style={styles.locationCard}>
                <View style={styles.locationIcon}>
                  <Ionicons name="location" size={18} color={colors.accent} />
                </View>
                <View style={styles.locationBody}>
                  <T style={styles.locationName} numberOfLines={1}>{store.name}</T>
                  {checkedDistance !== null ? (
                    <T style={[styles.locationSub, { color: checkedDistance > store.radius_meters ? colors.danger : colors.success, fontWeight: '700' }]} numberOfLines={2}>
                      {checkedDistance > store.radius_meters ? `Di luar radius ${store.radius_meters} m` : `Dalam radius ${store.radius_meters} m`}
                    </T>
                  ) : (
                    <T style={styles.locationSub} numberOfLines={1}>Absen dalam radius {store.radius_meters} m</T>
                  )}
                </View>
                {showDistanceCheck ? (
                  <Pressable style={({ pressed }) => [styles.distanceButton, pressed && styles.pressed]} onPress={handleCheckDistance} disabled={checkingDistance} accessibilityRole="button" accessibilityLabel="Cek jarak ke toko">
                    {checkingDistance ? <ActivityIndicator size="small" color={colors.accent} /> : <T style={styles.distanceButtonText}>Cek jarak</T>}
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.quickGrid}>
              {quickLinks.map((link) => (
                <Pressable
                  key={link.key}
                  style={({ pressed }) => [styles.quickTile, pressed && styles.pressed]}
                  onPress={() => router.push(link.route as never)}
                  accessibilityRole="button"
                  accessibilityLabel={link.label}
                >
                  <View style={[styles.quickIcon, { backgroundColor: `${link.color}26` }]}>
                    <Ionicons name={link.icon} size={22} color={link.color} />
                  </View>
                  <View style={styles.quickText}>
                    <T style={styles.quickLabel} numberOfLines={1}>{link.label}</T>
                    <T style={styles.quickHint} numberOfLines={1}>{link.hint}</T>
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={styles.historyHeader}>
              <T style={styles.sectionTitle}>Riwayat</T>
              <View style={styles.monthPill}>
                <Pressable onPress={() => goToMonth(-1)} hitSlop={8} disabled={historyLoading} style={styles.monthNavButton} accessibilityLabel="Bulan sebelumnya">
                  <Ionicons name="chevron-back" size={16} color={colors.textPrimary} />
                </Pressable>
                <T style={styles.monthLabel}>{formatMonthLabel(historyMonth)}</T>
                <Pressable
                  onPress={() => goToMonth(1)}
                  hitSlop={8}
                  disabled={historyLoading || isSameMonth(historyMonth, new Date())}
                  style={styles.monthNavButton}
                  accessibilityLabel="Bulan berikutnya"
                >
                  <Ionicons name="chevron-forward" size={16} color={isSameMonth(historyMonth, new Date()) ? colors.textMuted : colors.textPrimary} />
                </Pressable>
              </View>
            </View>

            <View style={styles.statsCard}>
              {[
                { label: 'Hadir', value: monthStats.present, color: colors.success },
                { label: totalLateMinutes > 0 ? `Telat · ${totalLateMinutes} mnt` : 'Telat', value: monthStats.lateDays, color: colors.warning },
                { label: 'Alpha', value: monthStats.alpha, color: colors.danger },
                { label: 'Izin/Cuti', value: monthStats.leave, color: '#3b82f6' },
              ].map((stat) => (
                <View key={stat.label} style={styles.statItem}>
                  <T style={[styles.statValue, stat.value > 0 && stat.color !== colors.success && stat.label !== 'Izin/Cuti' ? { color: stat.color } : null]}>{stat.value}</T>
                  <View style={styles.statLabelRow}>
                    <View style={[styles.statDot, { backgroundColor: stat.color }]} />
                    <T style={styles.statLabel} numberOfLines={1}>{stat.label}</T>
                  </View>
                </View>
              ))}
            </View>
            {historyLoading ? <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.accent} /> : null}
          </View>
        }
        renderItem={({ item: row }) => {
          // Hari tanpa catatan absen: libur toko, belum absen hari ini, atau tanpa catatan.
          if (!row.attendance) {
            const dayDate = new Date(`${row.date}T00:00:00`);
            const dayTone: Tone = row.kind === 'libur' ? 'accent' : 'muted';
            const kindLabel = row.kind === 'libur' ? 'Libur' : row.kind === 'belum' ? 'Belum absen' : 'Tanpa catatan';

            return (
              <View style={styles.historyRow}>
                <View style={[styles.dateBox, { backgroundColor: toneBg(dayTone) }]}>
                  <T style={[styles.dateDay, { color: toneColor(dayTone) }]}>{String(dayDate.getDate()).padStart(2, '0')}</T>
                  <T style={[styles.dateWeekday, { color: toneColor(dayTone) }]}>{dayDate.toLocaleDateString('id-ID', { weekday: 'short' })}</T>
                </View>
                <View style={styles.historyBody}>
                  <T style={styles.historyTimes}>{row.label ?? kindLabel}</T>
                  <View style={styles.chipRow}>
                    <View style={[styles.chip, { backgroundColor: toneBg(dayTone) }]}>
                      <T style={[styles.chipText, { color: toneColor(dayTone) }]}>{kindLabel}</T>
                    </View>
                  </View>
                </View>
              </View>
            );
          }

          const item = row.attendance;
          const fix = needsCorrection(item);
          const chips = rowChips(item);
          const d = new Date(item.date);
          const tone = rowTone(chips);

          return (
            <Pressable
              style={({ pressed }) => [styles.historyRow, fix && pressed && styles.pressed]}
              disabled={!fix}
              onPress={() => router.push(`/staff/attendance/correction?date=${item.date.slice(0, 10)}` as never)}
              accessibilityRole={fix ? 'button' : undefined}
              accessibilityLabel={fix ? `Ajukan koreksi absensi ${formatDate(item.date)}` : undefined}
            >
              <View style={[styles.dateBox, { backgroundColor: toneBg(tone) }]}>
                <T style={[styles.dateDay, { color: toneColor(tone) }]}>{String(d.getDate()).padStart(2, '0')}</T>
                <T style={[styles.dateWeekday, { color: toneColor(tone) }]}>{d.toLocaleDateString('id-ID', { weekday: 'short' })}</T>
              </View>
              <View style={styles.historyBody}>
                <T style={styles.historyTimes}>
                  {formatTime(item.clock_in_at)} – {formatTime(item.clock_out_at)}
                </T>
                <View style={styles.chipRow}>
                  {chips.map((chip) => (
                    <View key={chip.label} style={[styles.chip, { backgroundColor: toneBg(chip.tone) }]}>
                      <T style={[styles.chipText, { color: toneColor(chip.tone) }]}>{chip.label}</T>
                    </View>
                  ))}
                </View>
              </View>
              {fix ? (
                <View style={styles.fixButton}>
                  <T style={styles.fixButtonText}>Koreksi</T>
                  <Ionicons name="chevron-forward" size={12} color={colors.accent} />
                </View>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <T style={styles.emptyText}>Belum ada riwayat absensi bulan ini.</T>
        }
        contentContainerStyle={styles.listContent}
      />
      <StaffBottomNav active="attendance" />

      {/* Penampil selfie absen: cubit dua jari untuk memperbesar, ketuk dua kali untuk membesarkan atau mengembalikan. */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)} statusBarTranslucent>
        <View style={styles.viewerBackdrop}>
          {viewerUri ? (
            <View style={styles.viewerStage}>
              <PinchZoomImage uri={viewerUri} centered />
            </View>
          ) : null}
          <View style={[styles.viewerBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <Pressable style={styles.viewerBtn} onPress={() => setViewerUri(null)} accessibilityRole="button" accessibilityLabel="Tutup foto">
              <Ionicons name="close" size={24} color="#ffffff" />
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Teks layar ini dibatasi pembesarannya (1,25x) supaya kartu dan baris riwayat tidak pecah pada ukuran font sistem besar.
function T(props: TextProps) {
  return <AppText maxFontSizeMultiplier={1.25} {...props} />;
}

type Tone = 'success' | 'warning' | 'danger' | 'accent' | 'muted';

// Warna blok tanggal satu baris riwayat: yang paling perlu perhatian menang.
function rowTone(chips: { tone: Tone }[]): Tone {
  for (const t of ['danger', 'warning', 'accent', 'success'] as Tone[]) {
    if (chips.some((c) => c.tone === t)) return t;
  }
  return 'muted';
}

// Label status satu baris riwayat: jenis entri dan ketepatan waktu dalam satu pandang.
function rowChips(item: AttendanceRecord): { label: string; tone: Tone }[] {
  if (item.entry_type === 'alpha') return [{ label: 'Alpha', tone: 'danger' }];
  if (item.entry_type === 'leave') return [{ label: 'Izin/Cuti', tone: 'accent' }];

  const chips: { label: string; tone: Tone }[] = [];
  if (item.entry_type === 'field_duty') chips.push({ label: 'Dinas Luar', tone: 'muted' });
  if (item.entry_type === 'manual') chips.push({ label: 'Manual', tone: 'muted' });

  if (item.clock_in_at === null) {
    if (item.entry_type !== 'field_duty') chips.push({ label: 'Tanpa jam masuk', tone: 'warning' });
  } else if (item.late_minutes > 0) {
    chips.push({ label: `Telat ${item.late_minutes} mnt`, tone: 'warning' });
  } else if (item.entry_type === 'clock') {
    chips.push({ label: 'Tepat waktu', tone: 'success' });
  }

  if (item.early_leave_minutes > 0) chips.push({ label: `Pulang cepat ${item.early_leave_minutes} mnt`, tone: 'warning' });
  if (item.entry_type === 'clock' && item.clock_in_at !== null && item.clock_out_at === null) chips.push({ label: 'Belum absen keluar', tone: 'muted' });

  return chips;
}

function createStyles(colors: typeof darkColors) {
  const onHero = 'rgba(255,255,255,0.18)';

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
    listContent: { paddingHorizontal: spacing.md, paddingBottom: NAV_CLEARANCE },
    headerBlock: { gap: spacing.md, marginBottom: spacing.xs },
    screenTitle: { fontSize: 30, fontWeight: '900', letterSpacing: -0.8, color: colors.textPrimary, paddingTop: spacing.sm },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.lg, padding: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: '600' },

    // Kartu utama berwarna merek: jam besar, status, tombol putih besar.
    hero: { backgroundColor: colors.accent, borderRadius: 32, padding: spacing.lg, gap: spacing.xs, overflow: 'hidden' },
    heroBlobA: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.10)', top: -90, right: -60 },
    heroBlobB: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.07)', bottom: 40, left: -60 },
    heroTop: { flexDirection: 'row' },
    heroPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: onHero, paddingHorizontal: spacing.sm + 2, paddingVertical: 6, borderRadius: radius.pill, flexShrink: 1 },
    heroDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ffffff' },
    heroPillText: { color: '#ffffff', fontSize: 12, fontWeight: '800', flexShrink: 1 },
    heroClock: { color: '#ffffff', fontSize: 64, fontWeight: '900', letterSpacing: -2.5, lineHeight: 72, fontVariant: ['tabular-nums'], marginTop: spacing.sm },
    heroDate: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.sm, fontWeight: '600', textTransform: 'capitalize', marginBottom: spacing.sm },
    heroAction: { marginBottom: spacing.xs },
    heroNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    heroNoteText: { flex: 1, color: '#ffffff', fontSize: fontSize.xs, fontWeight: '700', fontVariant: ['tabular-nums'] },
    heroTimes: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    heroTimeTile: { flex: 1, backgroundColor: onHero, borderRadius: 20, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, gap: 2 },
    heroTimeLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    heroTimeValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    heroTimeValue: { color: '#ffffff', fontSize: 26, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
    selfieThumb: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#ffffff' },
    viewerBackdrop: { flex: 1, backgroundColor: '#000000' },
    viewerStage: { flex: 1 },
    viewerBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 16 },
    viewerBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
    heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
    heroChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: onHero, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
    heroChipText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },

    primaryButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: '#ffffff', borderRadius: radius.pill, minHeight: 58,
    },
    primaryButtonOut: {},
    primaryButtonDisabled: { opacity: 0.7 },
    primaryButtonText: { color: colors.accent, fontSize: fontSize.base + 1, fontWeight: '900' },
    noStoreBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: onHero, borderRadius: 20, padding: spacing.sm + 2 },
    noStoreText: { flex: 1, fontSize: fontSize.xs, fontWeight: '700', color: '#ffffff' },

    locationCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: 24, padding: spacing.sm + 2,
    },
    locationIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
    locationBody: { flex: 1, gap: 1 },
    locationName: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary },
    locationSub: { fontSize: 12, color: colors.textSecondary },
    distanceButton: { minHeight: 36, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    distanceButtonText: { fontSize: 12, fontWeight: '800', color: colors.accent },

    // Menu 2x2: ikon berwarna beda supaya cepat dikenali.
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    quickTile: { width: '48.5%', flexGrow: 1, maxWidth: '49%', backgroundColor: colors.surface, borderRadius: 24, padding: spacing.md, gap: spacing.sm },
    quickIcon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    quickText: { gap: 1 },
    quickLabel: { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary },
    quickHint: { fontSize: 12, color: colors.textSecondary },

    historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
    sectionTitle: { fontSize: fontSize.xl, fontWeight: '900', letterSpacing: -0.4, color: colors.textPrimary },
    monthPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 4 },
    monthNavButton: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
    monthLabel: { fontSize: 13, fontWeight: '800', color: colors.textPrimary, textTransform: 'capitalize', paddingHorizontal: 2 },

    statsCard: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 24, paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
    statItem: { flex: 1, alignItems: 'center', gap: 4 },
    statValue: { fontSize: 28, fontWeight: '900', letterSpacing: -0.8, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    statDot: { width: 7, height: 7, borderRadius: 4 },
    statLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },

    historyRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
      backgroundColor: colors.surface, borderRadius: 24, padding: spacing.sm + 2,
    },
    dateBox: { width: 52, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    dateDay: { fontSize: fontSize.lg, fontWeight: '900', fontVariant: ['tabular-nums'] },
    dateWeekday: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
    historyBody: { flex: 1, gap: 6 },
    historyTimes: { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
    chipText: { fontSize: 12, fontWeight: '800' },
    fixButton: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: spacing.sm + 2, minHeight: 34, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    fixButtonText: { fontSize: 12, fontWeight: '800', color: colors.accent },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  });
}
