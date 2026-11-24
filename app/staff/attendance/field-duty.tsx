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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { AppText as Text, AppTextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import DateGrid from '@/components/ui/DateGrid';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { toLocalDateString } from '@/lib/dates';
import { shrinkForUpload, LOCATION_PHOTO_UPLOAD } from '@/lib/image-compress';
import { formatTimeInput, isInvalidTime, INVALID_TIME_MESSAGE } from '@/lib/time-input';
import { useAppTheme } from '@/lib/theme-context';

// Pengajuan Dinas Luar (2026-11-12, keputusan pemilik): karyawan yang bekerja di luar toko (mis. kanvasing) tidak bisa absen karena absen
// dibatasi radius toko. Mereka mengajukan dengan tujuan yang jelas, boleh susulan: sehari penuh (absensi hari itu jadi Dinas Luar) atau sebagian
// hari dengan jam mulai dan selesai (absen di toko tetap wajib, tetapi telat dan pulang cepat pada rentang itu tidak dihitung). Aturan penuh ada
// di server (FieldDutyRequestService); layar ini hanya memberi umpan balik cepat sebelum kirim.
// Tampilan dirancang ulang 2026-11-18, selaras dengan Izin & Cuti dan Koreksi Absensi: kartu putih membulat di atas latar abu-putih, pilihan
// lama dinas berupa dua sisi, dan tombol ajukan yang selalu terlihat di bawah.

interface FieldDutyRecord {
  id: number;
  date: string;
  is_full_day: boolean;
  start_time: string | null;
  end_time: string | null;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  review_notes: string | null;
  reviewer_name: string | null;
  can_cancel: boolean;
  // Foto bukti saat tiba di lokasi: wajib di hari dinas supaya dinas sehari penuh dianggap hadir.
  needs_location_photo: boolean;
  // Koordinat GPS hanya diminta pada hari dinas; pengajuan susulan (tanggal sudah lewat) cukup foto, boleh dari galeri. Opsional: server lama belum mengirimnya.
  location_photo_needs_coordinates?: boolean;
  location_photo_is_catch_up?: boolean;
  location_photo_url: string | null;
  // Foto akhir (saat dinas selesai), setelah foto awal. Opsional: server lama belum mengirimnya.
  needs_end_photo?: boolean;
  end_photo_url?: string | null;
}

interface Limits {
  max_days_back: number;
  max_days_ahead: number;
  min_partial_minutes: number;
}

const DEFAULT_LIMITS: Limits = { max_days_back: 7, max_days_ahead: 14, min_partial_minutes: 30 };

const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const STATUS_META: Record<FieldDutyRecord['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu Persetujuan', color: 'warning', bg: 'warningBg' },
  approved: { label: 'Disetujui', color: 'success', bg: 'successBg' },
  rejected: { label: 'Ditolak', color: 'danger', bg: 'dangerBg' },
  cancelled: { label: 'Dibatalkan', color: 'textMuted', bg: 'surfaceElevated' },
};

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export default function StaffFieldDutyScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  const [requests, setRequests] = useState<FieldDutyRecord[]>([]);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [partial, setPartial] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ field_duty_requests: FieldDutyRecord[]; limits: Limits }>('/api/staff/field-duty-requests');
      setRequests(res.field_duty_requests);
      setLimits(res.limits);
    } catch {
      setError('Gagal memuat pengajuan dinas luar. Periksa koneksi internet.');
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

  const dateKey = toLocalDateString(date);

  // Kalender penuh: hanya tanggal dalam batas susulan (ke belakang) dan batas ke depan yang bisa dipilih.
  const pickDate = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    setDate(new Date(y, m - 1, d));
    setCalendarOpen(false);
  };

  const purposeOk = description.trim().length > 0;
  const timesValid = TIME_FORMAT.test(startTime.trim()) && TIME_FORMAT.test(endTime.trim());
  const durationMinutes = timesValid ? toMinutes(endTime.trim()) - toMinutes(startTime.trim()) : 0;
  const windowOk = !partial || (timesValid && durationMinutes >= limits.min_partial_minutes);
  const isFormValid = purposeOk && windowOk;
  const windowHint = !timesValid
    ? 'Format 24 jam (HH:MM), mulai dan selesai di hari yang sama. Termasuk waktu perjalanan.'
    : durationMinutes <= 0
      ? 'Jam selesai harus setelah jam mulai.'
      : durationMinutes < limits.min_partial_minutes
        ? `Minimal ${limits.min_partial_minutes} menit.`
        : 'Telat dan pulang cepat pada rentang ini tidak dihitung. Absen masuk dan keluar di toko tetap wajib.';
  const timeInvalid = isInvalidTime(startTime) || isInvalidTime(endTime);
  const windowBad = timeInvalid || (timesValid && !windowOk);

  const handleSubmit = useCallback(async () => {
    if (!isFormValid || submitting) return;

    setSubmitting(true);
    try {
      const res = await staffApiFetch<{ message: string }>('/api/staff/field-duty-requests', {
        method: 'POST',
        body: JSON.stringify({
          date: toLocalDateString(date),
          start_time: partial ? startTime.trim() : null,
          end_time: partial ? endTime.trim() : null,
          description: description.trim(),
        }),
      });
      Alert.alert('Terkirim', res.message);
      setDescription('');
      setStartTime('');
      setEndTime('');
      load();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [isFormValid, submitting, partial, startTime, endTime, date, description, load]);

  // Koordinat GPS ponsel saat ini, terbaca otomatis (tidak diketik): wajib untuk foto di lokasi. Mengembalikan null (dengan pesan) bila izin
  // ditolak, GPS belum dapat sinyal, atau lokasi terdeteksi palsu (aplikasi pengubah lokasi, hanya terdeteksi di Android).
  const getPositionOrAlert = useCallback(async (): Promise<Location.LocationObject | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Izin lokasi dibutuhkan', 'Izinkan lokasi di pengaturan ponsel. Lokasi dicatat bersama foto sebagai bukti Anda berada di lokasi dinas.');
      return null;
    }

    try {
      // Batas 20 detik: tanpa ini, GPS yang belum dapat sinyal membuat tombol menggantung tanpa batas. Lewat itu, pakai lokasi terakhir
      // yang masih segar (maks 60 detik, akurasi 100 m); kalau tidak ada, beri pesan.
      const fresh = await Promise.race<Location.LocationObject | null>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
      ]);
      const position = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 100 }));

      if (!position) {
        Alert.alert('Lokasi belum ditemukan', 'GPS belum dapat sinyal. Pindah ke tempat terbuka, pastikan GPS aktif, lalu coba lagi.');
        return null;
      }

      if (position.mocked === true) {
        Alert.alert('Lokasi palsu terdeteksi', 'Matikan aplikasi pengubah lokasi di ponsel Anda, lalu coba lagi.');
        return null;
      }

      return position;
    } catch {
      Alert.alert('Gagal mengambil lokasi', 'Aktifkan GPS lalu coba lagi.');
      return null;
    }
  }, []);

  // Sumber foto untuk pengajuan susulan: foto dari hari dinas yang sudah lewat tidak bisa diambil ulang, jadi boleh dari kamera atau galeri.
  const chooseCatchUpPhoto = useCallback((): Promise<ImagePicker.ImagePickerAsset | null> => new Promise((resolve) => {
    const pick = async (source: 'camera' | 'library') => {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Izin kamera dibutuhkan', 'Izinkan kamera di pengaturan ponsel.');
          resolve(null);
          return;
        }
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      resolve(result.canceled || !result.assets[0] ? null : result.assets[0]);
    };

    Alert.alert('Foto dinas luar', 'Pilih foto dari hari dinas. Lokasi tidak dicatat untuk pengajuan susulan.', [
      { text: 'Kamera', onPress: () => { void pick('camera'); } },
      { text: 'Galeri', onPress: () => { void pick('library'); } },
      { text: 'Batal', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  }), []);

  // Foto bukti saat tiba di lokasi. Pada hari dinas: hanya dari kamera (bukan galeri), supaya foto diambil di tempat, dan lokasi GPS dibaca lebih
  // dulu (gagal cepat sebelum kamera dibuka) lalu dikirim bersama foto. Pengajuan yang masih menunggu persetujuan di hari dinas juga bisa mengirim
  // foto ini. Pengajuan susulan (tanggal sudah lewat): foto saja, boleh dari galeri, tanpa koordinat.
  const takeLocationPhoto = useCallback(async (item: FieldDutyRecord, stage: 'start' | 'end' = 'start') => {
    const catchUp = item.location_photo_needs_coordinates === false;
    let position: Location.LocationObject | null = null;
    let asset: ImagePicker.ImagePickerAsset | null = null;

    if (catchUp) {
      asset = await chooseCatchUpPhoto();
      if (!asset) return;
    } else {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Izin kamera dibutuhkan', 'Izinkan kamera di pengaturan ponsel untuk mengambil foto di lokasi.');
        return;
      }

      setUploadingId(item.id);
      position = await getPositionOrAlert();
      setUploadingId(null);
      if (!position) return;

      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (result.canceled || !result.assets[0]) return;
      asset = result.assets[0];
    }

    setUploadingId(item.id);
    try {
      const form = new FormData();
      if (position) {
        form.append('latitude', String(position.coords.latitude));
        form.append('longitude', String(position.coords.longitude));
        if (position.coords.accuracy != null) form.append('accuracy', String(position.coords.accuracy));
        // Android saja: iOS tidak melaporkan status lokasi palsu, jadi `mocked` kosong dan tidak ikut terkirim.
        if (position.mocked !== undefined) form.append('is_mocked', String(position.mocked));
      }
      const shrunk = await shrinkForUpload(asset, asset.fileName ?? 'lokasi.jpg', LOCATION_PHOTO_UPLOAD);
      form.append('photo', { uri: shrunk.uri, name: shrunk.name, type: shrunk.type } as unknown as Blob);
      await staffApiFetch(`/api/staff/field-duty-requests/${item.id}/${stage === 'end' ? 'end-photo' : 'location-photo'}`, { method: 'POST', body: form });
      const saved = catchUp ? 'tersimpan' : 'dan lokasi tersimpan';
      if (stage === 'end') {
        Alert.alert(`Foto akhir ${saved}`, item.status === 'pending' ? 'Pengajuan Anda masih menunggu persetujuan atasan. Foto ini ikut dinilai begitu disetujui.' : 'Dinas luar Anda lengkap.');
      } else {
        Alert.alert(
          item.status === 'pending' ? 'Foto dan lokasi tersimpan' : catchUp ? 'Foto tersimpan' : 'Foto dan lokasi tersimpan',
          item.status === 'pending' ? 'Pengajuan Anda masih menunggu persetujuan atasan. Foto ini ikut dinilai begitu disetujui. Jangan lupa foto akhir saat dinas selesai.' : 'Foto awal tercatat. Kirim foto akhir saat dinas selesai.',
        );
      }
      await load();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Foto belum terkirim, coba lagi.');
    } finally {
      setUploadingId(null);
    }
  }, [load, getPositionOrAlert, chooseCatchUpPhoto]);

  const handleCancel = useCallback((item: FieldDutyRecord) => {
    Alert.alert('Batalkan Pengajuan', `Batalkan dinas luar ${new Date(item.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}?`, [
      { text: 'Tidak', style: 'cancel' },
      {
        text: 'Ya, Batalkan', style: 'destructive', onPress: async () => {
          setCancellingId(item.id);
          try {
            await staffApiFetch(`/api/staff/field-duty-requests/${item.id}/cancel`, { method: 'POST' });
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

  const header = (
    <View style={styles.header}>
      {router.canGoBack() ? (
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      <Text style={styles.title} numberOfLines={1}>Dinas Luar</Text>
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
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Tanggal dan lama dinas */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name="calendar-outline" size={18} color={accentText} />
                  </View>
                  <Text style={styles.sectionTitle}>Tanggal dinas</Text>
                </View>

                <Pressable
                  style={[styles.dateTile, calendarOpen && styles.dateTileOpen]}
                  onPress={() => setCalendarOpen((open) => !open)}
                  accessibilityRole="button"
                  accessibilityLabel={`Tanggal dinas: ${formatDateLabel(date)}. Ketuk untuk memilih dari kalender`}
                >
                  <View style={styles.dateBig}>
                    <Text style={styles.dateBigDay}>{date.getDate()}</Text>
                  </View>
                  <View style={styles.dateTileText}>
                    <Text style={styles.dateTileMonth} numberOfLines={1}>{date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</Text>
                    <Text style={styles.dateTileWeekday} numberOfLines={1}>{date.toLocaleDateString('id-ID', { weekday: 'long' })}</Text>
                  </View>
                  <Ionicons name={calendarOpen ? 'chevron-up' : 'calendar-outline'} size={20} color={colors.textMuted} />
                </Pressable>

                {calendarOpen ? (
                  <DateGrid
                    value={dateKey}
                    onChange={pickDate}
                    daysAhead={limits.max_days_ahead + 1}
                    daysBack={limits.max_days_back}
                    colors={colors}
                  />
                ) : null}

                <View style={styles.modeRow}>
                  {([[false, 'Sehari penuh'], [true, 'Sebagian hari']] as const).map(([value, label]) => {
                    const active = partial === value;

                    return (
                      <Pressable key={label} style={[styles.modeOption, active && styles.modeOptionActive]} onPress={() => setPartial(value)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                        <Text style={[styles.modeOptionText, active && styles.modeOptionTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Jam (sebagian hari) */}
              {partial ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionIcon}>
                      <Ionicons name="time-outline" size={18} color={accentText} />
                    </View>
                    <Text style={styles.sectionTitle}>Jam dinas</Text>
                  </View>

                  <View style={styles.timeRow}>
                    <View style={styles.timeTile}>
                      <Text style={styles.timeLabel}>Mulai</Text>
                      <AppTextInput
                        style={[styles.timeInput, isInvalidTime(startTime) && { color: colors.danger }]}
                        value={startTime}
                        onChangeText={(v) => setStartTime((prev) => formatTimeInput(v, prev))}
                        placeholder="10:00"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        maxLength={5}
                      />
                    </View>
                    <View style={styles.timeTile}>
                      <Text style={styles.timeLabel}>Selesai</Text>
                      <AppTextInput
                        style={[styles.timeInput, isInvalidTime(endTime) && { color: colors.danger }]}
                        value={endTime}
                        onChangeText={(v) => setEndTime((prev) => formatTimeInput(v, prev))}
                        placeholder="13:00"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        maxLength={5}
                      />
                    </View>
                  </View>
                  <Text style={[styles.hint, windowBad && { color: colors.danger }]}>{timeInvalid ? INVALID_TIME_MESSAGE : windowHint}</Text>
                </View>
              ) : null}

              {/* Tujuan */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name="briefcase-outline" size={18} color={accentText} />
                  </View>
                  <Text style={styles.sectionTitle}>Tujuan / pekerjaan</Text>
                </View>
                <AppTextInput
                  style={styles.textArea}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Contoh: kanvasing area Kelapa Gading dan sekitarnya"
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
                    <View style={styles.rowTitleWrap}>
                      <Text style={styles.rowDate}>{formatDateShort(item.date)}</Text>
                      <Text style={styles.rowTimes}>{item.is_full_day ? 'Sehari penuh' : `${item.start_time}–${item.end_time}`}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: colors[meta.bg] }]}>
                      <View style={[styles.statusDot, { backgroundColor: tone }]} />
                      <Text style={[styles.statusText, { color: tone }]}>{meta.label}</Text>
                    </View>
                  </View>

                  <Text style={styles.rowWork}>{item.description}</Text>

                  {item.needs_location_photo ? (
                    <View style={styles.photoBox}>
                      {item.status === 'pending' || item.location_photo_needs_coordinates === false ? null : (
                      <View style={styles.photoNoteRow}>
                        <Ionicons name="camera-outline" size={18} color={colors.textSecondary} />
                        <Text style={styles.photoNote}>Absen Masuk: ambil foto saat tiba di lokasi dan pastikan GPS nyala.</Text>
                      </View>
                      )}
                      <PressableScale style={styles.photoButton} onPress={() => takeLocationPhoto(item, 'start')} disabled={uploadingId === item.id} accessibilityRole="button" accessibilityLabel="Ambil foto awal di lokasi">
                        {uploadingId === item.id ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.photoButtonText}>Absen Masuk Lokasi</Text>
                        )}
                      </PressableScale>
                    </View>
                  ) : item.needs_end_photo ? (
                    <View style={styles.photoBox}>
                      <View style={styles.photoNoteRow}>
                        <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                        <Text style={styles.photoNote}>Foto Absen Masuk sudah dikirim. {item.location_photo_needs_coordinates === false ? '' : 'Absen Keluar dan pastikan GPS nyala.'}</Text>
                      </View>
                      <PressableScale style={styles.photoButton} onPress={() => takeLocationPhoto(item, 'end')} disabled={uploadingId === item.id} accessibilityRole="button" accessibilityLabel="Ambil foto akhir dinas">
                        {uploadingId === item.id ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.photoButtonText}>Absen Keluar Lokasi</Text>
                        )}
                      </PressableScale>
                    </View>
                  ) : item.status === 'approved' && item.location_photo_url ? (
                    <View style={styles.photoDone}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                      <Text style={styles.photoDoneText}>{item.end_photo_url ? 'Foto Absen Masuk dan Keluar sudah dikirim.' : 'Foto awal sudah dikirim'}</Text>
                    </View>
                  ) : null}

                  {item.status !== 'pending' && item.review_notes ? (
                    <View style={styles.noteBox}>
                      <Text style={styles.noteLabel}>Catatan {item.reviewer_name ?? 'atasan'}</Text>
                      <Text style={styles.noteText}>{item.review_notes}</Text>
                    </View>
                  ) : null}

                  {item.can_cancel ? (
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
              <Ionicons name="navigate-outline" size={30} color={colors.textMuted} />
              <Text style={styles.emptyText}>Belum ada pengajuan dinas luar.</Text>
            </View>
          }
        />

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <PressableScale
            style={[styles.submit, (!isFormValid || submitting) && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={!isFormValid || submitting}
            accessibilityRole="button"
            accessibilityLabel="Ajukan dinas luar"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="paper-plane-outline" size={20} color="#ffffff" />
                <Text style={styles.submitText}>Ajukan Dinas Luar</Text>
              </>
            )}
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan Izin & Cuti, Koreksi Absensi, dan formulir SPK: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
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

    dateTile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 20, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: chip },
    dateTileOpen: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    dateBig: { minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, backgroundColor: card },
    dateBigDay: { fontSize: 36, fontWeight: '800', letterSpacing: -1.2, lineHeight: 42, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    dateTileText: { flex: 1, gap: 2 },
    dateTileMonth: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary, textTransform: 'capitalize' },
    dateTileWeekday: { fontSize: 13, fontWeight: '500', color: colors.textMuted, textTransform: 'capitalize' },

    modeRow: { flexDirection: 'row', gap: 6, padding: 5, borderRadius: radius.pill, backgroundColor: chip },
    modeOption: { flex: 1, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    modeOptionActive: { backgroundColor: card, ...shadow },
    modeOptionText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textMuted },
    modeOptionTextActive: { color: colors.textPrimary },

    timeRow: { flexDirection: 'row', gap: 12 },
    timeTile: { flex: 1, gap: 6, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 20, backgroundColor: chip },
    timeLabel: { textAlign: 'center', fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
    timeInput: { height: 48, padding: 0, textAlign: 'center', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    hint: { fontSize: 12.5, fontWeight: '500', lineHeight: 18, color: colors.textMuted },

    textArea: { minHeight: 104, padding: 14, borderRadius: 20, backgroundColor: chip, fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textPrimary },

    historyTitle: { marginTop: 6, fontSize: 13, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },

    row: { gap: 14, padding: 18, marginBottom: 12, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
    rowTitleWrap: { flex: 1, gap: 2 },
    rowDate: { fontSize: fontSize.base + 1, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    rowTimes: { fontSize: 13, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { fontSize: 12, fontWeight: '800' },
    rowWork: { fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textSecondary },

    photoBox: { gap: 12 },
    photoNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    photoNote: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18, color: colors.textSecondary },
    photoButton: { alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: radius.pill, backgroundColor: colors.accent },
    photoButtonText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: '#ffffff' },
    photoDone: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    photoDoneText: { fontSize: 12.5, fontWeight: '600', color: colors.success },

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
