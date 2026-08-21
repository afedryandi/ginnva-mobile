import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';

interface CreateMemoResponse {
  data: { id: number };
}

interface StoreOption {
  id: number;
  name: string;
}

// Header memo dulu — barang ditambahkan satu-satu di layar detail setelah
// ini, supaya stok langsung berkurang begitu barang ditambah (bukan
// ditunda sampai seluruh form disubmit sekaligus).
export default function CreateMemoScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { staff } = useStaffAuth();
  // Sama pola dengan needsStorePicker di staff/inventory/[code].tsx — akun
  // super_admin/direksi tidak terikat 1 toko, jadi WAJIB pilih toko manual
  // (backend menolak tanpa store_id untuk akun full-access, lihat
  // MaterialMemoController::store()). Staff toko biasa tidak lihat field
  // ini sama sekali, otomatis pakai toko akunnya sendiri.
  const isFullAccess = staff?.role === 'super_admin' || staff?.role === 'direksi';

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState('');
  const [spkNumber, setSpkNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFullAccess) return;
    staffApiFetch<{ data: StoreOption[] }>('/api/stores', { skipAuth: true })
      .then((res) => setStores(res.data ?? []))
      .catch(() => setStores([]));
  }, [isFullAccess]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (isFullAccess && !storeId) {
      setError('Pilih toko dulu.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await staffApiFetch<CreateMemoResponse>('/api/staff/memos', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_info: vehicleInfo.trim() || null,
          spk_number: spkNumber.trim() || null,
          notes: notes.trim() || null,
          ...(isFullAccess ? { store_id: storeId } : {}),
        }),
      });
      hapticSuccess();
      router.replace({ pathname: '/staff/memos/[id]', params: { id: String(res.data.id) } } as never);
    } catch (err) {
      hapticError();
      setError(err instanceof ApiError ? err.message : 'Gagal membuat memo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Buat Memo Baru</Text>
        <View style={styles.sideButton} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {isFullAccess && (
            <>
              <Text style={styles.label}>Toko</Text>
              <Text style={styles.helperText}>
                Akun Anda tidak terikat ke 1 toko tertentu, jadi pilih dulu toko yang memo ini dibuat untuk siapa.
              </Text>
              <View style={styles.storeChips}>
                {stores.map((s) => (
                  <Pressable
                    key={s.id}
                    style={[styles.storeChip, storeId === s.id && styles.storeChipActive]}
                    onPress={() => setStoreId(s.id)}
                  >
                    <Text style={[styles.storeChipText, storeId === s.id && styles.storeChipTextActive]}>{s.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Info Kendaraan (opsional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Mis. Toyota Avanza - B 1234 XYZ"
            placeholderTextColor={colors.textMuted}
            value={vehicleInfo}
            onChangeText={setVehicleInfo}
          />

          <Text style={styles.label}>SPK No (opsional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Nomor SPK"
            placeholderTextColor={colors.textMuted}
            value={spkNumber}
            onChangeText={setSpkNumber}
          />

          <Text style={styles.label}>Catatan (opsional)</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Catatan tambahan"
            placeholderTextColor={colors.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <Button
            label="Buat Memo & Tambah Barang"
            onPress={handleSubmit}
            loading={submitting}
            style={styles.submitBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
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
    form: { padding: spacing.md, gap: spacing.xs },
    label: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm },
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
    textarea: { minHeight: 80, textAlignVertical: 'top' },
    helperText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: -2 },
    storeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    storeChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    storeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    storeChipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
    storeChipTextActive: { color: '#ffffff' },
    errorText: { fontSize: fontSize.sm, color: colors.danger, marginTop: spacing.sm },
    submitBtn: { marginTop: spacing.lg },
  });
}
