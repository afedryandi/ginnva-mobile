import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface PpeItem {
  id: number;
  name: string | null;
  quantity: number;
  issued_on: string;
  replace_due_on: string | null;
  overdue: boolean;
}

interface TrainingItem {
  id: number;
  category_label: string;
  title: string;
  held_on: string;
  valid_until: string | null;
  expired: boolean;
  expires_soon: boolean;
  certificate_url: string | null;
}

interface ReviewItem {
  id: number;
  period_label: string;
  reviewed_on: string;
  reviewer_name: string | null;
  scores: { label: string; score: number }[];
  average: number;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  acknowledged_at: string | null;
}

interface SafetyResponse {
  ppe: PpeItem[];
  trainings: TrainingItem[];
  reviews: ReviewItem[];
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// K3 & Penilaian Saya (Karyawan Fase 5): APD yang dipegang beserta jatuh tempo ganti, pelatihan, dan penilaian kinerja. Penilaian untuk
// pembinaan, bukan dasar gaji; karyawan menyatakan sudah membacanya.
export default function StaffSafetyScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [data, setData] = useState<SafetyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ackingId, setAckingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await staffApiFetch<SafetyResponse>('/api/staff/safety'));
    } catch {
      setError('Gagal memuat data. Periksa koneksi internet.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const acknowledge = useCallback(
    async (review: ReviewItem) => {
      setAckingId(review.id);
      try {
        await staffApiFetch(`/api/staff/performance-reviews/${review.id}/acknowledge`, { method: 'POST' });
        await load();
      } catch (err) {
        Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
      } finally {
        setAckingId(null);
      }
    },
    [load]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>K3 & Penilaian Saya</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {data ? (
            <>
              <Text style={styles.sectionTitle}>APD & Perlengkapan Saya</Text>
              <View style={styles.card}>
                {data.ppe.length === 0 ? (
                  <Text style={styles.hint}>Belum ada perlengkapan tercatat atas nama akun ini.</Text>
                ) : (
                  data.ppe.map((p) => (
                    <View key={p.id} style={styles.row}>
                      <View style={styles.rowMain}>
                        <Text style={styles.rowTitle}>{p.name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</Text>
                        <Text style={styles.rowSub}>Diterima {formatDate(p.issued_on)}</Text>
                      </View>
                      {p.replace_due_on ? (
                        <Text style={[styles.badge, p.overdue ? styles.badgeDanger : styles.badgeMuted]}>
                          {p.overdue ? 'Perlu diganti' : `Ganti ${formatDate(p.replace_due_on)}`}
                        </Text>
                      ) : null}
                    </View>
                  ))
                )}
                {data.ppe.some((p) => p.overdue) ? (
                  <Text style={styles.hint}>Hubungi atasan untuk penggantian perlengkapan yang sudah jatuh tempo.</Text>
                ) : null}
              </View>

              <Text style={styles.sectionTitle}>Pelatihan</Text>
              <View style={styles.card}>
                {data.trainings.length === 0 ? (
                  <Text style={styles.hint}>Belum ada pelatihan tercatat.</Text>
                ) : (
                  data.trainings.map((t) => (
                    <View key={t.id} style={styles.row}>
                      <View style={styles.rowMain}>
                        <Text style={styles.rowTitle}>{t.title}</Text>
                        <Text style={styles.rowSub}>{t.category_label} · {formatDate(t.held_on)}</Text>
                        {t.certificate_url ? (
                          <Pressable onPress={() => Linking.openURL(t.certificate_url!)}>
                            <Text style={styles.link}>Lihat sertifikat</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {t.valid_until ? (
                        <Text style={[styles.badge, t.expired ? styles.badgeDanger : t.expires_soon ? styles.badgeWarn : styles.badgeMuted]}>
                          {t.expired ? 'Kedaluwarsa' : `s/d ${formatDate(t.valid_until)}`}
                        </Text>
                      ) : null}
                    </View>
                  ))
                )}
              </View>

              <Text style={styles.sectionTitle}>Penilaian Kinerja</Text>
              {data.reviews.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>Belum ada penilaian.</Text>
                </View>
              ) : (
                data.reviews.map((r) => (
                  <View key={r.id} style={[styles.card, styles.reviewCard]}>
                    <View style={styles.reviewTop}>
                      <Text style={styles.rowTitle}>{r.period_label}</Text>
                      <Text style={styles.average}>{r.average.toFixed(2)}</Text>
                    </View>
                    <Text style={styles.rowSub}>
                      {formatDate(r.reviewed_on)}{r.reviewer_name ? ` · oleh ${r.reviewer_name}` : ''}
                    </Text>
                    {r.scores.map((s) => (
                      <View key={s.label} style={styles.scoreRow}>
                        <Text style={styles.scoreLabel}>{s.label}</Text>
                        <Text style={styles.scoreValue}>{s.score} / 5</Text>
                      </View>
                    ))}
                    {r.strengths ? <Text style={styles.note}><Text style={styles.noteLabel}>Kekuatan: </Text>{r.strengths}</Text> : null}
                    {r.improvements ? <Text style={styles.note}><Text style={styles.noteLabel}>Perlu diperbaiki: </Text>{r.improvements}</Text> : null}
                    {r.goals ? <Text style={styles.note}><Text style={styles.noteLabel}>Target: </Text>{r.goals}</Text> : null}

                    {r.acknowledged_at ? (
                      <Text style={styles.doneText}>Sudah dibaca {formatDate(r.acknowledged_at)}</Text>
                    ) : (
                      <Pressable style={styles.ackButton} onPress={() => acknowledge(r)} disabled={ackingId === r.id}>
                        {ackingId === r.id ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.ackButtonText}>Saya Sudah Membaca</Text>}
                      </Pressable>
                    )}
                  </View>
                ))
              )}
              <Text style={styles.hint}>Penilaian dipakai untuk pembinaan, bukan untuk menentukan gaji.</Text>
            </>
          ) : null}
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
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    sectionTitle: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
    reviewCard: { marginBottom: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 2 },
    rowMain: { flex: 1 },
    rowTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    rowSub: { fontSize: fontSize.xs, color: colors.textMuted },
    hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
    link: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent, marginTop: 2 },
    badge: { fontSize: fontSize.xs, fontWeight: '700', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
    badgeMuted: { backgroundColor: colors.accentSoft, color: colors.textSecondary },
    badgeWarn: { backgroundColor: colors.warningBg, color: colors.warning },
    badgeDanger: { backgroundColor: colors.dangerBg, color: colors.danger },
    reviewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    average: { fontSize: fontSize.lg, fontWeight: '800', color: colors.accent, fontVariant: ['tabular-nums'] },
    scoreRow: { flexDirection: 'row', justifyContent: 'space-between' },
    scoreLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
    scoreValue: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    note: { fontSize: fontSize.sm, color: colors.textPrimary, marginTop: spacing.xs },
    noteLabel: { fontWeight: '700' },
    doneText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.success, marginTop: spacing.sm },
    ackButton: { marginTop: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
    ackButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: '#ffffff' },
  });
}
