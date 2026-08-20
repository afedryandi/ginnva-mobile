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

type AssetStatus = 'aktif' | 'diperbaiki' | 'rusak' | 'dijual' | 'hilang';

const STATUS_LABEL: Record<AssetStatus, string> = {
  aktif: 'Aktif Dipakai',
  diperbaiki: 'Sedang Diperbaiki',
  rusak: 'Rusak',
  dijual: 'Dijual',
  hilang: 'Hilang',
};

interface Store {
  id: number;
  name: string;
}

interface AssetData {
  id: number;
  asset_tag: string;
  name: string;
  category: string | null;
  status: AssetStatus;
  assignee: { id: number; name: string } | null;
  store: Store | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  notes: string | null;
}

function statusColor(status: AssetStatus, colors: typeof darkColors) {
  switch (status) {
    case 'aktif':
      return colors.success;
    case 'diperbaiki':
      return colors.warning;
    default:
      return colors.danger;
  }
}

export default function AssetDetailScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { staff } = useStaffAuth();
  // Sama seperti User::isFullAccess() di backend — cuma super_admin/direksi
  // yang boleh pindahkan aset antar toko (lihat AssetController::update()).
  const isFullAccess = staff?.role === 'super_admin' || staff?.role === 'direksi';

  const [asset, setAsset] = useState<AssetData | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [formStatus, setFormStatus] = useState<AssetStatus>('aktif');
  const [formStoreId, setFormStoreId] = useState<number | null>(null);
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchAsset = useCallback(() => {
    setError(null);
    return staffApiFetch<{ data: AssetData; stores: Store[] }>(`/api/staff/assets/${encodeURIComponent(code)}`)
      .then((res) => {
        setAsset(res.data);
        setStores(res.stores);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Aset tidak ditemukan atau koneksi bermasalah.');
      });
  }, [code]);

  useEffect(() => {
    setLoading(true);
    fetchAsset().finally(() => setLoading(false));
  }, [fetchAsset]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAsset();
    setRefreshing(false);
  }, [fetchAsset]);

  const openEdit = () => {
    if (!asset) return;
    setFormStatus(asset.status);
    setFormStoreId(asset.store?.id ?? null);
    setFormNotes('');
    setFormError(null);
    setEditing(true);
  };

  const handleSubmit = () => {
    setSubmitting(true);
    setFormError(null);

    staffApiFetch<{ message: string; data: AssetData }>(`/api/staff/assets/${encodeURIComponent(code)}/update`, {
      method: 'POST',
      body: JSON.stringify({
        status: formStatus,
        store_id: formStoreId,
        notes: formNotes.trim() || undefined,
      }),
    })
      .then((res) => {
        hapticSuccess();
        setAsset(res.data);
        setEditing(false);
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        hapticError();
        setFormError(err instanceof ApiError ? err.message : 'Gagal menyimpan perubahan. Periksa koneksi internet Anda.');
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
        <Text style={styles.headerTitle} numberOfLines={1}>Detail Aset Tetap</Text>
        <Pressable onPress={() => router.replace('/staff/assets/scan' as never)} style={styles.sideButton}>
          <Ionicons name="scan-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerStateText}>Memuat data aset...</Text>
        </View>
      ) : error || !asset ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error ?? 'Aset tidak ditemukan.'}</Text>
          <Pressable style={styles.retryButton} onPress={() => router.replace('/staff/assets/scan' as never)}>
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
                <Text style={styles.codeText}>{asset.asset_tag}</Text>
                <Text style={styles.nameText}>{asset.name}</Text>
                {asset.category && <Text style={styles.categoryText}>{asset.category}</Text>}
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusColor(asset.status, colors) + '22' }]}>
                <Text style={[styles.statusText, { color: statusColor(asset.status, colors) }]}>
                  {STATUS_LABEL[asset.status]}
                </Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={16} color={colors.textMuted} />
              <Text style={styles.infoText}>{asset.assignee?.name ?? 'Belum ditentukan pemegangnya'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              <Text style={styles.infoText}>{asset.store?.name ?? 'Kantor Pusat / belum ditentukan'}</Text>
            </View>
            {asset.notes && (
              <View style={styles.infoRow}>
                <Ionicons name="document-text-outline" size={16} color={colors.textMuted} />
                <Text style={styles.infoText}>{asset.notes}</Text>
              </View>
            )}
          </View>

          {editing ? (
            <View style={styles.card}>
              <Text style={styles.formTitle}>Ubah Status & Lokasi</Text>

              <Text style={styles.fieldLabel}>Status</Text>
              <View style={styles.chipRow}>
                {(Object.keys(STATUS_LABEL) as AssetStatus[]).map((s) => (
                  <Pressable
                    key={s}
                    style={[styles.chip, formStatus === s && styles.chipActive]}
                    onPress={() => setFormStatus(s)}
                  >
                    <Text style={[styles.chipText, formStatus === s && styles.chipTextActive]}>
                      {STATUS_LABEL[s]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {isFullAccess && (
                <>
                  <Text style={styles.fieldLabel}>Lokasi (Toko)</Text>
                  <View style={styles.chipRow}>
                    <Pressable
                      style={[styles.chip, formStoreId === null && styles.chipActive]}
                      onPress={() => setFormStoreId(null)}
                    >
                      <Text style={[styles.chipText, formStoreId === null && styles.chipTextActive]}>Kantor Pusat</Text>
                    </Pressable>
                    {stores.map((s) => (
                      <Pressable
                        key={s.id}
                        style={[styles.chip, formStoreId === s.id && styles.chipActive]}
                        onPress={() => setFormStoreId(s.id)}
                      >
                        <Text style={[styles.chipText, formStoreId === s.id && styles.chipTextActive]}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Mis. alasan pindah/rusak"
                placeholderTextColor={colors.textMuted}
                value={formNotes}
                onChangeText={setFormNotes}
              />

              {formError && <Text style={styles.errorText}>{formError}</Text>}

              <View style={styles.formActions}>
                <Pressable style={styles.cancelButton} onPress={() => setEditing(false)} disabled={submitting}>
                  <Text style={styles.cancelButtonText}>Batal</Text>
                </Pressable>
                <Button label={submitting ? 'Menyimpan...' : 'Simpan'} onPress={handleSubmit} loading={submitting} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <Button label="Ubah Status / Lokasi" onPress={openEdit} />
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
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill },
    statusText: { fontSize: fontSize.xs, fontWeight: '700' },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    infoText: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
    formTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    fieldLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
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
  });
}
