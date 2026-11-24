import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput, Alert, Image, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { PickerModal } from '@/components/ui/PickerModal';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { shrinkForUpload } from '@/lib/image-compress';
import { useAppTheme } from '@/lib/theme-context';

interface Options {
  categories: { id: number; name: string }[];
  accounts: { id: number; name: string; kind: string; balance: number; voucher_limit: number | null }[];
  stores: { id: number; name: string }[];
}

interface MyExpense {
  key: string;
  amount: number;
  category: string | null;
  date: string;
  description: string | null;
  status: 'recorded' | 'pending_manager' | 'pending_direksi' | 'rejected';
  note: string | null;
}

const STATUS_LABEL: Record<MyExpense['status'], string> = {
  recorded: 'Tercatat',
  pending_manager: 'Menunggu Store Manager',
  pending_direksi: 'Menunggu Direksi',
  rejected: 'Ditolak',
};

function rupiah(amount: number): string {
  return 'Rp' + Math.round(amount).toLocaleString('id-ID');
}

// Catat pengeluaran (Keuangan Fase 5): kas kecil sampai batas per bukti langsung tercatat; selain itu menjadi pengajuan persetujuan.
export default function StaffExpenseScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [options, setOptions] = useState<Options | null>(null);
  const [mine, setMine] = useState<MyExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [opts, list] = await Promise.all([
        staffApiFetch<Options>('/api/staff/finance/expense-options'),
        staffApiFetch<{ expenses: MyExpense[] }>('/api/staff/finance/my-expenses'),
      ]);
      setOptions(opts);
      setMine(list.expenses);
      setAccountId((current) => current ?? opts.accounts.find((a) => a.kind === 'kas_kecil')?.id ?? null);
      setStoreId((current) => current ?? opts.stores[0]?.id ?? null);
    } catch {
      setError('Gagal memuat data. Periksa koneksi internet atau hak akses akun ini.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const pickPhoto = useCallback(async (source: 'camera' | 'gallery') => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Butuh Izin Kamera', 'Aktifkan izin kamera di pengaturan HP untuk memotret nota.');
        return;
      }
    } else if (Platform.OS === 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Izin Galeri Diperlukan', 'Aktifkan izin galeri di pengaturan HP untuk melampirkan foto.');
        return;
      }
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });

    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    // Foto nota dikecilkan (tetap terbaca) sebelum dikirim.
    const shrunk = await shrinkForUpload(asset, asset.fileName || 'nota.jpg');
    setPhoto({ uri: shrunk.uri, name: shrunk.name, mimeType: shrunk.type });
  }, []);

  const choosePhoto = useCallback(() => {
    Alert.alert('Foto Nota', 'Ambil foto nota atau pilih dari galeri', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Kamera', onPress: () => pickPhoto('camera') },
      { text: 'Galeri', onPress: () => pickPhoto('gallery') },
    ]);
  }, [pickPhoto]);

  const selectedAccount = options?.accounts.find((a) => a.id === accountId) ?? null;
  const numericAmount = Number(amount.replace(/[^0-9]/g, ''));

  const submit = useCallback(async () => {
    if (!categoryId) {
      Alert.alert('Kategori Wajib Dipilih', 'Pilih kategori pengeluaran.');
      return;
    }
    if (!numericAmount) {
      Alert.alert('Nominal Wajib Diisi', 'Isi nominal pengeluaran.');
      return;
    }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('finance_category_id', String(categoryId));
      form.append('amount', String(numericAmount));
      if (accountId) form.append('payment_account_id', String(accountId));
      if (storeId) form.append('store_id', String(storeId));
      if (description.trim()) form.append('description', description.trim());
      if (photo) form.append('receipt', { uri: photo.uri, name: photo.name, type: photo.mimeType } as unknown as Blob);

      const res = await staffApiFetch<{ status: 'recorded' | 'pending_approval' }>('/api/staff/finance/expenses', { method: 'POST', body: form });

      Alert.alert(
        res.status === 'recorded' ? 'Tercatat' : 'Menunggu Persetujuan',
        res.status === 'recorded' ? 'Pengeluaran sudah dicatat dan uang kas dikurangi.' : 'Pengeluaran dikirim untuk disetujui sebelum dicatat.'
      );
      setAmount('');
      setDescription('');
      setPhoto(null);
      await load();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [categoryId, numericAmount, accountId, storeId, description, photo, load]);

  const categoryNames = options?.categories.map((c) => c.name) ?? [];
  const categoryName = options?.categories.find((c) => c.id === categoryId)?.name ?? null;
  const goesDirect = !!selectedAccount && selectedAccount.kind === 'kas_kecil' && selectedAccount.voucher_limit !== null && numericAmount > 0 && numericAmount <= selectedAccount.voucher_limit;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Catat Pengeluaran</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {options ? (
            <>
              <Text style={styles.fieldLabel}>Kategori</Text>
              <Pressable style={styles.select} onPress={() => setPickerOpen(true)}>
                <Text style={categoryName ? styles.selectValue : styles.selectPlaceholder}>{categoryName ?? 'Pilih kategori'}</Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </Pressable>

              <Text style={styles.fieldLabel}>Dibayar dari</Text>
              <View style={styles.chipRow}>
                <Pressable style={[styles.chip, accountId === null && styles.chipActive]} onPress={() => setAccountId(null)}>
                  <Text style={[styles.chipText, accountId === null && styles.chipTextActive]}>Bawaan toko</Text>
                </Pressable>
                {options.accounts.map((a) => (
                  <Pressable key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
                    <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                  </Pressable>
                ))}
              </View>
              {selectedAccount ? (
                <Text style={styles.hint}>
                  Saldo {rupiah(selectedAccount.balance)}
                  {selectedAccount.voucher_limit !== null ? ` · langsung tercatat sampai ${rupiah(selectedAccount.voucher_limit)} per bukti` : ''}
                </Text>
              ) : null}

              {options.stores.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>Toko</Text>
                  <View style={styles.chipRow}>
                    {options.stores.map((s) => (
                      <Pressable key={s.id} style={[styles.chip, storeId === s.id && styles.chipActive]} onPress={() => setStoreId(s.id)}>
                        <Text style={[styles.chipText, storeId === s.id && styles.chipTextActive]}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={styles.fieldLabel}>Nominal</Text>
              <TextInput
                style={styles.input}
                value={numericAmount ? numericAmount.toLocaleString('id-ID') : ''}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
              {numericAmount > 0 ? (
                <Text style={styles.hint}>{goesDirect ? 'Langsung tercatat dari kas kecil.' : 'Dikirim dulu untuk persetujuan.'}</Text>
              ) : null}

              <Text style={styles.fieldLabel}>Keterangan</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="mis. Parkir dan bensin ke bank"
                placeholderTextColor={colors.textMuted}
                multiline
              />

              <Text style={styles.fieldLabel}>Foto nota</Text>
              {photo ? (
                <View style={styles.photoRow}>
                  <Image source={{ uri: photo.uri }} style={styles.photo} />
                  <Pressable onPress={() => setPhoto(null)} hitSlop={8}>
                    <Ionicons name="close-circle" size={24} color={colors.danger} />
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.attach} onPress={choosePhoto}>
                  <Ionicons name="camera-outline" size={20} color={colors.accent} />
                  <Text style={styles.attachText}>Ambil Foto Nota</Text>
                </Pressable>
              )}

              <Button label="Kirim" onPress={submit} loading={submitting} style={styles.submit} />

              <Text style={styles.sectionTitle}>Pengeluaran Saya</Text>
              {mine.length === 0 ? (
                <Text style={styles.hint}>Belum ada pengeluaran yang dicatat.</Text>
              ) : (
                mine.map((m) => (
                  <View key={m.key} style={styles.item}>
                    <View style={styles.itemTop}>
                      <Text style={styles.itemAmount}>{rupiah(m.amount)}</Text>
                      <Text style={[styles.itemStatus, m.status === 'rejected' && { color: colors.danger }, m.status === 'recorded' && { color: colors.success }]}>
                        {STATUS_LABEL[m.status]}
                      </Text>
                    </View>
                    <Text style={styles.itemMeta}>{m.category ?? '—'} · {m.date}</Text>
                    {m.description ? <Text style={styles.itemMeta}>{m.description}</Text> : null}
                    {m.status === 'rejected' && m.note ? <Text style={[styles.itemMeta, { color: colors.danger }]}>Alasan: {m.note}</Text> : null}
                  </View>
                ))
              )}
            </>
          ) : null}
        </ScrollView>
      )}

      <PickerModal
        visible={pickerOpen}
        title="Kategori Pengeluaran"
        options={categoryNames}
        selected={categoryName}
        onSelect={(name) => {
          setCategoryId(options?.categories.find((c) => c.name === name)?.id ?? null);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
      </KeyboardAvoidingView>
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
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    fieldLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs },
    select: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface,
      borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, minHeight: 48,
    },
    selectValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
    selectPlaceholder: { fontSize: fontSize.sm, color: colors.textMuted },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
    chipTextActive: { color: '#ffffff' },
    hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
    input: {
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.base, color: colors.textPrimary, minHeight: 48,
    },
    textArea: { minHeight: 80, textAlignVertical: 'top' },
    attach: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accentSoft, borderRadius: radius.md, minHeight: 48,
    },
    attachText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.accent },
    photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    photo: { width: 96, height: 96, borderRadius: radius.md },
    submit: { marginTop: spacing.lg },
    sectionTitle: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginTop: spacing.xl, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
    item: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: 2 },
    itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    itemAmount: { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    itemStatus: { fontSize: fontSize.xs, fontWeight: '700', color: colors.warning },
    itemMeta: { fontSize: fontSize.xs, color: colors.textMuted },
  });
}
