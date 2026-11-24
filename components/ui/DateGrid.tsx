import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';

/**
 * Pemilih tanggal berbentuk kalender bulanan (kotak-kotak) untuk jadwal ulang.
 * Hanya `daysAhead` hari ke depan (mulai hari ini, atau `daysBack` hari sebelumnya) yang bisa dipilih; tanggal
 * toko tutup/penuh (`disabledDates`) dan jadwal saat ini (`currentDate`)
 * dinonaktifkan. Semua tanggal berformat "YYYY-MM-DD" (lokal).
 */
interface Props {
  value: string;
  onChange: (date: string) => void;
  disabledDates?: string[];
  /** Tanggal "hampir penuh" (masih bisa dipilih, hanya diberi penanda). */
  limitedDates?: string[];
  currentDate?: string | null;
  loading?: boolean;
  daysAhead?: number;
  /** Berapa hari ke belakang dari hari ini yang masih bisa dipilih (default 0 = mulai hari ini). */
  daysBack?: number;
  /** Kotak tanggal lebih pendek, untuk lembar yang berbagi ruang dengan isian lain. */
  compact?: boolean;
  colors: typeof darkColors;
}

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function DateGrid({ value, onChange, disabledDates = [], limitedDates = [], currentDate, loading, daysAhead = 30, daysBack = 0, compact = false, colors }: Props) {
  const styles = useMemo(() => createStyles(colors, compact), [colors, compact]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const firstDay = useMemo(() => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack), [today, daysBack]);
  const lastDay = useMemo(() => new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead - 1), [today, daysAhead]);
  const firstMonth = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1);
  const lastMonth = new Date(lastDay.getFullYear(), lastDay.getMonth(), 1);

  // Kalender dibuka di bulan yang sedang dipilih (atau bulan ini), bukan di bulan paling awal yang boleh dipilih.
  const [month, setMonth] = useState(() => {
    const picked = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1) : null;

    return picked && picked.getTime() >= firstMonth.getTime() && picked.getTime() <= lastMonth.getTime() ? picked : new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const canPrev = month.getTime() > firstMonth.getTime();
  const canNext = month.getTime() < lastMonth.getTime();

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    // Senin = kolom 0.
    const offset = (first.getDay() + 6) % 7;
    const out: (Date | null)[] = Array(offset).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      out.push(new Date(month.getFullYear(), month.getMonth(), day));
    }
    while (out.length % 7 !== 0) out.push(null);

    return out;
  }, [month]);

  // Satu baris per minggu dengan tujuh kolom sama lebar (flex), bukan flexWrap berbasis persen: pembulatan piksel pada 14,28% membuat hanya
  // enam kotak muat per baris di sebagian layar, sehingga kolom Minggu hilang dan tanggal bergeser satu hari.
  const weeks = useMemo(() => {
    const rows: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

    return rows;
  }, [cells]);

  const blocked = useMemo(() => new Set(disabledDates), [disabledDates]);
  const limited = useMemo(() => new Set(limitedDates), [limitedDates]);
  const currentKey = currentDate ? currentDate.slice(0, 10) : null;
  const monthLabel = month.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  return (
    <View style={styles.wrap} accessibilityLabel="Pilih tanggal">
      <View style={styles.header}>
        <Pressable
          onPress={() => canPrev && setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          disabled={!canPrev}
          hitSlop={8}
          style={[styles.navBtn, !canPrev && { opacity: 0.3 }]}
          accessibilityRole="button"
          accessibilityLabel="Bulan sebelumnya"
        >
          <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable
          onPress={() => canNext && setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          disabled={!canNext}
          hitSlop={8}
          style={[styles.navBtn, !canNext && { opacity: 0.3 }]}
          accessibilityRole="button"
          accessibilityLabel="Bulan berikutnya"
        >
          <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.row}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={styles.weekday}>{w}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {weeks.map((week, wi) => (
          <View key={`w${wi}`} style={styles.weekRow}>
        {week.map((d, i) => {
          if (!d) return <View key={`e${wi}-${i}`} style={styles.cellBox} />;

          const key = toKey(d);
          const inWindow = d.getTime() >= firstDay.getTime() && d.getTime() <= lastDay.getTime();
          const isCurrent = key === currentKey;
          const isBlocked = blocked.has(key);
          const disabled = loading || !inWindow || isCurrent || isBlocked;
          const active = value === key;
          const isLimited = !isBlocked && !isCurrent && limited.has(key);

          const state = isCurrent ? ', jadwal saat ini' : isBlocked ? ', tidak tersedia' : !inWindow ? ', di luar rentang' : isLimited ? ', hampir penuh' : '';

          return (
            <View key={key} style={styles.cellBox}>
              <Pressable
                disabled={disabled}
                onPress={() => onChange(key)}
                accessibilityRole="button"
                accessibilityLabel={`${d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}${state}`}
                accessibilityState={{ selected: active, disabled }}
                style={[
                  styles.cell,
                  isCurrent && styles.cellCurrent,
                  active && styles.cellActive,
                  disabled && !isCurrent && !active && { opacity: inWindow ? 0.4 : 0.2 },
                ]}
              >
                <Text style={[styles.cellText, active && { color: '#ffffff' }, isBlocked && styles.cellTextBlocked]}>{d.getDate()}</Text>
                {isLimited && <View style={styles.limitedDot} />}
              </Pressable>
            </View>
          );
        })}
          </View>
        ))}
      </View>

      <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
        <Text style={styles.legendText}>Dipilih</Text>
        {currentKey ? (
          <>
            <View style={[styles.legendDot, { borderWidth: 1.5, borderColor: colors.accent }]} />
            <Text style={styles.legendText}>Jadwal saat ini</Text>
          </>
        ) : null}
        {limitedDates.length > 0 ? (
          <>
            <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
            <Text style={styles.legendText}>Hampir penuh</Text>
          </>
        ) : null}
        <Text style={[styles.legendText, { textDecorationLine: 'line-through' }]}>12</Text>
        <Text style={styles.legendText}>Tutup/penuh</Text>
      </View>
    </View>
  );
}

function createStyles(colors: typeof darkColors, compact: boolean) {
  return StyleSheet.create({
    wrap: { marginBottom: spacing.sm },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
    navBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface },
    monthLabel: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    row: { flexDirection: 'row' },
    weekday: { flex: 1, textAlign: 'center', fontSize: fontSize.xs, color: colors.textMuted, paddingVertical: 4 },
    grid: {},
    weekRow: { flexDirection: 'row' },
    cellBox: { flex: 1, aspectRatio: compact ? 1.3 : 1, padding: 2 },
    cell: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    cellActive: { backgroundColor: colors.accent },
    cellCurrent: { borderWidth: 1.5, borderColor: colors.accent, backgroundColor: 'transparent' },
    cellText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    limitedDot: { position: 'absolute', bottom: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.warning },
    cellTextBlocked: { textDecorationLine: 'line-through' },
    legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
    legendDot: { width: 10, height: 10, borderRadius: 3 },
    legendText: { fontSize: fontSize.xs, color: colors.textMuted, marginRight: spacing.sm },
  });
}
