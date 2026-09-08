/**
 * Design tokens — diambil langsung dari :root di ginnva-web/app/globals.css,
 * supaya mobile app terasa konsisten dengan web (warna, bukan dark theme
 * generic bawaan mobile).
 */
export const colors = {
  accent: '#ed1651',
  accentDark: '#c4123f',
  ink: '#333333',
  muted: '#666666',
  mutedLight: '#999999',
  line: '#e6e6e6',
  alt: '#f2f5fa',
  surface: '#f5f5f5',
  white: '#ffffff',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  warningBg: '#fffbeb',
  warningBorder: '#fde68a',
};

/**
 * Dark theme premium — dipakai untuk Beranda (referensi: mini app Ginnva
 * China, nuansa navy/ungu gelap dengan aksen merah brand). SENGAJA token
 * terpisah dari `colors` di atas (bukan menimpa) — supaya layar lain yang
 * belum di-redesign tetap aman di light theme, tidak ada risiko teks
 * jadi tidak terbaca karena redefinisi token global yang terburu-buru.
 * Konversi layar lain ke dark theme dilakukan bertahap, screen demi
 * screen, memakai token ini.
 */
export const darkColors = {
  // Diganti ke nuansa abu-abu netral gaya Discord (diminta pengguna
  // 2026-09-07, setelah percobaan navy/ungu sebelumnya) — 3 tingkat abu
  // gelap yang sama persis dengan palet resmi Discord Dark Theme
  // (server list #1e1f22 -> sidebar #2b2d31 -> chat/content #313338),
  // aksen merah brand Ginnva TETAP dipertahankan (bukan ganti ke blurple
  // Discord). Sebelumnya #0b0b16 (hampir hitam) lalu #1c1830 (navy/ungu).
  bg: '#1e1f22',             // dasar — tingkat abu tergelap
  bgGradientTop: '#2b2d31',
  bgGradientBottom: '#1e1f22',
  surface: '#2b2d31',        // panel/card di atas bg (tingkat abu tengah)
  surfaceElevated: '#313338', // tingkat abu paling terang dari 3 ini
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  textPrimary: '#f2f3f5',
  textSecondary: '#b5bac1',
  textMuted: '#80848e',
  accent: '#ed1651',
  accentSoft: 'rgba(237,22,81,0.16)',
  gold: '#ff6b81',          // aksen sekunder — merah muda elegan (brand red), BUKAN kuning/gold
  success: '#34d399',
  successBg: 'rgba(52,211,153,0.14)',
  warning: '#fbbf24',
  warningBg: 'rgba(251,191,36,0.14)',
  danger: '#f87171',
  dangerBg: 'rgba(248,113,113,0.14)',
};

/**
 * Versi light dari palet di atas — SAMA PERSIS bentuk key-nya dengan
 * `darkColors`, supaya layar yang sudah dikonversi ke sistem tema
 * (lihat lib/theme-context.tsx) bisa menukar antara light/dark tanpa
 * ubah nama token satu-satu. `colors` di atas TETAP dipertahankan
 * apa adanya untuk layar lama yang belum ikut sistem tema.
 */
export const lightColors = {
  bg: '#ffffff',
  bgGradientTop: '#ffffff',
  bgGradientBottom: '#ffffff',
  surface: '#f5f5f5',
  surfaceElevated: '#f2f5fa',
  border: '#e6e6e6',
  borderStrong: '#d8d8d8',
  textPrimary: '#333333',
  textSecondary: '#666666',
  textMuted: '#999999',
  accent: '#ed1651',
  accentSoft: 'rgba(237,22,81,0.08)',
  gold: '#ed1651',
  success: '#16a34a',
  successBg: '#e7f8ef',
  warning: '#d97706',
  warningBg: '#fffbeb',
  danger: '#dc2626',
  dangerBg: '#fde8e8',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
};
