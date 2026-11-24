import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Alert, Linking, Modal, TextInput, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface Approval {
  id: number;
  stage: 'manager' | 'direksi';
  requester: string | null;
  amount: number;
  category: string | null;
  store: string | null;
  date: string | null;
  description: string | null;
  receipt_url: string | null;
}

function rupiah(amount: number): string {
  return 'Rp' + Math.round(amount).toLocaleString('id-ID');
}

// Persetujuan pengeluaran (Keuangan Fase 5): Store Manager menyetujui pengajuan tokonya, direksi menyetujui tahap akhir.
export default function StaffApprovalsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await staffApiFetch<{ approvals: Approval[] }>('/api/staff/finance/approvals')).approvals);
    } catch {
      setError('Gagal memuat pengajuan. Periksa koneksi internet.');
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

  const approve = useCallback(
    (item: Approval) => {
      Alert.alert('Setujui Pengeluaran', `${rupiah(item.amount)} untuk ${item.category ?? 'pengeluaran'} oleh ${item.requester ?? '—'}?`, [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Setujui',
          onPress: async () => {
            setBusyId(item.id);
            try {
              await staffApiFetch(`/api/staff/finance/approvals/${item.id}/approve`, { method: 'POST' });
              await load();
            } catch (err) {
              Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [load]
  );

  const reject = useCallback(async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    try {
      await staffApiFetch(`/api/staff/finance/approvals/${rejecting.id}/reject`, { method: 'POST', body: JSON.stringify({ note: note.trim() || null }) });
      setRejecting(null);
      setNote('');
      await load();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setBusyId(null);
    }
  }, [rejecting, note, load]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Persetujuan Pengeluaran</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-done-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>Tidak ada pengajuan yang menunggu persetujuan.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.top}>
                <Text style={styles.amount}>{rupiah(item.amount)}</Text>
                <Text style={styles.stage}>{item.stage === 'manager' ? 'Tahap Store Manager' : 'Tahap Direksi'}</Text>
              </View>
              <Text style={styles.meta}>{item.category ?? '—'} · {item.store ?? '—'} · {item.date ?? '—'}</Text>
              <Text style={styles.meta}>Diajukan {item.requester ?? '—'}</Text>
              {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
              {item.receipt_url ? (
                <Pressable onPress={() => Linking.openURL(item.receipt_url!)} style={styles.link}>
                  <Ionicons name="image-outline" size={16} color={colors.accent} />
                  <Text style={styles.linkText}>Lihat nota</Text>
                </Pressable>
              ) : (
                <Text style={styles.noReceipt}>Tanpa foto nota</Text>
              )}
              <View style={styles.buttons}>
                <Pressable style={[styles.btn, styles.btnReject]} onPress={() => { setRejecting(item); setNote(''); }} disabled={busyId === item.id}>
                  <Text style={styles.btnRejectText}>Tolak</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnApprove]} onPress={() => approve(item)} disabled={busyId === item.id}>
                  {busyId === item.id ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.btnApproveText}>Setujui</Text>}
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={rejecting !== null} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Tolak Pengajuan</Text>
            <Text style={styles.meta}>{rejecting ? `${rupiah(rejecting.amount)} · ${rejecting.requester ?? '—'}` : ''}</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="Alasan penolakan (opsional)"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <View style={styles.buttons}>
              <Pressable style={[styles.btn, styles.btnCancel]} onPress={() => setRejecting(null)}>
                <Text style={styles.btnCancelText}>Batal</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnReject]} onPress={reject}>
                <Text style={styles.btnRejectText}>Tolak</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
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
    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
    top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    amount: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    stage: { fontSize: fontSize.xs, fontWeight: '700', color: colors.warning },
    meta: { fontSize: fontSize.xs, color: colors.textMuted },
    description: { fontSize: fontSize.sm, color: colors.textPrimary, marginTop: 2 },
    link: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    linkText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.accent },
    noReceipt: { fontSize: fontSize.xs, color: colors.warning, marginTop: 4 },
    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    btn: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    btnApprove: { backgroundColor: colors.accent },
    btnApproveText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },
    btnReject: { backgroundColor: colors.dangerBg },
    btnRejectText: { color: colors.danger, fontWeight: '700', fontSize: fontSize.sm },
    btnCancel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    btnCancelText: { color: colors.textPrimary, fontWeight: '600', fontSize: fontSize.sm },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
    sheet: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
    sheetTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
    input: {
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.sm, color: colors.textPrimary, minHeight: 80, textAlignVertical: 'top',
    },
  });
}
