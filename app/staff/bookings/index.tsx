import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl, ScrollView, Modal, ActivityIndicator, TextInput, type TextProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/ui/PressableScale';
import { AppText } from '@/components/ui/AppText';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { StaffBottomNav, NAV_CLEARANCE } from '@/components/staff/StaffBottomNav';
import { useHideNavOnScroll } from '@/lib/staff-nav-visibility';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { parseDate } from '@/lib/dates';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface StaffBooking {
  id: number;
  booking_number: string;
  service_type: string;
  preferred_date: string;
  duration_days: number | null;
  end_date: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  current_stage: string | null;
  unread_count?: number;
  created_at?: string;
  pending_reschedule_request?: { id: number; requested_date: string } | null;
  pending_cancellation_request?: { id: number; reason: string } | null;
  cancel_reason?: string | null;
  cancelled_by_type?: string | null;
  customer_name: string | null;
  customer: { id: number; name: string; phone_number: string } | null;
  // Kendaraan (Fase 1 pengerjaan ulang booking): kosong pada booking lama / dari aplikasi versi lama.
  vehicle_plate?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  store: { id: number; name: string } | null;
}

const STATUS_META: Record<
  StaffBooking['status'],
  { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }
> = {
  pending: { label: 'Menunggu', color: 'warning', bg: 'warningBg' },
  confirmed: { label: 'Dikonfirmasi', color: 'success', bg: 'successBg' },
  completed: { label: 'Selesai', color: 'textMuted', bg: 'surface' },
  cancelled: { label: 'Dibatalkan', color: 'danger', bg: 'dangerBg' },
};

const STAGE_LABEL: Record<string, string> = {
  kf_cleaning: 'Pembersihan',
  kf_heating: 'Pemanasan',
  kf_installation: 'Instalasi Kaca Film',
  ppf_washing: 'Proses Cuci',
  ppf_detailing: 'Detailing',
  ppf_installation: 'Pemasangan PPF',
  qc: 'Quality Check',
  completed: 'Serah Terima Unit',
};

type StatusFilter = 'all' | 'pending' | 'progress' | 'completed' | 'cancelled' | 'overdue';
type DateFilter = 'all' | 'today' | 'week';

// "Aktif" (progress) = menunggu + dikonfirmasi, yaitu pekerjaan yang masih harus ditangani. Jadi tampilan awal, supaya booking yang sudah
// selesai tidak menutupi pekerjaan hari ini (sebelumnya "Semua" memuat booking selesai paling atas).
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'progress', label: 'Aktif' },
  { key: 'pending', label: 'Menunggu' },
  { key: 'overdue', label: 'Lewat tanggal' },
  { key: 'completed', label: 'Selesai' },
  { key: 'cancelled', label: 'Dibatalkan' },
  { key: 'all', label: 'Semua' },
];

const DATE_FILTER_ICON: Record<DateFilter, keyof typeof Ionicons.glyphMap> = { all: 'calendar-outline', today: 'today-outline', week: 'calendar-number-outline' };

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: 'all', label: 'Semua tanggal' },
  { key: 'today', label: 'Hari ini' },
  { key: 'week', label: '7 hari' },
];

// Teks layar ini dibatasi pembesarannya (1,25x): pada ukuran font sistem besar, kartu kapasitas dan filter sebelumnya memakan lebih
// dari separuh layar sehingga hanya dua booking yang terlihat.
function T(props: TextProps) {
  return <AppText maxFontSizeMultiplier={1.25} {...props} />;
}

// Booking pending lebih dari 4 jam sejak dibuat (SLA, 2026-10-02).
function isOverSla(b: { status: string; created_at?: string }): boolean {
  if (b.status !== 'pending' || !b.created_at) return false;
  return Date.now() - new Date(b.created_at).getTime() > 4 * 60 * 60 * 1000;
}

function buildBookingQuery(status: StatusFilter, q: string, date: DateFilter, page?: number): string {
  const params: string[] = [];
  if (status === 'overdue') params.push('overdue=1');
  else if (status !== 'all') params.push(`status=${status}`);
  if (q) params.push(`q=${encodeURIComponent(q)}`);
  if (date !== 'all') params.push(`date=${date}`);
  if (page) params.push(`page=${page}`);
  return params.length ? `?${params.join('&')}` : '';
}

function formatDate(dateString: string): string {
  return parseDate(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "Hari ini" / "Besok" / "Kemarin" untuk tanggal terdekat; selain itu null.
function relativeDay(dateString: string): string | null {
  const d = parseDate(dateString);
  const today = new Date();
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86400000
  );
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Besok';
  if (diff === -1) return 'Kemarin';
  return null;
}

// Booking PPF biasanya makan beberapa hari kerja (lihat duration_days di
// backend) — installer perlu tahu ini bukan cuma 1 hari supaya tidak
// salah perkiraan jadwal. Booking 1 hari (kaca film/konsultasi/dll) tetap
// tampil format tanggal tunggal seperti sebelumnya.
function formatDateRange(startDate: string, endDate: string | null, durationDays: number | null): string {
  if (!durationDays || durationDays <= 1 || !endDate) {
    return formatDate(startDate);
  }

  return `${formatDate(startDate)} – ${formatDate(endDate)} · ${durationDays} hari`;
}

export default function StaffBookingListScreen() {
  const hideNavOnScroll = useHideNavOnScroll();
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deep-link push (mis. reminder SLA: /staff/bookings?status=pending)
  // langsung memasang filter yang sesuai.
  const params = useLocalSearchParams<{ status?: string; overdue?: string }>();
  const deepLinkStatus = params.overdue === '1' ? 'overdue' : params.status;
  const initialStatus = STATUS_FILTERS.some((f) => f.key === deepLinkStatus) ? (deepLinkStatus as StatusFilter) : 'progress';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);

  useEffect(() => {
    if (STATUS_FILTERS.some((f) => f.key === deepLinkStatus)) {
      setStatusFilter(deepLinkStatus as StatusFilter);
    }
  }, [deepLinkStatus]);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  // Filter tanggal dipindah ke lembar bawah (tombol di samping pencarian) supaya layar utama hanya berisi pencarian dan status.
  const [dateSheet, setDateSheet] = useState(false);
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);
  // Pagination (diperbaiki 2026-10-02) -- backend paginate(20), sebelumnya
  // cuma halaman 1 yang pernah dimuat.
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // Token permintaan (2026-10-03): hasil fetch/loadMore dari filter LAMA
  // dibuang kalau filter sudah berganti, supaya data tidak tercampur.
  const requestToken = useRef(0);

  const fetchBookings = useCallback(() => {
    const token = ++requestToken.current;
    const query = buildBookingQuery(statusFilter, debouncedSearch, dateFilter);
    setError(null);
    return staffApiFetch<{ data: StaffBooking[]; meta?: { current_page: number; last_page: number } }>(`/api/staff/bookings${query}`)
      .then((res) => {
        if (token !== requestToken.current) return;
        setBookings(res.data);
        setPage(res.meta?.current_page ?? 1);
        setLastPage(res.meta?.last_page ?? 1);
      })
      .catch(() => {
        if (token === requestToken.current) setError('Gagal memuat daftar booking. Periksa koneksi internet.');
      });
  }, [statusFilter, debouncedSearch, dateFilter]);

  useEffect(() => {
    setLoading(true);
    fetchBookings().finally(() => setLoading(false));
  }, [fetchBookings]);

  // Muat ulang diam-diam saat KEMBALI FOKUS (badge pesan baru, status):
  // memuat ulang semua halaman yang sudah terbuka (bukan hanya halaman 1)
  // supaya daftar & posisi scroll tidak lompat. Memakai ref ke state terbaru
  // sehingga effect ini TIDAK ikut jalan tiap filter berubah (sudah ditangani
  // effect di atas) -- sebelumnya fetch dobel.
  const latest = useRef({ statusFilter, debouncedSearch, dateFilter, page });
  latest.current = { statusFilter, debouncedSearch, dateFilter, page };
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      const { statusFilter: sf, debouncedSearch: q, dateFilter: df, page: loadedPages } = latest.current;
      const token = ++requestToken.current;
      (async () => {
        try {
          const all: StaffBooking[] = [];
          let lp = 1;
          for (let p = 1; p <= Math.max(1, loadedPages); p++) {
            const res = await staffApiFetch<{ data: StaffBooking[]; meta?: { current_page: number; last_page: number } }>(
              `/api/staff/bookings${buildBookingQuery(sf, q, df, p)}`
            );
            if (token !== requestToken.current) return;
            // Dedupe berdasar id -- urutan bisa bergeser antar halaman kalau
            // ada booking baru/berubah di sela permintaan.
            all.push(...res.data.filter((b) => !all.some((x) => x.id === b.id)));
            lp = res.meta?.last_page ?? lp;
            if (p >= lp) break;
          }
          setBookings(all);
          setLastPage(lp);
        } catch {
          /* diam-diam: data lama tetap tampil */
        }
      })();
    }, [])
  );

  const loadMore = useCallback(() => {
    if (loadingMore || loading || page >= lastPage) return;
    const token = requestToken.current;
    setLoadingMore(true);
    staffApiFetch<{ data: StaffBooking[]; meta?: { current_page: number; last_page: number } }>(`/api/staff/bookings${buildBookingQuery(statusFilter, debouncedSearch, dateFilter, page + 1)}`)
      .then((res) => {
        if (token !== requestToken.current) return;
        setBookings((prev) => [...prev, ...res.data.filter((b) => !prev.some((p) => p.id === b.id))]);
        setPage(res.meta?.current_page ?? page + 1);
        setLastPage(res.meta?.last_page ?? lastPage);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [loadingMore, loading, page, lastPage, statusFilter, debouncedSearch, dateFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBookings();
    setRefreshing(false);
  }, [fetchBookings]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        {/* Menu-menu lain (Absensi, Slip Gaji, Inventaris, dst) ada sebagai kotak di halaman awal staff (app/staff/index.tsx) dan
            di bilah bawah; header ini cukup judul dan siapa yang masuk (keluar akun ada di Profil). */}
        <View style={styles.headerText}>
          <T style={styles.headerTitle} numberOfLines={1}>Booking</T>
        </View>
      </View>

      <View style={styles.searchWrap}>
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nomor booking, nama, atau telepon"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          maxFontSizeMultiplier={1.25}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Hapus pencarian">
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
      <Pressable style={[styles.filterButton, dateFilter !== 'all' && styles.filterButtonActive]} onPress={() => setDateSheet(true)} accessibilityRole="button" accessibilityLabel="Filter tanggal">
        <Ionicons name="options-outline" size={22} color={dateFilter !== 'all' ? '#ffffff' : colors.textSecondary} />
      </Pressable>
      </View>

      {/* flexGrow/flexShrink 0 WAJIB: tanpa itu ScrollView horizontal ini ikut dikempiskan FlatList di bawahnya sehingga chip
          tampil sebagai batang kosong tanpa teks. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.noGrow} contentContainerStyle={styles.chipRow}>
        {dateFilter !== 'all' ? (
          <Pressable style={styles.dateChip} onPress={() => setDateFilter('all')} accessibilityRole="button" accessibilityLabel={`Hapus filter ${DATE_FILTERS.find((f) => f.key === dateFilter)?.label}`}>
            <Ionicons name={DATE_FILTER_ICON[dateFilter]} size={15} color={accentText} />
            <T style={styles.dateChipText}>{DATE_FILTERS.find((f) => f.key === dateFilter)?.label}</T>
            <Ionicons name="close" size={15} color={accentText} />
          </Pressable>
        ) : null}
        {STATUS_FILTERS.map((f) => (
          <Pressable key={f.key} style={[styles.chip, statusFilter === f.key && styles.chipActive]} onPress={() => setStatusFilter(f.key)} accessibilityRole="button" accessibilityState={{ selected: statusFilter === f.key }}>
            <T style={[styles.chipText, statusFilter === f.key && styles.chipTextActive]}>{f.label}</T>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={dateSheet} transparent animationType="fade" onRequestClose={() => setDateSheet(false)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setDateSheet(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]} onPress={() => undefined}>
            <View style={styles.sheetHandle} />
            <T style={styles.sheetTitle}>Filter tanggal</T>
            {DATE_FILTERS.map((f) => {
              const active = dateFilter === f.key;

              return (
                <Pressable
                  key={f.key}
                  style={[styles.sheetRow, active && styles.sheetRowActive]}
                  onPress={() => { setDateFilter(f.key); setDateSheet(false); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.sheetIcon, active && styles.sheetIconActive]}>
                    <Ionicons name={DATE_FILTER_ICON[f.key]} size={20} color={active ? '#ffffff' : accentText} />
                  </View>
                  <T style={styles.sheetLabel}>{f.label}</T>
                  {active ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      <FlatList
        onScroll={hideNavOnScroll}
        scrollEventThrottle={16}
        data={bookings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: spacing.md }} /> : null}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name={error ? 'cloud-offline-outline' : 'calendar-outline'} size={38} color={error ? colors.danger : colors.textMuted} />
              </View>
              <T style={styles.emptyText}>
                {error ?? (statusFilter === 'progress' ? 'Tidak ada booking aktif.' : statusFilter === 'all' ? 'Belum ada booking.' : 'Tidak ada booking dengan filter ini.')}
              </T>
              {error && (
                <Pressable style={styles.retryBtn} onPress={() => fetchBookings()} accessibilityRole="button">
                  <T style={styles.retryText}>Coba Lagi</T>
                </Pressable>
              )}
            </View>
          ) : (
            <SkeletonCards count={3} />
          )
        }
        renderItem={({ item, index }) => {
          const statusMeta = STATUS_META[item.status];
          const tone = colors[statusMeta.color];
          const customer = item.customer?.name || item.customer_name || 'Customer';
          const vehicle = [item.vehicle_brand, item.vehicle_model].filter(Boolean).join(' ');
          const rel = relativeDay(item.preferred_date);
          const hasAlert = (item.unread_count ?? 0) > 0 || item.pending_reschedule_request || item.pending_cancellation_request || isOverSla(item);

          return (
            <FadeInUp index={index} enabled={index < 10}>
            <PressableScale style={styles.card} onPress={() => router.push(`/staff/bookings/${item.id}` as never)} accessibilityRole="button">
              {/* Identitas pekerjaan = plat nomor (yang dicari installer di lapangan); tanpa plat, nama pelanggan. */}
              <View style={styles.cardTop}>
                <View style={styles.cardTitleWrap}>
                  <T style={styles.cardTitle} numberOfLines={1}>{item.vehicle_plate || customer}</T>
                  <T style={styles.cardSub} numberOfLines={1}>
                    {item.vehicle_plate ? [customer, vehicle].filter(Boolean).join(' · ') : vehicle || item.booking_number}
                  </T>
                </View>
                <View style={[styles.statusPill, { backgroundColor: colors[statusMeta.bg] }]}>
                  <View style={[styles.statusDot, { backgroundColor: tone }]} />
                  <T style={[styles.statusPillText, { color: tone }]}>{statusMeta.label}</T>
                </View>
              </View>

              <View style={styles.infoPanel}>
                <View style={styles.metaRow}>
                  <Ionicons name="construct-outline" size={16} color={colors.textMuted} />
                  <T style={styles.metaText} numberOfLines={1}>{item.service_type}</T>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                  <T style={styles.metaText} numberOfLines={2}>
                    {rel ? <T style={[styles.metaText, styles.metaStrong]}>{rel} · </T> : null}
                    {formatDateRange(item.preferred_date, item.end_date, item.duration_days)}
                  </T>
                </View>
                {item.status === 'cancelled' && (item.cancel_reason || item.cancelled_by_type) ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                    <T style={styles.metaText} numberOfLines={2}>
                      Dibatalkan{item.cancelled_by_type === 'customer' ? ' customer' : item.cancelled_by_type === 'staff' ? ' staff' : ''}
                      {item.cancel_reason ? `: ${item.cancel_reason}` : ''}
                    </T>
                  </View>
                ) : null}
              </View>

              {hasAlert ? (
                <View style={styles.pillRow}>
                  {isOverSla(item) && (
                    <View style={[styles.infoPill, { backgroundColor: colors.dangerBg }]}>
                      <Ionicons name="alarm-outline" size={13} color={colors.danger} />
                      <T style={[styles.infoPillText, { color: colors.danger }]}>Lewat SLA</T>
                    </View>
                  )}
                  {(item.unread_count ?? 0) > 0 && (
                    <View style={[styles.infoPill, { backgroundColor: colors.accentSoft }]}>
                      <Ionicons name="chatbubble-outline" size={13} color={accentText} />
                      <T style={[styles.infoPillText, { color: accentText }]}>{item.unread_count} pesan baru</T>
                    </View>
                  )}
                  {item.pending_reschedule_request && (
                    <View style={[styles.infoPill, { backgroundColor: colors.warningBg }]}>
                      <Ionicons name="swap-horizontal" size={13} color={colors.warning} />
                      <T style={[styles.infoPillText, { color: colors.warning }]}>Jadwal ulang diajukan</T>
                    </View>
                  )}
                  {item.pending_cancellation_request && (
                    <View style={[styles.infoPill, { backgroundColor: colors.dangerBg }]}>
                      <Ionicons name="close-circle-outline" size={13} color={colors.danger} />
                      <T style={[styles.infoPillText, { color: colors.danger }]}>Pembatalan diajukan</T>
                    </View>
                  )}
                </View>
              ) : null}

              <View style={styles.cardFooter}>
                <T style={styles.footerText} numberOfLines={1}>
                  {item.booking_number}
                  {item.current_stage && item.status !== 'cancelled' ? `  ·  ${STAGE_LABEL[item.current_stage] ?? item.current_stage}` : ''}
                </T>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
            </PressableScale>
            </FadeInUp>
          );
        }}
      />
      <StaffBottomNav active="work" />
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan Beranda, Absensi, Izin & Cuti, dan formulir SPK: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    noGrow: { flexGrow: 0, flexShrink: 0 },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    headerText: { flex: 1, gap: 2 },
    headerTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.9, color: colors.textPrimary },

    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20 },
    filterButton: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    filterButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    searchRow: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 50,
      borderRadius: radius.pill, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow,
    },
    searchInput: { flex: 1, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: fontSize.sm + 1 },

    chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
    chip: { minHeight: 38, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: card, borderWidth: 1, borderColor: line, alignItems: 'center', justifyContent: 'center' },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    chipTextActive: { color: '#ffffff' },

    dateChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    dateChipText: { fontSize: 13, fontWeight: '800', color: accentText },

    sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { gap: 6, paddingHorizontal: 20, paddingTop: 12, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: isDark ? colors.bg : '#ffffff' },
    sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12, backgroundColor: colors.borderStrong },
    sheetTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, marginBottom: 6, color: colors.textPrimary },
    sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20 },
    sheetRowActive: { backgroundColor: colors.accentSoft },
    sheetIcon: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    sheetIconActive: { backgroundColor: colors.accent },
    sheetLabel: { flex: 1, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: NAV_CLEARANCE, gap: 12 },

    // Kartu booking
    card: { gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    cardTitleWrap: { flex: 1, gap: 2 },
    cardTitle: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    cardSub: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusPillText: { fontSize: 12, fontWeight: '800' },
    infoPanel: { gap: 8, padding: 14, borderRadius: 18, backgroundColor: chip },
    metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    metaText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 19, color: colors.textSecondary },
    metaStrong: { flex: 0, fontWeight: '800', color: colors.textPrimary },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    infoPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
    infoPillText: { fontSize: 12, fontWeight: '800' },
    cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    footerText: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },

    emptyState: { alignItems: 'center', paddingTop: 56, gap: 10, paddingHorizontal: spacing.xl },
    emptyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyText: { fontSize: fontSize.sm + 1, fontWeight: '500', lineHeight: 22, color: colors.textMuted, textAlign: 'center' },
    retryBtn: { marginTop: spacing.xs, paddingHorizontal: spacing.lg, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.pill },
    retryText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },
  });
}
