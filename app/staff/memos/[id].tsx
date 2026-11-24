import MemoDetailScreen from '@/components/staff/MemoDetailScreen';

// Memo langsung (dibuat gudang atau akses penuh). Layarnya dipakai bersama memo pengajuan lewat components/staff/MemoDetailScreen.
export default function DirectMemoRoute() {
  return <MemoDetailScreen mode="direct" />;
}
