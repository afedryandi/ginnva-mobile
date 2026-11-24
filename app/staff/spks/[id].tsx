import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Alert, type TextInputProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';
import { DamageMark } from '@/components/spk/DamageDiagram';

interface SpkChecklistItem {
  id: number;
  category: 'pekerjaan' | 'extra_service' | 'perlengkapan';
  label: string;
  is_checked: boolean;
}

interface SpkDetail {
  id: number;
  spk_number: string;
  customer_name: string;
  phone_number: string | null;
  address: string | null;
  vehicle_plate: string | null;
  vehicle_vin: string | null;
  vehicle_brand: string | null;
  vehicle_year: string | null;
  vehicle_type: string | null;
  vehicle_km: number | null;
  fuel_level: string | null;
  battery_note: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  notes: string | null;
  checklist_items: SpkChecklistItem[];
  damage_marks: DamageMark[];
  booking: { booking_number: string } | null;
  installers?: { id: number; name: string }[];
  store_id?: number | null;
  // Memo barang yang dibuat dari SPK ini (alur Booking -> SPK -> Memo).
  material_memos?: { id: number; memo_number: string; flow?: string | null; request_status?: string | null }[];
}

interface LinkableBooking {
  id: number;
  booking_number: string;
  customer_name: string;
}

type Category = 'pekerjaan' | 'extra_service' | 'perlengkapan';

const CATEGORY_LABELS: Record<Category, string> = {
  pekerjaan: 'Uraian Pekerjaan',
  extra_service: 'Extra Services',
  perlengkapan: 'Perlengkapan Kendaraan',
};

const CATEGORY_ICONS: Record<Category, React.ComponentProps<typeof Ionicons>['name']> = {
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

// "08:40" dan "12 Nov" dipisah supaya jam bisa tampil besar; kosong ditandai "--:--".
function splitDateTime(iso: string | null): { time: string; date: string } {
  if (!iso) return { time: '--:--', date: 'Belum dicatat' };
  const d = new Date(iso);

  return {
    time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':'),
    date: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}

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

// Tampilan dirancang ulang 2026-11-13, selaras dengan formulir Buat SPK: kartu ringkasan di atas, kartu putih berujung membulat,
// checklist yang bisa diketuk per baris, dan tombol simpan yang selalu terlihat di bawah.
export default function SpkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark, insets.bottom), [colors, isDark, insets.bottom]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const { staff } = useStaffAuth();
  // Boleh membuat memo: akun dengan menu Memo di Hak Akses, atau installer/leader yang boleh mengajukan memo. Server tetap memeriksa.
  const canCreateMemo = !!staff?.has_material_memo_access || !!staff?.can_request_memo;

  const [loading, setLoading] = useState(true);
  const [spk, setSpk] = useState<SpkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleVin, setVehicleVin] = useState('');
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [vehicleKm, setVehicleKm] = useState('');
  const [fuelLevel, setFuelLevel] = useState<string | null>(null);
  const [batteryNote, setBatteryNote] = useState('');
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<Record<Category, { label: string; is_checked: boolean }[]>>({
    pekerjaan: [],
    extra_service: [],
    perlengkapan: [],
  });

  const [saving, setSaving] = useState(false);

  // SPK manual (tanpa booking) boleh ditautkan ke booking terkonfirmasi yang belum punya SPK, sekali saja.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkBookings, setLinkBookings] = useState<LinkableBooking[]>([]);

  const fetchSpk = useCallback(() => {
    return staffApiFetch<{ data: SpkDetail }>(`/api/staff/spks/${id}`)
      .then((res) => {
        const d = res.data;
        setSpk(d);
        setVehiclePlate(d.vehicle_plate ?? '');
        setVehicleVin(d.vehicle_vin ?? '');
        setVehicleBrand(d.vehicle_brand ?? '');
        setVehicleYear(d.vehicle_year ?? '');
        setVehicleType(d.vehicle_type);
        setVehicleKm(d.vehicle_km ? String(d.vehicle_km) : '');
        setFuelLevel(d.fuel_level);
        setBatteryNote(d.battery_note ?? '');
        setNotes(d.notes ?? '');
        setChecklist({
          pekerjaan: d.checklist_items.filter((i) => i.category === 'pekerjaan').map((i) => ({ label: i.label, is_checked: i.is_checked })),
          extra_service: d.checklist_items.filter((i) => i.category === 'extra_service').map((i) => ({ label: i.label, is_checked: i.is_checked })),
          perlengkapan: d.checklist_items.filter((i) => i.category === 'perlengkapan').map((i) => ({ label: i.label, is_checked: i.is_checked })),
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'SPK tidak ditemukan.'));
  }, [id]);

  // Refetch tiap kembali fokus (mis. balik dari halaman "Kondisi
  // Kendaraan") supaya ringkasan jumlah titik kerusakan ikut update --
  // spinner penuh cuma tampil di load pertama.
  const hasLoadedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) setLoading(true);
      fetchSpk().finally(() => {
        hasLoadedOnce.current = true;
        setLoading(false);
      });
    }, [fetchSpk])
  );

  const toggleItem = (category: Category, index: number) => {
    hapticLight();
    setChecklist((prev) => ({
      ...prev,
      [category]: prev[category].map((row, i) => (i === index ? { ...row, is_checked: !row.is_checked } : row)),
    }));
  };

  const buildPayload = (extra: Record<string, unknown> = {}) => {
    const checklistItems = (['pekerjaan', 'extra_service', 'perlengkapan'] as const).flatMap((category) =>
      checklist[category].map((row) => ({ category, label: row.label, is_checked: row.is_checked }))
    );

    return {
      customer_name: spk?.customer_name,
      phone_number: spk?.phone_number,
      address: spk?.address,
      vehicle_plate: vehiclePlate.trim() || null,
      vehicle_vin: vehicleVin.trim() || null,
      vehicle_brand: vehicleBrand.trim() || null,
      vehicle_year: vehicleYear.trim() || null,
      vehicle_type: vehicleType,
      vehicle_km: vehicleKm.trim() ? Number(vehicleKm) : null,
      fuel_level: fuelLevel,
      battery_note: batteryNote.trim() || null,
      checked_in_at: spk?.checked_in_at,
      notes: notes.trim() || null,
      checklist_items: checklistItems,
      ...extra,
    };
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await staffApiFetch(`/api/staff/spks/${id}`, { method: 'PUT', body: JSON.stringify(buildPayload()) });
      hapticSuccess();
      Alert.alert('Berhasil', 'SPK berhasil disimpan.');
      fetchSpk();
    } catch (err) {
      hapticError();
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menyimpan SPK. Periksa koneksi internet.');
    } finally {
      setSaving(false);
    }
  };

  const toggleLinkList = () => {
    hapticLight();
    const next = !linkOpen;
    setLinkOpen(next);

    if (next && linkBookings.length === 0) {
      setLinkLoading(true);
      staffApiFetch<{ data: LinkableBooking[] }>('/api/staff/bookings?status=confirmed&without_spk=1')
        .then((res) => setLinkBookings(res.data ?? []))
        .catch(() => hapticError())
        .finally(() => setLinkLoading(false));
    }
  };

  const confirmLink = (b: LinkableBooking) => {
    if (saving) return;
    Alert.alert(
      'Tautkan ke booking?',
      `SPK ini akan ditautkan ke ${b.booking_number} (${b.customer_name}). Tautan tidak bisa diubah lagi dari aplikasi.`,
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Tautkan', onPress: () => handleLink(b) },
      ],
    );
  };

  const handleLink = async (b: LinkableBooking) => {
    setSaving(true);
    try {
      await staffApiFetch(`/api/staff/spks/${id}`, { method: 'PUT', body: JSON.stringify(buildPayload({ booking_id: b.id })) });
      hapticSuccess();
      setLinkOpen(false);
      setLinkBookings([]);
      fetchSpk();
    } catch (err) {
      hapticError();
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menautkan booking. Periksa koneksi internet.');
    } finally {
      setSaving(false);
    }
  };

  // Jam keluar langsung tercatat dan staf toko mendapat notifikasi "SPK Selesai"; dari aplikasi tidak bisa dibatalkan, jadi minta konfirmasi dulu.
  const confirmCheckOut = () => {
    if (saving) return;
    Alert.alert(
      'Tandai kendaraan keluar?',
      'Jam keluar dicatat sekarang dan staf toko diberi tahu. Jam ini tidak bisa dibatalkan dari aplikasi.',
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Tandai Keluar', onPress: handleCheckOut },
      ],
    );
  };

  const handleCheckOut = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await staffApiFetch(`/api/staff/spks/${id}`, {
        method: 'PUT',
        body: JSON.stringify(buildPayload({ checked_out_at: new Date().toISOString() })),
      });
      hapticSuccess();
      fetchSpk();
    } catch (err) {
      hapticError();
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Gagal menandai keluar.');
    } finally {
      setSaving(false);
    }
  };

  const topBar = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
      </Pressable>
      <View style={styles.headerText}>
        <Text style={styles.title} numberOfLines={1}>Detail SPK</Text>
        {spk ? <Text style={styles.subtitle} numberOfLines={1}>{spk.spk_number}</Text> : null}
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {topBar}
        <SkeletonCards count={3} />
      </SafeAreaView>
    );
  }

  if (error || !spk) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {topBar}
        <View style={styles.centerState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="alert-circle-outline" size={36} color={colors.danger} />
          </View>
          <Text style={styles.emptyTitle}>SPK tidak bisa dibuka</Text>
          <Text style={styles.centerStateText}>{error ?? 'SPK tidak ditemukan.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const checkedIn = splitDateTime(spk.checked_in_at);
  const checkedOut = splitDateTime(spk.checked_out_at);
  const finished = !!spk.checked_out_at;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {topBar}

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Ringkasan */}
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.plate}>
                <Text style={styles.plateText} numberOfLines={1}>{vehiclePlate.trim() || spk.vehicle_plate || 'Tanpa plat'}</Text>
              </View>
              <View style={[styles.statusPill, finished ? styles.statusDone : styles.statusActive]}>
                <View style={[styles.statusDot, { backgroundColor: finished ? colors.success : accentText }]} />
                <Text style={[styles.statusText, { color: finished ? colors.success : accentText }]}>{finished ? 'Selesai' : 'Sedang dikerjakan'}</Text>
              </View>
            </View>

            <View style={styles.heroBody}>
              <Text style={styles.customer} numberOfLines={2}>{spk.customer_name}</Text>
              <Text style={styles.numbers} numberOfLines={1}>
                {spk.spk_number}{spk.booking?.booking_number ? ` · ${spk.booking.booking_number}` : ''}
              </Text>
            </View>

            <View style={styles.timesRow}>
              <View style={styles.timeTile}>
                <Text style={styles.timeLabel}>Masuk</Text>
                <Text style={styles.timeValue}>{checkedIn.time}</Text>
                <Text style={styles.timeDate}>{checkedIn.date}</Text>
              </View>
              <View style={styles.timeTile}>
                <Text style={styles.timeLabel}>Keluar</Text>
                <Text style={[styles.timeValue, !finished && styles.timeEmpty]}>{checkedOut.time}</Text>
                <Text style={styles.timeDate}>{checkedOut.date}</Text>
              </View>
            </View>

            {!finished ? (
              <PressableScale style={styles.checkoutBtn} onPress={confirmCheckOut} disabled={saving} accessibilityRole="button" accessibilityLabel="Tandai kendaraan keluar">
                <Ionicons name="log-out-outline" size={20} color="#ffffff" />
                <Text style={styles.checkoutBtnText}>Tandai Kendaraan Keluar</Text>
              </PressableScale>
            ) : null}
          </View>

          {/* SPK manual: installer dan tautan ke booking */}
          {!spk.booking ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="link-outline" size={18} color={accentText} />
                </View>
                <Text style={styles.sectionTitle}>SPK Manual</Text>
              </View>
              {spk.installers && spk.installers.length > 0 ? (
                <Text style={styles.fieldLabel}>Installer: {spk.installers.map((i) => i.name).join(', ')}</Text>
              ) : null}
              <PressableScale style={styles.linkBtn} onPress={toggleLinkList} disabled={saving} accessibilityRole="button">
                <Text style={styles.linkBtnText}>{linkOpen ? 'Tutup daftar booking' : 'Tautkan ke Booking'}</Text>
              </PressableScale>
              {linkOpen ? (
                linkLoading ? (
                  <ActivityIndicator color={colors.accent} />
                ) : linkBookings.length === 0 ? (
                  <Text style={styles.fieldLabel}>Tidak ada booking terkonfirmasi yang belum punya SPK.</Text>
                ) : (
                  linkBookings.map((b) => (
                    <Pressable key={b.id} style={styles.linkRow} onPress={() => confirmLink(b)} accessibilityRole="button">
                      <Text style={styles.linkRowTitle} numberOfLines={1}>{b.customer_name}</Text>
                      <Text style={styles.linkRowSub} numberOfLines={1}>{b.booking_number}</Text>
                    </Pressable>
                  ))
                )
              ) : null}
            </View>
          ) : null}

          {/* Memo barang dari SPK ini */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons name="archive-outline" size={18} color={accentText} />
              </View>
              <Text style={styles.sectionTitle}>Memo Barang</Text>
            </View>
            {spk.material_memos && spk.material_memos.length > 0 ? (
              spk.material_memos.map((m) => (
                <Pressable
                  key={m.id}
                  style={styles.linkRow}
                  onPress={() =>
                    router.push((m.flow === 'request'
                      ? { pathname: '/staff/memos/request/[id]', params: { id: String(m.id) } }
                      : { pathname: '/staff/memos/[id]', params: { id: String(m.id) } }) as never)
                  }
                  accessibilityRole="button"
                >
                  <Text style={styles.linkRowTitle} numberOfLines={1}>{m.memo_number}</Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.fieldLabel}>Belum ada memo barang dari SPK ini.</Text>
            )}
            {canCreateMemo ? (
              <PressableScale
                style={styles.linkBtn}
                onPress={() => {
                  hapticLight();
                  router.push({
                    pathname: '/staff/memos/create',
                    params: {
                      spkId: String(spk.id),
                      spkNumber: spk.spk_number,
                      spkCustomer: spk.customer_name ?? '',
                      spkStoreId: spk.store_id ? String(spk.store_id) : '',
                      spkBrand: spk.vehicle_brand ?? '',
                      spkPlate: spk.vehicle_plate ?? '',
                    },
                  } as never);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.linkBtnText}>Buat Memo Barang</Text>
              </PressableScale>
            ) : null}
          </View>

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

          {/* Kondisi kendaraan */}
          <PressableScale
            style={styles.damageCard}
            onPress={() => router.push({ pathname: '/staff/spks/damage', params: { id: String(id) } } as never)}
            accessibilityRole="button"
            accessibilityLabel="Kondisi kendaraan"
          >
            <View style={[styles.damageIcon, spk.damage_marks.length > 0 && { backgroundColor: colors.warningBg }]}>
              <Ionicons name="car-outline" size={24} color={spk.damage_marks.length > 0 ? colors.warning : accentText} />
            </View>
            <View style={styles.damageText}>
              <Text style={styles.sectionTitle}>Kondisi Kendaraan</Text>
              <Text style={styles.damageSub}>
                {spk.damage_marks.length > 0
                  ? `${spk.damage_marks.length} titik kerusakan ditandai`
                  : 'Belum ada titik kerusakan. Ketuk untuk mulai inspeksi'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </PressableScale>

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
        </ScrollView>

        {/* Tombol simpan selalu terlihat di bawah */}
        <View style={styles.footer}>
          <PressableScale
            style={[styles.submit, saving && styles.submitDisabled]}
            onPress={handleSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Simpan perubahan"
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={22} color="#ffffff" />
                <Text style={styles.submitText}>Simpan Perubahan</Text>
              </>
            )}
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean, insetsBottom: number) {
  // Sama dengan Beranda, Notifikasi, daftar SPK, dan Buat SPK: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
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
    subtitle: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    centerStateText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
    emptyIconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },

    form: { paddingHorizontal: 20, paddingBottom: spacing.xl, gap: 16 },

    hero: { gap: 16, padding: 20, borderRadius: 28, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    plate: { flexShrink: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textSecondary },
    plateText: { fontSize: 13, fontWeight: '800', letterSpacing: 1, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    statusPill: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    statusActive: { backgroundColor: colors.accentSoft },
    statusDone: { backgroundColor: colors.successBg },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { flexShrink: 1, fontSize: 12, fontWeight: '700' },
    heroBody: { gap: 3 },
    customer: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, lineHeight: 29, color: colors.textPrimary },
    numbers: { fontSize: 13, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    timesRow: { flexDirection: 'row', gap: 12 },
    timeTile: { flex: 1, gap: 2, padding: 14, borderRadius: 20, backgroundColor: chip },
    timeLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted },
    timeValue: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    timeEmpty: { color: isDark ? '#4b4b57' : '#c3c3cd' },
    timeDate: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
    checkoutBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.26, shadowRadius: 16, elevation: 4,
    },
    checkoutBtnText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm + 1 },

    section: { gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sectionIcon: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    sectionTitle: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    counter: { fontSize: 12, fontWeight: '800', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    optionalTag: { fontSize: 12, fontWeight: '600', color: colors.textMuted },

    field: { gap: 6 },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    linkBtn: { height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    linkBtnText: { fontSize: 14, fontWeight: '700', color: isDark ? '#ff6b8f' : '#cc1042' },
    linkRow: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: isDark ? colors.surfaceElevated : '#efeff4', gap: 2 },
    linkRowTitle: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textPrimary },
    linkRowSub: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    input: {
      height: 50, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent',
      backgroundColor: chip, fontSize: fontSize.sm + 1, color: colors.textPrimary,
    },
    textarea: { height: undefined, minHeight: 96, paddingTop: 14, textAlignVertical: 'top' },
    row2: { flexDirection: 'row', gap: 12 },

    optionRow: { flexDirection: 'row', gap: 8 },
    option: { flex: 1, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    optionFuel: { height: 42 },
    optionActive: { backgroundColor: colors.accent },
    optionText: { fontSize: 13.5, fontWeight: '700', color: colors.textSecondary },
    optionTextActive: { color: '#ffffff' },

    damageCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    damageIcon: { width: 48, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    damageText: { flex: 1, gap: 2 },
    damageSub: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: colors.textMuted },

    checklist: { marginHorizontal: -4 },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 4 },
    checkRowBorder: { borderTopWidth: 1, borderTopColor: line },
    checkBox: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: isDark ? '#4b4b57' : '#cfcfd8' },
    checkBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkLabel: { flex: 1, fontSize: fontSize.sm + 1, fontWeight: '500', color: colors.textPrimary, lineHeight: 21 },
    checkLabelOn: { color: colors.textMuted },

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
