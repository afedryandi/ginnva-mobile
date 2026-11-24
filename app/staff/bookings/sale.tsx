import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput, Alert, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface SaleLine { service_type: string; film_product_id?: number | null; position: string | null; quantity: number; unit_price: number; discount_amount: number; line_total: number }
interface SalePayment { method: string; payment_account_id: number | null; amount: number }
interface SaleAccount { id: number; name: string; methods: string[] }
interface SaleState {
  booking: { id: number; booking_number: string; customer_name: string; status: string };
  processed: boolean;
  can_record: boolean;
  transaction_amount: number | null;
  amount_received: number | null;
  lines_required: boolean;
  down_payment_outstanding: number;
  sale_lines: SaleLine[];
  settlement_payments: SalePayment[];
  suggested_service_types: string[];
  service_types: Record<string, string>;
  // Pilihan produk (SKU) per baris, dipakai laporan Penjualan Produk; jenis di sku_required_types wajib memilih.
  products: SaleProduct[];
  suggested_product_id: number | null;
  sku_required_types: string[];
  methods: Record<string, string>;
  accounts: SaleAccount[];
}
interface SaleProduct { id: number; name: string; sku: string; service_type: string }
interface LineInput { service_type: string; film_product_id: number | null; price: string; discount: string }
interface PaymentInput { method: string; amount: string }

const digits = (text: string) => text.replace(/[^0-9]/g, '');
const num = (text: string) => Number(digits(text)) || 0;
const fmt = (n: number) => Math.round(n).toLocaleString('id-ID');
const rupiah = (n: number) => 'Rp' + fmt(n);

// Catat penjualan dan pembayaran booking selesai dari HP (Penjualan Fase 5). Aturan persetujuan ditentukan server: staf non-akses-penuh
// bisa masuk antrean persetujuan; layar ini hanya menampilkan hasilnya. Booking yang sudah diproses hanya dilihat.
export default function StaffBookingSaleScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();

  const [state, setState] = useState<SaleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LineInput[]>([]);
  const [payments, setPayments] = useState<PaymentInput[]>([{ method: 'tunai', amount: '' }]);
  const [nominal, setNominal] = useState('');
  const [referral, setReferral] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ data: SaleState }>(`/api/staff/bookings/${bookingId}/sale`);
      setState(res.data);
      if (res.data.can_record) {
        // Produk utama booking diisikan otomatis ke baris yang jenisnya cocok.
        setLines(res.data.suggested_service_types.map((key) => ({
          service_type: key,
          film_product_id: res.data.products.find((p) => p.id === res.data.suggested_product_id && p.service_type === key)?.id ?? null,
          price: '',
          discount: '',
        })));
      }
    } catch {
      setError('Gagal memuat data penjualan. Periksa koneksi internet atau hak akses akun ini.');
    }
  }, [bookingId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const linesTotal = lines.reduce((sum, l) => sum + Math.max(0, num(l.price) - num(l.discount)), 0);
  const paid = payments.reduce((sum, p) => sum + num(p.amount), 0);
  const dp = Math.min(state?.down_payment_outstanding ?? 0, num(nominal));
  const remaining = num(nominal) - paid - dp;

  const setLine = (i: number, patch: Partial<LineInput>) => setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const setPayment = (i: number, patch: Partial<PaymentInput>) => setPayments((cur) => cur.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const submit = useCallback(async () => {
    if (!state) return;
    if (num(nominal) <= 0) {
      Alert.alert('Nominal Wajib Diisi', 'Isi nominal transaksi (setelah potongan).');
      return;
    }
    if (state.lines_required && !lines.some((l) => num(l.price) > 0)) {
      Alert.alert('Rincian Harga Wajib', 'Isi harga minimal satu layanan.');
      return;
    }
    const missingSku = lines.find((l) => num(l.price) > 0 && state.sku_required_types.includes(l.service_type) && !l.film_product_id);
    if (missingSku) {
      Alert.alert('Produk Wajib Dipilih', `Pilih produk (SKU) untuk layanan ${state.service_types[missingSku.service_type] ?? missingSku.service_type}.`);
      return;
    }
    if (remaining < -0.5) {
      Alert.alert('Pembayaran Melebihi Nominal', 'Total pembayaran dan DP lebih besar dari nominal transaksi.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await staffApiFetch<{ status: 'posted' | 'pending'; message: string }>(`/api/staff/bookings/${bookingId}/sale`, {
        method: 'POST',
        body: JSON.stringify({
          transaction_amount: num(nominal),
          sale_lines: lines.filter((l) => num(l.price) > 0).map((l) => ({ service_type: l.service_type, film_product_id: l.film_product_id, quantity: 1, unit_price: num(l.price), discount_amount: num(l.discount) })),
          settlement_payments: payments.filter((p) => num(p.amount) > 0).map((p) => ({ method: p.method, amount: num(p.amount) })),
          referral_code: referral.trim() || null,
        }),
      });
      Alert.alert(res.status === 'pending' ? 'Menunggu Persetujuan' : 'Tersimpan', res.message, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [state, nominal, lines, payments, referral, remaining, bookingId]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Catat Penjualan</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}><ActivityIndicator color={colors.accent} /></View>
      ) : error || !state ? (
        <View style={styles.centerState}><Text style={styles.errorText}>{error ?? 'Data tidak tersedia.'}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.bookingTitle}>{state.booking.booking_number}</Text>
          <Text style={styles.hint}>{state.booking.customer_name}</Text>

          {!state.can_record ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                {state.processed
                  ? `Penjualan sudah dicatat: ${rupiah(state.transaction_amount ?? 0)}, diterima ${rupiah(state.amount_received ?? 0)}. Koreksi lewat panel admin, oleh yang punya akses.`
                  : 'Penjualan hanya bisa dicatat setelah booking ditandai selesai.'}
              </Text>
              {state.sale_lines.map((l, i) => (
                <Text key={i} style={styles.hint}>{state.service_types[l.service_type] ?? l.service_type}: {rupiah(l.line_total)}</Text>
              ))}
              {state.settlement_payments.map((p, i) => (
                <Text key={`p${i}`} style={styles.hint}>{state.methods[p.method] ?? p.method}: {rupiah(p.amount)}</Text>
              ))}
            </View>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Rincian Harga</Text>
              {state.lines_required ? <Text style={styles.hint}>Wajib diisi untuk booking ini.</Text> : null}
              {lines.map((l, i) => (
                <View key={i} style={styles.card}>
                  <View style={styles.chipRow}>
                    {Object.entries(state.service_types).map(([key, label]) => (
                      <Pressable key={key} style={[styles.chip, l.service_type === key && styles.chipActive]} onPress={() => setLine(i, { service_type: key, film_product_id: l.service_type === key ? l.film_product_id : null })}>
                        <Text style={[styles.chipText, l.service_type === key && styles.chipTextActive]}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {state.products.some((p) => p.service_type === l.service_type) ? (
                    <>
                      <Text style={styles.fieldLabel}>Produk (SKU){state.sku_required_types.includes(l.service_type) ? ' *' : ' (opsional)'}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.chipRow}>
                          {state.products.filter((p) => p.service_type === l.service_type).map((p) => (
                            <Pressable key={p.id} style={[styles.chip, l.film_product_id === p.id && styles.chipActive]} onPress={() => setLine(i, { film_product_id: l.film_product_id === p.id ? null : p.id })}>
                              <Text style={[styles.chipText, l.film_product_id === p.id && styles.chipTextActive]}>{p.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    </>
                  ) : null}
                  <Text style={styles.fieldLabel}>Harga</Text>
                  <TextInput style={styles.input} value={l.price === '' ? '' : fmt(num(l.price))} onChangeText={(t) => setLine(i, { price: digits(t) })} placeholder="0" placeholderTextColor={colors.textMuted} keyboardType="number-pad" />
                  <Text style={styles.fieldLabel}>Potongan baris (opsional)</Text>
                  <TextInput style={styles.input} value={l.discount === '' ? '' : fmt(num(l.discount))} onChangeText={(t) => setLine(i, { discount: digits(t) })} placeholder="0" placeholderTextColor={colors.textMuted} keyboardType="number-pad" />
                  {lines.length > 1 ? (
                    <Pressable onPress={() => setLines((cur) => cur.filter((_, idx) => idx !== i))}><Text style={styles.removeText}>Hapus baris</Text></Pressable>
                  ) : null}
                </View>
              ))}
              <Pressable onPress={() => setLines((cur) => [...cur, { service_type: Object.keys(state.service_types)[0], film_product_id: null, price: '', discount: '' }])}>
                <Text style={styles.addText}>+ Tambah layanan</Text>
              </Pressable>
              <Text style={styles.hint}>Jumlah rincian: {rupiah(linesTotal)}</Text>

              <Text style={styles.sectionTitle}>Nominal Transaksi</Text>
              <Text style={styles.hint}>Angka bersih setelah voucher, promo, atau nego.</Text>
              <TextInput style={styles.input} value={nominal === '' ? '' : fmt(num(nominal))} onChangeText={(t) => setNominal(digits(t))} placeholder="0" placeholderTextColor={colors.textMuted} keyboardType="number-pad" />

              <Text style={styles.sectionTitle}>Pembayaran Diterima</Text>
              {state.down_payment_outstanding > 0 ? <Text style={styles.hint}>DP {rupiah(state.down_payment_outstanding)} otomatis dipotongkan.</Text> : null}
              {payments.map((p, i) => (
                <View key={i} style={styles.card}>
                  <View style={styles.chipRow}>
                    {Object.entries(state.methods).map(([key, label]) => (
                      <Pressable key={key} style={[styles.chip, p.method === key && styles.chipActive]} onPress={() => setPayment(i, { method: key })}>
                        <Text style={[styles.chipText, p.method === key && styles.chipTextActive]}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.fieldLabel}>Nominal</Text>
                  <TextInput style={styles.input} value={p.amount === '' ? '' : fmt(num(p.amount))} onChangeText={(t) => setPayment(i, { amount: digits(t) })} placeholder="0" placeholderTextColor={colors.textMuted} keyboardType="number-pad" />
                  {payments.length > 1 ? (
                    <Pressable onPress={() => setPayments((cur) => cur.filter((_, idx) => idx !== i))}><Text style={styles.removeText}>Hapus pembayaran</Text></Pressable>
                  ) : null}
                </View>
              ))}
              <Pressable onPress={() => setPayments((cur) => [...cur, { method: 'transfer', amount: '' }])}>
                <Text style={styles.addText}>+ Tambah pembayaran</Text>
              </Pressable>

              <View style={styles.summary}>
                <Text style={styles.summaryText}>Diterima {rupiah(paid)}{dp > 0 ? ` + DP ${rupiah(dp)}` : ''}</Text>
                <Text style={[styles.summaryText, remaining < -0.5 && { color: colors.danger }]}>
                  {num(nominal) <= 0 ? 'Isi nominal transaksi' : remaining > 0.5 ? `Sisa ${rupiah(remaining)} dicatat sebagai sisa tagihan (belum lunas)` : remaining < -0.5 ? 'Melebihi nominal transaksi' : 'Lunas'}
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Kode referral partner (opsional)</Text>
              <TextInput style={styles.input} value={referral} onChangeText={setReferral} placeholder="Kode referral" placeholderTextColor={colors.textMuted} autoCapitalize="characters" maxLength={20} />

              <Button label="Simpan Penjualan" onPress={submit} loading={submitting} style={styles.submit} />
            </>
          )}
        </ScrollView>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    errorText: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
    bookingTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
    hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
    infoBox: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md, gap: 2 },
    infoText: { fontSize: fontSize.sm, color: colors.textPrimary },
    sectionTitle: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginTop: spacing.xl, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
    chipTextActive: { color: '#ffffff' },
    fieldLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs },
    input: {
      backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.base, color: colors.textPrimary, minHeight: 48,
    },
    removeText: { color: colors.danger, fontSize: fontSize.xs, fontWeight: '600', marginTop: spacing.sm },
    addText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '700', marginTop: spacing.sm },
    summary: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 2 },
    summaryText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    submit: { marginTop: spacing.lg },
  });
}
