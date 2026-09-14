import React, { useState, useMemo, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  Platform,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

interface Props {
  visible: boolean;
  title: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
  searchPlaceholder?: string;
}

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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
      <Pressable style={styles.overlay} onPress={handleClose} />
      <View
        style={[
          styles.sheet,
          {
            paddingBottom: insets.bottom + spacing.md,
            marginBottom: keyboardHeight,
            maxHeight: keyboardHeight ? '55%' : '75%',
          },
        ]}
      >
        {/* Handle bar */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={handleClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
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
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {item}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark" size={18} color={colors.accent} />
                )}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    marginRight: spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    height: 40,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionSelected: {
    backgroundColor: colors.accentSoft,
  },
  optionText: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  optionTextSelected: {
    fontWeight: '700',
    color: colors.accent,
  },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  });
}
