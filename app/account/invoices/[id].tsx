import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
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

const STATUS_META: Record<InvoiceDetail['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  unpaid: { label: 'Belum Lunas', color: 'warning', bg: 'warningBg' },
  paid: { label: 'Lunas', color: 'success', bg: 'successBg' },
  void: { label: 'Void', color: 'danger', bg: 'dangerBg' },
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
export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
      setDownloadError('Gagal mengunduh invoice. Periksa koneksi internet Anda.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Detail Invoice</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error || !invoice ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error ?? 'Data tidak ditemukan.'}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
              <View style={[styles.statusBadge, { backgroundColor: colors[STATUS_META[invoice.status].bg] }]}>
                <Text style={[styles.statusBadgeText, { color: colors[STATUS_META[invoice.status].color] }]}>
                  {STATUS_META[invoice.status].label}
                </Text>
              </View>
            </View>
            <Text style={styles.subText}>{invoice.store?.name ?? 'Toko tidak diketahui'}</Text>
            <Text style={styles.subText}>
              Diterbitkan {formatDate(invoice.issue_date)}
              {invoice.due_date ? ` · Jatuh tempo ${formatDate(invoice.due_date)}` : ''}
            </Text>

            <Pressable style={styles.downloadBtn} onPress={handleDownload} disabled={downloading}>
              {downloading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={18} color="#ffffff" />
                  <Text style={styles.downloadText}>Unduh PDF</Text>
                </>
              )}
            </Pressable>
            {downloadError && <Text style={styles.downloadErrorText}>{downloadError}</Text>}
          </View>

          <Text style={styles.sectionLabel}>Rincian Produk</Text>
          <View style={styles.card}>
            {invoice.items.map((item, i) => (
              <View key={item.id} style={[styles.itemRow, i > 0 && styles.itemRowBorder]}>
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

          <Text style={styles.sectionLabel}>Ringkasan Tagihan</Text>
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
            <SummaryRow label="Total Tagihan" value={formatRupiah(invoice.total)} bold styles={styles} />
            <SummaryRow label="Sudah Dibayar" value={formatRupiah(invoice.amount_paid)} styles={styles} />
            <SummaryRow
              label="Sisa Tagihan"
              value={formatRupiah(Number(invoice.total) - Number(invoice.amount_paid))}
              bold
              warn={Number(invoice.total) - Number(invoice.amount_paid) > 0}
              styles={styles}
            />
          </View>

          {invoice.notes ? (
            <>
              <Text style={styles.sectionLabel}>Catatan</Text>
              <View style={styles.card}>
                <Text style={styles.notesText}>{invoice.notes}</Text>
              </View>
            </>
          ) : null}
        </ScrollView>
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
      padding: spacing.md, marginBottom: spacing.md, gap: 4,
    },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    invoiceNumber: { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary },
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
    statusBadgeText: { fontSize: fontSize.xs, fontWeight: '700' },
    subText: { fontSize: fontSize.xs, color: colors.textMuted },
    downloadBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, marginTop: spacing.sm,
    },
    downloadText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },
    downloadErrorText: { fontSize: fontSize.xs, color: colors.danger, marginTop: spacing.xs, textAlign: 'center' },
    sectionLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.xs },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: spacing.xs, gap: spacing.sm },
    itemRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    itemName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    itemSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
    itemTotal: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    summaryLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
    summaryLabelBold: { fontWeight: '700', color: colors.textPrimary },
    summaryValue: { fontSize: fontSize.sm, color: colors.textSecondary },
    summaryValueBold: { fontWeight: '700', color: colors.textPrimary },
    summaryValueWarn: { color: colors.warning },
    notesText: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 20 },
  });
}
