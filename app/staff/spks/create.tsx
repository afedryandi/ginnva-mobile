import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Modal, type TextInputProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

interface ConfirmedBooking {
  id: number;
  booking_number: string;
  customer_name: string;
  phone_number: string | null;
}

interface ChecklistTemplate {
  pekerjaan: string[];
  extra_service: string[];
  perlengkapan: string[];
}

interface ChecklistRow {
  label: string;
  is_checked: boolean;
}

type Checklist = Record<'pekerjaan' | 'extra_service' | 'perlengkapan', ChecklistRow[]>;

const CATEGORY_LABELS: Record<keyof Checklist, string> = {
  pekerjaan: 'Uraian Pekerjaan',
  extra_service: 'Extra Services',
  perlengkapan: 'Perlengkapan Kendaraan',
};

const CATEGORY_ICONS: Record<keyof Checklist, React.ComponentProps<typeof Ionicons>['name']> = {
  pekerjaan: 'construct-outline',
  extra_service: 'sparkles-outline',
  perlengkapan: 'briefcase-outline',
};

const VEHICLE_TYPES: { value: string; label: string }[] = [
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'mpv', label: 'MPV' },
  { value: 'jeep', label: 'Jeep' },
];

const FUEL_LEVELS: { value: string; label: string }[] = [
  { value: 'e', label: 'E' },
  { value: 'quarter', label: '1/4' },
  { value: 'half', label: '1/2' },
  { value: 'three_quarter', label: '3/4' },
  { value: 'f', label: 'F' },
];

// Kolom isian berlabel: label kecil di atas, kotak lembut tanpa garis tepi, dan cincin merah tipis saat sedang diisi.
function Field({ label, styles, focusColor, ...input }: { label: string; styles: ReturnType<typeof createStyles>; focusColor: string } & TextInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <AppTextInput
        {...input}
        onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
        style={[styles.input, input.multiline && styles.textarea, focused && { borderColor: focusColor }]}
      />
    </View>
  );
}

// SPK diisi langsung dari HP saat inspeksi kendaraan di lapangan
// (diminta user 2026-09-16) -- checklist di mobile SENGAJA cuma bisa
// dicentang/tidak (tidak bisa tambah/hapus item custom seperti di
// Filament), supaya form tetap ringkas dipakai satu tangan di lapangan.
// Tampilan dirancang ulang 2026-11-13: kartu putih di atas latar abu-putih, kolom isian berlabel, checklist yang bisa diketuk per baris,
// dan tombol simpan yang selalu terlihat di bawah.
export default function CreateSpkScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark, insets.bottom), [colors, isDark, insets.bottom]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  // Dibuka dari detail booking: bookingId terisi, jadi langsung ke form untuk booking itu tanpa memilih lagi.
  const { bookingId: bookingIdParam } = useLocalSearchParams<{ bookingId?: string }>();
  const [step, setStep] = useState<'pick-booking' | 'form'>('pick-booking');
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [bookings, setBookings] = useState<ConfirmedBooking[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<ConfirmedBooking | null>(null);

  // SPK manual (tanpa booking): pelanggan diisi sendiri dan installer pengerja dipilih dari installer toko.
  const [manual, setManual] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [installerOptions, setInstallerOptions] = useState<{ id: number; name: string }[]>([]);
  const [installerIds, setInstallerIds] = useState<number[]>([]);
  const [installerSheet, setInstallerSheet] = useState(false);
  const [installerQuery, setInstallerQuery] = useState('');

  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleVin, setVehicleVin] = useState('');
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [vehicleKm, setVehicleKm] = useState('');
  const [fuelLevel, setFuelLevel] = useState<string | null>(null);
  const [batteryNote, setBatteryNote] = useState('');
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<Checklist>({ pekerjaan: [], extra_service: [], perlengkapan: [] });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingBookings(true);

    if (bookingIdParam) {
      staffApiFetch<{ data: { id: number; booking_number?: string; customer?: { name?: string | null; phone_number?: string | null } | null } }>(`/api/staff/bookings/${bookingIdParam}`)
        .then((res) => pickBooking({
          id: res.data.id,
          booking_number: res.data.booking_number ?? '',
          customer_name: res.data.customer?.name ?? '',
          phone_number: res.data.customer?.phone_number ?? null,
        }))
        .catch(() => hapticError())
        .finally(() => setLoadingBookings(false));

      return;
    }

    staffApiFetch<{ data: ConfirmedBooking[] }>('/api/staff/bookings?status=confirmed&without_spk=1')
      .then((res) => setBookings(res.data ?? []))
      .catch(() => hapticError())
      .finally(() => setLoadingBookings(false));
  }, []);

  const pickManual = () => {
    setManual(true);
    setSelectedBooking(null);
    staffApiFetch<{ data: { id: number; name: string }[] }>('/api/staff/spks/assignable-installers')
      .then((res) => setInstallerOptions(res.data ?? []))
      .catch(() => hapticError());
    openForm();
  };

  const toggleInstaller = (id: number) => {
    hapticLight();
    setInstallerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const pickBooking = (booking: ConfirmedBooking) => {
    setManual(false);
    setSelectedBooking(booking);
    openForm();
  };

  const openForm = () => {
    hapticLight();
    setStep('form');

    staffApiFetch<{ data: ChecklistTemplate }>('/api/staff/spks/checklist-template')
      .then((res) => {
        const template = res.data;
        setChecklist({
          pekerjaan: template.pekerjaan.map((label) => ({ label, is_checked: false })),
          extra_service: template.extra_service.map((label) => ({ label, is_checked: false })),
          perlengkapan: template.perlengkapan.map((label) => ({ label, is_checked: false })),
        });
      })
      .catch(() => hapticError());
  };

  const toggleItem = (category: keyof Checklist, index: number) => {
    hapticLight();
    setChecklist((prev) => ({
      ...prev,
      [category]: prev[category].map((row, i) => (i === index ? { ...row, is_checked: !row.is_checked } : row)),
    }));
  };

  const handleSubmit = async () => {
    if ((!selectedBooking && !manual) || submitting) return;

    if (manual && !customerName.trim()) {
      setError('Isi nama pelanggan.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const checklistItems = (['pekerjaan', 'extra_service', 'perlengkapan'] as const).flatMap((category) =>
      checklist[category].map((row) => ({ category, label: row.label, is_checked: row.is_checked }))
    );

    try {
      const res = await staffApiFetch<{ data: { id: number } }>('/api/staff/spks', {
        method: 'POST',
        body: JSON.stringify({
          booking_id: selectedBooking?.id,
          customer_name: selectedBooking ? selectedBooking.customer_name : customerName.trim(),
          phone_number: selectedBooking ? selectedBooking.phone_number : customerPhone.trim() || undefined,
          installer_ids: manual ? installerIds : undefined,
          vehicle_plate: vehiclePlate.trim() || undefined,
          vehicle_vin: vehicleVin.trim() || undefined,
          vehicle_brand: vehicleBrand.trim() || undefined,
          vehicle_year: vehicleYear.trim() || undefined,
          vehicle_type: vehicleType ?? undefined,
          vehicle_km: vehicleKm.trim() ? Number(vehicleKm) : undefined,
          fuel_level: fuelLevel ?? undefined,
          battery_note: batteryNote.trim() || undefined,
          checked_in_at: new Date().toISOString(),
          notes: notes.trim() || undefined,
          checklist_items: checklistItems,
        }),
      });
      hapticSuccess();
      // SPK sudah tersimpan: buka detailnya, lalu langsung lanjut ke inspeksi Kondisi Kendaraan. Kalau inspeksi ditunda (kembali atau aplikasi
      // ditutup), SPK tetap ada dan kartu Kondisi Kendaraan di detailnya bisa dilanjutkan kapan saja.
      const spkId = String(res.data.id);
      router.replace({ pathname: '/staff/spks/[id]', params: { id: spkId } } as never);
      router.push({ pathname: '/staff/spks/damage', params: { id: spkId } } as never);
    } catch (err) {
      hapticError();
      setError(err instanceof ApiError ? err.message : 'Gagal membuat SPK. Periksa koneksi internet.');
    } finally {
      setSubmitting(false);
    }
  };

  const inForm = step === 'form';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable
          onPress={() => (inForm ? setStep('pick-booking') : router.back())}
          style={styles.backButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={inForm ? 'Kembali ke pilihan booking' : 'Kembali'}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{inForm ? 'Buat SPK' : 'Mulai SPK'}</Text>
        </View>
      </View>

      {!inForm ? (
        loadingBookings ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.bookingList} showsVerticalScrollIndicator={false}>
            <PressableScale style={styles.bookingCard} onPress={pickManual} accessibilityRole="button" accessibilityLabel="Buat SPK tanpa booking">
              <View style={styles.bookingIconWrap}>
                <Ionicons name="create-outline" size={22} color={accentText} />
              </View>
              <View style={styles.bookingText}>
                <Text style={styles.bookingCustomer} numberOfLines={1}>Tanpa booking</Text>
                <Text style={styles.bookingNumber} numberOfLines={1}>Isi data pelanggan sendiri</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </PressableScale>

            {bookings.length === 0 ? (
              <Text style={styles.centerStateText}>Tidak ada booking terkonfirmasi yang belum punya SPK.</Text>
            ) : null}

            {bookings.map((b, index) => (
              <FadeInUp key={b.id} index={index} enabled={index < 8}>
                <PressableScale style={styles.bookingCard} onPress={() => pickBooking(b)} accessibilityRole="button" accessibilityLabel={`${b.booking_number}, ${b.customer_name}`}>
                  <View style={styles.bookingIconWrap}>
                    <Ionicons name="car-sport-outline" size={22} color={accentText} />
                  </View>
                  <View style={styles.bookingText}>
                    <Text style={styles.bookingCustomer} numberOfLines={1}>{b.customer_name}</Text>
                    <Text style={styles.bookingNumber} numberOfLines={1}>{b.booking_number}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </PressableScale>
              </FadeInUp>
            ))}
          </ScrollView>
        )
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Booking yang dipilih */}
            <View style={styles.bookingSummary}>
              <View style={styles.bookingIconWrap}>
                <Ionicons name="document-text-outline" size={22} color={accentText} />
              </View>
              <View style={styles.bookingText}>
                <Text style={styles.bookingCustomer} numberOfLines={1}>{selectedBooking ? selectedBooking.customer_name : 'Tanpa booking'}</Text>
                <Text style={styles.bookingNumber} numberOfLines={1}>{selectedBooking ? selectedBooking.booking_number : 'SPK manual'}</Text>
              </View>
              <Pressable onPress={() => setStep('pick-booking')} hitSlop={8} accessibilityRole="button">
                <Text style={styles.changeLink}>Ganti</Text>
              </Pressable>
            </View>

            {manual ? (
              <>
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionIcon}>
                      <Ionicons name="person-outline" size={18} color={accentText} />
                    </View>
                    <Text style={styles.sectionTitle}>Pelanggan</Text>
                  </View>
                  <Field label="Nama pelanggan" styles={styles} focusColor={colors.accent} placeholder="Nama pelanggan" placeholderTextColor={colors.textMuted} value={customerName} onChangeText={setCustomerName} />
                  <Field label="No. telepon" styles={styles} focusColor={colors.accent} placeholder="08xxxxxxxxxx" placeholderTextColor={colors.textMuted} value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />
                </View>

                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionIcon}>
                      <Ionicons name="people-outline" size={18} color={accentText} />
                    </View>
                    <Text style={styles.sectionTitle}>Installer</Text>
                    {installerIds.length > 0 ? <Text style={styles.counter}>{installerIds.length} dipilih</Text> : null}
                  </View>
                  {installerOptions.length === 0 ? (
                    <Text style={styles.centerStateText}>Belum ada installer di toko ini.</Text>
                  ) : (
                    <Pressable style={styles.selectField} onPress={() => { hapticLight(); setInstallerQuery(''); setInstallerSheet(true); }} accessibilityRole="button" accessibilityLabel="Pilih installer">
                      <Text style={[styles.selectText, installerIds.length === 0 && { color: colors.textMuted }]} numberOfLines={2}>
                        {installerIds.length === 0
                          ? 'Pilih installer'
                          : installerOptions.filter((o) => installerIds.includes(o.id)).map((o) => o.name).join(', ')}
                      </Text>
                      <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                    </Pressable>
                  )}
                </View>

                <Modal visible={installerSheet} transparent animationType="slide" onRequestClose={() => setInstallerSheet(false)}>
                  <Pressable style={styles.sheetBackdrop} onPress={() => setInstallerSheet(false)} accessibilityLabel="Tutup" />
                  <View style={styles.sheet}>
                    <View style={styles.sheetHeader}>
                      <Text style={styles.sheetTitle}>Pilih Installer</Text>
                      <Pressable onPress={() => setInstallerSheet(false)} hitSlop={8} accessibilityRole="button">
                        <Text style={styles.changeLink}>Selesai</Text>
                      </Pressable>
                    </View>
                    {installerOptions.length > 6 ? (
                      <AppTextInput
                        style={styles.input}
                        placeholder="Cari nama installer"
                        placeholderTextColor={colors.textMuted}
                        value={installerQuery}
                        onChangeText={setInstallerQuery}
                      />
                    ) : null}
                    <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                      {installerOptions
                        .filter((o) => o.name.toLowerCase().includes(installerQuery.trim().toLowerCase()))
                        .map((i, index) => {
                          const active = installerIds.includes(i.id);

                          return (
                            <Pressable
                              key={i.id}
                              style={[styles.checkRow, index > 0 && styles.checkRowBorder]}
                              onPress={() => toggleInstaller(i.id)}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: active }}
                            >
                              <View style={[styles.checkBox, active && styles.checkBoxOn]}>
                                {active ? <Ionicons name="checkmark" size={16} color="#ffffff" /> : null}
                              </View>
                              <Text style={styles.checkLabel}>{i.name}</Text>
                            </Pressable>
                          );
                        })}
                    </ScrollView>
                  </View>
                </Modal>
              </>
            ) : null}

            {/* Data kendaraan */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="car-sport-outline" size={18} color={accentText} />
                </View>
                <Text style={styles.sectionTitle}>Data Kendaraan</Text>
              </View>

              <Field label="No. Polisi" styles={styles} focusColor={colors.accent} placeholder="B 1234 ABC" placeholderTextColor={colors.textMuted} value={vehiclePlate} onChangeText={setVehiclePlate} autoCapitalize="characters" />
              <Field label="No. Rangka" styles={styles} focusColor={colors.accent} placeholder="Nomor rangka (VIN)" placeholderTextColor={colors.textMuted} value={vehicleVin} onChangeText={setVehicleVin} autoCapitalize="characters" />
              <View style={styles.row2}>
                <View style={styles.flex1}>
                  <Field label="Merek" styles={styles} focusColor={colors.accent} placeholder="Toyota" placeholderTextColor={colors.textMuted} value={vehicleBrand} onChangeText={setVehicleBrand} />
                </View>
                <View style={styles.flex1}>
                  <Field label="Tahun" styles={styles} focusColor={colors.accent} placeholder="2024" placeholderTextColor={colors.textMuted} value={vehicleYear} onChangeText={setVehicleYear} keyboardType="number-pad" maxLength={4} />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Jenis</Text>
                <View style={styles.optionRow}>
                  {VEHICLE_TYPES.map((t) => {
                    const active = vehicleType === t.value;

                    return (
                      <Pressable key={t.value} style={[styles.option, active && styles.optionActive]} onPress={() => { hapticLight(); setVehicleType((prev) => (prev === t.value ? null : t.value)); }} accessibilityRole="button" accessibilityState={{ selected: active }}>
                        <Text style={[styles.optionText, active && styles.optionTextActive]}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.row2}>
                <View style={styles.flex1}>
                  <Field label="Kilometer" styles={styles} focusColor={colors.accent} placeholder="0" placeholderTextColor={colors.textMuted} value={vehicleKm} onChangeText={setVehicleKm} keyboardType="number-pad" />
                </View>
                <View style={styles.flex1}>
                  <Field label="Battery" styles={styles} focusColor={colors.accent} placeholder="Kondisi aki" placeholderTextColor={colors.textMuted} value={batteryNote} onChangeText={setBatteryNote} />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>BBM</Text>
                <View style={styles.optionRow}>
                  {FUEL_LEVELS.map((f) => {
                    const active = fuelLevel === f.value;

                    return (
                      <Pressable key={f.value} style={[styles.option, styles.optionFuel, active && styles.optionActive]} onPress={() => { hapticLight(); setFuelLevel((prev) => (prev === f.value ? null : f.value)); }} accessibilityRole="button" accessibilityLabel={`BBM ${f.label}`} accessibilityState={{ selected: active }}>
                        <Text style={[styles.optionText, active && styles.optionTextActive]}>{f.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Daftar periksa */}
            {(['pekerjaan', 'extra_service', 'perlengkapan'] as const).map((category) => {
              const rows = checklist[category];
              const done = rows.filter((r) => r.is_checked).length;

              return (
                <View key={category} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionIcon}>
                      <Ionicons name={CATEGORY_ICONS[category]} size={18} color={accentText} />
                    </View>
                    <Text style={styles.sectionTitle}>{CATEGORY_LABELS[category]}</Text>
                    {rows.length > 0 ? <Text style={styles.counter}>{done}/{rows.length}</Text> : null}
                  </View>

                  <View style={styles.checklist}>
                    {rows.map((row, index) => (
                      <Pressable
                        key={row.label}
                        style={[styles.checkRow, index > 0 && styles.checkRowBorder]}
                        onPress={() => toggleItem(category, index)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: row.is_checked }}
                      >
                        <View style={[styles.checkBox, row.is_checked && styles.checkBoxOn]}>
                          {row.is_checked ? <Ionicons name="checkmark" size={16} color="#ffffff" /> : null}
                        </View>
                        <Text style={[styles.checkLabel, row.is_checked && styles.checkLabelOn]}>{row.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}

            {/* Catatan */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="chatbox-ellipses-outline" size={18} color={accentText} />
                </View>
                <Text style={styles.sectionTitle}>Catatan</Text>
                <Text style={styles.optionalTag}>opsional</Text>
              </View>
              <Field label="Catatan tambahan" styles={styles} focusColor={colors.accent} placeholder="Kondisi khusus, permintaan pelanggan, dan sebagainya" placeholderTextColor={colors.textMuted} value={notes} onChangeText={setNotes} multiline />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Tombol simpan selalu terlihat di bawah */}
          <View style={styles.footer}>
            <PressableScale
              style={[styles.submit, submitting && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Simpan SPK"
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={22} color="#ffffff" />
                  <Text style={styles.submitText}>Simpan SPK</Text>
                </>
              )}
            </PressableScale>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean, insetsBottom: number) {
  // Sama dengan Beranda, Notifikasi, dan daftar SPK: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    flex: { flex: 1 },
    flex1: { flex: 1 },
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    centerStateText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },

    bookingList: { paddingHorizontal: 20, paddingBottom: spacing.xxl, gap: 12 },
    bookingCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, padding: 16, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    bookingSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, padding: 16, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    bookingIconWrap: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    bookingText: { flex: 1, gap: 2 },
    bookingCustomer: { fontSize: fontSize.base + 1, fontWeight: '700', color: colors.textPrimary },
    bookingNumber: { fontSize: 13, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    changeLink: { fontSize: 13, fontWeight: '700', color: accentText },

    form: { paddingHorizontal: 20, paddingBottom: spacing.xl, gap: 16 },
    section: { gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sectionIcon: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    sectionTitle: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    counter: { fontSize: 12, fontWeight: '800', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    optionalTag: { fontSize: 12, fontWeight: '600', color: colors.textMuted },

    field: { gap: 6 },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    input: {
      height: 50, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent',
      backgroundColor: chip, fontSize: fontSize.sm + 1, color: colors.textPrimary,
    },
    textarea: { height: undefined, minHeight: 96, paddingTop: 14, textAlignVertical: 'top' },
    row2: { flexDirection: 'row', gap: 12 },

    optionRow: { flexDirection: 'row', gap: 8 },
    selectField: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, backgroundColor: chip },
    selectText: { flex: 1, fontSize: fontSize.sm + 1, fontWeight: '600', color: colors.textPrimary },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: { maxHeight: '70%', gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: Math.max(insetsBottom, 16), borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: card },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sheetTitle: { fontSize: fontSize.base + 1, fontWeight: '800', color: colors.textPrimary },
    sheetList: { flexGrow: 0 },    option: { flex: 1, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    optionFuel: { height: 42 },
    optionActive: { backgroundColor: colors.accent },
    optionText: { fontSize: 13.5, fontWeight: '700', color: colors.textSecondary },
    optionTextActive: { color: '#ffffff' },

    checklist: { marginHorizontal: -4 },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 4 },
    checkRowBorder: { borderTopWidth: 1, borderTopColor: line },
    checkBox: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: isDark ? '#4b4b57' : '#cfcfd8' },
    checkBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkLabel: { flex: 1, fontSize: fontSize.sm + 1, fontWeight: '500', color: colors.textPrimary, lineHeight: 21 },
    checkLabelOn: { color: colors.textMuted },

    errorBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, padding: 14, borderRadius: 18, backgroundColor: colors.dangerBg },
    errorText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.danger, lineHeight: 20 },

    footer: {
      paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(insetsBottom, 12),
      backgroundColor: screenBg, borderTopWidth: 1, borderTopColor: line,
    },
    submit: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 4,
    },
    submitDisabled: { opacity: 0.7 },
    submitText: { fontSize: fontSize.base, fontWeight: '700', color: '#ffffff' },
  });
}
