import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, StyleSheet, ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { clearCountDraft, loadCountDraft, mergeDraftRows, saveCountDraft } from '@/lib/count-draft';

type Kind = 'materials' | 'consumables' | 'rolls';

interface CatalogRow {
  id: number;
  name: string;
  code: string | null;
  unit: string;
}

interface CountRow {
  id: number;
  name: string;
  unit: string;
  counted: string;
  note: string;
}

interface StoreOption {
  id: number;
  name: string;
}

function parseQty(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Hitung Stok (Stok Opname) di mobile: gudang menghitung banyak bahan dalam satu sesi (tambah dengan cari nama atau scan label), mengisi
 * hasil hitung fisik, lalu mengirimnya sebagai DRAF sesi Stok Opname. HITUNG BUTA: stok sistem tidak ditampilkan di sini; stok baru berubah
 * setelah admin menerapkan sesinya di panel, dan selisihnya baru terlihat di rincian sesi setelah terkirim.
 */
export default function StockCountScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { staff } = useStaffAuth();
  const isFullAccess = staff?.role === 'super_admin' || staff?.role === 'direksi';
  const params = useLocalSearchParams<{ type?: string; addId?: string }>();
  const kind: Kind = params.type === 'consumables' ? 'consumables' : params.type === 'rolls' ? 'rolls' : 'materials';
  // Mode gulungan PPF/WF: daftar hitung terisi otomatis (semua gulungan Dialokasikan di toko), hasil hitung = sisa meter hasil ukur.
  const isRolls = kind === 'rolls';
  const itemType = isRolls ? 'scroll_code' : kind === 'materials' ? 'raw_material' : 'consumable_item';
  const title = isRolls ? 'Hitung Gulungan PPF/WF' : kind === 'materials' ? 'Hitung Bahan Baku' : 'Hitung Barang Habis Pakai';

  const [rows, setRows] = useState<CountRow[]>([]);
  const [problems, setProblems] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CatalogRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const latest = useRef(0);
  const handledAddId = useRef<string | null>(null);

  // Draf hitung disimpan di perangkat supaya hasil hitung yang sudah diisi tidak hilang saat aplikasi tertutup. draftReady baru true setelah
  // draf lama diperiksa: sebelum itu daftar yang masih kosong tidak boleh menimpa draf yang tersimpan.
  const ownerId = staff?.id ?? null;
  const [draftReady, setDraftReady] = useState(false);
  const snapshot = useRef({ rows, storeId });
  snapshot.current = { rows, storeId };

  useEffect(() => {
    if (ownerId === null) return;
    let cancelled = false;

    loadCountDraft(ownerId, kind).then((draft) => {
      if (cancelled) return;

      const restore = () => {
        if (!draft) return;
        setRows((current) => mergeDraftRows(draft.rows, current));
        if (draft.storeId) setStoreId((current) => current ?? draft.storeId);
      };

      if (!draft || draft.rows.length === 0) {
        setDraftReady(true);
        return;
      }

      // Kembali dari layar Scan (membawa bahan baru): lanjutkan diam-diam, tidak perlu bertanya lagi.
      if (params.addId) {
        restore();
        setDraftReady(true);
        return;
      }

      const filledCount = draft.rows.filter((r) => parseQty(r.counted) !== null).length;
      const when = new Date(draft.savedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

      Alert.alert(
        'Lanjutkan hitung sebelumnya?',
        `${draft.rows.length} bahan (${filledCount} sudah diisi), disimpan ${when}.`,
        [
          { text: 'Buang', style: 'destructive', onPress: () => { clearCountDraft(ownerId, kind); setDraftReady(true); } },
          { text: 'Lanjutkan', onPress: () => { restore(); setDraftReady(true); } },
        ],
        { cancelable: false }
      );
    });

    return () => {
      cancelled = true;
    };
    // Hanya saat layar dibuka (atau akun/jenis berganti); params.addId sengaja tidak jadi pemicu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, kind]);

  // Simpan tiap perubahan (ditunda sebentar), dan langsung saat aplikasi masuk latar belakang atau ditutup.
  useEffect(() => {
    if (!draftReady || ownerId === null) return;
    const timer = setTimeout(() => saveCountDraft({ ownerId, kind, storeId, rows }), 300);
    return () => clearTimeout(timer);
  }, [rows, storeId, draftReady, ownerId, kind]);

  useEffect(() => {
    if (!draftReady || ownerId === null) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') saveCountDraft({ ownerId, kind, storeId: snapshot.current.storeId, rows: snapshot.current.rows });
    });
    return () => subscription.remove();
  }, [draftReady, ownerId, kind]);

  // Akses penuh tidak terikat toko: harus memilih toko sesi.
  useEffect(() => {
    if (!isFullAccess) return;
    staffApiFetch<{ data: StoreOption[] }>('/api/stores', { skipAuth: true })
      .then((res) => setStores(res.data))
      .catch(() => setStores([]));
  }, [isFullAccess]);

  // Gulungan: setelah draf lama diperiksa, daftar diganti dengan gulungan yang ada sekarang (hasil yang sudah diisi tetap dipertahankan).
  useEffect(() => {
    if (!isRolls || !draftReady) return;
    if (isFullAccess && !storeId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    staffApiFetch<{ data: CatalogRow[] }>(`/api/staff/stock-opnames/rolls${isFullAccess ? `?store_id=${storeId}` : ''}`)
      .then((res) => {
        if (cancelled) return;
        setRows((current) =>
          res.data.map((r) => current.find((c) => c.id === r.id) ?? { id: r.id, name: r.name, unit: r.unit, counted: '', note: '' })
        );
      })
      .catch((err) => {
        if (!cancelled) Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Daftar gulungan gagal dimuat.');
      });
    return () => {
      cancelled = true;
    };
  }, [isRolls, draftReady, isFullAccess, storeId]);

  const addRow = useCallback((item: { id: number; name: string; unit: string }) => {
    setRows((current) => {
      if (current.some((r) => r.id === item.id)) return current;
      return [...current, { id: item.id, name: item.name, unit: item.unit, counted: '', note: '' }];
    });
  }, []);

  // Hasil scan dari layar Scan datang lewat parameter addId: muat bahannya (nama dan satuan saja) lalu tambahkan ke daftar hitung.
  useEffect(() => {
    const addId = params.addId;
    if (isRolls || !addId || handledAddId.current === addId) return;
    handledAddId.current = addId;
    staffApiFetch<{ data: CatalogRow }>(`/api/staff/${kind}/${addId}`)
      .then((res) => addRow(res.data))
      .catch((err) => Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Bahan hasil scan gagal dimuat.'));
  }, [params.addId, kind, addRow]);

  useEffect(() => {
    if (isRolls || search.trim().length < 2) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      const requestId = ++latest.current;
      setSearching(true);
      staffApiFetch<{ data: CatalogRow[] }>(`/api/staff/${kind}?search=${encodeURIComponent(search.trim())}`)
        .then((res) => {
          if (requestId === latest.current) setResults(res.data);
        })
        .catch(() => {
          if (requestId === latest.current) setResults([]);
        })
        .finally(() => {
          if (requestId === latest.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, kind, isRolls]);

  const update = (id: number, patch: Partial<CountRow>) => {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (problems[id]) setProblems((p) => { const next = { ...p }; delete next[id]; return next; });
  };

  const filled = rows.filter((r) => parseQty(r.counted) !== null);

  const send = async () => {
    setSubmitting(true);
    setProblems({});
    try {
      const res = await staffApiFetch<{ message: string; data: { number: string } }>('/api/staff/stock-opnames', {
        method: 'POST',
        body: JSON.stringify({
          ...(isFullAccess ? { store_id: storeId } : {}),
          items: filled.map((r) => ({ item_type: itemType, item_id: r.id, actual_quantity: parseQty(r.counted), note: r.note.trim() || undefined })),
        }),
      });
      // Terkirim: draf di perangkat tidak dipakai lagi (daftar dikosongkan agar tidak tersimpan ulang).
      if (ownerId !== null) await clearCountDraft(ownerId, kind);
      setRows([]);
      Alert.alert('Terkirim', res.message, [{ text: 'Lihat Sesi', onPress: () => router.replace('/staff/stock/opnames' as never) }]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const map: Record<number, string> = {};
        Object.entries(err.errors ?? {}).forEach(([key, messages]) => {
          if (key.startsWith('row_')) map[Number(key.slice(4))] = messages[0];
        });
        setProblems(map);
      }
      Alert.alert('Belum Terkirim', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => {
    Keyboard.dismiss();
    if (filled.length === 0) {
      Alert.alert('Belum Ada Hasil Hitung', isRolls ? 'Isi sisa meter minimal satu gulungan.' : 'Isi hasil hitung fisik minimal satu bahan.');
      return;
    }
    if (isFullAccess && !storeId) {
      Alert.alert('Pilih Toko', 'Pilih toko untuk sesi ini dulu.');
      return;
    }
    Alert.alert(
      'Kirim Hasil Hitung',
      `${filled.length} ${isRolls ? 'gulungan' : 'bahan'} dihitung. Hasil masuk sebagai sesi Stok Opname dan ${isRolls ? 'sisa meter' : 'stok'} berubah setelah admin menerapkan. Kirim sekarang?`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Kirim', onPress: send },
      ]
    );
  };

  const progress = rows.length > 0 ? Math.min(1, filled.length / rows.length) : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <StatusBar style={isDark ? 'light' : 'dark'} />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
          </View>
          {!isRolls ? (
            <Pressable
              onPress={() => router.push({ pathname: '/staff/stock/scan', params: { mode: 'count', type: kind } } as never)}
              style={[styles.roundButton, styles.roundButtonAccent]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Scan label untuk menambah bahan"
            >
              <Ionicons name="qr-code-outline" size={20} color={styles.accentText.color} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push('/staff/stock/opnames' as never)} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Daftar sesi stok opname">
            <Ionicons name="list-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <FlatList
          data={rows}
          keyExtractor={(row) => String(row.id)}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={{ gap: spacing.md }}>
              {isFullAccess ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.sectionLabel}>Toko untuk sesi ini</Text>
                  <View style={styles.storeRow}>
                    {stores.map((s) => (
                      <Pressable key={s.id} style={[styles.storeChip, storeId === s.id && styles.storeChipActive]} onPress={() => setStoreId(s.id)} accessibilityRole="button">
                        <Text style={[styles.storeChipText, storeId === s.id && { color: '#ffffff' }]}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {!isRolls ? (
              <View>
                <View style={styles.searchWrap}>
                  <Ionicons name="search" size={18} color={colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Cari bahan untuk ditambahkan"
                    placeholderTextColor={colors.textMuted}
                    value={search}
                    onChangeText={setSearch}
                  />
                  {searching ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                </View>
                {results.length > 0 ? (
                  <View style={styles.resultBox}>
                    {results.slice(0, 8).map((item, i) => {
                      const added = rows.some((r) => r.id === item.id);
                      return (
                        <Pressable
                          key={item.id}
                          style={[styles.resultRow, i > 0 && styles.resultDivider]}
                          onPress={() => { addRow(item); setSearch(''); setResults([]); }}
                          accessibilityRole="button"
                        >
                          <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.resultMeta}>{item.unit}</Text>
                          <Ionicons name={added ? 'checkmark-circle' : 'add-circle-outline'} size={22} color={added ? colors.success : colors.accent} />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="clipboard-outline" size={34} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>Daftar hitung masih kosong</Text>
              <Text style={styles.emptyText}>{isRolls ? (isFullAccess && !storeId ? null : 'Tidak ada gulungan berstatus Dialokasikan dengan data panjang di toko ini.') : null}</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <FadeInUp index={index} enabled={index < 8}>
              <View style={[styles.card, problems[item.id] ? styles.cardProblem : null]}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Pressable
                    style={styles.removeButton}
                    onPress={() => setRows((cur) => cur.filter((r) => r.id !== item.id))}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Hapus ${item.name} dari daftar`}
                  >
                    <Ionicons name="close" size={16} color={colors.textSecondary} />
                  </Pressable>
                </View>
                <View style={styles.countRow}>
                  <TextInput
                    style={styles.countInput}
                    value={item.counted}
                    onChangeText={(text) => update(item.id, { counted: text })}
                    keyboardType="decimal-pad"
                    placeholder={isRolls ? 'Sisa meter hasil ukur' : 'Hasil hitung fisik'}
                    placeholderTextColor={colors.textMuted}
                  />
                  <View style={styles.unitPill}>
                    <Text style={styles.unit}>{item.unit}</Text>
                  </View>
                </View>
                <TextInput
                  style={styles.noteInput}
                  value={item.note}
                  onChangeText={(text) => update(item.id, { note: text })}
                  placeholder="Catatan (wajib kalau diminta)"
                  placeholderTextColor={colors.textMuted}
                />
                {problems[item.id] ? (
                  <View style={styles.problemPill}>
                    <Ionicons name="alert-circle" size={14} color={colors.danger} />
                    <Text style={styles.problemText}>{problems[item.id]}</Text>
                  </View>
                ) : null}
              </View>
            </FadeInUp>
          )}
        />

        <View style={styles.footer}>
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text style={styles.footerText}>{filled.length} terisi dari {rows.length}</Text>
          </View>
          <PressableScale
            style={[styles.submit, (filled.length === 0 || submitting) && styles.submitDisabled]}
            onPress={submit}
            disabled={filled.length === 0 || submitting}
            accessibilityRole="button"
            accessibilityLabel="Kirim hasil hitung"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="paper-plane-outline" size={20} color="#ffffff" />
                <Text style={styles.submitText}>Kirim Hasil Hitung</Text>
              </>
            )}
          </PressableScale>
        </View>
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

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    roundButtonAccent: { backgroundColor: colors.accentSoft, borderColor: 'transparent' },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.8, lineHeight: 28, color: colors.textPrimary },

    listContent: { paddingHorizontal: 20, paddingBottom: spacing.xl, flexGrow: 1, gap: spacing.sm + 2 },
    sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginLeft: 4 },
    storeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    storeChip: { height: 38, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    storeChipActive: { backgroundColor: colors.accent },
    storeChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },

    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 16, height: 52,
      borderRadius: 26, borderWidth: 1, borderColor: line, backgroundColor: card, ...shadow,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    resultBox: { marginTop: spacing.sm, borderRadius: 20, borderWidth: 1, borderColor: line, backgroundColor: card, overflow: 'hidden', ...shadow },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 16, minHeight: 52 },
    resultDivider: { borderTopWidth: 1, borderTopColor: line },
    resultName: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '700' },
    resultMeta: { fontSize: 12, fontWeight: '600', color: colors.textMuted },


    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm, paddingHorizontal: spacing.lg },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

    card: { padding: 16, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line, gap: spacing.sm + 2, ...shadow },
    cardProblem: { borderColor: colors.danger },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    cardName: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    removeButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    countInput: { flex: 1, height: 52, borderRadius: 18, paddingHorizontal: 16, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, backgroundColor: chip, fontVariant: ['tabular-nums'] },
    unitPill: { minWidth: 56, height: 52, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.accentSoft },
    unit: { fontSize: fontSize.sm, fontWeight: '800', color: accentText },
    noteInput: { height: 46, borderRadius: 16, paddingHorizontal: 16, fontSize: fontSize.sm, color: colors.textPrimary, backgroundColor: chip },
    problemPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.dangerBg },
    problemText: { fontSize: 12, fontWeight: '700', color: colors.danger },

    footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: spacing.sm, backgroundColor: screenBg, borderTopWidth: 1, borderTopColor: line },
    progressRow: { gap: 6 },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: isDark ? colors.border : '#dcdce4', overflow: 'hidden' },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
    footerText: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textAlign: 'center', fontVariant: ['tabular-nums'] },
    submit: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 4,
    },
    submitDisabled: { opacity: 0.4 },
    submitText: { fontSize: fontSize.base, fontWeight: '700', color: '#ffffff' },
  });
}
