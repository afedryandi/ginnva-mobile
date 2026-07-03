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
  white: '#ffffff',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
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
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
};
