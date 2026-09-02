import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface WarningLetterRecord {
  id: number;
  warning_number: string;
  level: 'sp1' | 'sp2' | 'sp3';
  reason: string;
  issued_date: string;
  valid_until: string | null;
  document_url: string | null;
  issuer_name: string | null;
}

const LEVEL_META: Record<WarningLetterRecord['level'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  sp1: { label: 'SP 1', color: 'warning', bg: 'warningBg' },
  sp2: { label: 'SP 2', color: 'danger', bg: 'dangerBg' },
  sp3: { label: 'SP 3', color: 'danger', bg: 'dangerBg' },
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Read-only — SP cuma bisa diterbitkan/diedit admin lewat Filament
 * (WarningLetterResource), tidak ada jalur tulis dari mobile sama sekali.
 * Dibangun saat audit modul Karyawan > Surat Peringatan: sebelumnya
 * karyawan tidak punya cara sama sekali melihat SP miliknya sendiri.
 */
export default function StaffWarningLettersScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [letters, setLetters] = useState<WarningLetterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLetters = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ warning_letters: WarningLetterRecord[] }>('/api/staff/warning-letters');
      setLetters(res.warning_letters);
    } catch {
      setError('Gagal memuat riwayat Surat Peringatan. Periksa koneksi internet Anda.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadLetters().finally(() => setLoading(false));
  }, [loadLetters]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLetters();
    setRefreshing(false);
  }, [loadLetters]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Surat Peringatan</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={letters}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="shield-checkmark-outline" size={40} color={colors.success} />
              <Text style={styles.emptyText}>Tidak ada Surat Peringatan tercatat.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const meta = LEVEL_META[item.level];
            return (
              <View style={styles.card}>
                <View style={styles.cardTopRow}>
                  <View style={[styles.levelBadge, { backgroundColor: colors[meta.bg] }]}>
                    <Text style={[styles.levelBadgeText, { color: colors[meta.color] }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.cardNumber}>{item.warning_number}</Text>
                </View>
                <Text style={styles.cardDate}>
                  Diterbitkan {formatDate(item.issued_date)}
                  {item.valid_until ? ` · Berlaku sampai ${formatDate(item.valid_until)}` : ''}
                </Text>
                <Text style={styles.cardReason}>{item.reason}</Text>
                {item.issuer_name ? (
                  <Text style={styles.cardIssuer}>Diterbitkan oleh {item.issuer_name}</Text>
                ) : null}
                {item.document_url ? (
                  <Pressable onPress={() => Linking.openURL(item.document_url!)} style={styles.attachmentLink}>
                    <Ionicons name="attach-outline" size={14} color={colors.accent} />
                    <Text style={styles.attachmentLinkText}>Lihat scan surat</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />
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
    listContent: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.sm,
    },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
    levelBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
    levelBadgeText: { fontSize: fontSize.xs, fontWeight: '700' },
    cardNumber: { fontSize: 10, color: colors.textMuted },
    cardDate: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs, fontVariant: ['tabular-nums'] },
    cardReason: { fontSize: fontSize.sm, color: colors.textPrimary, marginBottom: spacing.xs },
    cardIssuer: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs },
    attachmentLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    attachmentLinkText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.accent },
    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  });
}
