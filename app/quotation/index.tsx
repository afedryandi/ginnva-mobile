import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  PanResponder,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

interface VehicleOption {
  id: number;
  brand: string;
  model: string;
}

interface ProductOption {
  id: number;
  name: string;
  product_type: string;
}

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  window_film: 'Kaca Film',
  ppf: 'Paint Protection Film',
};

// Color Change Film (dan Architectural Film) belum dijual di pasar
// Indonesia — backend memang menyeed-nya sebagai is_active=true untuk
// pasar lain, tapi quotation form ini SENGAJA tidak menampilkannya.
// Minat customer terhadap produk ini ditangani lewat alur terpisah
// (ProductInquiry, lihat /inquiry), bukan quotation kendaraan.
const NOT_YET_SOLD_TYPES = ['color_change', 'architectural_film'];

type Phase = 'loading' | 'error' | 'wizard' | 'success';

const STEP_TITLES = ['Kendaraan', 'Produk', 'Kontak', 'Ringkasan'];
const TOTAL_STEPS = STEP_TITLES.length;
const SWIPE_THRESHOLD = 60;

export default function QuotationScreen() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [stepIndex, setStepIndex] = useState(0);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quotationNumber, setQuotationNumber] = useState<string | null>(null);

  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = () => {
    setPhase('loading');
    setLoadError(null);
    apiFetch<{ data: { vehicles: VehicleOption[]; products: ProductOption[] } }>(
      '/api/quotation/options',
      { skipAuth: true }
    )
      .then((res) => {
        setVehicles(res.data.vehicles);
        setProducts(res.data.products);
        setPhase('wizard');
      })
      .catch((err) => {
        setLoadError(
          err instanceof ApiError
            ? err.message
            : 'Gagal memuat data formulir. Periksa koneksi internet Anda.'
        );
        setPhase('error');
      });
  };

  const toggleProduct = (id: number) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  // Produk yang belum dijual sengaja dikecualikan dari pilihan, dan
  // dikelompokkan per tipe supaya tidak jadi satu list panjang tanpa konteks.
  const sellableProducts = products.filter(
    (p) => !NOT_YET_SOLD_TYPES.includes(p.product_type)
  );
  const groupedProducts = sellableProducts.reduce<Record<string, ProductOption[]>>(
    (acc, p) => {
      (acc[p.product_type] ??= []).push(p);
      return acc;
    },
    {}
  );

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const selectedProducts = sellableProducts.filter((p) =>
    selectedProductIds.includes(p.id)
  );

  const stepValid = [
    vehicleId !== null,
    selectedProductIds.length > 0,
    customerName.trim().length > 0 && customerPhone.trim().length > 0,
    true,
  ];

  const isFormValid = stepValid[0] && stepValid[1] && stepValid[2];

  const animateTo = (next: number) => {
    setStepIndex(next);
    slideAnim.setValue(next > stepIndex ? 24 : -24);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      speed: 16,
      bounciness: 4,
    }).start();
  };

  const goNext = () => {
    if (!stepValid[stepIndex]) return;
    if (stepIndex < TOTAL_STEPS - 1) animateTo(stepIndex + 1);
  };

  const goBack = () => {
    if (stepIndex > 0) animateTo(stepIndex - 1);
  };

  // Swipe sebagai bonus navigasi — tombol Lanjut/Kembali tetap cara utama
  // supaya alur tetap accessible buat yang tidak swipe.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -SWIPE_THRESHOLD) {
          goNext();
        } else if (gesture.dx > SWIPE_THRESHOLD) {
          goBack();
        }
      },
    })
  ).current;

  const handleSubmit = () => {
    if (!isFormValid) return;

    setSubmitting(true);
    setSubmitError(null);

    apiFetch<{ success: boolean; message: string; data: { quotation_number: string } }>(
      '/api/quotation/submit',
      {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({
          vehicle_id: vehicleId,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          customer_email: customerEmail.trim() || undefined,
          license_plate: licensePlate.trim() || undefined,
          message: message.trim() || undefined,
          items: selectedProductIds.map((id) => ({ film_product_id: id })),
        }),
      }
    )
      .then((res) => {
        setQuotationNumber(res.data.quotation_number);
        setPhase('success');
      })
      .catch((err) => {
        setSubmitError(
          err instanceof ApiError
            ? err.message
            : 'Gagal mengirim permintaan. Periksa koneksi internet Anda dan coba lagi.'
        );
      })
      .finally(() => setSubmitting(false));
  };

  const handleShareWhatsApp = () => {
    const productNames = selectedProducts.map((p) => `- ${p.name}`).join('\n');
    const text =
      `Permintaan Penawaran Ginnva\n` +
      `No. Referensi: ${quotationNumber}\n` +
      `Kendaraan: ${selectedVehicle ? `${selectedVehicle.brand} ${selectedVehicle.model}` : '-'}\n` +
      `Produk diminati:\n${productNames}\n` +
      `Kontak: ${customerName} (${customerPhone})`;
    Share.share({ message: text }).catch(() => {
      // Pengguna membatalkan share sheet — tidak perlu ditangani sebagai error.
    });
  };

  if (phase === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Ajukan Penawaran" />
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Ajukan Penawaran" />
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>{loadError}</Text>
          <Pressable style={styles.retryButton} onPress={loadOptions}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Ajukan Penawaran" />
        <ScrollView contentContainerStyle={styles.centerState}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark" size={36} color={colors.white} />
          </View>
          <Text style={styles.successTitle}>Permintaan Terkirim</Text>
          <Text style={styles.centerStateText}>
            Nomor referensi Anda: {'\n'}
            <Text style={styles.quotationNumber}>{quotationNumber}</Text>
          </Text>
          <Text style={styles.successNote}>
            Tim sales kami akan segera menghubungi Anda lewat nomor telepon yang
            didaftarkan untuk membahas detail dan harga.
            {customerEmail.trim().length > 0
              ? `\n\nEmail konfirmasi telah dikirim ke ${customerEmail}.`
              : ''}
          </Text>

          <Button
            label="Share ke WhatsApp"
            onPress={handleShareWhatsApp}
            style={styles.successButton}
          />
          <Button
            label="Hubungi Toko Terdekat"
            variant="outline"
            onPress={() => router.push('/(tabs)/stores' as never)}
            style={styles.successButton}
          />
          <Button
            label="Kembali ke Beranda"
            variant="ghost"
            onPress={() => router.replace('/(tabs)' as never)}
            style={styles.successButton}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Ajukan Penawaran" />

      {/* ===== Progress dots ===== */}
      <View style={styles.progressRow}>
        {STEP_TITLES.map((title, i) => (
          <View key={title} style={styles.progressItem}>
            <View
              style={[
                styles.progressDot,
                i === stepIndex && styles.progressDotActive,
                i < stepIndex && styles.progressDotDone,
              ]}
            >
              {i < stepIndex ? (
                <Ionicons name="checkmark" size={12} color={colors.white} />
              ) : (
                <Text
                  style={[
                    styles.progressDotText,
                    i === stepIndex && styles.progressDotTextActive,
                  ]}
                >
                  {i + 1}
                </Text>
              )}
            </View>
            <Text
              style={[
                styles.progressLabel,
                i === stepIndex && styles.progressLabelActive,
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {i < STEP_TITLES.length - 1 && (
              <View
                style={[styles.progressLine, i < stepIndex && styles.progressLineDone]}
              />
            )}
          </View>
        ))}
      </View>

      <Animated.View
        style={[styles.flex, { transform: [{ translateX: slideAnim }] }]}
        {...panResponder.panHandlers}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {stepIndex === 0 && (
            <View>
              <Text style={styles.intro}>
                Pilih kendaraan Anda. Ini bukan kalkulator harga otomatis — tim
                sales kami akan menghubungi Anda untuk membahas harga dan
                jadwal pemasangan.
              </Text>
              <Text style={styles.sectionLabel}>Kendaraan Anda</Text>
              <View style={styles.chipWrap}>
                {vehicles.map((v) => (
                  <Pressable
                    key={v.id}
                    style={[styles.chip, vehicleId === v.id && styles.chipActive]}
                    onPress={() => setVehicleId(v.id)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        vehicleId === v.id && styles.chipTextActive,
                      ]}
                    >
                      {v.brand} {v.model}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {stepIndex === 1 && (
            <View>
              <Text style={styles.sectionLabel}>Produk yang Diminati</Text>
              {Object.entries(groupedProducts).map(([type, items]) => (
                <View key={type} style={styles.productGroup}>
                  <Text style={styles.productGroupTitle}>
                    {PRODUCT_TYPE_LABEL[type] || type}
                  </Text>
                  {items.map((p) => {
                    const selected = selectedProductIds.includes(p.id);
                    return (
                      <Pressable
                        key={p.id}
                        style={[styles.productRow, selected && styles.productRowActive]}
                        onPress={() => toggleProduct(p.id)}
                      >
                        <Ionicons
                          name={selected ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={selected ? colors.accent : colors.mutedLight}
                        />
                        <Text style={styles.productRowText}>{p.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}

              <Pressable
                style={styles.notYetSoldNote}
                onPress={() => router.push('/inquiry' as never)}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={16}
                  color={colors.muted}
                />
                <Text style={styles.notYetSoldText}>
                  Tertarik Color Change Film? Produk ini belum tersedia untuk
                  dijual di Indonesia. Ketuk untuk daftar minat dan dapat info
                  begitu tersedia.
                </Text>
              </Pressable>
            </View>
          )}

          {stepIndex === 2 && (
            <View>
              <Text style={styles.sectionLabel}>Data Kontak</Text>
              <Card style={styles.formCard}>
                <Text style={styles.fieldLabel}>Nama Lengkap *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Nama Anda"
                  placeholderTextColor={colors.mutedLight}
                  value={customerName}
                  onChangeText={setCustomerName}
                />
                <Text style={styles.fieldLabel}>Nomor Telepon / WhatsApp *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="08xxxxxxxxxx"
                  placeholderTextColor={colors.mutedLight}
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  keyboardType="phone-pad"
                />
                <Text style={styles.fieldLabel}>Email (opsional — untuk konfirmasi)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="nama@email.com"
                  placeholderTextColor={colors.mutedLight}
                  value={customerEmail}
                  onChangeText={setCustomerEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Text style={styles.fieldLabel}>Plat Nomor (opsional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="B 1234 ABC"
                  placeholderTextColor={colors.mutedLight}
                  value={licensePlate}
                  onChangeText={setLicensePlate}
                  autoCapitalize="characters"
                />
              </Card>
            </View>
          )}

          {stepIndex === 3 && (
            <View>
              <Text style={styles.sectionLabel}>Catatan Tambahan (opsional)</Text>
              <Card style={styles.formCard}>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Mis. preferensi warna, jadwal pemasangan, dsb."
                  placeholderTextColor={colors.mutedLight}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={3}
                />
              </Card>

              <Text style={styles.sectionLabel}>Ringkasan</Text>
              <Card style={styles.formCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Kendaraan</Text>
                  <Text style={styles.summaryValue}>
                    {selectedVehicle
                      ? `${selectedVehicle.brand} ${selectedVehicle.model}`
                      : '-'}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Produk</Text>
                  <Text style={styles.summaryValue}>
                    {selectedProducts.map((p) => p.name).join(', ') || '-'}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Nama</Text>
                  <Text style={styles.summaryValue}>{customerName || '-'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Telepon</Text>
                  <Text style={styles.summaryValue}>{customerPhone || '-'}</Text>
                </View>
                {customerEmail.trim().length > 0 && (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Email</Text>
                    <Text style={styles.summaryValue}>{customerEmail}</Text>
                  </View>
                )}
                {licensePlate.trim().length > 0 && (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Plat Nomor</Text>
                    <Text style={styles.summaryValue}>{licensePlate}</Text>
                  </View>
                )}
              </Card>

              {submitError && (
                <View style={styles.submitErrorBox}>
                  <Ionicons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.submitErrorText}>{submitError}</Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </Animated.View>

      {/* ===== Navigasi bawah ===== */}
      <View style={styles.navRow}>
        {stepIndex > 0 ? (
          <Button
            label="Kembali"
            variant="outline"
            onPress={goBack}
            style={styles.navButtonHalf}
          />
        ) : (
          <View style={styles.navButtonHalf} />
        )}

        {stepIndex < TOTAL_STEPS - 1 ? (
          <Button
            label="Lanjut"
            onPress={goNext}
            disabled={!stepValid[stepIndex]}
            style={styles.navButtonHalf}
          />
        ) : (
          <Button
            label="Kirim Permintaan"
            onPress={handleSubmit}
            disabled={!isFormValid}
            loading={submitting}
            style={styles.navButtonHalf}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  centerState: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  intro: {
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.alt,
    borderRadius: radius.pill,
  },
  chipActive: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: fontSize.sm,
    color: colors.ink,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.white,
  },
  productGroup: {
    marginBottom: spacing.md,
  },
  productGroupTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.mutedLight,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  productRowActive: {
    backgroundColor: colors.alt,
  },
  productRowText: {
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  notYetSoldNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.alt,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  notYetSoldText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 17,
  },
  formCard: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  textArea: {
    height: 80,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  summaryLabel: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
  },
  summaryValue: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.ink,
    fontWeight: '600',
    textAlign: 'right',
  },
  submitErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#fde8e8',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  submitErrorText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  navRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  navButtonHalf: {
    flex: 1,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  progressItem: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  progressDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.alt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotActive: {
    backgroundColor: colors.accent,
  },
  progressDotDone: {
    backgroundColor: colors.success,
  },
  progressDotText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.mutedLight,
  },
  progressDotTextActive: {
    color: colors.white,
  },
  progressLabel: {
    fontSize: 10,
    color: colors.mutedLight,
    marginTop: spacing.xs,
  },
  progressLabelActive: {
    color: colors.ink,
    fontWeight: '700',
  },
  progressLine: {
    position: 'absolute',
    top: 11,
    left: '60%',
    right: '-40%',
    height: 2,
    backgroundColor: colors.line,
  },
  progressLineDone: {
    backgroundColor: colors.success,
  },
  successIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  successTitle: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.ink,
  },
  quotationNumber: {
    fontWeight: '800',
    color: colors.accent,
    fontSize: fontSize.base,
  },
  successNote: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  successButton: {
    marginTop: spacing.sm,
    width: '100%',
  },
});