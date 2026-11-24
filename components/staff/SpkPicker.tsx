import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';

/**
 * Kolom Nomor SPK untuk memo barang (alur Booking -> SPK -> Memo): satu kolom dengan dua cara isi. Sisi kiri adalah ketikan manual (nomor SPK
 * bebas, untuk memo tanpa SPK terdaftar); tanda panah di sisi kanan membuka daftar SPK toko memo yang bisa dicari. Memilih SPK mengisi nomornya
 * dan menautkan memo ke SPK itu; mengetik nomor yang berbeda sesudahnya melepas tautan. Daftar tampil inline (bukan modal), polanya sama dengan
 * BookingPicker.
 */
export interface SpkOption {
  id: number;
  spk_number: string;
  customer_name: string | null;
  vehicle_brand?: string | null;
  vehicle_plate?: string | null;
  booking_id?: number | null;
  checked_out_at?: string | null;
}

interface Props {
  /** Isi kolom (nomor SPK): ketikan manual atau hasil memilih SPK. */
  number: string;
  onChangeNumber: (text: string) => void;
  /** SPK terdaftar yang sedang tertaut (null bila nomor hanya diketik). */
  linked: { id: number; spk_number: string; customer_name: string | null } | null;
  onPick: (spk: SpkOption) => void;
  /** Toko memo: wajib untuk akun akses penuh (akun lain otomatis toko sendiri). */
  storeId?: number | null;
  /** Akses penuh harus memilih toko dulu sebelum SPK bisa dicari. */
  requireStore?: boolean;
  /** Warna garis kolom; samakan dengan kolom isian lain di layar pemanggil. */
  borderColor?: string;
  /** Alamat daftar SPK; bawaan untuk memo. Catat Pemakaian roll memakai daftar tokonya sendiri. */
  endpoint?: string;
  colors: typeof darkColors;
}

export default function SpkPicker({ number, onChangeNumber, linked, onPick, storeId, requireStore, borderColor, endpoint = '/api/staff/memos/spks', colors }: Props) {
  const styles = useMemo(() => createStyles(colors, borderColor ?? colors.border), [colors, borderColor]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SpkOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
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
      staffApiFetch<{ data: SpkOption[] }>(`${endpoint}?${params.toString()}`)
        .then((res) => {
          if (requestId === latest.current) setResults(res.data ?? []);
        })
        .catch(() => {
          if (requestId === latest.current) setError('Gagal memuat daftar SPK.');
        })
        .finally(() => {
          if (requestId === latest.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(timeout);
  }, [open, search, storeId, requireStore, endpoint]);

  return (
    <View>
      {/* Garis fokus dipasang di kolom gabungan (bukan di kotak ketik), supaya sudut membulat tetap utuh dan tidak ada garis di sisi kiri saja. */}
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <TextInput
          style={styles.fieldInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Ketik Nomor SPK"
          placeholderTextColor={colors.textMuted}
          value={number}
          onChangeText={onChangeNumber}
          autoCapitalize="characters"
        />
        <Pressable
          style={styles.arrow}
          onPress={() => setOpen((o) => !o)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Tutup daftar SPK' : 'Pilih dari daftar SPK'}
        >
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {linked ? (
        <View style={styles.linkedRow}>
          <Ionicons name="link-outline" size={14} color={colors.success} />
          <Text style={styles.linkedText} numberOfLines={1}>
            Tertaut ke SPK{linked.customer_name ? ` · ${linked.customer_name}` : ''}
          </Text>
        </View>
      ) : null}

      {open && (
        <View style={styles.panel}>
          {requireStore && !storeId ? (
            <Text style={styles.hint}>Pilih toko dulu untuk melihat SPK-nya.</Text>
          ) : (
            <>
              <TextInput
                style={styles.search}
                placeholder="Cari no SPK, pelanggan, atau plat..."
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
                <Text style={styles.hint}>Tidak ada SPK yang cocok. Nomor SPK bisa juga diketik langsung di kolom.</Text>
              ) : (
                // Daftar dibatasi tingginya dan bisa digulir sendiri (alasannya sama dengan BookingPicker).
                <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
                  {results.map((s) => (
                    <Pressable
                      key={s.id}
                      style={styles.row}
                      onPress={() => {
                        onPick(s);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{s.spk_number}{s.customer_name ? ` — ${s.customer_name}` : ''}</Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {[s.vehicle_brand, s.vehicle_plate].filter(Boolean).join(' · ') || 'Tanpa info kendaraan'}
                          {s.checked_out_at ? ' · Selesai' : ' · Dikerjakan'}
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

function createStyles(colors: typeof darkColors, line: string) {
  return StyleSheet.create({
    // Kolom gabungan: ketikan di kiri berlatar putih seperti kolom isian lain (colors.bg), tanda panah pembuka daftar di kanan berlatar abu
    // (mengikuti latar kartu di belakangnya).
    field: {
      flexDirection: 'row',
      alignItems: 'stretch',
      minHeight: 50,
      borderWidth: 1,
      borderColor: line,
      borderRadius: 18,
      overflow: 'hidden',
    },
    fieldFocused: { borderColor: colors.accent },
    // outline bawaan peramban (web) dimatikan; fokus ditandai lewat fieldFocused di kolom gabungan.
    fieldInput: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
      paddingHorizontal: 16,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bg,
      ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as object) : {}),
    },
    arrow: {
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderLeftWidth: 1,
      borderLeftColor: line,
    },
    linkedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
    linkedText: { flex: 1, fontSize: fontSize.xs, color: colors.success },
    panel: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      padding: spacing.sm,
      marginTop: spacing.sm,
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
