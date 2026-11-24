import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { darkColors, spacing } from '@/constants/theme';
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
    <PressableScale
      style={[faqStyles.item, open && faqStyles.itemOpen]}
      onPress={() => setOpen((v) => !v)}
      scaleTo={0.99}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <View style={faqStyles.qRow}>
        <Text style={faqStyles.question}>{item.q}</Text>
        <View style={[faqStyles.chevron, open && faqStyles.chevronOpen]}>
          <Ionicons name={open ? 'remove' : 'add'} size={18} color={open ? '#ffffff' : colors.textSecondary} />
        </View>
      </View>
      {open && <Text style={faqStyles.answer}>{item.a}</Text>}
    </PressableScale>
  );
}

// ─── SCREEN ───────────────────────────────────────────────────────────────────
export default function ProductDetailScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const detail = category ? PRODUCT_DETAILS[category] : undefined;
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const backButton = router.canGoBack() ? (
    <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
      <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
    </Pressable>
  ) : null;

  if (!detail) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <View style={styles.plainTop}>{backButton}</View>
        <View style={styles.centerState}>
          <View style={styles.centerIcon}>
            <Ionicons name="alert-circle-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateText}>Kategori produk tidak ditemukan.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Foto penuh di atas: ikon status selalu terang karena latar foto gelap. */}
      <StatusBar style="light" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Image
            source={PRODUCT_IMAGES[category] ?? require('@/assets/images/car-window-film.webp')}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.25)']}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          {detail.comingSoon && (
            <View style={[styles.heroBadge, { top: insets.top + 12 }]}>
              <Ionicons name="time-outline" size={13} color="#ffffff" />
              <Text style={styles.heroBadgeText}>Segera Hadir</Text>
            </View>
          )}
        </View>

        {/* Isi menimpa foto dengan sudut atas membulat */}
        <View style={styles.sheet}>
          <FadeInUp>
            <Text style={styles.subTitle}>{detail.subTitle}</Text>
            <Text style={styles.enTitle}>{detail.enTitle}</Text>
            <Text style={styles.description}>{detail.description}</Text>
          </FadeInUp>

          {detail.comingSoon && (
            <View style={styles.comingSoonBox}>
              <View style={styles.comingSoonIcon}>
                <Ionicons name="time-outline" size={22} color={colors.accent} />
              </View>
              <View style={styles.comingSoonBody}>
                <Text style={styles.comingSoonTitle}>Segera Hadir di Indonesia</Text>
                <Text style={styles.comingSoonText}>
                  Produk ini sedang dalam persiapan. Hubungi kami untuk informasi ketersediaan lebih lanjut.
                </Text>
              </View>
            </View>
          )}

          {/* Spesifikasi: satu kartu per seri */}
          {detail.specs && detail.specs.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Spesifikasi Teknis</Text>
              {detail.specs.map((row) => {
                // Garansi tampil sebagai lencana di kepala kartu; sisanya jadi
                // kotak-kotak kecil supaya angka mudah dipindai.
                const warranty = row.values.find((v) => v.caption === 'Garansi');
                const rest = row.values.filter((v) => v.caption !== 'Garansi');
                return (
                  <View key={row.label} style={styles.specCard}>
                    <View style={styles.specHead}>
                      <Text style={styles.specLabel} numberOfLines={2}>{row.label}</Text>
                      {warranty ? (
                        <View style={styles.warrantyPill}>
                          <Ionicons name="shield-checkmark-outline" size={14} color={colors.accent} />
                          <Text style={styles.warrantyText}>{warranty.value}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.specGrid}>
                      {rest.map((v) => (
                        <View key={v.caption} style={styles.specTile}>
                          <Text style={styles.specCaption}>{v.caption}</Text>
                          <Text style={styles.specValue}>{v.value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* FAQ */}
          {detail.faqs.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pertanyaan Umum</Text>
              {detail.faqs.map((item) => (
                <FaqAccordionItem key={item.q} item={item} colors={colors} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Tombol kembali mengambang di atas foto */}
      <View style={[styles.floatingTop, { top: insets.top + 8 }]} pointerEvents="box-none">
        {backButton}
      </View>

      {/* CTA — footer menempel di luar ScrollView, selalu terlihat */}
      <View style={[styles.ctaBlock, { paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.md }]}>
        <PressableScale
          style={styles.ctaButton}
          accessibilityRole="button"
          onPress={() => {
            if (detail.comingSoon) {
              // Produk belum dijual — arahkan ke form /inquiry (tersimpan
              // ke backend/Filament sebagai ProductInquiry), BUKAN buka
              // WhatsApp langsung — supaya minat customer benar-benar
              // tercatat di sistem, bukan cuma jadi chat yang gampang
              // hilang. Nama produk dikirim lewat param supaya form bisa
              // menampilkannya (ProductInquiry tidak punya kolom produk
              // sendiri, cuma customer_name/contact/message bebas).
              router.push({
                pathname: '/inquiry',
                params: { product: detail.title },
              } as never);
            } else {
              router.push('/quotation' as never);
            }
          }}
        >
          <Text style={styles.ctaText}>{detail.comingSoon ? 'Daftarkan Minat Saya' : 'Ajukan Penawaran'}</Text>
          <Ionicons name="arrow-forward" size={18} color="#ffffff" />
        </PressableScale>
      </View>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    scrollContent: { paddingBottom: 32 },

    plainTop: { minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 80 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    centerStateText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },

    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    floatingTop: { position: 'absolute', left: 24 },

    hero: { height: 300, backgroundColor: colors.surfaceElevated },
    heroBadge: { position: 'absolute', right: 24, flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.5)' },
    heroBadgeText: { fontSize: 12, fontWeight: '800', color: '#ffffff' },

    sheet: { marginTop: -32, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 8, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: colors.bg, gap: 8 },
    subTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.9, color: colors.accent },
    enTitle: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary, marginTop: 4 },
    description: { fontSize: 15, lineHeight: 24, color: colors.textSecondary, marginTop: 8 },

    comingSoonBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginTop: 16, padding: 18, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    comingSoonIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    comingSoonBody: { flex: 1, gap: 2 },
    comingSoonTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    comingSoonText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },

    section: { gap: 12, marginTop: 24 },
    sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },

    specCard: { gap: 16, padding: 18, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    specHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    specLabel: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    warrantyPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.accentSoft },
    warrantyText: { fontSize: 12, fontWeight: '800', color: colors.accent },
    specGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    specTile: { flexGrow: 1, flexBasis: '30%', minWidth: 96, gap: 2, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.bg },
    specCaption: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
    specValue: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: colors.textPrimary },

    ctaBlock: { paddingHorizontal: 24, paddingTop: 12, backgroundColor: colors.bg },
    ctaButton: { flexDirection: 'row', gap: 8, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    ctaText: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  });
}

function createFaqStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    item: { padding: 18, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    itemOpen: { backgroundColor: colors.accentSoft },
    qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    question: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.textPrimary },
    chevron: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    chevronOpen: { backgroundColor: colors.accent },
    answer: { fontSize: 14, lineHeight: 22, color: colors.textSecondary, marginTop: 12 },
  });
}
