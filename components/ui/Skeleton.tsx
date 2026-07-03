/**
 * components/ui/Skeleton.tsx
 *
 * Skeleton loader menggunakan Animated API bawaan React Native —
 * tidak butuh library tambahan, langsung jalan di Expo Go.
 * Efek shimmer dari kiri ke kanan via interpolated opacity.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius } from '@/constants/theme';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = radius.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as never,
          height,
          borderRadius,
          backgroundColor: colors.line,
          opacity,
        },
        style,
      ]}
    />
  );
}

// Skeleton card untuk warranty/booking list
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <Skeleton width="50%" height={14} />
        <Skeleton width={80} height={24} borderRadius={radius.pill} />
      </View>
      <Skeleton width="70%" height={18} style={{ marginTop: 8 }} />
      <Skeleton width="40%" height={13} style={{ marginTop: 4 }} />
      <View style={styles.divider} />
      <Skeleton width="90%" height={13} />
      <Skeleton width="60%" height={13} style={{ marginTop: 6 }} />
    </View>
  );
}

// Skeleton card untuk news list
export function SkeletonNewsCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.newsCard, style]}>
      <Skeleton width="100%" height={160} borderRadius={radius.lg} />
      <View style={styles.newsContent}>
        <Skeleton width="30%" height={12} />
        <Skeleton width="90%" height={18} style={{ marginTop: 6 }} />
        <Skeleton width="75%" height={18} style={{ marginTop: 4 }} />
        <Skeleton width="60%" height={13} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

// Skeleton untuk home screen (case study + news)
export function SkeletonHomeCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.homeCard, style]}>
      <Skeleton width={200} height={130} borderRadius={radius.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 10,
  },
  newsCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
  },
  newsContent: {
    padding: 14,
    gap: 2,
  },
  homeCard: {
    marginRight: 12,
  },
});