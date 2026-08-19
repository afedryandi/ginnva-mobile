/**
 * components/ui/PinchZoomImage.tsx
 *
 * Gambar dengan pinch-to-zoom (2 jari) + geser saat sudah zoom (1 jari)
 * + double-tap untuk toggle zoom 1x/2x. Sengaja pakai PanResponder +
 * Animated bawaan React Native (BUKAN react-native-reanimated/
 * react-native-gesture-handler) — kedua paket itu tidak ter-install di
 * project ini dan pemasangannya butuh native rebuild (EAS build) dulu
 * sebelum bisa dites. Versi ini langsung jalan di Expo Go, tanpa install
 * apa pun.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image as RNImage, PanResponder, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

const AnimatedImage = Animated.createAnimatedComponent(Image);

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_DELAY_MS = 280;

interface Props {
  uri: string;
  fallback?: string;
}

function touchDistance(touches: { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export function PinchZoomImage({ uri, fallback }: Props) {
  // contentFit="contain" selalu men-center gambar DI DALAM kotaknya
  // sendiri, terlepas dari alignment container-nya — kalau kotaknya
  // dipaksa height:'100%' (memenuhi layar), muncul letterbox kosong di
  // atas/bawah walau container-nya sudah flex-start. Solusinya: hitung
  // rasio aspek gambar asli, kotaknya dibuat PAS ukurannya (bukan
  // dipaksa penuh layar) supaya tidak ada sisa ruang buat di-center.
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    const source = uri || fallback;
    if (!source) return;
    setAspectRatio(null);
    RNImage.getSize(
      source,
      (w, h) => setAspectRatio(w / h),
      () => setAspectRatio(null)
    );
  }, [uri, fallback]);

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Nilai "commit" terakhir (bukan yang sedang di-drag) — dipakai sebagai
  // titik awal perhitungan gesture berikutnya.
  const currentScale = useRef(1);
  const currentTranslate = useRef({ x: 0, y: 0 });
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastTapAt = useRef(0);

  const resetZoom = () => {
    currentScale.current = 1;
    currentTranslate.current = { x: 0, y: 0 };
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  };

  const zoomTo = (target: number) => {
    currentScale.current = target;
    if (target === 1) currentTranslate.current = { x: 0, y: 0 };
    Animated.parallel([
      Animated.spring(scale, { toValue: target, useNativeDriver: true }),
      ...(target === 1
        ? [
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
          ]
        : []),
    ]).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, gesture) =>
          Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,

        onPanResponderGrant: (e) => {
          const touches = e.nativeEvent.touches;
          if (touches.length === 2) {
            pinchStartDistance.current = touchDistance(touches);
            pinchStartScale.current = currentScale.current;
          } else {
            dragStart.current = { ...currentTranslate.current };
          }
        },

        onPanResponderMove: (e, gesture) => {
          const touches = e.nativeEvent.touches;
          if (touches.length === 2) {
            if (!pinchStartDistance.current) {
              pinchStartDistance.current = touchDistance(touches);
              pinchStartScale.current = currentScale.current;
              return;
            }
            const dist = touchDistance(touches);
            const next = Math.max(
              1,
              Math.min((pinchStartScale.current * dist) / pinchStartDistance.current, MAX_SCALE)
            );
            currentScale.current = next;
            scale.setValue(next);
          } else if (touches.length === 1 && currentScale.current > 1) {
            const nextX = dragStart.current.x + gesture.dx;
            const nextY = dragStart.current.y + gesture.dy;
            translateX.setValue(nextX);
            translateY.setValue(nextY);
            // Dicatat sinkron di sini (bukan lewat stopAnimation() yang
            // async saat release) — stopAnimation() sempat balapan
            // dengan onPanResponderGrant gesture berikutnya kalau user
            // geser lagi dengan cepat, jadi currentTranslate.current
            // masih kebaca nilai lama/nol saat gesture kedua dimulai.
            currentTranslate.current = { x: nextX, y: nextY };
          }
        },

        onPanResponderRelease: (e) => {
          pinchStartDistance.current = 0;

          if (currentScale.current <= 1) {
            resetZoom();
          }

          // Double-tap toggle zoom — cuma dianggap valid kalau ini
          // benar-benar tap (bukan habis pinch/drag), dicek dari
          // changedTouches yang cuma 1 jari.
          if (e.nativeEvent.changedTouches.length === 1) {
            const now = Date.now();
            if (now - lastTapAt.current < DOUBLE_TAP_DELAY_MS) {
              lastTapAt.current = 0;
              zoomTo(currentScale.current > 1 ? 1 : DOUBLE_TAP_SCALE);
            } else {
              lastTapAt.current = now;
            }
          }
        },
      }),
    []
  );

  return (
    <Animated.View style={styles.container} {...panResponder.panHandlers}>
      <AnimatedImage
        source={{ uri: uri || fallback }}
        style={[
          aspectRatio ? { width: '100%', aspectRatio } : styles.image,
          {
            // Urutan PENTING: translate ditulis SEBELUM scale supaya
            // geseran diterapkan di luar/setelah pembesaran (transform
            // di RN diproses kanan-ke-kiri) — dengan begini 1px gerakan
            // jari selalu = 1px geser layar, tidak ikut kelipatan scale
            // (sebelumnya urutan terbalik bikin geser makin "cepat"
            // makin besar zoom-nya).
            transform: [
              { translateX },
              { translateY },
              { scale },
            ],
          },
        ]}
        contentFit="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
