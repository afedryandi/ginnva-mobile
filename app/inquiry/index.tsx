import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

// Halaman ini KHUSUS untuk produk yang belum dijual di Indonesia (Color
// Change Film & Architectural Film) — sengaja terpisah dari /quotation
// karena tidak butuh vehicle_id maupun daftar item produk, hanya kontak
// + catatan bebas. Memetakan langsung ke ProductInquiryController di
// backend (bukan QuotationController).
export default function ProductInquiryScreen() {
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
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

    apiFetch<{ success: boolean; message: string; data: { inquiry_number: string } }>(
      '/api/inquiry/submit',
      {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_contact: customerContact.trim(),
          message: message.trim() || undefined,
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

  if (success) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Tanya Produk" />
        <View style={styles.centerState}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark" size={36} color={colors.white} />
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Tanya Produk" />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle" size={20} color={colors.accent} />
          <Text style={styles.noticeText}>
            Color Change Film dan Architectural Film belum dijual secara resmi
            di Indonesia. Daftarkan minat Anda dan tim kami akan menghubungi
            begitu produk tersedia.
          </Text>
        </View>

        <Card style={styles.formCard}>
          <Text style={styles.fieldLabel}>Nama Lengkap *</Text>
          <TextInput
            style={styles.input}
            placeholder="Nama Anda"
            placeholderTextColor={colors.mutedLight}
            value={customerName}
            onChangeText={setCustomerName}
          />
          <Text style={styles.fieldLabel}>Nomor WhatsApp / Email *</Text>
          <TextInput
            style={styles.input}
            placeholder="08xxxxxxxxxx atau email Anda"
            placeholderTextColor={colors.mutedLight}
            value={customerContact}
            onChangeText={setCustomerContact}
          />
          <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Mis. produk yang diminati, kota Anda, dsb."
            placeholderTextColor={colors.mutedLight}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
          />
        </Card>

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
    color: colors.muted,
    textAlign: 'center',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.alt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 19,
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
  submitButton: {
    marginTop: spacing.sm,
  },
  hintText: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    textAlign: 'center',
    marginTop: spacing.sm,
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
  inquiryNumber: {
    fontWeight: '800',
    color: colors.accent,
  },
  successNote: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  successButton: {
    marginTop: spacing.lg,
    width: '100%',
  },
});
