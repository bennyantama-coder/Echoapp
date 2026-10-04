# EchoVue PWA 0.2

Prototype web/PWA untuk membuka arsip GE MPEGVue di MacBook atau Windows tanpa mengunggah data pasien.

## Yang sudah tersedia

- Membaca folder secara lokal dari browser.
- Memindai `Exam.ini` secara rekursif.
- Membuat tabel ID, nama pasien, tanggal pemeriksaan, tanggal lahir, dan jumlah image/cine.
- Menampilkan thumbnail `m0_small.jpg`, `m1_small.jpg`, dst bila tersedia.
- Memutar MP4/MOV/M4V langsung.
- WMV dikonversi **di browser** menjadi MP4 sementara menggunakan FFmpeg WebAssembly. File asli tidak diubah dan tidak diunggah.
- Cine loop, play/pause/stop, frame-step ±1/30 detik, previous/next cine, scrub timeline, speed 0.25–2x.
- WebGL enhancement: brightness, contrast, gamma, sharpness.
- Preset Original, GE-like, Custom.
- Screenshot PNG.
- PWA installable bila disajikan melalui HTTPS atau localhost.

## Browser yang disarankan di MacBook

**Google Chrome terbaru.** Safari dapat membuka web app, tetapi folder picker, codec, dan WebAssembly lebih konsisten di Chrome untuk prototype ini.

## Penting tentang WMV

Browser tidak memutar WMV lama secara native. EchoVue memakai `ffmpeg.wasm` dari CDN saat pertama kali dibutuhkan. Pemrosesan WMV tetap terjadi pada browser lokal, tetapi Mac harus memiliki koneksi internet pada pemakaian awal agar library FFmpeg dapat dimuat dan dicache.

Untuk versi produksi rumah sakit, library FFmpeg sebaiknya dibundel sendiri pada domain EchoVue sehingga tidak bergantung pada CDN pihak ketiga.

## Menjalankan lokal di Mac

Jangan membuka `index.html` dengan `file://`, karena Service Worker/PWA membutuhkan HTTP/HTTPS.

Jika Python 3 tersedia:

```bash
cd EchoVuePWA
python3 -m http.server 8080
```

Kemudian buka `http://localhost:8080` di Chrome.

Atau double-click `START_MAC.command` bila Python 3 sudah tersedia.

## Deploy online

Folder ini adalah static web app. Dapat dipasang di GitHub Pages, Cloudflare Pages, Netlify, Vercel static, atau static hosting lain.

**Tidak diperlukan backend** untuk fungsi viewer lokal.

## Privasi

Source code prototype tidak memiliki `fetch()`/upload terhadap file pasien. Network dipakai untuk memuat library FFmpeg dari `unpkg.com` pada versi prototype. File pemeriksaan dibaca sebagai object `File` lokal dan hanya diproses dalam browser.

## Batasan prototype

- Preset GE-like bukan algoritme GE Healthcare dan belum dikalibrasi terhadap MPEGVue asli.
- Frame-step memakai asumsi 30 fps. Versi lanjut dapat membaca frame rate aktual.
- Hasil konversi WMV disimpan sementara di memori browser selama sesi. Membuka banyak cine besar dapat meningkatkan penggunaan RAM.
- Belum ada pengukuran echo, DICOM, laporan, atau database pasien.
- Ini adalah viewer prototype dan bukan perangkat medis tervalidasi.
