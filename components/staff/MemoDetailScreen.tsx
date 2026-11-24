import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { Skeleton } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius, shadow } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';
import BookingPicker, { BookingOption } from '@/components/staff/BookingPicker';

// Tautan memo ke booking disembunyikan dulu (2026-11-17); ubah ke true untuk menampilkannya lagi. Tautan yang sudah ada tidak diubah.
const SHOW_BOOKING_LINK = false;
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
  created_at: string;
}

interface MemoDetail {
  id: number;
  store_id: number;
  booking: { id: number; booking_number: string; customer_name: string | null } | null;
  memo_number: string;
  vehicle_info: string | null;
  spk_number: string | null;
  notes: string | null;
  creator: { name: string } | null;
  store: { name: string } | null;
  items: MemoItem[];
  // Hanya ada pada memo pengajuan installer (mode 'request').
  request_status?: string;
  request_status_label?: string | null;
  request_note?: string | null;
  reject_reason?: string | null;
  is_locked?: boolean;
  can_approve?: boolean;
  can_hand_over?: boolean;
  can_record_return?: boolean;
  can_request_more?: boolean;
}

interface SearchResult {
  id: number;
  name: string;
  unit?: string;
  subtitle?: string;
  stockInfo?: string;
  lowStock?: boolean;
  // Bahan baku dengan Kelipatan Pengambilan: jumlah diatur dengan tombol + dan -. Opsional: server lama belum mengirimnya.
  withdrawalMultiple?: number;
  stock?: number;
}

const TYPE_LABEL: Record<ItemType, string> = {
  raw_material: 'Bahan Baku',
  consumable_item: 'Barang Habis Pakai',
  inventory_item: 'PPF/WF',
};

const TYPE_ICON: Record<ItemType, ComponentProps<typeof Ionicons>['name']> = {
  raw_material: 'flask-outline',
  consumable_item: 'layers-outline',
  inventory_item: 'film-outline',
};

// Keterangan di bawah nama jenis pada langkah 1. Bahan Baku dan PPF/WF sengaja tanpa keterangan (permintaan pemilik 2026-11-17).
const TYPE_DESC: Partial<Record<ItemType, string>> = {
  consumable_item: 'Barang pakai habis, mis. lap, sarung tangan, tisu',
};

function n(v: string | null): number {
  return v === null ? 0 : parseFloat(v);
}

function formatItemDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function MemoDetailScreen({ mode = 'direct' }: { mode?: 'direct' | 'request' }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  // SafeAreaView di sini SENGAJA edges={['top','left','right']} (tanpa
  // 'bottom') — jadi tombol "Tambah Barang" (posisi absolute di bawah)
  // tidak ikut dijauhkan dari navigasi gesture Android secara otomatis.
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Barang Habis Pakai bisa dimatikan server (FEATURE_CONSUMABLES): jenisnya hanya ditawarkan bila akun punya aksesnya.
  const { staff } = useStaffAuth();
  const isDark = theme === 'dark';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const styles = useMemo(() => createStyles(colors, insets.bottom, isDark), [colors, insets.bottom, isDark]);

  // Kartu modal diangkat tepat di atas keyboard (lihat lib/use-keyboard-lift.ts). KeyboardAvoidingView bawaan RN tidak bisa diandalkan untuk Modal di
  // Android (window terpisah), dan mengangkat sebesar tinggi keyboard secara membabi buta menjadi dua kali lipat bila sistem sudah mengecilkan
  // window-nya: kartu melayang jauh di atas keyboard. Hook ini mengukur dulu seberapa banyak window sudah mengecil.
  const { keyboardVisible, lift, onBoxLayout } = useKeyboardLift();
  // Saat keyboard tampil, padding bawah untuk area gesture sistem dibuang: keyboard sudah menutupinya, jadi tombol langsung menempel di atasnya.
  const aboveKeyboard = keyboardVisible ? { paddingBottom: 20 } : null;

  const [memo, setMemo] = useState<MemoDetail | null>(null);
  // Mode 'request' = memo pengajuan installer: tampilan sama dengan memo langsung, pencatatan lewat endpoint penyerahan gudang, plus status
  // persetujuan dan tombol Setujui/Tolak/Selesai Diserahkan/Minta Tambahan (aturan siapa boleh apa ada di server).
  const isRequest = mode === 'request';
  const [requestBusy, setRequestBusy] = useState(false);
  const [reqPrompt, setReqPrompt] = useState<null | { key: 'reject' | 'more'; title: string; label: string; confirm: string }>(null);
  const [reqPromptValue, setReqPromptValue] = useState('');
  // Akun yang hanya boleh melihat memo tidak diberi tombol tambah/koreksi/kembalikan/hapus (server juga menolak).
  const [canModify, setCanModify] = useState(false);
  // Koreksi jumlah diambil dan pengembalian hanya oleh akses penuh (server juga menolak yang lain).
  const [canCorrect, setCanCorrect] = useState(false);
  // Memo buatan gudang sendiri bisa ditutup setelah pengambilan pertama; pengambilan berikutnya lewat Minta Tambahan (admin atau spv finance).
  const [canClose, setCanClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memo pengajuan: gudang boleh mengubah barang hanya selagi disetujui dan belum terkunci; bendera datang bersama memonya.
  useEffect(() => {
    if (!isRequest || !memo) return;
    const editable = memo.can_hand_over === true && memo.is_locked !== true;
    setCanModify(editable);
    setCanCorrect(editable);
    setCanClose(false);
  }, [isRequest, memo]);

  const fetchMemo = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ data: MemoDetail; can_modify?: boolean; can_correct?: boolean; can_close?: boolean }>(isRequest ? `/api/staff/memos/${id}/request` : `/api/staff/memos/${id}`);
      setMemo(res.data);
      if (!isRequest) {
        setCanModify(res.can_modify === true);
        setCanCorrect(res.can_correct === true);
        setCanClose(res.can_close === true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat memo.');
    }
  }, [id, isRequest]);

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

  // Langkah + dan -: sebesar kelipatan, minimal satu kelipatan dan tidak melebihi stok.
  const stepMulti = (item: SearchResult, direction: 1 | -1) => {
    const multiple = item.withdrawalMultiple ?? 0;
    if (!(multiple > 0)) return;
    const current = parseFloat(multiQty[item.id] ?? '') || 0;
    const next = Math.round((current + direction * multiple) * 10000) / 10000;
    if (next < multiple || (item.stock !== undefined && next > item.stock + 1e-9)) return;
    hapticLight();
    setMultiQty((prev) => ({ ...prev, [item.id]: String(next) }));
  };

  const toggleMultiSelect = (item: SearchResult) => {
    hapticLight();
    setSelectedMulti((prev) =>
      prev.some((s) => s.id === item.id) ? prev.filter((s) => s.id !== item.id) : [...prev, item]
    );
  };

  // Batal-pilih 1 barang saat sudah di step isi jumlah (bukan cuma pas
  // masih di daftar centang) — kalau ternyata cuma tersisa 1 barang lalu
  // itu juga dibatalkan, otomatis balik ke step pencarian.
  const removeFromMultiQty = (itemId: number) => {
    hapticLight();
    setSelectedMulti((prev) => {
      const next = prev.filter((s) => s.id !== itemId);
      if (next.length === 0) setMultiQtyStep(false);
      return next;
    });
    setMultiQty((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const openAddModal = () => {
    resetAddModal();
    setAddVisible(true);
  };

  // Kembali dari langkah 2 (cari dan pilih barang) ke langkah 1 (pilih jenis). Langkah 3 punya tombol kembali sendiri di footernya; header modal
  // sengaja tanpa tombol kembali (keputusan pemilik 2026-11-17), jadi langkah 2 mendapat tombol yang sama di footer, di kiri tombol Lanjut.
  const backToTypeStep = () => {
    hapticLight();
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
                withdrawalMultiple: addType === 'raw_material' && parseFloat(raw.withdrawal_multiple ?? '') > 0 ? parseFloat(raw.withdrawal_multiple) : undefined,
                stock: currentStock,
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

      const res = await staffApiFetch<{ data: MemoDetail }>(isRequest ? `/api/staff/memos/${id}/handover` : `/api/staff/memos/${id}/items`, {
        method: 'POST',
        body: JSON.stringify(isRequest
          ? { item_type: addType, item_id: selected.id, note: conditionNotes.trim() || undefined, ...(addType !== 'inventory_item' ? { qty } : {}) }
          : body),
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
        const res = await staffApiFetch<{ data: MemoDetail }>(isRequest ? `/api/staff/memos/${id}/handover` : `/api/staff/memos/${id}/items`, {
          method: 'POST',
          body: JSON.stringify(isRequest
            ? { item_type: addType, item_id: item.id, qty, note: conditionNotes.trim() || undefined }
            : { item_type: addType, item_id: item.id, qty_taken: qty, condition_notes: conditionNotes.trim() || null }),
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
  // Mode koreksi: mengganti pengembalian yang sudah tercatat (alasan wajib; stok disesuaikan sebesar selisihnya).
  const [correcting, setCorrecting] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const openReturnModal = (item: MemoItem) => {
    setCorrecting(false);
    setReturnNote('');
    setReturnTarget(item);
    setReturnQtyInput('0');
    setReturnError(null);
  };

  const openCorrectModal = (item: MemoItem) => {
    setCorrecting(true);
    setReturnNote('');
    setReturnTarget(item);
    setReturnQtyInput(item.qty_returned ?? '');
    setReturnError(null);
  };

  const submitReturn = async (qty: number) => {
    if (!returnTarget) return;
    setReturnSubmitting(true);
    setReturnError(null);
    try {
      const res = await staffApiFetch<{ data: MemoDetail }>(isRequest ? `/api/staff/memos/${id}/handover/${returnTarget.id}/return` : `/api/staff/memos/${id}/items/${returnTarget.id}/${correcting ? 'correct-return' : 'return'}`, {
        method: 'POST',
        body: JSON.stringify({
          ...(correcting ? { note: returnNote.trim() } : {}),
          qty_returned: qty,
        }),
      });
      hapticSuccess();
      setMemo(res.data);
      setReturnTarget(null);
      Alert.alert('Berhasil', correcting ? 'Pengembalian dikoreksi.' : 'Pengembalian berhasil dicatat.');
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

    if (correcting) {
      if (returnNote.trim() === '') {
        setReturnError('Isi alasan koreksi.');
        return;
      }
      if (Math.abs(qty - n(returnTarget.qty_returned)) < 0.005) {
        setReturnError('Jumlahnya sama dengan yang sudah tercatat.');
        return;
      }
      Alert.alert(
        'Koreksi Pengembalian',
        `Pengembalian diubah dari ${n(returnTarget.qty_returned).toLocaleString('id-ID')} menjadi ${qty.toLocaleString('id-ID')} ${returnTarget.unit ?? ''}. Stok disesuaikan sebesar selisihnya. Lanjutkan?`,
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Koreksi', onPress: () => submitReturn(qty) },
        ]
      );
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
      const body = isRequest ? { qty } : editTarget.item_type === 'inventory_item' ? { meters_used: qty } : { qty_taken: qty };
      const res = await staffApiFetch<{ data: MemoDetail }>(isRequest ? `/api/staff/memos/${id}/handover/${editTarget.id}` : `/api/staff/memos/${id}/items/${editTarget.id}`, {
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
      const res = await staffApiFetch<{ data: MemoDetail }>(isRequest ? `/api/staff/memos/${id}/handover/${item.id}` : `/api/staff/memos/${id}/items/${item.id}`, {
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

  const typeColor = (t: ItemType) =>
    t === 'raw_material' ? colors.accent : t === 'consumable_item' ? colors.warning : colors.success;
  const typeColorBg = (t: ItemType) =>
    t === 'raw_material' ? colors.accentSoft : t === 'consumable_item' ? colors.warningBg : colors.successBg;

  // ── Edit info memo (vehicle_info/spk_number/notes) ─────────────────
  const [editInfoVisible, setEditInfoVisible] = useState(false);
  const [editVehicleInfo, setEditVehicleInfo] = useState('');
  const [editSpkNumber, setEditSpkNumber] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editBooking, setEditBooking] = useState<BookingOption | MemoDetail['booking']>(null);
  const [editInfoSubmitting, setEditInfoSubmitting] = useState(false);
  const [editInfoError, setEditInfoError] = useState<string | null>(null);

  const openEditInfoModal = () => {
    if (!memo) return;
    setEditVehicleInfo(memo.vehicle_info ?? '');
    setEditSpkNumber(memo.spk_number ?? '');
    setEditNotes(memo.notes ?? '');
    setEditBooking(memo.booking ?? null);
    setEditInfoError(null);
    setEditInfoVisible(true);
  };

  const submitEditInfo = async () => {
    if (editInfoSubmitting) return;
    setEditInfoSubmitting(true);
    setEditInfoError(null);
    try {
      const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          vehicle_info: editVehicleInfo.trim() || null,
          spk_number: editSpkNumber.trim() || null,
          notes: editNotes.trim() || null,
          booking_id: editBooking?.id ?? null,
        }),
      });
      hapticSuccess();
      setMemo(res.data);
      setEditInfoVisible(false);
    } catch (err) {
      hapticError();
      setEditInfoError(err instanceof ApiError ? err.message : 'Gagal memperbarui info memo.');
    } finally {
      setEditInfoSubmitting(false);
    }
  };

  // ── Hapus memo utuh ─────────────────────────────────────────────────
  const [deletingMemo, setDeletingMemo] = useState(false);

  const submitDeleteMemo = async () => {
    setDeletingMemo(true);
    try {
      await staffApiFetch(`/api/staff/memos/${id}`, { method: 'DELETE' });
      hapticSuccess();
      Alert.alert('Berhasil', 'Memo berhasil dihapus.');
      router.replace('/staff/memos' as never);
    } catch (err) {
      hapticError();
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menghapus memo.');
      setDeletingMemo(false);
    }
  };

  const handleDeleteMemo = () => {
    if (!memo || deletingMemo) return;
    Alert.alert(
      'Hapus Memo Ini?',
      `Semua ${memo.items.length} barang dikembalikan ke stok, lalu memo dihapus permanen. Tidak bisa dibatalkan.`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Hapus Memo', style: 'destructive', onPress: submitDeleteMemo },
      ]
    );
  };

  const submitCloseMemo = async () => {
    setClosing(true);
    try {
      await staffApiFetch(`/api/staff/memos/${id}/close`, { method: 'POST' });
      hapticSuccess();
      Alert.alert('Memo ditutup', 'Pengambilan berikutnya perlu persetujuan admin atau spv finance.');
      await fetchMemo();
    } catch (err) {
      hapticError();
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menutup memo.');
    } finally {
      setClosing(false);
    }
  };

  const handleCloseMemo = () => {
    if (!memo || closing) return;
    Alert.alert(
      'Tutup Memo Ini?',
      'Setelah ditutup, barang dan jumlahnya terkunci. Pengambilan berikutnya perlu persetujuan admin atau spv finance, lalu dicatat oleh mereka.',
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Tutup Memo', onPress: submitCloseMemo },
      ]
    );
  };

  const unreturnedCount = memo ? memo.items.filter((it) => it.item_type !== 'inventory_item' && it.qty_returned === null).length : 0;

  // ---- Memo pengajuan: setujui, tolak, selesai diserahkan, minta tambahan / ajukan ulang
  const actRequest = async (path: string, body?: object): Promise<boolean> => {
    setRequestBusy(true);
    try {
      const res = await staffApiFetch<{ data: MemoDetail }>(`/api/staff/memos/${id}${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setMemo(res.data);
      hapticSuccess();
      return true;
    } catch (err) {
      hapticError();
      Alert.alert('Belum Berhasil', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
      return false;
    } finally {
      setRequestBusy(false);
    }
  };

  const confirmReqPrompt = async () => {
    if (!reqPrompt) return;
    const value = reqPromptValue.trim();
    if (value === '') {
      Alert.alert('Isi Dulu', 'Isi teksnya dulu.');
      return;
    }
    const ok = reqPrompt.key === 'reject' ? await actRequest('/reject', { reason: value }) : await actRequest('/resubmit', { note: value });
    if (ok) setReqPrompt(null);
  };

  const confirmComplete = () => {
    Alert.alert(
      'Selesai Diserahkan?',
      'Setelah ini barang dan jumlahnya terkunci dan tidak bisa diubah lagi. Pengambilan berikutnya perlu persetujuan admin atau spv finance.',
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Selesai', onPress: () => actRequest('/complete') },
      ]
    );
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Satu kartu per barang: pengambilan berulang atas barang yang sama digabung, riwayatnya bisa dibuka. Yang belum dikembalikan di atas.
  const groups = useMemo(() => {
    const map = new Map<string, MemoItem[]>();
    for (const it of memo?.items ?? []) {
      const key = it.item_type + '|' + it.item_name + '|' + (it.unit ?? '');
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    const pending = (g: MemoItem[]) => g.some((it) => it.item_type !== 'inventory_item' && it.qty_returned === null);
    return Array.from(map.entries())
      .map(([key, entries]) => ({ key, entries }))
      .sort((a, b) => Number(pending(b.entries)) - Number(pending(a.entries)));
  }, [memo]);

  const renderGroup = ({ item: group, index }: { item: { key: string; entries: MemoItem[] }; index: number }) => {
    if (group.entries.length === 1) return renderEntry(group.entries[0], index, false, 0);

    const first = group.entries[0];
    const tColor = typeColor(first.item_type);
    const isInv = first.item_type === 'inventory_item';
    const sum = (f: (it: MemoItem) => string | null) => group.entries.reduce((t, it) => t + n(f(it)), 0);
    const allReturned = group.entries.every((it) => it.qty_returned !== null);
    const someReturned = group.entries.some((it) => it.qty_returned !== null);
    const open = !!expandedGroups[group.key];
    const fmt = (v: number) => String(Math.round(v * 100) / 100);

    return (
      <FadeInUp index={index} enabled={index < 8}>
        <View style={styles.itemRow}>
          <View style={styles.itemHeader}>
            <View style={[styles.itemIconWrap, { backgroundColor: typeColorBg(first.item_type) }]}>
              <Ionicons name={TYPE_ICON[first.item_type]} size={20} color={tColor} />
            </View>
            <View style={styles.itemTitleWrap}>
              <Text style={styles.itemName} numberOfLines={2}>{first.item_name}</Text>
              <Text style={[styles.itemTypeLabel, { color: tColor }]}>{TYPE_LABEL[first.item_type]}</Text>
            </View>
          </View>

          <View style={styles.qtyPanel}>
            {isInv ? (
              <View style={styles.qtyCell}>
                <Text style={styles.qtyLabel}>Total Dipakai</Text>
                <Text style={styles.qtyValue}>{fmt(sum((it) => it.meters_used))} <Text style={styles.qtyUnit}>meter</Text></Text>
              </View>
            ) : (
              <>
                <View style={styles.qtyCell}>
                  <Text style={styles.qtyLabel}>Total Diambil</Text>
                  <Text style={styles.qtyValue}>{fmt(sum((it) => it.qty_taken))} <Text style={styles.qtyUnit}>{first.unit}</Text></Text>
                </View>
                <View style={styles.qtyDivider} />
                <View style={styles.qtyCell}>
                  <Text style={styles.qtyLabel}>Kembali</Text>
                  {someReturned ? (
                    <Text style={styles.qtyValue}>{fmt(sum((it) => it.qty_returned))} <Text style={styles.qtyUnit}>{first.unit}</Text></Text>
                  ) : (
                    <Text style={styles.qtyMissing}>Belum</Text>
                  )}
                </View>
                <View style={styles.qtyDivider} />
                <View style={styles.qtyCell}>
                  <Text style={styles.qtyLabel}>Terpakai</Text>
                  {allReturned ? (
                    <Text style={[styles.qtyValue, { color: accentText }]}>{fmt(sum((it) => it.qty_used))} <Text style={styles.qtyUnit}>{first.unit}</Text></Text>
                  ) : (
                    <Text style={styles.qtyMissing}>—</Text>
                  )}
                </View>
              </>
            )}
          </View>

          <PressableScale
            style={styles.groupToggleBtn}
            onPress={() => setExpandedGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
          >
            <View style={styles.groupToggleTextWrap}>
              <Text style={styles.groupToggleTitle}>Lihat riwayat ·{group.entries.length} kali ambil</Text>
            </View>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textPrimary} />
          </PressableScale>

          {open ? group.entries.map((entry, i) => renderEntry(entry, i, true, i + 1)) : null}
        </View>
      </FadeInUp>
    );
  };

  // Pengembalian bahan tetap bisa dicatat setelah memo pengajuan terkunci (Selesai Diserahkan): itu fakta baru, bukan mengubah penyerahan.
  const canRecordReturn = isRequest
    ? memo?.can_record_return === true
    : canModify;

  const renderEntry = (item: MemoItem, index: number, nested: boolean, ordinal: number) => {
    const needsReturn = item.item_type !== 'inventory_item' && item.qty_returned === null;
    const tColor = typeColor(item.item_type);
    const body = (
        <View style={nested ? styles.entryNested : styles.itemRow}>
          <View style={styles.itemHeader}>
            {nested ? (
              <View style={styles.itemTitleWrap}>
                <Text style={styles.itemName}>Pengambilan ke-{ordinal}</Text>
              </View>
            ) : (
              <>
                <View style={[styles.itemIconWrap, { backgroundColor: typeColorBg(item.item_type) }]}>
                  <Ionicons name={TYPE_ICON[item.item_type]} size={20} color={tColor} />
                </View>
                <View style={styles.itemTitleWrap}>
                  <Text style={styles.itemName} numberOfLines={2}>{item.item_name}</Text>
                  <Text style={[styles.itemTypeLabel, { color: tColor }]}>{TYPE_LABEL[item.item_type]}</Text>
                </View>
              </>
            )}
            {canCorrect && canEditItem(item) && (
              <Pressable onPress={() => openEditModal(item)} hitSlop={8} disabled={deletingId === item.id} style={styles.itemActionBtn} accessibilityRole="button" accessibilityLabel="Koreksi jumlah">
                <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
              </Pressable>
            )}
            {canModify && (
              <Pressable onPress={() => handleDelete(item)} hitSlop={8} disabled={deletingId === item.id} style={styles.itemActionBtn} accessibilityRole="button" accessibilityLabel="Hapus barang">
                {deletingId === item.id ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                )}
              </Pressable>
            )}
          </View>

          {item.item_type === 'inventory_item' ? (
            <View style={styles.qtyPanel}>
              <View style={styles.qtyCell}>
                <Text style={styles.qtyLabel}>Dipakai</Text>
                <Text style={styles.qtyValue}>{item.meters_used} <Text style={styles.qtyUnit}>meter</Text></Text>
              </View>
            </View>
          ) : (
            <View style={styles.qtyPanel}>
              <View style={styles.qtyCell}>
                <Text style={styles.qtyLabel}>Diambil</Text>
                <Text style={styles.qtyValue}>{item.qty_taken} <Text style={styles.qtyUnit}>{item.unit}</Text></Text>
              </View>
              <View style={styles.qtyDivider} />
              <View style={styles.qtyCell}>
                <Text style={styles.qtyLabel}>Kembali</Text>
                {item.qty_returned === null ? (
                  <Text style={styles.qtyMissing}>Belum</Text>
                ) : (
                  <Text style={styles.qtyValue}>{item.qty_returned} <Text style={styles.qtyUnit}>{item.unit}</Text></Text>
                )}
              </View>
              <View style={styles.qtyDivider} />
              <View style={styles.qtyCell}>
                <Text style={styles.qtyLabel}>Terpakai</Text>
                {item.qty_used !== null ? (
                  <Text style={[styles.qtyValue, { color: accentText }]}>{item.qty_used} <Text style={styles.qtyUnit}>{item.unit}</Text></Text>
                ) : (
                  <Text style={styles.qtyMissing}>—</Text>
                )}
              </View>
            </View>
          )}

          {item.condition_notes ? <Text style={styles.itemNotes}>{item.condition_notes}</Text> : null}

          <View style={styles.itemFooter}>
            <View style={styles.itemTimeRow}>
              <Ionicons name="time-outline" size={13} color={colors.textMuted} />
              <Text style={styles.itemTimeText}>Diambil {formatItemDate(item.created_at)}</Text>
            </View>
            {needsReturn && !canModify ? (
              <View style={styles.pendingPill}>
                <Text style={styles.pendingPillText}>Masih digunakan</Text>
              </View>
            ) : null}
          </View>

          {needsReturn && canRecordReturn && (
            <PressableScale style={styles.returnBtn} onPress={() => openReturnModal(item)} accessibilityRole="button">
              <Ionicons name="arrow-undo-outline" size={16} color={accentText} />
              <Text style={styles.returnBtnText}>Catat Pengembalian</Text>
            </PressableScale>
          )}

          {item.item_type !== 'inventory_item' && item.qty_returned !== null && canCorrect && !isRequest && (
            <Pressable style={styles.correctBtn} onPress={() => openCorrectModal(item)} hitSlop={8} accessibilityRole="button">
              <Ionicons name="create-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.correctBtnText}>Koreksi Pengembalian</Text>
            </Pressable>
          )}
        </View>
    );
    return nested ? <React.Fragment key={item.id}>{body}</React.Fragment> : <FadeInUp key={item.id} index={index} enabled={index < 8}>{body}</FadeInUp>;
  };

  // Info kendaraan tersimpan sebagai "Merek Model – PLAT": dipisah supaya merek jadi judul dan plat tampil seperti pelat nomor.
  const vehicleParts = (() => {
    const raw = (memo?.vehicle_info ?? '').trim();
    if (!raw) return { brand: '', plate: '' };
    const m = raw.match(/^(.*?)\s+[–—-]\s+([^–—-]+)$/);
    return m ? { brand: m[1].trim(), plate: m[2].trim().toUpperCase() } : { brand: raw, plate: '' };
  })();

  const listHeader = memo ? (
    <View style={styles.listHeader}>
      <View style={styles.infoCard}>
        <Text style={styles.memoNameText} selectable>{memo.memo_number}</Text>
        <View style={styles.vehicleRow}>
          <Text style={[styles.infoCardTitle, !vehicleParts.brand && styles.infoCardTitleEmpty, { flexShrink: 1 }]} numberOfLines={2}>
            {vehicleParts.brand || 'Tanpa info kendaraan'}
          </Text>
          {vehicleParts.plate ? (
            <View style={styles.plateBadge}>
              <Text style={styles.plateText}>{vehicleParts.plate}</Text>
            </View>
          ) : null}
        </View>
        {memo.spk_number ? (
          <View style={styles.spkRow}>
            <Ionicons name="document-text-outline" size={15} color={colors.textMuted} />
            <Text style={styles.spkLabel}>No. SPK</Text>
            <Text style={styles.spkValue} selectable>{memo.spk_number}</Text>
          </View>
        ) : null}
        {SHOW_BOOKING_LINK && memo.booking ? (
          <View style={styles.bookingPill}>
            <Ionicons name="link-outline" size={14} color={accentText} />
            <Text style={styles.bookingPillText} numberOfLines={1}>
              {memo.booking.booking_number}{memo.booking.customer_name ? ` · ${memo.booking.customer_name}` : ''}
            </Text>
          </View>
        ) : null}
        <View style={styles.infoRow}>
          <Ionicons name="storefront-outline" size={14} color={colors.textMuted} />
          <Text style={styles.infoText}>{memo.store?.name ?? '—'}</Text>
          <Text style={styles.infoDot}>·</Text>
          <Ionicons name="person-outline" size={14} color={colors.textMuted} />
          <Text style={styles.infoText}>{memo.creator?.name ?? '—'}</Text>
        </View>
        {memo.notes ? (
          <View style={styles.noteBox}>
            <Ionicons name="chatbox-ellipses-outline" size={15} color={colors.textMuted} />
            <Text style={styles.noteText}>{memo.notes}</Text>
          </View>
        ) : null}
        <View style={styles.statRow}>
          <View style={styles.statChip}>
            <Ionicons name="cube-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.statChipText}>{groups.length} barang</Text>
          </View>
          {unreturnedCount > 0 ? (
            <View style={[styles.statChip, { backgroundColor: colors.warningBg }]}>
              <Ionicons name="time-outline" size={14} color={colors.warning} />
              <Text style={[styles.statChipText, { color: colors.warning }]}>{unreturnedCount} masih digunakan</Text>
            </View>
          ) : memo.items.length > 0 ? (
            <View style={[styles.statChip, { backgroundColor: colors.successBg }]}>
              <Ionicons name="checkmark-circle-outline" size={14} color={colors.success} />
              <Text style={[styles.statChipText, { color: colors.success }]}>Semua sudah kembali</Text>
            </View>
          ) : null}
        </View>
      </View>
      {memo.items.length > 0 ? <Text style={styles.listSectionTitle}>Daftar Barang</Text> : null}
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>{isRequest ? 'Pengajuan Memo' : 'Memo Barang'}</Text>
        </View>
        {memo && canModify && !isRequest ? (
          <Pressable onPress={openEditInfoModal} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit info memo">
            <Ionicons name="pencil" size={18} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        {memo && canClose ? (
          <Pressable onPress={handleCloseMemo} style={styles.roundButton} disabled={closing} hitSlop={8} accessibilityRole="button" accessibilityLabel="Tutup memo">
            {closing ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Ionicons name="lock-closed-outline" size={18} color={colors.textPrimary} />}
          </Pressable>
        ) : null}
        {memo && !isRequest ? (
          <Pressable onPress={handleDeleteMemo} style={[styles.roundButton, { backgroundColor: colors.dangerBg }]} disabled={deletingMemo} hitSlop={8} accessibilityRole="button" accessibilityLabel="Hapus memo">
            {deletingMemo ? <ActivityIndicator size="small" color={colors.danger} /> : <Ionicons name="trash-outline" size={18} color={colors.danger} />}
          </Pressable>
        ) : null}
      </View>

      {isRequest && memo && !(memo.request_status === 'approved' && memo.items.length > 0 && !memo.request_note && !memo.is_locked) ? (
        <View style={[styles.reqStatusCard, memo.request_status === 'rejected' ? styles.reqStatusDanger : memo.request_status === 'fulfilled' ? styles.reqStatusOk : memo.request_status === 'pending' ? styles.reqStatusWarn : styles.reqStatusInfo]}>
          {/* Petunjuk "Disetujui, silakan hubungi staf gudang" hanya berguna selama belum ada barang yang dicatat. */}
          {!(memo.request_status === 'approved' && memo.items.length > 0) ? <Text style={styles.reqStatusTitle}>{memo.request_status_label ?? memo.request_status}</Text> : null}
          {memo.request_status === 'rejected' && memo.reject_reason ? <Text style={styles.reqStatusText}>{memo.reject_reason}</Text> : null}
          {memo.request_note ? <Text style={styles.reqStatusText}>Keperluan: {memo.request_note}</Text> : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.listContent}>
          <View style={styles.infoCard}>
            <Skeleton width="70%" height={22} />
            <Skeleton width="45%" height={14} />
            <Skeleton width="55%" height={28} borderRadius={14} />
          </View>
          {[0, 1].map((i) => (
            <View key={i} style={styles.itemRow}>
              <View style={styles.itemHeader}>
                <Skeleton width={44} height={44} borderRadius={22} />
                <View style={styles.itemTitleWrap}>
                  <Skeleton width="65%" height={16} />
                  <Skeleton width="30%" height={12} />
                </View>
              </View>
              <Skeleton width="100%" height={64} borderRadius={18} />
            </View>
          ))}
        </View>
      ) : error || !memo ? (
        <View style={styles.centerState}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.dangerBg }]}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.danger} />
          </View>
          <Text style={styles.centerStateTitle}>Memo Tidak Bisa Dibuka</Text>
          <Text style={styles.centerStateText}>{error ?? 'Memo tidak ditemukan.'}</Text>
          <PressableScale style={styles.secondaryBtn} onPress={onRefresh}>
            <Ionicons name="refresh" size={16} color={colors.textPrimary} />
            <Text style={styles.secondaryBtnText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : (
        <>
          <FlatList
            data={groups}
            keyExtractor={(group) => group.key}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            ListHeaderComponent={listHeader}
            renderItem={renderGroup}
            ListEmptyComponent={
              <View style={styles.emptyBlock}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="cube-outline" size={32} color={accentText} />
                </View>
                <Text style={styles.centerStateTitle}>Belum Ada Barang</Text>
                <Text style={styles.centerStateText}>{canModify ? 'Ketuk Tambah Barang di bawah untuk mencatat barang yang diambil.' : 'Belum ada barang di memo ini.'}</Text>
              </View>
            }
          />

          {!isRequest && canModify && (
            <PressableScale
              style={[styles.addBtn, { bottom: spacing.lg + insets.bottom }]}
              onPress={openAddModal}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={22} color="#ffffff" />
              <Text style={styles.addBtnText}>Tambah Barang</Text>
            </PressableScale>
          )}

          {isRequest && (memo.can_approve || memo.can_hand_over || memo.can_request_more) ? (
            <View style={[styles.reqFooter, { paddingBottom: spacing.md + insets.bottom }]}>
              {memo.can_approve ? (
                <View style={styles.reqFooterRow}>
                  <PressableScale style={[styles.reqBtn, styles.reqBtnGhost]} disabled={requestBusy} onPress={() => { setReqPromptValue(''); setReqPrompt({ key: 'reject', title: 'Tolak Memo', label: 'Alasan penolakan', confirm: 'Tolak' }); }}>
                    <Text style={[styles.reqBtnText, { color: colors.danger }]}>Tolak</Text>
                  </PressableScale>
                  <PressableScale style={[styles.reqBtn, styles.reqBtnPrimary, requestBusy && styles.reqBtnOff]} disabled={requestBusy} onPress={() => actRequest('/approve')}>
                    {requestBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.reqBtnTextOn}>Setujui</Text>}
                  </PressableScale>
                </View>
              ) : null}
              {memo.can_hand_over ? (
                <View style={styles.reqFooterRow}>
                  {canModify ? (
                    <PressableScale style={[styles.reqBtn, styles.reqBtnGhost]} disabled={requestBusy} onPress={openAddModal}>
                      <Ionicons name="add" size={18} color={colors.textPrimary} />
                      <Text style={styles.reqBtnText}>Tambah Barang</Text>
                    </PressableScale>
                  ) : null}
                  {memo.request_status === 'approved' ? (
                    <PressableScale style={[styles.reqBtn, styles.reqBtnPrimary, (requestBusy || memo.items.length === 0) && styles.reqBtnOff]} disabled={requestBusy || memo.items.length === 0} onPress={confirmComplete}>
                      <Text style={styles.reqBtnTextOn}>Selesai Diserahkan</Text>
                    </PressableScale>
                  ) : null}
                </View>
              ) : null}
              {memo.can_request_more ? (
                <View style={styles.reqFooterRow}>
                <PressableScale
                  style={[styles.reqBtn, styles.reqBtnPrimary]}
                  disabled={requestBusy}
                  onPress={() => { setReqPromptValue(''); setReqPrompt({ key: 'more', title: memo.request_status === 'rejected' ? 'Ajukan Ulang' : 'Minta Tambahan', label: memo.request_status === 'rejected' ? 'Catatan untuk penyetuju' : 'Apa yang perlu ditambah?', confirm: 'Kirim' }); }}
                >
                  <Text style={styles.reqBtnTextOn}>{memo.request_status === 'rejected' ? 'Ajukan Ulang' : 'Minta Tambahan'}</Text>
                </PressableScale>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      {/* Modal: alasan tolak / catatan tambahan (memo pengajuan) */}
      <Modal visible={!!reqPrompt} transparent animationType="fade" onRequestClose={() => setReqPrompt(null)} statusBarTranslucent>
        <View style={styles.reqBackdrop} onLayout={onBoxLayout}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReqPrompt(null)} />
          <View style={[styles.reqModalCard, { marginBottom: lift }, keyboardVisible && { paddingBottom: 20 }]}>
            <Text style={styles.reqModalTitle}>{reqPrompt?.title}</Text>
            <Text style={styles.reqFieldLabel}>{reqPrompt?.label}</Text>
            <TextInput style={styles.reqInput} value={reqPromptValue} onChangeText={setReqPromptValue} multiline autoFocus placeholderTextColor={colors.textMuted} />
            <View style={styles.reqFooterRow}>
              <PressableScale style={[styles.reqBtn, styles.reqBtnGhost]} onPress={() => setReqPrompt(null)}><Text style={styles.reqBtnText}>Batal</Text></PressableScale>
              <PressableScale style={[styles.reqBtn, styles.reqBtnPrimary, requestBusy && styles.reqBtnOff]} disabled={requestBusy} onPress={confirmReqPrompt}>
                {requestBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.reqBtnTextOn}>{reqPrompt?.confirm}</Text>}
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: tambah barang */}
      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={closeAddModal}>
        <View style={styles.modalBackdrop} onLayout={onBoxLayout}>
          {/* addModalCard punya height:'85%' TETAP — marginBottom saja mendorong seluruh kartu (termasuk kolom Cari di ATAS) naik ke
              luar layar. maxHeight dikurangi sejumlah lift supaya kartu MENGECIL dulu (bukan cuma bergeser), sehingga kolom
              Cari dan isinya tetap terbaca (temuan audit Memo Barang 2026-09-07). */}
          <View style={[
            styles.modalCard,
            styles.addModalCard,
            { maxHeight: windowHeight * 0.85 - lift, marginBottom: lift },
            aboveKeyboard,
          ]}>
            <View style={styles.dragHandle} />

            <View style={styles.modalHeader}>
              <View style={styles.modalTitleWrap}>
                <Text style={styles.modalTitle}>Tambah Barang</Text>
                <Text style={styles.modalStep}>
                  {!addType
                    ? 'Pilih jenis barang'
                    : addType !== 'inventory_item' && multiQtyStep
                      ? 'Isi jumlah tiap barang'
                      : addType !== 'inventory_item'
                        ? 'Cari dan centang barang'
                        : !selected
                          ? 'Cari dan pilih gulungan'
                          : 'Isi meter dipakai'}
                </Text>
              </View>
              <Pressable onPress={closeAddModal} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Tutup">
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.stepDots}>
              {[1, 2, 3].map((step) => {
                const current = !addType ? 1 : (addType !== 'inventory_item' && multiQtyStep) || (addType === 'inventory_item' && selected) ? 3 : 2;
                return <View key={step} style={[styles.stepDot, step <= current && styles.stepDotActive]} />;
              })}
            </View>

            {!addType ? (
              <View style={styles.typeList}>
                {(Object.keys(TYPE_LABEL) as ItemType[]).filter((t) => t !== 'consumable_item' && t !== 'inventory_item').map((t, index) => (
                  <FadeInUp key={t} index={index} distance={8}>
                    <PressableScale style={styles.typeOption} onPress={() => { hapticLight(); setAddType(t); }} accessibilityRole="button">
                      <View style={[styles.typeIcon, { backgroundColor: typeColorBg(t) }]}>
                        <Ionicons name={TYPE_ICON[t]} size={22} color={typeColor(t)} />
                      </View>
                      <View style={styles.typeText}>
                        <Text style={styles.typeOptionText}>{TYPE_LABEL[t]}</Text>
                        {TYPE_DESC[t] ? <Text style={styles.typeOptionDesc}>{TYPE_DESC[t]}</Text> : null}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </PressableScale>
                  </FadeInUp>
                ))}
              </View>
            ) : addType !== 'inventory_item' && multiQtyStep ? (
              <View style={styles.stepBody}>
                <FlatList
                  data={selectedMulti}
                  keyExtractor={(item) => String(item.id)}
                  style={styles.stepList}
                  contentContainerStyle={styles.stepListContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <View style={styles.multiQtyRow}>
                      <View style={styles.multiQtyTop}>
                        <View style={styles.pickText}>
                          <Text style={styles.pickRowName} numberOfLines={2}>{item.name}</Text>
                          {item.stockInfo ? (
                            <Text style={[styles.pickRowStockPlain, item.lowStock && styles.pickRowStockLow]}>{item.stockInfo}</Text>
                          ) : null}
                        </View>
                        <Pressable onPress={() => removeFromMultiQty(item.id)} hitSlop={8} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel={`Batalkan ${item.name}`}>
                          <Ionicons name="close" size={16} color={colors.textSecondary} />
                        </Pressable>
                      </View>
                      {item.withdrawalMultiple ? (
                        <>
                          <View style={styles.stepRow}>
                            <Pressable
                              style={[styles.stepBtn, (parseFloat(multiQty[item.id] ?? '') || 0) - item.withdrawalMultiple < item.withdrawalMultiple && styles.stepBtnOff]}
                              onPress={() => stepMulti(item, -1)}
                              accessibilityRole="button"
                              accessibilityLabel={`Kurangi ${item.name}`}
                            >
                              <Ionicons name="remove" size={24} color={colors.textPrimary} />
                            </Pressable>
                            <View style={styles.stepValue}>
                              <Text style={styles.stepNumber}>{(parseFloat(multiQty[item.id] ?? '') || 0).toLocaleString('id-ID')}</Text>
                              <Text style={styles.qtyFieldUnit}>{item.unit ?? ''}</Text>
                            </View>
                            <Pressable
                              style={[styles.stepBtn, item.stock !== undefined && (parseFloat(multiQty[item.id] ?? '') || 0) + item.withdrawalMultiple > item.stock + 1e-9 && styles.stepBtnOff]}
                              onPress={() => stepMulti(item, 1)}
                              accessibilityRole="button"
                              accessibilityLabel={`Tambah ${item.name}`}
                            >
                              <Ionicons name="add" size={24} color={colors.textPrimary} />
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <View style={styles.qtyField}>
                          <TextInput
                            style={styles.qtyFieldInput}
                            placeholder="0"
                            placeholderTextColor={colors.textMuted}
                            value={multiQty[item.id] ?? ''}
                            onChangeText={(v) => setMultiQty((prev) => ({ ...prev, [item.id]: v }))}
                            keyboardType="decimal-pad"
                          />
                          <Text style={styles.qtyFieldUnit}>{item.unit ?? 'jumlah'}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  ListFooterComponent={
                    <TextInput
                      style={[styles.input, styles.textarea]}
                      placeholder="Catatan (opsional)"
                      placeholderTextColor={colors.textMuted}
                      value={conditionNotes}
                      onChangeText={setConditionNotes}
                      multiline
                    />
                  }
                />
                {addError ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={18} color={colors.danger} />
                    <Text style={styles.errorBoxText}>{addError}</Text>
                  </View>
                ) : null}
                <View style={styles.footerRow}>
                  <PressableScale style={styles.footerBack} onPress={() => setMultiQtyStep(false)} disabled={addSubmitting} accessibilityRole="button" accessibilityLabel="Kembali">
                    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                  </PressableScale>
                  <PressableScale style={[styles.primaryAction, addSubmitting && styles.primaryActionOff]} onPress={handleAddMultiItems} disabled={addSubmitting} accessibilityRole="button">
                    {addSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryActionText}>Tambahkan {selectedMulti.length} Barang</Text>}
                  </PressableScale>
                </View>
              </View>
            ) : addType !== 'inventory_item' ? (
              <View style={styles.stepBody}>
                <View style={styles.searchWrap}>
                  <Ionicons name="search" size={18} color={colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={`Cari ${TYPE_LABEL[addType].toLowerCase()}`}
                    placeholderTextColor={colors.textMuted}
                    value={search}
                    onChangeText={setSearch}
                  />
                  {search.length > 0 ? (
                    <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hapus pencarian">
                      <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
                {searchLoading ? (
                  <View style={styles.skeletonList}>
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} width="100%" height={68} borderRadius={20} />
                    ))}
                  </View>
                ) : (
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item) => String(item.id)}
                    style={styles.stepList}
                    contentContainerStyle={styles.stepListContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                      <View style={styles.noResult}>
                        <Ionicons name="search-outline" size={26} color={colors.textMuted} />
                        <Text style={styles.noResultText}>Tidak ada hasil. Coba kata kunci lain.</Text>
                      </View>
                    }
                    renderItem={({ item }) => {
                      const checked = selectedMulti.some((s) => s.id === item.id);
                      return (
                        <Pressable style={[styles.pickRow, checked && styles.pickRowChecked]} onPress={() => toggleMultiSelect(item)} accessibilityRole="checkbox" accessibilityState={{ checked }}>
                          <View style={[styles.checkCircle, checked && styles.checkCircleOn]}>
                            {checked ? <Ionicons name="checkmark" size={15} color="#ffffff" /> : null}
                          </View>
                          <View style={styles.pickText}>
                            <Text style={styles.pickRowName} numberOfLines={2}>{item.name}</Text>
                            {item.subtitle ? <Text style={styles.pickRowSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                          </View>
                          {item.stockInfo ? (
                            <View style={[styles.stockChip, item.lowStock && styles.stockChipLow]}>
                              <Text style={[styles.stockChipText, item.lowStock && styles.stockChipTextLow]}>{item.stockInfo.replace('Stok: ', '')}</Text>
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    }}
                  />
                )}
                <View style={styles.footerRow}>
                  <PressableScale style={styles.footerBack} onPress={backToTypeStep} accessibilityRole="button" accessibilityLabel="Kembali">
                    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                  </PressableScale>
                  <PressableScale
                    style={[styles.primaryAction, selectedMulti.length === 0 && styles.primaryActionOff]}
                    disabled={selectedMulti.length === 0}
                    onPress={() => {
                      hapticLight();
                      setMultiQty(Object.fromEntries(selectedMulti.map((s) => [s.id, multiQty[s.id] ?? (s.withdrawalMultiple ? String(s.withdrawalMultiple) : '')])));
                      setMultiQtyStep(true);
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryActionText}>{selectedMulti.length > 0 ? `Lanjut · ${selectedMulti.length} dipilih` : 'Lanjut'}</Text>
                    <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                  </PressableScale>
                </View>
              </View>
            ) : !selected ? (
              <View style={styles.stepBody}>
                <View style={styles.searchWrap}>
                  <Ionicons name="search" size={18} color={colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={`Cari ${TYPE_LABEL[addType].toLowerCase()}`}
                    placeholderTextColor={colors.textMuted}
                    value={search}
                    onChangeText={setSearch}
                  />
                  {search.length > 0 ? (
                    <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hapus pencarian">
                      <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
                {searchLoading ? (
                  <View style={styles.skeletonList}>
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} width="100%" height={68} borderRadius={20} />
                    ))}
                  </View>
                ) : (
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item) => String(item.id)}
                    style={styles.stepList}
                    contentContainerStyle={styles.stepListContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                      <View style={styles.noResult}>
                        <Ionicons name="search-outline" size={26} color={colors.textMuted} />
                        <Text style={styles.noResultText}>Tidak ada gulungan yang cocok.</Text>
                      </View>
                    }
                    renderItem={({ item }) => (
                      <Pressable style={styles.pickRow} onPress={() => setSelected(item)} accessibilityRole="button">
                        <View style={[styles.pickIcon, { backgroundColor: typeColorBg('inventory_item') }]}>
                          <Ionicons name={TYPE_ICON.inventory_item} size={18} color={typeColor('inventory_item')} />
                        </View>
                        <View style={styles.pickText}>
                          <Text style={styles.pickRowName} numberOfLines={2}>{item.name}</Text>
                          {/* Kode gulungan dipanjangkan (bukan dipotong "1...") dan sisa meter pindah ke bawahnya, supaya kode terbaca utuh. */}
                          {item.subtitle ? <Text style={styles.pickRowSubtitle} numberOfLines={2}>{item.subtitle}</Text> : null}
                          {item.stockInfo ? (
                            <View style={[styles.stockChip, styles.stockChipInline]}>
                              <Text style={styles.stockChipText}>{item.stockInfo}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                      </Pressable>
                    )}
                  />
                )}
                <View style={styles.footerRow}>
                  <PressableScale style={styles.footerBack} onPress={backToTypeStep} accessibilityRole="button" accessibilityLabel="Kembali">
                    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                  </PressableScale>
                </View>
              </View>
            ) : (
              <View style={styles.stepBody}>
                <View style={styles.selectedCard}>
                  <View style={[styles.pickIcon, { backgroundColor: typeColorBg('inventory_item') }]}>
                    <Ionicons name={TYPE_ICON.inventory_item} size={18} color={typeColor('inventory_item')} />
                  </View>
                  <View style={styles.pickText}>
                    <Text style={styles.selectedName} numberOfLines={2}>{selected.name}</Text>
                    {selected.subtitle ? <Text style={styles.pickRowSubtitle}>{selected.subtitle}</Text> : null}
                    {selected.stockInfo ? <Text style={[styles.pickRowStockPlain, selected.lowStock && styles.pickRowStockLow]}>{selected.stockInfo}</Text> : null}
                  </View>
                </View>

                {/* Kolom meter: label kecil di atas, lalu angka besar di tengah (tanpa satuan; labelnya sudah menyebut meter). */}
                <View style={styles.meterCard}>
                  <Text style={styles.meterLabel}>{addType === 'inventory_item' ? 'Meter dipakai' : 'Jumlah'}</Text>
                  <View style={styles.meterValue}>
                      <TextInput
                        style={styles.meterInput}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        value={qtyInput}
                        onChangeText={(text) => setQtyInput(text.replace(',', '.').replace(/[^0-9.]/g, ''))}
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                      />
                  </View>
                </View>

                <TextInput
                  style={[styles.input, styles.textarea]}
                  placeholder="Catatan (opsional)"
                  placeholderTextColor={colors.textMuted}
                  value={conditionNotes}
                  onChangeText={setConditionNotes}
                  multiline
                />
                {addError ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={18} color={colors.danger} />
                    <Text style={styles.errorBoxText}>{addError}</Text>
                  </View>
                ) : null}
                {/* footerRowBottom: footer menempel di dasar kartu, sama dengan tombol kembali di langkah 2, supaya letaknya konsisten antar langkah. */}
                <View style={[styles.footerRow, styles.footerRowBottom]}>
                  <PressableScale style={styles.footerBack} onPress={() => setSelected(null)} disabled={addSubmitting} accessibilityRole="button" accessibilityLabel="Kembali">
                    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                  </PressableScale>
                  <PressableScale style={[styles.primaryAction, addSubmitting && styles.primaryActionOff]} onPress={handleAddItem} disabled={addSubmitting} accessibilityRole="button">
                    {addSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryActionText}>Tambahkan</Text>}
                  </PressableScale>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal: catat pengembalian */}
      <Modal visible={returnTarget !== null} animationType="fade" transparent onRequestClose={() => setReturnTarget(null)}>
        <View style={styles.modalBackdrop} onLayout={onBoxLayout}>
          <View style={[styles.modalCard, { marginBottom: lift }, aboveKeyboard]}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{correcting ? 'Koreksi Pengembalian' : 'Catat Pengembalian'}</Text>
              <Pressable onPress={() => setReturnTarget(null)} hitSlop={8} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>
            <Text style={styles.selectedName}>{returnTarget?.item_name}</Text>
            <Text style={styles.infoMeta}>Diambil: {returnTarget?.qty_taken} {returnTarget?.unit}</Text>
            <View style={styles.qtyWithUnit}>
              <TextInput
                style={styles.qtyWithUnitInput}
                placeholder="Jumlah dikembalikan"
                placeholderTextColor={colors.textMuted}
                selectTextOnFocus
                value={returnQtyInput}
                onChangeText={setReturnQtyInput}
                keyboardType="decimal-pad"
              />
              {returnTarget?.unit ? <Text style={styles.qtyUnitText}>{returnTarget.unit}</Text> : null}
            </View>
            {correcting && (
              <TextInput
                style={styles.input}
                placeholder="Alasan koreksi (wajib)"
                placeholderTextColor={colors.textMuted}
                value={returnNote}
                onChangeText={setReturnNote}
              />
            )}
            {returnError && <Text style={styles.errorText}>{returnError}</Text>}
            <Button label="Simpan" onPress={handleReturn} loading={returnSubmitting} />
          </View>
        </View>
      </Modal>

      {/* Modal: edit jumlah (koreksi salah input) */}
      <Modal visible={editTarget !== null} animationType="fade" transparent onRequestClose={() => setEditTarget(null)}>
        <View style={styles.modalBackdrop} onLayout={onBoxLayout}>
          <View style={[styles.modalCard, { marginBottom: lift }, aboveKeyboard]}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Koreksi Jumlah</Text>
              <Pressable onPress={() => setEditTarget(null)} hitSlop={8} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>
            <Text style={styles.selectedName}>{editTarget?.item_name}</Text>
            <Text style={styles.infoMeta}>
              {editTarget?.item_type === 'inventory_item'
                ? `Sekarang: ${editTarget?.meters_used} meter`
                : `Sekarang: ${editTarget?.qty_taken} ${editTarget?.unit}`}
            </Text>
            <TextInput
              style={styles.qtyInputField}
              placeholder={editTarget?.item_type === 'inventory_item' ? 'Meter dipakai (koreksi)' : 'Jumlah diambil (koreksi)'}
              placeholderTextColor={colors.textMuted}
              value={editQtyInput}
              onChangeText={setEditQtyInput}
              keyboardType="decimal-pad"
            />
            {editError && <Text style={styles.errorText}>{editError}</Text>}
            <Button label="Simpan Koreksi" onPress={handleEditSubmit} loading={editSubmitting} />
          </View>
        </View>
      </Modal>

      {/* Modal: edit info memo */}
      <Modal visible={editInfoVisible} animationType="fade" transparent onRequestClose={() => setEditInfoVisible(false)}>
        <View style={styles.modalBackdrop} onLayout={onBoxLayout}>
          <View style={[styles.modalCard, { marginBottom: lift }, aboveKeyboard]}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Info Memo</Text>
              <Pressable onPress={() => setEditInfoVisible(false)} hitSlop={8} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Info kendaraan (opsional)"
              placeholderTextColor={colors.textMuted}
              value={editVehicleInfo}
              onChangeText={setEditVehicleInfo}
            />
            <TextInput
              style={styles.input}
              placeholder="SPK No (opsional)"
              placeholderTextColor={colors.textMuted}
              value={editSpkNumber}
              onChangeText={setEditSpkNumber}
            />
            {SHOW_BOOKING_LINK ? <BookingPicker value={editBooking} onChange={setEditBooking} storeId={memo?.store_id ?? null} colors={colors} /> : null}
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Catatan (opsional)"
              placeholderTextColor={colors.textMuted}
              value={editNotes}
              onChangeText={setEditNotes}
              multiline
            />
            {editInfoError && <Text style={styles.errorText}>{editInfoError}</Text>}
            <Button label="Simpan" onPress={submitEditInfo} loading={editInfoSubmitting} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, insetsBottom: number, isDark: boolean) {
  const line = isDark ? colors.border : '#e8e8ee';

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },

    // Memo pengajuan: status persetujuan, footer aksi, dan modal isian.
    reqStatusCard: { marginHorizontal: 20, marginBottom: spacing.sm, padding: 14, borderRadius: 20, gap: 3 },
    reqStatusInfo: { backgroundColor: colors.accentSoft },
    reqStatusWarn: { backgroundColor: colors.warningBg },
    reqStatusOk: { backgroundColor: colors.successBg },
    reqStatusDanger: { backgroundColor: colors.dangerBg },
    reqStatusTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    reqStatusText: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
    reqFooter: { paddingHorizontal: 20, paddingTop: 12, gap: 10, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: line },
    reqFooterRow: { flexDirection: 'row', gap: 10 },
    reqBtn: { flex: 1, flexDirection: 'row', gap: 6, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    reqBtnGhost: { backgroundColor: colors.surfaceElevated },
    reqBtnPrimary: { backgroundColor: colors.accent },
    reqBtnOff: { opacity: 0.45 },
    reqBtnText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary },
    reqBtnTextOn: { fontSize: fontSize.sm, fontWeight: '800', color: '#ffffff' },
    reqBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)' },
    reqModalCard: { gap: 12, padding: 20, borderRadius: 28, backgroundColor: colors.surface },
    reqModalTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    reqFieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    reqInput: { minHeight: 90, paddingHorizontal: 16, paddingTop: 14, borderRadius: 18, borderWidth: 1, borderColor: line, backgroundColor: colors.bg, fontSize: fontSize.sm, color: colors.textPrimary, textAlignVertical: 'top' },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    headerText: { flex: 1, gap: 1, marginLeft: 4 },
    headerLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    headerTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary },

    listHeader: { gap: spacing.md },
    infoCard: {
      padding: 20,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: line,
      backgroundColor: colors.surface,
      gap: 12,
      ...shadow.sm,
    },
    infoCardTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary, lineHeight: 26 },
    infoCardTitleEmpty: { fontWeight: '600', color: colors.textMuted },
    memoNameText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: colors.textMuted },
    vehicleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
    plateBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textPrimary, backgroundColor: colors.surface },
    plateText: { fontSize: 14, fontWeight: '800', letterSpacing: 1.2, color: colors.textPrimary },
    spkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    spkLabel: { fontSize: 13, color: colors.textMuted },
    spkValue: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    bookingPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.accentSoft },
    bookingPillText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: isDark ? '#ff6b8f' : '#cc1042' },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    infoText: { fontSize: 13, color: colors.textSecondary },
    infoDot: { fontSize: 13, color: colors.textMuted },
    noteBox: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.surfaceElevated },
    noteText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
    statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.surfaceElevated },
    statChipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    centerStateTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
    emptyBlock: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 22, borderRadius: 23, backgroundColor: colors.surfaceElevated, marginTop: spacing.xs },
    secondaryBtnText: { color: colors.textPrimary, fontWeight: '700', fontSize: fontSize.sm },
    // Ruang di bawah daftar: tombol "Tambah Barang" melayang dan ikut naik sebesar insets.bottom di perangkat dengan navigasi gesture.
    listContent: { paddingHorizontal: 20, paddingTop: spacing.xs, paddingBottom: 110 + insetsBottom, gap: 14 },
    listSectionTitle: { fontSize: 12, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.xs, marginLeft: 4 },

    infoMeta: { fontSize: fontSize.xs, color: colors.textMuted },

    itemRow: {
      backgroundColor: colors.surface,
      borderRadius: 26,
      borderWidth: 1,
      borderColor: line,
      padding: 18,
      gap: 14,
      ...shadow.sm,
    },
    itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    itemIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    itemTitleWrap: { flex: 1, gap: 2 },
    itemTypeLabel: { fontSize: 12, fontWeight: '700' },
    itemName: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    itemActionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },

    qtyPanel: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8, borderRadius: 20, backgroundColor: colors.surfaceElevated },
    qtyCell: { flex: 1, alignItems: 'center', gap: 3 },
    qtyDivider: { width: 1, alignSelf: 'stretch', backgroundColor: line },
    qtyLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
    qtyValue: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    qtyUnit: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    qtyMissing: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    itemNotes: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
    entryNested: { marginTop: spacing.sm, paddingTop: spacing.sm, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    itemTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    itemTimeText: { fontSize: 12, color: colors.textMuted },
    pendingPill: { height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center', backgroundColor: colors.warningBg },
    pendingPillText: { fontSize: 11, fontWeight: '700', color: colors.warning },
    returnBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 23, backgroundColor: colors.accentSoft },
    returnBtnText: { fontSize: 14, fontWeight: '800', color: isDark ? '#ff6b8f' : '#cc1042' },
    correctBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.surfaceElevated },
    correctBtnText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    groupToggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    groupToggleTextWrap: { flex: 1, gap: 1 },
    groupToggleTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    groupToggleSub: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

    addBtn: {
      position: 'absolute',
      left: 20,
      right: 20,
      bottom: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accent,
      ...shadow.card,
    },
    emptyIconWrap: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
    addBtnText: { color: '#ffffff', fontWeight: '800', fontSize: fontSize.sm },

    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalCard: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      padding: 20,
      // Modal (dan tombol Simpan/Tambahkan di dalamnya) TIDAK otomatis dijauhkan dari navigasi gesture Android — modal render di luar
      // SafeAreaView layar ini, jadi insets.bottom ditambah manual.
      paddingBottom: 20 + insetsBottom,
      gap: spacing.sm + 2,
    },
    // Tambah Barang butuh ruang jauh lebih besar dari modal lain (return/edit) karena isinya daftar pencarian yang bisa panjang —
    // dikunci 85% tinggi layar supaya daftar barangnya terbaca banyak sekaligus.
    addModalCard: { height: '85%' },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: line, alignSelf: 'center', marginBottom: spacing.xs },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    modalCloseBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
    modalTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
    modalStep: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
    stepDots: { flexDirection: 'row', gap: 6, marginBottom: spacing.xs },
    stepDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceElevated },
    stepDotActive: { backgroundColor: colors.accent },

    typeOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      backgroundColor: colors.surface,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: line,
      padding: 16,
    },
    typeOptionDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
    typeOptionText: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      height: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: line,
      backgroundColor: colors.surface,
      marginBottom: spacing.sm,
    },
    searchInput: { flex: 1, height: 48, fontSize: fontSize.sm, color: colors.textPrimary },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 20,
      marginBottom: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: line,
    },
    pickRowName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    pickRowSubtitle: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
    pickRowStock: { fontSize: fontSize.xs, fontWeight: '700', color: colors.success, marginRight: spacing.xs },
    pickRowStockLow: { color: colors.danger },
    multiQtyRow: { backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: line, padding: 14, gap: 8 },
    // Kolom jumlah sengaja dibuat beda dari kolom teks biasa (latar lembut beraksen, huruf tebal) supaya kolom yang paling mudah salah
    // ketik ini paling mudah dicek ulang sebelum dikirim.
    multiQtyInput: {
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: line,
      borderRadius: 16,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    selectedName: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    input: {
      minHeight: 50,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: line,
      borderRadius: 18,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
    },
    qtyInputField: {
      minHeight: 54,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: line,
      borderRadius: 18,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    qtyWithUnit: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 54,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: line,
      borderRadius: 18,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    qtyWithUnitInput: { flex: 1, paddingVertical: spacing.sm, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    qtyUnitText: { fontSize: fontSize.base, fontWeight: '700', color: colors.textSecondary },
    textarea: { minHeight: 72, textAlignVertical: 'top' },
    errorText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.danger, lineHeight: 20 },

    // Modal Tambah Barang (2026-11-13)
    modalTitleWrap: { flex: 1, gap: 2 },
    typeList: { gap: 12, paddingTop: spacing.xs },
    typeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    typeText: { flex: 1, gap: 2 },
    stepBody: { flex: 1, gap: spacing.sm + 2 },
    stepList: { flex: 1 },
    stepListContent: { gap: 10, paddingBottom: spacing.sm },
    skeletonList: { flex: 1, gap: 10 },
    noResult: { alignItems: 'center', gap: 8, paddingVertical: spacing.xl },
    noResultText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
    pickRowChecked: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    pickText: { flex: 1, gap: 2, marginHorizontal: 12 },
    pickIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    checkCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
    checkCircleOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    stockChip: { height: 26, paddingHorizontal: 10, borderRadius: 13, justifyContent: 'center', backgroundColor: colors.successBg },
    stockChipInline: { alignSelf: 'flex-start', marginTop: 4 },
    stockChipLow: { backgroundColor: colors.dangerBg },
    stockChipText: { fontSize: 11, fontWeight: '800', color: colors.success },
    stockChipTextLow: { color: colors.danger },
    pickRowStockPlain: { fontSize: 12, fontWeight: '700', color: colors.success },
    multiQtyTop: { flexDirection: 'row', alignItems: 'flex-start' },
    removeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    qtyField: { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.accentSoft },
    qtyFieldInput: { flex: 1, height: 52, fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    qtyFieldUnit: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    selectedCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 22, borderWidth: 1, borderColor: line, backgroundColor: colors.surface },
    meterCard: { alignItems: 'center', gap: 6, paddingVertical: 18, paddingHorizontal: 16, borderRadius: 28, borderWidth: 1, borderColor: line, backgroundColor: colors.accentSoft },
    meterLabel: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.2, color: colors.textSecondary },
    meterValue: { alignItems: 'center' },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    stepBtnOff: { opacity: 0.35 },
    stepValue: { flex: 1, minHeight: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, flexDirection: 'row', gap: 6 },
    stepNumber: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    meterInput: { minWidth: 110, fontSize: 44, lineHeight: 52, fontWeight: '800', letterSpacing: -1.5, textAlign: 'center', color: colors.textPrimary, padding: 0 },
    errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 20, backgroundColor: colors.dangerBg },
    errorBoxText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.danger, lineHeight: 20 },
    footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    footerRowBottom: { marginTop: 'auto' },
    footerBack: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    primaryAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 27, backgroundColor: colors.accent },
    primaryActionOff: { opacity: 0.6 },
    // Tombol yang berdiri sendiri di kolom: flex:1 pada primaryAction cocok untuk baris (melebar ke samping), tetapi di kolom membuatnya
    // memanjang ke bawah.
    primaryActionSolo: { flex: 0, alignSelf: 'stretch' },
    primaryActionText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '800' },
  });
}
