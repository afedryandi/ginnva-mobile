import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useStaffAuth } from '@/lib/staff-auth-context';
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
  customer_name: string | null;
  customer: { id: number; name: string; phone_number: string } | null;
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

// Sebelumnya label ini ditebak dari ADA-TIDAKNYA store_id ("kalau punya
// store_id pasti Admin Toko") — salah untuk role lain yang juga terikat
// satu toko, terutama Installer (dan role kustom apa pun yang dibuat
// admin lewat Filament RoleResource, lihat komentar di sana: role baru
// otomatis bisa login tanpa perlu update kode di sini). Sekarang pakai
// nama role asli sebagai fallback, bukan tebakan dari store_id.
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

type StatusFilter = 'all' | 'progress' | 'completed';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'progress', label: 'Progress' },
  { key: 'completed', label: 'Selesai' },
];

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
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
  const { staff, logout } = useStaffAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fetchBookings = useCallback((filter: StatusFilter) => {
    const query = filter === 'all' ? '' : `?status=${filter}`;
    setError(null);
    return staffApiFetch<{ data: StaffBooking[] }>(`/api/staff/bookings${query}`)
      .then((res) => setBookings(res.data))
      .catch(() => setError('Gagal memuat daftar booking. Periksa koneksi internet Anda.'));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchBookings(statusFilter).finally(() => setLoading(false));
  }, [fetchBookings, statusFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBookings(statusFilter);
    setRefreshing(false);
  }, [fetchBookings, statusFilter]);

  const handleLogout = () => {
    Alert.alert('Keluar', 'Anda yakin ingin keluar dari akun staff?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Keluar', style: 'destructive', onPress: () => logout().then(() => router.replace('/auth/login' as never)) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <View style={styles.leftButtons}>
          {/* Absensi SENGAJA selalu tampil (tidak dibatasi hasMenuAccess
              seperti Inventaris) — absen kewajiban dasar semua staff, lihat
              catatan di AttendanceController. */}
          <Pressable onPress={() => router.push('/staff/attendance' as never)} style={styles.sideButton}>
            <Ionicons name="finger-print-outline" size={22} color={colors.textPrimary} />
          </Pressable>
          {/* Slip Gaji juga selalu tampil — lihat gaji sendiri, sama
              filosofi dengan Absensi (lihat PayrollController). */}
          <Pressable onPress={() => router.push('/staff/payroll' as never)} style={styles.sideButton}>
            <Ionicons name="cash-outline" size={22} color={colors.textPrimary} />
          </Pressable>
          {staff?.has_quotation_access ? (
            <Pressable onPress={() => router.push('/staff/quotations' as never)} style={styles.sideButton}>
              <Ionicons name="document-text-outline" size={22} color={colors.textPrimary} />
            </Pressable>
          ) : null}
          {staff?.has_inventory_access ? (
            <Pressable onPress={() => router.push('/staff/inventory' as never)} style={styles.sideButton}>
              <Ionicons name="cube-outline" size={22} color={colors.textPrimary} />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>Booking Toko</Text>
        <Pressable onPress={handleLogout} style={styles.sideButton}>
          <Ionicons name="log-out-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <View style={styles.subheader}>
        <Text style={styles.subheaderText}>
          {[staff?.name, formatRoleLabel(staff?.role)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={[styles.filterChip, statusFilter === f.key && styles.filterChipActive]}
            onPress={() => setStatusFilter(f.key)}
          >
            <Text style={[styles.filterChipText, statusFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={bookings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Ionicons
                name={error ? 'cloud-offline-outline' : 'calendar-outline'}
                size={40}
                color={error ? colors.danger : colors.textMuted}
              />
              <Text style={styles.emptyText}>
                {error ?? (statusFilter === 'all' ? 'Belum ada booking.' : 'Tidak ada booking dengan filter ini.')}
              </Text>
              {error && (
                <Pressable style={styles.retryBtn} onPress={() => fetchBookings(statusFilter)}>
                  <Text style={styles.retryText}>Coba Lagi</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const statusMeta = STATUS_META[item.status];
          return (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/staff/bookings/${item.id}` as never)}
          >
            {/* Badge status tetap sejajar nomor booking (kanan atas).
                Badge tahap DIPISAH ke baris sendiri di bawahnya — SEBELUMNYA
                digabung 1 grup, jadi begitu keduanya tidak muat 1 baris,
                badge status ikut turun juga (harusnya cuma badge tahap
                yang turun). Diminta user 2026-08-28. */}
            <View style={styles.cardHeader}>
              <Text style={styles.bookingNumber} numberOfLines={1}>{item.booking_number}</Text>
              <View style={[styles.statusBadge, { backgroundColor: colors[statusMeta.bg] }]}>
                <Text style={[styles.statusBadgeText, { color: colors[statusMeta.color] }]}>
                  {statusMeta.label}
                </Text>
              </View>
            </View>
            {item.current_stage && item.status !== 'cancelled' && (
              <View style={styles.stageBadge}>
                <Text style={styles.stageBadgeText}>{STAGE_LABEL[item.current_stage] ?? item.current_stage}</Text>
              </View>
            )}
            <Text style={styles.customerName}>
              {item.customer?.name || item.customer_name || 'Customer'}
            </Text>
            <View style={styles.detailRow}>
              <Ionicons name="construct-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.detailText}>{item.service_type}</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.detailText}>
                {formatDateRange(item.preferred_date, item.end_date, item.duration_days)}
              </Text>
            </View>
          </Pressable>
          );
        }}
      />
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
  leftButtons: { flexDirection: 'row', alignItems: 'center' },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  subheader: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  subheaderText: { fontSize: fontSize.xs, color: colors.textSecondary },
  filterRow: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterChipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
  filterChipTextActive: { color: '#ffffff' },
  listContent: { padding: spacing.md, gap: spacing.sm },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    gap: 6, borderWidth: 1, borderColor: colors.border,
  },
  // Badge tahap dipisah jadi baris sendiri (lihat renderItem) — badge
  // status tetap sejajar booking_number, dikasih flexShrink0 implisit
  // (View tanpa flex, ukuran natural) supaya tidak ikut kegencet.
  // bookingNumber dikasih flexShrink+numberOfLines supaya truncate dulu
  // kalau kepanjangan. Ditemukan & diperbaiki 2026-08-28.
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  bookingNumber: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusBadgeText: { fontSize: fontSize.xs, fontWeight: '700' },
  // alignSelf: 'flex-start' WAJIB — tanpa ini, sebagai child langsung
  // `card` (flex column, default alignItems 'stretch'), badge ini
  // melebar penuh selebar kartu alih-alih cuma selebar teksnya sendiri.
  stageBadge: { alignSelf: 'flex-start', backgroundColor: colors.accentSoft, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  stageBadgeText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.accent },
  customerName: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailText: { fontSize: fontSize.xs, color: colors.textSecondary },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },
  });
}
