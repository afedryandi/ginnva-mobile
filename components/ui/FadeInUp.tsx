import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { motion, useReduceMotion } from '@/lib/motion';

interface FadeInUpProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
  /** Urutan item dalam daftar: tiap urutan menambah jeda kecil (dibatasi) supaya item muncul berurutan. */
  index?: number;
  /** Matikan untuk item yang tidak perlu animasi (mis. item di bawah layar pertama). */
  enabled?: boolean;
  distance?: number;
  duration?: number;
  /** Jeda eksplisit (ms); menggantikan jeda dari `index`. */
  delay?: number;
}

/**
 * Muncul perlahan sambil naik sedikit saat pertama dipasang (2026-11-12). Dipakai untuk kartu dan item daftar. Hanya berjalan sekali per
 * pemasangan, dan langsung tampil bila animasi dimatikan atau pengguna meminta gerak dikurangi.
 */
export function FadeInUp({ style, index = 0, enabled = true, distance = 12, duration = motion.base, delay, children, ...rest }: FadeInUpProps) {
  const reduce = useReduceMotion();
  const animate = enabled && !reduce;
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      progress.setValue(1);

      return;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: delay ?? Math.min(index, motion.staggerMax) * motion.staggerStep,
      easing: motion.easeOut,
      useNativeDriver: true,
    });
    animation.start();

    return () => animation.stop();
    // Sekali per pemasangan: perubahan properti sesudahnya tidak mengulang animasi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      {...rest}
      style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}
    >
      {children}
    </Animated.View>
  );
}
