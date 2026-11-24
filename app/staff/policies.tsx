import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface PolicyRecord {
  id: number;
  title: string;
  category: string;
  category_label: string;
  version: string | null;
  effective_from: string | null;
  description: string | null;
  file_url: string | null;
  requires_acknowledgment: boolean;
  is_published: boolean;
  acknowledged_at: string | null;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Peraturan Perusahaan, kebijakan, dan SOP (Karyawan Fase 3). Karyawan membaca dokumennya lalu menyatakan menerima; potongan telat dan
// Alpha hanya sah bila tertulis di Peraturan Perusahaan yang sudah diterima.
export default function StaffPoliciesScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [openedIds, setOpenedIds] = useState<number[]>([]);

  const isPending = (p: PolicyRecord) => p.is_published && p.requires_acknowledgment && !p.acknowledged_at;

  // Dokumen yang menunggu diterima di atas, lalu yang berlaku, lalu versi lama yang sudah dicabut (urutan server dipertahankan di tiap kelompok).
  const sortedPolicies = useMemo(() => {
    const rank = (p: PolicyRecord) => (isPending(p) ? 0 : p.is_published ? 1 : 2);
    return policies
      .map((p, index) => ({ p, index }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.index - b.index)
      .map(({ p }) => p);
  }, [policies]);
  const pendingCount = useMemo(() => policies.filter(isPending).length, [policies]);

  const openDocument = useCallback((policy: PolicyRecord) => {
    setOpenedIds((ids) => (ids.includes(policy.id) ? ids : [...ids, policy.id]));
    Linking.openURL(policy.file_url!).catch(() => Alert.alert('Gagal', 'Dokumen tidak bisa dibuka. Coba lagi.'));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ policies: PolicyRecord[] }>('/api/staff/policies');
      setPolicies(res.policies);
    } catch {
      setError('Gagal memuat dokumen. Periksa koneksi internet.');
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

  const accept = useCallback(
    (policy: PolicyRecord) => {
      Alert.alert('Terima Dokumen', `Saya sudah membaca dan menerima "${policy.title}".`, [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Saya Terima',
          onPress: async () => {
            setAcceptingId(policy.id);
            try {
              await staffApiFetch(`/api/staff/policies/${policy.id}/acknowledge`, { method: 'POST' });
              await load();
            } catch (err) {
              Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
            } finally {
              setAcceptingId(null);
            }
          },
        },
      ]);
    },
    [load]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Peraturan & Kebijakan</Text>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={sortedPolicies}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          ListHeaderComponent={
            <>
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
              {pendingCount > 0 ? (
                <View style={styles.pendingBanner}>
                  <View style={styles.pendingBannerIcon}>
                    <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
                  </View>
                  <Text style={styles.pendingBannerText}>{pendingCount} dokumen menunggu dibaca dan diterima</Text>
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="document-text-outline" size={34} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyText}>Belum ada dokumen yang diterbitkan</Text>
            </View>
          }
          renderItem={({ item }) => {
            const needsOpen = !!(item.file_url && !openedIds.includes(item.id));

            return (
              <View style={[styles.card, !item.is_published && styles.cardInactive]}>
                <View style={styles.tagRow}>
                  <Text style={styles.category} numberOfLines={1}>{item.category_label}{item.version ? ` · ${item.version}` : ''}</Text>
                  {isPending(item) ? (
                    <View style={styles.pendingTag}>
                      <Text style={styles.pendingTagText}>Perlu diterima</Text>
                    </View>
                  ) : null}
                  {!item.is_published ? (
                    <View style={styles.inactiveTag}>
                      <Text style={styles.inactiveTagText}>Tidak berlaku</Text>
                    </View>
                  ) : null}
                </View>

                <Text style={styles.title}>{item.title}</Text>
                {item.effective_from ? <Text style={styles.meta}>Berlaku sejak {formatDate(item.effective_from)}</Text> : null}
                {item.description ? <Text style={styles.description}>{item.description}</Text> : null}

                {item.file_url ? (
                  <Pressable style={styles.openButton} onPress={() => openDocument(item)} accessibilityRole="button">
                    <Ionicons name="document-text-outline" size={18} color={accentText} />
                    <Text style={styles.openButtonText}>Buka Dokumen (PDF)</Text>
                  </Pressable>
                ) : null}

                {item.requires_acknowledgment ? (
                  item.acknowledged_at ? (
                    <View style={styles.doneBadge}>
                      <View style={styles.doneIcon}>
                        <Ionicons name="checkmark" size={14} color="#ffffff" />
                      </View>
                      <Text style={styles.doneText}>Diterima {formatDate(item.acknowledged_at)}</Text>
                    </View>
                  ) : (
                    item.is_published ? (
                      <Pressable
                        style={[styles.acceptButton, needsOpen && styles.acceptButtonDisabled]}
                        onPress={() => accept(item)}
                        disabled={acceptingId === item.id || needsOpen}
                        accessibilityRole="button"
                      >
                        {acceptingId === item.id ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.acceptButtonText}>
                            {needsOpen ? 'Buka dokumen dulu untuk menerima' : 'Saya Sudah Baca & Terima'}
                          </Text>
                        )}
                      </Pressable>
                    ) : null
                  )
                ) : null}
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
    emptyState: { alignItems: 'center', paddingVertical: 64, gap: 14 },
    emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    emptyText: { fontSize: fontSize.sm + 1, fontWeight: '600', color: colors.textMuted },

    pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 14, borderRadius: 24, backgroundColor: colors.warningBg },
    pendingBannerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: card },
    pendingBannerText: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20, color: colors.warning },

    card: { gap: 6, padding: 20, borderRadius: 28, backgroundColor: card, ...shadow },
    cardInactive: { opacity: 0.7 },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    category: { flexShrink: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    pendingTag: { paddingHorizontal: 10, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.warningBg },
    pendingTagText: { color: colors.warning, fontSize: 11.5, fontWeight: '800' },
    inactiveTag: { paddingHorizontal: 10, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    inactiveTagText: { color: colors.textMuted, fontSize: 11.5, fontWeight: '800' },
    title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4, lineHeight: 24, color: colors.textPrimary },
    meta: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
    description: { marginTop: 4, fontSize: 14, lineHeight: 21, color: colors.textSecondary },

    openButton: { height: 50, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    openButtonText: { fontSize: 14.5, fontWeight: '800', color: accentText },
    doneBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
    doneIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
    doneText: { fontSize: 13.5, fontWeight: '700', color: colors.success },
    acceptButton: { height: 52, marginTop: 10, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    acceptButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },
    acceptButtonDisabled: { opacity: 0.4 },
  });
}
