import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  FlatList,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { darkColors, spacing } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';

interface Props {
  visible: boolean;
  title: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
  searchPlaceholder?: string;
}

// Tampilan didesain ulang (2026-11-24): lembar bersudut besar, judul tebal, kolom cari pil, dan baris pilihan tanpa garis dengan baris
// terpilih berlatar lembut. Logika pencarian dan pengangkatan di atas keyboard tidak berubah.
export function PickerModal({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  searchPlaceholder = 'Cari...',
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');

  // SEBELUMNYA query TIDAK di-trim sebelum dibandingkan — kalau ada spasi
  // nyangkut di akhir ketikan (mis. "Toyota " lewat keyboard suggestion/
  // autocomplete), "toyota".includes("toyota ") selalu false karena
  // string yang dicari lebih panjang, jadi hasil selalu kosong padahal
  // datanya ada. Bug dilaporkan user 2026-08-27.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [query, options]);

  // KeyboardAvoidingView TIDAK reliable di dalam React Native Modal,
  // khususnya Android — Modal render di layer native terpisah yang tidak
  // ikut logic auto-resize KeyboardAvoidingView. SEBELUMNYA daftar hasil
  // pencarian ketutup keyboard begitu keyboard muncul. Solusinya: lacak
  // tinggi keyboard manual lewat Keyboard API, dorong sheet ke atas
  // sejumlah itu, bukan mengandalkan KeyboardAvoidingView sama sekali.
  // Bug dilaporkan user 2026-08-27.
  // Kartu diangkat tepat di atas keyboard tanpa mengangkat dua kali bila sistem sudah mengecilkan window modal (lihat lib/use-keyboard-lift.ts).
  const { keyboardVisible, lift, onBoxLayout } = useKeyboardLift();

  const handleSelect = (value: string) => {
    onSelect(value);
    setQuery('');
    onClose();
  };

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType={Platform.OS === 'ios' ? 'slide' : 'fade'} transparent onRequestClose={handleClose}>
      <View style={{ flex: 1 }} onLayout={onBoxLayout}>
      <Pressable style={styles.overlay} onPress={handleClose} />
      <View
        style={[
          styles.sheet,
          {
            paddingBottom: keyboardVisible ? spacing.md : insets.bottom + spacing.md,
            marginBottom: lift,
            maxHeight: keyboardVisible ? '55%' : '75%',
          },
        ]}
      >
        {/* Handle bar */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Tutup">
            <Ionicons name="close" size={20} color={colors.textPrimary} />
          </Pressable>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>

        {/* List */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Tidak ditemukan</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isSelected = item === selected;
            return (
              <Pressable
                style={[styles.option, isSelected && styles.optionSelected]}
                onPress={() => handleSelect(item)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {item}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                )}
              </Pressable>
            );
          }}
        />
      </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      maxHeight: '75%',
      paddingHorizontal: 24,
      paddingTop: 12,
    },
    handle: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
    title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
    closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 16, marginBottom: 10, borderRadius: 25, backgroundColor: colors.surfaceElevated },
    searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, height: 48, padding: 0 },
    option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18 },
    optionSelected: { backgroundColor: colors.accentSoft },
    optionText: { flex: 1, fontSize: 15, color: colors.textPrimary },
    optionTextSelected: { fontWeight: '800', color: colors.accent },
    empty: { paddingVertical: 40, alignItems: 'center' },
    emptyText: { fontSize: 14, color: colors.textMuted },
  });
}
