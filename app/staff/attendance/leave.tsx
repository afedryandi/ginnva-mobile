import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import LeaveRequestForm, { LeaveTypeOption, leaveTypeIcon } from '@/components/staff/LeaveRequestForm';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface LeaveRequestRecord {
  id: number;
  request_number: string;
  type: 'izin' | 'sakit' | 'cuti';
  leave_type_id?: number | null;
  leave_type_name?: string | null;
  start_date: string;
  end_date: string;
  reason: string;
  document_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'revoked';
  review_note: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
}

// Izin Sebagian Hari (telat masuk, keluar kantor, pulang cepat) tampil di daftar yang sama dengan izin/cuti sehari penuh.
interface PartialLeaveRecord {
  id: number;
  date: string;
  category: 'late_arrival' | 'leave_office' | 'early_leave';
  category_label: string;
  window_label: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  review_notes: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  can_cancel: boolean;
}

type HistoryEntry =
  | { kind: 'full'; sortKey: string; record: LeaveRequestRecord }
  | { kind: 'partial'; sortKey: string; record: PartialLeaveRecord };

const PARTIAL_ICON: Record<PartialLeaveRecord['category'], keyof typeof Ionicons.glyphMap> = {
  late_arrival: 'log-in-outline',
  leave_office: 'walk-outline',
  early_leave: 'log-out-outline',
};

const TYPE_LABEL: Record<LeaveRequestRecord['type'], string> = {
  izin: 'Izin',
  sakit: 'Sakit',
  cuti: 'Cuti',
};

function typeName(record: LeaveRequestRecord): string {
  return record.leave_type_name || TYPE_LABEL[record.type];
}

const STATUS_META: Record<LeaveRequestRecord['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu', color: 'warning', bg: 'warningBg' },
  approved: { label: 'Disetujui', color: 'success', bg: 'successBg' },
  rejected: { label: 'Ditolak', color: 'danger', bg: 'dangerBg' },
  cancelled: { label: 'Dibatalkan Sendiri', color: 'textMuted', bg: 'surfaceElevated' },
  revoked: { label: 'Dicabut Admin', color: 'danger', bg: 'dangerBg' },
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "12 – 14 Nov 2026" bila satu bulan, "30 Okt – 2 Nov 2026" bila lintas bulan, dan satu tanggal saja bila sehari.
function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);

  if (start === end || s.toDateString() === e.toDateString()) {
    return formatDate(end);
  }

  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const startPart = sameMonth ? String(s.getDate()) : s.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

  return `${startPart} – ${e.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function dayCountOf(record: LeaveRequestRecord): number {
  return Math.round((new Date(record.end_date).getTime() - new Date(record.start_date).getTime()) / 86_400_000) + 1;
}

export default function StaffLeaveRequestScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  const [requests, setRequests] = useState<LeaveRequestRecord[]>([]);
  const [cutiQuota, setCutiQuota] = useState(0);
  const [cutiUsed, setCutiUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [partials, setPartials] = useState<PartialLeaveRecord[]>([]);
  const [formVisible, setFormVisible] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);

  interface LeaveRequestsResponse {
    leave_requests: LeaveRequestRecord[];
    cuti_quota: number;
    cuti_used: number;
    current_page: number;
    has_more: boolean;
  }

  const loadRequests = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<LeaveRequestsResponse>('/api/staff/leave-requests');
      setRequests(res.leave_requests);
      setCutiQuota(res.cuti_quota);
      setCutiUsed(res.cuti_used);
      setPage(res.current_page ?? 1);
      setHasMore(res.has_more ?? false);

      try {
        const partial = await staffApiFetch<{ partial_leave_requests: PartialLeaveRecord[] }>('/api/staff/partial-leave-requests');
        setPartials(partial.partial_leave_requests);
      } catch {
        // Riwayat izin sebagian hari gagal dimuat: izin/cuti sehari penuh tetap tampil.
      }
    } catch {
      setError('Gagal memuat riwayat izin. Periksa koneksi internet.');
    }
  }, []);

  const loadMoreRequests = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await staffApiFetch<LeaveRequestsResponse>(`/api/staff/leave-requests?page=${page + 1}`);
      setRequests((prev) => [...prev, ...res.leave_requests]);
      setPage(res.current_page ?? page + 1);
      setHasMore(res.has_more ?? false);
    } catch {
      // Riwayat yang sudah tampil tetap valid.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page]);

  const handleCancelPartial = useCallback((request: PartialLeaveRecord) => {
    Alert.alert('Batalkan Pengajuan', `Batalkan pengajuan ${request.category_label} ${formatDate(request.date)}?`, [
      { text: 'Tidak', style: 'cancel' },
      {
        text: 'Ya, Batalkan', style: 'destructive', onPress: async () => {
          setCancellingId(-request.id);
          try {
            await staffApiFetch(`/api/staff/partial-leave-requests/${request.id}/cancel`, { method: 'POST' });
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

  const handleCancel = useCallback((request: LeaveRequestRecord) => {
    Alert.alert('Batalkan Pengajuan', `Batalkan pengajuan ${typeName(request)} ${formatDate(request.start_date)}–${formatDate(request.end_date)}?`, [
      { text: 'Tidak', style: 'cancel' },
      {
        text: 'Ya, Batalkan', style: 'destructive', onPress: async () => {
          setCancellingId(request.id);
          try {
            await staffApiFetch(`/api/staff/leave-requests/${request.id}/cancel`, { method: 'POST' });
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

  useEffect(() => {
    setLoading(true);
    loadRequests().finally(() => setLoading(false));
  }, [loadRequests]);

  useEffect(() => {
    staffApiFetch<{ leave_types: LeaveTypeOption[] }>('/api/staff/leave-types')
      .then((res) => setLeaveTypes(res.leave_types))
      .catch(() => {
        // Daftar jenis gagal dimuat: form tetap terbuka dengan kategori dasar.
      });
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }, [loadRequests]);

  // Satu daftar menurut tanggal terbaru: izin/cuti sehari penuh (tanggal mulai) dan izin sebagian hari (tanggalnya).
  const entries = useMemo<HistoryEntry[]>(
    () => [
      ...requests.map((record): HistoryEntry => ({ kind: 'full', sortKey: `${record.start_date.slice(0, 10)}-${String(record.id).padStart(8, '0')}`, record })),
      ...partials.map((record): HistoryEntry => ({ kind: 'partial', sortKey: `${record.date.slice(0, 10)}-${String(record.id).padStart(8, '0')}`, record })),
    ].sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1)),
    [requests, partials],
  );

  const remaining = Math.max(0, cutiQuota - cutiUsed);
  const usedPercent = cutiQuota > 0 ? Math.min(100, Math.round((cutiUsed / cutiQuota) * 100)) : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>Izin & Cuti</Text>
      </View>

      {loading ? (
        <SkeletonCards count={3} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(entry) => `${entry.kind}-${entry.record.id}`}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: 112 + insets.bottom }]}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {cutiQuota > 0 ? (
                <FadeInUp>
                  <View style={styles.quotaCard}>
                    <View style={styles.quotaTop}>
                      <View style={styles.quotaIcon}>
                        <Ionicons name="calendar-outline" size={20} color={accentText} />
                      </View>
                      <Text style={styles.quotaLabel}>Sisa cuti tahun ini</Text>
                    </View>

                    <View style={styles.quotaNumberRow}>
                      <Text style={styles.quotaBig}>{remaining}</Text>
                      <Text style={styles.quotaUnit}>hari</Text>
                    </View>

                    <View style={styles.quotaTrack}>
                      <View style={[styles.quotaFill, { width: `${usedPercent}%` }]} />
                    </View>
                    <View style={styles.quotaLegend}>
                      <Text style={styles.quotaLegendText}>Dipakai {cutiUsed} hari</Text>
                      <Text style={styles.quotaLegendText}>Jatah {cutiQuota} hari</Text>
                    </View>
                  </View>
                </FadeInUp>
              ) : null}

              {entries.length > 0 ? <Text style={styles.listTitle}>Riwayat pengajuan</Text> : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="calendar-outline" size={38} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>Belum ada pengajuan</Text>
              <Text style={styles.emptyText}>Izin, sakit, cuti, atau izin sebagian hari yang diajukan akan muncul di sini beserta statusnya.</Text>
            </View>
          }
          renderItem={({ item: entry, index }) => {
            if (entry.kind === 'partial') {
              const part = entry.record;
              const partMeta = STATUS_META[part.status];
              const partTone = colors[partMeta.color];

              return (
                <FadeInUp index={index} enabled={index < 6}>
                  <View style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={styles.typeTile}>
                        <Ionicons name={PARTIAL_ICON[part.category]} size={22} color={accentText} />
                      </View>
                      <View style={styles.cardTitleWrap}>
                        <Text style={styles.cardType} numberOfLines={1}>{part.category_label}</Text>
                        <Text style={styles.cardDates} numberOfLines={1}>{formatDate(part.date)} · {part.window_label}</Text>
                      </View>
                      <View style={styles.daysChip}>
                        <Text style={styles.daysChipText}>Sebagian hari</Text>
                      </View>
                    </View>

                    {part.reason ? <Text style={styles.cardReason} numberOfLines={3}>{part.reason}</Text> : null}

                    {part.status === 'rejected' && part.review_notes ? (
                      <View style={styles.noteBox}>
                        <Text style={styles.noteLabel}>Alasan ditolak</Text>
                        <Text style={styles.noteText}>{part.review_notes}</Text>
                      </View>
                    ) : null}

                    <View style={styles.cardFooter}>
                      <View style={[styles.statusPill, { backgroundColor: colors[partMeta.bg] }]}>
                        <View style={[styles.statusDot, { backgroundColor: partTone }]} />
                        <Text style={[styles.statusText, { color: partTone }]}>{partMeta.label}</Text>
                      </View>
                      <View style={styles.cardActions}>
                        {part.can_cancel ? (
                          <Pressable
                            style={[styles.actionChip, styles.actionChipDanger]}
                            onPress={() => handleCancelPartial(part)}
                            disabled={cancellingId === -part.id}
                            hitSlop={6}
                            accessibilityRole="button"
                            accessibilityLabel="Batalkan pengajuan"
                          >
                            {cancellingId === -part.id ? (
                              <ActivityIndicator size="small" color={colors.danger} />
                            ) : (
                              <Text style={[styles.actionChipText, { color: colors.danger }]}>Batalkan</Text>
                            )}
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>
                </FadeInUp>
              );
            }

            const item = entry.record;
            const meta = STATUS_META[item.status];
            const tone = colors[meta.color];
            const days = dayCountOf(item);
            const reviewed = item.reviewer_name && (item.status === 'approved' || item.status === 'rejected');

            return (
              <FadeInUp index={index} enabled={index < 6}>
                <View style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.typeTile}>
                      <Ionicons name={leaveTypeIcon(item.leave_type_name, item.type)} size={22} color={accentText} />
                    </View>
                    <View style={styles.cardTitleWrap}>
                      <Text style={styles.cardType} numberOfLines={1}>{typeName(item)}</Text>
                      <Text style={styles.cardDates} numberOfLines={1}>{formatRange(item.start_date, item.end_date)}</Text>
                    </View>
                    <View style={styles.daysChip}>
                      <Text style={styles.daysChipText}>{days} hari</Text>
                    </View>
                  </View>

                  {item.reason ? <Text style={styles.cardReason} numberOfLines={3}>{item.reason}</Text> : null}

                  {item.status === 'rejected' && item.review_note ? (
                    <View style={styles.noteBox}>
                      <Text style={styles.noteLabel}>Alasan ditolak</Text>
                      <Text style={styles.noteText}>{item.review_note}</Text>
                    </View>
                  ) : null}
                  {item.status === 'revoked' && item.review_note ? (
                    <View style={styles.noteBox}>
                      <Text style={styles.noteLabel}>Alasan dicabut</Text>
                      <Text style={styles.noteText}>{item.review_note}</Text>
                    </View>
                  ) : null}

                  <View style={styles.cardFooter}>
                    <View style={[styles.statusPill, { backgroundColor: colors[meta.bg] }]}>
                      <View style={[styles.statusDot, { backgroundColor: tone }]} />
                      <Text style={[styles.statusText, { color: tone }]}>{meta.label}</Text>
                    </View>

                    <View style={styles.cardActions}>
                      {item.document_url ? (
                        <Pressable onPress={() => Linking.openURL(item.document_url!)} style={styles.actionChip} hitSlop={6} accessibilityRole="button" accessibilityLabel="Buka lampiran">
                          <Ionicons name="attach-outline" size={15} color={colors.textSecondary} />
                          <Text style={styles.actionChipText}>Lampiran</Text>
                        </Pressable>
                      ) : null}
                      {item.status === 'pending' ? (
                        <Pressable
                          style={[styles.actionChip, styles.actionChipDanger]}
                          onPress={() => handleCancel(item)}
                          disabled={cancellingId === item.id}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel="Batalkan pengajuan"
                        >
                          {cancellingId === item.id ? (
                            <ActivityIndicator size="small" color={colors.danger} />
                          ) : (
                            <Text style={[styles.actionChipText, { color: colors.danger }]}>Batalkan</Text>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  </View>

                  <Text style={styles.cardMeta} numberOfLines={2}>
                    {item.request_number}
                    {reviewed ? ` · Ditinjau ${item.reviewer_name}${item.reviewed_at ? `, ${formatDate(item.reviewed_at)}` : ''}` : ''}
                  </Text>
                </View>
              </FadeInUp>
            );
          }}
          ListFooterComponent={
            hasMore ? (
              <Pressable style={styles.loadMoreBtn} onPress={loadMoreRequests} disabled={loadingMore} accessibilityRole="button">
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.loadMoreText}>Muat riwayat lebih lama</Text>
                )}
              </Pressable>
            ) : null
          }
        />
      )}

      <View style={[styles.ctaWrap, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
        <PressableScale style={styles.cta} onPress={() => setFormVisible(true)} accessibilityRole="button" accessibilityLabel="Ajukan izin atau cuti">
          <Ionicons name="add-circle-outline" size={22} color="#ffffff" />
          <Text style={styles.ctaText}>Ajukan Izin / Cuti</Text>
        </PressableScale>
      </View>

      <LeaveRequestForm
        visible={formVisible}
        onClose={() => setFormVisible(false)}
        onSubmitted={loadRequests}
        leaveTypes={leaveTypes}
        cutiQuota={cutiQuota}
        cutiUsed={cutiUsed}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan Beranda, Absensi, dan formulir SPK: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
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

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    title: { flex: 1, fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.xs, flexGrow: 1 },
    headerBlock: { gap: 20, marginBottom: 14 },
    errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.dangerBg },
    errorText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.danger, lineHeight: 20 },

    // Kartu sisa cuti
    quotaCard: { gap: 14, padding: 20, borderRadius: 28, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    quotaTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    quotaIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    quotaLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.textSecondary },
    quotaNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    quotaBig: { fontSize: 52, fontWeight: '800', letterSpacing: -2, lineHeight: 58, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    quotaUnit: { fontSize: 18, fontWeight: '700', color: colors.textMuted },
    quotaTrack: { height: 8, borderRadius: 4, backgroundColor: chip, overflow: 'hidden' },
    quotaFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
    quotaLegend: { flexDirection: 'row', justifyContent: 'space-between' },
    quotaLegendText: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },

    listTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },

    // Kartu pengajuan
    card: { gap: 14, padding: 18, marginBottom: 12, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    typeTile: { width: 46, height: 46, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    cardTitleWrap: { flex: 1, gap: 2 },
    cardType: { fontSize: fontSize.base + 1, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    cardDates: { fontSize: 13, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    daysChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: chip },
    daysChipText: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    cardReason: { fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textSecondary },

    noteBox: { gap: 2, padding: 14, borderRadius: 18, backgroundColor: colors.dangerBg },
    noteLabel: { fontSize: 12, fontWeight: '800', color: colors.danger },
    noteText: { fontSize: fontSize.sm, lineHeight: 20, color: colors.danger },

    cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { fontSize: 12.5, fontWeight: '800' },
    cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    actionChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 44, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: chip },
    actionChipDanger: { backgroundColor: colors.dangerBg },
    actionChipText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
    cardMeta: { fontSize: 11.5, fontWeight: '500', color: colors.textMuted },

    emptyState: { alignItems: 'center', gap: 6, paddingTop: 72, paddingHorizontal: spacing.xl },
    emptyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    emptyText: { fontSize: fontSize.sm, lineHeight: 22, textAlign: 'center', color: colors.textMuted },

    loadMoreBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md },
    loadMoreText: { fontSize: fontSize.sm, fontWeight: '700', color: accentText },

    // Tombol ajukan melayang di atas daftar, tanpa garis pemisah
    ctaWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12 },
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 4,
    },
    ctaText: { fontSize: fontSize.base, fontWeight: '700', color: '#ffffff' },
  });
}
