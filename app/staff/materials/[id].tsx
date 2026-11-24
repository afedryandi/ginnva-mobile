import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, RefreshControl, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import DateField, { todayKey } from '@/components/ui/DateField';
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
  purchase_unit: string | null;
  purchase_conversion_factor: string | null;
  current_stock: string;
  reorder_point: string | null;
  // Kelipatan pengambilan (mis. 250 ml): bila diisi, bahan keluar dicatat dengan tombol + dan -. Opsional: server lama belum mengirimnya.
  withdrawal_multiple?: string | null;
  adjustment_note_threshold: string | null;
  movements: Movement[];
  batches: Batch[];
}

interface ShowResponse {
  data: MaterialData;
  movements_has_more: boolean;
  can_modify?: boolean;
  write_off_reasons?: Record<string, string> | null;
  pending_purchase?: { request_number: string; quantity: string; unit: string } | null;
  card?: { preferred_supplier: string | null; nearest_expiry_date: string | null } | null;
  restock?: {
    open_request: { request_number: string; status: string } | null;
    can_request: boolean;
    suggested_quantity: number | null;
  } | null;
}

// Tanggal berformat YYYY-MM-DD; string kosong = pakai default server (masuk: hari ini, kedaluwarsa: tidak ada).
// usePurchaseUnit: jumlah diketik dalam Satuan Beli (mis. Galon) dan dikonversi ke satuan dasar sebelum dikirim.
type MovementForm = { type: 'in' | 'out'; quantity: string; note: string; receivedDate: string; expiryDate: string; usePurchaseUnit: boolean } | null;

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
  if (type === 'correction') return 'Koreksi';
  return 'Penyesuaian';
}

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [material, setMaterial] = useState<MaterialData | null>(null);
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

  // "Minta Beli": permintaan beli untuk bahan yang stoknya menipis (menunggu persetujuan di Permohonan Pembelian).
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

  // "Muat Riwayat Lainnya" — sama pola dengan consumables/[id].tsx dan
  // inventory/[code].tsx. SEBELUMNYA satu-satunya dari 3 modul movement
  // yang belum punya paginasi riwayat di mobile.
  const [extraMovements, setExtraMovements] = useState<Movement[]>([]);
  const [hasMoreMovements, setHasMoreMovements] = useState(false);
  const [loadingMoreMovements, setLoadingMoreMovements] = useState(false);

  const fetchMaterial = useCallback(() => {
    setError(null);
    return staffApiFetch<ShowResponse>(`/api/staff/materials/${id}`)
      .then((res) => {
        setMaterial(res.data);
        setCanModify(res.can_modify === true);
        setWriteOffReasons(res.write_off_reasons ?? {});
        setPendingPurchase(res.pending_purchase ?? null);
        setCard(res.card ?? null);
        setRestock(res.restock ?? null);
        setExtraMovements([]);
        setHasMoreMovements(res.movements_has_more);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Bahan baku tidak ditemukan atau koneksi bermasalah.');
      });
  }, [id]);

  const loadMoreMovements = useCallback(() => {
    if (!material) return;

    setLoadingMoreMovements(true);
    staffApiFetch<{ data: Movement[]; has_more: boolean }>(
      `/api/staff/materials/${id}/movements?offset=${material.movements.length + extraMovements.length}`
    )
      .then((res) => {
        setExtraMovements((prev) => [...prev, ...res.data]);
        setHasMoreMovements(res.has_more);
      })
      .catch(() => hapticError())
      .finally(() => setLoadingMoreMovements(false));
  }, [id, material, extraMovements.length]);

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
    const multiple = type === 'out' ? parseFloat(material?.withdrawal_multiple ?? '') : NaN;
    setForm({ type, quantity: multiple > 0 ? String(multiple) : '', note: '', receivedDate: '', expiryDate: '', usePurchaseUnit: false });
    setFormError(null);
  };

  // Langkah tombol + dan -: tambah atau kurangi sebesar kelipatan; tidak kurang dari satu kelipatan dan tidak melebihi stok.
  const stepQuantity = (direction: 1 | -1) => {
    const multiple = parseFloat(material?.withdrawal_multiple ?? '');
    if (!form || !(multiple > 0)) return;
    const current = parseFloat(form.quantity.replace(',', '.')) || 0;
    const stock = parseFloat(material?.current_stock ?? '0') || 0;
    const next = Math.round((current + direction * multiple) * 10000) / 10000;
    if (next < multiple || next > stock + 1e-9) return;
    setForm((f) => f && { ...f, quantity: String(next) });
  };

  const handleSubmitMovement = () => {
    if (!form) return;

    const entered = parseFloat(form.quantity.replace(',', '.'));
    if (!entered || entered <= 0) {
      setFormError('Isi jumlah yang valid (lebih dari 0).');
      return;
    }

    // Satuan Beli -> satuan dasar (sama dengan RawMaterial::convertPurchaseToBaseUnit di server).
    const factor = material?.purchase_conversion_factor ? parseFloat(material.purchase_conversion_factor) : 0;
    const quantity = form.type === 'in' && form.usePurchaseUnit && factor > 0 ? Math.round(entered * factor * 10000) / 10000 : entered;

    const receivedDate = form.type === 'in' && form.receivedDate ? form.receivedDate : null;
    const expiryDate = form.type === 'in' && form.expiryDate ? form.expiryDate : null;

    if (expiryDate && expiryDate < (receivedDate ?? todayKey())) {
      setFormError('Tanggal kedaluwarsa tidak boleh lebih awal dari tanggal masuk.');
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
          setFormError(err instanceof ApiError ? err.message : 'Gagal mencatat transaksi. Periksa koneksi internet.');
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

    // Batch yang sudah kedaluwarsa saat dicatat hampir pasti salah ketik tanggal: minta konfirmasi dulu.
    if (expiryDate && expiryDate < todayKey()) {
      Alert.alert(
        'Sudah Kedaluwarsa',
        'Tanggal kedaluwarsa yang dipilih sudah lewat. Tetap catat bahan masuk ini?',
        [
          { text: 'Periksa Lagi', style: 'cancel' },
          { text: 'Tetap Catat', onPress: submit },
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

    // Selisih di atas batas bahan ini wajib punya catatan (batas diatur per bahan di panel; kosong = tidak ada aturan).
    const noteLimit = material?.adjustment_note_threshold ? parseFloat(material.adjustment_note_threshold) : null;
    if (material && noteLimit !== null && Math.abs(actualQuantity - parseFloat(material.current_stock)) > noteLimit && adjustNote.trim() === '') {
      setAdjustError(`Selisih melebihi ${noteLimit.toLocaleString('id-ID')} ${material.unit} untuk bahan ini. Isi catatan alasan selisih.`);
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
          // Muat ulang (bukan setMaterial(res.data)) supaya riwayat tambahan dari "Muat Riwayat Lainnya" tidak tampil ganda.
          fetchMaterial();
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
    const currentStock = material ? parseFloat(material.current_stock) : 0;
    if (Math.abs(actualQuantity - currentStock) < 0.01) {
      submit();
      return;
    }

    Alert.alert(
      'Sesuaikan Stok',
      `Stok sistem: ${currentStock.toLocaleString('id-ID')} ${material?.unit ?? ''}. Ubah jadi ${actualQuantity.toLocaleString('id-ID')} ${material?.unit ?? ''} sesuai hitung fisik?`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Sesuaikan', style: 'destructive', onPress: submit },
      ]
    );
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

    staffApiFetch<{ message: string }>(`/api/staff/materials/${id}/restock-request`, {
      method: 'POST',
      body: JSON.stringify({ quantity, note: rsForm.note.trim() || undefined }),
    })
      .then((res) => {
        hapticSuccess();
        fetchMaterial();
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

      staffApiFetch<{ message: string }>(`/api/staff/materials/${id}/write-off`, {
        method: 'POST',
        body: JSON.stringify({ quantity, reason: woForm.reason, note: woForm.note.trim() || undefined }),
      })
        .then((res) => {
          hapticSuccess();
          fetchMaterial();
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
      `Buang ${quantity.toLocaleString('id-ID')} ${material?.unit ?? ''} dari stok (${writeOffReasons[woForm.reason] ?? woForm.reason})? Ini tercatat sebagai kerugian.`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Catat', style: 'destructive', onPress: submit },
      ]
    );
  };

  const isLowStock = material?.reorder_point !== null && material
    ? parseFloat(material.current_stock) <= parseFloat(material.reorder_point ?? '0')
    : false;

  const showFooterActions = !!material && canModify && !form && !adjustFormOpen && !woForm && !rsForm;
  const neutralBg = isDark ? colors.surfaceElevated : '#efeff4';
  const movementTone = (t: Movement['type']) =>
    t === 'in'
      ? { fg: colors.success, bg: colors.successBg, icon: 'arrow-down' as const }
      : t === 'out'
        ? { fg: colors.danger, bg: colors.dangerBg, icon: 'arrow-up' as const }
        : t === 'correction'
          ? { fg: colors.textSecondary, bg: neutralBg, icon: 'arrow-undo' as const }
          : { fg: colors.warning, bg: colors.warningBg, icon: 'swap-vertical' as const };

  const saveButton = (label: string, busy: boolean, onPress: () => void) => (
    <PressableScale style={[styles.primaryButton, { flex: 1 }, busy && styles.disabled]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </PressableScale>
  );
  const cancelButton = (onPress: () => void, disabled: boolean) => (
    <PressableScale style={styles.cancelButton} onPress={onPress} disabled={disabled}>
      <Text style={styles.cancelButtonText}>Batal</Text>
    </PressableScale>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <StatusBar style={isDark ? 'light' : 'dark'} />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>Detail Bahan</Text>
            {material?.code ? <Text style={styles.subtitle} numberOfLines={1}>{material.code}</Text> : null}
          </View>
        </View>

        {loading ? (
          <SkeletonCards count={3} />
        ) : error || !material ? (
          <View style={styles.centerState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="alert-circle-outline" size={34} color={colors.danger} />
            </View>
            <Text style={styles.emptyTitle}>Bahan tidak bisa dibuka</Text>
            <Text style={styles.centerStateText}>{error ?? 'Bahan baku tidak ditemukan.'}</Text>
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            >
              <FadeInUp style={styles.scrollInner}>
                {/* Hero: nama, jumlah stok yang menonjol, dan status aman atau menipis. */}
                <View style={styles.card}>
                  <View style={styles.heroTop}>
                    {material.category ? (
                      <View style={styles.categoryPill}>
                        <Text style={styles.categoryPillText}>{material.category}</Text>
                      </View>
                    ) : <View />}
                    <View style={[styles.statusBadge, { backgroundColor: isLowStock ? colors.dangerBg : colors.successBg }]}>
                      <Ionicons name={isLowStock ? 'alert-circle' : 'checkmark-circle'} size={14} color={isLowStock ? colors.danger : colors.success} />
                      <Text style={[styles.statusText, { color: isLowStock ? colors.danger : colors.success }]}>{isLowStock ? 'Stok menipis' : 'Stok aman'}</Text>
                    </View>
                  </View>
                  <Text style={styles.nameText}>{material.name}</Text>
                  <View style={styles.stockRow}>
                    <Text style={[styles.stockValue, isLowStock && { color: colors.danger }]}>{parseFloat(material.current_stock).toLocaleString('id-ID')}</Text>
                    <Text style={styles.stockUnit}>{material.unit}</Text>
                  </View>

                  {material.reorder_point !== null || card?.preferred_supplier || card?.nearest_expiry_date || restock?.open_request || (canModify && pendingPurchase) ? (
                    <View style={styles.infoBox}>
                      {material.reorder_point !== null ? (
                        <View style={styles.infoRow}>
                          <Ionicons name="alert-circle-outline" size={16} color={colors.textMuted} />
                          <Text style={styles.infoText}>Ambang menipis {parseFloat(material.reorder_point).toLocaleString('id-ID')} {material.unit}</Text>
                        </View>
                      ) : null}
                      {card?.preferred_supplier ? (
                        <View style={styles.infoRow}>
                          <Ionicons name="business-outline" size={16} color={colors.textMuted} />
                          <Text style={styles.infoText}>Pemasok utama {card.preferred_supplier}</Text>
                        </View>
                      ) : null}
                      {card?.nearest_expiry_date ? (
                        <View style={styles.infoRow}>
                          <Ionicons
                            name="time-outline"
                            size={16}
                            color={isExpired(card.nearest_expiry_date) ? colors.danger : isNearExpiry(card.nearest_expiry_date) ? colors.warning : colors.textMuted}
                          />
                          <Text
                            style={[
                              styles.infoText,
                              isExpired(card.nearest_expiry_date) && { color: colors.danger },
                              !isExpired(card.nearest_expiry_date) && isNearExpiry(card.nearest_expiry_date) && { color: colors.warning },
                            ]}
                          >
                            Kedaluwarsa terdekat {formatDate(card.nearest_expiry_date)}
                            {isExpired(card.nearest_expiry_date) ? ' (sudah lewat)' : isNearExpiry(card.nearest_expiry_date) ? ' (segera)' : ''}
                          </Text>
                        </View>
                      ) : null}
                      {restock?.open_request ? (
                        <View style={styles.infoRow}>
                          <Ionicons name="cart-outline" size={16} color={colors.textMuted} />
                          <Text style={styles.infoText}>
                            Permintaan beli {restock.open_request.request_number} ({restock.open_request.status === 'approved' ? 'disetujui' : 'menunggu persetujuan'})
                          </Text>
                        </View>
                      ) : null}
                      {canModify && pendingPurchase ? (
                        <View style={styles.infoRow}>
                          <Ionicons name="cart-outline" size={16} color={colors.warning} />
                          <Text style={[styles.infoText, { color: colors.warning }]}>
                            Ada permohonan pembelian disetujui ({pendingPurchase.request_number}, {parseFloat(pendingPurchase.quantity).toLocaleString('id-ID')} {pendingPurchase.unit}).
                            Kalau ini kirimannya, minta admin menandainya Terpenuhi di panel (stok ikut bertambah) agar tidak dicatat dua kali.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>

                {!canModify ? (
                  <View style={styles.noticeBox}>
                    <Ionicons name="eye-outline" size={18} color={colors.textSecondary} />
                    <Text style={styles.noticeText}>Akun ini hanya bisa melihat stok. Minta admin membuka izin Ubah untuk mencatat bahan masuk/keluar.</Text>
                  </View>
                ) : null}

                {/* Form catat masuk/keluar */}
                {form ? (
                  <View style={styles.card}>
                    <Text style={styles.formTitle}>{form.type === 'in' ? 'Catat Bahan Masuk' : 'Catat Bahan Keluar'}</Text>

                    {form.type === 'in' && material.purchase_unit && material.purchase_conversion_factor ? (
                      <Pressable style={styles.toggleRow} onPress={() => setForm((f) => f && { ...f, usePurchaseUnit: !f.usePurchaseUnit })} accessibilityRole="checkbox" accessibilityState={{ checked: form.usePurchaseUnit }}>
                        <Ionicons name={form.usePurchaseUnit ? 'checkbox' : 'square-outline'} size={22} color={colors.accent} />
                        <Text style={styles.toggleText}>
                          Input dalam {material.purchase_unit} (1 {material.purchase_unit} = {parseFloat(material.purchase_conversion_factor).toLocaleString('id-ID')} {material.unit})
                        </Text>
                      </Pressable>
                    ) : null}

                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>
                        Jumlah ({form.type === 'in' && form.usePurchaseUnit && material.purchase_unit ? material.purchase_unit : material.unit})
                      </Text>
                      {form.type === 'out' && parseFloat(material.withdrawal_multiple ?? '') > 0 ? (
                        <>
                          <View style={styles.stepperRow}>
                            <Pressable
                              style={[styles.stepperBtn, (parseFloat(form.quantity.replace(',', '.')) || 0) - parseFloat(material.withdrawal_multiple ?? '0') < parseFloat(material.withdrawal_multiple ?? '0') && styles.stepperBtnOff]}
                              onPress={() => stepQuantity(-1)}
                              accessibilityRole="button"
                              accessibilityLabel="Kurangi satu kelipatan"
                            >
                              <Ionicons name="remove" size={26} color={colors.textPrimary} />
                            </Pressable>
                            <View style={styles.stepperValue}>
                              <Text style={styles.stepperNumber}>{(parseFloat(form.quantity.replace(',', '.')) || 0).toLocaleString('id-ID')}</Text>
                              <Text style={styles.stepperUnit}>{material.unit}</Text>
                            </View>
                            <Pressable
                              style={[styles.stepperBtn, (parseFloat(form.quantity.replace(',', '.')) || 0) + parseFloat(material.withdrawal_multiple ?? '0') > (parseFloat(material.current_stock) || 0) + 1e-9 && styles.stepperBtnOff]}
                              onPress={() => stepQuantity(1)}
                              accessibilityRole="button"
                              accessibilityLabel="Tambah satu kelipatan"
                            >
                              <Ionicons name="add" size={26} color={colors.textPrimary} />
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <TextInput
                          style={styles.input}
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                          value={form.quantity}
                          onChangeText={(v) => setForm((f) => f && { ...f, quantity: v })}
                          keyboardType="decimal-pad"
                          autoFocus
                        />
                      )}
                      {form.type === 'in' && form.usePurchaseUnit && material.purchase_conversion_factor && parseFloat(form.quantity.replace(',', '.')) > 0 ? (
                        <Text style={styles.helperText}>
                          = {(parseFloat(form.quantity.replace(',', '.')) * parseFloat(material.purchase_conversion_factor)).toLocaleString('id-ID')} {material.unit} yang dicatat ke stok
                        </Text>
                      ) : null}
                    </View>

                    {form.type === 'in' ? (
                      <>
                        <View style={styles.field}>
                          <Text style={styles.fieldLabel}>Tanggal masuk batch ini (opsional)</Text>
                          <DateField
                            value={form.receivedDate}
                            onChange={(v) => setForm((f) => f && { ...f, receivedDate: v, expiryDate: f.expiryDate && v && f.expiryDate < v ? '' : f.expiryDate })}
                            placeholder="Hari ini"
                            maxDate={todayKey()}
                            allowClear
                            colors={colors}
                          />
                        </View>
                        <View style={styles.field}>
                          <Text style={styles.fieldLabel}>Tanggal kedaluwarsa batch ini (opsional)</Text>
                          <DateField
                            value={form.expiryDate}
                            onChange={(v) => setForm((f) => f && { ...f, expiryDate: v })}
                            placeholder="Tidak ada"
                            minDate={form.receivedDate || undefined}
                            allowClear
                            colors={colors}
                          />
                        </View>
                      </>
                    ) : null}

                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Mis. nomor PO, nama supplier, dipakai untuk apa"
                        placeholderTextColor={colors.textMuted}
                        value={form.note}
                        onChangeText={(v) => setForm((f) => f && { ...f, note: v })}
                      />
                    </View>

                    {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
                    <View style={styles.formActions}>
                      {cancelButton(() => setForm(null), submitting)}
                      {saveButton(submitting ? 'Menyimpan...' : 'Simpan', submitting, handleSubmitMovement)}
                    </View>
                  </View>
                ) : null}

                {/* Sesuaikan stok (opname) */}
                {canModify && !form ? (
                  adjustFormOpen ? (
                    <View style={styles.card}>
                      <Text style={styles.formTitle}>Sesuaikan Stok (Opname)</Text>
                      <View style={styles.field}>
                        <Text style={styles.fieldLabel}>Hasil hitung fisik sebenarnya ({material.unit})</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                          value={adjustQuantity}
                          onChangeText={setAdjustQuantity}
                          keyboardType="decimal-pad"
                          autoFocus
                        />
                        <Text style={styles.helperText}>
                          Stok di sistem saat ini: {parseFloat(material.current_stock).toLocaleString('id-ID')} {material.unit}. Isi jumlah hasil hitung fisik yang SEBENARNYA — selisihnya dihitung otomatis.
                        </Text>
                      </View>

                      <View style={styles.field}>
                        <Text style={styles.fieldLabel}>
                          {material.adjustment_note_threshold
                            ? `Catatan (wajib kalau selisih lebih dari ${parseFloat(material.adjustment_note_threshold).toLocaleString('id-ID')} ${material.unit})`
                            : 'Catatan (opsional)'}
                        </Text>
                        <TextInput
                          style={styles.input}
                          placeholder="Mis. hasil stock opname, alasan selisih"
                          placeholderTextColor={colors.textMuted}
                          value={adjustNote}
                          onChangeText={setAdjustNote}
                        />
                      </View>

                      {adjustError ? <Text style={styles.errorText}>{adjustError}</Text> : null}
                      <View style={styles.formActions}>
                        {cancelButton(() => { setAdjustFormOpen(false); setAdjustQuantity(''); setAdjustNote(''); setAdjustError(null); }, adjustSubmitting)}
                        {saveButton(adjustSubmitting ? 'Menyimpan...' : 'Simpan', adjustSubmitting, handleAdjustStock)}
                      </View>
                    </View>
                  ) : (
                    <PressableScale style={styles.secondaryButton} onPress={() => setAdjustFormOpen(true)} accessibilityRole="button">
                      <Ionicons name="clipboard-outline" size={20} color={colors.textPrimary} />
                      <Text style={styles.secondaryButtonText}>Sesuaikan Stok (Opname)</Text>
                    </PressableScale>
                  )
                ) : null}

                {/* Catat terbuang */}
                {canModify && !form && !adjustFormOpen && Object.keys(writeOffReasons).length > 0 ? (
                  woForm ? (
                    <View style={styles.card}>
                      <Text style={styles.formTitle}>Catat Stok Terbuang</Text>

                      <View style={styles.field}>
                        <Text style={styles.fieldLabel}>Alasan</Text>
                        <View style={styles.reasonRow}>
                          {Object.entries(writeOffReasons).map(([key, label]) => (
                            <Pressable
                              key={key}
                              style={[styles.reasonChip, woForm.reason === key && styles.reasonChipActive]}
                              onPress={() => setWoForm((f) => f && { ...f, reason: key })}
                              accessibilityRole="button"
                            >
                              <Text style={[styles.reasonChipText, woForm.reason === key && styles.reasonChipTextActive]}>{label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>

                      <View style={styles.field}>
                        <Text style={styles.fieldLabel}>Jumlah terbuang ({material.unit})</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                          value={woForm.quantity}
                          onChangeText={(v) => setWoForm((f) => f && { ...f, quantity: v })}
                          keyboardType="decimal-pad"
                          autoFocus
                        />
                        <Text style={styles.helperText}>Stok saat ini: {parseFloat(material.current_stock).toLocaleString('id-ID')} {material.unit}.</Text>
                      </View>

                      <View style={styles.field}>
                        <Text style={styles.fieldLabel}>{woForm.reason === 'lost' || woForm.reason === 'other' ? 'Catatan (wajib untuk alasan ini)' : 'Catatan (opsional)'}</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="Mis. tumpah saat dipakai, botol pecah"
                          placeholderTextColor={colors.textMuted}
                          value={woForm.note}
                          onChangeText={(v) => setWoForm((f) => f && { ...f, note: v })}
                        />
                      </View>

                      {woError ? <Text style={styles.errorText}>{woError}</Text> : null}
                      <View style={styles.formActions}>
                        {cancelButton(() => { setWoForm(null); setWoError(null); }, woSubmitting)}
                        {saveButton(woSubmitting ? 'Menyimpan...' : 'Simpan', woSubmitting, handleWriteOff)}
                      </View>
                    </View>
                  ) : (
                    <PressableScale style={styles.secondaryButton} onPress={() => { setWoForm({ quantity: '', reason: '', note: '' }); setWoError(null); }} accessibilityRole="button">
                      <Ionicons name="trash-outline" size={20} color={colors.textPrimary} />
                      <Text style={styles.secondaryButtonText}>Catat Terbuang (Rusak/Hilang)</Text>
                    </PressableScale>
                  )
                ) : null}

                {/* Minta beli */}
                {!form && !adjustFormOpen && !woForm && restock?.can_request ? (
                  rsForm ? (
                    <View style={styles.card}>
                      <Text style={styles.formTitle}>Minta Beli</Text>
                      <Text style={styles.helperText}>
                        Permintaan menunggu persetujuan di menu Permohonan Pembelian. Jumlah awal adalah selisih ambang menipis dan stok saat ini.
                      </Text>

                      <View style={styles.field}>
                        <Text style={styles.fieldLabel}>Jumlah yang diminta ({material.unit})</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                          value={rsForm.quantity}
                          onChangeText={(v) => setRsForm((f) => f && { ...f, quantity: v })}
                          keyboardType="decimal-pad"
                          autoFocus
                        />
                      </View>

                      <View style={styles.field}>
                        <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="Mis. dipakai untuk pekerjaan minggu ini"
                          placeholderTextColor={colors.textMuted}
                          value={rsForm.note}
                          onChangeText={(v) => setRsForm((f) => f && { ...f, note: v })}
                        />
                      </View>

                      {rsError ? <Text style={styles.errorText}>{rsError}</Text> : null}
                      <View style={styles.formActions}>
                        {cancelButton(() => { setRsForm(null); setRsError(null); }, rsSubmitting)}
                        {saveButton(rsSubmitting ? 'Mengirim...' : 'Ajukan', rsSubmitting, handleRestock)}
                      </View>
                    </View>
                  ) : (
                    <PressableScale
                      style={styles.secondaryButton}
                      onPress={() => {
                        setRsForm({ quantity: restock.suggested_quantity !== null ? String(restock.suggested_quantity) : '', note: '' });
                        setRsError(null);
                      }}
                      accessibilityRole="button"
                    >
                      <Ionicons name="cart-outline" size={20} color={colors.textPrimary} />
                      <Text style={styles.secondaryButtonText}>Minta Beli</Text>
                    </PressableScale>
                  )
                ) : null}

                {/* Sisa batch */}
                {material.batches.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>Sisa batch (FIFO)</Text>
                    {material.batches.map((b) => {
                      const expired = b.expiry_date ? isExpired(b.expiry_date) : false;
                      const nearExpiry = b.expiry_date ? isNearExpiry(b.expiry_date) : false;
                      return (
                        <View key={b.id} style={styles.batchRow}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.batchQuantity}>
                              {parseFloat(b.quantity).toLocaleString('id-ID')} {material.unit}
                            </Text>
                            <Text style={styles.historyDate}>
                              Masuk {formatDate(b.received_date)}
                              {b.is_adjustment ? ' · Dari penyesuaian stok' : ''}
                            </Text>
                          </View>
                          {b.expiry_date ? (
                            <View style={[styles.expiryBadge, { backgroundColor: expired ? colors.dangerBg : nearExpiry ? colors.warningBg : neutralBg }]}>
                              <Text style={[styles.expiryText, { color: expired ? colors.danger : nearExpiry ? colors.warning : colors.textSecondary }]}>
                                {expired ? 'Lewat' : 'Exp'} {formatDate(b.expiry_date)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </>
                ) : null}

                {/* Riwayat */}
                <Text style={styles.sectionLabel}>Riwayat terbaru</Text>
                {material.movements.length === 0 ? (
                  <View style={styles.noticeBox}>
                    <Ionicons name="swap-vertical-outline" size={18} color={colors.textSecondary} />
                    <Text style={styles.noticeText}>Belum ada riwayat keluar/masuk untuk bahan ini.</Text>
                  </View>
                ) : (
                  <>
                    {[...material.movements, ...extraMovements].map((m) => {
                      const tone = movementTone(m.type);
                      return (
                        <View key={m.id} style={[styles.historyRow, m.reversed_at ? { opacity: 0.55 } : null]}>
                          <View style={[styles.historyIcon, { backgroundColor: tone.bg }]}>
                            <Ionicons name={tone.icon} size={18} color={tone.fg} />
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={[styles.historyText, m.reversed_at ? { textDecorationLine: 'line-through' } : null]}>
                              {movementLabel(m.type)} {parseFloat(m.quantity) > 0 && m.type === 'adjustment' ? '+' : ''}
                              {parseFloat(m.quantity).toLocaleString('id-ID')} {material.unit}
                              {m.user ? ` · ${m.user.name}` : ''}
                              {m.store ? ` (${m.store.name})` : ''}
                            </Text>
                            {m.reversed_at ? (
                              <View style={styles.reversedPill}>
                                <Text style={styles.reversedText}>Dibatalkan{m.reversed_reason ? `: ${m.reversed_reason}` : ''}</Text>
                              </View>
                            ) : null}
                            {m.unit_cost ? <Text style={styles.historyNote}>Rp {parseFloat(m.unit_cost).toLocaleString('id-ID')} / {material.unit}</Text> : null}
                            {m.note ? <Text style={styles.historyNote}>{m.note}</Text> : null}
                            <Text style={styles.historyDate}>{formatDateTime(m.created_at)}</Text>
                          </View>
                        </View>
                      );
                    })}

                    {hasMoreMovements ? (
                      <PressableScale style={styles.loadMoreButton} onPress={loadMoreMovements} disabled={loadingMoreMovements}>
                        {loadingMoreMovements ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.loadMoreText}>Muat riwayat lainnya</Text>}
                      </PressableScale>
                    ) : null}
                  </>
                )}
              </FadeInUp>
            </ScrollView>

            {/* Aksi utama selalu terlihat di bawah: Catat Masuk / Catat Keluar. */}
            {showFooterActions ? (
              <View style={styles.footer}>
                <PressableScale style={[styles.actionButton, styles.actionIn]} onPress={() => openForm('in')} accessibilityRole="button">
                  <Ionicons name="arrow-down" size={20} color="#ffffff" />
                  <Text style={styles.actionButtonText}>Catat Masuk</Text>
                </PressableScale>
                <PressableScale style={[styles.actionButton, styles.actionOut]} onPress={() => openForm('out')} accessibilityRole="button">
                  <Ionicons name="arrow-up" size={20} color="#ffffff" />
                  <Text style={styles.actionButtonText}>Catat Keluar</Text>
                </PressableScale>
              </View>
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },

    scrollContent: { paddingHorizontal: 20, paddingTop: spacing.xs, paddingBottom: spacing.xl },
    scrollInner: { gap: spacing.md },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    centerStateText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    card: { padding: 18, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line, gap: spacing.md, ...shadow },

    heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    categoryPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: chip },
    categoryPillText: { fontSize: 11.5, fontWeight: '700', color: colors.textSecondary },
    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    statusText: { fontSize: 12, fontWeight: '800' },
    nameText: { fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    stockRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: -spacing.xs },
    stockValue: { fontSize: 44, fontWeight: '800', letterSpacing: -1.5, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    stockUnit: { fontSize: fontSize.base, fontWeight: '700', color: colors.textMuted },

    infoBox: { padding: 14, borderRadius: 18, backgroundColor: chip, gap: spacing.sm + 2 },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    infoText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18, color: colors.textSecondary },

    noticeBox: { flexDirection: 'row', gap: spacing.sm, padding: 14, borderRadius: 18, backgroundColor: chip },
    noticeText: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 19, color: colors.textSecondary },

    secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.pill, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    secondaryButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    primaryButton: {
      height: 52, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 3,
    },
    primaryButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: '#ffffff' },
    disabled: { opacity: 0.6 },

    formTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    field: { gap: 6 },
    fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
    helperText: { fontSize: 12, fontWeight: '500', color: colors.textMuted, lineHeight: 18 },
    input: { minHeight: 50, borderRadius: 18, paddingHorizontal: 16, fontSize: fontSize.sm, color: colors.textPrimary, backgroundColor: chip },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stepperBtn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    stepperBtnOff: { opacity: 0.35 },
    stepperValue: { flex: 1, minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: chip, flexDirection: 'row', gap: 6 },
    stepperNumber: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    stepperUnit: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
    errorText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.danger },
    formActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cancelButton: { paddingHorizontal: spacing.lg, height: 52, alignItems: 'center', justifyContent: 'center' },
    cancelButtonText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '700' },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: 14, borderRadius: 18, backgroundColor: chip },
    toggleText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    reasonChip: { minHeight: 38, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    reasonChipActive: { backgroundColor: colors.accent },
    reasonChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    reasonChipTextActive: { color: '#ffffff' },

    sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2, color: colors.textMuted, marginTop: spacing.sm, marginLeft: 4 },
    batchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: 16, borderRadius: 22, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    batchQuantity: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    expiryBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    expiryText: { fontSize: 11.5, fontWeight: '800' },

    historyRow: { flexDirection: 'row', gap: spacing.sm + 4, padding: 14, borderRadius: 22, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    historyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    historyText: { fontSize: fontSize.sm, fontWeight: '800', letterSpacing: -0.1, color: colors.textPrimary },
    historyNote: { fontSize: 12.5, color: colors.textSecondary, lineHeight: 18 },
    historyDate: { fontSize: 11.5, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    reversedPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.dangerBg },
    reversedText: { fontSize: 12, fontWeight: '700', color: colors.danger },
    loadMoreButton: { alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.pill, backgroundColor: chip },
    loadMoreText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },

    footer: { flexDirection: 'row', gap: spacing.sm + 2, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: screenBg, borderTopWidth: 1, borderTopColor: line },
    actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 56, borderRadius: radius.pill },
    actionIn: { backgroundColor: colors.success, shadowColor: colors.success, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 18, elevation: 4 },
    actionOut: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 18, elevation: 4 },
    actionButtonText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '700' },
  });
}
