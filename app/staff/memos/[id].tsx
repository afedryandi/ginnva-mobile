import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

type ItemType = 'raw_material' | 'consumable_item' | 'inventory_item';

interface MemoItem {
  id: number;
  item_type: ItemType;
  item_name: string;
  unit: string | null;
  qty_taken: string | null;
  qty_returned: string | null;
  qty_used: string | null;
  meters_used: string | null;
  condition_notes: string | null;
}

interface MemoDetail {
  id: number;
  memo_number: string;
  vehicle_info: string | null;
  spk_number: string | null;
  notes: string | null;
  creator: { name: string } | null;
  store: { name: string } | null;
  items: MemoItem[];
}

interface SearchResult {
  id: number;
  name: string;
  unit?: string;
  subtitle?: string;
  stockInfo?: string;
  lowStock?: boolean;
}

const TYPE_LABEL: Record<ItemType, string> = {
  raw_material: 'Bahan Baku',
  consumable_item: 'Barang Habis Pakai',
  inventory_item: 'PPF/WF',
};

function n(v: string | null): number {
  return v === null ? 0 : parseFloat(v);
}

export default function MemoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [memo, setMemo] = useState<MemoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMemo = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}`);
      setMemo(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat memo.');
    }
  }, [id]);

  // Refetch tiap kali layar ini kembali dapat fokus — sama seperti daftar
  // memo, spinner penuh cuma tampil sebelum pernah berhasil load sekali.
  const hasLoadedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) setLoading(true);
      fetchMemo().finally(() => {
        hasLoadedOnce.current = true;
        setLoading(false);
      });
    }, [fetchMemo])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMemo();
    setRefreshing(false);
  }, [fetchMemo]);

  // ── Tambah barang ──────────────────────────────────────────────────
  // Bahan Baku/Barang Habis Pakai: bisa centang banyak sekaligus (search
  // -> pilih beberapa -> isi jumlah masing-masing di layar berikutnya).
  // PPF/WF: tetap 1 per 1 (pilih -> isi meter langsung), karena tiap
  // gulungan beda kode & sisa panjangnya, kurang cocok dicentang massal.
  const [addVisible, setAddVisible] = useState(false);
  const [addType, setAddType] = useState<ItemType | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<SearchResult[]>([]);
  const [multiQtyStep, setMultiQtyStep] = useState(false);
  const [multiQty, setMultiQty] = useState<Record<number, string>>({});
  const [qtyInput, setQtyInput] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const resetAddModal = () => {
    setAddVisible(false);
    setAddType(null);
    setSearch('');
    setSearchResults([]);
    setSelected(null);
    setSelectedMulti([]);
    setMultiQtyStep(false);
    setMultiQty({});
    setQtyInput('');
    setConditionNotes('');
    setAddError(null);
  };

  const toggleMultiSelect = (item: SearchResult) => {
    hapticLight();
    setSelectedMulti((prev) =>
      prev.some((s) => s.id === item.id) ? prev.filter((s) => s.id !== item.id) : [...prev, item]
    );
  };

  const openAddModal = () => {
    resetAddModal();
    setAddVisible(true);
  };

  // Dipanggil dari tombol X / tombol back HP Android — kalau user sudah
  // sempat pilih jenis/barang/isi apa pun, konfirmasi dulu supaya tidak
  // hilang tanpa sengaja (beda dari nutup modal yang masih kosong sama
  // sekali, itu boleh langsung tutup tanpa nanya).
  const hasUnsavedAddProgress = () =>
    addType !== null &&
    (selected !== null ||
      selectedMulti.length > 0 ||
      qtyInput.trim() !== '' ||
      search.trim() !== '' ||
      conditionNotes.trim() !== '');

  const closeAddModal = () => {
    if (!hasUnsavedAddProgress()) {
      resetAddModal();
      return;
    }
    Alert.alert('Batalkan Tambah Barang?', 'Pilihan dan jumlah yang sudah diisi akan hilang.', [
      { text: 'Lanjutkan Isi', style: 'cancel' },
      { text: 'Batalkan', style: 'destructive', onPress: resetAddModal },
    ]);
  };

  const searchEndpoint = (type: ItemType) => {
    if (type === 'raw_material') return '/api/staff/materials';
    if (type === 'consumable_item') return '/api/staff/consumables';
    return '/api/staff/inventory';
  };

  useEffect(() => {
    if (!addType) return;
    setSearchLoading(true);
    const timeout = setTimeout(() => {
      staffApiFetch<{ data: any[] }>(`${searchEndpoint(addType)}?search=${encodeURIComponent(search)}`)
        .then((res) => {
          const mapped: SearchResult[] = (res.data ?? [])
            .filter((raw) => addType !== 'inventory_item' || raw.scroll_code)
            .map((raw) => {
              if (addType === 'inventory_item') {
                const remaining = raw.scroll_code?.remaining_length_meters;
                return {
                  id: raw.id,
                  name: raw.name,
                  subtitle: `Kode gulungan: ${raw.scroll_code?.code ?? '—'}`,
                  stockInfo: remaining !== null && remaining !== undefined ? `Sisa ${parseFloat(remaining).toLocaleString('id-ID')} meter` : undefined,
                };
              }

              const currentStock = parseFloat(raw.current_stock ?? '0');
              const reorderPoint = raw.reorder_point !== null && raw.reorder_point !== undefined ? parseFloat(raw.reorder_point) : null;

              return {
                id: raw.id,
                name: raw.name,
                unit: raw.unit,
                subtitle: [raw.code, raw.category].filter(Boolean).join(' · '),
                stockInfo: `Stok: ${currentStock.toLocaleString('id-ID')} ${raw.unit ?? ''}`.trim(),
                lowStock: reorderPoint !== null && currentStock <= reorderPoint,
              };
            });
          setSearchResults(mapped);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addType, search]);

  const submitAddItem = async () => {
    if (!addType || !selected) return;
    const qty = parseFloat(qtyInput);

    setAddSubmitting(true);
    setAddError(null);
    try {
      const body: Record<string, unknown> = {
        item_type: addType,
        item_id: selected.id,
        condition_notes: conditionNotes.trim() || null,
      };
      if (addType === 'inventory_item') {
        body.meters_used = qty;
      } else {
        body.qty_taken = qty;
      }

      const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}/items`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      hapticSuccess();
      setMemo(res.data);
      resetAddModal();
      Alert.alert('Berhasil', `"${selected.name}" ditambahkan ke memo.`);
    } catch (err) {
      hapticError();
      setAddError(err instanceof ApiError ? err.message : 'Gagal menambah barang.');
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleAddItem = () => {
    if (!addType || !selected || addSubmitting) return;
    const qty = parseFloat(qtyInput);
    if (!qty || qty <= 0) {
      setAddError('Isi jumlah yang valid.');
      return;
    }

    const unitLabel = addType === 'inventory_item' ? 'meter' : selected.unit ?? '';
    Alert.alert(
      'Konfirmasi Pengambilan',
      `Catat ${qty.toLocaleString('id-ID')} ${unitLabel} "${selected.name}" diambil? Stok akan langsung berkurang.`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Catat', onPress: submitAddItem },
      ]
    );
  };

  const submitAddMultiItems = async () => {
    if (!addType || selectedMulti.length === 0) return;

    setAddSubmitting(true);
    setAddError(null);

    // Item yang GAGAL dan yang BELUM DICOBA tetap di sini kalau ada
    // kegagalan di tengah jalan — supaya kalau user tekan "Tambahkan"
    // lagi, barang yang SUDAH tersimpan tidak ikut ke-submit dobel.
    const remaining = [...selectedMulti];
    let failedName: string | null = null;

    try {
      while (remaining.length > 0) {
        const item = remaining[0];
        const qty = parseFloat(multiQty[item.id]);
        failedName = item.name;
        // Sengaja berurutan (bukan Promise.all) — tiap item transaksi
        // stoknya sendiri-sendiri di backend, kalau salah satu gagal
        // (mis. stok kurang) yang sebelumnya tetap sudah tersimpan, jadi
        // urutan & titik gagalnya harus jelas ketahuan.
        const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}/items`, {
          method: 'POST',
          body: JSON.stringify({
            item_type: addType,
            item_id: item.id,
            qty_taken: qty,
            condition_notes: conditionNotes.trim() || null,
          }),
        });
        setMemo(res.data);
        remaining.shift();
      }
      hapticSuccess();
      const count = selectedMulti.length;
      resetAddModal();
      Alert.alert('Berhasil', `${count} barang ditambahkan ke memo.`);
    } catch (err) {
      hapticError();
      const baseMsg = err instanceof ApiError ? err.message : 'Gagal menambah barang.';
      const savedCount = selectedMulti.length - remaining.length;
      setAddError(
        `"${failedName}": ${baseMsg}` +
          (savedCount > 0 ? ` (${savedCount} barang sebelumnya di daftar ini sudah tersimpan.)` : '')
      );
      // Sisakan cuma yang belum berhasil di form — barang yang sudah
      // tersimpan dicoret dari daftar centang supaya tidak ke-submit lagi
      // kalau user tekan "Tambahkan" ulang.
      setSelectedMulti(remaining);
      await fetchMemo();
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleAddMultiItems = () => {
    if (!addType || selectedMulti.length === 0 || addSubmitting) return;

    const missing = selectedMulti.find((item) => {
      const q = parseFloat(multiQty[item.id] ?? '');
      return !q || q <= 0;
    });
    if (missing) {
      setAddError(`Isi jumlah untuk "${missing.name}".`);
      return;
    }

    Alert.alert(
      'Konfirmasi Pengambilan',
      `Tambahkan ${selectedMulti.length} barang ke memo ini? Stok masing-masing akan langsung berkurang sesuai jumlah yang diisi.`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Tambahkan', onPress: submitAddMultiItems },
      ]
    );
  };

  // ── Catat pengembalian ─────────────────────────────────────────────
  const [returnTarget, setReturnTarget] = useState<MemoItem | null>(null);
  const [returnQtyInput, setReturnQtyInput] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const openReturnModal = (item: MemoItem) => {
    setReturnTarget(item);
    setReturnQtyInput('');
    setReturnError(null);
  };

  const submitReturn = async (qty: number) => {
    if (!returnTarget) return;
    setReturnSubmitting(true);
    setReturnError(null);
    try {
      const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}/items/${returnTarget.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ qty_returned: qty }),
      });
      hapticSuccess();
      setMemo(res.data);
      setReturnTarget(null);
      Alert.alert('Berhasil', 'Pengembalian berhasil dicatat.');
    } catch (err) {
      hapticError();
      setReturnError(err instanceof ApiError ? err.message : 'Gagal mencatat pengembalian.');
    } finally {
      setReturnSubmitting(false);
    }
  };

  const handleReturn = () => {
    if (!returnTarget || returnSubmitting) return;
    const qty = parseFloat(returnQtyInput);
    if (isNaN(qty) || qty < 0) {
      setReturnError('Isi jumlah yang valid (boleh 0 kalau semua terpakai habis).');
      return;
    }
    if (qty > n(returnTarget.qty_taken)) {
      setReturnError(`Tidak boleh lebih dari ${returnTarget.qty_taken} ${returnTarget.unit} (jumlah yang diambil).`);
      return;
    }

    const usedQty = n(returnTarget.qty_taken) - qty;
    const message =
      qty === 0
        ? `Semua ${returnTarget.qty_taken} ${returnTarget.unit} yang diambil dianggap HABIS terpakai — tidak ada yang balik ke stok. Lanjutkan?`
        : `${qty.toLocaleString('id-ID')} ${returnTarget.unit} balik ke stok, sisanya (${usedQty.toLocaleString('id-ID')} ${returnTarget.unit}) dianggap terpakai. Lanjutkan?`;

    Alert.alert('Konfirmasi Pengembalian', message, [
      { text: 'Batal', style: 'cancel' },
      { text: 'Catat', onPress: () => submitReturn(qty) },
    ]);
  };

  // ── Edit jumlah (koreksi salah input) ──────────────────────────────
  const [editTarget, setEditTarget] = useState<MemoItem | null>(null);
  const [editQtyInput, setEditQtyInput] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const canEditItem = (item: MemoItem) =>
    item.item_type === 'inventory_item' ? true : item.qty_returned === null;

  const openEditModal = (item: MemoItem) => {
    setEditTarget(item);
    setEditQtyInput(item.item_type === 'inventory_item' ? item.meters_used ?? '' : item.qty_taken ?? '');
    setEditError(null);
  };

  const submitEdit = async (qty: number) => {
    if (!editTarget) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const body = editTarget.item_type === 'inventory_item' ? { meters_used: qty } : { qty_taken: qty };
      const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}/items/${editTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      hapticSuccess();
      setMemo(res.data);
      setEditTarget(null);
      Alert.alert('Berhasil', 'Jumlah berhasil dikoreksi.');
    } catch (err) {
      hapticError();
      setEditError(err instanceof ApiError ? err.message : 'Gagal mengoreksi jumlah.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleEditSubmit = () => {
    if (!editTarget || editSubmitting) return;
    const qty = parseFloat(editQtyInput);
    if (!qty || qty <= 0) {
      setEditError('Isi jumlah yang valid.');
      return;
    }

    const oldQty = editTarget.item_type === 'inventory_item' ? editTarget.meters_used : editTarget.qty_taken;
    const unitLabel = editTarget.item_type === 'inventory_item' ? 'meter' : editTarget.unit ?? '';
    if (qty === parseFloat(oldQty ?? '0')) {
      setEditTarget(null);
      return;
    }

    Alert.alert(
      'Konfirmasi Koreksi',
      `Ubah jumlah "${editTarget.item_name}" dari ${oldQty} ${unitLabel} menjadi ${qty.toLocaleString('id-ID')} ${unitLabel}?`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Ubah', onPress: () => submitEdit(qty) },
      ]
    );
  };

  // ── Hapus baris (salah pilih barang, bukan cuma salah angka) ───────
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const submitDelete = async (item: MemoItem) => {
    setDeletingId(item.id);
    try {
      const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}/items/${item.id}`, {
        method: 'DELETE',
      });
      hapticSuccess();
      setMemo(res.data);
      Alert.alert('Berhasil', `"${item.item_name}" dihapus dari memo.`);
    } catch (err) {
      hapticError();
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menghapus barang.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDelete = (item: MemoItem) => {
    if (deletingId !== null) return;

    const stillOut =
      item.item_type === 'inventory_item'
        ? `${item.meters_used} meter`
        : `${item.qty_returned !== null ? item.qty_used : item.qty_taken} ${item.unit}`;

    Alert.alert(
      'Hapus Barang Ini?',
      `"${item.item_name}" akan dihapus dari memo, dan ${stillOut} yang masih tercatat keluar akan dikembalikan ke stok.`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Hapus', style: 'destructive', onPress: () => submitDelete(item) },
      ]
    );
  };

  const renderItem = ({ item }: { item: MemoItem }) => {
    const needsReturn = item.item_type !== 'inventory_item' && item.qty_returned === null;
    return (
      <View style={styles.itemRow}>
        <View style={styles.itemHeader}>
          <View style={styles.itemTypeBadge}>
            <Text style={styles.itemTypeBadgeText}>{TYPE_LABEL[item.item_type]}</Text>
          </View>
          <Text style={styles.itemName} numberOfLines={2}>{item.item_name}</Text>
          {canEditItem(item) && (
            <Pressable onPress={() => openEditModal(item)} hitSlop={8} disabled={deletingId === item.id}>
              <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
            </Pressable>
          )}
          <Pressable onPress={() => handleDelete(item)} hitSlop={8} disabled={deletingId === item.id} style={{ marginLeft: spacing.xs }}>
            {deletingId === item.id ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            )}
          </Pressable>
        </View>

        {item.item_type === 'inventory_item' ? (
          <Text style={styles.itemQty}>{item.meters_used} meter dipakai</Text>
        ) : (
          <View style={styles.itemQtyRow}>
            <Text style={styles.itemQty}>Diambil: {item.qty_taken} {item.unit}</Text>
            <Text style={styles.itemQty}>
              Dikembalikan: {item.qty_returned === null ? 'Belum Dikembalikan' : `${item.qty_returned} ${item.unit}`}
            </Text>
            {item.qty_used !== null && (
              <Text style={[styles.itemQty, styles.itemQtyUsed]}>Terpakai: {item.qty_used} {item.unit}</Text>
            )}
          </View>
        )}

        {item.condition_notes && <Text style={styles.itemNotes}>{item.condition_notes}</Text>}

        {needsReturn && (
          <Pressable style={styles.returnBtn} onPress={() => openReturnModal(item)} hitSlop={8}>
            <Ionicons name="arrow-undo-outline" size={14} color={colors.accent} />
            <Text style={styles.returnBtnText}>Catat Pengembalian</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{memo?.memo_number ?? 'Memo'}</Text>
        <Pressable onPress={onRefresh} style={styles.sideButton} disabled={refreshing}>
          <Ionicons name="refresh" size={22} color={refreshing ? colors.textMuted : colors.textPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error || !memo ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error ?? 'Memo tidak ditemukan.'}</Text>
        </View>
      ) : (
        <>
          <FlatList
            data={memo.items}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            ListHeaderComponent={
              <View style={styles.infoCard}>
                <Text style={styles.infoLine}>
                  {[memo.vehicle_info, memo.spk_number ? `SPK ${memo.spk_number}` : null].filter(Boolean).join(' · ') || 'Tanpa info kendaraan'}
                </Text>
                <Text style={styles.infoMeta}>{memo.store?.name ?? '—'} · Dibuat oleh {memo.creator?.name ?? '—'}</Text>
                {memo.notes && <Text style={styles.infoNotes}>{memo.notes}</Text>}
              </View>
            }
            renderItem={renderItem}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Ionicons name="cube-outline" size={36} color={colors.textMuted} />
                <Text style={styles.centerStateText}>Belum ada barang di memo ini. Ketuk "Tambah Barang" di bawah.</Text>
              </View>
            }
          />

          <Pressable style={styles.addBtn} onPress={openAddModal}>
            <Ionicons name="add-circle-outline" size={20} color="#ffffff" />
            <Text style={styles.addBtnText}>Tambah Barang</Text>
          </Pressable>
        </>
      )}

      {/* Modal: tambah barang */}
      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={closeAddModal}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Tambah Barang</Text>
                <Text style={styles.modalStep}>
                  {!addType
                    ? 'Langkah 1/3 · Pilih jenis'
                    : addType !== 'inventory_item' && multiQtyStep
                      ? 'Langkah 3/3 · Isi jumlah'
                      : addType !== 'inventory_item'
                        ? 'Langkah 2/3 · Cari & centang'
                        : !selected
                          ? 'Langkah 2/3 · Cari & pilih'
                          : 'Langkah 3/3 · Isi jumlah'}
                </Text>
              </View>
              <Pressable onPress={closeAddModal} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>

            {!addType ? (
              <View style={{ gap: spacing.sm }}>
                {(Object.keys(TYPE_LABEL) as ItemType[]).map((t) => (
                  <Pressable key={t} style={styles.typeOption} onPress={() => { hapticLight(); setAddType(t); }}>
                    <Text style={styles.typeOptionText}>{TYPE_LABEL[t]}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            ) : addType !== 'inventory_item' && multiQtyStep ? (
              <View style={{ flex: 1, gap: spacing.sm }}>
                <FlatList
                  data={selectedMulti}
                  keyExtractor={(item) => String(item.id)}
                  style={{ maxHeight: 320 }}
                  contentContainerStyle={{ gap: spacing.sm }}
                  renderItem={({ item }) => (
                    <View style={styles.multiQtyRow}>
                      <Text style={styles.pickRowName} numberOfLines={2}>{item.name}</Text>
                      {item.stockInfo && (
                        <Text style={[styles.pickRowStock, item.lowStock && styles.pickRowStockLow]}>{item.stockInfo}</Text>
                      )}
                      <TextInput
                        style={styles.multiQtyInput}
                        placeholder={item.unit ? `Jumlah (${item.unit})` : 'Jumlah'}
                        placeholderTextColor={colors.textMuted}
                        value={multiQty[item.id] ?? ''}
                        onChangeText={(v) => setMultiQty((prev) => ({ ...prev, [item.id]: v }))}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  )}
                />
                <TextInput
                  style={[styles.input, styles.textarea]}
                  placeholder="Keterangan/Kondisi untuk semua barang ini (opsional)"
                  placeholderTextColor={colors.textMuted}
                  value={conditionNotes}
                  onChangeText={setConditionNotes}
                  multiline
                />
                {addError && <Text style={styles.errorText}>{addError}</Text>}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    label="Kembali"
                    variant="outline"
                    onPress={() => setMultiQtyStep(false)}
                    disabled={addSubmitting}
                  />
                  <Button
                    label={`Tambahkan ${selectedMulti.length} Barang`}
                    onPress={handleAddMultiItems}
                    loading={addSubmitting}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : addType !== 'inventory_item' ? (
              <View style={{ flex: 1 }}>
                <View style={styles.searchWrap}>
                  <Ionicons name="search" size={16} color={colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={`Cari ${TYPE_LABEL[addType].toLowerCase()}...`}
                    placeholderTextColor={colors.textMuted}
                    value={search}
                    onChangeText={setSearch}
                  />
                </View>
                {searchLoading ? (
                  <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
                ) : (
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item) => String(item.id)}
                    style={{ maxHeight: 240 }}
                    ListEmptyComponent={<Text style={styles.centerStateText}>Tidak ada hasil.</Text>}
                    renderItem={({ item }) => {
                      const checked = selectedMulti.some((s) => s.id === item.id);
                      return (
                        <Pressable style={styles.pickRow} onPress={() => toggleMultiSelect(item)}>
                          <Ionicons
                            name={checked ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={checked ? colors.accent : colors.textMuted}
                          />
                          <View style={{ flex: 1, marginLeft: spacing.xs }}>
                            <Text style={styles.pickRowName}>{item.name}</Text>
                            {item.subtitle && <Text style={styles.pickRowSubtitle}>{item.subtitle}</Text>}
                          </View>
                          {item.stockInfo && (
                            <Text style={[styles.pickRowStock, item.lowStock && styles.pickRowStockLow]}>{item.stockInfo}</Text>
                          )}
                        </Pressable>
                      );
                    }}
                  />
                )}
                {selectedMulti.length > 0 && (
                  <Button
                    label={`Lanjut (${selectedMulti.length} dipilih)`}
                    onPress={() => {
                      hapticLight();
                      setMultiQty(Object.fromEntries(selectedMulti.map((s) => [s.id, multiQty[s.id] ?? ''])));
                      setMultiQtyStep(true);
                    }}
                    style={{ marginTop: spacing.sm }}
                  />
                )}
              </View>
            ) : !selected ? (
              <View style={{ flex: 1 }}>
                <View style={styles.searchWrap}>
                  <Ionicons name="search" size={16} color={colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={`Cari ${TYPE_LABEL[addType].toLowerCase()}...`}
                    placeholderTextColor={colors.textMuted}
                    value={search}
                    onChangeText={setSearch}
                  />
                </View>
                {searchLoading ? (
                  <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
                ) : (
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item) => String(item.id)}
                    style={{ maxHeight: 280 }}
                    ListEmptyComponent={<Text style={styles.centerStateText}>Tidak ada hasil.</Text>}
                    renderItem={({ item }) => (
                      <Pressable style={styles.pickRow} onPress={() => setSelected(item)}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pickRowName}>{item.name}</Text>
                          {item.subtitle && <Text style={styles.pickRowSubtitle}>{item.subtitle}</Text>}
                        </View>
                        {item.stockInfo && (
                          <Text style={[styles.pickRowStock, item.lowStock && styles.pickRowStockLow]}>{item.stockInfo}</Text>
                        )}
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                      </Pressable>
                    )}
                  />
                )}
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                <Text style={styles.selectedName}>{selected.name}</Text>
                {selected.subtitle && <Text style={styles.pickRowSubtitle}>{selected.subtitle}</Text>}
                {selected.stockInfo && (
                  <Text style={[styles.pickRowStock, selected.lowStock && styles.pickRowStockLow]}>{selected.stockInfo}</Text>
                )}
                <TextInput
                  style={styles.input}
                  placeholder={addType === 'inventory_item' ? 'Meter dipakai' : 'Jumlah diambil'}
                  placeholderTextColor={colors.textMuted}
                  value={qtyInput}
                  onChangeText={setQtyInput}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={[styles.input, styles.textarea]}
                  placeholder="Keterangan/Kondisi (opsional)"
                  placeholderTextColor={colors.textMuted}
                  value={conditionNotes}
                  onChangeText={setConditionNotes}
                  multiline
                />
                {addError && <Text style={styles.errorText}>{addError}</Text>}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    label="Kembali"
                    variant="outline"
                    onPress={() => setSelected(null)}
                    disabled={addSubmitting}
                  />
                  <Button label="Tambahkan" onPress={handleAddItem} loading={addSubmitting} style={{ flex: 1 }} />
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: catat pengembalian */}
      <Modal visible={returnTarget !== null} animationType="fade" transparent onRequestClose={() => setReturnTarget(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Catat Pengembalian</Text>
              <Pressable onPress={() => setReturnTarget(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>
            <Text style={styles.selectedName}>{returnTarget?.item_name}</Text>
            <Text style={styles.infoMeta}>Diambil: {returnTarget?.qty_taken} {returnTarget?.unit}</Text>
            <TextInput
              style={styles.input}
              placeholder="Jumlah dikembalikan (0 kalau habis terpakai)"
              placeholderTextColor={colors.textMuted}
              value={returnQtyInput}
              onChangeText={setReturnQtyInput}
              keyboardType="decimal-pad"
            />
            {returnError && <Text style={styles.errorText}>{returnError}</Text>}
            <Button label="Simpan" onPress={handleReturn} loading={returnSubmitting} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: edit jumlah (koreksi salah input) */}
      <Modal visible={editTarget !== null} animationType="fade" transparent onRequestClose={() => setEditTarget(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Koreksi Jumlah</Text>
              <Pressable onPress={() => setEditTarget(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>
            <Text style={styles.selectedName}>{editTarget?.item_name}</Text>
            <Text style={styles.infoMeta}>
              {editTarget?.item_type === 'inventory_item'
                ? `Sekarang: ${editTarget?.meters_used} meter`
                : `Sekarang: ${editTarget?.qty_taken} ${editTarget?.unit}`}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={editTarget?.item_type === 'inventory_item' ? 'Meter dipakai (koreksi)' : 'Jumlah diambil (koreksi)'}
              placeholderTextColor={colors.textMuted}
              value={editQtyInput}
              onChangeText={setEditQtyInput}
              keyboardType="decimal-pad"
            />
            {editError && <Text style={styles.errorText}>{editError}</Text>}
            <Button label="Simpan Koreksi" onPress={handleEditSubmit} loading={editSubmitting} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    headerTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    listContent: { padding: spacing.md, paddingBottom: 100, gap: spacing.sm },

    infoCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.xs,
      gap: 4,
    },
    infoLine: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    infoMeta: { fontSize: fontSize.xs, color: colors.textMuted },
    infoNotes: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 4, fontStyle: 'italic' },

    itemRow: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm,
      gap: 4,
    },
    itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    itemTypeBadge: {
      backgroundColor: colors.accentSoft,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
    },
    itemTypeBadgeText: { fontSize: 10, fontWeight: '700', color: colors.accent },
    itemName: { flex: 1, fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    itemQtyRow: { gap: 2 },
    itemQty: { fontSize: fontSize.xs, color: colors.textSecondary },
    itemQtyUsed: { fontWeight: '700', color: colors.textPrimary },
    itemNotes: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic' },
    returnBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 4,
      alignSelf: 'flex-start',
    },
    returnBtnText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent },

    addBtn: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: spacing.md,
    },
    addBtnText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },

    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalCard: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.md,
      maxHeight: '85%',
      gap: spacing.sm,
    },
    modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    modalTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    modalStep: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },

    typeOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    typeOptionText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },

    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: spacing.xs,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    pickRowName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    pickRowSubtitle: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
    pickRowStock: { fontSize: fontSize.xs, fontWeight: '700', color: colors.success, marginRight: spacing.xs },
    pickRowStockLow: { color: colors.danger },
    multiQtyRow: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm,
      gap: 4,
    },
    multiQtyInput: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
      marginTop: 4,
    },
    selectedName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
    },
    textarea: { minHeight: 60, textAlignVertical: 'top' },
    errorText: { fontSize: fontSize.sm, color: colors.danger },
  });
}
