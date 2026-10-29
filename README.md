# Zero Trust Security — Sistem Pengelolaan Nilai

## 1. Deskripsi

Proyek ini merupakan implementasi pembelajaran arsitektur Zero Trust untuk sistem pengelolaan nilai akademik. API Gateway menjadi pintu masuk request pengguna, sementara Service Nilai dan Service Transkrip menangani fungsi yang berbeda. Sistem memeriksa access token, identitas pengguna, perangkat terdaftar, role, dan kewenangan dosen sesuai endpoint.

Proyek ini dikonfigurasi untuk demonstrasi lokal pada satu komputer.

## 2. Arsitektur

```text
Klien / Postman
      |
      v
API Gateway :3000
  |       |        \
  |       |         \-- /transkrip/sinkron
  |       |                     |
  v       v                     v
Auth    Service Nilai :3001   Service Transkrip :3002
 routes       |                     |
              +----------+----------+
                         |
                         v
               SQLite: database/zero-trust.db
```

Gateway memvalidasi pengguna/perangkat dan menerapkan Policy Engine sebelum meneruskan request. Kedua service memeriksa ulang gateway secret dan JWT. Service Nilai memperoleh service token lima menit dari gateway sebelum meminta sinkronisasi transkrip. Database SQLite menyimpan akun, perangkat, kelas, nilai, refresh token, transkrip, dan audit log.

## 3. Teknologi

- Node.js dan npm
- Express
- JSON Web Token (`jsonwebtoken`)
- `bcryptjs`
- SQLite melalui `better-sqlite3`
- `http-proxy-middleware`
- `dotenv`
- Postman untuk pengujian API

## 4. Struktur proyek

```text
zero-trust-security/
├── database/
│   ├── db.js
│   └── seed.js
├── gateway/
│   ├── middleware/
│   │   └── verify-user.js
│   ├── routes/
│   │   ├── auth.js
│   ├── policy.js
│   └── index.js
├── service-nilai/
│   └── index.js
├── service-transkrip/
│   └── index.js
├── .env                 
├── .gitignore
├── package.json
└── package-lock.json
```

`database/zero-trust.db` dibuat secara lokal ketika modul database dijalankan dan tidak perlu diunggah ke repository.

## 5. Persiapan

1. Instal Node.js 18 atau lebih baru.
2. Clone repository dan masuk ke direktori proyek.
3. Instal dependensi:

   ```powershell
   npm install
   ```

4. Buat file `.env` di direktori utama. Isi semua variabel yang dibutuhkan dengan secret dan password demo yang kuat. Jangan mengunggah `.env` ke GitHub.

Variabel yang diperlukan:

```dotenv
JWT_ACCESS_SECRET=<secret-acak-untuk-access-token>
JWT_REFRESH_SECRET=<secret-acak-untuk-refresh-token>
GATEWAY_SECRET=<secret-acak-untuk-komunikasi-gateway>
SERVICE_CLIENT_ID=service-nilai
SERVICE_CLIENT_SECRET=<secret-acak-untuk-autentikasi-service-nilai>

ACCESS_HOURS_START=07:00
ACCESS_HOURS_END=21:00
ACCESS_TIME_ZONE=Asia/Jakarta

SEED_ADMIN_PASSWORD=<password-demo-admin-minimal-12-karakter>
SEED_DOSEN01_PASSWORD=<password-demo-dosen01-minimal-12-karakter>
SEED_DOSEN02_PASSWORD=<password-demo-dosen02-minimal-12-karakter>
SEED_MHS01_PASSWORD=<password-demo-mhs01-minimal-12-karakter>
SEED_MHS02_PASSWORD=<password-demo-mhs02-minimal-12-karakter>
SEED_MHS03_PASSWORD=<password-demo-mhs03-minimal-12-karakter>
```

Ganti semua nilai placeholder dengan nilai sendiri. Jangan menggunakan contoh placeholder sebagai password sebenarnya dan jangan membagikan isi `.env`.

## 6. Inisialisasi database dan data demo

Jalankan dari direktori utama:

```powershell
node database/seed.js
```

`database/db.js` membuat tabel dan indeks jika belum ada. Script seed membuat akun demo, perangkat terdaftar, kelas IF101 dan IF102, serta data nilai awal. Password akun demo dibaca dari variabel `SEED_*_PASSWORD` dan disimpan sebagai hash bcrypt.

Daftar username, role, dan device ID untuk demonstrasi:

| Username | Role | Device ID |
|---|---|---|
| `admin01` | admin | `DEV-ADMIN-001` |
| `dosen01` | dosen | `DEV-DOSEN-001` |
| `dosen02` | dosen | `DEV-DOSEN-002` |
| `mhs01` | mahasiswa | `DEV-MHS-001` |
| `mhs02` | mahasiswa | `DEV-MHS-002` |
| `mhs03` | mahasiswa | `DEV-MHS-003` |

Password demo ditetapkan melalui variabel `SEED_*_PASSWORD`; README tidak menyimpan password.

Seed menggunakan `ON CONFLICT DO NOTHING`; menjalankannya lagi tidak mereset database dan tidak mengganti password akun yang sudah ada. Jangan menghapus database yang sedang dipakai jika ingin mempertahankan data pengujian.

## 7. Menjalankan aplikasi

Buka tiga terminal terpisah di direktori utama proyek.

Terminal 1 — API Gateway:

```powershell
node gateway/index.js
```

Terminal 2 — Service Nilai:

```powershell
node service-nilai/index.js
```

Terminal 3 — Service Transkrip:

```powershell
node service-transkrip/index.js
```

Alamat lokal default:

- API Gateway: `http://127.0.0.1:3000`
- Service Nilai: `http://127.0.0.1:3001`
- Service Transkrip: `http://127.0.0.1:3002`

Ketiga proses harus tetap berjalan selama pengujian.

## 8. Endpoint utama

| Method | Endpoint Gateway | Fungsi | Akses utama |
|---|---|---|---|
| `GET` | `/health` | Pemeriksaan kesehatan Gateway | Publik untuk health check |
| `POST` | `/auth/login` | Login dan penerbitan token | Kredensial + `X-Device-ID` |
| `POST` | `/auth/service` | Penerbitan service token 5 menit | `clientId` + `clientSecret` |
| `POST` | `/auth/refresh` | Rotasi refresh token | Refresh token + `X-Device-ID` terdaftar |
| `POST` | `/auth/logout` | Mencabut refresh token | Refresh token + device penerbit |
| `GET` | `/me` | Memeriksa token dan perangkat | Access token + `X-Device-ID` |
| `GET` | `/nilai` | Melihat nilai | Access token + perangkat; role dibatasi di Service Nilai |
| `PUT` | `/nilai/:id` | Mengubah nilai | Dosen yang mengampu kelas; nilai belum final |
| `POST` | `/kelas/:id/finalisasi` | Memfinalisasi nilai dan menyinkronkan transkrip | Dosen pengampu; sesuai batas waktu aplikasi |
| `GET` | `/transkrip/:nim` | Melihat transkrip berdasarkan NIM | Mahasiswa untuk NIM sendiri; admin untuk semua mahasiswa |
| `POST` | `/transkrip/sinkron` | Sinkronisasi nilai final melalui Gateway | Service token valid |

Endpoint sinkronisasi hanya untuk komunikasi layanan, bukan untuk penggunaan klien biasa. Jangan membagikan client secret kepada pengguna atau memasukkannya ke source code.

## 9. Alur autentikasi dan keamanan

1. Pengguna login dengan username, password, dan `X-Device-ID`.
2. Server memeriksa password dengan bcrypt dan memastikan perangkat terdaftar serta aktif.
3. Sistem menerbitkan access token JWT dengan masa berlaku 10 menit dan refresh token dengan masa berlaku 24 jam yang terikat pada device penerbit.
4. Hash refresh token disimpan di database. Saat refresh berhasil, token lama dicabut dan token baru untuk device yang sama diterbitkan.
5. Gateway memeriksa access token, role terkini, dan perangkat pada endpoint yang dilindungi.
6. Service Nilai memvalidasi ulang gateway secret dan token pengguna, lalu memeriksa role, kepemilikan kelas, batas waktu, dan status final nilai sesuai operasi.
7. Saat nilai difinalisasi, Service Nilai meminta service token lima menit dari `/auth/service`, lalu meminta sinkronisasi lewat Gateway. Gateway dan Service Transkrip memverifikasi service token; Gateway juga memasang `X-Gateway-Secret`.
8. Service Transkrip menyalin nilai yang sudah final ke tabel transkrip menggunakan operasi upsert.

## 10. Pengujian

Jalankan unit test policy dengan:

```powershell
npm test
```

Test memeriksa role, kepemilikan kelas/transkrip, dan penolakan route yang tidak cocok. Test ini tidak memulai service dan tidak mengubah database. Catatan pengujian manual Postman sebelumnya tercatat saat pengembangan, tetapi koleksi dan bukti request/response tidak disertakan di repository. Jalur runtime perlu diuji kembali setelah service dijalankan.





