import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { PickerModal } from '@/components/ui/PickerModal';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useFadeIn } from '@/lib/useFadeIn';
import { useAppTheme } from '@/lib/theme-context';
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from '@/lib/haptics';

interface VehicleOption {
  id: number;
  brand: string;
  model: string;
  variant: string | null;
}

interface ProductOption {
  id: number;
  name: string;
  product_type: string;
}

interface StoreOption {
  id: number;
  name: string;
  city: string;
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
  const insets = useSafeAreaInsets();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);

  const [stepIndex, setStepIndex] = useState(0);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<number | null>(null);

  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quotationNumber, setQuotationNumber] = useState<string | null>(null);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const successOpacity = useFadeIn(400);

  useEffect(() => {
    loadOptions();
    apiFetch<{ data: StoreOption[] }>('/api/stores', { skipAuth: true })
      .then((res) => setStores(res.data))
      .catch(() => {});
  }, []);

  const loadOptions = () => {
    setPhase('loading');
    setLoadError(null);
    apiFetch<{ data: { brands: string[]; vehicles: VehicleOption[]; products: ProductOption[] } }>(
      '/api/quotation/options',
      { skipAuth: true }
    )
      .then((res) => {
        setBrands(res.data.brands);
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

  // Cascading vehicle helpers
  const modelsForBrand = selectedBrand
    ? [...new Set(vehicles.filter((v) => v.brand === selectedBrand).map((v) => v.model))]
    : [];

  const variantsForModel = selectedBrand && selectedModel
    ? vehicles
        .filter((v) => v.brand === selectedBrand && v.model === selectedModel && v.variant)
        .map((v) => v.variant as string)
    : [];

  const hasVariants = variantsForModel.length > 0;

  const resolveVehicleId = (brand: string, model: string, variant: string | null): number | null => {
    const match = vehicles.find(
      (v) => v.brand === brand && v.model === model && (hasVariants ? v.variant === variant : true)
    );
    return match?.id ?? null;
  };

  const handleSelectBrand = (brand: string) => {
    setSelectedBrand(brand);
    setSelectedModel(null);
    setSelectedVariant(null);
    setVehicleId(null);
    hapticLight();
  };

  const handleSelectModel = (model: string) => {
    setSelectedModel(model);
    setSelectedVariant(null);
    // Jika tidak ada varian, langsung resolve vehicle id sekarang
    const variants = vehicles
      .filter((v) => v.brand === selectedBrand && v.model === model && v.variant)
      .map((v) => v.variant as string);
    if (variants.length === 0) {
      const id = resolveVehicleId(selectedBrand!, model, null);
      setVehicleId(id);
    } else {
      setVehicleId(null);
    }
    hapticLight();
  };

  const handleSelectVariant = (variant: string) => {
    setSelectedVariant(variant);
    const id = resolveVehicleId(selectedBrand!, selectedModel!, variant);
    setVehicleId(id);
    hapticLight();
  };

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const selectedProducts = sellableProducts.filter((p) =>
    selectedProductIds.includes(p.id)
  );

  // Label toko diformat "Nama — Kota" supaya bisa dipakai di PickerModal
  // yang berbasis string biasa (sama seperti pola Merek/Tipe/Varian).
  const storeOptions = stores.map((s) => `${s.name} — ${s.city}`);
  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? null;
  const selectedStoreLabel = selectedStore ? `${selectedStore.name} — ${selectedStore.city}` : null;

  const handleSelectStore = (label: string) => {
    const store = stores.find((s) => `${s.name} — ${s.city}` === label);
    setSelectedStoreId(store?.id ?? null);
    hapticLight();
  };

  const step0Valid = selectedBrand !== null && selectedModel !== null && (hasVariants ? selectedVariant !== null : true) && vehicleId !== null;

  const stepValid = [
    step0Valid,
    selectedProductIds.length > 0,
    selectedStoreId !== null && customerName.trim().length > 0 && customerPhone.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim()),
    true,
  ];

  const isFormValid = stepValid[0] && stepValid[1] && stepValid[2];

  const animateTo = (next: number) => {
    hapticLight();
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
          store_id: selectedStoreId,
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
        hapticSuccess();
      })
      .catch((err) => {
        hapticError();
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
    const vehicleLabel = [selectedBrand, selectedModel, selectedVariant].filter(Boolean).join(' ');
    const text =
      `Permintaan Penawaran Ginnva\n` +
      `No. Referensi: ${quotationNumber}\n` +
      `Kendaraan: ${vehicleLabel || '-'}\n` +
      `Produk diminati:\n${productNames}\n` +
      `Kontak: ${customerName} (${customerPhone})`;
    Share.share({ message: text }).catch(() => {
      // Pengguna membatalkan share sheet — tidak perlu ditangani sebagai error.
    });
  };

  const HeaderBar = () => (
    <View style={styles.header}>
      {router.canGoBack() ? (
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.sideButton} />
      )}
      <Text style={styles.headerTitle} numberOfLines={1}>Ajukan Penawaran</Text>
      <View style={styles.sideButton} />
    </View>
  );

  if (phase === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <HeaderBar />
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <HeaderBar />
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
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
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <HeaderBar />
        <Animated.ScrollView contentContainerStyle={styles.centerState} style={{ opacity: successOpacity }}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark" size={36} color="#ffffff" />
          </View>
          <Text style={styles.successTitle}>Permintaan Terkirim</Text>
          <Text style={styles.centerStateText}>
            Nomor referensi Anda: {'\n'}
            <Text style={styles.quotationNumber}>{quotationNumber}</Text>
          </Text>
          <Text style={styles.successNote}>
            Tim sales kami akan segera menghubungi Anda lewat nomor telepon yang
            didaftarkan untuk membahas detail dan harga.{'\n\n'}
            Email konfirmasi telah dikirim ke {customerEmail}.
          </Text>
          <Text style={styles.successNextStep}>
            💡 Setelah tim kami menghubungi Anda dan harga disepakati, Anda bisa melanjutkan dengan membuat booking jadwal instalasi di menu <Text style={styles.successNextStepBold}>Booking</Text>.
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
        </Animated.ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <HeaderBar />

      {/* ===== Progress dots — step yang sudah dilewati bisa ditap untuk
          lompat balik langsung (mis. dari Ringkasan mau ubah Kendaraan),
          step yang belum tercapai tidak bisa ditap (mencegah lompat maju
          melewati validasi). ===== */}
      <View style={styles.progressRow}>
        {STEP_TITLES.map((title, i) => (
          <Pressable
            key={title}
            style={styles.progressItem}
            disabled={i >= stepIndex}
            onPress={() => animateTo(i)}
          >
            <View
              style={[
                styles.progressDot,
                i === stepIndex && styles.progressDotActive,
                i < stepIndex && styles.progressDotDone,
              ]}
            >
              {i < stepIndex ? (
                <Ionicons name="checkmark" size={12} color="#ffffff" />
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
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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

              {/* Picker row — Merek */}
              <Text style={styles.sectionLabel}>Kendaraan Anda</Text>
              <Pressable style={styles.pickerRow} onPress={() => setBrandPickerOpen(true)}>
                <View style={styles.pickerRowLeft}>
                  <Ionicons name="car-outline" size={20} color={selectedBrand ? colors.accent : colors.textMuted} />
                  <View>
                    <Text style={styles.pickerRowHint}>Merek Mobil</Text>
                    <Text style={[styles.pickerRowValue, !selectedBrand && styles.pickerRowPlaceholder]}>
                      {selectedBrand ?? 'Pilih merek...'}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>

              {/* Picker row — Tipe */}
              <Pressable
                style={[styles.pickerRow, !selectedBrand && styles.pickerRowDisabled]}
                onPress={() => selectedBrand && setModelPickerOpen(true)}
              >
                <View style={styles.pickerRowLeft}>
                  <Ionicons name="list-outline" size={20} color={selectedModel ? colors.accent : colors.textMuted} />
                  <View>
                    <Text style={styles.pickerRowHint}>Tipe Mobil</Text>
                    <Text style={[styles.pickerRowValue, !selectedModel && styles.pickerRowPlaceholder]}>
                      {selectedModel ?? (selectedBrand ? 'Pilih tipe...' : 'Pilih merek dulu')}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>

              {/* Picker row — Varian (hanya jika ada) */}
              {selectedModel && hasVariants && (
                <Pressable
                  style={styles.pickerRow}
                  onPress={() => setVariantPickerOpen(true)}
                >
                  <View style={styles.pickerRowLeft}>
                    <Ionicons name="options-outline" size={20} color={selectedVariant ? colors.accent : colors.textMuted} />
                    <View>
                      <Text style={styles.pickerRowHint}>Varian</Text>
                      <Text style={[styles.pickerRowValue, !selectedVariant && styles.pickerRowPlaceholder]}>
                        {selectedVariant ?? 'Pilih varian...'}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              )}

              {/* Modals */}
              <PickerModal
                visible={brandPickerOpen}
                title="Pilih Merek Mobil"
                options={brands as string[]}
                selected={selectedBrand}
                onSelect={handleSelectBrand}
                onClose={() => setBrandPickerOpen(false)}
                searchPlaceholder="Cari merek..."
              />
              <PickerModal
                visible={modelPickerOpen}
                title="Pilih Tipe Mobil"
                options={modelsForBrand}
                selected={selectedModel}
                onSelect={handleSelectModel}
                onClose={() => setModelPickerOpen(false)}
                searchPlaceholder="Cari tipe..."
              />
              <PickerModal
                visible={variantPickerOpen}
                title="Pilih Varian"
                options={variantsForModel}
                selected={selectedVariant}
                onSelect={handleSelectVariant}
                onClose={() => setVariantPickerOpen(false)}
                searchPlaceholder="Cari varian..."
              />
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
                          color={selected ? colors.accent : colors.textMuted}
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
                  color={colors.textSecondary}
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
              <Text style={styles.sectionLabel}>Toko Tujuan</Text>
              <Pressable style={styles.pickerRow} onPress={() => setStorePickerOpen(true)}>
                <View style={styles.pickerRowLeft}>
                  <Ionicons name="storefront-outline" size={20} color={selectedStoreId ? colors.accent : colors.textMuted} />
                  <View>
                    <Text style={styles.pickerRowHint}>Toko/Dealer *</Text>
                    <Text style={[styles.pickerRowValue, !selectedStoreId && styles.pickerRowPlaceholder]}>
                      {selectedStoreLabel ?? 'Pilih toko terdekat...'}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
              <PickerModal
                visible={storePickerOpen}
                title="Pilih Toko Tujuan"
                options={storeOptions}
                selected={selectedStoreLabel}
                onSelect={handleSelectStore}
                onClose={() => setStorePickerOpen(false)}
                searchPlaceholder="Cari toko atau kota..."
              />

              <Text style={styles.sectionLabel}>Data Kontak</Text>
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>Nama Lengkap *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Nama Anda"
                  placeholderTextColor={colors.textMuted}
                  value={customerName}
                  onChangeText={setCustomerName}
                />
                <Text style={styles.fieldLabel}>Nomor Telepon / WhatsApp *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="08xxxxxxxxxx"
                  placeholderTextColor={colors.textMuted}
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  keyboardType="phone-pad"
                />
                <Text style={styles.fieldLabel}>Email *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="nama@email.com"
                  placeholderTextColor={colors.textMuted}
                  value={customerEmail}
                  onChangeText={setCustomerEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Text style={styles.fieldLabel}>Plat Nomor (opsional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="B 1234 ABC"
                  placeholderTextColor={colors.textMuted}
                  value={licensePlate}
                  onChangeText={setLicensePlate}
                  autoCapitalize="characters"
                />
              </View>
            </View>
          )}

          {stepIndex === 3 && (
            <View>
              <Text style={styles.sectionLabel}>Catatan Tambahan (opsional)</Text>
              <View style={styles.formCard}>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Mis. preferensi warna, jadwal pemasangan, dsb."
                  placeholderTextColor={colors.textMuted}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={3}
                />
              </View>

              <Text style={styles.sectionLabel}>Ringkasan</Text>
              <View style={styles.formCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Merek</Text>
                  <Text style={styles.summaryValue}>{selectedBrand || '-'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Tipe</Text>
                  <Text style={styles.summaryValue}>{selectedModel || '-'}</Text>
                </View>
                {selectedVariant && (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Varian</Text>
                    <Text style={styles.summaryValue}>{selectedVariant}</Text>
                  </View>
                )}
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Toko</Text>
                  <Text style={styles.summaryValue}>{selectedStoreLabel || '-'}</Text>
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
              </View>

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
      </KeyboardAvoidingView>

      {/* ===== Navigasi bawah ===== */}
      {!stepValid[stepIndex] && (
        <Text style={styles.stepHint}>
          {stepIndex === 0 && 'Pilih merek, tipe, dan varian (jika ada) kendaraan Anda.'}
          {stepIndex === 1 && 'Pilih minimal satu produk yang diminati.'}
          {stepIndex === 2 && 'Lengkapi toko tujuan, nama, nomor telepon, dan email yang valid.'}
        </Text>
      )}
      <View style={[styles.navRow, { paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.md }]}>
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

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
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
    color: colors.textSecondary,
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
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  intro: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  productGroup: {
    marginBottom: spacing.md,
  },
  productGroupTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
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
    backgroundColor: colors.surface,
  },
  productRowText: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  notYetSoldNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  notYetSoldText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  formCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
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
    color: colors.textMuted,
  },
  summaryValue: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontWeight: '600',
    textAlign: 'right',
  },
  submitErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerBg,
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  stepHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    backgroundColor: colors.bg,
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
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  progressDotActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  progressDotDone: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  progressDotText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
  },
  progressDotTextActive: {
    color: '#ffffff',
  },
  progressLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  progressLabelActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  progressLine: {
    position: 'absolute',
    top: 11,
    left: '60%',
    right: '-40%',
    height: 2,
    backgroundColor: colors.border,
  },
  progressLineDone: {
    backgroundColor: colors.accent,
  },
  successIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  successTitle: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  quotationNumber: {
    fontWeight: '800',
    color: colors.accent,
    fontSize: fontSize.base,
  },
  successNote: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  successNextStep: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 18,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  successNextStepBold: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  successButton: {
    marginTop: spacing.sm,
    width: '100%',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  pickerRowDisabled: {
    opacity: 0.45,
  },
  pickerRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  pickerRowHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: 2,
  },
  pickerRowValue: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pickerRowPlaceholder: {
    fontWeight: '400',
    color: colors.textMuted,
  },
  });
}
