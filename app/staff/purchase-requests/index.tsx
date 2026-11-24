import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Modal, TextInput, Alert, ScrollView, Switch } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';
import DateField from '@/components/ui/DateField';

type ItemType = 'raw_material' | 'consumable_item' | 'asset' | 'other';

// Satu barang dalam daftar permohonan yang sedang disusun (satu permohonan bisa berisi banyak barang).
interface DraftLine {
  key: string;
  item_type: 'raw_material' | 'other';
  item_id?: number;
  item_name: string;
  unit?: string;
  quantity: number;
}

interface PurchaseRequestRecord {
  id: number;
  request_number: string;
  group_number?: string | null;
  item_type: ItemType;
  item_name: string;
  unit: string | null;
  quantity: number;
  quantity_approved: number | null;
  is_mine: boolean;
  can_receive: boolean;
  can_record_stock: boolean;
  can_register_asset: boolean;
  effective_quantity: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled' | 'cancelled';
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
  other: 'Lainnya',
};

const TYPE_ICON: Record<ItemType, React.ComponentProps<typeof Ionicons>['name']> = {
  raw_material: 'flask-outline',
  consumable_item: 'layers-outline',
  asset: 'construct-outline',
  other: 'cube-outline',
};

// Jenis yang bisa diajukan dari aplikasi: Bahan Baku (dari katalog) atau Lainnya (barang di luar stok inventori, nama dan satuan diketik bebas).
const SUBMIT_TYPES: { value: 'raw_material' | 'other'; label: string }[] = [
  { value: 'raw_material', label: 'Bahan Baku' },
  { value: 'other', label: 'Lainnya' },
];

const STATUS_META: Record<PurchaseRequestRecord['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu Persetujuan', color: 'warning', bg: 'warningBg' },
  approved: { label: 'Disetujui', color: 'success', bg: 'successBg' },
  rejected: { label: 'Ditolak', color: 'danger', bg: 'dangerBg' },
  fulfilled: { label: 'Terpenuhi', color: 'textMuted', bg: 'surface' },
  cancelled: { label: 'Dibatalkan', color: 'textMuted', bg: 'surface' },
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
  const insets = useSafeAreaInsets();
  // Dari Beranda ("N permohonan menunggu diterima") layar langsung terbuka di filter Menunggu Diterima.
  const params = useLocalSearchParams<{ status?: string }>();
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved'>(params.status === 'approved' ? 'approved' : 'all');

  // Modal ini SEBELUMNYA sama sekali tidak punya penanganan keyboard
  // (tidak ada KeyboardAvoidingView atau apa pun) DAN tidak dibungkus
  // ScrollView — form (jenis, cari barang, jumlah, alasan, tombol Kirim)
  // bisa ketutup keyboard total & overflow melewati maxHeight:'88%' tanpa
  // cara discroll sama sekali. Pola yang sudah terbukti jalan di modal
  // lain (leave.tsx, memos/[id].tsx) dipakai lagi di sini: lacak tinggi
  // keyboard manual, dorong modalSheet naik via marginBottom, isi
  // dibungkus ScrollView. Ditemukan lewat audit modul Permohonan
  // Pembelian 2026-09-07.
  // Kartu diangkat tepat di atas keyboard tanpa mengangkat dua kali bila sistem sudah mengecilkan window modal (lihat lib/use-keyboard-lift.ts).
  const { keyboardVisible, lift, onBoxLayout } = useKeyboardLift();
  const styles = useMemo(
    () => createStyles(colors, keyboardVisible ? 0 : insets.bottom),
    [colors, insets.bottom, keyboardVisible]
  );

  const [requests, setRequests] = useState<PurchaseRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Izin Tambah pada menu ini; tanpa izin, tombol ajukan disembunyikan (server juga menolak).
  const [canCreate, setCanCreate] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // Terima Barang: gudang mengisi jumlah yang benar-benar sampai; stok/aset tercatat sekaligus bila akun berizin.
  const [receiveTarget, setReceiveTarget] = useState<PurchaseRequestRecord | null>(null);
  const [receiveQty, setReceiveQty] = useState('');
  const [receiveCost, setReceiveCost] = useState('');
  const [receiveExpiry, setReceiveExpiry] = useState('');
  const [recordStock, setRecordStock] = useState(true);
  const [registerAsset, setRegisterAsset] = useState(true);
  const [receiving, setReceiving] = useState(false);
  // Pemasok barang yang diterima (opsional): dicatat di permohonan sebagai riwayat pembelian per supplier.
  const [supplier, setSupplier] = useState<{ id: number; name: string } | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierResults, setSupplierResults] = useState<{ id: number; name: string }[]>([]);  const [modalVisible, setModalVisible] = useState(false);
  // Form ajukan: Bahan Baku (dari katalog) atau Lainnya (di luar stok inventori). Barang Habis Pakai dan Aset Baru tidak ditawarkan
  // (permintaan pemilik 2026-11-17); permohonan lama dengan jenis itu tetap tampil di daftar.
  const [itemType, setItemType] = useState<'raw_material' | 'other'>('raw_material');
  const [otherName, setOtherName] = useState('');
  const [otherUnit, setOtherUnit] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  // Daftar barang terbuka begitu kolom Cari Barang disentuh (tanpa harus mengetik dulu).
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogResults, setCatalogResults] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRequests = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ data: PurchaseRequestRecord[]; can_create?: boolean }>(`/api/staff/purchase-requests${statusFilter === 'approved' ? '?status=approved' : ''}`);
      setRequests(res.data);
      setCanCreate(res.can_create !== false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? err.message : 'Gagal memuat riwayat permohonan. Periksa koneksi internet.');
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    loadRequests().finally(() => setLoading(false));
  }, [loadRequests]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }, [loadRequests]);

  // Cari katalog Bahan Baku (endpoint yang sama dipakai menu Bahan Baku).
  // Dimuat begitu form terbuka (juga tanpa kata kunci), supaya daftar langsung ada saat kolom disentuh.
  useEffect(() => {
    if (!modalVisible || itemType !== 'raw_material') return;
    let cancelled = false;
    setCatalogLoading(true);
    staffApiFetch<{ data: CatalogItem[] }>(`/api/staff/materials?search=${encodeURIComponent(catalogSearch)}`)
      .then((res) => { if (!cancelled) setCatalogResults(res.data); })
      .catch(() => { if (!cancelled) setCatalogResults([]); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [catalogSearch, modalVisible, itemType]);

  const openModal = () => {
    setItemType('raw_material');
    setOtherName('');
    setOtherUnit('');
    setCatalogSearch('');
    setCatalogOpen(false);
    setCatalogResults([]);
    setSelectedItem(null);
    setQuantity('1');
    setDraft([]);
    setReason('');
    setModalVisible(true);
  };

  // Cari supplier aktif selagi modal Terima Barang terbuka (nama saja; kontak dan rekening tidak dikirim ke aplikasi).
  useEffect(() => {
    if (receiveTarget === null) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      staffApiFetch<{ data: { id: number; name: string }[] }>(`/api/staff/suppliers?search=${encodeURIComponent(supplierSearch.trim())}`)
        .then((res) => { if (!cancelled) setSupplierResults(res.data); })
        .catch(() => { if (!cancelled) setSupplierResults([]); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [receiveTarget, supplierSearch]);

  const openReceive = (item: PurchaseRequestRecord) => {
    setSupplier(null);
    setSupplierSearch('');
    setReceiveTarget(item);
    setReceiveQty(String(item.effective_quantity));
    setReceiveCost('');
    setReceiveExpiry('');
    setRecordStock(item.can_record_stock);
    setRegisterAsset(item.can_register_asset);
  };

  const submitReceive = async () => {
    if (!receiveTarget) return;
    const qty = parseFloat(receiveQty.replace(',', '.'));
    if (!qty || qty <= 0) {
      Alert.alert('Jumlah Tidak Valid', 'Isi jumlah barang yang benar-benar diterima.');
      return;
    }
    const cost = receiveCost.trim() === '' ? null : parseFloat(receiveCost.replace(/\./g, '').replace(',', '.'));
    if (cost !== null && (!cost || cost <= 0)) {
      Alert.alert('Biaya Tidak Valid', 'Kosongkan kalau belum tahu, atau isi total biaya yang benar.');
      return;
    }

    setReceiving(true);
    try {
      const res = await staffApiFetch<{ message: string }>(`/api/staff/purchase-requests/${receiveTarget.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          quantity_received: qty,
          record_stock: receiveTarget.can_record_stock ? recordStock : undefined,
          register_asset: receiveTarget.can_register_asset ? registerAsset : undefined,
          expiry_date: receiveTarget.item_type === 'raw_material' && recordStock && receiveExpiry ? receiveExpiry : undefined,
          actual_cost: cost ?? undefined,
          supplier_id: supplier?.id,
        }),
      });
      setReceiveTarget(null);
      Alert.alert('Berhasil', res.message);
      loadRequests();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
      loadRequests();
    } finally {
      setReceiving(false);
    }
  };

  // Batalkan permohonan sendiri selagi masih menunggu (salah jumlah/barang); yang sudah diproses tidak bisa dibatalkan.
  const cancelRequest = (item: PurchaseRequestRecord) => {
    Alert.alert('Batalkan Permohonan', `Batalkan permohonan ${item.item_name} (${item.request_number})?`, [
      { text: 'Tidak', style: 'cancel' },
      {
        text: 'Batalkan',
        style: 'destructive',
        onPress: async () => {
          setCancellingId(item.id);
          try {
            await staffApiFetch(`/api/staff/purchase-requests/${item.id}/cancel`, { method: 'POST' });
            await loadRequests();
          } catch (err) {
            Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
            loadRequests();
          } finally {
            setCancellingId(null);
          }
        },
      },
    ]);
  };

  // Isian barang yang sedang diketik: sudah terisi barang (katalog atau nama)?
  const currentFilled = itemType === 'raw_material' ? !!selectedItem : !!otherName.trim();

  // Memvalidasi isian saat ini menjadi satu baris; null (dengan peringatan) bila belum lengkap.
  const buildCurrentLine = useCallback((): DraftLine | null => {
    const qtyNum = parseFloat(quantity.replace(',', '.'));
    if (!qtyNum || qtyNum <= 0) {
      Alert.alert('Jumlah Tidak Valid', 'Isi jumlah barang yang diminta.');
      return null;
    }
    if (itemType === 'raw_material' && !selectedItem) {
      Alert.alert('Barang Belum Dipilih', 'Cari dan pilih barang dari katalog dulu.');
      return null;
    }
    if (itemType === 'other' && !otherName.trim()) {
      Alert.alert('Nama Barang Kosong', 'Isi nama barang yang diminta.');
      return null;
    }
    return {
      key: `${Date.now()}-${Math.random()}`,
      item_type: itemType,
      item_id: itemType === 'raw_material' ? selectedItem?.id : undefined,
      item_name: itemType === 'other' ? otherName.trim() : (selectedItem?.name ?? ''),
      unit: itemType === 'other' ? otherUnit.trim() || undefined : selectedItem?.unit ?? undefined,
      quantity: qtyNum,
    };
  }, [itemType, selectedItem, otherName, otherUnit, quantity]);

  // Tambahkan isian saat ini ke daftar, lalu kosongkan isian barang (alasan tetap) untuk barang berikutnya.
  const addToDraft = useCallback(() => {
    const line = buildCurrentLine();
    if (!line) return;
    if (line.item_id && draft.some((d) => d.item_type === line.item_type && d.item_id === line.item_id)) {
      Alert.alert('Barang Sudah Ada', 'Barang ini sudah ada di daftar. Hapus dulu atau ubah jumlahnya di sana.');
      return;
    }
    setDraft((d) => [...d, line]);
    setSelectedItem(null);
    setOtherName('');
    setOtherUnit('');
    setCatalogSearch('');
    setCatalogOpen(false);
    setQuantity('1');
  }, [buildCurrentLine, draft]);

  const handleSubmit = useCallback(async () => {
    // Daftar kosong: isian saat ini wajib lengkap. Daftar berisi: isian yang sudah diketik ikut ditambahkan, yang kosong diabaikan.
    const lines = [...draft];
    if (lines.length === 0 || currentFilled) {
      const line = buildCurrentLine();
      if (!line) return;
      if (line.item_id && lines.some((d) => d.item_type === line.item_type && d.item_id === line.item_id)) {
        Alert.alert('Barang Sudah Ada', 'Barang ini sudah ada di daftar. Hapus dulu atau ubah jumlahnya di sana.');
        return;
      }
      lines.push(line);
    }

    setSubmitting(true);
    try {
      const single = lines.length === 1;
      const first = lines[0];
      const res = await staffApiFetch<{ message?: string; group_number?: string }>('/api/staff/purchase-requests', {
        method: 'POST',
        body: JSON.stringify(
          single
            ? {
                item_type: first.item_type,
                item_id: first.item_id,
                item_name: first.item_type === 'other' ? first.item_name : undefined,
                unit: first.item_type === 'other' ? first.unit : undefined,
                quantity: first.quantity,
                reason: reason.trim() || undefined,
              }
            : {
                items: lines.map((l) => ({
                  item_type: l.item_type,
                  item_id: l.item_id,
                  item_name: l.item_type === 'other' ? l.item_name : undefined,
                  unit: l.item_type === 'other' ? l.unit : undefined,
                  quantity: l.quantity,
                })),
                reason: reason.trim() || undefined,
              }
        ),
      });
      setModalVisible(false);
      Alert.alert('Berhasil', single ? 'Permohonan pembelian terkirim, menunggu persetujuan admin.' : (res.message ?? `${lines.length} barang terkirim, menunggu persetujuan admin.`));
      loadRequests();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [draft, currentFilled, buildCurrentLine, reason, loadRequests]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>Permohonan Pembelian</Text>
        </View>
        {canCreate ? (
          <Pressable onPress={openModal} style={styles.addButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Ajukan permohonan pembelian">
            <Ionicons name="add" size={26} color="#ffffff" />
          </Pressable>
        ) : null}
      </View>

      {/* Filter: pola tab yang sama dengan halaman Bahan Baku (tab selebar layar, garis aksen di bawah tab terpilih). */}
      <View style={styles.tabs}>
        {([['all', 'Semua'], ['approved', 'Menunggu Diterima']] as const).map(([key, label]) => {
          const active = statusFilter === key;
          return (
            <Pressable key={key} style={styles.tab} onPress={() => setStatusFilter(key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{label}</Text>
              <View style={[styles.tabBar, active && styles.tabBarActive]} />
            </Pressable>
          );
        })}
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
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="cart-outline" size={34} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>{statusFilter === 'approved' ? 'Tidak ada yang menunggu' : 'Belum ada permohonan'}</Text>
              <Text style={styles.emptyText}>{statusFilter === 'approved' ? 'Permohonan yang sudah disetujui dan menunggu barang diterima muncul di sini.' : 'Ajukan permohonan pembelian bahan atau barang yang perlu dibeli.'}</Text>
              {canCreate && statusFilter === 'all' ? <Button label="Ajukan Permohonan" onPress={openModal} style={styles.emptyButton} /> : null}
            </View>
          }
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            const tone = colors[meta.color];
            const typeTone = item.item_type === 'raw_material'
              ? { fg: colors.accent, bg: colors.accentSoft }
              : item.item_type === 'consumable_item'
                ? { fg: colors.warning, bg: colors.warningBg }
                : item.item_type === 'other'
                  ? { fg: colors.textSecondary, bg: colors.surfaceElevated }
                  : { fg: colors.success, bg: colors.successBg };
            const hasApproved = item.quantity_approved !== null && item.quantity_approved !== undefined;
            return (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.typeIcon, { backgroundColor: typeTone.bg }]}>
                    <Ionicons name={TYPE_ICON[item.item_type]} size={20} color={typeTone.fg} />
                  </View>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardName} numberOfLines={2}>{item.item_name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>{ITEM_TYPE_LABEL[item.item_type]} · {formatDate(item.created_at)}</Text>
                  </View>
                </View>

                <View style={styles.statusRow}>
                  <View style={[styles.statusPill, { backgroundColor: colors[meta.bg] }]}>
                    <View style={[styles.statusDot, { backgroundColor: tone }]} />
                    <Text style={[styles.statusText, { color: tone }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.cardNumber} numberOfLines={1}>{item.group_number ? `${item.group_number} · ` : ''}{item.request_number}</Text>
                </View>

                <View style={styles.qtyPanel}>
                  <View style={styles.qtyCell}>
                    <Text style={styles.qtyLabel}>Diminta</Text>
                    <Text style={styles.qtyValue}>{formatQty(item.quantity, item.unit)}</Text>
                  </View>
                  {hasApproved ? (
                    <>
                      <View style={styles.qtyDivider} />
                      <View style={styles.qtyCell}>
                        <Text style={styles.qtyLabel}>Disetujui</Text>
                        <Text style={[styles.qtyValue, { color: colors.success }]}>{formatQty(item.quantity_approved as number, item.unit)}</Text>
                      </View>
                    </>
                  ) : null}
                </View>

                {item.reason ? <Text style={styles.cardReason} numberOfLines={2}>{item.reason}</Text> : null}
                {item.status === 'rejected' && item.review_note ? (
                  <View style={styles.reviewNoteBox}>
                    <Text style={styles.reviewNoteLabel}>Alasan ditolak</Text>
                    <Text style={styles.reviewNoteText}>{item.review_note}</Text>
                  </View>
                ) : null}

                {item.can_receive ? (
                  <Pressable style={styles.receiveBtn} onPress={() => openReceive(item)} hitSlop={8} accessibilityRole="button">
                    <Ionicons name="archive-outline" size={18} color="#ffffff" />
                    <Text style={styles.receiveBtnText}>Terima Barang</Text>
                  </Pressable>
                ) : null}
                {item.status === 'pending' && item.is_mine ? (
                  <Pressable style={styles.cancelBtn} onPress={() => cancelRequest(item)} disabled={cancellingId === item.id} hitSlop={8} accessibilityRole="button">
                    {cancellingId === item.id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <>
                        <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                        <Text style={styles.cancelBtnText}>Batalkan</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />
      )}

      <Modal visible={receiveTarget !== null} animationType="slide" transparent onRequestClose={() => setReceiveTarget(null)}>
        <View style={styles.modalOverlay} onLayout={onBoxLayout}>
          <View style={[styles.modalSheet, { marginBottom: lift }]}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Terima Barang</Text>
              <Pressable onPress={() => setReceiveTarget(null)} hitSlop={12} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Tutup">
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>
            {receiveTarget ? (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScrollContent}>
                <Text style={styles.receiveName}>{receiveTarget.item_name}</Text>
                <Text style={styles.cardMeta}>
                  {receiveTarget.request_number} · disetujui {formatQty(receiveTarget.effective_quantity, receiveTarget.unit)}
                </Text>

                <Text style={styles.fieldLabel}>Jumlah Diterima{receiveTarget.unit ? ` (${receiveTarget.unit})` : ''}</Text>
                <TextInput style={styles.input} value={receiveQty} onChangeText={setReceiveQty} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} />

                {receiveTarget.can_record_stock ? (
                  <>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Catat sebagai stok masuk sekarang</Text>
                      <Switch value={recordStock} onValueChange={setRecordStock} trackColor={{ true: colors.accent }} />
                    </View>
                    <Text style={styles.helper}>Matikan kalau barang ini sudah dicatat masuk lewat menu Bahan Baku, supaya tidak tercatat dua kali.</Text>
                    {receiveTarget.item_type === 'raw_material' && recordStock ? (
                      <>
                        <Text style={styles.fieldLabel}>Tanggal Kedaluwarsa Batch Ini (opsional)</Text>
                        <DateField value={receiveExpiry} onChange={setReceiveExpiry} placeholder="Pilih tanggal" allowClear colors={colors} />
                      </>
                    ) : null}
                  </>
                ) : null}

                {receiveTarget.can_register_asset ? (
                  <>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Daftarkan sebagai Aset Tetap sekarang</Text>
                      <Switch value={registerAsset} onValueChange={setRegisterAsset} trackColor={{ true: colors.accent }} />
                    </View>
                    <Text style={styles.helper}>Satu aset per unit yang diterima. Matikan kalau aset ini sudah didaftarkan manual.</Text>
                  </>
                ) : null}

                <Text style={styles.fieldLabel}>Supplier (opsional)</Text>
                {supplier ? (
                  <Pressable style={styles.supplierChosen} onPress={() => setSupplier(null)}>
                    <Text style={styles.supplierChosenText} numberOfLines={1}>{supplier.name}</Text>
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </Pressable>
                ) : (
                  <>
                    <TextInput style={styles.input} value={supplierSearch} onChangeText={setSupplierSearch} placeholder="Cari nama supplier..." placeholderTextColor={colors.textMuted} />
                    {supplierResults.length > 0 ? (
                      <View style={styles.supplierList}>
                        {supplierResults.slice(0, 6).map((s) => (
                          <Pressable key={s.id} style={styles.supplierRow} onPress={() => { setSupplier(s); setSupplierSearch(''); }}>
                            <Text style={styles.supplierRowText}>{s.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </>
                )}

                <Text style={styles.fieldLabel}>Total Biaya Aktual (opsional)</Text>
                <TextInput style={styles.input} value={receiveCost} onChangeText={setReceiveCost} keyboardType="decimal-pad" placeholder="Rp" placeholderTextColor={colors.textMuted} />

                <Button label="Terima Barang" onPress={submitReceive} loading={receiving} style={styles.submitButton} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay} onLayout={onBoxLayout}>
          <View style={[styles.modalSheet, { marginBottom: lift }]}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ajukan Permohonan Pembelian</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Tutup">
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScrollContent}>
            <Text style={styles.fieldLabel}>Jenis</Text>
            <View style={styles.typeRow}>
              {SUBMIT_TYPES.map((t) => {
                const active = itemType === t.value;

                return (
                  <Pressable key={t.value} style={[styles.typeOption, active && styles.typeOptionActive]} onPress={() => setItemType(t.value)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                    <Text style={[styles.typeOptionText, active && styles.typeOptionTextActive]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {itemType === 'raw_material' ? (
              <>
                <Text style={styles.fieldLabel}>Cari Barang</Text>
                <TextInput
                  style={styles.input}
                  value={selectedItem ? selectedItem.name : catalogSearch}
                  onChangeText={(text) => { setSelectedItem(null); setCatalogSearch(text); setCatalogOpen(true); }}
                  onFocus={() => setCatalogOpen(true)}
                  placeholder="Pilih atau cari barang..."
                  placeholderTextColor={colors.textMuted}
                />
                {catalogOpen && !selectedItem ? (
                  catalogLoading && catalogResults.length === 0 ? (
                    <ActivityIndicator style={{ marginVertical: spacing.sm }} color={colors.accent} />
                  ) : catalogResults.length > 0 ? (
                    <ScrollView style={styles.catalogList} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                      {catalogResults.map((c) => (
                        <Pressable key={c.id} style={styles.catalogRow} onPress={() => { setSelectedItem(c); setCatalogSearch(''); setCatalogOpen(false); }}>
                          <Text style={styles.catalogRowText}>{c.name}</Text>
                          {c.unit ? <Text style={styles.catalogRowUnit}>{c.unit}</Text> : null}
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : catalogSearch.length > 0 ? (
                    <Text style={styles.catalogEmpty}>Tidak ada barang cocok "{catalogSearch}".</Text>
                  ) : null
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Nama Barang</Text>
                <TextInput
                  style={styles.input}
                  value={otherName}
                  onChangeText={setOtherName}
                  placeholder="Mis. kursi ruang tunggu"
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.fieldLabel}>Satuan</Text>
                <TextInput
                  style={styles.input}
                  value={otherUnit}
                  onChangeText={setOtherUnit}
                  placeholder="Mis. buah, paket, lembar"
                  placeholderTextColor={colors.textMuted}
                  maxLength={30}
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Jumlah{itemType === 'other' ? (otherUnit.trim() ? ` (${otherUnit.trim()})` : '') : selectedItem?.unit ? ` (${selectedItem.unit})` : ''}</Text>
            <TextInput
              style={styles.input}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.textMuted}
            />

            <Pressable style={styles.addDraftBtn} onPress={addToDraft} accessibilityRole="button" accessibilityLabel="Tambahkan barang ke daftar permohonan">
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.addDraftText}>Tambah ke Daftar (barang lain)</Text>
            </Pressable>

            {draft.length > 0 ? (
              <View style={styles.draftBox}>
                <Text style={styles.draftTitle}>Daftar barang ({draft.length})</Text>
                {draft.map((d) => (
                  <View key={d.key} style={styles.draftRow}>
                    <Text style={styles.draftName} numberOfLines={2}>{d.item_name}</Text>
                    <Text style={styles.draftQty}>{formatQty(d.quantity, d.unit ?? null)}</Text>
                    <Pressable onPress={() => setDraft((list) => list.filter((x) => x.key !== d.key))} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Hapus ${d.item_name} dari daftar`}>
                      <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

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

            <Button label={draft.length > 0 ? `Kirim ${draft.length + (currentFilled ? 1 : 0)} Barang` : 'Kirim Permohonan'} onPress={handleSubmit} loading={submitting} style={styles.submitButton} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, insetsBottom: number) {
  // Palet netral yang sama dengan layar stok lain: kanvas abu sangat muda, kartu putih bersudut besar dengan bayangan halus, garis tipis.
  const isDark = colors.bg === darkColors.bg;
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const soft = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };
  const field = {
    backgroundColor: soft, borderRadius: 20, paddingHorizontal: 18, fontSize: fontSize.sm, color: colors.textPrimary,
  } as const;

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerText: { flex: 1 },
    title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.9, lineHeight: 32, color: colors.textPrimary },
    addButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },

    tabs: { flexDirection: 'row', marginHorizontal: 20, marginBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: line },
    tab: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 8 },
    tabText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    tabTextActive: { color: colors.textPrimary },
    tabBar: { height: 3, width: '60%', borderRadius: 2, backgroundColor: 'transparent' },
    tabBarActive: { backgroundColor: colors.accent },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.xxl, flexGrow: 1 },
    errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.dangerBg, borderRadius: 20, padding: 14, marginBottom: spacing.md },
    errorText: { flex: 1, color: colors.danger, fontSize: fontSize.sm, fontWeight: '600', lineHeight: 20 },

    card: { backgroundColor: card, borderRadius: 26, borderWidth: 1, borderColor: line, padding: 18, marginBottom: spacing.sm + 4, gap: 12, ...shadow },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    typeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    cardTitleWrap: { flex: 1, gap: 2 },
    cardName: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    cardMeta: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { fontSize: 12, fontWeight: '800' },
    cardNumber: { flexShrink: 1, fontSize: 12, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    qtyPanel: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, backgroundColor: soft, paddingVertical: 12, paddingHorizontal: 16 },
    qtyCell: { flex: 1, gap: 2 },
    qtyDivider: { width: 1, alignSelf: 'stretch', backgroundColor: line, marginHorizontal: 14 },
    qtyLabel: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.2, color: colors.textMuted },
    qtyValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    cardReason: { fontSize: fontSize.sm, lineHeight: 20, color: colors.textSecondary },
    reviewNoteBox: { backgroundColor: colors.dangerBg, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
    reviewNoteLabel: { fontSize: 11.5, fontWeight: '800', color: colors.danger },
    reviewNoteText: { fontSize: fontSize.sm, lineHeight: 19, color: colors.danger },
    receiveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 24, backgroundColor: colors.accent },
    receiveBtnText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '800' },
    cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 22, backgroundColor: colors.dangerBg },
    cancelBtnText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.danger },

    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.sm },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, marginBottom: spacing.xs, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    emptyText: { fontSize: fontSize.sm, lineHeight: 21, color: colors.textMuted, textAlign: 'center' },
    emptyButton: { marginTop: spacing.sm, paddingHorizontal: spacing.xl },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: colors.bg, borderTopLeftRadius: 32, borderTopRightRadius: 32,
      // paddingBottom + insetsBottom — tombol "Kirim Permohonan" SEBELUMNYA
      // ketutup navigation bar Android (gesture bar/tombol 3) karena Modal
      // RN tidak otomatis dapat inset bawah seperti SafeAreaView biasa.
      // Padding bawah SENGAJA 0: ruang di bawah tombol ada di dalam isi gulir (sheetScrollContent). Kalau ada di lembar, tepi area gulir memotong
      // tombol terakhir dan terlihat seperti ada pembatas di bawahnya.
      paddingHorizontal: 20, paddingTop: 20, paddingBottom: 0, maxHeight: '88%',
    },
    sheetScrollContent: { paddingBottom: spacing.xl + insetsBottom },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: line, alignSelf: 'center', marginBottom: spacing.sm },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
    modalTitle: { flex: 1, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
    modalCloseBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    fieldLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs + 2, marginTop: spacing.md },
    input: { ...field, height: 50 },
    typeRow: { flexDirection: 'row', gap: 8 },
    typeOption: { flex: 1, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: soft },
    typeOptionActive: { backgroundColor: colors.accent },
    typeOptionText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
    typeOptionTextActive: { color: '#ffffff' },
    textArea: { ...field, paddingTop: 14, paddingBottom: 14, minHeight: 96, textAlignVertical: 'top' },
    catalogList: { backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: line, marginTop: 6, maxHeight: 180, overflow: 'hidden' },
    catalogRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: line },
    catalogRowText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    catalogRowUnit: { fontSize: fontSize.xs, color: colors.textMuted },
    catalogEmpty: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 6 },
    addDraftBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: line },
    addDraftText: { fontSize: 14, fontWeight: '600', color: colors.accent },
    draftBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: line, gap: 8 },
    draftTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    draftRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    draftName: { flex: 1, fontSize: 14, color: colors.textPrimary },
    draftQty: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    submitButton: { marginTop: spacing.lg },

    receiveName: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    supplierChosen: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, height: 50, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft },
    supplierChosenText: { flex: 1, fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    supplierList: { marginTop: 6, borderRadius: 20, borderWidth: 1, borderColor: line, backgroundColor: card, overflow: 'hidden' },
    supplierRow: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: line },
    supplierRowText: { fontSize: fontSize.sm, color: colors.textPrimary },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md, padding: 14, borderRadius: 20, backgroundColor: soft },
    switchLabel: { flex: 1, fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    helper: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: 6 },
  });
}
