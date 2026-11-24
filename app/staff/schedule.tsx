import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { toLocalDateString } from '@/lib/dates';
import { useAppTheme } from '@/lib/theme-context';

interface ScheduleDay {
  date: string;
  day_name: string;
  is_today: boolean;
  schedule: {
    label: string;
    time: string | null;
    is_off: boolean;
    is_override: boolean;
    reason: string | null;
  };
  leave_type: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
}

interface ScheduleResponse {
  week_start: string;
  week_end: string;
  days: ScheduleDay[];
}

const LEAVE_LABEL: Record<string, string> = {
  izin: 'Izin',
  sakit: 'Sakit',
  cuti: 'Cuti',
};

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  return `${fmt(s, s.getFullYear() !== e.getFullYear())} - ${fmt(e, true)}`;
}

// Jadwal kerja mingguan milik sendiri (audit fitur relevan Majoo Teams,
// 2026-09-30) -- gap sebelumnya: WorkSchedule/EmployeeScheduleAssignment
// sudah dibangun 2026-09-22 tapi cuma bisa dilihat admin lewat Filament,
// staff tidak punya cara melihat jadwal shift mingguannya sendiri.
export default function StaffScheduleScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSchedule = useCallback(async (offset: number, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const anchor = new Date();
      anchor.setDate(anchor.getDate() + offset * 7);
      const minggu = toLocalDateString(anchor);
      const res = await staffApiFetch<ScheduleResponse>(`/api/staff/schedule?minggu=${minggu}`);
      setData(res);
    } catch (err) {
      // Audit 2026-09-30 -- SEBELUMNYA pesan spesifik dari backend (mis. akun
      // belum ditautkan ke toko) tertelan, selalu disamaratakan jadi "periksa
      // koneksi internet" yang menyesatkan.
      setError(err instanceof ApiError ? err.message : 'Gagal memuat jadwal kerja. Periksa koneksi internet.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadSchedule(weekOffset);
  }, [weekOffset, loadSchedule]);

  const onRefresh = useCallback(() => loadSchedule(weekOffset, true), [weekOffset, loadSchedule]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Jadwal Kerja</Text>
        <View style={styles.sideButton} />
      </View>

      <View style={styles.weekNav}>
        <Pressable style={styles.weekNavBtn} onPress={() => setWeekOffset((w) => w - 1)}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.weekNavText}>
          {data ? formatWeekRange(data.week_start, data.week_end) : '—'}
        </Text>
        <Pressable style={styles.weekNavBtn} onPress={() => setWeekOffset((w) => w + 1)}>
          <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>
      {weekOffset !== 0 ? (
        <Pressable style={styles.todayBtn} onPress={() => setWeekOffset(0)}>
          <Text style={styles.todayBtnText}>Kembali ke Minggu Ini</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {data?.days.map((day) => (
            <View key={day.date} style={[styles.card, day.is_today && styles.cardToday]}>
              <View style={styles.cardLeft}>
                <Text style={[styles.dayName, day.is_today && styles.dayNameToday]}>{day.day_name}</Text>
                <Text style={styles.dayDate}>
                  {new Date(day.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                </Text>
              </View>

              <View style={styles.cardRight}>
                {day.leave_type ? (
                  <View style={styles.leaveBadge}>
                    <Text style={styles.leaveBadgeText}>{LEAVE_LABEL[day.leave_type] ?? day.leave_type}</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.scheduleRow}>
                      <Text style={[styles.scheduleLabel, day.schedule.is_off && styles.scheduleLabelOff]}>
                        {day.schedule.label}
                      </Text>
                      {day.schedule.is_override ? (
                        <View style={styles.overrideBadge}>
                          <Text style={styles.overrideBadgeText}>Diubah</Text>
                        </View>
                      ) : null}
                    </View>
                    {day.schedule.time ? <Text style={styles.scheduleTime}>{day.schedule.time}</Text> : null}
                    {day.schedule.reason ? <Text style={styles.scheduleReason}>{day.schedule.reason}</Text> : null}
                  </>
                )}

                {day.clock_in_at ? (
                  <Text style={styles.checkInText}>
                    Check In {formatTime(day.clock_in_at)}
                    {day.clock_out_at ? ` · Check Out ${formatTime(day.clock_out_at)}` : ''}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    weekNav: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    weekNavBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    weekNavText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, minWidth: 160, textAlign: 'center' },
    todayBtn: { alignSelf: 'center', paddingHorizontal: spacing.md, paddingVertical: 4, marginBottom: spacing.xs },
    todayBtnText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.accent },
    listContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    card: {
      flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
    },
    cardToday: { borderColor: colors.accent, borderWidth: 1.5 },
    cardLeft: { width: 64, alignItems: 'flex-start' },
    dayName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    dayNameToday: { color: colors.accent },
    dayDate: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
    cardRight: { flex: 1, marginLeft: spacing.md, gap: 2 },
    scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    scheduleLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
    scheduleLabelOff: { color: colors.textMuted },
    scheduleTime: { fontSize: fontSize.sm, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    scheduleReason: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
    overrideBadge: { backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
    overrideBadgeText: { fontSize: 12, fontWeight: '700', color: colors.accent },
    leaveBadge: { alignSelf: 'flex-start', backgroundColor: colors.dangerBg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    leaveBadgeText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.danger },
    checkInText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
  });
}
