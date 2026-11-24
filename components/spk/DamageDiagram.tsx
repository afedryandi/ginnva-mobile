import React, { useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Image, Animated, PanResponder, LayoutChangeEvent, GestureResponderEvent, PanResponderGestureState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { AppText as Text } from '@/components/ui/AppText';

export interface DamageMark {
  id?: number;
  x_percent: number;
  y_percent: number;
  code: string;
  note?: string | null;
}

// Rasio asli gambar assets/images/car-diagram-top.png.
const DIAGRAM_ASPECT_RATIO = 1120 / 1400;
const MAX_SCALE = 4;
const TAP_MOVE_THRESHOLD = 6; // px -- di bawah ini dianggap tap, bukan geser.
const MARK_HIT_RADIUS = 16; // px, di ruang gambar asli (skala 1x) -- sedikit lebih besar dari visual dot (radius 7) supaya tetap gampang di-tap.

const DAMAGE_CODES: { value: string; label: string; color: string }[] = [
  { value: 'C', label: 'Cat Luka/Belang', color: '#ef4444' },
  { value: 'B', label: 'Baret Dalam', color: '#f97316' },
  { value: 'P', label: 'Penyok', color: '#eab308' },
  { value: 'G', label: 'Kaca Baret/Retak', color: '#3b82f6' },
  { value: 'M', label: 'Komponen Hilang', color: '#8b5cf6' },
  { value: 'OS', label: 'Over Spray', color: '#22c55e' },
];

function colorFor(code: string): string {
  return DAMAGE_CODES.find((c) => c.value === code)?.color ?? '#666';
}

function touchDistance(touches: { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

// Diagram kondisi kendaraan tampak atas (Fase 2 digitalisasi SPK,
// diminta user 2026-09-16) -- pakai FOTO diagram "unfold" (dikirim
// user, assets/images/car-diagram-top.png) sebagai latar, BUKAN lagi
// gambar SVG buatan sendiri (2 percobaan sebelumnya dinilai "jelek").
// Bisa di-pinch zoom (2 jari) & digeser (1 jari, saat sudah zoom) buat
// lihat detail, sama pola dengan components/ui/PinchZoomImage.tsx
// (PanResponder + Animated bawaan RN, TIDAK pakai react-native-
// gesture-handler/reanimated -- keduanya belum ter-install di project
// ini). Titik kerusakan ditempatkan lewat SATU PanResponder yang sama:
// tap tanpa gerakan berarti = tandai/hapus titik, gerakan 2 jari =
// pinch, gerakan 1 jari saat sudah zoom = geser. Posisi mark disimpan
// dalam ruang gambar ASLI (skala 1x, sebelum transform zoom/geser) --
// nativeEvent.locationX/Y dari PanResponder pada view yang di-transform
// SUDAH otomatis dikoreksi RN relatif ke ukuran aslinya, jadi tidak
// perlu hitung invers transform manual.
export default function DamageDiagram({
  marks,
  onChange,
  colors,
}: {
  marks: DamageMark[];
  onChange: (marks: DamageMark[]) => void;
  colors: typeof darkColors;
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Jumlah titik per jenis kerusakan (hanya jenis yang dipakai), untuk ringkasan di bawah gambar.
  const summary = useMemo(
    () => DAMAGE_CODES.map((c) => ({ ...c, count: marks.filter((m) => m.code === c.value).length })).filter((c) => c.count > 0),
    [marks]
  );
  const [activeCode, setActiveCode] = useState('C');
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const activeCodeRef = useRef(activeCode);
  activeCodeRef.current = activeCode;

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBoxSize({ width, height });
  };

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const currentScale = useRef(1);
  const currentTranslate = useRef({ x: 0, y: 0 });
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const dragStart = useRef({ x: 0, y: 0 });
  // Nyala begitu gesture ini SEMPAT pakai 2 jari (pinch) -- dicek di
  // release supaya tidak dianggap tap. Tanpa ini, saat 2 jari diangkat
  // tidak persis bersamaan, jari terakhir yang lepas kebaca sebagai 1
  // sentuhan dengan gerakan kecil = "tap" yang tidak sengaja nambah
  // mark baru (keluhan user 2026-09-16).
  const hadMultiTouch = useRef(false);

  const resetZoom = () => {
    currentScale.current = 1;
    currentTranslate.current = { x: 0, y: 0 };
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  };

  const handleTapAt = (x: number, y: number) => {
    if (modeRef.current === 'remove') {
      // Cari yang PALING DEKAT dari titik yang masih dalam radius --
      // SEBELUMNYA pakai findIndex (titik PERTAMA yang masuk radius),
      // jadi kalau 2 titik berdekatan, titik yang lebih lama "menang"
      // duluan walau tap-nya lebih dekat ke titik lain (keluhan user
      // 2026-09-16).
      let closestIndex = -1;
      let closestDist = Infinity;
      marksRef.current.forEach((m, i) => {
        const mx = (m.x_percent / 100) * boxSize.width;
        const my = (m.y_percent / 100) * boxSize.height;
        const dist = Math.hypot(mx - x, my - y);
        if (dist <= MARK_HIT_RADIUS && dist < closestDist) {
          closestDist = dist;
          closestIndex = i;
        }
      });

      if (closestIndex >= 0) {
        hapticSuccess();
        onChange(marksRef.current.filter((_, i) => i !== closestIndex));
      }
      return;
    }

    // Mode "Tambah" -- SENGAJA tidak cek titik lama sama sekali (tidak
    // ada logika hapus di sini), supaya menandai titik baru di dekat
    // titik lain tidak pernah tidak-sengaja menghapus titik yang sudah
    // ada (keluhan user 2026-09-16). Hapus cuma lewat mode "Hapus".
    if (!boxSize.width || !boxSize.height) return;
    hapticLight();
    const xPercent = Math.min(100, Math.max(0, (x / boxSize.width) * 100));
    const yPercent = Math.min(100, Math.max(0, (y / boxSize.height) * 100));
    onChange([...marksRef.current, { x_percent: xPercent, y_percent: yPercent, code: activeCodeRef.current }]);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,

        onPanResponderGrant: (e: GestureResponderEvent) => {
          const touches = e.nativeEvent.touches;
          hadMultiTouch.current = touches.length >= 2;
          if (touches.length === 2) {
            pinchStartDistance.current = touchDistance(touches);
            pinchStartScale.current = currentScale.current;
          } else {
            dragStart.current = { ...currentTranslate.current };
          }
        },

        onPanResponderMove: (e: GestureResponderEvent, gesture: PanResponderGestureState) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) hadMultiTouch.current = true;
          if (touches.length === 2) {
            if (!pinchStartDistance.current) {
              pinchStartDistance.current = touchDistance(touches);
              pinchStartScale.current = currentScale.current;
              return;
            }
            const dist = touchDistance(touches);
            const next = Math.max(1, Math.min((pinchStartScale.current * dist) / pinchStartDistance.current, MAX_SCALE));
            currentScale.current = next;
            scale.setValue(next);
          } else if (touches.length === 1 && currentScale.current > 1) {
            const nextX = dragStart.current.x + gesture.dx;
            const nextY = dragStart.current.y + gesture.dy;
            translateX.setValue(nextX);
            translateY.setValue(nextY);
            currentTranslate.current = { x: nextX, y: nextY };
          }
        },

        onPanResponderRelease: (e: GestureResponderEvent, gesture: PanResponderGestureState) => {
          pinchStartDistance.current = 0;

          if (currentScale.current <= 1) {
            currentScale.current = 1;
            resetZoom();
          }

          const wasTap = Math.abs(gesture.dx) < TAP_MOVE_THRESHOLD && Math.abs(gesture.dy) < TAP_MOVE_THRESHOLD;
          if (wasTap && !hadMultiTouch.current && e.nativeEvent.changedTouches.length === 1) {
            handleTapAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
          }

          hadMultiTouch.current = false;
        },
      }),
    [boxSize.width, boxSize.height]
  );

  return (
    <View style={styles.root}>
      {/* Pilihan mode: Tambah atau Hapus titik */}
      <View style={styles.segment}>
        <Pressable
          style={[styles.segmentItem, mode === 'add' && styles.segmentItemActive]}
          onPress={() => {
            hapticLight();
            setMode('add');
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'add' }}
        >
          <Ionicons name="add-circle-outline" size={18} color={mode === 'add' ? colors.accent : colors.textMuted} />
          <Text style={[styles.segmentText, mode === 'add' && styles.segmentTextActive]}>Tambah titik</Text>
        </Pressable>
        <Pressable
          style={[styles.segmentItem, mode === 'remove' && styles.segmentItemActive]}
          onPress={() => {
            hapticLight();
            setMode('remove');
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'remove' }}
        >
          <Ionicons name="trash-outline" size={18} color={mode === 'remove' ? colors.danger : colors.textMuted} />
          <Text style={[styles.segmentText, mode === 'remove' && styles.segmentTextActive]}>Hapus titik</Text>
        </Pressable>
      </View>

      {/* Jenis kerusakan: kode dan namanya tampil langsung, tidak perlu mencocokkan dengan keterangan di bawah */}
      {mode === 'add' ? (
        <View style={styles.codeRow}>
          {DAMAGE_CODES.map((c) => {
            const active = activeCode === c.value;
            return (
              <Pressable
                key={c.value}
                style={[styles.codePill, active && { backgroundColor: `${c.color}22`, borderColor: c.color }]}
                onPress={() => {
                  hapticLight();
                  setActiveCode(c.value);
                }}
                accessibilityRole="button"
                accessibilityLabel={c.label}
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.codeDot, { backgroundColor: c.color }]}>
                  <Text style={styles.codeDotText}>{c.value}</Text>
                </View>
                <Text style={[styles.codeLabel, active && styles.codeLabelActive]} numberOfLines={1}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.hintBox}>
          <Ionicons name="hand-left-outline" size={16} color={colors.danger} />
          <Text style={styles.hintText}>Ketuk titik pada gambar untuk menghapusnya.</Text>
        </View>
      )}

      <View style={styles.diagramBox} onLayout={handleLayout}>
        <Animated.View
          style={[styles.diagramInner, { transform: [{ translateX }, { translateY }, { scale }] }]}
          {...panResponder.panHandlers}
        >
          {boxSize.width > 0 && (
            <Image
              source={require('@/assets/images/car-diagram-top.png')}
              style={{ width: boxSize.width, height: boxSize.height }}
              resizeMode="contain"
            />
          )}

          {marks.map((m, index) => (
            <View
              key={m.id ?? `new-${index}`}
              style={[styles.markDot, { left: `${m.x_percent}%`, top: `${m.y_percent}%`, backgroundColor: colorFor(m.code) }]}
              pointerEvents="none"
            >
              <Text style={styles.markDotText}>{m.code}</Text>
            </View>
          ))}
        </Animated.View>

        <Pressable style={styles.resetZoomBtn} onPress={resetZoom} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembalikan zoom">
          <Ionicons name="scan-outline" size={17} color="#ffffff" />
        </Pressable>
      </View>

      <View style={styles.zoomHint}>
        <Ionicons name="expand-outline" size={14} color={colors.textMuted} />
        <Text style={styles.zoomHintText}>Cubit dua jari untuk zoom, geser untuk melihat detail.</Text>
      </View>

      {/* Ringkasan titik per jenis */}
      {summary.length > 0 ? (
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Ringkasan</Text>
          <View style={styles.summaryRow}>
            {summary.map((s) => (
              <View key={s.value} style={styles.summaryChip}>
                <View style={[styles.summaryDot, { backgroundColor: s.color }]} />
                <Text style={styles.summaryText}>{s.label}</Text>
                <Text style={styles.summaryCount}>{s.count}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: typeof darkColors) {
  // Kotak lembut untuk kontrol di dalam kartu putih; di mode gelap memakai tingkat abu bawaan aplikasi.
  const isDark = colors.bg === darkColors.bg;
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const card = isDark ? colors.surface : '#ffffff';

  return StyleSheet.create({
    root: { gap: 14 },

    segment: { flexDirection: 'row', padding: 4, borderRadius: 18, backgroundColor: chip },
    segmentItem: { flex: 1, height: 42, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    segmentItemActive: {
      backgroundColor: card,
      shadowColor: '#14141b', shadowOffset: { width: 0, height: 1 }, shadowOpacity: isDark ? 0.4 : 0.12, shadowRadius: 3, elevation: 2,
    },
    segmentText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textMuted },
    segmentTextActive: { fontWeight: '700', color: colors.textPrimary },

    codeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    codePill: {
      flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 6, paddingRight: 12, borderRadius: radius.pill,
      borderWidth: 1.5, borderColor: 'transparent', backgroundColor: chip,
    },
    codeDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    codeDotText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
    codeLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    codeLabelActive: { fontWeight: '800', color: colors.textPrimary },

    hintBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 16, backgroundColor: colors.dangerBg },
    hintText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.danger },

    diagramBox: {
      width: '100%',
      aspectRatio: DIAGRAM_ASPECT_RATIO,
      backgroundColor: '#ffffff',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: isDark ? colors.border : '#e8e8ee',
      overflow: 'hidden',
      alignSelf: 'center',
    },
    diagramInner: {
      width: '100%',
      height: '100%',
    },
    resetZoomBtn: {
      position: 'absolute',
      right: 10,
      top: 10,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(20,20,27,0.62)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Titik sedikit lebih besar supaya kode di dalamnya terbaca; area ketuk (MARK_HIT_RADIUS) tidak berubah.
    markDot: {
      position: 'absolute',
      width: 18,
      height: 18,
      marginLeft: -9,
      marginTop: -9,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#ffffff',
    },
    markDotText: { color: '#ffffff', fontSize: 7, fontWeight: '800' },

    zoomHint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    zoomHintText: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.textMuted },

    summary: { gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: isDark ? colors.border : '#e8e8ee' },
    summaryTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    summaryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: chip },
    summaryDot: { width: 8, height: 8, borderRadius: 4 },
    summaryText: { fontSize: 12.5, fontWeight: '600', color: colors.textSecondary },
    summaryCount: { fontSize: 12.5, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  });
}
