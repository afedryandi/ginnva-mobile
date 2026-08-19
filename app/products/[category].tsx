import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

const PRODUCT_IMAGES: Record<string, number> = {
  'kaca-film-mobil':    require('@/assets/images/car-window-film.webp'),
  'film-pelindung-cat': require('@/assets/images/paint-protection-film.webp'),
  'film-pengubah-warna': require('@/assets/images/color-change-film.webp'),
  'film-kaca-bangunan': require('@/assets/images/architectural-window-film.webp'),
};

interface SpecRow {
  label: string;
  values: { caption: string; value: string }[];
}

interface FaqItem {
  q: string;
  a: string;
}

interface ProductDetail {
  title: string;
  enTitle: string;
  subTitle: string;
  description: string;
  image: string;
  specs: SpecRow[] | null;   // null = produk coming soon, tidak tampilkan tabel
  faqs: FaqItem[];
  comingSoon?: boolean;
}

// ─── DATA PRODUK ─────────────────────────────────────────────────────────────
// Konten sinkron dengan app/product/*/page.tsx di ginnva-web.
// Spec mengacu pada tabel spesifikasi teknis resmi dari company profile Indonesia.
const PRODUCT_DETAILS: Record<string, ProductDetail> = {

  // ── Car Window Film ──────────────────────────────────────────────────────
  'kaca-film-mobil': {
    title: 'Kaca Film Mobil',
    enTitle: 'Car Window Film',
    subTitle: 'KACA FILM MOBIL PERFORMA TINGGI',
    description:
      'Kaca Film Mobil Ginnva menggunakan teknologi pelapisan Magnetron Sputtering Multi-Layer dan Nano-Ceramic tingkat lanjut. Tersedia dalam berbagai seri mulai dari Bi-silver Sputtering (garansi 10 tahun) hingga Nano-Ceramic (garansi 8 tahun). Semua seri memberikan perlindungan UV hingga 99%, penolakan panas inframerah superior, dan kejernihan optik tinggi — tanpa mengganggu sinyal GPS maupun e-Toll.',
    image: '/image/product/car-window-film.webp',
    specs: [
      {
        label: 'A70',
        values: [
          { caption: 'Posisi',    value: 'Depan' },
          { caption: 'Tebal',     value: '2 mil' },
          { caption: 'VLT',       value: '72%' },
          { caption: 'VLR',       value: '10%' },
          { caption: 'Blokir UV', value: '99%' },
          { caption: 'TSER',      value: '61%' },
          { caption: 'Garansi',   value: '10 Tahun' },
        ],
      },
      {
        label: 'H70',
        values: [
          { caption: 'Posisi',    value: 'Depan' },
          { caption: 'Tebal',     value: '2 mil' },
          { caption: 'VLT',       value: '72%' },
          { caption: 'VLR',       value: '8%' },
          { caption: 'Blokir UV', value: '99%' },
          { caption: 'TSER',      value: '47%' },
          { caption: 'Garansi',   value: '8 Tahun' },
        ],
      },
      {
        label: 'H30',
        values: [
          { caption: 'Posisi',    value: 'Samping/Belakang' },
          { caption: 'Tebal',     value: '2 mil' },
          { caption: 'VLT',       value: '28%' },
          { caption: 'VLR',       value: '6%' },
          { caption: 'Blokir UV', value: '99%' },
          { caption: 'TSER',      value: '56%' },
          { caption: 'Garansi',   value: '8 Tahun' },
        ],
      },
      {
        label: 'H15',
        values: [
          { caption: 'Posisi',    value: 'Samping/Belakang' },
          { caption: 'Tebal',     value: '2 mil' },
          { caption: 'VLT',       value: '16%' },
          { caption: 'VLR',       value: '5%' },
          { caption: 'Blokir UV', value: '99%' },
          { caption: 'TSER',      value: '65%' },
          { caption: 'Garansi',   value: '8 Tahun' },
        ],
      },
    ],
    faqs: [
      {
        q: 'Apakah kaca film Ginnva mengganggu sinyal GPS atau e-Toll?',
        a: 'Tidak. Teknologi sputtering Ginnva dirancang agar tidak memblokir gelombang elektromagnetik, sehingga sinyal HP, GPS, dan e-Toll tetap berfungsi normal setelah pemasangan.',
      },
      {
        q: 'Berapa lama masa garansi resmi Ginnva?',
        a: 'Seri A70 mendapat garansi 10 tahun. Seri H70, H30, dan H15 mendapat garansi 8 tahun — mencakup perlindungan dari gelembung, korosi, dan perubahan warna akibat cacat produk. Garansi diterbitkan secara digital melalui sistem E-Warranty resmi Ginnva.',
      },
      {
        q: 'Apa perbedaan seri A70 dan H70?',
        a: 'A70 menggunakan teknologi Bi-silver Sputtering dengan TSER 61% dan garansi 10 tahun — cocok untuk kaca depan dengan performa penolakan panas tertinggi. H70 menggunakan Nano-Ceramic dengan TSER 47% dan garansi 8 tahun, ideal untuk kaca depan dengan nilai lebih terjangkau.',
      },
      {
        q: 'Mengapa H30 dan H15 lebih gelap dari A70/H70?',
        a: 'H30 (VLT 28%) dan H15 (VLT 16%) dirancang khusus untuk kaca samping dan belakang. Kaca di area ini umumnya dipasang film lebih gelap untuk meningkatkan privasi penumpang. Semakin rendah nilai VLT, semakin gelap tampilan film dan semakin tinggi tingkat privasi yang didapat.',
      },
      {
        q: 'Apakah Ginnva menyediakan garansi digital?',
        a: 'Ya. Setiap pemasangan produk Ginnva dilengkapi E-Warranty resmi yang diterbitkan secara digital — mencakup data kendaraan, produk yang dipasang, tanggal pemasangan, dan masa berlaku garansi. Garansi dapat diverifikasi kapan saja melalui sistem E-Warranty Ginnva Indonesia.',
      },
    ],
  },

  // ── Paint Protection Film ────────────────────────────────────────────────
  'film-pelindung-cat': {
    title: 'Film Pelindung Cat',
    enTitle: 'Paint Protection Film',
    subTitle: 'FILM PELINDUNG CAT PREMIUM',
    description:
      'Ginnva PPF menggunakan bahan 100% TPU 3rd Generation dengan lapisan Crystal-Shield dan adhesive berkinerja tinggi. Tersedia dalam seri Black Crystal, Orange Crystal, dan Green Crystal. Melindungi cat dari goresan, benturan kerikil, dan korosi, dilengkapi kemampuan self-healing, ketahanan anti-yellowing superior, dan efek Super Hydrophobic yang membuat permukaan selalu bersih.',
    image: '/image/product/paint-protection-film.webp',
    specs: [
      {
        label: 'Black Crystal M8-M',
        values: [
          { caption: 'Base Material', value: 'TPU 3rd Generation' },
          { caption: 'Coating',       value: 'Hydrophobic' },
          { caption: 'Finishing',     value: 'Matte' },
          { caption: 'Ketebalan',     value: '7.5 ± 3% mil' },
          { caption: 'Linear',        value: '1.52 × 15 m' },
          { caption: 'Garansi',       value: '8 Tahun' },
        ],
      },
      {
        label: 'Orange Crystal M10',
        values: [
          { caption: 'Base Material', value: 'TPU 3rd Generation' },
          { caption: 'Coating',       value: 'Hydrophobic' },
          { caption: 'Finishing',     value: 'Gloss' },
          { caption: 'Ketebalan',     value: '8.8 ± 3% mil' },
          { caption: 'Linear',        value: '1.52 × 15 m' },
          { caption: 'Garansi',       value: '8 Tahun' },
        ],
      },
      {
        label: 'Orange Crystal H10',
        values: [
          { caption: 'Base Material', value: 'TPU 3rd Generation' },
          { caption: 'Coating',       value: 'Hydrophobic' },
          { caption: 'Finishing',     value: 'Gloss' },
          { caption: 'Ketebalan',     value: '7.8 ± 3% mil' },
          { caption: 'Linear',        value: '1.52 × 15 m' },
          { caption: 'Garansi',       value: '8 Tahun' },
        ],
      },
      {
        label: 'Green Crystal EV7',
        values: [
          { caption: 'Base Material', value: 'TPU 3rd Generation' },
          { caption: 'Coating',       value: 'Hydrophilic' },
          { caption: 'Finishing',     value: 'Gloss' },
          { caption: 'Ketebalan',     value: '7.5 ± 3% mil' },
          { caption: 'Linear',        value: '1.52 × 15 m' },
          { caption: 'Garansi',       value: '5 Tahun' },
        ],
      },
    ],
    faqs: [
      {
        q: 'Apa itu PPF dan apa bedanya dengan coating?',
        a: 'PPF adalah lapisan film TPU transparan yang memberikan perlindungan fisik dari benturan kerikil dan goresan. Berbeda dengan coating, PPF memiliki ketebalan nyata (7.5–8.8 mil) yang menyerap dampak fisik langsung dan mampu self-healing terhadap goresan ringan.',
      },
      {
        q: 'Apakah PPF Ginnva aman untuk cat asli kendaraan?',
        a: 'Ya. Adhesive PS Ginnva diformulasikan agar tidak merusak cat asli — daya rekat kuat namun tetap aman saat dilepas. Tidak meninggalkan residu dan tidak mengubah warna cat di bawahnya.',
      },
      {
        q: 'Apa itu fitur self-healing pada PPF Ginnva?',
        a: 'Lapisan Crystal-Shield coating memiliki kemampuan pemulihan mandiri berkat struktur jaringan silang tiga dimensi yang elastis. Goresan ringan dan swirl mark pada permukaan film dapat pulih sendiri dengan bantuan panas matahari atau air hangat — menjaga tampilan kendaraan tetap sempurna tanpa perlu dipoles ulang.',
      },
      {
        q: 'Apakah PPF Ginnva tahan terhadap menguning?',
        a: 'Ya. PPF Ginnva memiliki ketahanan anti-yellowing superior yang diuji melalui uji akselerasi QUV selama 400 jam. Hasilnya menunjukkan perubahan warna yang sangat minimal — berkat UV absorber yang dicampurkan langsung ke dalam substrat film, bukan hanya di lapisan adhesive, sehingga perlindungannya jauh lebih tahan lama.',
      },
      {
        q: 'Berapa lama masa garansi PPF Ginnva?',
        a: 'Black Crystal dan Orange Crystal mendapat garansi 8 tahun. Green Crystal EV7 mendapat garansi 5 tahun. Garansi mencakup perlindungan dari gelembung, delaminasi, dan perubahan warna akibat cacat produk.',
      },
    ],
  },

  // ── Car Color Change Film (coming soon) ──────────────────────────────────
  'film-pengubah-warna': {
    title: 'Film Pengubah Warna',
    enTitle: 'Color Change Film',
    subTitle: 'FILM PENGUBAH WARNA KENDARAAN',
    description:
      'Ginnva Color Change Film hadir dalam berbagai pilihan warna dan finishing tekstur premium — matte, satin, hingga ultra-gloss — berbasis material PVC berkualitas tinggi. Dipasang presisi menggunakan pola digital cutting sesuai tipe kendaraan, tampilan baru bisa dinikmati tanpa mengorbankan nilai jual kendaraan.',
    image: '/image/product/color-change-film.webp',
    specs: null,
    faqs: [],
    comingSoon: true,
  },

  // ── Architectural Window Film (coming soon) ──────────────────────────────
  'film-kaca-bangunan': {
    title: 'Film Kaca Bangunan',
    enTitle: 'Architectural Film',
    subTitle: 'FILM KACA HEMAT ENERGI',
    description:
      'Ginnva Architectural Film dirancang untuk kaca gedung dan hunian: menolak panas secara signifikan, memblokir UV hingga 99%, meningkatkan privasi, serta memberikan perlindungan tambahan dari pecahan kaca. Hasilnya adalah interior yang lebih sejuk, nyaman, dan hemat energi sepanjang hari.',
    image: '/image/product/architectural-window-film.webp',
    specs: null,
    faqs: [],
    comingSoon: true,
  },
};

// ─── FAQ ACCORDION ────────────────────────────────────────────────────────────
function FaqAccordionItem({ item, colors }: { item: FaqItem; colors: typeof darkColors }) {
  const [open, setOpen] = useState(false);
  const faqStyles = useMemo(() => createFaqStyles(colors), [colors]);
  return (
    <Pressable style={faqStyles.item} onPress={() => setOpen((v) => !v)}>
      <View style={faqStyles.qRow}>
        <Text style={faqStyles.question}>{item.q}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </View>
      {open && <Text style={faqStyles.answer}>{item.a}</Text>}
    </Pressable>
  );
}

// ─── SCREEN ───────────────────────────────────────────────────────────────────
export default function ProductDetailScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const detail = category ? PRODUCT_DETAILS[category] : undefined;
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  if (!detail) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <View style={styles.header}>
          {router.canGoBack() ? (
            <Pressable onPress={() => router.back()} style={styles.sideButton}>
              <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
            </Pressable>
          ) : (
            <View style={styles.sideButton} />
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>Produk</Text>
          <View style={styles.sideButton} />
        </View>
        <View style={styles.centerState}>
          <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>Kategori produk tidak ditemukan.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>{detail.title}</Text>
        <View style={styles.sideButton} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* CTA dipindah keluar ScrollView jadi footer menempel (lihat di
            bawah) — supaya selalu terlihat, tidak perlu scroll sampai
            habis melewati tabel spesifikasi + FAQ yang bisa panjang. */}

        {/* Hero image */}
        <Image
          source={PRODUCT_IMAGES[category] ?? require('@/assets/images/car-window-film.webp')}
          style={styles.heroImage}
          contentFit="cover"
        />

        {/* Intro */}
        <View style={styles.introBlock}>
          <Text style={styles.subTitle}>{detail.subTitle}</Text>
          <Text style={styles.enTitle}>{detail.enTitle}</Text>
          <Text style={styles.description}>{detail.description}</Text>
        </View>

        {/* Coming Soon badge */}
        {detail.comingSoon && (
          <View style={styles.comingSoonBox}>
            <Ionicons name="time-outline" size={22} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.comingSoonTitle}>Segera Hadir di Indonesia</Text>
              <Text style={styles.comingSoonText}>
                Produk ini sedang dalam persiapan. Hubungi kami untuk informasi ketersediaan lebih lanjut.
              </Text>
            </View>
          </View>
        )}

        {/* Tabel Spesifikasi */}
        {detail.specs && detail.specs.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Spesifikasi Teknis</Text>
            </View>
            <View style={styles.specsCard}>
              {detail.specs.map((row, i) => (
                <View
                  key={row.label}
                  style={[
                    styles.specRow,
                    i !== (detail.specs as SpecRow[]).length - 1 && styles.specRowBorder,
                  ]}
                >
                  <Text style={styles.specLabel}>{row.label}</Text>
                  <View style={styles.specGrid}>
                    {row.values.map((v) => (
                      <View key={v.caption} style={styles.specItem}>
                        <Text style={styles.specCaption}>{v.caption}</Text>
                        <Text style={styles.specValue}>{v.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* FAQ */}
        {detail.faqs.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Pertanyaan Umum</Text>
            </View>
            <View style={styles.faqCard}>
              {detail.faqs.map((item) => (
                <FaqAccordionItem key={item.q} item={item} colors={colors} />
              ))}
            </View>
          </>
        )}

      </ScrollView>

      {/* CTA — footer menempel di luar ScrollView, selalu terlihat */}
      <View style={[styles.ctaBlock, { paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.md }]}>
        <Button
          label={detail.comingSoon ? 'Daftarkan Minat Saya' : 'Ajukan Penawaran'}
          onPress={() => {
            if (detail.comingSoon) {
              // Produk belum dijual — arahkan ke form /inquiry (tersimpan
              // ke backend/Filament sebagai ProductInquiry), BUKAN buka
              // WhatsApp langsung — supaya minat customer benar-benar
              // tercatat di sistem, bukan cuma jadi chat yang gampang
              // hilang. Nama produk dikirim lewat param supaya form bisa
              // prefill catatan (ProductInquiry tidak punya kolom produk
              // sendiri, cuma customer_name/contact/message bebas).
              router.push({
                pathname: '/inquiry',
                params: { product: detail.title },
              } as never);
            } else {
              router.push('/quotation' as never);
            }
          }}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
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
    sideButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: colors.textPrimary,
      flex: 1,
      textAlign: 'center',
    },
    scrollContent: {
      paddingBottom: spacing.xxl,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
    },
    centerStateText: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    heroImage: {
      width: '100%',
      height: 220,
      backgroundColor: colors.surface,
    },
    introBlock: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      gap: spacing.xs,
    },
    subTitle: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.accent,
      letterSpacing: 0.8,
    },
    enTitle: {
      fontSize: fontSize.xl,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    description: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      lineHeight: 22,
      marginTop: spacing.xs,
    },
    comingSoonBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.lg,
      padding: spacing.md,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    comingSoonTitle: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 2,
    },
    comingSoonText: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    sectionHeader: {
      paddingHorizontal: spacing.md,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    specsCard: {
      marginHorizontal: spacing.md,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    specRow: {
      padding: spacing.md,
    },
    specRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    specLabel: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    specGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      rowGap: spacing.md,
    },
    specItem: {
      width: '46%',
    },
    specCaption: {
      fontSize: fontSize.xs,
      color: colors.textMuted,
    },
    specValue: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.accent,
      marginTop: 2,
    },
    faqCard: {
      marginHorizontal: spacing.md,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    ctaBlock: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.bg,
    },
  });
}

function createFaqStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    item: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    qRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    question: {
      flex: 1,
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    answer: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginTop: spacing.sm,
      lineHeight: 20,
    },
  });
}
