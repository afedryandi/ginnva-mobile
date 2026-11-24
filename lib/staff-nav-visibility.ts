import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/**
 * Navigasi bawah staf menghilang saat daftar digulir ke bawah dan muncul lagi saat digulir ke atas (atau saat kembali ke puncak).
 * Statusnya satu untuk seluruh aplikasi (modul), dibagikan antara layar yang menggulir dan bilah di StaffBottomNav.
 */
let hidden = false;
const listeners = new Set<() => void>();

function setHidden(value: boolean) {
  if (hidden === value) return;

  hidden = value;
  listeners.forEach((listener) => listener());
}

export function useNavHidden(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },
    () => hidden,
    () => false,
  );
}

export function showNav() {
  setHidden(false);
}

// Selisih gulir minimal (px) sebelum bilah berganti keadaan, supaya getaran kecil di jari tidak membuatnya berkedip.
const THRESHOLD = 10;

/** Pasang hasilnya ke onScroll milik ScrollView/FlatList (bersama scrollEventThrottle={16}). */
export function useHideNavOnScroll() {
  const last = useRef(0);

  return useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const y = contentOffset.y;
    const dy = y - last.current;
    const maxY = contentSize.height - layoutMeasurement.height;

    if (y <= 0) {
      setHidden(false);
    } else if (maxY > 0 && y >= maxY - 4) {
      // Mentok di dasar daftar (termasuk pantulan iOS): biarkan keadaan terakhir, jangan berganti.
    } else if (dy > THRESHOLD) {
      setHidden(true);
    } else if (dy < -THRESHOLD) {
      setHidden(false);
    }

    last.current = y;
  }, []);
}
