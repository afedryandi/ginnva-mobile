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
import { useStaffAuth } from '@/lib/staff-auth-context';

interface Movement {
  id: number;
  type: 'in' | 'out' | 'correction';
  note: string | null;
  destination_store: { id: number; name: string } | null;
  user: { id: number; name: string } | null;
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

// 1 kardus/kemasan SELALU 1 unit — tidak ada kuantitas untuk diisi.
// "Catat Masuk"/"Catat Keluar" cuma butuh catatan opsional (mis. alasan
// atau tujuan pengiriman). Kalau barangnya punya kode gulungan terkait
// DAN yang scan full-access, "Catat Keluar" juga minta pilih toko tujuan
// (staff biasa tidak perlu — otomatis dari toko akun sendiri).
type MovementForm = { type: 'in' | 'out'; note: string; storeId: number | null } | null;

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
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { staff } = useStaffAuth();
  const isFullAccess = staff?.role === 'super_admin' || staff?.role === 'direksi';

  const [item, setItem] = useState<InventoryItemData | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<MovementForm>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [markingUsed, setMarkingUsed] = useState(false);

  const [usageFormOpen, setUsageFormOpen] = useState(false);
  const [usageMeters, setUsageMeters] = useState('');
  const [usageNote, setUsageNote] = useState('');
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
  const needsStorePicker = (type: 'in' | 'out') =>
    type === 'out' && isFullAccess;

  const openForm = (type: 'in' | 'out') => {
    setForm({ type, note: '', storeId: null });
    setFormError(null);
  };

  const handleSubmitMovement = () => {
    if (!form) return;

    if (needsStorePicker(form.type) && !form.storeId) {
      setFormError('Pilih toko tujuan dulu.');
      return;
    }

    const submit = () => {
      setSubmitting(true);
      setFormError(null);

      staffApiFetch<{ message: string; data: InventoryItemData }>(
        `/api/staff/inventory/${encodeURIComponent(code)}/movement`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: form.type,
            note: form.note.trim() || undefined,
            store_id: needsStorePicker(form.type) ? form.storeId : undefined,
          }),
        }
      )
        .then((res) => {
          hapticSuccess();
          setItem(res.data);
          setForm(null);
          Alert.alert('Berhasil', res.message);
        })
        .catch((err) => {
          hapticError();
          setFormError(err instanceof ApiError ? err.message : 'Gagal mencatat transaksi. Periksa koneksi internet Anda.');
        })
        .finally(() => setSubmitting(false));
    };

    if (form.type === 'out') {
      Alert.alert(
        'Catat Barang Keluar',
        'Tandai barang ini sudah keluar dari gudang?',
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Catat', style: 'destructive', onPress: submit },
        ]
      );
      return;
    }

    submit();
  };

  const handleMarkUsed = () => {
    Alert.alert(
      'Tandai Habis',
      'Tandai kode gulungan barang ini sebagai habis? Kode ini tidak akan muncul lagi di pilihan saat input garansi baru.',
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
                Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menandai habis. Periksa koneksi internet Anda.');
              })
              .finally(() => setMarkingUsed(false));
          },
        },
      ]
    );
  };

  const handleRecordUsage = () => {
    const meters = parseFloat(usageMeters.replace(',', '.'));
    if (!meters || meters <= 0) {
      setUsageError('Isi jumlah meter yang valid (lebih dari 0).');
      return;
    }

    setRecordingUsage(true);
    setUsageError(null);

    staffApiFetch<{ message: string; data: InventoryItemData }>(
      `/api/staff/inventory/${encodeURIComponent(code)}/record-usage`,
      { method: 'POST', body: JSON.stringify({ meters, note: usageNote.trim() || undefined }) }
    )
      .then((res) => {
        hapticSuccess();
        setItem(res.data);
        setUsageFormOpen(false);
        setUsageMeters('');
        setUsageNote('');
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        hapticError();
        setUsageError(err instanceof ApiError ? err.message : 'Gagal mencatat pemakaian. Periksa koneksi internet Anda.');
      })
      .finally(() => setRecordingUsage(false));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Detail Barang</Text>
        <Pressable onPress={() => router.replace('/staff/inventory/scan' as never)} style={styles.sideButton}>
          <Ionicons name="scan-outline" size={22} color={colors.accent} />
        </Pressable>
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
          <Pressable style={styles.retryButton} onPress={() => router.replace('/staff/inventory/scan' as never)}>
            <Text style={styles.retryText}>Scan Ulang</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        >
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.codeText}>{item.code}</Text>
                <Text style={styles.nameText}>{item.name}</Text>
                {item.category && <Text style={styles.categoryText}>{item.category}</Text>}
              </View>
              <View style={[styles.statusBadge, item.status === 'in_stock' ? styles.statusInStock : styles.statusOut]}>
                <Ionicons
                  name={item.status === 'in_stock' ? 'checkmark-circle' : 'arrow-up-circle'}
                  size={16}
                  color={item.status === 'in_stock' ? colors.success : colors.danger}
                />
                <Text
                  style={[
                    styles.statusText,
                    { color: item.status === 'in_stock' ? colors.success : colors.danger },
                  ]}
                >
                  {item.status === 'in_stock' ? 'Ada Stok' : 'Sudah Keluar'}
                </Text>
              </View>
            </View>

            {item.scroll_code && (
              <View style={styles.scrollCodeBox}>
                <Ionicons name="barcode-outline" size={16} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.scrollCodeText}>Kode Gulungan: {item.scroll_code.code}</Text>
                  <Text style={styles.scrollCodeMeta}>
                    {item.scroll_code.status === 'used'
                      ? 'Sudah ditandai habis'
                      : item.scroll_code.store
                        ? `Dialokasikan ke ${item.scroll_code.store.name}`
                        : 'Belum dialokasikan ke toko'}
                  </Text>
                  {item.scroll_code.total_length_meters !== null && (
                    <Text style={styles.scrollCodeMeta}>
                      Sisa Panjang: {parseFloat(item.scroll_code.remaining_length_meters ?? '0').toLocaleString('id-ID')} / {parseFloat(item.scroll_code.total_length_meters).toLocaleString('id-ID')} m
                    </Text>
                  )}
                </View>
              </View>
            )}
          </View>

          {item.scroll_code?.total_length_meters !== null && item.scroll_code?.status !== 'used' && !form && (
            usageFormOpen ? (
              <View style={styles.card}>
                <Text style={styles.formTitle}>Catat Pemakaian</Text>
                <Text style={styles.fieldLabel}>Meter Dipakai</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  value={usageMeters}
                  onChangeText={setUsageMeters}
                  keyboardType="decimal-pad"
                  autoFocus
                />

                <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Mis. dipakai untuk mobil apa, no. polisi, nama customer"
                  placeholderTextColor={colors.textMuted}
                  value={usageNote}
                  onChangeText={setUsageNote}
                />

                {usageError && <Text style={styles.errorText}>{usageError}</Text>}
                <View style={styles.formActions}>
                  <Pressable
                    style={styles.cancelButton}
                    onPress={() => { setUsageFormOpen(false); setUsageMeters(''); setUsageNote(''); setUsageError(null); }}
                    disabled={recordingUsage}
                  >
                    <Text style={styles.cancelButtonText}>Batal</Text>
                  </Pressable>
                  <Button
                    label={recordingUsage ? 'Menyimpan...' : 'Simpan'}
                    onPress={handleRecordUsage}
                    loading={recordingUsage}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : (
              <Button label="Catat Pemakaian (Meter)" variant="outline" onPress={() => setUsageFormOpen(true)} />
            )
          )}

          {item.scroll_code && item.scroll_code.total_length_meters === null && item.scroll_code.status !== 'used' && !form && (
            <Text style={styles.helperTextSmall}>
              Kode gulungan ini belum punya data Total Panjang, jadi pemakaian meter belum bisa dicatat — minta admin isi lewat menu Kode Gulungan dulu.
            </Text>
          )}

          {item.scroll_code?.status === 'allocated' && !form && !usageFormOpen && (
            <Button
              label={markingUsed ? 'Memproses...' : 'Tandai Habis'}
              variant="outline"
              onPress={handleMarkUsed}
              loading={markingUsed}
            />
          )}

          {form ? (
            <View style={styles.card}>
              <Text style={styles.formTitle}>
                {form.type === 'in' ? 'Catat Barang Masuk' : 'Catat Barang Keluar'}
              </Text>

              {needsStorePicker(form.type) && (
                <>
                  <Text style={styles.fieldLabel}>Toko Tujuan</Text>
                  <Text style={styles.helperTextSmall}>
                    Akun Anda tidak terikat ke 1 toko tertentu, jadi pilih dulu toko tujuan barang keluar ini.
                  </Text>
                  <View style={styles.chipRow}>
                    {stores.map((s) => (
                      <Pressable
                        key={s.id}
                        style={[styles.chip, form.storeId === s.id && styles.chipActive]}
                        onPress={() => setForm((f) => f && { ...f, storeId: s.id })}
                      >
                        <Text style={[styles.chipText, form.storeId === s.id && styles.chipTextActive]}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Mis. dikirim ke toko, retur supplier, dll"
                placeholderTextColor={colors.textMuted}
                value={form.note}
                onChangeText={(v) => setForm((f) => f && { ...f, note: v })}
                autoFocus={!needsStorePicker(form.type)}
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
              <Pressable
                style={[styles.actionButton, styles.actionIn, item.status === 'in_stock' && styles.actionDisabled]}
                onPress={() => openForm('in')}
                disabled={item.status === 'in_stock'}
              >
                <Ionicons name="arrow-down-circle" size={22} color="#ffffff" />
                <Text style={styles.actionButtonText}>Catat Masuk</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.actionOut, item.status === 'out' && styles.actionDisabled]}
                onPress={() => openForm('out')}
                disabled={item.status === 'out'}
              >
                <Ionicons name="arrow-up-circle" size={22} color="#ffffff" />
                <Text style={styles.actionButtonText}>Catat Keluar</Text>
              </Pressable>
            </View>
          )}

          {item.scroll_code && item.scroll_code.usages.length > 0 && (
            <>
              <Text style={styles.historyTitle}>Riwayat Pemakaian Meter</Text>
              {item.scroll_code.usages.map((u) => (
                <View key={u.id} style={styles.historyRow}>
                  <Ionicons name="cut-outline" size={20} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyText}>
                      {parseFloat(u.meters).toLocaleString('id-ID')} meter
                      {u.user ? ` — ${u.user.name}` : ''}
                    </Text>
                    {u.note && <Text style={styles.historyNote}>{u.note}</Text>}
                    <Text style={styles.historyDate}>{formatDateTime(u.created_at)}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          <Text style={styles.historyTitle}>Riwayat Terbaru</Text>
          {item.movements.length === 0 ? (
            <Text style={styles.emptyHistoryText}>Belum ada riwayat keluar/masuk untuk barang ini.</Text>
          ) : (
            <>
              {[...item.movements, ...extraMovements].map((m) => (
                <View key={m.id} style={styles.historyRow}>
                  <Ionicons
                    name={m.type === 'in' ? 'arrow-down-circle' : m.type === 'out' ? 'arrow-up-circle' : 'arrow-undo-circle'}
                    size={20}
                    color={m.type === 'in' ? colors.success : m.type === 'out' ? colors.danger : colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyText}>
                      {m.type === 'in' ? 'Masuk' : m.type === 'out' ? 'Keluar' : 'Koreksi'}
                      {m.destination_store ? ` — ke ${m.destination_store.name}` : ''}
                      {m.user ? ` — ${m.user.name}` : ''}
                    </Text>
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
    retryButton: {
      marginTop: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
    },
    retryText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '600' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.md,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    codeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent, letterSpacing: 0.5 },
    nameText: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
    categoryText: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
    },
    statusInStock: { backgroundColor: colors.successBg },
    statusOut: { backgroundColor: colors.dangerBg },
    statusText: { fontSize: fontSize.xs, fontWeight: '700' },
    scrollCodeBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    scrollCodeText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    scrollCodeMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
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
    actionDisabled: { opacity: 0.4 },
    actionButtonText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '700' },
    formTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    fieldLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs },
    helperTextSmall: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: -4, marginBottom: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
    chip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
    chipTextActive: { color: '#ffffff' },
    input: {
      height: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
    },
    errorText: { fontSize: fontSize.sm, color: colors.danger, marginTop: spacing.sm },
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
