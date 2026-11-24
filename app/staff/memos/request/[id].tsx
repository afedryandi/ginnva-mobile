import MemoDetailScreen from '@/components/staff/MemoDetailScreen';

// Memo pengajuan installer: tampilan yang sama dengan memo langsung, ditambah status persetujuan dan tombol Setujui/Tolak/Selesai Diserahkan/Minta Tambahan.
export default function RequestMemoRoute() {
  return <MemoDetailScreen mode="request" />;
}
