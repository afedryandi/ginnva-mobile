import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

type ItemType = 'raw_material' | 'consumable_item' | 'asset';

interface PurchaseRequestRecord {
  id: number;
  request_number: string;
  item_type: ItemType;
  item_name: string;
  unit: string | null;
  quantity: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  review_note: string | null;
  requester_name: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  fulfilled_at: string | null;
  created_at: string;
}

interface CatalogItem {
  id: number;
  name: string;
  unit: string | null;
}

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  raw_material: 'Bahan Baku',
  consumable_item: 'Barang Habis Pakai',
  asset: 'Aset Baru',
};

const STATUS_META: Record<PurchaseRequestRecord['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu Persetujuan', color: 'warning', bg: 'warningBg' },
  approved: { label: 'Disetujui', color: 'success', bg: 'successBg' },
  rejected: { label: 'Ditolak', color: 'danger', bg: 'dangerBg' },
  fulfilled: { label: 'Terpenuhi', color: 'textMuted', bg: 'surface' },
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatQty(qty: number, unit: string | null): string {
  const trimmed = qty % 1 === 0 ? qty.toFixed(0) : qty.toString();
  return unit ? `${trimmed} ${unit}` : trimmed;
}

/**
 * Ajukan & lihat status Permohonan Pembelian sendiri — sebelum ini fitur
 * ini cuma bisa diajukan lewat Filament (dashboard web admin). Approve/
 * Reject/Fulfill TETAP cuma lewat Filament, layar ini murni ajukan &
 * pantau status. Dibangun saat audit fitur Permohonan Pembelian.
 */
export default function StaffPurchaseRequestsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [requests, setRequests] = useState<PurchaseRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [itemType, setItemType] = useState<ItemType>('raw_material');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogResults, setCatalogResults] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [assetName, setAssetName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRequests = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ data: PurchaseRequestRecord[] }>('/api/staff/purchase-requests');
      setRequests(res.data);
    } catch {
      setError('Gagal memuat riwayat permohonan. Periksa koneksi internet Anda.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadRequests().finally(() => setLoading(false));
  }, [loadRequests]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }, [loadRequests]);

  // Cari katalog Bahan Baku/Barang Habis Pakai (endpoint yang sama dipakai
  // menu Bahan Baku/Barang Habis Pakai) — Aset Baru tidak punya katalog
  // sama sekali (belum ada di stok), namanya diketik manual.
  useEffect(() => {
    if (itemType === 'asset') {
      setCatalogResults([]);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    const endpoint = itemType === 'raw_material' ? '/api/staff/materials' : '/api/staff/consumables';
    staffApiFetch<{ data: CatalogItem[] }>(`${endpoint}?search=${encodeURIComponent(catalogSearch)}`)
      .then((res) => { if (!cancelled) setCatalogResults(res.data); })
      .catch(() => { if (!cancelled) setCatalogResults([]); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [itemType, catalogSearch]);

  const openModal = () => {
    setItemType('raw_material');
    setCatalogSearch('');
    setCatalogResults([]);
    setSelectedItem(null);
    setAssetName('');
    setQuantity('1');
    setReason('');
    setModalVisible(true);
  };

  const switchType = (t: ItemType) => {
    setItemType(t);
    setSelectedItem(null);
    setCatalogSearch('');
  };

  const handleSubmit = useCallback(async () => {
    const qtyNum = parseFloat(quantity.replace(',', '.'));
    if (!qtyNum || qtyNum <= 0) {
      Alert.alert('Jumlah Tidak Valid', 'Isi jumlah barang yang diminta.');
      return;
    }
    if (itemType === 'asset' && !assetName.trim()) {
      Alert.alert('Nama Aset Wajib Diisi', 'Tuliskan nama aset/barang yang diminta.');
      return;
    }
    if (itemType !== 'asset' && !selectedItem) {
      Alert.alert('Barang Belum Dipilih', 'Cari dan pilih barang dari katalog terlebih dahulu.');
      return;
    }

    setSubmitting(true);
    try {
      await staffApiFetch('/api/staff/purchase-requests', {
        method: 'POST',
        body: JSON.stringify({
          item_type: itemType,
          item_id: itemType !== 'asset' ? selectedItem?.id : undefined,
          item_name: itemType === 'asset' ? assetName.trim() : undefined,
          quantity: qtyNum,
          reason: reason.trim() || undefined,
        }),
      });
      setModalVisible(false);
      Alert.alert('Berhasil', 'Permohonan pembelian terkirim, menunggu persetujuan admin.');
      loadRequests();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [itemType, selectedItem, assetName, quantity, reason, loadRequests]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Permohonan Pembelian</Text>
        <Pressable onPress={openModal} style={styles.sideButton}>
          <Ionicons name="add-circle" size={26} color={colors.accent} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={requests}
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
              <Ionicons name="cart-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>Belum ada permohonan pembelian.</Text>
              <Button label="Ajukan Permohonan" onPress={openModal} style={styles.emptyButton} />
            </View>
          }
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            return (
              <View style={styles.card}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardName} numberOfLines={1}>{item.item_name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: colors[meta.bg] }]}>
                    <Text style={[styles.statusBadgeText, { color: colors[meta.color] }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>
                  {ITEM_TYPE_LABEL[item.item_type]} · {formatQty(item.quantity, item.unit)} · {formatDate(item.created_at)}
                </Text>
                {item.reason ? <Text style={styles.cardReason} numberOfLines={2}>{item.reason}</Text> : null}
                {item.status === 'rejected' && item.review_note ? (
                  <View style={styles.reviewNoteBox}>
                    <Text style={styles.reviewNoteLabel}>Alasan ditolak:</Text>
                    <Text style={styles.reviewNoteText}>{item.review_note}</Text>
                  </View>
                ) : null}
                <Text style={styles.cardNumber}>{item.request_number}</Text>
              </View>
            );
          }}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ajukan Permohonan Pembelian</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Jenis Barang</Text>
            <View style={styles.typeRow}>
              {(Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeChip, itemType === t && styles.typeChipActive]}
                  onPress={() => switchType(t)}
                >
                  <Text style={[styles.typeChipText, itemType === t && styles.typeChipTextActive]}>{ITEM_TYPE_LABEL[t]}</Text>
                </Pressable>
              ))}
            </View>

            {itemType === 'asset' ? (
              <>
                <Text style={styles.fieldLabel}>Nama Aset / Barang yang Diminta</Text>
                <TextInput
                  style={styles.input}
                  value={assetName}
                  onChangeText={setAssetName}
                  placeholder="Contoh: Mesin Poles Baru"
                  placeholderTextColor={colors.textMuted}
                />
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Cari Barang</Text>
                <TextInput
                  style={styles.input}
                  value={selectedItem ? selectedItem.name : catalogSearch}
                  onChangeText={(text) => { setSelectedItem(null); setCatalogSearch(text); }}
                  placeholder="Ketik nama barang..."
                  placeholderTextColor={colors.textMuted}
                />
                {!selectedItem ? (
                  catalogLoading ? (
                    <ActivityIndicator style={{ marginVertical: spacing.sm }} color={colors.accent} />
                  ) : catalogResults.length > 0 ? (
                    <View style={styles.catalogList}>
                      {catalogResults.map((c) => (
                        <Pressable key={c.id} style={styles.catalogRow} onPress={() => { setSelectedItem(c); setCatalogSearch(''); }}>
                          <Text style={styles.catalogRowText}>{c.name}</Text>
                          {c.unit ? <Text style={styles.catalogRowUnit}>{c.unit}</Text> : null}
                        </Pressable>
                      ))}
                    </View>
                  ) : catalogSearch.length > 0 ? (
                    <Text style={styles.catalogEmpty}>Tidak ada barang cocok "{catalogSearch}".</Text>
                  ) : null
                ) : null}
              </>
            )}

            <Text style={styles.fieldLabel}>Jumlah{selectedItem?.unit ? ` (${selectedItem.unit})` : ''}</Text>
            <TextInput
              style={styles.input}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.fieldLabel}>Alasan / Catatan (opsional)</Text>
            <TextInput
              style={styles.textArea}
              value={reason}
              onChangeText={setReason}
              placeholder="Contoh: stok tinggal sedikit, dipakai rata-rata 5/minggu"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
            />

            <Button label="Kirim Permohonan" onPress={handleSubmit} loading={submitting} style={styles.submitButton} />
          </View>
        </View>
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
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.sm,
    },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: 4 },
    cardName: { flex: 1, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
    statusBadgeText: { fontSize: fontSize.xs, fontWeight: '700' },
    cardMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs, fontVariant: ['tabular-nums'] },
    cardReason: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.xs },
    reviewNoteBox: { backgroundColor: colors.dangerBg, borderRadius: radius.sm, padding: spacing.xs, marginBottom: spacing.xs },
    reviewNoteLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.danger },
    reviewNoteText: { fontSize: fontSize.xs, color: colors.danger },
    cardNumber: { fontSize: 10, color: colors.textMuted },
    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted },
    emptyButton: { marginTop: spacing.sm, paddingHorizontal: spacing.xl },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
      padding: spacing.lg, paddingBottom: spacing.xl, maxHeight: '88%',
    },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
    modalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
    fieldLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.sm },
    typeRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    typeChip: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    typeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    typeChipText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
    typeChipTextActive: { color: '#ffffff' },
    input: {
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.sm, color: colors.textPrimary,
    },
    textArea: {
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.sm, color: colors.textPrimary,
      minHeight: 80, textAlignVertical: 'top',
    },
    catalogList: {
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      marginTop: 4, maxHeight: 160,
    },
    catalogRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    catalogRowText: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    catalogRowUnit: { fontSize: fontSize.xs, color: colors.textMuted },
    catalogEmpty: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
    submitButton: { marginTop: spacing.lg },
  });
}
