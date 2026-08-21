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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

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
  const [addVisible, setAddVisible] = useState(false);
  const [addType, setAddType] = useState<ItemType | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
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
    setQtyInput('');
    setConditionNotes('');
    setAddError(null);
  };

  const openAddModal = () => {
    resetAddModal();
    setAddVisible(true);
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

  const handleAddItem = async () => {
    if (!addType || !selected || addSubmitting) return;
    const qty = parseFloat(qtyInput);
    if (!qty || qty <= 0) {
      setAddError('Isi jumlah yang valid.');
      return;
    }

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
      setMemo(res.data);
      resetAddModal();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Gagal menambah barang.');
    } finally {
      setAddSubmitting(false);
    }
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

  const handleReturn = async () => {
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

    setReturnSubmitting(true);
    setReturnError(null);
    try {
      const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}/items/${returnTarget.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ qty_returned: qty }),
      });
      setMemo(res.data);
      setReturnTarget(null);
    } catch (err) {
      setReturnError(err instanceof ApiError ? err.message : 'Gagal mencatat pengembalian.');
    } finally {
      setReturnSubmitting(false);
    }
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
        </View>

        {item.item_type === 'inventory_item' ? (
          <Text style={styles.itemQty}>{item.meters_used} meter dipakai</Text>
        ) : (
          <View style={styles.itemQtyRow}>
            <Text style={styles.itemQty}>Diambil: {item.qty_taken} {item.unit}</Text>
            <Text style={styles.itemQty}>
              Dikembalikan: {item.qty_returned === null ? 'Belum diisi' : `${item.qty_returned} ${item.unit}`}
            </Text>
            {item.qty_used !== null && (
              <Text style={[styles.itemQty, styles.itemQtyUsed]}>Terpakai: {item.qty_used} {item.unit}</Text>
            )}
          </View>
        )}

        {item.condition_notes && <Text style={styles.itemNotes}>{item.condition_notes}</Text>}

        {needsReturn && (
          <Pressable style={styles.returnBtn} onPress={() => openReturnModal(item)}>
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
      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={resetAddModal}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Tambah Barang</Text>
              <Pressable onPress={resetAddModal} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>

            {!addType ? (
              <View style={{ gap: spacing.sm }}>
                {(Object.keys(TYPE_LABEL) as ItemType[]).map((t) => (
                  <Pressable key={t} style={styles.typeOption} onPress={() => setAddType(t)}>
                    <Text style={styles.typeOptionText}>{TYPE_LABEL[t]}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
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
                <Pressable style={[styles.submitBtn, addSubmitting && styles.submitBtnDisabled]} onPress={handleAddItem} disabled={addSubmitting}>
                  {addSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitText}>Tambahkan</Text>}
                </Pressable>
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
            <Pressable style={[styles.submitBtn, returnSubmitting && styles.submitBtnDisabled]} onPress={handleReturn} disabled={returnSubmitting}>
              {returnSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitText}>Simpan</Text>}
            </Pressable>
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
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    modalTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },

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
    submitBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    submitBtnDisabled: { opacity: 0.6 },
    submitText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },
  });
}
