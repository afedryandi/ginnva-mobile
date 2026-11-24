import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { radius as radii, spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { useReduceMotion } from '@/lib/motion';

/**
 * Kerangka pemuatan (2026-11-12): kotak abu yang berdenyut pelan sebagai pengganti pemutar ActivityIndicator di layar penuh, supaya halaman
 * terasa sudah "ada" sebelum datanya tiba. Tanpa animasi bila pengguna meminta gerak dikurangi.
 */
export function Skeleton({ width = '100%', height = 14, borderRadius = 8, style }: {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useAppTheme();
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(reduce ? 0.7 : 1)).current;

  useEffect(() => {
    if (reduce) {
      pulse.setValue(0.7);

      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();

    return () => loop.stop();
  }, [pulse, reduce]);

  return <Animated.View style={[{ width, height, borderRadius, backgroundColor: colors.surfaceElevated, opacity: pulse }, style]} />;
}

/** Beberapa kartu kerangka bertumpuk, meniru kartu daftar (judul, dua baris keterangan). */
export function SkeletonCards({ count = 4, style }: { count?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.list, style]} accessibilityLabel="Memuat" accessibilityRole="progressbar">
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Skeleton width="55%" height={16} />
          <Skeleton width="80%" height={12} />
          <Skeleton width="40%" height={12} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.sm },
  card: { borderRadius: radii.lg, borderWidth: 1, padding: spacing.md, gap: spacing.xs + 2 },
});
