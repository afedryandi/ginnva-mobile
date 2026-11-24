import React, { useState } from 'react';
import { StyleSheet, View, type TextInputProps } from 'react-native';
import { AppText, AppTextInput } from '@/components/ui/AppText';

interface Props extends TextInputProps {
  /** Tinggi kolom saat kosong atau satu baris. */
  minHeight: number;
  /** Tinggi tertinggi; lebih dari ini kolom bisa digulir. */
  maxHeight: number;
}

/**
 * Kolom pesan yang tingginya mengikuti isi: satu baris pendek, dua baris tampil dua baris, dan seterusnya sampai `maxHeight`.
 *
 * Tinggi dihitung dari teks yang diukur di elemen tak terlihat (sama font, lebar, dan jarak baris), BUKAN dari ukuran isi yang dilaporkan
 * kolom itu sendiri: di web ukuran isi ikut membesar mengikuti tinggi kolom yang sudah kita tetapkan, jadi tidak pernah mau mengecil.
 * Gaya kolom (padding, ukuran huruf, jarak baris) dibaca dari `style`.
 */
export function AutoGrowTextInput({ minHeight, maxHeight, style, value, ...props }: Props) {
  const flat = StyleSheet.flatten(style) ?? {};
  const { flex: _flex, ...inputStyle } = flat as Record<string, unknown>;
  const paddingH = Number(flat.paddingHorizontal ?? 0);
  const paddingV = Number(flat.paddingVertical ?? 0);

  const [width, setWidth] = useState(0);
  const [textHeight, setTextHeight] = useState(0);

  const height = width > 0 && textHeight > 0 ? Math.min(maxHeight, Math.max(minHeight, Math.ceil(textHeight) + paddingV * 2)) : minHeight;

  // Baris kosong di akhir ikut terukur (Enter di akhir teks).
  const measured = value ? (value.endsWith('\n') ? `${value} ` : value) : ' ';

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <AppTextInput {...props} value={value} multiline style={[inputStyle as never, { height }]} />
      {width > 0 ? (
        <AppText
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLayout={(e) => setTextHeight(e.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            opacity: 0,
            width: Math.max(0, width - paddingH * 2),
            fontSize: Number(flat.fontSize ?? 14),
            lineHeight: Number(flat.lineHeight ?? Number(flat.fontSize ?? 14) * 1.4),
            fontWeight: '500',
          }}
        >
          {measured}
        </AppText>
      ) : null}
    </View>
  );
}
