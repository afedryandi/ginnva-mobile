import React, { useState } from 'react';
import { View, Pressable, StyleSheet, type TextInputProps } from 'react-native';
import { AppTextInput as TextInput } from '@/components/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '@/lib/theme-context';

/**
 * Kolom password dengan tombol mata untuk menampilkan/menyembunyikan isinya (2026-11-10, permintaan pemilik).
 * Bawaannya tersembunyi. Setiap kolom punya status sendiri, jadi menampilkan "Password Baru" tidak ikut
 * menampilkan "Konfirmasi". Semua properti TextInput diteruskan apa adanya.
 */
export function PasswordInput({ style, ...props }: Omit<TextInputProps, 'secureTextEntry'>) {
  const { colors } = useAppTheme();
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.wrap}>
      <TextInput
        {...props}
        style={[style, styles.inputPad]}
        secureTextEntry={!visible}
        autoCapitalize={props.autoCapitalize ?? 'none'}
        autoCorrect={false}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        style={styles.eye}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Sembunyikan password' : 'Tampilkan password'}
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', justifyContent: 'center' },
  inputPad: { paddingRight: 48 },
  eye: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 48, alignItems: 'center', justifyContent: 'center' },
});
