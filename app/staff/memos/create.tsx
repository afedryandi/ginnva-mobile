import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius, shadow } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

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
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, insets.bottom), [colors, insets.bottom]);
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
        <Pressable onPress={() => router.back()} style={styles.sideButton} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Buat Memo Baru</Text>
        <View style={styles.sideButton} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {isFullAccess && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="storefront-outline" size={16} color={colors.accent} />
                <Text style={styles.sectionTitle}>Toko</Text>
              </View>
              <Text style={styles.helperText}>
                Akun Anda tidak terikat ke 1 toko tertentu, jadi pilih dulu toko yang memo ini dibuat untuk siapa.
              </Text>
              <View style={styles.storeChips}>
                {stores.map((s) => {
                  const active = storeId === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      style={[styles.storeChip, active && styles.storeChipActive]}
                      onPress={() => {
                        hapticLight();
                        setStoreId(s.id);
                      }}
                    >
                      {active && <Ionicons name="checkmark-circle" size={14} color="#ffffff" style={{ marginRight: 4 }} />}
                      <Text style={[styles.storeChipText, active && styles.storeChipTextActive]}>{s.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="car-sport-outline" size={16} color={colors.accent} />
              <Text style={styles.sectionTitle}>Info Kendaraan</Text>
              <Text style={styles.optionalTag}>opsional</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Mis. Toyota Avanza - B 1234 XYZ"
              placeholderTextColor={colors.textMuted}
              value={vehicleInfo}
              onChangeText={setVehicleInfo}
            />

            <View style={[styles.sectionHeader, { marginTop: spacing.md }]}>
              <Ionicons name="document-text-outline" size={16} color={colors.accent} />
              <Text style={styles.sectionTitle}>SPK No</Text>
              <Text style={styles.optionalTag}>opsional</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Nomor SPK"
              placeholderTextColor={colors.textMuted}
              value={spkNumber}
              onChangeText={setSpkNumber}
            />

            <View style={[styles.sectionHeader, { marginTop: spacing.md }]}>
              <Ionicons name="chatbox-ellipses-outline" size={16} color={colors.accent} />
              <Text style={styles.sectionTitle}>Catatan</Text>
              <Text style={styles.optionalTag}>opsional</Text>
            </View>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Catatan tambahan"
              placeholderTextColor={colors.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

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

function createStyles(colors: typeof darkColors, insetsBottom: number) {
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
    form: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl + insetsBottom },

    section: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.xs,
      ...shadow.sm,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sectionTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    optionalTag: { fontSize: 10, color: colors.textMuted, marginLeft: 'auto' },

    input: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
      marginTop: spacing.xs,
    },
    textarea: { minHeight: 80, textAlignVertical: 'top' },
    helperText: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 16 },
    storeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
    storeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    storeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    storeChipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
    storeChipTextActive: { color: '#ffffff' },

    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.dangerBg,
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    errorText: { fontSize: fontSize.sm, color: colors.danger, flex: 1 },
    submitBtn: { marginTop: spacing.xs },
  });
}
