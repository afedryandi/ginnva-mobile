import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StatusBar } from 'expo-status-bar';
import BookingPicker, { BookingOption } from '@/components/staff/BookingPicker';
import SpkPicker, { SpkOption } from '@/components/staff/SpkPicker';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { darkColors, fontSize, spacing, radius, shadow } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

const SHOW_BOOKING_LINK = false;

interface CreateMemoResponse {
  data: { id: number; flow?: string };
}

interface StoreOption {
  id: number;
  name: string;
}

function Section({ icon, title, optional, hint, styles, accentText, children }: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  optional?: boolean;
  hint?: string;
  styles: ReturnType<typeof createStyles>;
  accentText: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={17} color={accentText} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
        {optional ? <Text style={styles.optionalTag}>Opsional</Text> : null}
      </View>
      {hint ? <Text style={styles.helperText}>{hint}</Text> : null}
      {children}
    </View>
  );
}

// Header memo dulu — barang ditambahkan satu-satu di layar detail setelah ini, supaya stok langsung berkurang begitu barang ditambah
// (bukan ditunda sampai seluruh form disubmit sekaligus).
export default function CreateMemoScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, insets.bottom, isDark), [colors, insets.bottom, isDark]);
  const { staff } = useStaffAuth();
  // Sama pola dengan needsStorePicker di staff/inventory/[code].tsx — akun super_admin/direksi tidak terikat 1 toko, jadi WAJIB pilih
  // toko manual (backend menolak tanpa store_id untuk akun full-access, lihat MaterialMemoController::store()). Staff toko biasa tidak
  // melihat bagian ini sama sekali, otomatis pakai toko akunnya sendiri.
  const isFullAccess = staff?.role === 'super_admin' || staff?.role === 'direksi';

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  // Installer / Installer Leader wajib mengisi kendaraan, dan memo mereka diajukan ke store manager (barang dicatat gudang setelah disetujui).
  const isRequester = !!staff?.can_request_memo || !isFullAccess;
  const vehicleRequired = !!staff?.can_request_memo;
  const [spkNumber, setSpkNumber] = useState('');
  // SPK terkait (opsional), alur Booking -> SPK -> Memo. Datang dari tombol "Buat Memo Barang" di layar SPK (params) atau dipilih lewat tanda panah
  // di kolom Nomor SPK. Nomor yang diketik manual tetap boleh untuk memo tanpa SPK terdaftar (tidak tertaut).
  const params = useLocalSearchParams<{ spkId?: string; spkNumber?: string; spkCustomer?: string; spkStoreId?: string; spkBrand?: string; spkPlate?: string }>();
  const [spk, setSpk] = useState<{ id: number; spk_number: string; customer_name: string | null } | null>(null);
  const prefilledStore = useRef<number | null>(null);
  // Tautan ke booking (opsional): hanya booking toko memo yang belum selesai dan belum bermemo.
  const [booking, setBooking] = useState<BookingOption | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFullAccess) return;
    staffApiFetch<{ data: StoreOption[] }>('/api/stores', { skipAuth: true })
      .then((res) => setStores(res.data ?? []))
      .catch(() => setStores([]));
  }, [isFullAccess]);

  // Isi awal dari layar SPK (params): SPK, nomornya, toko (akses penuh), dan kendaraan. Hanya sekali saat layar dibuka.
  useEffect(() => {
    const id = Number(params.spkId);
    if (!id) return;
    setSpk({ id, spk_number: params.spkNumber ?? '', customer_name: params.spkCustomer ?? null });
    setSpkNumber(params.spkNumber ?? '');
    applyVehicle(params.spkBrand, params.spkPlate);
    const store = Number(params.spkStoreId);
    if (isFullAccess && store) {
      prefilledStore.current = store;
      setStoreId(store);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ganti toko (akses penuh) membatalkan booking dan SPK yang sudah dipilih, karena keduanya harus milik toko memo.
  // Toko yang baru saja diisi dari SPK dilewati (SPK itu memang milik toko tersebut).
  useEffect(() => {
    setBooking(null);
    if (storeId !== null && storeId === prefilledStore.current) return;
    setSpk(null);
  }, [storeId]);

  // Merek dan tipe pada SPK tersimpan satu teks ("Toyota Avanza"): kata pertama jadi merek, sisanya tipe. Hanya mengisi yang masih kosong.
  const applyVehicle = (brandModel?: string | null, plate?: string | null) => {
    const text = (brandModel ?? '').trim();
    if (text) {
      const [first, ...rest] = text.split(/\s+/);
      setVehicleBrand((cur) => cur || first);
      if (rest.length) setVehicleModel((cur) => cur || rest.join(' '));
    }
    if (plate) setVehiclePlate((cur) => cur || plate);
  };

  const pickSpk = (picked: SpkOption) => {
    setSpk({ id: picked.id, spk_number: picked.spk_number, customer_name: picked.customer_name });
    setSpkNumber(picked.spk_number);
    applyVehicle(picked.vehicle_brand, picked.vehicle_plate);
  };

  // Mengetik nomor yang berbeda dari SPK yang dipilih melepas tautan (nomor manual = memo tanpa SPK terdaftar).
  const changeSpkNumber = (text: string) => {
    setSpkNumber(text);
    if (spk && text.trim() !== spk.spk_number) setSpk(null);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (isFullAccess && !storeId) {
      setError('Pilih toko dulu.');
      return;
    }
    if (vehicleRequired && (!vehicleBrand.trim() || !vehicleModel.trim() || !vehiclePlate.trim())) {
      setError('Isi merek, tipe, dan plat nomor kendaraan.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await staffApiFetch<CreateMemoResponse>('/api/staff/memos', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_brand: vehicleBrand.trim() || null,
          vehicle_model: vehicleModel.trim() || null,
          vehicle_plate: vehiclePlate.trim() || null,
          spk_number: spkNumber.trim() || null,
          spk_id: spk?.id ?? null,
          booking_id: booking?.id ?? null,
          notes: notes.trim() || null,
          ...(isFullAccess ? { store_id: storeId } : {}),
        }),
      });
      hapticSuccess();
      // Memo pengajuan dibuka di layar pengajuan; memo langsung (akses penuh) tetap lanjut menambah barang.
      if ((res.data as { flow?: string }).flow === 'request') {
        router.replace({ pathname: '/staff/memos/request/[id]', params: { id: String(res.data.id) } } as never);
      } else {
        router.replace({ pathname: '/staff/memos/[id]', params: { id: String(res.data.id) } } as never);
      }
    } catch (err) {
      hapticError();
      setError(err instanceof ApiError ? err.message : 'Gagal membuat memo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>Memo Baru</Text>
          {isFullAccess ? <Text style={styles.subtitle} numberOfLines={1}>Barang ditambah di langkah berikutnya</Text> : null}
        </View>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {isFullAccess ? (
            <FadeInUp index={0}>
              <Section
                icon="storefront-outline"
                title="Toko"
                hint="Akun ini tidak terikat ke satu toko, jadi pilih toko untuk memo ini."
                styles={styles}
                accentText={accentText}
              >
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
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        {active ? <Ionicons name="checkmark" size={15} color="#ffffff" /> : null}
                        <Text style={[styles.storeChipText, active && styles.storeChipTextActive]}>{s.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Section>
            </FadeInUp>
          ) : null}

          {/* Tautan booking disembunyikan dulu (2026-11-17); ubah SHOW_BOOKING_LINK untuk menampilkannya lagi. */}
          {SHOW_BOOKING_LINK ? (
          <FadeInUp index={1}>
            <Section
              icon="link-outline"
              title="Booking"
              optional
              hint="Tautkan supaya bahan yang dipakai ikut biaya booking itu. Hanya booking toko ini yang belum selesai dan belum bermemo."
              styles={styles}
              accentText={accentText}
            >
              <BookingPicker value={booking} onChange={setBooking} storeId={isFullAccess ? storeId : null} requireStore={isFullAccess} colors={colors} />
            </Section>
          </FadeInUp>
          ) : null}

          <FadeInUp index={2}>
            <Section icon="car-sport-outline" title="Kendaraan dan SPK" styles={styles} accentText={accentText}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Merek kendaraan{vehicleRequired ? ' *' : ''}</Text>
                <TextInput style={styles.input} placeholder="Mis. Toyota" placeholderTextColor={colors.textMuted} value={vehicleBrand} onChangeText={setVehicleBrand} />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Tipe kendaraan{vehicleRequired ? ' *' : ''}</Text>
                <TextInput style={styles.input} placeholder="Mis. Avanza" placeholderTextColor={colors.textMuted} value={vehicleModel} onChangeText={setVehicleModel} />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Plat nomor{vehicleRequired ? ' *' : ''}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Mis. B 1234 XYZ"
                  placeholderTextColor={colors.textMuted}
                  value={vehiclePlate}
                  onChangeText={setVehiclePlate}
                  autoCapitalize="characters"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Nomor SPK</Text>
                <SpkPicker
                  number={spkNumber}
                  onChangeNumber={changeSpkNumber}
                  linked={spk}
                  onPick={pickSpk}
                  storeId={isFullAccess ? storeId : null}
                  requireStore={isFullAccess}
                  borderColor={isDark ? colors.border : '#e8e8ee'}
                  colors={colors}
                />
              </View>
            </Section>
          </FadeInUp>

          <FadeInUp index={4}>
            <Section icon="chatbox-ellipses-outline" title="Catatan" optional styles={styles} accentText={accentText}>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="Catatan tambahan"
                placeholderTextColor={colors.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </Section>
          </FadeInUp>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PressableScale style={[styles.submitBtn, submitting && styles.submitBtnOff]} onPress={handleSubmit} disabled={submitting} accessibilityRole="button">
            <Text style={styles.submitText}>{submitting ? 'Mengirim...' : isFullAccess ? 'Buat Memo dan Tambah Barang' : 'Ajukan Pengambilan Barang'}</Text>
            {!submitting ? <Ionicons name="arrow-forward" size={18} color="#ffffff" /> : null}
          </PressableScale>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, insetsBottom: number, isDark: boolean) {
  const line = isDark ? colors.border : '#e8e8ee';

  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: colors.bg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.9, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },

    form: { paddingHorizontal: 20, paddingTop: spacing.xs, gap: 14, paddingBottom: spacing.xxl + insetsBottom },

    section: {
      gap: 12,
      padding: 18,
      borderRadius: 26,
      borderWidth: 1,
      borderColor: line,
      backgroundColor: colors.surface,
      ...shadow.sm,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sectionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    optionalTag: { fontSize: 11, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 10, height: 24, lineHeight: 24, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
    helperText: { fontSize: 12.5, color: colors.textMuted, lineHeight: 19 },

    fieldGroup: { gap: 6 },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    input: {
      minHeight: 50,
      paddingHorizontal: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: line,
      backgroundColor: colors.bg,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
    },
    textarea: { minHeight: 96, paddingTop: 14, textAlignVertical: 'top' },

    storeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    storeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.surfaceElevated },
    storeChipActive: { backgroundColor: colors.accent },
    storeChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    storeChipTextActive: { color: '#ffffff' },

    errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 20, backgroundColor: colors.dangerBg },
    errorText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.danger, lineHeight: 20 },

    submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 27, backgroundColor: colors.accent, marginTop: spacing.xs },
    submitBtnOff: { opacity: 0.6 },
    submitText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '800' },
  });
}
