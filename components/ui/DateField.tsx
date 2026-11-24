import React, { useMemo, useState } from 'react';
import { View, Pressable, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

/**
 * Isian tanggal berbentuk kalender (tanpa mengetik). Beda dari DateGrid, yang hanya untuk jadwal ke depan:
 * di sini tanggal lampau maupun mendatang bisa dipilih, dibatasi `minDate`/`maxDate` bila ada.
 * Nilai berformat "YYYY-MM-DD" (lokal); string kosong = belum diisi.
 *
 * Tampilan dirancang ulang 2026-11-13: kolom berlatar lembut dengan ikon kalender bulat, dan kalender terbuka sebagai lembar dari bawah
 * (bukan kotak di tengah). Bulan dan tahun bisa dipilih langsung (ketuk nama bulan atau tahun) tanpa menggeser satu per satu; hari terpilih
 * berlatar merah, hari ini bertanda lembut, dan hari Minggu berwarna. Perilaku dan properti tidak berubah.
 */
interface Props {
  value: string;
  onChange: (date: string) => void;
  placeholder: string;
  minDate?: string;
  maxDate?: string;
  /** Tampilkan tombol hapus bila sudah terisi. */
  allowClear?: boolean;
  colors: typeof darkColors;
}

type PickerView = 'days' | 'months' | 'years';

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const YEARS_PER_PAGE = 12;

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatKey(key: string): string {
  return fromKey(key).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DateField({ value, onChange, placeholder, minDate, maxDate, allowClear, colors }: Props) {
  const { theme } = useAppTheme();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // Lebar kolom dalam piksel bulat: persen (100/7) membuat 7 kotak sedikit melebihi lebar baris setelah pembulatan, sehingga kolom Minggu
  // turun ke baris berikutnya dan tiap baris hanya berisi 6 tanggal.
  const cellWidth = Math.floor((windowWidth - 40) / 7);
  const styles = useMemo(() => createStyles(colors, isDark, insets.bottom, cellWidth), [colors, isDark, insets.bottom, cellWidth]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PickerView>('days');
  const [month, setMonth] = useState(() => {
    const base = value ? fromKey(value) : minDate && minDate > todayKey() ? fromKey(minDate) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  // Awal halaman daftar tahun (12 tahun per halaman).
  const [yearPageStart, setYearPageStart] = useState(() => new Date().getFullYear() - 5);

  const today = todayKey();

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

  const shift = (months: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + months, 1));

  const openPicker = () => {
    const base = value ? fromKey(value) : minDate && minDate > today ? fromKey(minDate) : new Date();
    setMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    setYearPageStart(base.getFullYear() - 5);
    setView('days');
    setOpen(true);
  };

  const isDisabled = (key: string) => (minDate !== undefined && key < minDate) || (maxDate !== undefined && key > maxDate);

  // Satu bulan/tahun dinonaktifkan hanya bila SELURUH rentangnya di luar batas.
  const monthDisabled = (year: number, m: number) => {
    const first = toDateKey(new Date(year, m, 1));
    const last = toDateKey(new Date(year, m + 1, 0));
    return (minDate !== undefined && last < minDate) || (maxDate !== undefined && first > maxDate);
  };
  const yearDisabled = (year: number) => (minDate !== undefined && `${year}-12-31` < minDate) || (maxDate !== undefined && `${year}-01-01` > maxDate);

  return (
    <>
      <PressableScale style={styles.field} onPress={openPicker} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={value ? `Tanggal ${formatKey(value)}` : placeholder}>
        <View style={styles.fieldIcon}>
          <Ionicons name="calendar-outline" size={17} color={styles.accentText.color} />
        </View>
        <Text style={[styles.fieldText, !value && styles.fieldPlaceholder]}>{value ? formatKey(value) : placeholder}</Text>
        {allowClear && value ? (
          <Pressable hitSlop={10} onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel="Hapus tanggal">
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        )}
      </PressableScale>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.handle} />

            {/* Kepala: panah geser, dan nama bulan serta tahun yang bisa diketuk untuk memilih langsung. */}
            <View style={styles.monthRow}>
              <Pressable
                style={styles.navButton}
                hitSlop={6}
                onPress={() => (view === 'years' ? setYearPageStart((y) => y - YEARS_PER_PAGE) : view === 'months' ? shift(-12) : shift(-1))}
                accessibilityRole="button"
                accessibilityLabel="Sebelumnya"
              >
                <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
              </Pressable>

              {view === 'years' ? (
                <Text style={styles.monthTitle}>{`${yearPageStart} – ${yearPageStart + YEARS_PER_PAGE - 1}`}</Text>
              ) : (
                <View style={styles.titleGroup}>
                  <Pressable
                    style={[styles.titleChip, view === 'months' && styles.titleChipActive]}
                    onPress={() => setView(view === 'months' ? 'days' : 'months')}
                    accessibilityRole="button"
                    accessibilityLabel="Pilih bulan"
                  >
                    <Text style={[styles.titleChipText, view === 'months' && styles.titleChipTextActive]}>{MONTH_NAMES[month.getMonth()]}</Text>
                    <Ionicons name={view === 'months' ? 'chevron-up' : 'chevron-down'} size={14} color={view === 'months' ? styles.accentText.color : colors.textMuted} />
                  </Pressable>
                  <Pressable
                    style={styles.titleChip}
                    onPress={() => { setYearPageStart(month.getFullYear() - 5); setView('years'); }}
                    accessibilityRole="button"
                    accessibilityLabel="Pilih tahun"
                  >
                    <Text style={styles.titleChipText}>{month.getFullYear()}</Text>
                    <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                  </Pressable>
                </View>
              )}

              <Pressable
                style={styles.navButton}
                hitSlop={6}
                onPress={() => (view === 'years' ? setYearPageStart((y) => y + YEARS_PER_PAGE) : view === 'months' ? shift(12) : shift(1))}
                accessibilityRole="button"
                accessibilityLabel="Berikutnya"
              >
                <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
              </Pressable>
            </View>

            {view === 'days' ? (
              <>
                <View style={styles.weekRow}>
                  {WEEKDAYS.map((w, i) => (
                    <Text key={w} style={[styles.weekday, i === 6 && styles.weekdaySunday]}>{w}</Text>
                  ))}
                </View>

                <View style={styles.grid}>
                  {cells.map((d, i) => {
                    if (!d) return <View key={`e${i}`} style={styles.cell} />;
                    const key = toDateKey(d);
                    const disabled = isDisabled(key);
                    const selected = key === value;
                    const isToday = key === today;
                    const sunday = i % 7 === 6;

                    return (
                      <Pressable
                        key={key}
                        style={styles.cell}
                        disabled={disabled}
                        onPress={() => {
                          onChange(key);
                          setOpen(false);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled }}
                      >
                        <View style={[styles.day, isToday && !selected && styles.dayToday, selected && styles.daySelected]}>
                          <Text
                            style={[
                              styles.dayText,
                              sunday && styles.dayTextSunday,
                              isToday && !selected && styles.dayTextToday,
                              disabled && styles.dayTextDisabled,
                              selected && styles.dayTextSelected,
                            ]}
                          >
                            {d.getDate()}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : view === 'months' ? (
              <View style={styles.pickGrid}>
                {MONTH_NAMES.map((name, m) => {
                  const disabled = monthDisabled(month.getFullYear(), m);
                  const current = m === month.getMonth();
                  return (
                    <Pressable
                      key={name}
                      style={styles.pickCell}
                      disabled={disabled}
                      onPress={() => { setMonth(new Date(month.getFullYear(), m, 1)); setView('days'); }}
                      accessibilityRole="button"
                      accessibilityLabel={name}
                      accessibilityState={{ selected: current, disabled }}
                    >
                      <View style={[styles.pickPill, current && styles.pickPillActive, disabled && styles.pickPillDisabled]}>
                        <Text style={[styles.pickText, current && styles.pickTextActive]}>{name.slice(0, 3)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={styles.pickGrid}>
                {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart + i).map((year) => {
                  const disabled = yearDisabled(year);
                  const current = year === month.getFullYear();
                  return (
                    <Pressable
                      key={year}
                      style={styles.pickCell}
                      disabled={disabled}
                      onPress={() => { setMonth(new Date(year, month.getMonth(), 1)); setView('days'); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: current, disabled }}
                    >
                      <View style={[styles.pickPill, current && styles.pickPillActive, disabled && styles.pickPillDisabled]}>
                        <Text style={[styles.pickText, current && styles.pickTextActive]}>{year}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={styles.footer}>
              {!isDisabled(today) ? (
                <PressableScale style={styles.todayButton} onPress={() => { onChange(today); setOpen(false); }}>
                  <Ionicons name="today-outline" size={16} color={styles.accentText.color} />
                  <Text style={styles.todayButtonText}>Hari ini</Text>
                </PressableScale>
              ) : <View />}
              <PressableScale style={styles.closeButton} onPress={() => setOpen(false)}>
                <Text style={styles.closeButtonText}>Tutup</Text>
              </PressableScale>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean, insetsBottom: number, cellWidth: number) {
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const sheetBg = isDark ? colors.surface : '#ffffff';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const gridWidth = cellWidth * 7;

  return StyleSheet.create({
    accentText: { color: accentText },

    field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, minHeight: 50, paddingLeft: 8, paddingRight: 16, borderRadius: 18, backgroundColor: chip, marginBottom: spacing.sm },
    fieldIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    fieldText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    fieldPlaceholder: { fontWeight: '500', color: colors.textMuted },

    backdrop: { flex: 1, backgroundColor: 'rgba(10,10,16,0.5)', justifyContent: 'flex-end' },
    sheet: { width: '100%', backgroundColor: sheetBg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insetsBottom, 16) + 4, gap: spacing.md },
    handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: line },

    monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    navButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    monthTitle: { flex: 1, textAlign: 'center', fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    titleGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    titleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: chip },
    titleChipActive: { backgroundColor: colors.accentSoft },
    titleChipText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary },
    titleChipTextActive: { color: accentText },

    weekRow: { flexDirection: 'row', width: gridWidth, alignSelf: 'center' },
    weekday: { width: cellWidth, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.textMuted },
    weekdaySunday: { color: accentText },

    grid: { flexDirection: 'row', flexWrap: 'wrap', width: gridWidth, alignSelf: 'center' },
    cell: { width: cellWidth, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
    day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    dayToday: { backgroundColor: colors.accentSoft },
    daySelected: {
      backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
    },
    dayText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    dayTextSunday: { color: accentText },
    dayTextToday: { color: accentText, fontWeight: '800' },
    dayTextDisabled: { color: colors.textMuted, opacity: 0.35 },
    dayTextSelected: { color: '#ffffff', fontWeight: '800' },

    // Pilih bulan / tahun: 3 kolom x 4 baris.
    pickGrid: { flexDirection: 'row', flexWrap: 'wrap', width: gridWidth, alignSelf: 'center', paddingVertical: spacing.xs },
    pickCell: { width: Math.floor(gridWidth / 3), alignItems: 'center', paddingVertical: 6 },
    pickPill: { width: Math.floor(gridWidth / 3) - 12, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    pickPillActive: { backgroundColor: colors.accent },
    pickPillDisabled: { opacity: 0.35 },
    pickText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    pickTextActive: { color: '#ffffff', fontWeight: '800' },

    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.xs },
    todayButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    todayButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: accentText },
    closeButton: { height: 44, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    closeButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  });
}
