import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, StyleSheet, Pressable, RefreshControl, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '@/components/ui/AppText';
import { SheetModal, SheetButton, SheetTextInput, SheetNote } from '@/components/ui/SheetModal';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { parseDate } from '@/lib/dates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import DateGrid from '@/components/ui/DateGrid';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

interface MyBooking {
  id: number;
  booking_number: string;
  service_type: string;
  preferred_date: string;
  preferred_time: string | null;
  notes: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  duration_days: number | null;
  end_date: string | null;
  cancel_reason: string | null;
  unread_count: number;
  // Kendaraan (Fase 1 pengerjaan ulang booking): kosong pada booking lama.
  vehicle_plate?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  current_stage: string | null;
  secondary_stage?: string | null;
  // Terisi saat Quality Check lulus: kendaraan siap diambil (Fase 3A).
  ready_at?: string | null;
  pending_reschedule_request: { id: number; requested_date: string } | null;
  created_at: string;
  latest_decided_reschedule_request: { status: 'approved' | 'rejected'; decision_note: string | null; decided_at: string | null } | null;
  pending_cancellation_request: { id: number; reason: string } | null;
  latest_decided_cancellation_request: { status: 'approved' | 'rejected'; decision_note: string | null; decided_at: string | null } | null;
  store: {
    id: number;
    name: string;
    city: string;
  };
}

// "3 jam yang lalu" -- umur booking pending supaya customer tahu sudah berapa lama menunggu.
function timeAgo(iso: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} menit yang lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam yang lalu`;
  return `${Math.floor(diff / 86400)} hari yang lalu`;
}

type NoticeTone = 'warning' | 'danger' | 'success';
interface Notice {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: NoticeTone;
  text: string;
}

// Pesan status kartu booking: `primary` = keadaan SEKARANG (kotak berwarna),
// `results` = hasil pengajuan yang baru diputuskan (catatan kecil, ada batas hari).
function buildNotices(item: MyBooking): { primary: Notice[]; results: Notice[] } {
  const primary: Notice[] = [];
  const results: Notice[] = [];
  const active = item.status === 'pending' || item.status === 'confirmed';

  if (item.status === 'cancelled') {
    primary.push({
      icon: 'information-circle-outline',
      tone: 'danger',
      text: item.cancel_reason ? `Dibatalkan: ${item.cancel_reason}` : 'Booking ini dibatalkan.',
    });
  }

  if (item.status === 'pending' && item.created_at) {
    primary.push({ icon: 'time-outline', tone: 'warning', text: `Menunggu konfirmasi toko · diajukan ${timeAgo(item.created_at)}` });
  }

  if (item.pending_cancellation_request && item.status === 'confirmed') {
    primary.push({ icon: 'close-circle-outline', tone: 'warning', text: 'Pengajuan pembatalan menunggu keputusan toko' });
  }

  if (item.pending_reschedule_request && active) {
    primary.push({
      icon: 'swap-horizontal-outline',
      tone: 'warning',
      text: `Jadwal ulang ke ${formatDate(item.pending_reschedule_request.requested_date)} menunggu keputusan toko`,
    });
  }

  if (!item.pending_reschedule_request && active) {
    const r = item.latest_decided_reschedule_request;
    if (r?.status === 'approved' && withinDays(r.decided_at, 3)) {
      results.push({ icon: 'checkmark-circle-outline', tone: 'success', text: 'Jadwal ulang disetujui toko' });
    } else if (r?.status === 'rejected') {
      results.push({
        icon: 'close-circle-outline',
        tone: 'danger',
        text: `Jadwal ulang ditolak${r.decision_note ? `: ${r.decision_note}` : ''}`,
      });
    }
  }

  if (!item.pending_cancellation_request && item.status === 'confirmed') {
    const c = item.latest_decided_cancellation_request;
    if (c?.status === 'rejected' && withinDays(c.decided_at, 7)) {
      results.push({
        icon: 'information-circle-outline',
        tone: 'danger',
        text: `Pembatalan ditolak${c.decision_note ? `: ${c.decision_note}` : ''}`,
      });
    }
  }

  return { primary, results };
}

function withinDays(iso: string | null | undefined, days: number): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < days * 86400 * 1000;
}

function getStatusMeta(colors: typeof darkColors): Record<
  MyBooking['status'],
  { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> {
  return {
    pending:   { label: 'Menunggu Konfirmasi', color: colors.warning,  bg: colors.warningBg, icon: 'time-outline' },
    confirmed: { label: 'Dikonfirmasi',        color: colors.success,  bg: colors.successBg, icon: 'checkmark-circle-outline' },
    completed: { label: 'Selesai',             color: colors.textMuted, bg: colors.surface,  icon: 'checkmark-done-outline' },
    cancelled: { label: 'Dibatalkan',          color: colors.danger,   bg: colors.dangerBg,  icon: 'close-circle-outline' },
  };
}

// Tanggal booking sudah lewat -- server menolak pengajuan batal/jadwal ulang
// (hubungi toko), jadi tombolnya disembunyikan.
function isDatePast(dateStr: string): boolean {
  const d = parseDate(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

function formatDate(dateStr: string) {
  try {
    return parseDate(dateStr).toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export default function MyBookingsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);

  const [bookings, setBookings] = useState<MyBooking[]>([]);
  // Segmen "Aktif" (pending/confirmed) vs "Riwayat" (selesai/batal) + paginasi
  // 15 per halaman (2026-10-06).
  const [segment, setSegment] = useState<'active' | 'history'>('active');
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const requestToken = useRef(0);
  const { isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // Pengajuan jadwal ulang (keputusan 2026-10-02): customer mengajukan,
  // toko yang memutuskan.
  const [rescheduleFor, setRescheduleFor] = useState<MyBooking | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleBlocked, setRescheduleBlocked] = useState<string[]>([]);
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleLoadFailed, setRescheduleLoadFailed] = useState(false);

  const loadRescheduleAvailability = (booking: MyBooking) => {
    setRescheduleLoading(true);
    setRescheduleLoadFailed(false);
    // Tanggal diblokir admin + tanggal penuh dinonaktifkan; hari tutup mingguan
    // ditolak server dengan pesan jelas. Pilihan dikunci sampai data termuat.
    // Satu endpoint: toko tutup (mingguan/diblokir) + kapasitas penuh.
    apiFetch<{ data: string[] }>(`/api/stores/${booking.store.id}/unavailable-dates?booking_id=${booking.id}`)
      .then((res) => setRescheduleBlocked(res.data))
      .catch(() => setRescheduleLoadFailed(true))
      .finally(() => setRescheduleLoading(false));
  };

  // Tautan dari pengingat (H-2/H-1): ?reschedule=<id> membuka langsung ajuan jadwal ulang booking itu, sekali saja, bila masih
  // memenuhi syarat tombolnya. Bila tidak (sudah dikerjakan, ada pengajuan menunggu, tanggal lewat), daftar tampil biasa.
  const { reschedule: rescheduleParam } = useLocalSearchParams<{ reschedule?: string }>();
  const handledRescheduleParam = useRef<string | null>(null);

  useEffect(() => {
    if (!rescheduleParam || handledRescheduleParam.current === rescheduleParam || loading) return;
    const target = bookings.find((b) => String(b.id) === String(rescheduleParam));
    if (!target) return;
    handledRescheduleParam.current = rescheduleParam;
    const eligible = (target.status === 'pending' || target.status === 'confirmed')
      && !target.pending_reschedule_request && !target.pending_cancellation_request
      && !target.current_stage && !target.secondary_stage && !isDatePast(target.preferred_date);
    if (eligible) openReschedule(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescheduleParam, bookings, loading]);

  const openReschedule = (booking: MyBooking) => {
    setRescheduleFor(booking);
    setRescheduleDate('');
    setRescheduleReason('');
    setRescheduleBlocked([]);
    loadRescheduleAvailability(booking);
  };

  const submitReschedule = () => {
    if (!rescheduleFor || !rescheduleDate || rescheduleSubmitting) return;
    setRescheduleSubmitting(true);
    apiFetch(`/api/customer/bookings/${rescheduleFor.id}/reschedule-request`, {
      method: 'POST',
      body: JSON.stringify({ requested_date: rescheduleDate, reason: rescheduleReason.trim() || null }),
    })
      .then(() => {
        hapticSuccess();
        setRescheduleFor(null);
        Alert.alert('Pengajuan Terkirim', 'Toko akan memberi keputusan. Kamu akan mendapat notifikasi.');
        load();
      })
      .catch((err) => {
        hapticError();
        Alert.alert('Gagal Mengajukan', err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.');
      })
      .finally(() => setRescheduleSubmitting(false));
  };

  const load = (isRefresh = false, seg: 'active' | 'history' = segment) => {
    const token = ++requestToken.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: MyBooking[]; meta?: { current_page: number; last_page: number } }>(`/api/customer/bookings?segment=${seg}&page=1`)
      .then((res) => {
        if (token !== requestToken.current) return;
        setBookings(res.data);
        setPage(res.meta?.current_page ?? 1);
        setLastPage(res.meta?.last_page ?? 1);
        if (isRefresh) hapticSuccess();
      })
      .catch((err) => {
        if (token !== requestToken.current) return;
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat data bookingmu.'
        );
        if (isRefresh) hapticError();
      })
      .finally(() => {
        if (token !== requestToken.current) return;
        setLoading(false);
        setRefreshing(false);
      });
  };

  const changeSegment = (seg: 'active' | 'history') => {
    if (seg === segment) return;
    hapticLight();
    setSegment(seg);
    setBookings([]);
    setLoadMoreFailed(false);
    load(false, seg);
  };

  const loadMore = () => {
    if (loadingMore || loading || page >= lastPage) return;
    const token = requestToken.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    apiFetch<{ data: MyBooking[]; meta?: { current_page: number; last_page: number } }>(`/api/customer/bookings?segment=${segment}&page=${page + 1}`)
      .then((res) => {
        if (token !== requestToken.current) return;
        setBookings((prev) => [...prev, ...res.data.filter((b) => !prev.some((p) => p.id === b.id))]);
        setPage(res.meta?.current_page ?? page + 1);
        setLastPage(res.meta?.last_page ?? lastPage);
      })
      .catch(() => { if (token === requestToken.current) setLoadMoreFailed(true); })
      .finally(() => setLoadingMore(false));
  };

  // Dimuat ulang tiap layar kembali fokus (mis. setelah membuka chat) supaya
  // badge "pesan baru" & status langsung terbarui (2026-10-02). Pemuatan
  // pertama pakai spinner, berikutnya diam-diam.
  const firstFocus = useRef(true);
  const segmentRef = useRef(segment);
  segmentRef.current = segment;
  const pageRef = useRef(page);
  pageRef.current = page;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        load();
      } else {
        // Diam-diam: muat ulang halaman 1..N yang sudah terbuka.
        const token = ++requestToken.current;
        (async () => {
          try {
            const all: MyBooking[] = [];
            let last = 1;
            for (let p = 1; p <= Math.max(1, pageRef.current); p++) {
              const res = await apiFetch<{ data: MyBooking[]; meta?: { current_page: number; last_page: number } }>(
                `/api/customer/bookings?segment=${segmentRef.current}&page=${p}`
              );
              all.push(...res.data);
              last = res.meta?.last_page ?? 1;
              if (p >= last) break;
            }
            if (token !== requestToken.current) return;
            setBookings(all.filter((b, i) => all.findIndex((x) => x.id === b.id) === i));
            setLastPage(last);
          } catch { /* diam-diam */ }
        })();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // Batalkan booking sendiri — SEBELUMNYA tidak ada aksi ini sama sekali,
  // customer terpaksa hubungi toko manual untuk batal. Dibatasi ke
  // status 'pending' saja oleh backend (lihat
  // Customer\BookingController::cancel()), jadi tombol ini pun cuma
  // ditampilkan untuk booking 'pending'.
  // Pembatalan lewat modal dengan kolom alasan opsional (2026-10-03) --
  // Alert.alert tidak punya input teks, jadi cancel_reason customer selalu
  // kosong dan staff tidak tahu kenapa.
  const [cancelTarget, setCancelTarget] = useState<MyBooking | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // Pengajuan pembatalan booking yang SUDAH dikonfirmasi (2026-10-05):
  // alasan wajib, toko yang memutuskan.
  const [cancelReqTarget, setCancelReqTarget] = useState<MyBooking | null>(null);
  const [cancelReqReason, setCancelReqReason] = useState('');
  const [cancelReqSubmitting, setCancelReqSubmitting] = useState(false);

  const submitCancellationRequest = () => {
    if (!cancelReqTarget || cancelReqSubmitting) return;
    if (cancelReqReason.trim().length === 0) {
      Alert.alert('Alasan wajib', 'Isi alasan pembatalan agar toko bisa memprosesnya.');
      return;
    }
    setCancelReqSubmitting(true);
    apiFetch(`/api/customer/bookings/${cancelReqTarget.id}/cancellation-request`, {
      method: 'POST',
      body: JSON.stringify({ reason: cancelReqReason.trim() }),
    })
      .then(() => {
        hapticSuccess();
        setCancelReqTarget(null);
        Alert.alert('Pengajuan Terkirim', 'Toko akan memberi keputusan. Kamu akan mendapat notifikasi.');
        load();
      })
      .catch((err) => {
        hapticError();
        Alert.alert('Gagal Mengajukan', err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.');
      })
      .finally(() => setCancelReqSubmitting(false));
  };

  const handleCancel = (booking: MyBooking) => {
    setCancelReason('');
    setCancelTarget(booking);
  };

  const confirmCancel = () => {
    const booking = cancelTarget;
    if (!booking) return;
    setCancelTarget(null);
    setCancellingId(booking.id);
    apiFetch<{ success: boolean; message: string }>(`/api/customer/bookings/${booking.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
    })
      .then(() => {
        hapticSuccess();
        load();
      })
      .catch((err) => {
        hapticError();
        Alert.alert(
          'Gagal Membatalkan',
          err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.'
        );
      })
      .finally(() => setCancellingId(null));
  };

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => load(true)}
      colors={[colors.accent]}
      tintColor={colors.accent}
    />
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
        <Text style={styles.topTitle}>Booking Saya</Text>
      </View>

      {isLoggedIn && (
        <View style={styles.segmentWrap}>
          <View style={styles.segmentRow}>
            {([['active', 'Aktif'], ['history', 'Riwayat']] as const).map(([key, label]) => (
              <Pressable
                key={key}
                style={[styles.segmentChip, segment === key && styles.segmentChipActive]}
                onPress={() => changeSegment(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: segment === key }}
                accessibilityLabel={`Booking ${label}`}
              >
                <Text style={[styles.segmentChipText, segment === key && styles.segmentChipTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {!isLoggedIn ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="lock-closed-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateTitle}>Masuk dulu</Text>
          <Text style={styles.centerStateText}>Masuk ke akunmu untuk melihat bookingmu.</Text>
          <PressableScale style={styles.primaryButton} onPress={() => router.push('/auth/login' as never)} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Masuk Sekarang</Text>
          </PressableScale>
        </ScrollView>
      ) : loading ? (
        <View style={styles.listContent} accessibilityLabel="Memuat booking" accessibilityRole="progressbar">
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.card, { opacity: 0.6 }]}>
              <View style={{ height: 12, width: '35%', borderRadius: 6, backgroundColor: colors.border }} />
              <View style={{ height: 20, width: '65%', borderRadius: 8, backgroundColor: colors.border }} />
              <View style={{ height: 60, width: '100%', borderRadius: 18, backgroundColor: colors.border }} />
            </View>
          ))}
        </View>
      ) : error ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateText}>{error}</Text>
          <PressableScale style={styles.primaryButton} onPress={() => { hapticLight(); load(); }} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Coba Lagi</Text>
          </PressableScale>
        </ScrollView>
      ) : bookings.length === 0 ? (
        <ScrollView contentContainerStyle={styles.centerState} refreshControl={refreshControl}>
          <View style={styles.centerIcon}>
            <Ionicons name="calendar-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateTitle}>{segment === 'active' ? 'Belum ada booking aktif' : 'Belum ada riwayat'}</Text>
          <Text style={styles.centerStateText}>
            {segment === 'active'
              ? 'Tidak ada booking yang sedang berjalan.'
              : 'Belum ada riwayat booking (selesai/dibatalkan).'}
          </Text>
          {segment === 'active' && (
            <PressableScale style={styles.primaryButton} onPress={() => router.push('/booking' as never)} accessibilityRole="button">
              <Text style={styles.primaryButtonText}>Buat Booking</Text>
            </PressableScale>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
            ) : loadMoreFailed ? (
              <Pressable
                style={{ alignItems: 'center', padding: spacing.md }}
                onPress={() => { hapticLight(); loadMore(); }}
                accessibilityRole="button"
                accessibilityLabel="Coba lagi memuat booking berikutnya"
              >
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Gagal memuat lagi. Ketuk untuk coba lagi.</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item, index }) => {
            const baseMeta = STATUS_META[item.status] ?? STATUS_META.pending;
            const meta = item.status === 'confirmed' && item.ready_at
              ? { ...baseMeta, label: 'Siap Diambil', icon: 'car-outline' as const }
              : baseMeta;
            const vehicleName = [item.vehicle_brand, item.vehicle_model].filter(Boolean).join(' ');
            const { primary, results } = buildNotices(item);
            const noticeTone = primary[0]?.tone;
            const canReschedule = (item.status === 'pending' || item.status === 'confirmed') && !item.pending_reschedule_request && !item.pending_cancellation_request && !item.current_stage && !item.secondary_stage && !isDatePast(item.preferred_date);
            const canRequestCancel = item.status === 'confirmed' && !item.pending_cancellation_request && !isDatePast(item.preferred_date);

            return (
              <FadeInUp index={index} enabled={index < 5}>
                <View style={styles.card}>
                  {/* Baris atas: nomor booking + status */}
                  <View style={styles.cardHeader}>
                    <Text style={styles.bookingNumber} numberOfLines={1}>{item.booking_number}</Text>
                    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon} size={13} color={meta.color} />
                      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>

                  {/* Layanan + toko */}
                  <View style={{ gap: 4 }}>
                    <Text style={styles.serviceName}>{item.service_type}</Text>
                    <View style={styles.storeRow}>
                      <Ionicons name="storefront-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.storeText} numberOfLines={1}>{item.store.name} · {item.store.city}</Text>
                    </View>
                  </View>

                  {/* Kendaraan, jadwal, estimasi, catatan dalam satu blok lembut */}
                  <View style={styles.infoBlock}>
                    {item.vehicle_plate ? (
                      <View style={styles.infoRow}>
                        <View style={styles.infoIcon}><Ionicons name="car-sport-outline" size={16} color={colors.accent} /></View>
                        <View style={styles.vehicleLine}>
                          <View style={styles.plate}><Text style={styles.plateText}>{item.vehicle_plate}</Text></View>
                          {vehicleName ? <Text style={styles.infoText} numberOfLines={1}>{vehicleName}</Text> : null}
                        </View>
                      </View>
                    ) : null}
                    <View style={styles.infoRow}>
                      <View style={styles.infoIcon}><Ionicons name="calendar-outline" size={16} color={colors.accent} /></View>
                      <Text style={styles.infoText}>
                        {formatDate(item.preferred_date)}{item.preferred_time ? `, ${item.preferred_time}` : ''}
                      </Text>
                    </View>
                    {item.duration_days && item.status !== 'cancelled' ? (
                      <View style={styles.infoRow}>
                        <View style={styles.infoIcon}><Ionicons name="hourglass-outline" size={16} color={colors.accent} /></View>
                        <Text style={styles.infoText}>
                          Estimasi {item.duration_days} hari kerja{item.end_date ? ` · s/d ${formatDate(item.end_date)}` : ''}
                        </Text>
                      </View>
                    ) : null}
                    {item.notes ? (
                      <View style={styles.infoRow}>
                        <View style={styles.infoIcon}><Ionicons name="document-text-outline" size={16} color={colors.accent} /></View>
                        <Text style={[styles.infoText, { color: colors.textSecondary }]}>{item.notes}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Status utama: satu kotak berwarna */}
                  {primary.length > 0 && (
                    <View style={[styles.noticeBox, { backgroundColor: noticeTone === 'danger' ? colors.dangerBg : colors.warningBg }]} accessibilityRole="summary">
                      {primary.map((n, i) => (
                        <View key={i} style={styles.noticeRow}>
                          <Ionicons name={n.icon} size={16} color={colors[n.tone]} />
                          <Text style={[styles.noticeText, { color: colors[n.tone] }]}>{n.text}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {results.map((n, i) => (
                    <View key={i} style={styles.resultRow}>
                      <Ionicons name={n.icon} size={14} color={colors[n.tone]} />
                      <Text style={[styles.resultText, { color: colors[n.tone] }]}>{n.text}</Text>
                    </View>
                  ))}

                  {item.status !== 'cancelled' && (
                    <PressableScale
                      style={styles.chatBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Progress dan chat dengan toko${item.unread_count > 0 ? `, ${item.unread_count} pesan baru` : ''}`}
                      onPress={() => router.push(`/booking/${item.id}/chat` as never)}
                    >
                      <Ionicons name="chatbubbles-outline" size={18} color="#ffffff" />
                      <Text style={styles.chatBtnText}>Progress & Chat dengan Toko</Text>
                      {item.unread_count > 0 ? (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
                        </View>
                      ) : null}
                    </PressableScale>
                  )}

                  {canReschedule || canRequestCancel || item.status === 'pending' ? (
                    <View style={styles.secondaryRow}>
                      {canReschedule && (
                        <PressableScale style={styles.secondaryBtn} onPress={() => openReschedule(item)} accessibilityRole="button">
                          <Ionicons name="swap-horizontal-outline" size={16} color={colors.textPrimary} />
                          <Text style={styles.secondaryBtnText}>Jadwal Ulang</Text>
                        </PressableScale>
                      )}

                      {canRequestCancel && (
                        <PressableScale
                          style={[styles.secondaryBtn, styles.dangerBtn]}
                          onPress={() => { setCancelReqReason(''); setCancelReqTarget(item); }}
                          accessibilityRole="button"
                        >
                          <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                          <Text style={[styles.secondaryBtnText, { color: colors.danger }]}>Ajukan Pembatalan</Text>
                        </PressableScale>
                      )}

                      {item.status === 'pending' && (
                        <PressableScale
                          style={[styles.secondaryBtn, styles.dangerBtn]}
                          disabled={cancellingId === item.id}
                          onPress={() => handleCancel(item)}
                          accessibilityRole="button"
                        >
                          {cancellingId === item.id ? (
                            <ActivityIndicator size="small" color={colors.danger} />
                          ) : (
                            <>
                              <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                              <Text style={[styles.secondaryBtnText, { color: colors.danger }]}>Batalkan Booking</Text>
                            </>
                          )}
                        </PressableScale>
                      )}
                    </View>
                  ) : null}
                </View>
              </FadeInUp>
            );
          }}
        />
      )}

      {/* Lembar-lembar pengajuan memakai SheetModal bersama: ikon, judul besar, keterangan, isi, dan tombol pil. */}
      <SheetModal
        visible={cancelReqTarget !== null}
        onClose={() => setCancelReqTarget(null)}
        tone="danger"
        icon="close-circle-outline"
        title="Ajukan Pembatalan"
        subtitle={cancelReqTarget ? `Booking ${cancelReqTarget.booking_number}` : undefined}
        actions={
          <>
            <SheetButton label="Tutup" onPress={() => setCancelReqTarget(null)} disabled={cancelReqSubmitting} />
            <SheetButton
              label="Kirim Pengajuan"
              variant="danger"
              onPress={submitCancellationRequest}
              disabled={!cancelReqReason.trim()}
              loading={cancelReqSubmitting}
            />
          </>
        }
      >
        <SheetTextInput
          label="Alasan pembatalan (wajib)"
          placeholder="Ceritakan alasan pembatalan"
          value={cancelReqReason}
          onChangeText={setCancelReqReason}
          maxLength={500}
          multiline
        />
      </SheetModal>

      <SheetModal
        visible={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        tone="danger"
        icon="trash-outline"
        title="Batalkan Booking?"
        subtitle={cancelTarget ? `Booking ${cancelTarget.booking_number}` : undefined}
        actions={
          <>
            <SheetButton label="Tidak" onPress={() => setCancelTarget(null)} />
            <SheetButton label="Ya, Batalkan" variant="danger" onPress={confirmCancel} />
          </>
        }
      >
        <SheetNote tone="danger" icon="alert-circle-outline" text="Booking akan dibatalkan. Tindakan ini tidak bisa diurungkan." />
        <SheetTextInput label="Alasan (opsional)" placeholder="Ceritakan alasan pembatalan" value={cancelReason} onChangeText={setCancelReason} maxLength={500} />
      </SheetModal>

      <SheetModal
        visible={rescheduleFor !== null}
        onClose={() => setRescheduleFor(null)}
        icon="swap-horizontal-outline"
        title="Ajukan Jadwal Ulang"
        subtitle={rescheduleFor ? `${rescheduleFor.booking_number} • ${rescheduleFor.store.name}` : undefined}
        actions={
          <>
            <SheetButton label="Batal" onPress={() => setRescheduleFor(null)} />
            <SheetButton label="Kirim Pengajuan" variant="primary" onPress={submitReschedule} disabled={!rescheduleDate} loading={rescheduleSubmitting} />
          </>
        }
      >
        {rescheduleLoading ? <Text style={styles.sheetHint}>Memuat ketersediaan tanggal...</Text> : null}
        {rescheduleLoadFailed && rescheduleFor ? (
          <PressableScale onPress={() => loadRescheduleAvailability(rescheduleFor)} accessibilityRole="button">
            <SheetNote tone="warning" icon="alert-circle-outline" text="Ketersediaan tanggal gagal dimuat. Tanggal tetap dicek toko saat pengajuan dikirim. Ketuk untuk coba lagi." />
          </PressableScale>
        ) : null}
        <View style={styles.sheetCalendar}>
          <DateGrid
            value={rescheduleDate}
            onChange={setRescheduleDate}
            disabledDates={rescheduleBlocked}
            currentDate={rescheduleFor?.preferred_date}
            loading={rescheduleLoading}
            colors={colors}
          />
        </View>
        <SheetTextInput label="Alasan (opsional)" placeholder="Ceritakan alasan jadwal ulang" value={rescheduleReason} onChangeText={setRescheduleReason} maxLength={500} />
      </SheetModal>
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

    // Segmen Aktif / Riwayat: satu pil abu muda berisi dua segmen; yang dipilih merah.
    segmentWrap: { paddingHorizontal: 24, paddingBottom: spacing.sm },
    segmentRow: { flexDirection: 'row', padding: 4, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    segmentChip: { flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    segmentChipActive: { backgroundColor: colors.accent },
    segmentChipText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
    segmentChipTextActive: { color: '#ffffff', fontWeight: '800' },

    centerState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    centerStateTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    centerStateText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56, gap: 14 },

    card: { gap: 16, padding: 18, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    bookingNumber: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textMuted },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 12, borderRadius: 14 },
    badgeText: { fontSize: 12, fontWeight: '800' },

    serviceName: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    storeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    storeText: { flex: 1, fontSize: 13, color: colors.textSecondary },

    infoBlock: { gap: 12, padding: 14, borderRadius: 20, backgroundColor: colors.bg },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    infoIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    infoText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
    vehicleLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    plate: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textPrimary, backgroundColor: colors.bg },
    plateText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textPrimary },

    noticeBox: { padding: 14, borderRadius: 18, gap: 8 },
    noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    noticeText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
    resultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: -6, paddingHorizontal: 4 },
    resultText: { flex: 1, fontSize: 12, lineHeight: 18 },

    chatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 26, backgroundColor: colors.accent },
    chatBtnText: { fontSize: 14, fontWeight: '800', color: '#ffffff' },
    unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
    unreadBadgeText: { fontSize: 12, fontWeight: '800', color: colors.accent },

    secondaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    secondaryBtn: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.bg },
    dangerBtn: { backgroundColor: colors.dangerBg },
    secondaryBtnText: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },

    sheetHint: { fontSize: 13, color: colors.textMuted },
    sheetCalendar: { padding: 12, borderRadius: 22, backgroundColor: colors.surfaceElevated },
  });
}
