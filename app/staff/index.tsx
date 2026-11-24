import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Image, Pressable, ScrollView, StyleSheet, RefreshControl, TextProps, useWindowDimensions, Modal } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { parseDate, toLocalDateString } from '@/lib/dates';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth, isAttendanceRequired } from '@/lib/staff-auth-context';
import { staffApiFetch } from '@/lib/staff-api';
import { StaffBottomNav, NAV_CLEARANCE } from '@/components/staff/StaffBottomNav';
import { useHideNavOnScroll } from '@/lib/staff-nav-visibility';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  direksi: 'Direksi',
  store_manager: 'Store Manager',
  installer: 'Installer',
};

function formatRoleLabel(role?: string): string | null {
  if (!role) return null;
  return ROLE_LABEL[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Akun dengan beberapa role menampilkan semuanya (role utama dulu); sesi lama tanpa daftar role memakai role utama saja.
function formatRoleLabels(role?: string, roles?: string[]): string | null {
  const all = roles && roles.length > 0 ? [role, ...roles.filter((r) => r !== role)] : [role];
  const labels = all.map((r) => formatRoleLabel(r ?? undefined)).filter(Boolean);
  return labels.length > 0 ? labels.join(' · ') : null;
}

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

// Urutan tahap per jenis pekerjaan, untuk batang kemajuan di kartu pekerjaan (4 tahap, "Serah Terima" berarti semuanya selesai).
const STAGE_SEQUENCES: string[][] = [
  ['kf_cleaning', 'kf_heating', 'kf_installation', 'qc'],
  ['ppf_washing', 'ppf_detailing', 'ppf_installation', 'qc'],
];

const ENTRY_TYPE_LABEL: Record<string, string> = {
  manual: 'Manual',
  field_duty: 'Dinas Luar',
  alpha: 'Alpha',
  leave: 'Izin/Cuti',
};

interface HomeBooking {
  id: number;
  booking_number: string;
  service_type: string;
  preferred_date: string;
  duration_days: number | null;
  end_date: string | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  current_stage: string | null;
  customer_name: string | null;
  customer: { name: string } | null;
  vehicle_plate?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
}

// Ringkasan stok (hanya jumlah); tiap kategori null bila akun tidak boleh membuka menunya.
interface StockOverview {
  materials: { low: number; expired: number; near_expiry: number } | null;
  consumables: { low: number } | null;
  to_receive?: number | null;
}

interface FieldDutyToday {
  id: number;
  date: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  needs_location_photo: boolean;
  needs_end_photo?: boolean;
}

interface TodayAttendance {
  attendance: {
    entry_type: 'clock' | 'manual' | 'field_duty' | 'alpha' | 'leave';
    clock_in_at: string | null;
    clock_out_at: string | null;
    late_minutes: number;
  } | null;
  store: { name: string } | null;
}

function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function dayLabel(dateString: string): string {
  const d = parseDate(dateString.slice(0, 10));
  const today = new Date();
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000
  );
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Besok';
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' });
}

// Posisi tahap pekerjaan: [jumlah tahap yang sudah dikerjakan, total tahap], atau null bila belum ada tahap.
function stageProgress(stage: string | null): { done: number; total: number } | null {
  if (!stage) return null;
  if (stage === 'completed') return { done: 4, total: 4 };

  for (const sequence of STAGE_SEQUENCES) {
    const index = sequence.indexOf(stage);
    if (index >= 0) return { done: index + 1, total: sequence.length };
  }

  return null;
}

// Hari keberapa dari lama pekerjaan; hanya untuk pekerjaan lebih dari satu hari.
function dayOfJob(job: HomeBooking): string | null {
  if (!job.duration_days || job.duration_days < 2) return null;

  const start = parseDate(job.preferred_date.slice(0, 10));
  const today = new Date();
  const diff = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / 86400000
  ) + 1;

  return `Hari ke-${Math.min(Math.max(diff, 1), job.duration_days)} dari ${job.duration_days}`;
}

const SCREEN_PADDING = 20;
const SHORTCUT_GAP = 12;
const SHORTCUT_COLUMNS = 4;

// Nama pendek untuk label pintasan (hanya tampilan; pembaca layar tetap membaca nama lengkapnya).
const SHORT_TITLE: Record<string, string> = {
  'Surat Perintah Kerja': 'SPK',
  'Permohonan Pembelian': 'Pembelian',
};

// Teks layar ini dibatasi pembesarannya (1,25x) supaya kartu tidak pecah pada ukuran font sistem besar.
function T(props: TextProps) {
  return <AppText maxFontSizeMultiplier={1.25} {...props} />;
}

// Beranda untuk semua akun staff (dirancang ulang 2026-11-13: bersih, banyak ruang kosong, merah hanya untuk aksi utama). Bagian atas
// menjawab "apa yang harus saya kerjakan sekarang" (absen, pekerjaan hari ini, hal yang menunggu); menu lain ada di pintasan di bawahnya.
// Menu yang sudah ada di navigasi bawah tidak diulang di pintasan.
export default function StaffHomeScreen() {
  const hideNavOnScroll = useHideNavOnScroll();
  const { theme, colors } = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  // Lebar tiap pintasan dihitung dari lebar layar (4 kolom penuh, bukan persen): persen ditambah jarak antarkolom melebihi 100% sehingga
  // kolom keempat turun ke baris baru dan menyisakan ruang kosong di kanan.
  // Pintasan Stok Opname: satu tombol, pilihan jenis (Bahan Baku / PPF-WF) muncul setelah diketuk.
  const [opnameOpen, setOpnameOpen] = useState(false);
  const shortcutWidth = Math.floor((screenWidth - SCREEN_PADDING * 2 - SHORTCUT_GAP * (SHORTCUT_COLUMNS - 1)) / SHORTCUT_COLUMNS);
  const styles = useMemo(() => createStyles(colors, theme === 'dark'), [colors, theme]);
  const { staff } = useStaffAuth();

  const [unreadInbox, setUnreadInbox] = useState(0);
  const [attendance, setAttendance] = useState<TodayAttendance | null>(null);
  // Dinas luar milik sendiri; dipakai kartu "Dinas luar hari ini" (Absen Masuk/Keluar Lokasi).
  const [fieldDuties, setFieldDuties] = useState<FieldDutyToday[]>([]);
  const [jobs, setJobs] = useState<HomeBooking[] | null>(null);
  const [stock, setStock] = useState<StockOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Jam di kartu absensi; diperbarui tiap 20 detik cukup untuk tampilan menit.
  const [now, setNow] = useState(() => new Date());

  const hasBooking = !!staff?.has_booking_access;

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(id);
  }, []);

  // Tiap bagian dimuat sendiri-sendiri dan gagal diam-diam: satu endpoint yang bermasalah tidak mengosongkan seluruh Beranda.
  const load = useCallback(async () => {
    await Promise.allSettled([
      staffApiFetch<{ data: { unread_count: number } }>('/api/staff/inbox/unread-count').then((res) => setUnreadInbox(res.data.unread_count)),
      staffApiFetch<TodayAttendance>('/api/staff/attendance/today').then((res) => setAttendance(res)),
      staffApiFetch<{ field_duty_requests: FieldDutyToday[] }>('/api/staff/field-duty-requests').then((res) => setFieldDuties(res.field_duty_requests ?? [])),
      staffApiFetch<{ data: StockOverview }>('/api/staff/stock-overview').then((res) => setStock(res.data)),
      hasBooking
        ? staffApiFetch<{ data: HomeBooking[] }>('/api/staff/bookings?status=progress&date=week').then((res) => setJobs(res.data))
        : Promise.resolve(),
    ]);
  }, [hasBooking]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Cuma tampilkan menu yang akun ini benar-benar punya aksesnya —
  // supaya tidak ada kotak yang bisa di-tap tapi ujungnya ditolak (403)
  // oleh backend. Lihat AuthController::transform() untuk asal flag ini.
  const menuItems = [
    { key: 'bookings', icon: 'calendar-outline' as const, title: 'Booking Toko', onPress: () => router.push('/staff/bookings' as never), visible: staff?.has_booking_access },
    {
      key: 'spks',
      icon: 'clipboard-outline' as const,
      title: 'Surat Perintah Kerja',
      onPress: () => router.push('/staff/spks' as never),
      // SPK dokumen turunan booking, dipakai staff yang sama yang pegang akses Booking Toko (diminta user 2026-09-16, isi form inspeksi
      // kendaraan langsung dari HP di lapangan). Sejak 2026-10-06 mengikuti akses menu SPK sendiri (has_spk_access); sesi lama tanpa
      // flag memakai akses Booking seperti sebelumnya.
      visible: staff?.has_spk_access ?? staff?.has_booking_access,
    },
    { key: 'attendance', icon: 'finger-print-outline' as const, title: 'Absensi & Izin', visible: true, onPress: () => router.push('/staff/attendance' as never) },
    { key: 'payroll', icon: 'cash-outline' as const, title: 'Slip Gaji', visible: true, onPress: () => router.push('/staff/payroll' as never) },
    { key: 'profile', icon: 'person-circle-outline' as const, title: 'Profil Saya', visible: true, onPress: () => router.push('/staff/profile' as never) },
    {
      key: 'finance',
      icon: 'wallet-outline' as const,
      title: 'Keuangan',
      // Kas toko, catat pengeluaran, hitung kas, dan persetujuan; tampil bila akun punya menu Transaksi Keuangan/Hitung Kas atau berwenang menyetujui.
      visible: staff?.has_finance_access ?? false,
      onPress: () => router.push('/staff/finance' as never),
    },
    {
      key: 'schedule',
      icon: 'calendar-number-outline' as const,
      title: 'Jadwal Kerja',
      // Ginnva tidak memakai shift (keputusan 2026-10-17): layar hanya tampil bila fitur dinyalakan di server DAN karyawan punya
      // jadwal; sesi lama tanpa flag ikut tersembunyi.
      visible: staff?.has_work_schedule ?? false,
      onPress: () => router.push('/staff/schedule' as never),
    },
    { key: 'leads', icon: 'megaphone-outline' as const, title: 'Lead', onPress: () => router.push('/staff/leads' as never), visible: staff?.has_quotation_access || staff?.has_lead_inbox_access },
    { key: 'inventory', icon: 'cube-outline' as const, title: 'Produk PPF/WF', onPress: () => router.push('/staff/inventory/scan' as never), visible: staff?.has_ppf_wf_access },
    { key: 'assets', icon: 'construct-outline' as const, title: 'Aset Tetap', onPress: () => router.push('/staff/assets/scan' as never), visible: staff?.has_asset_access },
    { key: 'materials', icon: 'flask-outline' as const, title: 'Bahan Baku', onPress: () => router.push('/staff/materials' as never), visible: staff?.has_material_access },
    // Scan QR umum untuk gudang: satu pemindai untuk QR Produk PPF/WF dan label Bahan Baku.
    {
      key: 'opname',
      icon: 'clipboard-outline' as const,
      title: 'Stok Opname',
      onPress: () => setOpnameOpen(true),
      visible: staff?.has_material_access || (staff?.has_ppf_wf_access && (staff?.can_modify_ppf_wf ?? true)),
    },
    { key: 'scan', icon: 'qr-code-outline' as const, title: 'Scan QR', onPress: () => router.push('/staff/scan' as never), visible: staff?.has_ppf_wf_access || staff?.has_material_access },
    { key: 'consumables', icon: 'layers-outline' as const, title: 'Barang Habis Pakai', onPress: () => router.push('/staff/consumables' as never), visible: staff?.has_consumable_access },
    { key: 'memos', icon: 'reader-outline' as const, title: 'Memo Barang', onPress: () => router.push('/staff/memos' as never), visible: staff?.has_material_memo_access || staff?.can_request_memo || staff?.has_material_access || staff?.has_ppf_wf_access },
    { key: 'purchase-requests', icon: 'cart-outline' as const, title: 'Permohonan Pembelian', onPress: () => router.push('/staff/purchase-requests' as never), visible: staff?.has_purchase_request_access },
  ]
    // Kotak yang kini ada di navigasi bawah tidak diulang di pintasan. SPK tetap di sana bila tab kerja memakai Booking.
    .filter((item) => !['bookings', 'attendance', 'payroll', 'profile'].includes(item.key))
    .filter((item) => item.key !== 'spks' || staff?.has_booking_access)
    .filter((item) => item.visible);

  // ─── Absensi hari ini ───
  const record = attendance?.attendance ?? null;
  const attendanceRequired = isAttendanceRequired(staff);
  const showAttendance = !!attendance && attendanceRequired;
  // Entri manual yang baru berisi jam masuk (koreksi admin) masih harus absen keluar, jadi diperlakukan seperti "sedang bekerja".
  const openManual = !!record && record.entry_type === 'manual' && !!record.clock_in_at && !record.clock_out_at;
  const recordedByAdmin = !!record && record.entry_type !== 'clock' && !openManual;
  const clockState: 'none' | 'working' | 'done' | 'admin' = recordedByAdmin
    ? 'admin'
    : !record?.clock_in_at
      ? 'none'
      : !record.clock_out_at
        ? 'working'
        : 'done';
  // Dinas luar hari ini yang masih butuh absen lokasi: masuk dulu (foto awal), lalu keluar (foto akhir). Susulan tidak ikut (bukan hari ini).
  const fieldDutyTodo = fieldDuties
    .filter((d) => d.date.slice(0, 10) === toLocalDateString(new Date()) && (d.status === 'approved' || d.status === 'pending'))
    .map((d) => (d.needs_location_photo ? { id: d.id, kind: 'in' as const, pending: d.status === 'pending' } : d.needs_end_photo ? { id: d.id, kind: 'out' as const, pending: d.status === 'pending' } : null))
    .find((d) => d !== null) ?? null;
  // Sedang dinas luar: absensi tercatat admin, tetapi foto masuk/keluar lokasi belum lengkap. Jangan tampil seolah sudah lengkap.
  const onFieldDuty = clockState === 'admin' && !!fieldDutyTodo;
  const statusPill = {
    none: { label: 'Belum absen masuk', tone: 'muted' as const },
    working: { label: 'Sedang bekerja', tone: 'accent' as const },
    done: { label: 'Absensi lengkap', tone: 'success' as const },
    admin: onFieldDuty
      ? { label: 'Sedang Dinas Luar', tone: 'warning' as const }
      : { label: record ? `Tercatat: ${ENTRY_TYPE_LABEL[record.entry_type] ?? 'Manual'}` : 'Tercatat', tone: 'success' as const },
  }[clockState];

  const clockText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateText = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ─── Pekerjaan ───
  const todayKey = toLocalDateString(new Date());
  const sortedJobs = [...(jobs ?? [])].sort((a, b) => a.preferred_date.localeCompare(b.preferred_date));
  const activeJobs = sortedJobs.filter((j) => j.preferred_date.slice(0, 10) <= todayKey);
  const upcomingJobs = sortedJobs.filter((j) => j.preferred_date.slice(0, 10) > todayKey).slice(0, 3);

  // ─── Perlu perhatian (stok) ───
  const attention: { key: string; icon: IconName; tone: 'danger' | 'warning' | 'muted'; title: string; sub: string; route: string }[] = [];
  if (stock?.materials) {
    if (stock.materials.low > 0) attention.push({ key: 'm-low', icon: 'flask-outline', tone: 'warning', title: `${stock.materials.low} bahan menipis`, sub: 'Bahan Baku', route: '/staff/materials?filter=low' });
    const expiring = stock.materials.expired + stock.materials.near_expiry;
    if (expiring > 0) {
      attention.push({
        key: 'm-exp',
        icon: 'time-outline',
        tone: stock.materials.expired > 0 ? 'danger' : 'warning',
        title: stock.materials.expired > 0 ? `${expiring} kedaluwarsa atau hampir` : `${expiring} hampir kedaluwarsa`,
        sub: stock.materials.expired > 0 ? `Bahan Baku · ${stock.materials.expired} sudah lewat` : 'Bahan Baku',
        route: '/staff/materials?filter=expiry',
      });
    }
  }
  if (stock?.consumables && stock.consumables.low > 0) {
    attention.push({ key: 'c-low', icon: 'layers-outline', tone: 'warning', title: `${stock.consumables.low} barang menipis`, sub: 'Barang Habis Pakai', route: '/staff/consumables?filter=low' });
  }
  if (stock?.to_receive && stock.to_receive > 0) {
    attention.push({ key: 'to-receive', icon: 'cart-outline', tone: 'muted', title: `${stock.to_receive} menunggu diterima`, sub: 'Permohonan Pembelian', route: '/staff/purchase-requests?status=approved' });
  }

  const firstName = (staff?.name ?? '').trim();
  const roleText = formatRoleLabels(staff?.role, staff?.roles);
  const storeName = attendance?.store?.name;
  const headerSub = [roleText, storeName].filter(Boolean).join(' · ');

  const isDark = theme === 'dark';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const chipBg = isDark ? colors.surfaceElevated : '#efeff4';

  const tone = (t: 'danger' | 'warning' | 'muted' | 'accent' | 'success') => ({
    fg: t === 'danger' ? colors.danger : t === 'warning' ? colors.warning : t === 'success' ? colors.success : t === 'accent' ? accentText : colors.textSecondary,
    bg: t === 'danger' ? colors.dangerBg : t === 'warning' ? colors.warningBg : t === 'success' ? colors.successBg : t === 'accent' ? colors.accentSoft : chipBg,
  });

  const renderJob = (job: HomeBooking, upcoming: boolean) => {
    const customer = job.customer?.name || job.customer_name || 'Pelanggan';
    const vehicle = [job.vehicle_brand, job.vehicle_model].filter(Boolean).join(' ');
    const progress = upcoming ? null : stageProgress(job.current_stage);
    const stageText = upcoming ? dayLabel(job.preferred_date) : job.current_stage ? (STAGE_LABEL[job.current_stage] ?? 'Dikerjakan') : 'Hari ini';
    const dayText = upcoming ? null : dayOfJob(job);

    return (
      <PressableScale key={job.id} style={styles.jobCard} onPress={() => router.push(`/staff/bookings/${job.id}` as never)} accessibilityRole="button">
        <View style={styles.jobTop}>
          <View style={styles.plate}>
            <T style={styles.plateText}>{job.vehicle_plate || job.booking_number}</T>
          </View>
          <View style={[styles.stageChip, upcoming && { backgroundColor: chipBg }]}>
            <T style={[styles.stageChipText, upcoming && { color: colors.textSecondary }]} numberOfLines={1}>{stageText}</T>
          </View>
        </View>
        <View style={styles.jobBody}>
          <T style={styles.jobTitle} numberOfLines={1}>{vehicle || customer}</T>
          <T style={styles.jobSub} numberOfLines={1}>{[job.service_type, vehicle ? customer : null].filter(Boolean).join(' · ')}</T>
        </View>
        {progress ? (
          <View style={styles.progressWrap}>
            <View style={styles.progressRow}>
              {Array.from({ length: progress.total }, (_, i) => (
                <View key={i} style={[styles.progressSeg, i < progress.done && styles.progressSegDone]} />
              ))}
            </View>
            <View style={styles.progressMeta}>
              <T style={styles.progressText}>Tahap {progress.done} dari {progress.total}</T>
              {dayText ? <T style={styles.progressText}>{dayText}</T> : null}
            </View>
          </View>
        ) : null}
      </PressableScale>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <ScrollView
        onScroll={hideNavOnScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        {/* Sapaan */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar} accessible accessibilityLabel="Ginnva">
              <Image source={require('@/assets/icon.png')} style={styles.avatarLogo} resizeMode="contain" />
            </View>
            <View style={styles.headerText}>
              <T style={styles.greeting}>{greeting()}</T>
              <T style={styles.name} numberOfLines={1}>{firstName || 'Selamat datang'}</T>
              {headerSub ? <T style={styles.headerSub} numberOfLines={1}>{headerSub}</T> : null}
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/staff/inbox' as never)}
            style={styles.bellButton}
            accessibilityLabel={unreadInbox > 0 ? `Notifikasi, ${unreadInbox} belum dibaca` : 'Notifikasi'}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.textSecondary} />
            {unreadInbox > 0 ? <View style={styles.bellDot} /> : null}
          </Pressable>
        </View>

        {/* Absensi hari ini */}
        {showAttendance ? (
          <FadeInUp index={0}>
            <View style={styles.attendanceCard}>
              <View style={styles.attendanceTop}>
                <T style={styles.cardTitle}>Absensi hari ini</T>
                <View style={[styles.statusPill, { backgroundColor: tone(statusPill.tone).bg }]}>
                  <View style={[styles.statusDot, { backgroundColor: tone(statusPill.tone).fg }]} />
                  <T style={[styles.statusPillText, { color: tone(statusPill.tone).fg }]} numberOfLines={1}>{statusPill.label}</T>
                </View>
              </View>

              <View style={styles.clockBlock}>
                <View style={styles.clockRow}>
                  <T style={styles.clockText}>{clockText}</T>
                  <T style={styles.clockZone}>WIB</T>
                </View>
                <T style={styles.clockDate}>{dateText}</T>
              </View>

              {clockState === 'none' || clockState === 'working' ? (
                <PressableScale style={styles.ctaButton} onPress={() => router.push('/staff/attendance' as never)} accessibilityRole="button">
                  <Ionicons name={clockState === 'none' ? 'log-in-outline' : 'log-out-outline'} size={22} color="#ffffff" />
                  <T style={styles.ctaText}>{clockState === 'none' ? 'Absen Masuk' : 'Absen Keluar'}</T>
                </PressableScale>
              ) : clockState === 'admin' ? (
                <>
                  {onFieldDuty ? null : (
                    <View style={styles.doneRow}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                      <T style={styles.doneText}>Absensi hari ini sudah dicatat</T>
                    </View>
                  )}
                  {fieldDutyTodo ? (
                    <PressableScale style={styles.ctaButton} onPress={() => router.push('/staff/attendance/field-duty' as never)} accessibilityRole="button">
                      <Ionicons name={fieldDutyTodo.kind === 'in' ? 'log-in-outline' : 'log-out-outline'} size={22} color="#ffffff" />
                      <T style={styles.ctaText}>{fieldDutyTodo.kind === 'in' ? 'Absen Masuk Lokasi' : 'Absen Keluar Lokasi'}</T>
                    </PressableScale>
                  ) : null}
                </>
              ) : (
                <T style={styles.doneText}>Absensi hari ini sudah lengkap. Terima kasih!</T>
              )}

              <View style={styles.attendanceFoot}>
                <View style={styles.timesRow}>
                  <View style={styles.timeCol}>
                    <T style={styles.timeLabel}>Masuk</T>
                    <T style={[styles.timeValue, !record?.clock_in_at && styles.timeEmpty]}>{formatTime(record?.clock_in_at ?? null)}</T>
                  </View>
                  <View style={styles.timeCol}>
                    <T style={styles.timeLabel}>Keluar</T>
                    <T style={[styles.timeValue, !record?.clock_out_at && styles.timeEmpty]}>{formatTime(record?.clock_out_at ?? null)}</T>
                  </View>
                </View>
                {record && record.late_minutes > 0 ? (
                  <View style={styles.lateChip}>
                    <Ionicons name="time-outline" size={14} color={colors.warning} />
                    <T style={styles.lateText}>Telat {record.late_minutes} menit</T>
                  </View>
                ) : null}
                {storeName ? (
                  <View style={styles.locationRow}>
                    <Ionicons name="location-outline" size={16} color={colors.success} />
                    <T style={styles.locationText} numberOfLines={1}>{storeName}</T>
                  </View>
                ) : null}
              </View>
            </View>
          </FadeInUp>
        ) : null}

        {/* Perlu perhatian */}
        {attention.length > 0 ? (
          <FadeInUp index={1} style={styles.section}>
            <T style={styles.sectionLabel}>Perlu perhatian</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} style={styles.chipsScroll}>
              {attention.map((row) => (
                <PressableScale key={row.key} style={styles.attentionChip} onPress={() => router.push(row.route as never)} accessibilityRole="button">
                  <View style={[styles.attentionIcon, { backgroundColor: tone(row.tone).bg }]}>
                    <Ionicons name={row.icon} size={19} color={tone(row.tone).fg} />
                  </View>
                  <View>
                    <T style={styles.attentionTitle}>{row.title}</T>
                    <T style={styles.attentionSub}>{row.sub}</T>
                  </View>
                </PressableScale>
              ))}
            </ScrollView>
          </FadeInUp>
        ) : null}

        {/* Pekerjaan hari ini */}
        {hasBooking ? (
          <FadeInUp index={2} style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={styles.sectionTitleRow}>
                <T style={styles.sectionTitle}>Pekerjaan hari ini</T>
                {activeJobs.length > 0 ? (
                  <View style={styles.countBadge}>
                    <T style={styles.countBadgeText}>{activeJobs.length}</T>
                  </View>
                ) : null}
              </View>
              <Pressable onPress={() => router.push('/staff/bookings' as never)} hitSlop={8} accessibilityRole="button">
                <T style={styles.sectionLink}>Lihat semua</T>
              </Pressable>
            </View>

            {jobs === null ? (
              <T style={styles.mutedText}>Memuat pekerjaan…</T>
            ) : activeJobs.length > 0 ? (
              <>
                {activeJobs.slice(0, 5).map((job) => renderJob(job, false))}
                {activeJobs.length > 5 ? <T style={styles.mutedText}>+{activeJobs.length - 5} pekerjaan lain di daftar Booking.</T> : null}
              </>
            ) : (
              <View style={styles.emptyBox}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="checkmark-circle-outline" size={22} color={colors.success} />
                </View>
                <T style={styles.emptyText}>Tidak ada pekerjaan yang sedang berjalan hari ini.</T>
              </View>
            )}

            {upcomingJobs.length > 0 ? (
              <>
                <T style={[styles.sectionLabel, { marginTop: spacing.xs }]}>Berikutnya</T>
                {upcomingJobs.map((job) => renderJob(job, true))}
              </>
            ) : null}
          </FadeInUp>
        ) : null}

        {/* Pintasan */}
        {menuItems.length > 0 ? (
          <FadeInUp index={3} style={styles.section}>
            <T style={styles.sectionTitle}>Pintasan</T>
            <View style={styles.grid}>
              {menuItems.map((item) => (
                <PressableScale key={item.key} style={[styles.shortcut, { width: shortcutWidth }]} onPress={item.onPress} accessibilityRole="button" accessibilityLabel={item.title}>
                  <View style={styles.shortcutIcon}>
                    <Ionicons name={item.icon} size={25} color={colors.textSecondary} />
                  </View>
                  <T style={styles.shortcutLabel} numberOfLines={2}>{SHORT_TITLE[item.title] ?? item.title}</T>
                </PressableScale>
              ))}
            </View>
          </FadeInUp>
        ) : null}
      </ScrollView>
      <Modal visible={opnameOpen} transparent animationType="fade" onRequestClose={() => setOpnameOpen(false)} statusBarTranslucent>
        <Pressable style={styles.sheetBackdrop} onPress={() => setOpnameOpen(false)} accessibilityLabel="Tutup">
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <T style={styles.sheetTitle}>Stok Opname</T>
            <T style={styles.sheetSub}>Pilih yang mau dihitung</T>
            {staff?.has_material_access ? (
              <PressableScale
                style={styles.sheetOption}
                onPress={() => { setOpnameOpen(false); router.push({ pathname: '/staff/stock/count', params: { type: 'materials' } } as never); }}
                accessibilityRole="button"
              >
                <View style={styles.shortcutIcon}><Ionicons name="flask-outline" size={25} color={colors.textSecondary} /></View>
                <View style={{ flex: 1 }}>
                  <T style={styles.sheetOptionTitle}>Bahan Baku</T>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </PressableScale>
            ) : null}
            {staff?.has_ppf_wf_access && (staff?.can_modify_ppf_wf ?? true) ? (
              <PressableScale
                style={styles.sheetOption}
                onPress={() => { setOpnameOpen(false); router.push({ pathname: '/staff/stock/count', params: { type: 'rolls' } } as never); }}
                accessibilityRole="button"
              >
                <View style={styles.shortcutIcon}><Ionicons name="cube-outline" size={25} color={colors.textSecondary} /></View>
                <View style={{ flex: 1 }}>
                  <T style={styles.sheetOptionTitle}>PPF/WF</T>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </PressableScale>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
      <StaffBottomNav active="home" />
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Latar abu-putih dengan kartu putih di mode terang (kartu menonjol tanpa garis tebal); mode gelap memakai tingkat abu bawaan aplikasi.
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
    scrollContent: { paddingHorizontal: SCREEN_PADDING, paddingTop: spacing.md, paddingBottom: NAV_CLEARANCE, gap: 28 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, minWidth: 0 },
    // Lambang Ginnva (assets/icon.png) di dalam lingkaran putih; berkasnya punya ruang kosong di sekelilingnya, jadi gambar dibuat sedikit
    // lebih kecil dari lingkarannya supaya lambang tidak menempel ke tepi.
    avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#ffffff', borderWidth: 1, borderColor: line },
    avatarLogo: { width: 42, height: 42 },
    headerText: { flex: 1, gap: 1, minWidth: 0 },
    greeting: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
    name: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    headerSub: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    bellButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    bellDot: { position: 'absolute', top: 9, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent, borderWidth: 2, borderColor: card },

    attendanceCard: { gap: 18, padding: 20, borderRadius: 28, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    attendanceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    cardTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    statusPill: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusPillText: { flexShrink: 1, fontSize: 12, fontWeight: '700' },
    clockBlock: { gap: 4 },
    clockRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    clockText: { fontSize: 60, fontWeight: '800', letterSpacing: -2.5, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    clockZone: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    clockDate: { fontSize: 14, fontWeight: '500', color: colors.textMuted, textTransform: 'capitalize' },
    ctaButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 4,
    },
    ctaText: { fontSize: fontSize.base, fontWeight: '700', color: '#ffffff' },
    doneText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary, lineHeight: 20 },
    doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    attendanceFoot: { gap: 14, paddingTop: 16, borderTopWidth: 1, borderTopColor: line },
    timesRow: { flexDirection: 'row', gap: spacing.sm },
    timeCol: { flex: 1, gap: 2 },
    timeLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted },
    timeValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    timeEmpty: { color: isDark ? '#4b4b57' : '#c3c3cd' },
    lateChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.warningBg },
    lateText: { fontSize: 12, fontWeight: '700', color: colors.warning },
    locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    locationText: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textSecondary },

    section: { gap: 14 },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    sectionTitle: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    sectionLink: { fontSize: 13, fontWeight: '700', color: accentText },
    countBadge: { minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    countBadgeText: { fontSize: 12, fontWeight: '800', color: accentText },
    mutedText: { fontSize: fontSize.xs, color: colors.textMuted },

    chipsScroll: { marginHorizontal: -SCREEN_PADDING },
    chipsRow: { gap: 10, paddingHorizontal: SCREEN_PADDING, paddingVertical: 2 },
    attentionChip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 10, paddingRight: 16, borderRadius: 18, backgroundColor: card, borderWidth: 1, borderColor: line },
    attentionIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    attentionTitle: { fontSize: 13.5, fontWeight: '700', color: colors.textPrimary },
    attentionSub: { fontSize: 11.5, fontWeight: '500', color: colors.textMuted },

    jobCard: { gap: 12, padding: 16, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line },
    jobTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    plate: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textSecondary },
    plateText: { fontSize: 13, fontWeight: '800', letterSpacing: 1, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    stageChip: { flexShrink: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    stageChipText: { fontSize: 12, fontWeight: '700', color: accentText },
    jobBody: { gap: 2 },
    jobTitle: { fontSize: fontSize.base + 1, fontWeight: '700', color: colors.textPrimary },
    jobSub: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
    progressWrap: { gap: 8 },
    progressRow: { flexDirection: 'row', gap: 4 },
    progressSeg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: line },
    progressSegDone: { backgroundColor: colors.accent },
    progressMeta: { flexDirection: 'row', justifyContent: 'space-between' },
    progressText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    emptyBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line },
    emptyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successBg },
    emptyText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },

    // Pintasan: 4 kolom, ikon polos satu warna di atas kotak lembut; label pendek maksimal dua baris.
    grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 20, columnGap: SHORTCUT_GAP },
    shortcut: { alignItems: 'center', gap: 8 },
    shortcutIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { gap: 12, padding: 20, paddingBottom: 32, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: card },
    sheetTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    sheetSub: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginBottom: 4 },
    sheetOption: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 24, backgroundColor: chip },
    sheetOptionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    sheetOptionSub: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    shortcutLabel: { fontSize: 12, fontWeight: '600', lineHeight: 15, textAlign: 'center', color: colors.textSecondary },
  });
}
