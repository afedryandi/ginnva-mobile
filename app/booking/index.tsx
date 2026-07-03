import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface StoreOption {
  id: number;
  name: string;
  city: string;
}

// Slot waktu yang ditawarkan — teks bebas supaya toko fleksibel
// mengatur jadwal tanpa perlu konfigurasi backend tambahan.
const TIME_SLOTS = [
  '08:00 - 10:00',
  '10:00 - 12:00',
  '13:00 - 15:00',
  '15:00 - 17:00',
];

const SERVICE_TYPES = [
  'Kaca Film (Window Film)',
  'Pelindung Cat (PPF)',
  'Color Change Film',
  'Konsultasi Produk',
  'Klaim Garansi',
  'Lainnya',
];

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function formatDisplayDate(dateStr: string) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

type Phase = 'form' | 'submitting' | 'success';

export default function BookingScreen() {
  const params = useLocalSearchParams<{ store_id?: string; store_name?: string }>();
  const { isLoggedIn } = useAuth();

  const [phase, setPhase] = useState<Phase>('form');
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);

  // Form state
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(
    params.store_id ? Number(params.store_id) : null
  );
  const [selectedStoreName, setSelectedStoreName] = useState<string>(
    params.store_name ?? ''
  );
  const [showStorePicker, setShowStorePicker] = useState(false);

  const [serviceType, setServiceType] = useState('');
  const [showServicePicker, setShowServicePicker] = useState(false);

  const [preferredDate, setPreferredDate] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [notes, setNotes] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [bookingNumber, setBookingNumber] = useState('');

  useEffect(() => {
    if (!isLoggedIn) {
      // Redirect ke login dengan return path
      router.replace('/auth/login' as never);
      return;
    }
    apiFetch<{ data: StoreOption[] }>('/api/stores', { skipAuth: true })
      .then((res) => setStores(res.data))
      .catch(() => {}) // biarkan kosong, user bisa ketik manual
      .finally(() => setStoresLoading(false));
  }, [isLoggedIn]);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!selectedStoreId) errors.store = 'Pilih toko tujuan.';
    if (!serviceType) errors.service_type = 'Pilih jenis layanan.';
    if (!preferredDate) {
      errors.preferred_date = 'Pilih tanggal kunjungan.';
    } else if (preferredDate < getTodayString()) {
      errors.preferred_date = 'Tanggal tidak boleh di masa lalu.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setPhase('submitting');
    setSubmitError(null);

    try {
      const res = await apiFetch<{ success: boolean; data: { booking_number: string } }>(
        '/api/customer/bookings',
        {
          method: 'POST',
          body: JSON.stringify({
            store_id: selectedStoreId,
            service_type: serviceType,
            preferred_date: preferredDate,
            preferred_time: preferredTime || null,
            notes: notes.trim() || null,
          }),
        }
      );
      setBookingNumber(res.data.booking_number);
      setPhase('success');
    } catch (err) {
      setPhase('form');
      if (err instanceof ApiError && err.errors) {
        const mapped: Record<string, string> = {};
        Object.entries(err.errors).forEach(([k, v]) => {
          mapped[k] = Array.isArray(v) ? v[0] : String(v);
        });
        setFieldErrors(mapped);
      } else {
        setSubmitError(
          err instanceof ApiError
            ? err.message
            : 'Terjadi kesalahan. Periksa koneksi internet Anda.'
        );
      }
    }
  };

  // ===== Success state =====
  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Buat Booking" />
        <View style={styles.successState}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>Booking Diterima!</Text>
          <Text style={styles.successSub}>
            Nomor booking Anda:{'\n'}
            <Text style={styles.successCode}>{bookingNumber}</Text>
          </Text>
          <Text style={styles.successNote}>
            Tim toko akan menghubungi Anda untuk konfirmasi jadwal. Pantau status booking
            di menu <Text style={{ fontWeight: '700' }}>Booking Saya</Text>.
          </Text>
          <Button
            label="Lihat Booking Saya"
            onPress={() => router.replace('/account/my-bookings' as never)}
            style={styles.successButton}
          />
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <Text style={styles.backLinkText}>Kembali ke Toko</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ===== Form =====
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Buat Booking" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Buat jadwal kunjungan ke dealer Ginnva. Tim toko akan menghubungi Anda untuk
          konfirmasi setelah booking diterima.
        </Text>

        {/* ===== Pilih Toko ===== */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Toko Tujuan *</Text>
          <Pressable
            style={[styles.picker, fieldErrors.store && styles.pickerError]}
            onPress={() => setShowStorePicker(!showStorePicker)}
          >
            <Text style={selectedStoreId ? styles.pickerValue : styles.pickerPlaceholder}>
              {selectedStoreName || 'Pilih toko...'}
            </Text>
            <Ionicons
              name={showStorePicker ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.mutedLight}
            />
          </Pressable>
          {fieldErrors.store ? <Text style={styles.errorText}>{fieldErrors.store}</Text> : null}
          {showStorePicker && (
            <Card style={styles.dropdownCard}>
              {storesLoading ? (
                <ActivityIndicator color={colors.accent} style={{ padding: spacing.sm }} />
              ) : stores.length === 0 ? (
                <Text style={styles.dropdownEmpty}>Toko tidak tersedia.</Text>
              ) : (
                stores.map((s) => (
                  <Pressable
                    key={s.id}
                    style={[
                      styles.dropdownItem,
                      selectedStoreId === s.id && styles.dropdownItemActive,
                    ]}
                    onPress={() => {
                      setSelectedStoreId(s.id);
                      setSelectedStoreName(`${s.name} — ${s.city}`);
                      setShowStorePicker(false);
                      setFieldErrors((e) => ({ ...e, store: '' }));
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        selectedStoreId === s.id && styles.dropdownItemTextActive,
                      ]}
                    >
                      {s.name}
                    </Text>
                    <Text style={styles.dropdownItemSub}>{s.city}</Text>
                  </Pressable>
                ))
              )}
            </Card>
          )}
        </View>

        {/* ===== Jenis Layanan ===== */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Jenis Layanan *</Text>
          <Pressable
            style={[styles.picker, fieldErrors.service_type && styles.pickerError]}
            onPress={() => setShowServicePicker(!showServicePicker)}
          >
            <Text style={serviceType ? styles.pickerValue : styles.pickerPlaceholder}>
              {serviceType || 'Pilih layanan...'}
            </Text>
            <Ionicons
              name={showServicePicker ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.mutedLight}
            />
          </Pressable>
          {fieldErrors.service_type ? (
            <Text style={styles.errorText}>{fieldErrors.service_type}</Text>
          ) : null}
          {showServicePicker && (
            <Card style={styles.dropdownCard}>
              {SERVICE_TYPES.map((s) => (
                <Pressable
                  key={s}
                  style={[
                    styles.dropdownItem,
                    serviceType === s && styles.dropdownItemActive,
                  ]}
                  onPress={() => {
                    setServiceType(s);
                    setShowServicePicker(false);
                    setFieldErrors((e) => ({ ...e, service_type: '' }));
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      serviceType === s && styles.dropdownItemTextActive,
                    ]}
                  >
                    {s}
                  </Text>
                </Pressable>
              ))}
            </Card>
          )}
        </View>

        {/* ===== Tanggal ===== */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Tanggal Kunjungan *</Text>
          <TextInput
            style={[styles.input, fieldErrors.preferred_date && styles.inputError]}
            placeholder="YYYY-MM-DD (mis. 2026-07-18)"
            placeholderTextColor={colors.mutedLight}
            value={preferredDate}
            onChangeText={(v) => {
              setPreferredDate(v);
              setFieldErrors((e) => ({ ...e, preferred_date: '' }));
            }}
            keyboardType="numeric"
            maxLength={10}
          />
          {preferredDate.length === 10 && !fieldErrors.preferred_date ? (
            <Text style={styles.datePreview}>{formatDisplayDate(preferredDate)}</Text>
          ) : null}
          {fieldErrors.preferred_date ? (
            <Text style={styles.errorText}>{fieldErrors.preferred_date}</Text>
          ) : null}
        </View>

        {/* ===== Jam Preferensi ===== */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Jam Preferensi <Text style={styles.optional}>(opsional)</Text></Text>
          <Pressable
            style={styles.picker}
            onPress={() => setShowTimePicker(!showTimePicker)}
          >
            <Text style={preferredTime ? styles.pickerValue : styles.pickerPlaceholder}>
              {preferredTime || 'Pilih slot waktu...'}
            </Text>
            <Ionicons
              name={showTimePicker ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.mutedLight}
            />
          </Pressable>
          {showTimePicker && (
            <Card style={styles.dropdownCard}>
              {preferredTime ? (
                <Pressable
                  style={styles.dropdownItem}
                  onPress={() => {
                    setPreferredTime('');
                    setShowTimePicker(false);
                  }}
                >
                  <Text style={[styles.dropdownItemText, { color: colors.muted }]}>
                    — Tidak ada preferensi
                  </Text>
                </Pressable>
              ) : null}
              {TIME_SLOTS.map((slot) => (
                <Pressable
                  key={slot}
                  style={[
                    styles.dropdownItem,
                    preferredTime === slot && styles.dropdownItemActive,
                  ]}
                  onPress={() => {
                    setPreferredTime(slot);
                    setShowTimePicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      preferredTime === slot && styles.dropdownItemTextActive,
                    ]}
                  >
                    {slot}
                  </Text>
                </Pressable>
              ))}
            </Card>
          )}
        </View>

        {/* ===== Catatan ===== */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            Catatan <Text style={styles.optional}>(opsional)</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="mis. tipe mobil, warna, atau permintaan khusus..."
            placeholderTextColor={colors.mutedLight}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {submitError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorBannerText}>{submitError}</Text>
          </View>
        ) : null}

        <Button
          label={phase === 'submitting' ? 'Mengirim...' : 'Kirim Booking'}
          onPress={handleSubmit}
          loading={phase === 'submitting'}
          style={styles.submitButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  intro: {
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  optional: {
    fontWeight: '400',
    color: colors.mutedLight,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  inputError: {
    borderColor: colors.danger,
  },
  textArea: {
    minHeight: 80,
    paddingTop: spacing.sm,
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  pickerError: {
    borderColor: colors.danger,
  },
  pickerValue: {
    fontSize: fontSize.sm,
    color: colors.ink,
    flex: 1,
  },
  pickerPlaceholder: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    flex: 1,
  },
  dropdownCard: {
    marginTop: spacing.xs,
    padding: 0,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dropdownItemActive: {
    backgroundColor: '#fce8ed',
  },
  dropdownItemText: {
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  dropdownItemTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },
  dropdownItemSub: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  dropdownEmpty: {
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    textAlign: 'center',
  },
  datePreview: {
    fontSize: fontSize.xs,
    color: colors.success,
    marginTop: spacing.xs,
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#fde8e8',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorBannerText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  // Success state
  successState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  successIcon: {
    marginBottom: spacing.sm,
  },
  successTitle: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.ink,
  },
  successSub: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 26,
  },
  successCode: {
    fontWeight: '800',
    color: colors.ink,
    fontSize: fontSize.lg,
  },
  successNote: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  successButton: {
    width: '100%',
    marginTop: spacing.sm,
  },
  backLink: {
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  backLinkText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
    textAlign: 'center',
  },
});