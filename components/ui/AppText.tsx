import React from 'react';
import { Text, TextInput, StyleSheet, type TextProps, type TextInputProps } from 'react-native';
import { fontFamilyForWeight, useFontsReady } from '@/lib/fonts';

/**
 * Teks dengan font Plus Jakarta Sans (2026-11-13). Membaca `fontWeight` dari gaya yang diberikan dan memasang keluarga font bobot itu;
 * `fontWeight` dikembalikan ke normal supaya Android tidak menebalkan lagi di atas font yang memang sudah tebal. Selama font belum
 * selesai dimuat (atau gagal), teks tampil persis seperti `Text` biasa.
 *
 * Dipakai oleh layar yang sudah didesain ulang (Beranda, Absensi, Notifikasi, navigasi bawah). Layar lain tetap memakai font sistem
 * sampai dialihkan satu per satu.
 */
export function AppText({ style, ...props }: TextProps) {
  const ready = useFontsReady();

  if (!ready) {
    return <Text style={style} {...props} />;
  }

  const flat = StyleSheet.flatten(style) ?? {};

  // includeFontPadding: false -- Android menambah ruang ekstra di atas/bawah teks sesuai metrik font; pada Plus Jakarta Sans itu membuat
  // teks di dalam chip, tombol, dan pil tampak turun dari tengah.
  return (
    <Text {...props} style={[style, { fontFamily: fontFamilyForWeight(flat.fontWeight), fontWeight: 'normal', includeFontPadding: false }]}>
      {React.Children.map(props.children, breakLigatures)}
    </Text>
  );
}

// Ligatur "fi", "fj", dan "fl" pada Plus Jakarta Sans menyatukan kait huruf f dengan titik huruf i, sehingga titiknya tampak hilang ("Konfırmasi").
// Penyambung nol-lebar (U+200C) di antara keduanya mencegah ligatur tanpa terlihat dan tanpa menggeser huruf. Jarak huruf kecil terbukti tidak cukup.
const LIGATURE_PAIR = /f(?=[ijl])/g;

function breakLigatures(child: React.ReactNode): React.ReactNode {
  return typeof child === 'string' ? child.replace(LIGATURE_PAIR, 'f‌') : child;
}

/** Kolom isian dengan font yang sama (bobot sedang). Selama font belum siap, tampil seperti `TextInput` biasa. */
export const AppTextInput = React.forwardRef<TextInput, TextInputProps>(function AppTextInput({ style, ...props }, ref) {
  const ready = useFontsReady();

  if (!ready) {
    return <TextInput ref={ref} style={style} {...props} />;
  }

  return <TextInput ref={ref} {...props} style={[style, { fontFamily: fontFamilyForWeight(500) }]} />;
});
