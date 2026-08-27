import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';

interface Movement {
  id: number;
  type: 'in' | 'out' | 'adjustment' | 'correction';
  quantity: string;
  unit_cost: string | null;
  note: string | null;
  user: { id: number; name: string } | null;
  created_at: string;
}

interface ConsumableData {
  id: number;
  name: string;
  code: string | null;
  category: string | null;
  unit: string;
  current_stock: string;
  reorder_point: string | null;
  movements: Movement[];
}

interface ShowResponse {
  data: ConsumableData;
  movements_has_more: boolean;
}

type MovementForm = { type: 'in' | 'out'; quantity: string; note: string } | null;

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function movementLabel(type: Movement['type']): string {
  if (type === 'in') return 'Masuk';
  if (type === 'out') return 'Keluar';
  if (type === 'correction') return 'Koreksi';
  return 'Penyesuaian';
}

export default function ConsumableDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [item, setItem] = useState<ConsumableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<MovementForm>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [adjustFormOpen, setAdjustFormOpen] = useState(false);
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  // "Muat Riwayat Lainnya" — sama pola dengan app/staff/inventory/[code].tsx.
  const [extraMovements, setExtraMovements] = useState<Movement[]>([]);
  const [hasMoreMovements, setHasMoreMovements] = useState(false);
  const [loadingMoreMovements, setLoadingMoreMovements] = useState(false);

  const fetchItem = useCallback(() => {
    setError(null);
    return staffApiFetch<ShowResponse>(`/api/staff/consumables/${id}`)
      .then((res) => {
        setItem(res.data);
        setExtraMovements([]);
        setHasMoreMovements(res.movements_has_more);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Barang tidak ditemukan atau koneksi bermasalah.');
      });
  }, [id]);

  const loadMoreMovements = useCallback(() => {
    if (!item) return;

    setLoadingMoreMovements(true);
    staffApiFetch<{ data: Movement[]; has_more: boolean }>(
      `/api/staff/consumables/${id}/movements?offset=${item.movements.length + extraMovements.length}`
    )
      .then((res) => {
        setExtraMovements((prev) => [...prev, ...res.data]);
        setHasMoreMovements(res.has_more);
      })
      .catch(() => hapticError())
      .finally(() => setLoadingMoreMovements(false));
  }, [id, item, extraMovements.length]);

  useEffect(() => {
    setLoading(true);
    fetchItem().finally(() => setLoading(false));
  }, [fetchItem]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItem();
    setRefreshing(false);
  }, [fetchItem]);

  const openForm = (type: 'in' | 'out') => {
    setForm({ type, quantity: '', note: '' });
    setFormError(null);
  };

  const handleSubmitMovement = () => {
    if (!form) return;

    const quantity = parseFloat(form.quantity.replace(',', '.'));
    if (!quantity || quantity <= 0) {
      setFormError('Isi jumlah yang valid (lebih dari 0).');
      return;
    }

    const submit = () => {
      setSubmitting(true);
      setFormError(null);

      staffApiFetch<{ message: string; data: ConsumableData }>(`/api/staff/consumables/${id}/movement`, {
        method: 'POST',
        body: JSON.stringify({ type: form.type, quantity, note: form.note.trim() || undefined }),
      })
        .then((res) => {
          hapticSuccess();
          fetchItem();
          setForm(null);
          Alert.alert('Berhasil', res.message);
        })
        .catch((err) => {
          hapticError();
          setFormError(err instanceof ApiError ? err.message : 'Gagal mencatat transaksi. Periksa koneksi internet Anda.');
        })
        .finally(() => setSubmitting(false));
    };

    // Catat Keluar mengurangi stok asli — minta konfirmasi dulu.
    if (form.type === 'out') {
      Alert.alert(
        'Catat Barang Keluar',
        `Catat ${quantity.toLocaleString('id-ID')} ${item?.unit ?? ''} keluar dari stok?`,
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Catat', style: 'destructive', onPress: submit },
        ]
      );
      return;
    }

    submit();
  };

  const handleAdjustStock = () => {
    const actualQuantity = parseFloat(adjustQuantity.replace(',', '.'));
    if (adjustQuantity.trim() === '' || isNaN(actualQuantity) || actualQuantity < 0) {
      setAdjustError('Isi hasil hitung fisik yang valid (0 atau lebih).');
      return;
    }

    const submit = () => {
      setAdjustSubmitting(true);
      setAdjustError(null);

      staffApiFetch<{ message: string; data: ConsumableData }>(`/api/staff/consumables/${id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ actual_quantity: actualQuantity, note: adjustNote.trim() || undefined }),
      })
        .then((res) => {
          hapticSuccess();
          setItem(res.data);
          setAdjustFormOpen(false);
          setAdjustQuantity('');
          setAdjustNote('');
          Alert.alert('Berhasil', res.message);
        })
        .catch((err) => {
          hapticError();
          setAdjustError(err instanceof ApiError ? err.message : 'Gagal mencatat penyesuaian. Periksa koneksi internet Anda.');
        })
        .finally(() => setAdjustSubmitting(false));
    };

    // Kalau hasil hitung sama dengan stok sistem, backend tidak mencatat
    // apa-apa (no-op) — langsung submit tanpa nanya konfirmasi "timpa
    // jadi X", karena tidak ada yang benar-benar berubah.
    const currentStock = item ? parseFloat(item.current_stock) : 0;
    if (Math.abs(actualQuantity - currentStock) < 0.01) {
      submit();
      return;
    }

    Alert.alert(
      'Sesuaikan Stok',
      `Stok di sistem saat ini: ${currentStock.toLocaleString('id-ID')} ${item?.unit ?? ''}. Timpa jadi ${actualQuantity.toLocaleString('id-ID')} ${item?.unit ?? ''} berdasarkan hitung fisik?`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Sesuaikan', style: 'destructive', onPress: submit },
      ]
    );
  };

  const isLowStock = item?.reorder_point !== null && item
    ? parseFloat(item.current_stock) <= parseFloat(item.reorder_point ?? '0')
    : false;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Detail Barang</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerStateText}>Memuat data barang...</Text>
        </View>
      ) : error || !item ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error ?? 'Barang tidak ditemukan.'}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        >
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                {item.code && <Text style={styles.codeText}>{item.code}</Text>}
                <Text style={styles.nameText}>{item.name}</Text>
                {item.category && <Text style={styles.categoryText}>{item.category}</Text>}
              </View>
              <View style={[styles.statusBadge, isLowStock ? styles.statusLow : styles.statusOk]}>
                <Text style={[styles.statusText, { color: isLowStock ? colors.danger : colors.success }]}>
                  {parseFloat(item.current_stock).toLocaleString('id-ID')} {item.unit}
                </Text>
              </View>
            </View>
            {isLowStock && (
              <View style={styles.infoRow}>
                <Ionicons name="warning-outline" size={16} color={colors.danger} />
                <Text style={[styles.infoText, { color: colors.danger }]}>Stok sudah di bawah ambang menipis</Text>
              </View>
            )}
          </View>

          {form ? (
            <View style={styles.card}>
              <Text style={styles.formTitle}>
                {form.type === 'in' ? 'Catat Barang Masuk' : 'Catat Barang Keluar'}
              </Text>

              <Text style={styles.fieldLabel}>Jumlah ({item.unit})</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                value={form.quantity}
                onChangeText={(v) => setForm((f) => f && { ...f, quantity: v })}
                keyboardType="decimal-pad"
                autoFocus
              />

              <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Mis. dipakai untuk booking apa, alasan keluar"
                placeholderTextColor={colors.textMuted}
                value={form.note}
                onChangeText={(v) => setForm((f) => f && { ...f, note: v })}
              />

              {formError && <Text style={styles.errorText}>{formError}</Text>}

              <View style={styles.formActions}>
                <Pressable style={styles.cancelButton} onPress={() => setForm(null)} disabled={submitting}>
                  <Text style={styles.cancelButtonText}>Batal</Text>
                </Pressable>
                <Button
                  label={submitting ? 'Menyimpan...' : 'Simpan'}
                  onPress={handleSubmitMovement}
                  loading={submitting}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : (
            <View style={styles.actionRow}>
              <Pressable style={[styles.actionButton, styles.actionIn]} onPress={() => openForm('in')}>
                <Ionicons name="arrow-down-circle" size={22} color="#ffffff" />
                <Text style={styles.actionButtonText}>Catat Masuk</Text>
              </Pressable>
              <Pressable style={[styles.actionButton, styles.actionOut]} onPress={() => openForm('out')}>
                <Ionicons name="arrow-up-circle" size={22} color="#ffffff" />
                <Text style={styles.actionButtonText}>Catat Keluar</Text>
              </Pressable>
            </View>
          )}

          {!form && item && (
            adjustFormOpen ? (
              <View style={styles.card}>
                <Text style={styles.formTitle}>Sesuaikan Stok (Opname)</Text>
                <Text style={styles.fieldLabel}>Hasil Hitung Fisik Sebenarnya ({item.unit})</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  value={adjustQuantity}
                  onChangeText={setAdjustQuantity}
                  keyboardType="decimal-pad"
                  autoFocus
                />
                <Text style={styles.helperInline}>
                  Stok di sistem saat ini: {parseFloat(item.current_stock).toLocaleString('id-ID')} {item.unit}. Isi jumlah hasil hitung fisik yang SEBENARNYA — selisihnya dihitung otomatis.
                </Text>

                <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Mis. hasil stock opname, alasan selisih"
                  placeholderTextColor={colors.textMuted}
                  value={adjustNote}
                  onChangeText={setAdjustNote}
                />

                {adjustError && <Text style={styles.errorText}>{adjustError}</Text>}
                <View style={styles.formActions}>
                  <Pressable
                    style={styles.cancelButton}
                    onPress={() => { setAdjustFormOpen(false); setAdjustQuantity(''); setAdjustNote(''); setAdjustError(null); }}
                    disabled={adjustSubmitting}
                  >
                    <Text style={styles.cancelButtonText}>Batal</Text>
                  </Pressable>
                  <Button
                    label={adjustSubmitting ? 'Menyimpan...' : 'Simpan'}
                    onPress={handleAdjustStock}
                    loading={adjustSubmitting}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : (
              <Button label="Sesuaikan Stok (Opname)" variant="outline" onPress={() => setAdjustFormOpen(true)} />
            )
          )}

          <Text style={styles.historyTitle}>Riwayat Terbaru</Text>
          {item.movements.length === 0 ? (
            <Text style={styles.emptyHistoryText}>Belum ada riwayat keluar/masuk untuk barang ini.</Text>
          ) : (
            <>
              {[...item.movements, ...extraMovements].map((m) => (
                <View key={m.id} style={styles.historyRow}>
                  <Ionicons
                    name={m.type === 'in' ? 'arrow-down-circle' : m.type === 'out' ? 'arrow-up-circle' : m.type === 'correction' ? 'arrow-undo-circle' : 'swap-vertical'}
                    size={20}
                    color={m.type === 'in' ? colors.success : m.type === 'out' ? colors.danger : m.type === 'correction' ? colors.textMuted : colors.warning}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyText}>
                      {movementLabel(m.type)} {parseFloat(m.quantity) > 0 && m.type === 'adjustment' ? '+' : ''}
                      {parseFloat(m.quantity).toLocaleString('id-ID')} {item.unit}
                      {m.user ? ` — ${m.user.name}` : ''}
                    </Text>
                    {m.unit_cost && (
                      <Text style={styles.historyNote}>Rp {parseFloat(m.unit_cost).toLocaleString('id-ID')} / {item.unit}</Text>
                    )}
                    {m.note && <Text style={styles.historyNote}>{m.note}</Text>}
                    <Text style={styles.historyDate}>{formatDateTime(m.created_at)}</Text>
                  </View>
                </View>
              ))}

              {hasMoreMovements && (
                <Pressable
                  style={styles.loadMoreButton}
                  onPress={loadMoreMovements}
                  disabled={loadingMoreMovements}
                >
                  {loadingMoreMovements ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text style={styles.loadMoreText}>Muat Riwayat Lainnya</Text>
                  )}
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      )}
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
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    codeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent, letterSpacing: 0.5 },
    nameText: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
    categoryText: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill },
    statusOk: { backgroundColor: colors.successBg },
    statusLow: { backgroundColor: colors.dangerBg },
    statusText: { fontSize: fontSize.sm, fontWeight: '700' },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    infoText: { fontSize: fontSize.xs, fontWeight: '600' },
    actionRow: { flexDirection: 'row', gap: spacing.sm },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      height: 52,
      borderRadius: radius.pill,
    },
    actionIn: { backgroundColor: colors.success },
    actionOut: { backgroundColor: colors.danger },
    actionButtonText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '700' },
    formTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    fieldLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs },
    input: {
      height: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    errorText: { fontSize: fontSize.sm, color: colors.danger, marginTop: spacing.xs },
    helperInline: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: -spacing.xs, marginBottom: spacing.sm },
    formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    cancelButton: { paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
    cancelButtonText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
    historyTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
    emptyHistoryText: { fontSize: fontSize.sm, color: colors.textMuted },
    loadMoreButton: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
    loadMoreText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.accent },
    historyRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    historyText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    historyNote: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    historyDate: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  });
}
