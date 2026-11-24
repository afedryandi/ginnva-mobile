import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';

/**
 * Pilihan booking untuk ditautkan ke memo (opsional). Daftar datang dari server dan sudah dibatasi: hanya booking toko memo,
 * yang belum selesai/dibatalkan, dan yang belum punya memo. Tampil inline (bukan modal) supaya aman dipakai di dalam modal lain.
 */
export interface BookingOption {
  id: number;
  booking_number: string;
  customer_name: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_plate?: string | null;
  status?: string;
}

interface Props {
  value: { id: number; booking_number: string; customer_name: string | null } | null;
  onChange: (booking: BookingOption | null) => void;
  /** Toko memo: wajib untuk akun akses penuh (akun lain otomatis toko sendiri). */
  storeId?: number | null;
  /** Akses penuh harus memilih toko dulu sebelum booking bisa dicari. */
  requireStore?: boolean;
  /** Endpoint daftar booking; bawaan untuk memo. Pengajuan Lembur memakai daftar booking tokonya sendiri. */
  endpoint?: string;
  colors: typeof darkColors;
}

const STATUS_LABEL: Record<string, string> = { pending: 'Menunggu', confirmed: 'Dikonfirmasi' };

export default function BookingPicker({ value, onChange, storeId, requireStore, endpoint = '/api/staff/memos/bookings', colors }: Props) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<BookingOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    if (!open || (requireStore && !storeId)) return;
    const timeout = setTimeout(() => {
      const requestId = ++latest.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (storeId) params.set('store_id', String(storeId));
      staffApiFetch<{ data: BookingOption[] }>(`${endpoint}?${params.toString()}`)
        .then((res) => {
          if (requestId === latest.current) setResults(res.data ?? []);
        })
        .catch(() => {
          if (requestId === latest.current) setError('Gagal memuat daftar booking.');
        })
        .finally(() => {
          if (requestId === latest.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(timeout);
  }, [open, search, storeId, requireStore]);

  const label = value ? `${value.booking_number}${value.customer_name ? ` — ${value.customer_name}` : ''}` : 'Pilih booking (opsional)';

  return (
    <View>
      <Pressable style={styles.field} onPress={() => setOpen((o) => !o)}>
        <Ionicons name="link-outline" size={18} color={colors.textMuted} />
        <Text style={[styles.fieldText, !value && { color: colors.textMuted }]} numberOfLines={1}>{label}</Text>
        {value ? (
          <Pressable hitSlop={10} onPress={() => { onChange(null); setOpen(false); }}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        )}
      </Pressable>

      {open && (
        <View style={styles.panel}>
          {requireStore && !storeId ? (
            <Text style={styles.hint}>Pilih toko dulu untuk melihat booking-nya.</Text>
          ) : (
            <>
              <TextInput
                style={styles.search}
                placeholder="Cari no booking, pelanggan, atau plat..."
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
              {loading ? (
                <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.sm }} />
              ) : error ? (
                <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>
              ) : results.length === 0 ? (
                <Text style={styles.hint}>Tidak ada booking yang cocok (hanya booking toko ini yang belum selesai dan belum bermemo).</Text>
              ) : (
                // Daftar dibatasi tingginya dan bisa digulir sendiri. Tanpa batas, puluhan booking membuat panel setinggi layar di dalam modal
                // dan baris-barisnya terhimpit sampai teksnya tidak terlihat (hanya garis pemisah).
                <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
                {results.map((b) => (
                  <Pressable
                    key={b.id}
                    style={styles.row}
                    onPress={() => {
                      onChange(b);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{b.booking_number}{b.customer_name ? ` — ${b.customer_name}` : ''}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {[[b.vehicle_brand, b.vehicle_model].filter(Boolean).join(' '), b.vehicle_plate].filter(Boolean).join(' · ') || 'Tanpa info kendaraan'}
                        {b.status ? ` · ${STATUS_LABEL[b.status] ?? b.status}` : ''}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    fieldText: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    panel: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      padding: spacing.sm,
      marginBottom: spacing.sm,
      gap: spacing.xs,
    },
    search: {
      height: 40,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
    },
    hint: { fontSize: fontSize.xs, color: colors.textMuted, paddingVertical: spacing.xs },
    list: { maxHeight: 240, flexGrow: 0 },
    row: { flexShrink: 0, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    rowTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    rowMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  });
}
