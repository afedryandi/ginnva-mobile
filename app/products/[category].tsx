import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';

const WEB_ASSET_BASE = 'https://ginnva.id';

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
    title: 'Film Kaca Mobil',
    enTitle: 'Car Window Film',
    subTitle: 'HIGH-PERFORMANCE CAR WINDOW FILM',
    description:
      'Diproduksi menggunakan teknologi pelapisan magnetron sputtering multi-layer tingkat lanjut. Kaca film Ginnva memberikan penolakan panas (Heat Rejection) infra merah yang ekstrem, perlindungan blokade sinar UV hingga 99%, serta menjaga visibilitas berkendara tetap jernih tanpa mengganggu sinyal GPS maupun seluler.',
    image: '/image/product/car-window-film.webp',
    specs: [
      {
        label: 'A70',
        values: [
          { caption: 'Posisi',    value: 'Depan' },
          { caption: 'Tebal',     value: '2 mil' },
          { caption: 'VLT',       value: '72%' },
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
        a: 'H30 (VLT 28%) dan H15 (VLT 16%) dirancang untuk kaca samping dan belakang. Semakin rendah VLT (Visible Light Transmittance), semakin gelap film dan semakin tinggi tingkat privasi penumpang.',
      },
      {
        q: 'Apakah Ginnva menyediakan garansi digital?',
        a: 'Ya. Setiap produk Ginnva dilengkapi garansi elektronik (E-Warranty) yang dapat diverifikasi melalui aplikasi atau website resmi Ginnva.',
      },
    ],
  },

  // ── Paint Protection Film ────────────────────────────────────────────────
  'film-pelindung-cat': {
    title: 'Paint Protection Film',
    enTitle: 'Film Pelindung Cat',
    subTitle: 'ULTIMATE PAINT PROTECTION',
    description:
      'Ginnva PPF menggunakan 100% Polycaprolactone TPU generasi ke-3 dengan lapisan Crystal-shield coating dan adhesive PS berkinerja tinggi. Tersedia dalam kategori Glossy, Matte, dan Color — memberikan perlindungan maksimal dari benturan kerikil, goresan, korosi, dan cuaca ekstrem, dilengkapi fitur self-healing dan ketahanan anti-yellowing superior (ΔE 0.03 pada QUV 400 jam).',
    image: '/image/product/paint-protection-film.webp',
    specs: [
      {
        label: 'Black Crystal M8-M',
        values: [
          { caption: 'Base Material', value: 'Polycaprolactone TPU' },
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
          { caption: 'Base Material', value: 'Polycaprolactone TPU' },
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
          { caption: 'Base Material', value: 'Polycaprolactone TPU' },
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
          { caption: 'Base Material', value: 'Polycaprolactone TPU' },
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
        a: 'Lapisan Crystal-shield coating menggunakan struktur jaringan silang 3 dimensi (X3) yang dapat memulihkan goresan ringan dengan bantuan panas matahari atau air hangat.',
      },
      {
        q: 'Apakah PPF Ginnva tahan terhadap menguning?',
        a: 'Ya. Uji QUV selama 400 jam menunjukkan nilai color difference (ΔE) Ginnva hanya 0.03 — jauh lebih rendah dibandingkan merek internasional lain (0.20). UV absorber dicampurkan langsung ke dalam substrat PET untuk daya tahan maksimal.',
      },
      {
        q: 'Berapa lama masa garansi PPF Ginnva?',
        a: 'Black Crystal dan Orange Crystal mendapat garansi 8 tahun. Green Crystal EV7 mendapat garansi 5 tahun. Garansi mencakup perlindungan dari gelembung, delaminasi, dan perubahan warna akibat cacat produk.',
      },
    ],
  },

  // ── Color Changing Film (coming soon) ────────────────────────────────────
  'film-pengubah-warna': {
    title: 'Film Pengubah Warna',
    enTitle: 'Color Changing Film',
    subTitle: 'PREMIUM VINYL WRAPPING SOLUTIONS',
    description:
      'Ubah estetika gaya mobil Anda secara instan dengan ratusan pilihan warna eksklusif matt, satin, maupun high-gloss tanpa proses pengecatan ulang yang menurunkan nilai jual kendaraan.',
    image: '/image/product/color-change-film.webp',
    specs: null,
    faqs: [],
    comingSoon: true,
  },

  // ── Architectural Window Film (coming soon) ──────────────────────────────
  'film-kaca-bangunan': {
    title: 'Film Kaca Bangunan',
    enTitle: 'Architectural Window Film',
    subTitle: 'ECO ENERGY SAVING WINDOW FILM',
    description:
      'Solusi efisiensi energi interior untuk gedung perkantoran dan hunian pribadi. Mereduksi beban kerja AC secara signifikan dengan menolak panas matahari langsung yang menembus kaca jendela.',
    image: '/image/product/architectural-window-film.webp',
    specs: null,
    faqs: [],
    comingSoon: true,
  },
};

// ─── FAQ ACCORDION ────────────────────────────────────────────────────────────
function FaqAccordionItem({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable style={faqStyles.item} onPress={() => setOpen((v) => !v)}>
      <View style={faqStyles.qRow}>
        <Text style={faqStyles.question}>{item.q}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.mutedLight}
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

  if (!detail) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Produk" />
        <View style={styles.centerState}>
          <Ionicons name="alert-circle-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>Kategori produk tidak ditemukan.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={detail.title} />
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Hero image */}
        <Image
          source={{ uri: `${WEB_ASSET_BASE}${detail.image}` }}
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
            <Ionicons name="time-outline" size={22} color={colors.mutedLight} />
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
            <Card style={styles.specsCard}>
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
            </Card>
          </>
        )}

        {/* FAQ */}
        {detail.faqs.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Pertanyaan Umum</Text>
            </View>
            <Card style={styles.faqCard}>
              {detail.faqs.map((item) => (
                <FaqAccordionItem key={item.q} item={item} />
              ))}
            </Card>
          </>
        )}

        {/* CTA */}
        <View style={styles.ctaBlock}>
          <Button
            label={detail.comingSoon ? 'Tanya Ketersediaan' : 'Ajukan Penawaran'}
            onPress={() => router.push('/quotation' as never)}
          />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
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
    color: colors.muted,
    textAlign: 'center',
  },
  heroImage: {
    width: '100%',
    height: 220,
    backgroundColor: colors.alt,
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
    color: colors.ink,
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.muted,
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
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.alt,
  },
  comingSoonTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 2,
  },
  comingSoonText: {
    fontSize: fontSize.sm,
    color: colors.muted,
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
    color: colors.ink,
  },
  specsCard: {
    marginHorizontal: spacing.md,
    padding: 0,
    overflow: 'hidden',
  },
  specRow: {
    padding: spacing.md,
  },
  specRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  specLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
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
    color: colors.mutedLight,
  },
  specValue: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.accent,
    marginTop: 2,
  },
  faqCard: {
    marginHorizontal: spacing.md,
    padding: 0,
    overflow: 'hidden',
  },
  ctaBlock: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
});

const faqStyles = StyleSheet.create({
  item: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
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
    color: colors.ink,
  },
  answer: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
});