import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface MaterialListItem {
  id: number;
  name: string;
  category: string | null;
  unit: string;
  current_stock: string;
  reorder_point: string | null;
}

// Bahan baku TIDAK punya kode fisik per unit (beda dari Barang/Aset yang
// bisa discan QR) — jadi dicari lewat nama di sini, bukan scan kamera.
export default function MaterialsSearchScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [search, setSearch] = useState('');
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMaterials = useCallback((query: string) => {
    setLoading(true);
    setError(null);
    staffApiFetch<{ data: MaterialListItem[] }>(`/api/staff/materials?search=${encodeURIComponent(query)}`)
      .then((res) => setMaterials(res.data))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar bahan baku.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => fetchMaterials(search), 300);
    return () => clearTimeout(timeout);
  }, [search, fetchMaterials]);

  const isLowStock = (m: MaterialListItem) =>
    m.reorder_point !== null && parseFloat(m.current_stock) <= parseFloat(m.reorder_point);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Bahan Baku</Text>
        <View style={styles.sideButton} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nama bahan..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoFocus
        />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error}</Text>
        </View>
      ) : materials.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.centerStateText}>Tidak ada bahan baku ditemukan.</Text>
        </View>
      ) : (
        <FlatList
          data={materials}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/staff/materials/[id]', params: { id: String(item.id) } } as never)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                {item.category && <Text style={styles.rowCategory}>{item.category}</Text>}
              </View>
              <Text style={[styles.rowStock, isLowStock(item) && { color: colors.danger }]}>
                {parseFloat(item.current_stock).toLocaleString('id-ID')} {item.unit}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.sm,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    listContent: { padding: spacing.md, gap: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    rowCategory: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    rowStock: { fontSize: fontSize.sm, fontWeight: '700', color: colors.success },
  });
}
