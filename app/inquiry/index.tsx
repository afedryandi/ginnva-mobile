import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthField } from '@/components/auth/AuthShell';
import { AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { getLeadAttribution, LeadAttribution } from '@/lib/lead-attribution';

// Halaman ini KHUSUS untuk produk yang belum dijual di Indonesia (Color
// Change Film & Architectural Film) — sengaja terpisah dari /quotation
// karena tidak butuh vehicle_id maupun daftar item produk, hanya kontak
// + catatan bebas. Memetakan langsung ke ProductInquiryController di
// backend (bukan QuotationController).
export default function ProductInquiryScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Dikirim dari CTA "Daftarkan Minat Saya" di halaman detail produk
  // (app/products/[category].tsx). Nama produk ditampilkan sebagai kartu
  // read-only dan digabung ke pesan final saat submit (handleSubmit).
  const { product } = useLocalSearchParams<{ product?: string }>();

  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [inquiryNumber, setInquiryNumber] = useState<string | null>(null);

  const isFormValid = customerName.trim().length > 0 && customerContact.trim().length > 0;

  const [attribution, setAttribution] = useState<LeadAttribution | undefined>(undefined);
  useEffect(() => {
    getLeadAttribution().then(setAttribution);
  }, []);

  const handleSubmit = () => {
    if (!isFormValid) return;

    setSubmitting(true);
    setSubmitError(null);

    // Info produk (kalau ada) SELALU disertakan di pesan yang dikirim,
    // terlepas apa pun yang diketik/dihapus customer di field Catatan.
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
          attribution,
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
            : 'Gagal mengirim. Periksa koneksi internetmu dan coba lagi.'
        );
      })
      .finally(() => setSubmitting(false));
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

  if (success) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        {glow}
        <View style={styles.topRow}>{backButton}</View>
        <View style={styles.centerState}>
          <View style={styles.successRing}>
            <View style={styles.successIconWrap}>
              <Ionicons name="checkmark" size={38} color="#ffffff" />
            </View>
          </View>
          <Text style={styles.successTitle}>Pertanyaan Terkirim</Text>
          <Text style={styles.successNote}>
            Tim kami akan menghubungimu begitu produk ini tersedia di wilayahmu.
          </Text>
          {inquiryNumber ? (
            <View style={styles.refCard}>
              <Text style={styles.refLabel}>Nomor referensi</Text>
              <Text style={styles.inquiryNumber} selectable>{inquiryNumber}</Text>
            </View>
          ) : null}
          <PressableScale style={styles.primaryButton} onPress={() => router.replace('/(tabs)' as never)} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Kembali ke Beranda</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      {glow}
      <View style={styles.topRow}>{backButton}</View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Tanya Produk</Text>
          <Text style={styles.subtitle}>
            {product
              ? `${product} belum dijual secara resmi di Indonesia. Daftarkan minatmu dan tim kami akan menghubungi begitu produk tersedia.`
              : 'Color Change Film dan Architectural Film belum dijual secara resmi di Indonesia. Daftarkan minatmu dan tim kami akan menghubungi begitu produk tersedia.'}
          </Text>

          {!!product && (
            <View style={styles.productCard}>
              <View style={styles.productIcon}>
                <Ionicons name="pricetag-outline" size={20} color={colors.accent} />
              </View>
              <View style={styles.productTextWrap}>
                <Text style={styles.productHint}>Produk yang diminati</Text>
                <Text style={styles.productName} numberOfLines={2}>{product}</Text>
              </View>
            </View>
          )}

          <View style={styles.stack}>
            <AuthField label="Nama Lengkap *" icon="person-outline">
              {(input) => (
                <TextInput {...input} placeholder="Namamu" placeholderTextColor={colors.textMuted} value={customerName} onChangeText={setCustomerName} />
              )}
            </AuthField>
            <AuthField label="Nomor WhatsApp / Email *" icon="chatbubble-ellipses-outline">
              {(input) => (
                <TextInput
                  {...input}
                  placeholder="08xxxxxxxxxx atau emailmu"
                  placeholderTextColor={colors.textMuted}
                  value={customerContact}
                  onChangeText={setCustomerContact}
                  autoCapitalize="none"
                />
              )}
            </AuthField>
            <AuthField label="Catatan (opsional)" icon="create-outline" multiline>
              {(input) => (
                <TextInput
                  {...input}
                  style={input.style}
                  placeholder="Mis. produk yang diminati, kotamu, dsb."
                  placeholderTextColor={colors.textMuted}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                />
              )}
            </AuthField>
          </View>

          {submitError && (
            <View style={styles.submitErrorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.submitErrorText}>{submitError}</Text>
            </View>
          )}

          <PressableScale
            style={[styles.primaryButton, (!isFormValid || submitting) && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!isFormValid || submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Kirim Pertanyaan</Text>
                <Ionicons name="paper-plane-outline" size={18} color="#ffffff" />
              </>
            )}
          </PressableScale>
          {!isFormValid && <Text style={styles.hintText}>Lengkapi nama dan kontakmu.</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    backSpacer: { width: 44, height: 44 },

    scrollContent: { paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: 48, gap: 14 },
    title: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginBottom: 4 },
    stack: { gap: 14 },

    productCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    productIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    productTextWrap: { flex: 1, gap: 2 },
    productHint: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
    productName: { fontSize: 16, lineHeight: 21, fontWeight: '800', color: colors.textPrimary },

    textArea: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },

    submitErrorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 20, backgroundColor: colors.dangerBg },
    submitErrorText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.danger },

    primaryButton: { flexDirection: 'row', gap: 8, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, alignSelf: 'stretch', marginTop: 6 },
    primaryButtonText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
    buttonDisabled: { opacity: 0.4 },
    hintText: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24, paddingBottom: 48 },
    successRing: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, marginBottom: 6 },
    successIconWrap: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    successTitle: { fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary, textAlign: 'center' },
    successNote: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    refCard: { alignSelf: 'stretch', alignItems: 'center', gap: 4, paddingVertical: 18, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    refLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
    inquiryNumber: { fontSize: 22, fontWeight: '800', letterSpacing: 0.5, color: colors.accent },
  });
}
