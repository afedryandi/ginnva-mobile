import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  PanResponder,
  Share,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthField } from '@/components/auth/AuthShell';
import { AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { PickerModal } from '@/components/ui/PickerModal';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { toWhatsAppNumber } from '@/lib/phone';
import { useFadeIn } from '@/lib/useFadeIn';
import { useAppTheme } from '@/lib/theme-context';
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from '@/lib/haptics';
import { getLeadAttribution, LeadAttribution } from '@/lib/lead-attribution';

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
  position: 'front' | 'side_rear' | null;
}

// SEBELUMNYA render p.name mentah -- kalau admin kasih Nama Produk sama
// persis untuk Kaca Depan & Kaca Samping/Belakang (2 baris terpisah
// selalu, tidak ada larangan nama sama), keduanya tampil identik,
// customer tidak bisa bedakan. Sama pola dengan web (QuoteForm.tsx).
// Ditemukan lewat testing manual 2026-09-01.
// Ketebalan PPF (mil) dari tabel spesifikasi di ginnva-web app/ppf/page.tsx;
// mikron = mil x 25.4 (konversi).
const PPF_THICKNESS: { match: RegExp; label: string }[] = [
  { match: /M8-M/i, label: '7.5 mil / ±190 µm' },
  { match: /M10/i, label: '8.8 mil / ±224 µm' },
  { match: /H10/i, label: '7.8 mil / ±198 µm' },
  { match: /EV7/i, label: '7.5 mil / ±190 µm' },
];

function productOptionLabel(p: ProductOption): string {
  if (p.product_type === 'ppf') {
    const t = PPF_THICKNESS.find((x) => x.match.test(p.name));
    return t ? `${p.name} — ${t.label}` : p.name;
  }
  if (p.product_type !== 'window_film' || !p.position) return p.name;

  const positionLabel = p.position === 'front' ? 'Kaca Depan' : 'Kaca Samping & Belakang';
  const alreadyLabeled = /depan|samping|belakang/i.test(p.name);
  return alreadyLabeled ? p.name : `${p.name} (${positionLabel})`;
}

interface StoreOption {
  id: number;
  name: string;
  city: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

// Haversine — jarak garis lurus (km), cukup akurat untuk sekadar
// mengurutkan toko terdekat, tidak perlu jarak tempuh jalan.
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

// Step 3 SEBELUMNYA cuma dilabeli "Kontak" — tidak menyampaikan bahwa
// pemilihan Toko Tujuan juga terjadi di step yang sama, padahal itu field
// pertama yang customer isi di step ini.
const STEP_TITLES = ['Kendaraan', 'Produk', 'Toko & Kontak', 'Ringkasan'];
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
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

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
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quotationNumber, setQuotationNumber] = useState<string | null>(null);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const successOpacity = useFadeIn(400);

  useEffect(() => {
    loadOptions();
    apiFetch<{ data: StoreOption[] }>('/api/stores', { skipAuth: true })
      .then((res) => {
        // Ginnva House ditaruh paling atas (diminta user 2026-09-25, sama
        // perubahan di ginnva-web/app/dealers, tab Toko & form Booking) —
        // sisa urutan dari API tetap dipertahankan (stable sort).
        const sorted = [...res.data].sort((a, b) => {
          const aIsDefault = a.name === 'Ginnva House';
          const bIsDefault = b.name === 'Ginnva House';
          if (aIsDefault === bIsDefault) return 0;
          return aIsDefault ? -1 : 1;
        });
        setStores(sorted);
      })
      .catch(() => {});
  }, []);

  // Lokasi HANYA diminta sekali begitu customer sampai step Toko & Kontak,
  // bukan langsung saat form dibuka — supaya tidak menyodorkan izin lokasi
  // sebelum ada konteks kenapa dibutuhkan. Sepenuhnya best-effort: gagal
  // atau ditolak tetap membiarkan daftar toko tampil (urutan default dari
  // API), tidak ada alert yang mengganggu alur pengisian form.
  const locationRequestedRef = useRef(false);
  useEffect(() => {
    if (stepIndex !== 2 || locationRequestedRef.current) return;
    locationRequestedRef.current = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      } catch {
        // Diamkan — daftar toko tetap tampil dengan urutan default.
      }
    })();
  }, [stepIndex]);

  // Toko terdekat naik ke atas kalau lokasi customer berhasil didapat;
  // kalau tidak, urutan asli dari API dipertahankan (sebelumnya SELALU
  // urutan asli, tidak pernah diurutkan berdasar jarak sama sekali).
  const sortedStores = useMemo(() => {
    if (!userLocation) return stores;
    return [...stores].sort((a, b) => {
      const da = a.latitude != null && a.longitude != null
        ? distanceKm(userLocation.latitude, userLocation.longitude, a.latitude, a.longitude)
        : Infinity;
      const db = b.latitude != null && b.longitude != null
        ? distanceKm(userLocation.latitude, userLocation.longitude, b.latitude, b.longitude)
        : Infinity;
      return da - db;
    });
  }, [stores, userLocation]);

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
            : 'Gagal memuat data formulir. Periksa koneksi internetmu.'
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
  const storeOptions = sortedStores.map((s) => `${s.name} — ${s.city}`);
  const selectedStore = sortedStores.find((s) => s.id === selectedStoreId) ?? null;
  const selectedStoreLabel = selectedStore ? `${selectedStore.name} — ${selectedStore.city}` : null;

  const handleSelectStore = (label: string) => {
    const store = sortedStores.find((s) => `${s.name} — ${s.city}` === label);
    setSelectedStoreId(store?.id ?? null);
    hapticLight();
  };

  const step0Valid = selectedBrand !== null && selectedModel !== null && (hasVariants ? selectedVariant !== null : true) && vehicleId !== null;

  const stepValid = [
    step0Valid,
    selectedProductIds.length > 0,
    selectedStoreId !== null && customerName.trim().length > 0 && customerPhone.trim().length > 0 && (customerEmail.trim().length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())),
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

  const [attribution, setAttribution] = useState<LeadAttribution | undefined>(undefined);
  useEffect(() => {
    getLeadAttribution().then(setAttribution);
  }, []);

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
          message: message.trim() || undefined,
          items: selectedProductIds.map((id) => ({ film_product_id: id })),
          attribution,
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
            : 'Gagal mengirim permintaan. Periksa koneksi internetmu dan coba lagi.'
        );
      })
      .finally(() => setSubmitting(false));
  };

  const handleShareWhatsApp = () => {
    const productNames = selectedProducts.map((p) => `- ${productOptionLabel(p)}`).join('\n');
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

  const glow = (
    <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />
  );

  const backButton = router.canGoBack() ? (
    <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
      <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
    </Pressable>
  ) : (
    <View style={styles.backSpacer} />
  );

  if (phase === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        {glow}
        <View style={styles.topRow}>{backButton}</View>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        {glow}
        <View style={styles.topRow}>{backButton}</View>
        <View style={styles.centerState}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateText}>{loadError}</Text>
          <PressableScale style={styles.retryButton} onPress={loadOptions} accessibilityRole="button">
            <Text style={styles.retryText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        {glow}
        <View style={styles.topRow}>{backButton}</View>
        <Animated.ScrollView
          contentContainerStyle={styles.successContent}
          style={{ opacity: successOpacity }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.successRing}>
            <View style={styles.successIconWrap}>
              <Ionicons name="checkmark" size={38} color="#ffffff" />
            </View>
          </View>
          <Text style={styles.successTitle}>Permintaan Terkirim</Text>
          <Text style={styles.successNote}>
            Tim sales kami akan segera menghubungimu lewat nomor telepon yang didaftarkan untuk membahas detail dan harga.
            {customerEmail.trim().length > 0 ? ` Email konfirmasi telah dikirim ke ${customerEmail.trim()}.` : ''}
          </Text>

          <View style={styles.refCard}>
            <Text style={styles.refLabel}>Nomor referensi</Text>
            <Text style={styles.quotationNumber} selectable>{quotationNumber}</Text>
          </View>

          <View style={styles.nextStep}>
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={styles.nextStepText}>
              Setelah harga disepakati, lanjutkan dengan membuat jadwal instalasi di menu <Text style={styles.nextStepBold}>Booking</Text>.
            </Text>
          </View>

          <View style={styles.successActions}>
            <PressableScale style={styles.primaryButton} onPress={handleShareWhatsApp} accessibilityRole="button">
              <Ionicons name="share-social-outline" size={19} color="#ffffff" />
              <Text style={styles.primaryButtonText}>Bagikan ke WhatsApp</Text>
            </PressableScale>
            {/* Langsung buka WhatsApp toko yang dipilih kalau nomornya ada;
                cadangannya daftar toko jika toko belum punya nomor. */}
            <PressableScale
              style={styles.secondaryButton}
              onPress={() => {
                if (selectedStore?.phone) {
                  Linking.openURL(`https://wa.me/${toWhatsAppNumber(selectedStore.phone)}`);
                } else {
                  router.push('/(tabs)/stores' as never);
                }
              }}
              accessibilityRole="button"
            >
              <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.textPrimary} />
              <Text style={styles.secondaryButtonText}>
                {selectedStore?.phone ? `Hubungi ${selectedStore.name}` : 'Hubungi Toko Terdekat'}
              </Text>
            </PressableScale>
            <Pressable style={styles.ghostButton} onPress={() => router.replace('/(tabs)' as never)} accessibilityRole="button">
              <Text style={styles.ghostButtonText}>Kembali ke Beranda</Text>
            </Pressable>
          </View>
        </Animated.ScrollView>
      </SafeAreaView>
    );
  }

  const stepCopy = [
    { title: 'Kendaraan', subtitle: 'Pilih kendaraanmu. Tim sales kami akan menghubungimu untuk membahas harga dan jadwal pemasangan.' },
    { title: 'Produk', subtitle: 'Pilih satu atau lebih produk yang kamu minati.' },
    { title: 'Toko & Kontak', subtitle: 'Pilih toko tujuan dan isi kontak yang bisa kami hubungi.' },
    { title: 'Ringkasan', subtitle: 'Periksa kembali sebelum permintaan dikirim.' },
  ][stepIndex];

  const selectRow = (opts: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    hint: string;
    value: string | null;
    placeholder: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <PressableScale
      style={[styles.selectRow, opts.disabled && styles.selectRowDisabled, opts.value ? styles.selectRowFilled : null]}
      onPress={opts.disabled ? undefined : opts.onPress}
      accessibilityRole="button"
    >
      <View style={[styles.selectIcon, opts.value ? styles.selectIconFilled : null]}>
        <Ionicons name={opts.icon} size={20} color={opts.value ? colors.accent : colors.textMuted} />
      </View>
      <View style={styles.selectTextWrap}>
        <Text style={styles.selectHint}>{opts.hint}</Text>
        <Text style={[styles.selectValue, !opts.value && styles.selectPlaceholder]} numberOfLines={1}>
          {opts.value ?? opts.placeholder}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </PressableScale>
  );

  const summaryItems: { label: string; value: string }[] = [
    { label: 'Merek', value: selectedBrand || '-' },
    { label: 'Tipe', value: selectedModel || '-' },
    ...(selectedVariant ? [{ label: 'Varian', value: selectedVariant }] : []),
    { label: 'Toko', value: selectedStoreLabel || '-' },
    { label: 'Produk', value: selectedProducts.map((p) => productOptionLabel(p)).join(', ') || '-' },
    { label: 'Nama', value: customerName || '-' },
    { label: 'Telepon', value: customerPhone || '-' },
    ...(customerEmail.trim().length > 0 ? [{ label: 'Email', value: customerEmail }] : []),
  ];

  const emailValue = customerEmail.trim();
  const emailInvalid = emailValue.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      {glow}

      <View style={styles.topRow}>
        {backButton}
        <Text style={styles.topCounter}>Langkah {stepIndex + 1} dari {TOTAL_STEPS}</Text>
      </View>

      {/* Bilah kemajuan: langkah yang sudah dilewati bisa diketuk untuk kembali. */}
      <View style={styles.progressRow}>
        {STEP_TITLES.map((title, i) => (
          <Pressable
            key={title}
            style={styles.progressItem}
            disabled={i >= stepIndex}
            onPress={() => animateTo(i)}
            hitSlop={{ top: 10, bottom: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Kembali ke ${title}`}
          >
            <View style={[styles.progressBar, i <= stepIndex && styles.progressBarActive]} />
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[styles.flex, { transform: [{ translateX: slideAnim }] }]} {...panResponder.panHandlers}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{stepCopy.title}</Text>
            <Text style={styles.subtitle}>{stepCopy.subtitle}</Text>

            {stepIndex === 0 && (
              <View style={styles.stack}>
                {selectRow({ icon: 'car-outline', hint: 'Merek Mobil', value: selectedBrand, placeholder: 'Pilih merek...', onPress: () => setBrandPickerOpen(true) })}
                {selectRow({
                  icon: 'list-outline',
                  hint: 'Tipe Mobil',
                  value: selectedModel,
                  placeholder: selectedBrand ? 'Pilih tipe...' : 'Pilih merek dulu',
                  onPress: () => setModelPickerOpen(true),
                  disabled: !selectedBrand,
                })}
                {selectedModel && hasVariants
                  ? selectRow({ icon: 'options-outline', hint: 'Varian', value: selectedVariant, placeholder: 'Pilih varian...', onPress: () => setVariantPickerOpen(true) })
                  : null}

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
              <View style={styles.stack}>
                {Object.entries(groupedProducts).map(([type, items]) => (
                  <View key={type} style={styles.productGroup}>
                    <Text style={styles.groupTitle}>{PRODUCT_TYPE_LABEL[type] || type}</Text>
                    {items.map((p) => {
                      const selected = selectedProductIds.includes(p.id);
                      return (
                        <PressableScale
                          key={p.id}
                          style={[styles.productRow, selected && styles.productRowActive]}
                          onPress={() => toggleProduct(p.id)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                        >
                          <View style={[styles.checkCircle, selected && styles.checkCircleActive]}>
                            {selected ? <Ionicons name="checkmark" size={15} color="#ffffff" /> : null}
                          </View>
                          <Text style={styles.productRowText}>{productOptionLabel(p)}</Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                ))}

                <PressableScale style={styles.notYetSoldNote} onPress={() => router.push('/inquiry' as never)} accessibilityRole="button">
                  <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
                  <Text style={styles.notYetSoldText}>
                    Tertarik Color Change Film? Produk ini belum tersedia untuk dijual di Indonesia. Ketuk untuk daftar minat dan dapat info begitu tersedia.
                  </Text>
                </PressableScale>
              </View>
            )}

            {stepIndex === 2 && (
              <View style={styles.stack}>
                {selectRow({ icon: 'storefront-outline', hint: 'Toko / Dealer *', value: selectedStoreLabel, placeholder: 'Pilih toko terdekat...', onPress: () => setStorePickerOpen(true) })}
                <PickerModal
                  visible={storePickerOpen}
                  title="Pilih Toko Tujuan"
                  options={storeOptions}
                  selected={selectedStoreLabel}
                  onSelect={handleSelectStore}
                  onClose={() => setStorePickerOpen(false)}
                  searchPlaceholder="Cari toko atau kota..."
                />

                <AuthField label="Nama Lengkap *" icon="person-outline">
                  {(input) => (
                    <TextInput {...input} placeholder="Namamu" placeholderTextColor={colors.textMuted} value={customerName} onChangeText={setCustomerName} />
                  )}
                </AuthField>
                <AuthField label="Nomor Telepon / WhatsApp *" icon="call-outline">
                  {(input) => (
                    <TextInput {...input} placeholder="08xxxxxxxxxx" placeholderTextColor={colors.textMuted} value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />
                  )}
                </AuthField>
                <AuthField label="Email (opsional)" icon="mail-outline" error={emailInvalid ? 'Format email belum benar.' : undefined}>
                  {(input) => (
                    <TextInput {...input} placeholder="nama@email.com" placeholderTextColor={colors.textMuted} value={customerEmail} onChangeText={setCustomerEmail} keyboardType="email-address" autoCapitalize="none" />
                  )}
                </AuthField>
              </View>
            )}

            {stepIndex === 3 && (
              <View style={styles.stack}>
                <View style={styles.summaryCard}>
                  {summaryItems.map((item, i) => (
                    <View key={item.label} style={[styles.summaryRow, i > 0 && styles.summaryRowBorder]}>
                      <Text style={styles.summaryLabel}>{item.label}</Text>
                      <Text style={styles.summaryValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>

                <AuthField label="Catatan Tambahan (opsional)" icon="create-outline" multiline>
                  {(input) => (
                    <TextInput
                      {...input}
                      style={input.style}
                      placeholder="Mis. preferensi warna, jadwal pemasangan, dsb."
                      placeholderTextColor={colors.textMuted}
                      value={message}
                      onChangeText={setMessage}
                      multiline
                    />
                  )}
                </AuthField>

                {submitError && (
                  <View style={styles.submitErrorBox}>
                    <Ionicons name="alert-circle" size={18} color={colors.danger} />
                    <Text style={styles.submitErrorText}>{submitError}</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      {!stepValid[stepIndex] && (
        <Text style={styles.stepHint}>
          {stepIndex === 0 && 'Pilih merek, tipe, dan varian (jika ada) kendaraanmu.'}
          {stepIndex === 1 && 'Pilih minimal satu produk yang diminati.'}
          {stepIndex === 2 && 'Lengkapi toko tujuan, nama, dan nomor telepon (email boleh kosong, tapi harus valid kalau diisi).'}
        </Text>
      )}
      <View style={[styles.navRow, { paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.md }]}>
        {stepIndex > 0 ? (
          <PressableScale style={styles.navBack} onPress={goBack} accessibilityRole="button">
            <Text style={styles.navBackText}>Kembali</Text>
          </PressableScale>
        ) : null}

        {stepIndex < TOTAL_STEPS - 1 ? (
          <PressableScale
            style={[styles.navNext, !stepValid[stepIndex] && styles.navDisabled]}
            onPress={goNext}
            disabled={!stepValid[stepIndex]}
            accessibilityRole="button"
          >
            <Text style={styles.navNextText}>Lanjut</Text>
            <Ionicons name="arrow-forward" size={18} color="#ffffff" />
          </PressableScale>
        ) : (
          <PressableScale
            style={[styles.navNext, (!isFormValid || submitting) && styles.navDisabled]}
            onPress={handleSubmit}
            disabled={!isFormValid || submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={styles.navNextText}>Kirim Permintaan</Text>
                <Ionicons name="paper-plane-outline" size={18} color="#ffffff" />
              </>
            )}
          </PressableScale>
        )}
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    backSpacer: { width: 44, height: 44 },
    topCounter: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textMuted, textAlign: 'right' },

    progressRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 24, paddingBottom: spacing.sm },
    progressItem: { flex: 1 },
    progressBar: { height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
    progressBarActive: { backgroundColor: colors.accent },

    scrollContent: { paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: 40, gap: 8 },
    title: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginBottom: spacing.md },
    stack: { gap: 14 },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 80 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    centerStateText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    retryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    retryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },

    selectRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 24, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    selectRowFilled: { borderColor: colors.accentSoft },
    selectRowDisabled: { opacity: 0.45 },
    selectIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    selectIconFilled: { backgroundColor: colors.accentSoft },
    selectTextWrap: { flex: 1, gap: 2 },
    selectHint: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
    selectValue: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    selectPlaceholder: { fontWeight: '500', color: colors.textMuted },

    productGroup: { gap: 8 },
    groupTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted, marginLeft: 4, marginTop: 4 },
    productRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    productRowActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    checkCircle: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.borderStrong },
    checkCircleActive: { borderColor: colors.accent, backgroundColor: colors.accent },
    productRowText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.textPrimary },
    notYetSoldNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.surfaceElevated },
    notYetSoldText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },

    textArea: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },

    summaryCard: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 13 },
    summaryRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    summaryLabel: { fontSize: 14, color: colors.textMuted },
    summaryValue: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },

    submitErrorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 20, backgroundColor: colors.dangerBg },
    submitErrorText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.danger },

    stepHint: { fontSize: 12, lineHeight: 17, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 32, paddingTop: 8, backgroundColor: colors.bg },
    navRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 24, paddingTop: 12, backgroundColor: colors.bg },
    navBack: { height: 56, paddingHorizontal: 26, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    navBackText: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    navNext: { flex: 1, flexDirection: 'row', gap: 8, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    navNextText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
    navDisabled: { opacity: 0.4 },

    successContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: spacing.lg, paddingBottom: 40, gap: 14 },
    successRing: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, marginBottom: 6 },
    successIconWrap: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    successTitle: { fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary, textAlign: 'center' },
    successNote: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    refCard: { alignSelf: 'stretch', alignItems: 'center', gap: 4, paddingVertical: 18, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    refLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
    quotationNumber: { fontSize: 22, fontWeight: '800', letterSpacing: 0.5, color: colors.accent },
    nextStep: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.surfaceElevated },
    nextStepText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    nextStepBold: { fontWeight: '800', color: colors.textPrimary },
    successActions: { alignSelf: 'stretch', gap: 10, marginTop: 6 },
    primaryButton: { flexDirection: 'row', gap: 8, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    primaryButtonText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
    secondaryButton: { flexDirection: 'row', gap: 8, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    secondaryButtonText: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    ghostButton: { height: 48, alignItems: 'center', justifyContent: 'center' },
    ghostButtonText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  });
}
