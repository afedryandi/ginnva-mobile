import { Redirect, useLocalSearchParams } from 'expo-router';

// Daftar Lead Quotation sudah digabung ke layar Lead (2026-11-13). Rute lama tetap hidup supaya tautan notifikasi lama
// ('/staff/quotations?status=new') tidak putus -- langsung dialihkan dengan filter yang sama.
export default function StaffQuotationsRedirect() {
  const { status } = useLocalSearchParams<{ status?: string }>();
  const query = status ? `&status=${encodeURIComponent(status)}` : '';
  return <Redirect href={`/staff/leads?type=quotation${query}` as never} />;
}
