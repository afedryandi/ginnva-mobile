import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';

// "Sisa Roll" (diminta 2026-09-14) — pool sisa panjang + potongan lebar
// roll yang sudah dikumpulkan lewat "Kumpulkan Sisa" di halaman Detail
// Barang, dikelompokkan per toko+produk. Dipakai installer untuk cek &
// pakai sisaan sebelum buka roll baru. Lihat RollScrapPool model di
// backend untuk latar belakang lengkap.
interface RollScrapPoolItem {
  id: number;
  remaining_length_meters: string;
  store: { id: number; name: string } | null;
  film_product: { id: number; sku: string; name: string } | null;
}

export default function RollScrapsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [search, setSearch] = useState('');
  const [pools, setPools] = useState<RollScrapPoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [consumingId, setConsumingId] = useState<number | null>(null);
  const [meters, setMeters] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchPools = useCallback((query: string) => {
    setError(null);
    return staffApiFetch<{ data: RollScrapPoolItem[] }>(`/api/staff/roll-scraps?search=${encodeURIComponent(query)}`)
      .then((res) => setPools(res.data))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar sisa roll.');
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => fetchPools(search).finally(() => setLoading(false)), 300);
    return () => clearTimeout(timeout);
  }, [search, fetchPools]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPools(search);
    setRefreshing(false);
  }, [fetchPools, search]);

  const openConsumeForm = (poolId: number) => {
    setConsumingId(poolId);
    setMeters('');
    setNote('');
    setFormError(null);
  };

  const handleConsume = () => {
    if (consumingId === null) return;

    const value = parseFloat(meters.replace(',', '.'));
    if (!value || value <= 0) {
      setFormError('Isi jumlah meter yang valid (lebih dari 0).');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    staffApiFetch<{ message: string; data: RollScrapPoolItem }>(
      `/api/staff/roll-scraps/${consumingId}/consume`,
      { method: 'POST', body: JSON.stringify({ meters: value, note: note.trim() || undefined }) }
    )
      .then((res) => {
        hapticSuccess();
        setConsumingId(null);
        Alert.alert('Berhasil', res.message);
        fetchPools(search);
      })
      .catch((err) => {
        hapticError();
        setFormError(err instanceof ApiError ? err.message : 'Gagal mencatat pemakaian. Periksa koneksi internet Anda.');
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Sisa Roll</Text>
        <View style={styles.sideButton} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nama atau SKU produk..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error}</Text>
        </View>
      ) : pools.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="cut-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>
            Belum ada sisa roll dikumpulkan. Kumpulkan lewat "Kumpulkan Sisa" di Detail Barang, per kode gulungan yang sudah selesai dipakai.
          </Text>
        </View>
      ) : (
        <FlatList
          data={pools}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} onPress={() => openConsumeForm(item.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>
                    {item.film_product ? `${item.film_product.sku} — ${item.film_product.name}` : 'Produk tidak dikenal'}
                  </Text>
                  {item.store && <Text style={styles.rowCategory}>{item.store.name}</Text>}
                </View>
                <View style={styles.stockBadge}>
                  <Ionicons name="cut" size={13} color={colors.success} />
                  <Text style={[styles.rowStock, { color: colors.success }]}>
                    {parseFloat(item.remaining_length_meters).toLocaleString('id-ID')} m
                  </Text>
                </View>
              </Pressable>
            </View>
          )}
        />
      )}

      {consumingId !== null && (
        <Pressable style={styles.modalBackdrop} onPress={() => (submitting ? null : setConsumingId(null))}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.formTitle}>Catat Pemakaian Sisa</Text>

            <Text style={styles.fieldLabel}>Meter Dipakai</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              value={meters}
              onChangeText={setMeters}
              keyboardType="decimal-pad"
              autoFocus
            />

            <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Mis. dipakai untuk mobil apa, no. polisi"
              placeholderTextColor={colors.textMuted}
              value={note}
              onChangeText={setNote}
            />

            {formError && <Text style={styles.errorText}>{formError}</Text>}

            <View style={styles.formActions}>
              <Pressable style={styles.cancelButton} onPress={() => setConsumingId(null)} disabled={submitting}>
                <Text style={styles.cancelButtonText}>Batal</Text>
              </Pressable>
              <Button
                label={submitting ? 'Menyimpan...' : 'Simpan'}
                onPress={handleConsume}
                loading={submitting}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
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
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.sm,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    listContent: { padding: spacing.md, gap: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    rowCategory: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    rowStock: { fontSize: fontSize.sm, fontWeight: '700' },
    stockBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.successBg },
    modalBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    modalCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.xs,
    },
    formTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
    fieldLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs },
    input: {
      height: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
    },
    errorText: { fontSize: fontSize.sm, color: colors.danger, marginTop: spacing.xs },
    formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    cancelButton: { paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
    cancelButtonText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  });
}
