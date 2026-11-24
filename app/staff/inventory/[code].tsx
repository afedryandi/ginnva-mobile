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
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';
import { useStaffAuth } from '@/lib/staff-auth-context';
import SpkPicker, { SpkOption } from '@/components/staff/SpkPicker';

interface Movement {
  id: number;
  type: 'in' | 'out' | 'correction';
  note: string | null;
  destination_store: { id: number; name: string } | null;
  store?: { id: number; name: string } | null;
  user: { id: number; name: string } | null;
  reversed_at?: string | null;
  reversed_reason?: string | null;
  created_at: string;
}

interface Store {
  id: number;
  name: string;
}

interface ScrollCodeUsageEntry {
  id: number;
  meters: string;
  note: string | null;
  user: { id: number; name: string } | null;
  created_at: string;
}

interface ScrollCodeInfo {
  id: number;
  code: string;
  status: 'unallocated' | 'allocated' | 'used';
  film_product: { name: string } | null;
  store: Store | null;
  total_length_meters: string | null;
  remaining_length_meters: string | null;
  usages: ScrollCodeUsageEntry[];
}

interface InventoryItemData {
  id: number;
  code: string;
  name: string;
  category: string | null;
  status: 'in_stock' | 'out';
  notes: string | null;
  movements: Movement[];
  scroll_code: ScrollCodeInfo | null;
}

interface ShowResponse {
  data: InventoryItemData;
  stores: Store[];
  movements_has_more: boolean;
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

export default function InventoryItemScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { staff } = useStaffAuth();
  const isFullAccess = staff?.role === 'super_admin' || staff?.role === 'direksi';

  const [item, setItem] = useState<InventoryItemData | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [markingUsed, setMarkingUsed] = useState(false);

  const [usageFormOpen, setUsageFormOpen] = useState(false);
  const [usageMeters, setUsageMeters] = useState('');
  const [usageNote, setUsageNote] = useState('');
  // SPK terkait pemakaian (wajib): pilih dari daftar atau ketik nomornya. Nomor yang diketik berbeda dari SPK terpilih melepas tautan.
  const [usageSpkNumber, setUsageSpkNumber] = useState('');
  // Potongan sisa yang disimpan gudang setelah pemakaian ini (opsional).
  const [offcutCount, setOffcutCount] = useState('');

  // Potongan sisa tersimpan dari roll ini, untuk dipakai langsung ke SPK (tanpa memo): SPK wajib (ketik atau pilih), bagian mobil wajib.
  const [offcuts, setOffcuts] = useState<{ id: number; location: string | null; notes: string | null }[]>([]);
  const [usingOffcutId, setUsingOffcutId] = useState<number | null>(null);
  const [offcutSpkNumber, setOffcutSpkNumber] = useState('');
  const [offcutSpk, setOffcutSpk] = useState<{ id: number; spk_number: string; customer_name: string | null } | null>(null);
  const [offcutCarPart, setOffcutCarPart] = useState('');
  const [offcutError, setOffcutError] = useState<string | null>(null);
  const [savingOffcut, setSavingOffcut] = useState(false);
  const [usageSpk, setUsageSpk] = useState<{ id: number; spk_number: string; customer_name: string | null } | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [recordingUsage, setRecordingUsage] = useState(false);

  // "Muat Riwayat Lainnya" — show() cuma kirim 20 baris pertama, baris
  // tambahan yang dimuat manual ditampung terpisah lalu digabung ke
  // item.movements saat render, supaya tidak perlu ubah bentuk state utama.
  const [extraMovements, setExtraMovements] = useState<Movement[]>([]);
  const [hasMoreMovements, setHasMoreMovements] = useState(false);
  const [loadingMoreMovements, setLoadingMoreMovements] = useState(false);

  const fetchItem = useCallback(() => {
    setError(null);
    return staffApiFetch<ShowResponse>(`/api/staff/inventory/${encodeURIComponent(code)}`)
      .then((res) => {
        setItem(res.data);
        setStores(res.stores);
        setExtraMovements([]);
        setHasMoreMovements(res.movements_has_more);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Barang tidak ditemukan atau koneksi bermasalah.');
      });
  }, [code]);

  const loadMoreMovements = useCallback(() => {
    if (!item) return;

    setLoadingMoreMovements(true);
    staffApiFetch<{ data: Movement[]; has_more: boolean }>(
      `/api/staff/inventory/${encodeURIComponent(code)}/movements?offset=${item.movements.length + extraMovements.length}`
    )
      .then((res) => {
        setExtraMovements((prev) => [...prev, ...res.data]);
        setHasMoreMovements(res.has_more);
      })
      .catch(() => hapticError())
      .finally(() => setLoadingMoreMovements(false));
  }, [code, item, extraMovements.length]);

  useEffect(() => {
    setLoading(true);
    fetchItem().finally(() => setLoading(false));
  }, [fetchItem]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItem();
    setRefreshing(false);
  }, [fetchItem]);

  // SEBELUMNYA cuma diwajibkan kalau barangnya punya kode gulungan
  // terkait — barang PPF/WF polos yang di-scan keluar oleh full-access
  // jadi tidak pernah tercatat tujuannya. Sekarang berlaku untuk SEMUA
  // "keluar" oleh full-access, konsisten dengan backend (lihat
  // InventoryController::storeMovement()).
  const handleMarkUsed = () => {
    Alert.alert(
      'Tandai Habis',
      'Tandai gulungan ini habis? Kodenya tidak muncul lagi di pilihan garansi baru.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Tandai Habis',
          style: 'destructive',
          onPress: () => {
            setMarkingUsed(true);
            staffApiFetch<{ message: string; data: InventoryItemData }>(
              `/api/staff/inventory/${encodeURIComponent(code)}/mark-scroll-code-used`,
              { method: 'POST' }
            )
              .then((res) => {
                hapticSuccess();
                setItem(res.data);
                Alert.alert('Berhasil', res.message);
              })
              .catch((err) => {
                hapticError();
                Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menandai habis. Periksa koneksi internet.');
              })
              .finally(() => setMarkingUsed(false));
          },
        },
      ]
    );
  };

  const openUsageForm = () => {
    setUsageFormOpen(true);
  };

  const resetUsageForm = () => {
    setUsageMeters('');
    setUsageNote('');
    setUsageSpkNumber('');
    setUsageSpk(null);
    setOffcutCount('');
  };

  const pickUsageSpk = (picked: SpkOption) => {
    setUsageSpk({ id: picked.id, spk_number: picked.spk_number, customer_name: picked.customer_name });
    setUsageSpkNumber(picked.spk_number);
  };

  const changeUsageSpkNumber = (text: string) => {
    setUsageSpkNumber(text);
    if (usageSpk && text.trim() !== usageSpk.spk_number) setUsageSpk(null);
  };

  const handleRecordUsage = () => {
    const meters = parseFloat(usageMeters.replace(',', '.'));
    if (!meters || meters <= 0) {
      setUsageError('Isi jumlah meter yang valid (lebih dari 0).');
      return;
    }

    if (!usageSpk && !usageSpkNumber.trim()) {
      setUsageError('Isi nomor SPK atau pilih dari daftar.');
      return;
    }

    setRecordingUsage(true);
    setUsageError(null);

    staffApiFetch<{ message: string; data: InventoryItemData }>(
      `/api/staff/inventory/${encodeURIComponent(code)}/record-usage`,
      { method: 'POST', body: JSON.stringify({ meters, note: usageNote.trim() || undefined, spk_id: usageSpk?.id ?? undefined, spk_number: usageSpkNumber.trim() || undefined, offcut_count: parseInt(offcutCount, 10) > 0 ? parseInt(offcutCount, 10) : undefined }) }
    )
      .then((res) => {
        hapticSuccess();
        setItem(res.data);
        setUsageFormOpen(false);
        resetUsageForm();
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        hapticError();
        setUsageError(err instanceof ApiError ? err.message : 'Gagal mencatat pemakaian. Periksa koneksi internet.');
      })
      .finally(() => setRecordingUsage(false));
  };

  // Tanpa izin Ubah akun hanya membaca; gulungan yang dialokasikan ke toko lain hanya boleh digerakkan staf toko itu atau akses penuh
  // (server menolak keduanya, ini supaya tombolnya tidak ditawarkan lalu ditolak).
  const canModify = staff?.can_modify_ppf_wf ?? true;
  const rollOfOtherStore = !!item?.scroll_code?.store && !isFullAccess && item.scroll_code.store.id !== staff?.store_id;
  const actionsBlocked = !canModify || rollOfOtherStore;

  const hasRoll = !!item?.scroll_code;

  // Daftar potongan sisa tersimpan dimuat saat barang punya gulungan dan akun boleh mengubahnya.
  useEffect(() => {
    if (!hasRoll || actionsBlocked) {
      setOffcuts([]);
      return;
    }
    let cancelled = false;
    staffApiFetch<{ data: { id: number; location: string | null; notes: string | null }[] }>(`/api/staff/inventory/${encodeURIComponent(code)}/offcuts`)
      .then((res) => { if (!cancelled) setOffcuts(res.data ?? []); })
      .catch(() => { if (!cancelled) setOffcuts([]); });
    return () => { cancelled = true; };
  }, [code, hasRoll, actionsBlocked, item?.scroll_code?.remaining_length_meters]);

  const resetOffcutForm = () => {
    setUsingOffcutId(null);
    setOffcutSpkNumber('');
    setOffcutSpk(null);
    setOffcutCarPart('');
    setOffcutError(null);
  };

  const pickOffcutSpk = (picked: SpkOption) => {
    setOffcutSpk({ id: picked.id, spk_number: picked.spk_number, customer_name: picked.customer_name });
    setOffcutSpkNumber(picked.spk_number);
  };

  const changeOffcutSpkNumber = (text: string) => {
    setOffcutSpkNumber(text);
    if (offcutSpk && text.trim() !== offcutSpk.spk_number) setOffcutSpk(null);
  };

  const handleUseOffcut = () => {
    if (usingOffcutId === null) return;
    if (!offcutSpk && !offcutSpkNumber.trim()) {
      setOffcutError('Isi nomor SPK atau pilih dari daftar.');
      return;
    }
    if (!offcutCarPart.trim()) {
      setOffcutError('Isi bagian mobil yang dikerjakan.');
      return;
    }

    setSavingOffcut(true);
    setOffcutError(null);
    staffApiFetch<{ message: string; data: { id: number; location: string | null; notes: string | null }[] }>(
      `/api/staff/inventory/${encodeURIComponent(code)}/offcuts/${usingOffcutId}/use`,
      { method: 'POST', body: JSON.stringify({ spk_id: offcutSpk?.id ?? undefined, spk_number: offcutSpkNumber.trim() || undefined, car_part: offcutCarPart.trim() }) }
    )
      .then((res) => {
        hapticSuccess();
        setOffcuts(res.data ?? []);
        resetOffcutForm();
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        hapticError();
        setOffcutError(err instanceof ApiError ? err.message : 'Gagal memakai potongan. Periksa koneksi internet.');
      })
      .finally(() => setSavingOffcut(false));
  };

  const remainingRatio = (() => {
    const total = item?.scroll_code?.total_length_meters;
    if (total == null) return null;
    const t = parseFloat(total);
    if (!t || t <= 0) return null;
    return Math.max(0, Math.min(1, parseFloat(item?.scroll_code?.remaining_length_meters ?? '0') / t));
  })();
  const neutralBg = isDark ? colors.surfaceElevated : '#efeff4';
  const movementTone = (t: Movement['type']) =>
    t === 'in'
      ? { fg: colors.success, bg: colors.successBg }
      : t === 'out'
        ? { fg: colors.warning, bg: colors.warningBg }
        : { fg: colors.textSecondary, bg: neutralBg };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <StatusBar style={isDark ? 'light' : 'dark'} />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>Detail Barang</Text>
            {item ? <Text style={styles.subtitle} numberOfLines={1}>{item.code}</Text> : null}
          </View>
        </View>

        {loading ? (
          <SkeletonCards count={3} />
        ) : error || !item ? (
          <View style={styles.centerState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="alert-circle-outline" size={34} color={colors.danger} />
            </View>
            <Text style={styles.emptyTitle}>Barang tidak bisa dibuka</Text>
            <Text style={styles.centerStateText}>{error ?? 'Barang tidak ditemukan.'}</Text>
            <PressableScale style={styles.primaryButton} onPress={() => router.replace('/staff/inventory/scan' as never)}>
              <Text style={styles.primaryButtonText}>Scan Ulang</Text>
            </PressableScale>
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
              {/* Hero: siapa barangnya, ada stok atau sudah keluar, dan (bila ada) sisa gulungan sebagai bilah kemajuan. */}
              <View style={styles.card}>
                <View style={styles.heroTop}>
                  <View style={styles.codePill}>
                    <Ionicons name="pricetag-outline" size={13} color={styles.accentText.color} />
                    <Text style={styles.codePillText}>{item.code}</Text>
                  </View>
                  <View style={[styles.statusBadge, item.status === 'in_stock' ? styles.statusInStock : styles.statusOut]}>
                    <Ionicons
                      name={item.status === 'in_stock' ? 'checkmark-circle' : 'arrow-up-circle'}
                      size={14}
                      color={item.status === 'in_stock' ? colors.success : colors.textSecondary}
                    />
                    <Text style={[styles.statusText, { color: item.status === 'in_stock' ? colors.success : colors.textSecondary }]}>
                      {item.status === 'in_stock' ? 'Ada Stok' : 'Sudah Keluar'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.nameText}>{item.name}</Text>
                {item.category ? <Text style={styles.categoryText}>{item.category}</Text> : null}

                {item.scroll_code ? (
                  <View style={styles.scrollBox}>
                    <View style={styles.scrollBoxTop}>
                      <View style={styles.scrollIcon}>
                        <Ionicons name="barcode-outline" size={18} color={colors.textSecondary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.scrollCodeText}>Gulungan {item.scroll_code.code}</Text>
                        <Text style={styles.scrollCodeMeta}>
                          {item.scroll_code.status === 'used'
                            ? 'Sudah ditandai habis'
                            : item.scroll_code.store
                              ? `Dialokasikan ke ${item.scroll_code.store.name}`
                              : 'Belum dialokasikan ke toko'}
                        </Text>
                      </View>
                    </View>
                    {item.scroll_code.total_length_meters !== null ? (
                      <View style={{ gap: 6 }}>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${Math.round((remainingRatio ?? 0) * 100)}%` }]} />
                        </View>
                        <Text style={styles.scrollCodeMeta}>
                          Sisa {parseFloat(item.scroll_code.remaining_length_meters ?? '0').toLocaleString('id-ID')} dari {parseFloat(item.scroll_code.total_length_meters).toLocaleString('id-ID')} m
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {/* Tindakan gulungan: catat pemakaian meter dan tandai habis. */}
              {item.scroll_code?.total_length_meters !== null && item.scroll_code?.status !== 'used' && !actionsBlocked && (
                usageFormOpen ? (
                  <View style={styles.card}>
                    <Text style={styles.formTitle}>Catat Pemakaian</Text>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Meter dipakai</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        value={usageMeters}
                        onChangeText={setUsageMeters}
                        keyboardType="decimal-pad"
                        autoFocus
                      />
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Mis. dipakai untuk mobil apa, no. polisi, nama customer"
                        placeholderTextColor={colors.textMuted}
                        value={usageNote}
                        onChangeText={setUsageNote}
                      />
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Nomor SPK</Text>
                      <Text style={styles.helperText}>
                        Wajib. Ketik nomornya, atau pilih dari daftar lewat tanda panah. Kalau roll ini ternyata cacat, pekerjaan yang memakainya ikut ketahuan.
                      </Text>
                      <SpkPicker
                        number={usageSpkNumber}
                        onChangeNumber={changeUsageSpkNumber}
                        linked={usageSpk}
                        onPick={pickUsageSpk}
                        endpoint={`/api/staff/inventory/${encodeURIComponent(code)}/spks`}
                        colors={colors}
                      />
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Potongan sisa disimpan (opsional)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Jumlah potongan, kosongkan kalau tidak ada"
                        placeholderTextColor={colors.textMuted}
                        value={offcutCount}
                        onChangeText={(v) => setOffcutCount(v.replace(/[^0-9]/g, ''))}
                        keyboardType="number-pad"
                        maxLength={2}
                      />
                    </View>

                    {usageError ? <Text style={styles.errorText}>{usageError}</Text> : null}
                    <View style={styles.formActions}>
                      <PressableScale
                        style={styles.cancelButton}
                        onPress={() => { setUsageFormOpen(false); resetUsageForm(); setUsageError(null); }}
                        disabled={recordingUsage}
                      >
                        <Text style={styles.cancelButtonText}>Batal</Text>
                      </PressableScale>
                      <PressableScale style={[styles.primaryButton, { flex: 1 }, recordingUsage && styles.disabled]} onPress={handleRecordUsage} disabled={recordingUsage}>
                        {recordingUsage ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Simpan</Text>}
                      </PressableScale>
                    </View>
                  </View>
                ) : (
                  <PressableScale style={styles.secondaryButton} onPress={openUsageForm} accessibilityRole="button">
                    <Ionicons name="cut-outline" size={20} color={colors.textPrimary} />
                    <Text style={styles.secondaryButtonText}>Catat Pemakaian (Meter)</Text>
                  </PressableScale>
                )
              )}

              {offcuts.length > 0 && !usageFormOpen && !actionsBlocked ? (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Potongan sisa tersimpan ({offcuts.length})</Text>
                  {offcuts.map((o) => (
                    <View key={o.id}>
                      <View style={styles.offcutRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.offcutTitle}>Potongan #{o.id}</Text>
                          {o.location || o.notes ? <Text style={styles.helperText} numberOfLines={2}>{[o.location, o.notes].filter(Boolean).join(' · ')}</Text> : null}
                        </View>
                        {usingOffcutId === o.id ? null : (
                          <PressableScale style={styles.offcutUseButton} onPress={() => { resetOffcutForm(); setUsingOffcutId(o.id); }} accessibilityRole="button">
                            <Text style={styles.offcutUseText}>Pakai</Text>
                          </PressableScale>
                        )}
                      </View>

                      {usingOffcutId === o.id ? (
                        <View style={styles.offcutForm}>
                          <Text style={styles.fieldLabel}>Nomor SPK</Text>
                          <SpkPicker
                            number={offcutSpkNumber}
                            onChangeNumber={changeOffcutSpkNumber}
                            linked={offcutSpk}
                            onPick={pickOffcutSpk}
                            endpoint={`/api/staff/inventory/${encodeURIComponent(code)}/spks`}
                            colors={colors}
                          />
                          <Text style={[styles.fieldLabel, { marginTop: spacing.sm }]}>Bagian mobil yang dikerjakan</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="Mis. Kaca belakang, Spion kiri"
                            placeholderTextColor={colors.textMuted}
                            value={offcutCarPart}
                            onChangeText={setOffcutCarPart}
                          />
                          {offcutError ? <Text style={styles.errorText}>{offcutError}</Text> : null}
                          <View style={styles.formActions}>
                            <PressableScale style={styles.cancelButton} onPress={resetOffcutForm} disabled={savingOffcut}>
                              <Text style={styles.cancelButtonText}>Batal</Text>
                            </PressableScale>
                            <PressableScale style={[styles.primaryButton, { flex: 1 }, savingOffcut && styles.disabled]} onPress={handleUseOffcut} disabled={savingOffcut}>
                              {savingOffcut ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Pakai Potongan</Text>}
                            </PressableScale>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}

              {item.scroll_code && item.scroll_code.total_length_meters === null && item.scroll_code.status !== 'used' ? (
                <View style={styles.noticeBox}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.noticeText}>
                    Total Panjang gulungan ini belum diisi, jadi pemakaian meter belum bisa dicatat. Minta admin mengisinya di menu Kode Gulungan.
                  </Text>
                </View>
              ) : null}

              {item.scroll_code?.status === 'allocated' && !usageFormOpen && !actionsBlocked ? (
                <PressableScale style={[styles.secondaryButton, markingUsed && styles.disabled]} onPress={handleMarkUsed} disabled={markingUsed} accessibilityRole="button">
                  {markingUsed ? <ActivityIndicator color={colors.textPrimary} /> : <Ionicons name="checkmark-done-outline" size={20} color={colors.textPrimary} />}
                  <Text style={styles.secondaryButtonText}>{markingUsed ? 'Memproses...' : 'Tandai Habis'}</Text>
                </PressableScale>
              ) : null}

              {/* Catat masuk/keluar dihapus dari aplikasi (2026-11-23): alokasi produk PPF/WF hanya lewat panel admin. */}
              {actionsBlocked ? (
                <View style={styles.noticeBox}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.noticeText}>
                    {!canModify
                      ? 'Akun ini hanya bisa melihat data barang. Hubungi admin kalau perlu mencatat pemakaian.'
                      : `Gulungan ini dialokasikan ke ${item.scroll_code?.store?.name ?? 'toko lain'}. Hanya staf toko itu atau akses penuh yang bisa mencatatnya.`}
                  </Text>
                </View>
              ) : null}

              {item.scroll_code && item.scroll_code.usages.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>Riwayat pemakaian meter</Text>
                  {item.scroll_code.usages.map((u) => (
                    <View key={u.id} style={styles.historyRow}>
                      <View style={[styles.historyIcon, { backgroundColor: colors.warningBg }]}>
                        <Ionicons name="cut-outline" size={18} color={colors.warning} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.historyText}>
                          {parseFloat(u.meters).toLocaleString('id-ID')} meter{u.user ? ` · ${u.user.name}` : ''}
                        </Text>
                        {u.note ? <Text style={styles.historyNote}>{u.note}</Text> : null}
                        <Text style={styles.historyDate}>{formatDateTime(u.created_at)}</Text>
                      </View>
                    </View>
                  ))}
                </>
              ) : null}

              <Text style={styles.sectionLabel}>Riwayat terbaru</Text>
              {item.movements.length === 0 ? (
                <View style={styles.noticeBox}>
                  <Ionicons name="swap-vertical-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.noticeText}>Belum ada riwayat keluar/masuk untuk barang ini.</Text>
                </View>
              ) : (
                <>
                  {[...item.movements, ...extraMovements].map((m) => {
                    const tone = movementTone(m.type);
                    return (
                      <View key={m.id} style={[styles.historyRow, m.reversed_at ? { opacity: 0.55 } : null]}>
                        <View style={[styles.historyIcon, { backgroundColor: tone.bg }]}>
                          <Ionicons name={m.type === 'in' ? 'arrow-down' : m.type === 'out' ? 'arrow-up' : 'arrow-undo'} size={18} color={tone.fg} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[styles.historyText, m.reversed_at ? { textDecorationLine: 'line-through' } : null]}>
                            {m.type === 'in' ? 'Masuk' : m.type === 'out' ? 'Keluar' : 'Koreksi'}
                            {m.destination_store ? ` · ke ${m.destination_store.name}` : ''}
                            {m.user ? ` · ${m.user.name}` : ''}
                          </Text>
                          {m.note ? <Text style={styles.historyNote}>{m.note}</Text> : null}
                          {m.reversed_at ? (
                            <View style={styles.reversedPill}>
                              <Text style={styles.reversedText}>Dibatalkan{m.reversed_reason ? `: ${m.reversed_reason}` : ''}</Text>
                            </View>
                          ) : null}
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
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    accentText: { color: accentText },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    roundButtonAccent: { backgroundColor: colors.accentSoft, borderColor: 'transparent' },
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
    codePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    codePillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3, color: accentText },
    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    statusInStock: { backgroundColor: colors.successBg },
    // "Sudah Keluar" adalah keadaan normal, bukan galat: netral, tidak merah.
    statusOut: { backgroundColor: chip },
    statusText: { fontSize: 12, fontWeight: '800' },
    nameText: { fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    categoryText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary, marginTop: -8 },

    scrollBox: { padding: 14, borderRadius: 18, backgroundColor: chip, gap: spacing.sm + 2 },
    scrollBoxTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
    scrollIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: card },
    scrollCodeText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary },
    scrollCodeMeta: { fontSize: 12.5, fontWeight: '500', color: colors.textSecondary, marginTop: 1 },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: isDark ? colors.border : '#dcdce4', overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },

    secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.pill, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    secondaryButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    primaryButton: {
      height: 52, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 3,
    },
    primaryButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: '#ffffff' },
    disabled: { opacity: 0.6 },
    disabledStrong: { opacity: 0.35 },

    offcutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
    offcutTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    offcutUseButton: { paddingHorizontal: 16, height: 36, borderRadius: radius.pill, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
    offcutUseText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.accent },
    offcutForm: { paddingBottom: spacing.sm },
    noticeBox: { flexDirection: 'row', gap: spacing.sm, padding: 14, borderRadius: 18, backgroundColor: chip },
    noticeText: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 19, color: colors.textSecondary },

    formTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    field: { gap: 6 },
    fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
    helperText: { fontSize: 12, fontWeight: '500', color: colors.textMuted, lineHeight: 18 },
    input: { minHeight: 50, borderRadius: 18, paddingHorizontal: 16, fontSize: fontSize.sm, color: colors.textPrimary, backgroundColor: chip },
    errorText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.danger },
    formActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cancelButton: { paddingHorizontal: spacing.lg, height: 52, alignItems: 'center', justifyContent: 'center' },
    cancelButtonText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '700' },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { height: 38, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    chipActive: { backgroundColor: colors.accent },
    chipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    chipTextActive: { color: '#ffffff' },


    sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2, color: colors.textMuted, marginTop: spacing.sm, marginLeft: 4 },
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
