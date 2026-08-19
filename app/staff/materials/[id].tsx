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
  type: 'in' | 'out' | 'adjustment';
  quantity: string;
  note: string | null;
  user: { id: number; name: string } | null;
  created_at: string;
}

interface Batch {
  id: number;
  quantity: string;
  received_date: string;
  expiry_date: string | null;
  is_adjustment: boolean;
}

interface MaterialData {
  id: number;
  name: string;
  code: string | null;
  category: string | null;
  unit: string;
  current_stock: string;
  reorder_point: string | null;
  movements: Movement[];
  batches: Batch[];
  active_batches_count: number;
}

type MovementForm = { type: 'in' | 'out'; quantity: string; containerCount: string; note: string; receivedDate: string; expiryDate: string } | null;

// DD/MM/YYYY — sama format dengan template import Excel. Kosong = valid
// (artinya pakai default backend: hari ini / tanpa kedaluwarsa).
function parseDDMMYYYY(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return 'invalid';

  const [, d, m, y] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const valid = date.getFullYear() === Number(y) && date.getMonth() === Number(m) - 1 && date.getDate() === Number(d);

  return valid ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : 'invalid';
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function isExpired(dateString: string): boolean {
  return new Date(dateString) < new Date(new Date().toDateString());
}

function isNearExpiry(dateString: string): boolean {
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  return new Date(dateString) <= in30Days;
}

function movementLabel(type: Movement['type']): string {
  if (type === 'in') return 'Masuk';
  if (type === 'out') return 'Keluar';
  return 'Penyesuaian';
}

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [material, setMaterial] = useState<MaterialData | null>(null);
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

  const fetchMaterial = useCallback(() => {
    setError(null);
    return staffApiFetch<{ data: MaterialData }>(`/api/staff/materials/${id}`)
      .then((res) => setMaterial(res.data))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Bahan baku tidak ditemukan atau koneksi bermasalah.');
      });
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchMaterial().finally(() => setLoading(false));
  }, [fetchMaterial]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMaterial();
    setRefreshing(false);
  }, [fetchMaterial]);

  const openForm = (type: 'in' | 'out') => {
    setForm({ type, quantity: '', containerCount: '1', note: '', receivedDate: '', expiryDate: '' });
    setFormError(null);
  };

  const handleSubmitMovement = () => {
    if (!form) return;

    const quantity = parseFloat(form.quantity.replace(',', '.'));
    if (!quantity || quantity <= 0) {
      setFormError('Isi jumlah yang valid (lebih dari 0).');
      return;
    }

    const containerCount = form.type === 'in' ? parseInt(form.containerCount || '1', 10) : 1;
    if (form.type === 'in' && (!containerCount || containerCount < 1)) {
      setFormError('Isi Jumlah Botol/Wadah minimal 1.');
      return;
    }

    const receivedDate = form.type === 'in' ? parseDDMMYYYY(form.receivedDate) : null;
    const expiryDate = form.type === 'in' ? parseDDMMYYYY(form.expiryDate) : null;

    if (receivedDate === 'invalid') {
      setFormError('Format Tanggal Masuk harus DD/MM/YYYY, mis. 14/08/2026.');
      return;
    }
    if (expiryDate === 'invalid') {
      setFormError('Format Tanggal Kedaluwarsa harus DD/MM/YYYY, mis. 14/08/2026.');
      return;
    }

    const submit = () => {
      setSubmitting(true);
      setFormError(null);

      staffApiFetch<{ message: string; data: MaterialData }>(`/api/staff/materials/${id}/movement`, {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          quantity,
          container_count: form.type === 'in' ? containerCount : undefined,
          note: form.note.trim() || undefined,
          received_date: receivedDate ?? undefined,
          expiry_date: expiryDate ?? undefined,
        }),
      })
        .then((res) => {
          hapticSuccess();
          fetchMaterial();
          setForm(null);
          Alert.alert('Berhasil', res.message);
        })
        .catch((err) => {
          hapticError();
          setFormError(err instanceof ApiError ? err.message : 'Gagal mencatat transaksi. Periksa koneksi internet Anda.');
        })
        .finally(() => setSubmitting(false));
    };

    // Catat Keluar mengurangi stok asli — minta konfirmasi dulu. Catat
    // Masuk tidak perlu (menambah stok, gampang dikoreksi kalau salah).
    if (form.type === 'out') {
      Alert.alert(
        'Catat Bahan Keluar',
        `Catat ${quantity.toLocaleString('id-ID')} ${material?.unit ?? ''} keluar dari stok?`,
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

      staffApiFetch<{ message: string; data: MaterialData }>(`/api/staff/materials/${id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ actual_quantity: actualQuantity, note: adjustNote.trim() || undefined }),
      })
        .then((res) => {
          hapticSuccess();
          setMaterial(res.data);
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
    const currentStock = material ? parseFloat(material.current_stock) : 0;
    if (Math.abs(actualQuantity - currentStock) < 0.01) {
      submit();
      return;
    }

    Alert.alert(
      'Sesuaikan Stok',
      `Stok di sistem saat ini: ${currentStock.toLocaleString('id-ID')} ${material?.unit ?? ''}. Timpa jadi ${actualQuantity.toLocaleString('id-ID')} ${material?.unit ?? ''} berdasarkan hitung fisik?`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Sesuaikan', style: 'destructive', onPress: submit },
      ]
    );
  };

  const isLowStock = material?.reorder_point !== null && material
    ? parseFloat(material.current_stock) <= parseFloat(material.reorder_point ?? '0')
    : false;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Detail Bahan Baku</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerStateText}>Memuat data bahan baku...</Text>
        </View>
      ) : error || !material ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error ?? 'Bahan baku tidak ditemukan.'}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        >
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                {material.code && <Text style={styles.codeText}>{material.code}</Text>}
                <Text style={styles.nameText}>{material.name}</Text>
                {material.category && <Text style={styles.categoryText}>{material.category}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={[styles.statusBadge, isLowStock ? styles.statusLow : styles.statusOk]}>
                  <Text style={[styles.statusText, { color: isLowStock ? colors.danger : colors.success }]}>
                    {parseFloat(material.current_stock).toLocaleString('id-ID')} {material.unit}
                  </Text>
                </View>
                <Text style={styles.categoryText}>{material.active_batches_count} botol/wadah</Text>
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
                {form.type === 'in' ? 'Catat Bahan Masuk' : 'Catat Bahan Keluar'}
              </Text>

              {form.type === 'in' && (
                <>
                  <Text style={styles.fieldLabel}>Jumlah Botol/Wadah</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="1"
                    placeholderTextColor={colors.textMuted}
                    value={form.containerCount}
                    onChangeText={(v) => setForm((f) => f && { ...f, containerCount: v })}
                    keyboardType="number-pad"
                  />
                </>
              )}

              <Text style={styles.fieldLabel}>
                {form.type === 'in' ? `Jumlah Total, Semua Botol/Wadah (${material.unit})` : `Jumlah (${material.unit})`}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                value={form.quantity}
                onChangeText={(v) => setForm((f) => f && { ...f, quantity: v })}
                keyboardType="decimal-pad"
                autoFocus
              />
              {form.type === 'in' && parseInt(form.containerCount || '1', 10) > 1 && parseFloat(form.quantity.replace(',', '.')) > 0 && (
                <Text style={styles.helperInline}>
                  Otomatis dibagi rata: ±{(parseFloat(form.quantity.replace(',', '.')) / parseInt(form.containerCount || '1', 10)).toFixed(2)} per botol/wadah.
                </Text>
              )}

              {form.type === 'in' && (
                <>
                  <Text style={styles.fieldLabel}>Tanggal Masuk Batch Ini (opsional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="DD/MM/YYYY — kosong = hari ini"
                    placeholderTextColor={colors.textMuted}
                    value={form.receivedDate}
                    onChangeText={(v) => setForm((f) => f && { ...f, receivedDate: v })}
                    keyboardType="numbers-and-punctuation"
                  />

                  <Text style={styles.fieldLabel}>Tanggal Kedaluwarsa Batch Ini (opsional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="DD/MM/YYYY — kosong = tidak ada"
                    placeholderTextColor={colors.textMuted}
                    value={form.expiryDate}
                    onChangeText={(v) => setForm((f) => f && { ...f, expiryDate: v })}
                    keyboardType="numbers-and-punctuation"
                  />
                </>
              )}

              <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Mis. nomor PO, nama supplier, dipakai untuk apa"
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

          {!form && (
            adjustFormOpen ? (
              <View style={styles.card}>
                <Text style={styles.formTitle}>Sesuaikan Stok (Opname)</Text>
                <Text style={styles.fieldLabel}>Hasil Hitung Fisik Sebenarnya ({material.unit})</Text>
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
                  Stok di sistem saat ini: {parseFloat(material.current_stock).toLocaleString('id-ID')} {material.unit}. Isi jumlah hasil hitung fisik yang SEBENARNYA — selisihnya dihitung otomatis.
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

          {material.batches.length > 0 && (
            <>
              <Text style={styles.historyTitle}>Sisa Batch (FIFO)</Text>
              {material.batches.map((b) => {
                const expired = b.expiry_date ? isExpired(b.expiry_date) : false;
                const nearExpiry = b.expiry_date ? isNearExpiry(b.expiry_date) : false;
                return (
                  <View key={b.id} style={styles.batchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.batchQuantity}>
                        {parseFloat(b.quantity).toLocaleString('id-ID')} {material.unit}
                      </Text>
                      <Text style={styles.historyDate}>
                        Masuk {formatDate(b.received_date)}
                        {b.is_adjustment ? ' · Dari penyesuaian stok' : ''}
                      </Text>
                    </View>
                    {b.expiry_date && (
                      <View style={[styles.expiryBadge, expired ? styles.expiryDanger : nearExpiry ? styles.expiryWarning : styles.expiryNeutral]}>
                        <Text style={[styles.expiryText, { color: expired ? colors.danger : nearExpiry ? colors.warning : colors.textSecondary }]}>
                          {expired ? 'Lewat' : 'Exp'} {formatDate(b.expiry_date)}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          <Text style={styles.historyTitle}>Riwayat Terbaru</Text>
          {material.movements.length === 0 ? (
            <Text style={styles.emptyHistoryText}>Belum ada riwayat keluar/masuk untuk bahan ini.</Text>
          ) : (
            material.movements.map((m) => (
              <View key={m.id} style={styles.historyRow}>
                <Ionicons
                  name={m.type === 'in' ? 'arrow-down-circle' : m.type === 'out' ? 'arrow-up-circle' : 'swap-vertical'}
                  size={20}
                  color={m.type === 'in' ? colors.success : m.type === 'out' ? colors.danger : colors.warning}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyText}>
                    {movementLabel(m.type)} {parseFloat(m.quantity) > 0 && m.type === 'adjustment' ? '+' : ''}
                    {parseFloat(m.quantity).toLocaleString('id-ID')} {material.unit}
                    {m.user ? ` — ${m.user.name}` : ''}
                  </Text>
                  {m.note && <Text style={styles.historyNote}>{m.note}</Text>}
                  <Text style={styles.historyDate}>{formatDateTime(m.created_at)}</Text>
                </View>
              </View>
            ))
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
    batchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    batchQuantity: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    expiryBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
    expiryNeutral: { backgroundColor: colors.border },
    expiryWarning: { backgroundColor: colors.warningBg },
    expiryDanger: { backgroundColor: colors.dangerBg },
    expiryText: { fontSize: fontSize.xs, fontWeight: '700' },
    emptyHistoryText: { fontSize: fontSize.sm, color: colors.textMuted },
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
