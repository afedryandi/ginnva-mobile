import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError, API_BASE_URL, getToken } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticError } from '@/lib/haptics';

interface InvoiceItem {
  id: number;
  name: string;
  quantity: string;
  unit: string;
  price: string;
  discount_percent: string | null;
  total: string;
}

interface InvoiceDetail {
  id: number;
  invoice_number: string;
  store: { id: number; name: string } | null;
  issue_date: string;
  due_date: string | null;
  status: 'unpaid' | 'paid' | 'void';
  subtotal: string;
  transaction_discount_type: 'rp' | 'percent' | null;
  transaction_discount_value: string;
  shipping_cost: string;
  other_cost: string;
  total: string;
  amount_paid: string;
  notes: string | null;
  items: InvoiceItem[];
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const STATUS_META: Record<InvoiceDetail['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors; icon: IconName }> = {
  unpaid: { label: 'Belum Lunas', color: 'warning', bg: 'warningBg', icon: 'time-outline' },
  paid: { label: 'Lunas', color: 'success', bg: 'successBg', icon: 'checkmark-circle-outline' },
  void: { label: 'Void', color: 'danger', bg: 'dangerBg', icon: 'close-circle-outline' },
};

function formatRupiah(value: string | number): string {
  return 'Rp' + Math.round(Number(value)).toLocaleString('id-ID');
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Portal Invoice untuk customer — lihat catatan lengkap di index.tsx &
// Api\Customer\InvoiceController (backend). Unduh PDF pakai pola yang
// sama persis dengan warranty-detail.tsx (FileSystem.downloadAsync +
// Sharing.shareAsync, sudah terbukti jalan di sana).
//
// Tampilan didesain ulang (2026-11-24): kartu utama dengan total dan bar pembayaran, rincian dan ringkasan sebagai kartu lembut, dan
// tombol Unduh PDF tetap di dasar layar.
export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ data: InvoiceDetail }>(`/api/customer/invoices/${id}`)
      .then((res) => setInvoice(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Gagal memuat detail invoice.'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDownload = async () => {
    if (!invoice) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const token = await getToken();
      const fileUri = `${FileSystem.cacheDirectory}Invoice-${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
      const downloadRes = await FileSystem.downloadAsync(
        `${API_BASE_URL}/api/customer/invoices/${invoice.id}/download`,
        fileUri,
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );
      if (downloadRes.status !== 200) throw new Error('download_failed');

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(downloadRes.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Invoice ${invoice.invoice_number}`,
        });
      }
    } catch {
      hapticError();
      setDownloadError('Gagal mengunduh invoice. Periksa koneksi internetmu.');
    } finally {
      setDownloading(false);
    }
  };

  const total = invoice ? Number(invoice.total) : 0;
  const paid = invoice ? Number(invoice.amount_paid) : 0;
  const remaining = total - paid;
  const paidPercent = total > 0 ? Math.max(0, Math.min(100, Math.round((paid / total) * 100))) : 0;
  const meta = invoice ? STATUS_META[invoice.status] : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>Detail Invoice</Text>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error || !invoice || !meta ? (
        <View style={styles.centerState}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.errorText}>{error ?? 'Data tidak ditemukan.'}</Text>
          <PressableScale style={styles.primaryButton} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Kembali</Text>
          </PressableScale>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <FadeInUp>
              <View style={styles.hero}>
                <View style={styles.heroTop}>
                  <View style={[styles.statusPill, { backgroundColor: colors[meta.bg] }]}>
                    <Ionicons name={meta.icon} size={14} color={colors[meta.color]} />
                    <Text style={[styles.statusPillText, { color: colors[meta.color] }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.invoiceNumber} numberOfLines={1} selectable>{invoice.invoice_number}</Text>
                </View>

                <View>
                  <Text style={styles.heroLabel}>Total tagihan</Text>
                  <Text style={styles.heroAmount}>{formatRupiah(invoice.total)}</Text>
                </View>

                {/* Bar pembayaran: seberapa banyak yang sudah dibayar (tidak untuk invoice void). */}
                {invoice.status !== 'void' ? (
                  <View style={styles.payBox}>
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { width: `${paidPercent}%`, backgroundColor: invoice.status === 'paid' ? colors.success : colors.accent }]} />
                    </View>
                    <View style={styles.payRow}>
                      <View>
                        <Text style={styles.payLabel}>Sudah dibayar</Text>
                        <Text style={styles.payValue}>{formatRupiah(invoice.amount_paid)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.payLabel}>Sisa tagihan</Text>
                        <Text style={[styles.payValue, remaining > 0 && { color: colors.warning }]}>{formatRupiah(remaining)}</Text>
                      </View>
                    </View>
                  </View>
                ) : null}

                <View style={styles.metaList}>
                  <View style={styles.metaRow}>
                    <View style={styles.metaIcon}><Ionicons name="storefront-outline" size={16} color={colors.accent} /></View>
                    <Text style={styles.metaText}>{invoice.store?.name ?? 'Toko tidak diketahui'}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <View style={styles.metaIcon}><Ionicons name="calendar-outline" size={16} color={colors.accent} /></View>
                    <Text style={styles.metaText}>Diterbitkan {formatDate(invoice.issue_date)}</Text>
                  </View>
                  {invoice.due_date ? (
                    <View style={styles.metaRow}>
                      <View style={styles.metaIcon}><Ionicons name="time-outline" size={16} color={colors.accent} /></View>
                      <Text style={styles.metaText}>Jatuh tempo {formatDate(invoice.due_date)}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </FadeInUp>

            <Text style={styles.sectionLabel}>Rincian produk</Text>
            <View style={styles.card}>
              {invoice.items.map((item, i) => (
                <View key={item.id} style={[styles.itemRow, i > 0 && styles.divider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemSub}>
                      {item.quantity} {item.unit} × {formatRupiah(item.price)}
                      {Number(item.discount_percent) > 0 ? ` (disk. ${item.discount_percent}%)` : ''}
                    </Text>
                  </View>
                  <Text style={styles.itemTotal}>{formatRupiah(item.total)}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Ringkasan tagihan</Text>
            <View style={styles.card}>
              <SummaryRow label="Subtotal" value={formatRupiah(invoice.subtotal)} styles={styles} />
              {Number(invoice.transaction_discount_value) > 0 && (
                <SummaryRow
                  label={invoice.transaction_discount_type === 'percent' ? `Diskon (${invoice.transaction_discount_value}%)` : 'Diskon'}
                  value={`- ${formatRupiah(invoice.transaction_discount_type === 'percent'
                    ? (Number(invoice.subtotal) * Number(invoice.transaction_discount_value)) / 100
                    : invoice.transaction_discount_value)}`}
                  styles={styles}
                />
              )}
              {Number(invoice.shipping_cost) > 0 && <SummaryRow label="Ongkos Kirim" value={formatRupiah(invoice.shipping_cost)} styles={styles} />}
              {Number(invoice.other_cost) > 0 && <SummaryRow label="Biaya Lain" value={formatRupiah(invoice.other_cost)} styles={styles} />}
              <View style={styles.divider} />
              <SummaryRow label="Total Tagihan" value={formatRupiah(invoice.total)} bold styles={styles} />
              <SummaryRow label="Sudah Dibayar" value={formatRupiah(invoice.amount_paid)} styles={styles} />
              <SummaryRow
                label="Sisa Tagihan"
                value={formatRupiah(remaining)}
                bold
                warn={remaining > 0}
                styles={styles}
              />
            </View>

            {invoice.notes ? (
              <>
                <Text style={styles.sectionLabel}>Catatan</Text>
                <View style={styles.notes}>
                  <Ionicons name="chatbox-ellipses-outline" size={18} color={colors.accent} />
                  <Text style={styles.notesText}>{invoice.notes}</Text>
                </View>
              </>
            ) : null}
          </ScrollView>

          {/* Tombol unduh tetap di dasar. */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} pointerEvents="box-none">
            {downloadError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.errorBoxText}>{downloadError}</Text>
              </View>
            ) : null}
            <PressableScale style={[styles.downloadBtn, downloading && { opacity: 0.7 }]} onPress={handleDownload} disabled={downloading} accessibilityRole="button">
              {downloading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={20} color="#ffffff" />
                  <Text style={styles.downloadText}>Unduh PDF</Text>
                </>
              )}
            </PressableScale>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, bold, warn, styles }: {
  label: string;
  value: string;
  bold?: boolean;
  warn?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, bold && styles.summaryLabelBold]}>{label}</Text>
      <Text style={[styles.summaryValue, bold && styles.summaryValueBold, warn && styles.summaryValueWarn]}>{value}</Text>
    </View>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    errorText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    scrollContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 150 },

    hero: { gap: 18, padding: 20, borderRadius: 32, backgroundColor: colors.surfaceElevated },
    heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15 },
    statusPillText: { fontSize: 12, fontWeight: '800' },
    invoiceNumber: { flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textMuted },
    heroLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    heroAmount: { fontSize: 36, lineHeight: 44, fontWeight: '800', letterSpacing: -1, color: colors.textPrimary },

    payBox: { gap: 12, padding: 14, borderRadius: 20, backgroundColor: colors.bg },
    bar: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceElevated, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4 },
    payRow: { flexDirection: 'row', justifyContent: 'space-between' },
    payLabel: { fontSize: 12, color: colors.textMuted },
    payValue: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },

    metaList: { gap: 10 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    metaIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    metaText: { flex: 1, fontSize: 14, color: colors.textPrimary },

    sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted, marginTop: 26, marginBottom: 10, marginLeft: 6 },
    card: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginVertical: 4 },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 12, gap: 12 },
    itemName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    itemSub: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
    itemTotal: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },

    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 },
    summaryLabel: { fontSize: 14, color: colors.textSecondary },
    summaryLabelBold: { fontWeight: '800', color: colors.textPrimary },
    summaryValue: { fontSize: 14, color: colors.textSecondary },
    summaryValueBold: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    summaryValueWarn: { color: colors.warning },

    notes: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.accentSoft },
    notesText: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.textPrimary },

    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 12, gap: 10, backgroundColor: colors.bg },
    errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 16, backgroundColor: colors.dangerBg },
    errorBoxText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.danger },
    downloadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 58, borderRadius: 29, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 16, elevation: 6 },
    downloadText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  });
}
