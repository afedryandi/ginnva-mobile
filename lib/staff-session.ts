// Sesi staf yang diakhiri server (token kedaluwarsa/dicabut, atau akun dinonaktifkan admin).
// staffApiFetch memanggil notifySessionEnded(); StaffAuthProvider mendengarkan, menghapus token, dan mengembalikan ke layar login.

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySessionEnded(json: any): void {
  const message = json?.message || 'Sesi berakhir. Masuk lagi ya.';

  listeners.forEach((listener) => listener(message));
}
