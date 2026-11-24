import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { PickerModal } from '@/components/ui/PickerModal';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { AuthField, AuthNotice } from '@/components/auth/AuthShell';
import { darkColors, spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import {
  CatalogVehicle,
  CustomerVehicle,
  normalizePlateInput,
  saveVehicle,
  VehicleCatalog,
  VehicleSize,
} from '@/lib/vehicles';

interface Props {
  visible: boolean;
  // null = tambah kendaraan baru; terisi = ubah kendaraan ini.
  vehicle: CustomerVehicle | null;
  catalog: VehicleCatalog | null;
  onClose: () => void;
  onSaved: (vehicle: CustomerVehicle) => void;
}

// Label model di pemilih: "Fortuner VRZ" (varian ikut kalau ada).
const modelLabel = (v: CatalogVehicle) => (v.variant ? `${v.model} ${v.variant}` : v.model);

/**
 * Formulir tambah/ubah kendaraan (Kendaraan Saya). Pilih merek lalu model dari katalog — ukuran mobil terisi otomatis
 * dari katalog; kalau kendaraannya tidak ada di daftar, isi merek/model manual dan pilih ukuran (boleh dikosongkan,
 * toko yang menentukan).
 *
 * Tampilan didesain ulang (2026-11-24): judul besar, pilihan "Dari daftar / Isi manual" sebagai segmen, kolom berikon yang sama dengan
 * layar masuk, plat nomor tampil seperti pelat, dan tombol simpan pil. Data dan alur tidak berubah.
 */
export default function VehicleFormModal({ visible, vehicle, catalog, onClose, onSaved }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [manual, setManual] = useState(false);
  const [brand, setBrand] = useState('');
  const [catalogId, setCatalogId] = useState<number | null>(null);
  const [manualBrand, setManualBrand] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [size, setSize] = useState<VehicleSize | null>(null);
  const [plate, setPlate] = useState('');
  const [plateFocused, setPlateFocused] = useState(false);
  const [color, setColor] = useState('');
  const [year, setYear] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [brandPicker, setBrandPicker] = useState(false);
  const [modelPicker, setModelPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Isi ulang tiap formulir dibuka (tambah baru = kosong, ubah = data kendaraan itu).
  useEffect(() => {
    if (!visible) return;

    setError(null);
    setSaving(false);
    setBrandPicker(false);
    setModelPicker(false);

    if (vehicle) {
      const fromCatalog = vehicle.vehicle_id !== null;
      setManual(!fromCatalog);
      setBrand(fromCatalog ? vehicle.brand : '');
      setCatalogId(fromCatalog ? vehicle.vehicle_id : null);
      setManualBrand(fromCatalog ? '' : vehicle.brand);
      setManualModel(fromCatalog ? '' : [vehicle.model, vehicle.variant].filter(Boolean).join(' '));
      setSize(vehicle.size_category);
      setPlate(vehicle.plate);
      setColor(vehicle.color ?? '');
      setYear(vehicle.year ? String(vehicle.year) : '');
      setMakeDefault(vehicle.is_default);
    } else {
      setManual(false);
      setBrand('');
      setCatalogId(null);
      setManualBrand('');
      setManualModel('');
      setSize(null);
      setPlate('');
      setColor('');
      setYear('');
      setMakeDefault(false);
    }
  }, [visible, vehicle]);

  const modelsOfBrand = useMemo(
    () => (catalog?.vehicles ?? []).filter((v) => v.brand === brand),
    [catalog, brand]
  );
  const selectedCatalog = modelsOfBrand.find((v) => v.id === catalogId) ?? null;

  const vehicleChosen = manual ? manualBrand.trim().length > 0 && manualModel.trim().length > 0 : selectedCatalog !== null;
  // Warna dan tahun wajib diisi (2026-11-24). Tahun harus 4 digit dalam rentang yang diterima server (1980 sampai tahun depan).
  const yearNumberValue = Number(year);
  const yearValid = /^\d{4}$/.test(year) && yearNumberValue >= 1980 && yearNumberValue <= new Date().getFullYear() + 1;
  const valid = vehicleChosen && plate.trim().length >= 3 && color.trim().length > 0 && yearValid;

  const submit = async () => {
    if (!valid || saving) return;

    setSaving(true);
    setError(null);

    try {
      const yearNumber = year.trim() ? Number(year.trim()) : null;
      const common = {
        plate: plate.trim(),
        color: color.trim() || null,
        year: yearNumber && Number.isFinite(yearNumber) ? yearNumber : null,
        is_default: makeDefault,
      };

      const saved = await saveVehicle(
        manual
          ? { ...common, brand: manualBrand.trim(), model: manualModel.trim(), size_category: size }
          : { ...common, vehicle_id: selectedCatalog!.id },
        vehicle?.id
      );

      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan kendaraan. Periksa koneksi internetmu.');
    } finally {
      setSaving(false);
    }
  };

  // Kolom pilih (merek/model): tampil seperti kolom isian, dengan ikon di kiri dan panah di kanan.
  const select = (label: string, value: string, placeholder: string, onPress: () => void, icon: React.ComponentProps<typeof Ionicons>['name'], disabled = false, gap = false) => (
    <View style={gap ? styles.gap : undefined}>
      <Text style={styles.label}>{label}</Text>
      <PressableScale style={[styles.select, disabled && styles.selectDisabled]} onPress={onPress} disabled={disabled} accessibilityRole="button">
        <Ionicons name={icon} size={20} color={value ? colors.accent : colors.textMuted} />
        <Text style={value ? styles.selectText : styles.selectPlaceholder} numberOfLines={1}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </PressableScale>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.topRow}>
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Tutup">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{vehicle ? 'Ubah kendaraan' : 'Tambah kendaraan'}</Text>
            <Text style={styles.subtitle}>Simpan mobilmu supaya booking berikutnya lebih cepat.</Text>

            {/* Dua cara mengisi: pilih dari daftar mobil, atau isi sendiri bila mobilnya tidak ada di daftar. */}
            <View style={styles.segment}>
              {([[false, 'Dari daftar'], [true, 'Isi manual']] as const).map(([isManual, label]) => (
                <Pressable
                  key={label}
                  style={[styles.segmentChip, manual === isManual && styles.segmentChipActive]}
                  onPress={() => setManual(isManual)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: manual === isManual }}
                >
                  <Text style={[styles.segmentText, manual === isManual && styles.onAccent]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {!manual ? (
              <>
                {select('Merek', brand, 'Pilih merek', () => setBrandPicker(true), 'car-sport-outline')}
                {select(
                  'Model',
                  selectedCatalog ? modelLabel(selectedCatalog) : '',
                  brand ? 'Pilih model' : 'Pilih merek dulu',
                  () => brand && setModelPicker(true),
                  'pricetag-outline',
                  !brand,
                  true,
                )}

              </>
            ) : (
              <>
                <AuthField label="Merek" icon="car-sport-outline">
                  {(input) => (
                    <TextInput {...input} value={manualBrand} onChangeText={setManualBrand} placeholder="mis. Wuling" placeholderTextColor={colors.textMuted} maxLength={80} />
                  )}
                </AuthField>

                <AuthField label="Model" icon="pricetag-outline" gap>
                  {(input) => (
                    <TextInput {...input} value={manualModel} onChangeText={setManualModel} placeholder="mis. Air EV" placeholderTextColor={colors.textMuted} maxLength={120} />
                  )}
                </AuthField>

              </>
            )}

            {/* Plat nomor tampil seperti pelat kendaraan. */}
            <View style={styles.gap}>
              <Text style={styles.label}>Plat nomor</Text>
              <View style={[styles.plateField, plateFocused && styles.plateFieldFocused]}>
                <TextInput
                  style={styles.plateInput}
                  value={plate}
                  onChangeText={(t) => setPlate(normalizePlateInput(t))}
                  onFocus={() => setPlateFocused(true)}
                  onBlur={() => setPlateFocused(false)}
                  placeholder="B 1234 ABC"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                />
              </View>
            </View>

            <View style={[styles.gap, styles.twoCols]}>
              <View style={{ flex: 1 }}>
                <AuthField label="Warna" icon="color-palette-outline">
                  {(input) => (
                    <TextInput {...input} value={color} onChangeText={setColor} placeholder="mis. Hitam" placeholderTextColor={colors.textMuted} maxLength={40} />
                  )}
                </AuthField>
              </View>
              <View style={{ flex: 1 }}>
                <AuthField label="Tahun" icon="calendar-outline" error={year.length === 4 && !yearValid ? 'Tahun tidak valid.' : undefined}>
                  {(input) => (
                    <TextInput
                      {...input}
                      value={year}
                      onChangeText={(t) => setYear(t.replace(/[^0-9]/g, '').slice(0, 4))}
                      placeholder="mis. 2022"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                  )}
                </AuthField>
              </View>
            </View>

            <View style={[styles.gap, styles.defaultRow]}>
              <View style={styles.defaultIcon}>
                <Ionicons name="star-outline" size={18} color={colors.accent} />
              </View>
              <Text style={styles.defaultText}>Jadikan kendaraan utama</Text>
              <Switch
                value={makeDefault}
                onValueChange={setMakeDefault}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                thumbColor="#ffffff"
                accessibilityLabel="Jadikan kendaraan utama"
              />
            </View>

            {error ? <AuthNotice kind="error" message={error} /> : null}
          </ScrollView>

          <View style={styles.footer}>
            <PressableScale
              style={[styles.saveButton, valid && !saving && styles.saveGlow, (!valid || saving) && styles.saveButtonDisabled]}
              onPress={submit}
              disabled={!valid || saving}
              accessibilityRole="button"
            >
              {saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveText}>Simpan Kendaraan</Text>}
            </PressableScale>
          </View>
        </KeyboardAvoidingView>

        <PickerModal
          visible={brandPicker}
          title="Pilih Merek"
          options={catalog?.brands ?? []}
          selected={brand || null}
          onSelect={(value) => {
            setBrand(value);
            setCatalogId(null);
            setBrandPicker(false);
          }}
          onClose={() => setBrandPicker(false)}
          searchPlaceholder="Cari merek..."
        />
        <PickerModal
          visible={modelPicker}
          title="Pilih Model"
          options={modelsOfBrand.map(modelLabel)}
          selected={selectedCatalog ? modelLabel(selectedCatalog) : null}
          onSelect={(value) => {
            const match = modelsOfBrand.find((v) => modelLabel(v) === value);
            setCatalogId(match ? match.id : null);
            setModelPicker(false);
          }}
          onClose={() => setModelPicker(false)}
          searchPlaceholder="Cari model..."
        />
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, justifyContent: 'center' },
    closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },

    content: { paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: 32 },
    title: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 15, lineHeight: 22, color: colors.textSecondary, marginTop: 6, marginBottom: 22 },
    gap: { marginTop: 18 },
    bold: { fontWeight: '800', color: colors.textPrimary },
    onAccent: { color: '#ffffff' },

    segment: { flexDirection: 'row', padding: 4, borderRadius: 24, backgroundColor: colors.surfaceElevated, marginBottom: 22 },
    segmentChip: { flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    segmentChipActive: { backgroundColor: colors.accent },
    segmentText: { fontSize: 14, fontWeight: '800', color: colors.textSecondary },

    label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 8, marginLeft: 4 },
    optional: { fontWeight: '500', color: colors.textMuted },
    select: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 58, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.surfaceElevated },
    selectDisabled: { opacity: 0.5 },
    selectText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    selectPlaceholder: { flex: 1, fontSize: 16, color: colors.textMuted },


    hint: { fontSize: 12, lineHeight: 18, color: colors.textMuted, marginTop: 8, marginLeft: 4 },

    plateField: { height: 64, borderRadius: 16, borderWidth: 2, borderColor: colors.textPrimary, backgroundColor: colors.bg, justifyContent: 'center' },
    plateFieldFocused: { borderColor: colors.accent },
    plateInput: { height: 60, textAlign: 'center', fontSize: 26, fontWeight: '800', letterSpacing: 4, color: colors.textPrimary, padding: 0 },

    twoCols: { flexDirection: 'row', gap: 12 },

    defaultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: colors.surfaceElevated },
    defaultIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    defaultText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },

    footer: { paddingHorizontal: 24, paddingTop: spacing.sm, paddingBottom: spacing.md, backgroundColor: colors.bg },
    saveButton: { height: 58, borderRadius: 29, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    saveGlow: { shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 16, elevation: 6 },
    saveButtonDisabled: { opacity: 0.5 },
    saveText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  });
}
