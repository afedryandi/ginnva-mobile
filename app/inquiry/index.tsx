import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

// Halaman ini KHUSUS untuk produk yang belum dijual di Indonesia (Color
// Change Film & Architectural Film) — sengaja terpisah dari /quotation
// karena tidak butuh vehicle_id maupun daftar item produk, hanya kontak
// + catatan bebas. Memetakan langsung ke ProductInquiryController di
// backend (bukan QuotationController).
export default function ProductInquiryScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Dikirim dari CTA "Daftarkan Minat Saya" di halaman detail produk
  // (app/products/[category].tsx) — ProductInquiry tidak punya kolom
  // produk sendiri, jadi nama produknya di-prefill ke catatan supaya tim
  // tetap tahu produk mana yang diminati tanpa customer perlu ketik ulang.
  const { product } = useLocalSearchParams<{ product?: string }>();

  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  // Kosong murni untuk catatan bebas customer — nama produk TIDAK lagi
  // di-prefill ke sini (field ini bisa diedit/dihapus bebas, sempat
  // berisiko info produk hilang tanpa sengaja). Ditampilkan sebagai badge
  // read-only terpisah (lihat JSX) dan digabung ke pesan final saat
  // submit, lihat handleSubmit().
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [inquiryNumber, setInquiryNumber] = useState<string | null>(null);

  const isFormValid = customerName.trim().length > 0 && customerContact.trim().length > 0;

  const handleSubmit = () => {
    if (!isFormValid) return;

    setSubmitting(true);
    setSubmitError(null);

    // Info produk (kalau ada) SELALU disertakan di pesan yang dikirim,
    // terlepas apa pun yang diketik/dihapus customer di field Catatan —
    // supaya konteks produk yang diminati tidak pernah hilang begitu saja.
    const finalMessage = [
      product ? `Produk yang diminati: ${product}` : null,
      message.trim() || null,
    ].filter(Boolean).join('\n');

    apiFetch<{ success: boolean; message: string; data: { inquiry_number: string } }>(
      '/api/inquiry/submit',
      {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_contact: customerContact.trim(),
          message: finalMessage || undefined,
        }),
      }
    )
      .then((res) => {
        setInquiryNumber(res.data.inquiry_number);
        setSuccess(true);
      })
      .catch((err) => {
        setSubmitError(
          err instanceof ApiError
            ? err.message
            : 'Gagal mengirim. Periksa koneksi internet Anda dan coba lagi.'
        );
      })
      .finally(() => setSubmitting(false));
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
      <Text style={styles.headerTitle} numberOfLines={1}>Tanya Produk</Text>
      <View style={styles.sideButton} />
    </View>
  );

  if (success) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <HeaderBar />
        <View style={styles.centerState}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark" size={36} color="#ffffff" />
          </View>
          <Text style={styles.successTitle}>Pertanyaan Terkirim</Text>
          {inquiryNumber && (
            <Text style={styles.centerStateText}>
              Nomor referensi: <Text style={styles.inquiryNumber}>{inquiryNumber}</Text>
            </Text>
          )}
          <Text style={styles.successNote}>
            Tim kami akan menghubungi Anda begitu produk ini tersedia di
            wilayah Anda.
          </Text>
          <Button
            label="Kembali ke Beranda"
            onPress={() => router.replace('/(tabs)' as never)}
            style={styles.successButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <HeaderBar />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle" size={20} color={colors.accent} />
          <Text style={styles.noticeText}>
            {product
              ? `${product} belum dijual secara resmi di Indonesia. Daftarkan minat Anda dan tim kami akan menghubungi begitu produk tersedia.`
              : 'Color Change Film dan Architectural Film belum dijual secara resmi di Indonesia. Daftarkan minat Anda dan tim kami akan menghubungi begitu produk tersedia.'}
          </Text>
        </View>

        {!!product && (
          <View style={styles.productBadge}>
            <Ionicons name="pricetag-outline" size={14} color={colors.accent} />
            <Text style={styles.productBadgeText}>Produk yang diminati: {product}</Text>
          </View>
        )}

        <View style={styles.formCard}>
          <Text style={styles.fieldLabel}>Nama Lengkap *</Text>
          <TextInput
            style={styles.input}
            placeholder="Nama Anda"
            placeholderTextColor={colors.textMuted}
            value={customerName}
            onChangeText={setCustomerName}
          />
          <Text style={styles.fieldLabel}>Nomor WhatsApp / Email *</Text>
          <TextInput
            style={styles.input}
            placeholder="08xxxxxxxxxx atau email Anda"
            placeholderTextColor={colors.textMuted}
            value={customerContact}
            onChangeText={setCustomerContact}
          />
          <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Mis. produk yang diminati, kota Anda, dsb."
            placeholderTextColor={colors.textMuted}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
          />
        </View>

        {submitError && (
          <View style={styles.submitErrorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.submitErrorText}>{submitError}</Text>
          </View>
        )}

        <Button
          label="Kirim Pertanyaan"
          onPress={handleSubmit}
          disabled={!isFormValid}
          loading={submitting}
          style={styles.submitButton}
        />
        {!isFormValid && (
          <Text style={styles.hintText}>Lengkapi nama dan kontak Anda.</Text>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: { flex: 1 },
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
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  productBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  productBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.accent,
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
  submitButton: {
    marginTop: spacing.sm,
  },
  hintText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
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
  inquiryNumber: {
    fontWeight: '800',
    color: colors.accent,
  },
  successNote: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  successButton: {
    marginTop: spacing.lg,
    width: '100%',
  },
  });
}
