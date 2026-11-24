import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

/**
 * Pengaturan gerak bersama (2026-11-12). Semua animasi aplikasi memakai Animated bawaan React Native dengan driver native (tanpa reanimated),
 * durasi pendek, dan menghormati pengaturan "Kurangi animasi" di HP (useReduceMotion).
 */
export const motion = {
  /** Umpan balik sentuhan. */
  fast: 120,
  /** Kemunculan elemen. */
  base: 240,
  /** Perpindahan layar tingkat atas (navigasi bawah). */
  screenFade: 150,
  easeOut: Easing.out(Easing.cubic),
  /** Selisih waktu antar-item daftar yang muncul berurutan, dan batas jumlah item yang diberi jeda. */
  staggerStep: 45,
  staggerMax: 8,
} as const;

// Status "kurangi animasi" disimpan di tingkat modul: dibaca sekali dan dibagikan ke semua komponen, jadi tidak ada kedipan per komponen.
let reduceMotion: boolean | null = null;
const listeners = new Set<(value: boolean) => void>();

function publish(value: boolean) {
  reduceMotion = value;
  listeners.forEach((listener) => listener(value));
}

AccessibilityInfo.isReduceMotionEnabled().then(publish).catch(() => publish(false));
AccessibilityInfo.addEventListener('reduceMotionChanged', publish);

/** True bila pengguna meminta gerak dikurangi: animasi dimatikan dan elemen langsung tampil. */
export function useReduceMotion(): boolean {
  const [value, setValue] = useState<boolean>(reduceMotion ?? false);

  useEffect(() => {
    listeners.add(setValue);
    if (reduceMotion !== null) setValue(reduceMotion);

    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
