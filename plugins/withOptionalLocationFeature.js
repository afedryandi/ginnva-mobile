const { withAndroidManifest } = require('expo/config-plugins');

// Google Play Console mulai mengecualikan perangkat tanpa hardware GPS
// (mis. scanner genggam industri seperti DSIC DS50, atau tablet murah
// tanpa chip GPS) sejak app ini minta izin lokasi lewat expo-location
// (dipakai untuk validasi radius absensi) -- Android SECARA OTOMATIS
// menambahkan <uses-feature android:name="android.hardware.location"
// required="true"> begitu ACCESS_*_LOCATION diminta, kecuali dioverride
// eksplisit jadi required="false" di sini. Ditemukan 2026-09-30 lewat
// peringatan Play Console "Rilis ini tidak lagi mendukung 6 perangkat".
//
// required="false" AMAN untuk app ini -- Attendance::clockIn()/clockOut()
// di sisi mobile (app/staff/attendance/index.tsx) sudah menangani kasus
// GPS tidak tersedia lewat pesan error biasa, tidak crash; staff di
// perangkat tanpa GPS cuma tidak bisa absen (fitur lain tetap jalan),
// bukan "app sama sekali tidak bisa diinstall" seperti sebelumnya.
const LOCATION_FEATURES = [
  'android.hardware.location',
  'android.hardware.location.gps',
  'android.hardware.location.network',
];

module.exports = function withOptionalLocationFeature(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest['uses-feature'] = manifest['uses-feature'] || [];

    for (const name of LOCATION_FEATURES) {
      const already = manifest['uses-feature'].some(
        (f) => f.$ && f.$['android:name'] === name
      );

      if (!already) {
        manifest['uses-feature'].push({
          $: { 'android:name': name, 'android:required': 'false' },
        });
      }
    }

    return config;
  });
};
