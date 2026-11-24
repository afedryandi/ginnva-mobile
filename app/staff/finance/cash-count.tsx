import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput, Alert, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface CountAccount {
  id: number;
  name: string;
  kind: string;
  store_name: string | null;
  counted_today: boolean;
}

interface CountRecord {
  id: number;
  account: string | null;
  date: string;
  counted_amount: number;
  system_balance: number;
  difference: number;
  notes: string | null;
  adjusted: boolean;
}

function rupiah(amount: number): string {
  return (amount < 0 ? '-' : '') + 'Rp' + Math.round(Math.abs(amount)).toLocaleString('id-ID');
}

// Hitung kas harian (Keuangan Fase 5). Saldo sistem SENGAJA tidak ditampilkan sebelum menghitung supaya hasil hitung jujur; selisih
// baru terlihat setelah dikirim.
export default function StaffCashCountScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [accounts, setAccounts] = useState<CountAccount[]>([]);
  const [counts, setCounts] = useState<CountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ accounts: CountAccount[]; counts: CountRecord[] }>('/api/staff/finance/cash-counts');
      setAccounts(res.accounts);
      setCounts(res.counts);
      setAccountId((current) => current ?? res.accounts.find((a) => !a.counted_today)?.id ?? res.accounts[0]?.id ?? null);
    } catch {
      setError('Gagal memuat data. Periksa koneksi internet atau hak akses akun ini.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const numericAmount = Number(amount.replace(/[^0-9]/g, ''));
  const selected = accounts.find((a) => a.id === accountId) ?? null;

  const submit = useCallback(async () => {
    if (!accountId) {
      Alert.alert('Pilih Kas', 'Pilih kas yang dihitung.');
      return;
    }
    if (amount.trim() === '') {
      Alert.alert('Nominal Wajib Diisi', 'Isi jumlah uang yang dihitung (isi 0 kalau kosong).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await staffApiFetch<{ count: { system_balance: number; difference: number } }>('/api/staff/finance/cash-counts', {
        method: 'POST',
        body: JSON.stringify({ payment_account_id: accountId, counted_amount: numericAmount, notes: notes.trim() || null }),
      });
      const diff = res.count.difference;
      Alert.alert(
        diff === 0 ? 'Kas Cocok' : 'Ada Selisih',
        diff === 0 ? 'Hitungan sama dengan saldo sistem.' : `Selisih ${rupiah(diff)} terhadap saldo sistem ${rupiah(res.count.system_balance)}. Catatan sudah dikirim ke keuangan.`
      );
      setAmount('');
      setNotes('');
      await load();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [accountId, amount, numericAmount, notes, load]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Hitung Kas</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {accounts.length === 0 ? (
            <Text style={styles.hint}>Belum ada kas untuk toko ini.</Text>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Kas yang dihitung</Text>
              <View style={styles.chipRow}>
                {accounts.map((a) => (
                  <Pressable key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
                    <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>
                      {a.name}{a.counted_today ? ' ✓' : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {selected?.counted_today ? <Text style={styles.hint}>Kas ini sudah dihitung hari ini.</Text> : null}

              <Text style={styles.fieldLabel}>Uang yang dihitung di laci</Text>
              <TextInput
                style={styles.input}
                value={amount.trim() === '' ? '' : numericAmount.toLocaleString('id-ID')}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />

              <Text style={styles.fieldLabel}>Catatan</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Wajib kalau ada selisih: jelaskan kemungkinan penyebabnya"
                placeholderTextColor={colors.textMuted}
                multiline
              />

              <Button label="Kirim Hitungan" onPress={submit} loading={submitting} disabled={selected?.counted_today} style={styles.submit} />
            </>
          )}

          <Text style={styles.sectionTitle}>Riwayat Hitungan</Text>
          {counts.length === 0 ? (
            <Text style={styles.hint}>Belum ada hitungan.</Text>
          ) : (
            counts.map((c) => (
              <View key={c.id} style={styles.item}>
                <View style={styles.itemTop}>
                  <Text style={styles.itemTitle}>{c.account ?? '—'}</Text>
                  <Text style={[styles.itemDiff, c.difference === 0 ? { color: colors.success } : { color: colors.danger }]}>
                    {c.difference === 0 ? 'Cocok' : `Selisih ${rupiah(c.difference)}`}
                  </Text>
                </View>
                <Text style={styles.itemMeta}>{c.date} · dihitung {rupiah(c.counted_amount)} · sistem {rupiah(c.system_balance)}</Text>
                {c.notes ? <Text style={styles.itemMeta}>{c.notes}</Text> : null}
              </View>
            ))
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
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    content: { padding: spacing.md, paddingBottom: spacing.xxl },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    fieldLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
    chipTextActive: { color: '#ffffff' },
    hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
    input: {
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.base, color: colors.textPrimary, minHeight: 48,
    },
    textArea: { minHeight: 80, textAlignVertical: 'top' },
    submit: { marginTop: spacing.lg },
    sectionTitle: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginTop: spacing.xl, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
    item: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: 2 },
    itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    itemTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, flex: 1 },
    itemDiff: { fontSize: fontSize.xs, fontWeight: '700' },
    itemMeta: { fontSize: fontSize.xs, color: colors.textMuted },
  });
}
