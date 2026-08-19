import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as storage from './storage';
import { lightColors, darkColors } from '@/constants/theme';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'ginnva_theme_mode';

interface ThemeContextValue {
  theme: ThemeMode;
  colors: typeof darkColors;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

// Default 'light'. User tetap bisa switch ke dark kapan saja lewat Akun
// Saya, pilihan disimpan supaya persist antar sesi. (Catatan: Beranda
// SENGAJA selalu dark terlepas dari setting ini — lihat app/(tabs)/index.tsx.)
const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  colors: lightColors,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light');

  useEffect(() => {
    storage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark') setThemeState(saved);
      })
      .catch(() => { /* silent — pakai default 'light' */ });
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    storage.setItem(STORAGE_KEY, mode).catch(() => { /* silent */ });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      storage.setItem(STORAGE_KEY, next).catch(() => { /* silent */ });
      return next;
    });
  }, []);

  const value: ThemeContextValue = {
    theme,
    colors: theme === 'dark' ? darkColors : lightColors,
    setTheme,
    toggleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
