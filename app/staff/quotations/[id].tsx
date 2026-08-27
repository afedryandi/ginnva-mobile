import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { toWhatsAppNumber } from '@/lib/phone';

interface QuotationDetail {
  id: number;
  quotation_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  license_plate: string | null;
  message: string | null;
  status: 'new' | 'contacted' | 'closed' | 'cancelled';
  source: 'customer' | 'staff';
  created_at: string;
  contacted_at: string | null;
  vehicle: { brand: string; model: string; variant: string | null } | null;
  store: { id: number; name: string } | null;
  items: { id: number; quantity: number; notes: string | null; film_product: { name: string } | null }[];
}

const STATUS_OPTIONS: { key: QuotationDetail['status']; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'closed', label: 'Closed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_META: Record<QuotationDetail['status'], { color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  new: { color: 'accent', bg: 'accentSoft' },
  contacted: { color: 'warning', bg: 'warningBg' },
  closed: { color: 'success', bg: 'successBg' },
  cancelled: { color: 'danger', bg: 'dangerBg' },
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function StaffQuotationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<QuotationDetail['status'] | null>(null);

  const load = useCallback(() => {
    setError(null);
    return staffApiFetch<{ data: QuotationDetail }>(`/api/staff/quotations/${id}`)
      .then((res) => setQuotation(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Gagal memuat detail lead.'));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const handleChangeStatus = useCallback((status: QuotationDetail['status']) => {
    if (!quotation || quotation.status === status) return;

    setUpdatingStatus(status);
    staffApiFetch<{ data: QuotationDetail }>(`/api/staff/quotations/${quotation.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
      .then((res) => setQuotation(res.data))
      .catch((err) => Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.'))
      .finally(() => setUpdatingStatus(null));
  }, [quotation]);

  const handleCall = () => {
    if (!quotation) return;
    Linking.openURL(`tel:${quotation.customer_phone.replace(/[^0-9+]/g, '')}`);
  };

  const handleWhatsApp = () => {
    if (!quotation) return;
    const text = encodeURIComponent(
      `Halo ${quotation.customer_name}, terima kasih sudah mengajukan permintaan penawaran ke Ginnva (No. Ref: ${quotation.quotation_number}). Kami ingin bantu jelaskan lebih lanjut soal produk yang diminati.`
    );
    Linking.openURL(`https://wa.me/${toWhatsAppNumber(quotation.customer_phone)}?text=${text}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Detail Lead</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error || !quotation ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error ?? 'Data tidak ditemukan.'}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.quotationNumber}>{quotation.quotation_number}</Text>
            <Text style={styles.customerName}>{quotation.customer_name}</Text>
            <Text style={styles.submittedAt}>Masuk {formatDate(quotation.created_at)} · {quotation.source === 'customer' ? 'Dari Customer' : 'Input Staff'}</Text>
            {quotation.contacted_at ? (
              <Text style={styles.slaOkText}>✓ Direspons {formatDate(quotation.contacted_at)}</Text>
            ) : new Date(quotation.created_at).getTime() < Date.now() - 24 * 60 * 60 * 1000 ? (
              <Text style={styles.slaWarnText}>⚠ Belum direspons, sudah lebih dari 24 jam</Text>
            ) : null}

            <View style={styles.contactRow}>
              <Pressable style={styles.contactButton} onPress={handleCall}>
                <Ionicons name="call-outline" size={18} color={colors.accent} />
                <Text style={styles.contactButtonText}>Telepon</Text>
              </Pressable>
              <Pressable style={[styles.contactButton, styles.contactButtonWa]} onPress={handleWhatsApp}>
                <Ionicons name="logo-whatsapp" size={18} color={colors.success} />
                <Text style={[styles.contactButtonText, { color: colors.success }]}>WhatsApp</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Ubah Status Follow-up</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map((opt) => {
              const active = quotation.status === opt.key;
              const meta = STATUS_META[opt.key];
              return (
                <Pressable
                  key={opt.key}
                  style={[
                    styles.statusChip,
                    active && { backgroundColor: colors[meta.bg], borderColor: colors[meta.color] },
                  ]}
                  onPress={() => handleChangeStatus(opt.key)}
                  disabled={updatingStatus !== null}
                >
                  {updatingStatus === opt.key ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Text style={[styles.statusChipText, active && { color: colors[meta.color], fontWeight: '700' }]}>
                      {opt.label}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Detail Kontak</Text>
          <View style={styles.card}>
            <InfoRow icon="call-outline" label="Telepon" value={quotation.customer_phone} colors={colors} styles={styles} />
            {quotation.customer_email ? (
              <InfoRow icon="mail-outline" label="Email" value={quotation.customer_email} colors={colors} styles={styles} />
            ) : null}
            {quotation.license_plate ? (
              <InfoRow icon="card-outline" label="Plat Nomor" value={quotation.license_plate} colors={colors} styles={styles} />
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>Kendaraan &amp; Toko</Text>
          <View style={styles.card}>
            <InfoRow
              icon="car-outline"
              label="Kendaraan"
              value={quotation.vehicle ? [quotation.vehicle.brand, quotation.vehicle.model, quotation.vehicle.variant].filter(Boolean).join(' ') : '—'}
              colors={colors}
              styles={styles}
            />
            <InfoRow icon="storefront-outline" label="Toko Tujuan" value={quotation.store?.name ?? '—'} colors={colors} styles={styles} />
          </View>

          <Text style={styles.sectionLabel}>Produk Diminati</Text>
          <View style={styles.card}>
            {quotation.items.length === 0 ? (
              <Text style={styles.emptyItemsText}>Tidak ada produk tercatat.</Text>
            ) : (
              quotation.items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Ionicons name="ellipse" size={6} color={colors.accent} style={{ marginTop: 6 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.film_product?.name ?? 'Produk tidak diketahui'} × {item.quantity}</Text>
                    {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
                  </View>
                </View>
              ))
            )}
          </View>

          {quotation.message ? (
            <>
              <Text style={styles.sectionLabel}>Catatan dari Customer</Text>
              <View style={styles.card}>
                <Text style={styles.messageText}>{quotation.message}</Text>
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, colors, styles }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  colors: typeof darkColors;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },
    errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.md,
    },
    quotationNumber: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
    customerName: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
    submittedAt: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
    slaOkText: { fontSize: fontSize.xs, color: colors.success, fontWeight: '600', marginTop: 4, marginBottom: spacing.xs },
    slaWarnText: { fontSize: fontSize.xs, color: colors.danger, fontWeight: '600', marginTop: 4, marginBottom: spacing.xs },
    contactRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    contactButton: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.accentSoft, borderRadius: radius.md, paddingVertical: spacing.sm,
    },
    contactButtonWa: { backgroundColor: colors.successBg },
    contactButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.accent },
    sectionLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.xs },
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    statusChip: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      minWidth: 76, alignItems: 'center',
    },
    statusChipText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600' },
    infoRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
    infoLabel: { fontSize: fontSize.xs, color: colors.textMuted },
    infoValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600', marginTop: 1 },
    itemRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
    itemName: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
    itemNotes: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
    emptyItemsText: { fontSize: fontSize.sm, color: colors.textMuted },
    messageText: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 20 },
  });
}
