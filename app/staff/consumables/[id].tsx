import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, RefreshControl, KeyboardAvoidingView } from 'react-native';
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
  store?: { id: number; name: string } | null;
  reversed_at?: string | null;
  reversed_reason?: string | null;
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
  adjustment_note_threshold: string | null;
  movements: Movement[];
}

interface ShowResponse {
  data: ConsumableData;
  movements_has_more: boolean;
  can_modify?: boolean;
  write_off_reasons?: Record<string, string> | null;
  pending_purchase?: { request_number: string; quantity: string; unit: string } | null;
  card?: { preferred_supplier: string | null } | null;
  restock?: {
    open_request: { request_number: string; status: string } | null;
    can_request: boolean;
    suggested_quantity: number | null;
  } | null;
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
  // Akun yang hanya boleh melihat stok tidak diberi tombol catat/opname (server juga menolak).
  const [canModify, setCanModify] = useState(false);

  // "Catat Terbuang": alasan datang dari server (sumber tunggal dengan panel).
  const [writeOffReasons, setWriteOffReasons] = useState<Record<string, string>>({});
  const [woForm, setWoForm] = useState<{ quantity: string; reason: string; note: string } | null>(null);
  const [woError, setWoError] = useState<string | null>(null);
  const [woSubmitting, setWoSubmitting] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState<ShowResponse['pending_purchase']>(null);
  const [card, setCard] = useState<ShowResponse['card']>(null);

  // "Minta Beli": permintaan beli untuk barang yang stoknya menipis (menunggu persetujuan di Permohonan Pembelian).
  const [restock, setRestock] = useState<ShowResponse['restock']>(null);
  const [rsForm, setRsForm] = useState<{ quantity: string; note: string } | null>(null);
  const [rsError, setRsError] = useState<string | null>(null);
  const [rsSubmitting, setRsSubmitting] = useState(false);
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
        setCanModify(res.can_modify === true);
        setWriteOffReasons(res.write_off_reasons ?? {});
        setPendingPurchase(res.pending_purchase ?? null);
        setCard(res.card ?? null);
        setRestock(res.restock ?? null);
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
          setFormError(err instanceof ApiError ? err.message : 'Gagal mencatat transaksi. Periksa koneksi internet.');
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

  const handleRestock = () => {
    if (!rsForm) return;

    const quantity = parseFloat(rsForm.quantity.replace(',', '.'));
    if (!quantity || quantity <= 0) {
      setRsError('Isi jumlah yang valid (lebih dari 0).');
      return;
    }

    setRsSubmitting(true);
    setRsError(null);

    staffApiFetch<{ message: string }>(`/api/staff/consumables/${id}/restock-request`, {
      method: 'POST',
      body: JSON.stringify({ quantity, note: rsForm.note.trim() || undefined }),
    })
      .then((res) => {
        hapticSuccess();
        fetchItem();
        setRsForm(null);
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        hapticError();
        setRsError(err instanceof ApiError ? err.message : 'Gagal mengajukan permintaan beli. Periksa koneksi internet.');
      })
      .finally(() => setRsSubmitting(false));
  };

  const handleWriteOff = () => {
    if (!woForm) return;

    const quantity = parseFloat(woForm.quantity.replace(',', '.'));
    if (!quantity || quantity <= 0) {
      setWoError('Isi jumlah yang valid (lebih dari 0).');
      return;
    }
    if (!woForm.reason) {
      setWoError('Pilih alasan stok terbuang.');
      return;
    }
    // Hilang dan Lainnya wajib diberi catatan supaya bisa ditelusuri (sama dengan aturan server).
    if ((woForm.reason === 'lost' || woForm.reason === 'other') && woForm.note.trim() === '') {
      setWoError('Isi catatan: alasan ini wajib dijelaskan.');
      return;
    }

    const submit = () => {
      setWoSubmitting(true);
      setWoError(null);

      staffApiFetch<{ message: string }>(`/api/staff/consumables/${id}/write-off`, {
        method: 'POST',
        body: JSON.stringify({ quantity, reason: woForm.reason, note: woForm.note.trim() || undefined }),
      })
        .then((res) => {
          hapticSuccess();
          fetchItem();
          setWoForm(null);
          Alert.alert('Berhasil', res.message);
        })
        .catch((err) => {
          hapticError();
          setWoError(err instanceof ApiError ? err.message : 'Gagal mencatat stok terbuang. Periksa koneksi internet.');
        })
        .finally(() => setWoSubmitting(false));
    };

    Alert.alert(
      'Catat Stok Terbuang',
      `Buang ${quantity.toLocaleString('id-ID')} ${item?.unit ?? ''} dari stok (${writeOffReasons[woForm.reason] ?? woForm.reason})? Ini tercatat sebagai kerugian.`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Catat', style: 'destructive', onPress: submit },
      ]
    );
  };

  const handleAdjustStock = () => {
    const actualQuantity = parseFloat(adjustQuantity.replace(',', '.'));
    if (adjustQuantity.trim() === '' || isNaN(actualQuantity) || actualQuantity < 0) {
      setAdjustError('Isi hasil hitung fisik yang valid (0 atau lebih).');
      return;
    }

    // Selisih di atas batas barang ini wajib punya catatan (batas diatur per barang di panel; kosong = tidak ada aturan).
    const noteLimit = item?.adjustment_note_threshold ? parseFloat(item.adjustment_note_threshold) : null;
    if (item && noteLimit !== null && Math.abs(actualQuantity - parseFloat(item.current_stock)) > noteLimit && adjustNote.trim() === '') {
      setAdjustError(`Selisih melebihi ${noteLimit.toLocaleString('id-ID')} ${item.unit} untuk barang ini. Isi catatan alasan selisih.`);
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
          // Muat ulang (bukan setItem(res.data)) supaya riwayat tambahan dari "Muat Riwayat Lainnya" tidak tampil ganda.
          fetchItem();
          setAdjustFormOpen(false);
          setAdjustQuantity('');
          setAdjustNote('');
          Alert.alert('Berhasil', res.message);
        })
        .catch((err) => {
          hapticError();
          setAdjustError(err instanceof ApiError ? err.message : 'Gagal mencatat penyesuaian. Periksa koneksi internet.');
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
      `Stok sistem: ${currentStock.toLocaleString('id-ID')} ${item?.unit ?? ''}. Ubah jadi ${actualQuantity.toLocaleString('id-ID')} ${item?.unit ?? ''} sesuai hitung fisik?`,
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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
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
            {item.reorder_point !== null && (
              <View style={styles.infoRow}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.textMuted} />
                <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                  Ambang menipis: {parseFloat(item.reorder_point).toLocaleString('id-ID')} {item.unit}
                </Text>
              </View>
            )}
            {card?.preferred_supplier ? (
              <View style={styles.infoRow}>
                <Ionicons name="business-outline" size={16} color={colors.textMuted} />
                <Text style={[styles.infoText, { color: colors.textSecondary }]}>Pemasok utama: {card.preferred_supplier}</Text>
              </View>
            ) : null}
            {restock?.open_request && (
              <View style={styles.infoRow}>
                <Ionicons name="cart-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.infoText, { color: colors.textSecondary, flex: 1 }]}>
                  Permintaan beli {restock.open_request.request_number} ({restock.open_request.status === 'approved' ? 'disetujui' : 'menunggu persetujuan'})
                </Text>
              </View>
            )}
            {canModify && pendingPurchase && (
              <View style={styles.infoRow}>
                <Ionicons name="cart-outline" size={16} color={colors.warning} />
                <Text style={[styles.infoText, { color: colors.warning, flex: 1 }]}>
                  Ada permohonan pembelian disetujui ({pendingPurchase.request_number}, {parseFloat(pendingPurchase.quantity).toLocaleString('id-ID')} {pendingPurchase.unit}).
                  Kalau ini kirimannya, minta admin menandainya Terpenuhi di panel (stok ikut bertambah) agar tidak dicatat dua kali.
                </Text>
              </View>
            )}
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
          ) : canModify ? (
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
          ) : null}

          {!canModify && (
            <Text style={styles.emptyHistoryText}>Akun ini hanya bisa melihat stok. Minta admin membuka izin Ubah untuk mencatat barang masuk/keluar.</Text>
          )}

          {canModify && !form && item && (
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

                <Text style={styles.fieldLabel}>
                  {item.adjustment_note_threshold
                    ? `Catatan (wajib kalau selisih lebih dari ${parseFloat(item.adjustment_note_threshold).toLocaleString('id-ID')} ${item.unit})`
                    : 'Catatan (opsional)'}
                </Text>
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

          {canModify && !form && !adjustFormOpen && Object.keys(writeOffReasons).length > 0 && (
            woForm ? (
              <View style={styles.card}>
                <Text style={styles.formTitle}>Catat Stok Terbuang</Text>

                <Text style={styles.fieldLabel}>Alasan</Text>
                <View style={styles.reasonRow}>
                  {Object.entries(writeOffReasons).map(([key, label]) => (
                    <Pressable
                      key={key}
                      style={[styles.reasonChip, woForm.reason === key && styles.reasonChipActive]}
                      onPress={() => setWoForm((f) => f && { ...f, reason: key })}
                    >
                      <Text style={[styles.reasonChipText, woForm.reason === key && { color: colors.accent }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Jumlah Terbuang ({item.unit})</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  value={woForm.quantity}
                  onChangeText={(v) => setWoForm((f) => f && { ...f, quantity: v })}
                  keyboardType="decimal-pad"
                  autoFocus
                />
                <Text style={styles.helperInline}>
                  Stok saat ini: {parseFloat(item.current_stock).toLocaleString('id-ID')} {item.unit}.
                </Text>

                <Text style={styles.fieldLabel}>{woForm.reason === 'lost' || woForm.reason === 'other' ? 'Catatan (wajib untuk alasan ini)' : 'Catatan (opsional)'}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Mis. patah saat dipakai, hilang di lokasi"
                  placeholderTextColor={colors.textMuted}
                  value={woForm.note}
                  onChangeText={(v) => setWoForm((f) => f && { ...f, note: v })}
                />

                {woError && <Text style={styles.errorText}>{woError}</Text>}
                <View style={styles.formActions}>
                  <Pressable style={styles.cancelButton} onPress={() => { setWoForm(null); setWoError(null); }} disabled={woSubmitting}>
                    <Text style={styles.cancelButtonText}>Batal</Text>
                  </Pressable>
                  <Button
                    label={woSubmitting ? 'Menyimpan...' : 'Simpan'}
                    onPress={handleWriteOff}
                    loading={woSubmitting}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : (
              <Button label="Catat Terbuang (Rusak/Hilang)" variant="outline" onPress={() => { setWoForm({ quantity: '', reason: '', note: '' }); setWoError(null); }} />
            )
          )}

          {!form && !adjustFormOpen && !woForm && restock?.can_request && (
            rsForm ? (
              <View style={styles.card}>
                <Text style={styles.formTitle}>Minta Beli</Text>
                <Text style={styles.helperInline}>
                  Permintaan menunggu persetujuan di menu Permohonan Pembelian. Jumlah awal adalah selisih ambang menipis dan stok saat ini.
                </Text>

                <Text style={styles.fieldLabel}>Jumlah yang diminta ({item.unit})</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  value={rsForm.quantity}
                  onChangeText={(v) => setRsForm((f) => f && { ...f, quantity: v })}
                  keyboardType="decimal-pad"
                  autoFocus
                />

                <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Mis. dipakai untuk pekerjaan minggu ini"
                  placeholderTextColor={colors.textMuted}
                  value={rsForm.note}
                  onChangeText={(v) => setRsForm((f) => f && { ...f, note: v })}
                />

                {rsError && <Text style={styles.errorText}>{rsError}</Text>}
                <View style={styles.formActions}>
                  <Pressable style={styles.cancelButton} onPress={() => { setRsForm(null); setRsError(null); }} disabled={rsSubmitting}>
                    <Text style={styles.cancelButtonText}>Batal</Text>
                  </Pressable>
                  <Button
                    label={rsSubmitting ? 'Mengirim...' : 'Ajukan'}
                    onPress={handleRestock}
                    loading={rsSubmitting}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : (
              <Button
                label="Minta Beli"
                variant="outline"
                onPress={() => {
                  setRsForm({ quantity: restock.suggested_quantity !== null ? String(restock.suggested_quantity) : '', note: '' });
                  setRsError(null);
                }}
              />
            )
          )}

          <Text style={styles.historyTitle}>Riwayat Terbaru</Text>
          {item.movements.length === 0 ? (
            <Text style={styles.emptyHistoryText}>Belum ada riwayat keluar/masuk untuk barang ini.</Text>
          ) : (
            <>
              {[...item.movements, ...extraMovements].map((m) => (
                <View key={m.id} style={[styles.historyRow, m.reversed_at ? { opacity: 0.55 } : null]}>
                  <Ionicons
                    name={m.type === 'in' ? 'arrow-down-circle' : m.type === 'out' ? 'arrow-up-circle' : m.type === 'correction' ? 'arrow-undo-circle' : 'swap-vertical'}
                    size={20}
                    color={m.type === 'in' ? colors.success : m.type === 'out' ? colors.danger : m.type === 'correction' ? colors.textMuted : colors.warning}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.historyText, m.reversed_at ? { textDecorationLine: 'line-through' } : null]}>
                      {movementLabel(m.type)} {parseFloat(m.quantity) > 0 && m.type === 'adjustment' ? '+' : ''}
                      {parseFloat(m.quantity).toLocaleString('id-ID')} {item.unit}
                      {m.user ? ` — ${m.user.name}` : ''}
                      {m.store ? ` (${m.store.name})` : ''}
                    </Text>
                    {m.reversed_at ? (
                      <Text style={[styles.historyNote, { color: colors.danger, fontWeight: '600' }]}>Dibatalkan{m.reversed_reason ? `: ${m.reversed_reason}` : ''}</Text>
                    ) : null}
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
      </KeyboardAvoidingView>
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
    reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
    reasonChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    reasonChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft ?? colors.surface },
    reasonChipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },    actionButton: {
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
