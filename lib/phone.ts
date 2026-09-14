/**
 * Nomor customer/toko diketik bebas (mis. "08123..." atau "+62812...") —
 * wa.me butuh format internasional tanpa "+"/"0" depan, jadi dinormalisasi
 * di sini, bukan dipercaya mentah-mentah di tiap layar yang butuh link WA.
 */
export function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('62')) return digits;
  return digits;
}
