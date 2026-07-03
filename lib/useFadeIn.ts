/**
 * lib/useFadeIn.ts
 *
 * Hook sederhana untuk animasi fade-in saat screen pertama kali render.
 * Pakai Animated API bawaan RN — tidak butuh reanimated.
 *
 * Usage:
 *   const fadeAnim = useFadeIn();
 *   <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
 */

import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

export function useFadeIn(duration = 300, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    }).start();
  }, [opacity, duration, delay]);

  return opacity;
}

export function useSlideUp(duration = 300, delay = 0, distance = 20) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(distance)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, duration, delay]);

  return { opacity, translateY };
}