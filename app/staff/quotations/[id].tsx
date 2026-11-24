import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { toWhatsAppNumber } from '@/lib/phone';
import LeadOutcomePanel from '@/components/LeadOutcomePanel';

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
  owner_user_id: number | null;
  owner?: { id: number; name: string } | null;
  outcome: 'won' | 'lost' | null;
  outcome_reason: string | null;
  vehicle: { brand: string; model: string; variant: string | null } | null;
  store: { id: number; name: string } | null;
  items: { id: number; quantity: number; notes: string | null; film_product: { name: string } | null }[];
}

type Status = QuotationDetail['status'];

// Dari aplikasi hanya New <-> Contacted yang bisa diubah (keputusan 2026-11-13); Closed/Cancelled lewat panel web.
const STATUS_OPTIONS: { key: 'new' | 'contacted'; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
];

const STATUS_LABEL: Record<Status, string> = { new: 'New', contacted: 'Contacted', closed: 'Closed', cancelled: 'Cancelled' };

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Tampilan dirancang ulang 2026-11-13, selaras dengan layar Lead dan SPK: judul besar, kartu putih, tombol hubungi berbentuk pil, status
// berbentuk segmen, dan info dikelompokkan dalam satu kartu dengan garis tipis.
export default function StaffQuotationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<Status | null>(null);

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

  const handleChangeStatus = useCallback((status: Status) => {
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
      `Halo ${quotation.customer_name}, terima kasih sudah mengajukan permintaan penawaran ke Ginnva (No. Ref: ${quotation.quotation_number}). Kami ingin bantu jelaskan lebih lanjut soal produk yang diminati.`,
    );
    Linking.openURL(`https://wa.me/${toWhatsAppNumber(quotation.customer_phone)}?text=${text}`);
  };

  const statusTone = (s: Status) => {
    if (s === 'new') return { bg: colors.accentSoft, fg: isDark ? '#ff6b8f' : '#cc1042' };
    if (s === 'contacted') return { bg: colors.warningBg, fg: colors.warning };
    if (s === 'closed') return { bg: colors.successBg, fg: colors.success };
    return { bg: colors.dangerBg, fg: colors.danger };
  };

  const overdue = !!quotation && !quotation.contacted_at && new Date(quotation.created_at).getTime() < Date.now() - 24 * 60 * 60 * 1000;
  const vehicleLabel = quotation?.vehicle ? [quotation.vehicle.brand, quotation.vehicle.model, quotation.vehicle.variant].filter(Boolean).join(' ') : '—';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>Detail Lead</Text>
          {quotation ? <Text style={styles.subtitle} numberOfLines={1}>{quotation.quotation_number}</Text> : null}
        </View>
        {quotation ? (
          <View style={[styles.statusPill, { backgroundColor: statusTone(quotation.status).bg }]}>
            <Text style={[styles.statusPillText, { color: statusTone(quotation.status).fg }]}>{STATUS_LABEL[quotation.status]}</Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <SkeletonCards count={3} />
      ) : error || !quotation ? (
        <View style={styles.centerState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="cloud-offline-outline" size={34} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Lead tidak bisa dibuka</Text>
          <Text style={styles.errorText}>{error ?? 'Data tidak ditemukan.'}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
<FadeInUp>
          {/* Hero: siapa, kapan masuk, sudah direspons atau belum, dan dua tombol hubungi. */}
          <View style={styles.card}>
            <View style={styles.sourceBadge}>
              <Ionicons name={quotation.source === 'customer' ? 'person-outline' : 'create-outline'} size={13} color={colors.textSecondary} />
              <Text style={styles.sourceBadgeText}>{quotation.source === 'customer' ? 'Dari pelanggan' : 'Input staff'}</Text>
            </View>
            <Text style={styles.customerName}>{quotation.customer_name}</Text>
            <Text style={styles.submittedAt}>Masuk {formatDate(quotation.created_at)}</Text>

            {quotation.contacted_at ? (
              <View style={[styles.slaChip, { backgroundColor: colors.successBg }]}>
                <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                <Text style={[styles.slaText, { color: colors.success }]}>Direspons {formatDate(quotation.contacted_at)}</Text>
              </View>
            ) : overdue ? (
              <View style={[styles.slaChip, { backgroundColor: colors.dangerBg }]}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={[styles.slaText, { color: colors.danger }]}>Belum direspons, sudah lebih dari 24 jam</Text>
              </View>
            ) : null}

            <View style={styles.contactRow}>
              <PressableScale style={styles.contactButton} onPress={handleCall} accessibilityRole="button" accessibilityLabel="Telepon pelanggan">
                <Ionicons name="call" size={18} color="#ffffff" />
                <Text style={styles.contactButtonText}>Telepon</Text>
              </PressableScale>
              <PressableScale style={[styles.contactButton, styles.contactButtonWa]} onPress={handleWhatsApp} accessibilityRole="button" accessibilityLabel="Hubungi lewat WhatsApp">
                <Ionicons name="logo-whatsapp" size={19} color="#ffffff" />
                <Text style={styles.contactButtonText}>WhatsApp</Text>
              </PressableScale>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Status follow-up</Text>
          <View style={styles.segment}>
            {STATUS_OPTIONS.map((opt) => {
              const active = quotation.status === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                  onPress={() => handleChangeStatus(opt.key)}
                  disabled={updatingStatus !== null}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  {updatingStatus === opt.key ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
          {quotation.status === 'closed' || quotation.status === 'cancelled' ? (
            <Text style={styles.hint}>Status saat ini {STATUS_LABEL[quotation.status]}. Perubahannya lewat panel web.</Text>
          ) : null}

          <Text style={styles.sectionLabel}>Penanggung jawab &amp; hasil</Text>
          <LeadOutcomePanel
            key={`${quotation.id}-${quotation.outcome}-${quotation.owner_user_id}`}
            endpoint={`/api/staff/quotations/${quotation.id}/lead`}
            lead={quotation}
            onSaved={(lead) => setQuotation((prev) => (prev ? { ...prev, ...lead } : prev))}
          />

          <Text style={styles.sectionLabel}>Kontak dan kendaraan</Text>
          <View style={styles.card}>
            <InfoRow icon="call-outline" label="Telepon" value={quotation.customer_phone} styles={styles} colors={colors} />
            {quotation.customer_email ? <InfoRow icon="mail-outline" label="Email" value={quotation.customer_email} styles={styles} colors={colors} /> : null}
            <InfoRow icon="car-outline" label="Kendaraan" value={vehicleLabel} styles={styles} colors={colors} />
            {quotation.license_plate ? <InfoRow icon="card-outline" label="Plat nomor" value={quotation.license_plate} styles={styles} colors={colors} /> : null}
            <InfoRow icon="storefront-outline" label="Toko tujuan" value={quotation.store?.name ?? '—'} styles={styles} colors={colors} last />
          </View>

          <Text style={styles.sectionLabel}>Produk diminati</Text>
          <View style={styles.card}>
            {/* Pengaman: kalau respons API suatu saat lupa eager-load items (bug updateStatus 2026-08-27), layar tampil kosong, bukan crash. */}
            {(quotation.items ?? []).length === 0 ? (
              <Text style={styles.emptyItemsText}>Tidak ada produk tercatat.</Text>
            ) : (
              quotation.items.map((item, index) => (
                <View key={item.id} style={[styles.itemRow, index > 0 && styles.itemRowDivider]}>
                  <View style={styles.itemIcon}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.film_product?.name ?? 'Produk tidak diketahui'}</Text>
                    {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
                  </View>
                  <Text style={styles.itemQty}>×{item.quantity}</Text>
                </View>
              ))
            )}
          </View>

          {quotation.message ? (
            <>
              <Text style={styles.sectionLabel}>Catatan dari pelanggan</Text>
              <View style={styles.card}>
                <Text style={styles.messageText}>{quotation.message}</Text>
              </View>
            </>
          ) : null}
        </FadeInUp>
</ScrollView>
      )}
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, styles, colors, last }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  colors: typeof darkColors;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowDivider]}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={17} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
    statusPillText: { fontSize: 12.5, fontWeight: '800' },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    errorText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },

    scrollContent: { paddingHorizontal: 20, paddingBottom: spacing.xxl },
    card: { padding: 18, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2, color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: 4 },
    hint: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted, marginTop: spacing.sm, marginLeft: 4 },

    sourceBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: chip, marginBottom: spacing.sm },
    sourceBadgeText: { fontSize: 11.5, fontWeight: '700', color: colors.textSecondary },
    customerName: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    submittedAt: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginTop: 4 },
    slaChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, marginTop: spacing.md },
    slaText: { fontSize: 12.5, fontWeight: '700' },
    contactRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    contactButton: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 3,
    },
    contactButtonWa: { backgroundColor: '#25a244', shadowColor: '#25a244' },
    contactButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: '#ffffff' },

    segment: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: chip },
    segmentItem: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
    segmentItemActive: { backgroundColor: card, ...shadow },
    segmentText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    segmentTextActive: { color: colors.textPrimary },

    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: 12 },
    infoRowDivider: { borderBottomWidth: 1, borderBottomColor: line },
    infoIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    infoLabel: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
    infoValue: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, marginTop: 1 },

    itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: 10 },
    itemRowDivider: { borderTopWidth: 1, borderTopColor: line },
    itemIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    itemName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    itemNotes: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    itemQty: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    emptyItemsText: { fontSize: fontSize.sm, color: colors.textMuted },
    messageText: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 22 },
  });
}
