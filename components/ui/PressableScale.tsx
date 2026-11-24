import React, { useCallback, useRef } from 'react';
import { Animated, Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '@/lib/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  /** Gaya statis (bukan fungsi): skala dipasang bersama gaya ini. */
  style?: StyleProp<ViewStyle>;
  /** Skala saat ditekan. Bawaan 0,97: terasa tetapi tidak mengganggu. */
  scaleTo?: number;
}

/**
 * Pressable yang mengecil sedikit saat ditekan dan kembali dengan pantulan halus (2026-11-12). Pengganti Pressable untuk tombol dan kartu
 * yang bisa diketuk. Dimatikan bila pengguna meminta gerak dikurangi. Tidak menerima `style` berbentuk fungsi.
 */
export function PressableScale({ style, scaleTo = 0.97, onPressIn, onPressOut, children, ...rest }: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    if (!reduce) {
      Animated.spring(scale, { toValue: scaleTo, speed: 60, bounciness: 0, useNativeDriver: true }).start();
    }
    onPressIn?.(event);
  }, [reduce, scale, scaleTo, onPressIn]);

  const handlePressOut = useCallback((event: GestureResponderEvent) => {
    if (!reduce) {
      Animated.spring(scale, { toValue: 1, speed: 30, bounciness: 6, useNativeDriver: true }).start();
    }
    onPressOut?.(event);
  }, [reduce, scale, onPressOut]);

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
