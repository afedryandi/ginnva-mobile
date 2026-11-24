import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';
import DamageDiagram, { DamageMark } from '@/components/spk/DamageDiagram';

interface SpkSummary {
  id: number;
  spk_number: string;
  damage_marks: DamageMark[];
}

// Halaman TERSENDIRI buat inspeksi kondisi kendaraan (diminta user
// 2026-09-16: dibuka lewat menu dulu, muncul halaman baru, baru bisa
// kasih mark -- BUKAN lagi ditumpuk jadi 1 section di dalam form SPK
// utama). Simpan lewat endpoint terpisah (PUT .../spks/{id}/damage-marks,
// lihat SpkController::updateDamageMarks()) yang cuma sentuh
// damage_marks, tidak butuh field SPK lain sama sekali.
// Tampilan dirancang ulang 2026-11-13, selaras dengan layar SPK lainnya: judul besar, kartu putih, mode Tambah/Hapus berbentuk segmen,
// jenis kerusakan dengan namanya langsung terbaca, ringkasan titik, dan tombol simpan yang selalu terlihat.
export default function SpkDamageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark, insets.bottom), [colors, isDark, insets.bottom]);

  const [loading, setLoading] = useState(true);
  const [spk, setSpk] = useState<SpkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marks, setMarks] = useState<DamageMark[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    staffApiFetch<{ data: SpkSummary }>(`/api/staff/spks/${id}`)
      .then((res) => {
        setSpk(res.data);
        setMarks(res.data.damage_marks ?? []);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'SPK tidak ditemukan.'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await staffApiFetch(`/api/staff/spks/${id}/damage-marks`, {
        method: 'PUT',
        body: JSON.stringify({
          damage_marks: marks.map((m) => ({ x_percent: m.x_percent, y_percent: m.y_percent, code: m.code })),
        }),
      });
      hapticSuccess();
      router.back();
    } catch (err) {
      hapticError();
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menyimpan kondisi kendaraan. Periksa koneksi internet.');
    } finally {
      setSaving(false);
    }
  }, [id, marks, saving]);

  const ready = !loading && !error && !!spk;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>Kondisi Kendaraan</Text>
          {spk ? <Text style={styles.subtitle} numberOfLines={1}>{spk.spk_number}</Text> : null}
        </View>
        {ready ? (
          <View style={[styles.countBadge, marks.length > 0 && styles.countBadgeOn]}>
            <Text style={[styles.countText, marks.length > 0 && styles.countTextOn]}>{marks.length} titik</Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <SkeletonCards count={2} />
      ) : error || !spk ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="alert-circle-outline" size={36} color={colors.danger} />
          </View>
          <Text style={styles.emptyTitle}>SPK tidak bisa dibuka</Text>
          <Text style={styles.centerStateText}>{error ?? 'SPK tidak ditemukan.'}</Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <DamageDiagram marks={marks} onChange={setMarks} colors={colors} />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <PressableScale
              style={[styles.submit, saving && styles.submitDisabled]}
              onPress={handleSave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Simpan kondisi kendaraan"
            >
              {saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={22} color="#ffffff" />
                  <Text style={styles.submitText}>Simpan Kondisi Kendaraan</Text>
                </>
              )}
            </PressableScale>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean, insetsBottom: number) {
  // Sama dengan layar SPK lainnya: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
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
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    countBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: chip },
    countBadgeOn: { backgroundColor: colors.accentSoft },
    countText: { fontSize: 13, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    countTextOn: { color: accentText },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    centerStateText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },

    form: { paddingHorizontal: 20, paddingBottom: spacing.xl },
    card: { padding: 16, borderRadius: 28, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },

    footer: {
      paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(insetsBottom, 12),
      backgroundColor: screenBg, borderTopWidth: 1, borderTopColor: line,
    },
    submit: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 4,
    },
    submitDisabled: { opacity: 0.7 },
    submitText: { fontSize: fontSize.base, fontWeight: '700', color: '#ffffff' },
  });
}
