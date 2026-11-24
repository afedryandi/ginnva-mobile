import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface WarningLetterRecord {
  id: number;
  warning_number: string;
  level: 'sp1' | 'sp2' | 'sp3';
  // "Berlaku", "Kedaluwarsa", atau "Dibatalkan"; opsional karena server lama belum mengirimnya.
  status?: 'Berlaku' | 'Kedaluwarsa' | 'Dibatalkan';
  reason: string;
  issued_date: string;
  valid_until: string | null;
  // Ditambahkan 2026-09-27 (audit Surat Peringatan, "Gap standar
  // enterprise") -- sebelumnya tidak ada bukti karyawan sudah
  // diberi tahu/membaca SP-nya.
  acknowledged_at: string | null;
  // Surat yang dibatalkan HR tetap tampil sebagai bukti, tetapi tidak berlaku lagi. Opsional: server lama belum mengirimnya.
  cancelled_at?: string | null;
  cancel_reason?: string | null;
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
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  const [letters, setLetters] = useState<WarningLetterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<number | null>(null);

  const loadLetters = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ warning_letters: WarningLetterRecord[] }>('/api/staff/warning-letters');
      setLetters(res.warning_letters);
    } catch {
      setError('Gagal memuat riwayat Surat Peringatan. Periksa koneksi internet.');
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

  const handleAcknowledge = useCallback(async (item: WarningLetterRecord) => {
    setAcknowledgingId(item.id);
    try {
      const res = await staffApiFetch<{ warning_letter: WarningLetterRecord }>(
        `/api/staff/warning-letters/${item.id}/acknowledge`,
        { method: 'POST' }
      );
      setLetters((prev) => prev.map((l) => (l.id === item.id ? res.warning_letter : l)));
    } catch {
      setError('Gagal menandai sudah dibaca. Periksa koneksi internet.');
    } finally {
      setAcknowledgingId(null);
    }
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Surat Peringatan</Text>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={letters}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
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
              <View style={styles.emptyIcon}>
                <Ionicons name="shield-checkmark-outline" size={34} color={colors.success} />
              </View>
              <Text style={styles.emptyText}>Tidak ada Surat Peringatan tercatat</Text>
            </View>
          }
          renderItem={({ item }) => {
            const meta = LEVEL_META[item.level];
            const unread = !item.acknowledged_at && !item.cancelled_at;

            return (
              <View style={[styles.card, !!item.cancelled_at && styles.cardCancelled]}>
                <View style={styles.cardTopRow}>
                  <View style={styles.badgeRow}>
                    <View style={[styles.levelBadge, { backgroundColor: colors[meta.bg] }]}>
                      <Text style={[styles.levelBadgeText, { color: colors[meta.color] }]}>{meta.label}</Text>
                    </View>
                    {item.status && item.status !== 'Dibatalkan' ? (
                      <View style={[styles.statusBadge, item.status === 'Berlaku' ? styles.statusActive : styles.statusExpired]}>
                        <Text style={[styles.statusText, item.status === 'Berlaku' ? { color: colors.success } : { color: colors.textMuted }]}>{item.status}</Text>
                      </View>
                    ) : null}
                    {unread ? (
                      <View style={styles.unreadBadge}>
                        <View style={styles.unreadDot} />
                        <Text style={styles.unreadText}>Belum dibaca</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <Text style={styles.cardNumber}>{item.warning_number}</Text>
                <Text style={styles.cardReason}>{item.reason}</Text>

                {item.cancelled_at ? (
                  <View style={styles.cancelledBox}>
                    <Text style={styles.cancelledText}>
                      Dibatalkan {formatDate(item.cancelled_at)}
                      {item.cancel_reason ? `: ${item.cancel_reason}` : ''}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.metaBox}>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Diterbitkan</Text>
                    <Text style={styles.metaValue}>{formatDate(item.issued_date)}</Text>
                  </View>
                  {item.valid_until ? (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Berlaku sampai</Text>
                      <Text style={styles.metaValue}>{formatDate(item.valid_until)}</Text>
                    </View>
                  ) : null}
                  {item.issuer_name ? (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Diterbitkan oleh</Text>
                      <Text style={styles.metaValue} numberOfLines={1}>{item.issuer_name}</Text>
                    </View>
                  ) : null}
                </View>

                {item.document_url ? (
                  <Pressable onPress={() => Linking.openURL(item.document_url!)} style={styles.attachmentLink} accessibilityRole="button">
                    <Ionicons name="attach-outline" size={18} color={accentText} />
                    <Text style={styles.attachmentLinkText}>Lihat scan surat</Text>
                  </Pressable>
                ) : null}

                {item.acknowledged_at ? (
                  <View style={styles.ackDoneRow}>
                    <View style={styles.ackDoneIcon}>
                      <Ionicons name="checkmark" size={14} color="#ffffff" />
                    </View>
                    <Text style={styles.ackDoneText}>Sudah dibaca {formatDate(item.acknowledged_at)}</Text>
                  </View>
                ) : item.cancelled_at ? null : (
                  <Pressable
                    style={[styles.ackBtn, acknowledgingId === item.id && { opacity: 0.7 }]}
                    onPress={() => handleAcknowledge(item)}
                    disabled={acknowledgingId === item.id}
                    accessibilityRole="button"
                  >
                    {acknowledgingId === item.id ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Ionicons name="checkmark-outline" size={18} color="#ffffff" />
                    )}
                    <Text style={styles.ackBtnText}>Tandai Sudah Dibaca</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan halaman lain yang sudah dirombak: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
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
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerTitle: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    listContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: spacing.xxl, flexGrow: 1, gap: 14 },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: 20, padding: spacing.md, marginBottom: 14 },
    errorText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: '600' },

    card: { gap: 6, padding: 20, borderRadius: 28, backgroundColor: card, ...shadow },
    cardCancelled: { opacity: 0.75 },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, flexWrap: 'wrap' },
    levelBadge: { paddingHorizontal: 14, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    levelBadgeText: { fontSize: 13, fontWeight: '800' },
    statusBadge: { paddingHorizontal: 12, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    statusActive: { backgroundColor: colors.successBg },
    statusExpired: { backgroundColor: chip },
    statusText: { fontSize: 12.5, fontWeight: '700' },
    unreadBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: colors.accentSoft },
    unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
    unreadText: { fontSize: 12.5, fontWeight: '800', color: accentText },

    cardNumber: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4, color: colors.textMuted },
    cardReason: { fontSize: 17, fontWeight: '700', lineHeight: 24, letterSpacing: -0.2, color: colors.textPrimary },

    cancelledBox: { marginTop: 4, padding: 14, borderRadius: 18, backgroundColor: colors.dangerBg },
    cancelledText: { fontSize: 13.5, lineHeight: 20, fontWeight: '600', color: colors.danger },

    metaBox: { gap: 10, marginTop: 10, padding: 16, borderRadius: 20, backgroundColor: chip },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
    metaLabel: { fontSize: 13.5, fontWeight: '500', color: colors.textMuted },
    metaValue: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: colors.textPrimary, textAlign: 'right', fontVariant: ['tabular-nums'] },

    attachmentLink: { height: 48, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    attachmentLinkText: { fontSize: 14.5, fontWeight: '800', color: accentText },

    ackDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
    ackDoneIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
    ackDoneText: { fontSize: 13.5, fontWeight: '700', color: colors.success },
    ackBtn: { height: 52, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.pill, backgroundColor: colors.accent },
    ackBtnText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    emptyState: { alignItems: 'center', paddingVertical: 64, gap: 14 },
    emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successBg },
    emptyText: { fontSize: fontSize.sm + 1, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
  });
}
