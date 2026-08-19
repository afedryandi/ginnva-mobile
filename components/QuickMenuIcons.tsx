import React from 'react';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
  accentColor?: string;
}

const STROKE = 1.1;

export function ShieldCheckIcon({ size = 24, color = '#fff', accentColor = '#ed1651' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3l7 3v5.2c0 4.6-3 8.4-7 9.8-4-1.4-7-5.2-7-9.8V6l7-3z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Path
        d="M9 12.2l2 2 4-4.4"
        stroke={accentColor}
        strokeWidth={STROKE + 0.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function StoreIcon({ size = 24, color = '#fff', accentColor = '#ed1651' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 9.5L5 4h14l1 5.5"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 9.5a2 2 0 004 0 2 2 0 004 0 2 2 0 004 0 2 2 0 004 0"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.5 11v8.5h13V11"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x="10" y="14" width="4" height="5.5" stroke={accentColor} strokeWidth={STROKE} strokeLinejoin="round" />
    </Svg>
  );
}

export function DashboardIcon({ size = 24, color = '#fff', accentColor = '#ed1651' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4" stroke={accentColor} strokeWidth={STROKE} />
      <Rect x="13" y="3.5" width="7.5" height="4.5" rx="1.4" stroke={color} strokeWidth={STROKE} />
      <Rect x="13" y="10" width="7.5" height="10.5" rx="1.4" stroke={color} strokeWidth={STROKE} />
      <Rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4" stroke={color} strokeWidth={STROKE} />
    </Svg>
  );
}

export function CarQuoteIcon({ size = 24, color = '#fff', accentColor = '#ed1651' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 15l1.3-4.6A2 2 0 017.2 9h9.6a2 2 0 011.9 1.4L20 15"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.5 15h17v3a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1h-11v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-3z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Circle cx="7.5" cy="15" r="1.1" stroke={color} strokeWidth={STROKE} />
      <Circle cx="16.5" cy="15" r="1.1" stroke={color} strokeWidth={STROKE} />
      <Line x1="8" y1="9.3" x2="8" y2="6.5" stroke={accentColor} strokeWidth={STROKE + 0.2} strokeLinecap="round" />
      <Line x1="6.5" y1="6.5" x2="9.5" y2="6.5" stroke={accentColor} strokeWidth={STROKE + 0.2} strokeLinecap="round" />
    </Svg>
  );
}

export function PromoTagIcon({ size = 24, color = '#fff', accentColor = '#ed1651' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12.6 3.5H19a1 1 0 011 1v6.4a1 1 0 01-.3.7l-8 8a1 1 0 01-1.4 0l-7.1-7.1a1 1 0 010-1.4l8-8a1 1 0 01.4-.24z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Circle cx="14.3" cy="8" r="1" stroke={accentColor} strokeWidth={STROKE} />
      <Circle cx="18" cy="11.7" r="1" stroke={accentColor} strokeWidth={STROKE} />
      <Line x1="18.6" y1="7.4" x2="13.7" y2="12.3" stroke={accentColor} strokeWidth={STROKE} strokeLinecap="round" />
    </Svg>
  );
}

export function BrandTagIcon({ size = 24, color = '#fff', accentColor = '#ed1651' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12.6 3.5H19a1 1 0 011 1v6.4a1 1 0 01-.3.7l-8 8a1 1 0 01-1.4 0l-7.1-7.1a1 1 0 010-1.4l8-8a1 1 0 01.4-.24z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Circle cx="16" cy="7.5" r="1.4" stroke={accentColor} strokeWidth={STROKE} fill={accentColor} />
    </Svg>
  );
}
