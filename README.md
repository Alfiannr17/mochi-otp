# Tutorial Setup MOCHI OTP Menggunakan Supabase Kamu

Hai, saya sebagai developer membuat dokumen ini agar kamu dapat menjalankan source code MOCHI OTP menggunakan akun, database, provider, bot Telegram, dan server milik kamu sendiri.

Source code sebelumnya dikembangkan menggunakan project Supabase dummy milik developer. Kamu tidak perlu memindahkan data dummy tersebut. Kamu hanya perlu menghubungkan source code ke project Supabase kamu yang struktur tabel dan kolomnya sudah sama.

Panduan ini mencakup:

```text
Clone source code dari GitHub
Menjalankan source di komputer lokal atau VPS
Menghubungkan source ke Supabase kamu
Mengatur frontend, secrets, dan Edge Functions
Mengatur webhook Telegram dan Pakasir
Menguji seluruh fitur sebelum digunakan user
```

Setiap perintah yang mengandung:

```text
REAL_PROJECT_REF
REAL_SUPABASE_URL
REAL_SUPABASE_ANON_KEY
```

wajib kamu ganti menggunakan data project Supabase kamu.

## Prinsip Penting

Karena database kamu sudah tersedia dan struktur tabelnya sudah benar, jangan jalankan perintah berikut:

```text
supabase db push
supabase db reset
supabase migration up
```

Perintah tersebut dapat mengubah atau merusak database kamu. Proses setup hanya akan menghubungkan source, deploy frontend dan Edge Functions, memasang secrets, serta mengatur webhook.

## 1. Siapkan Akun dan Data Konfigurasi

Sebelum mulai, siapkan data berikut:

```text
REAL_PROJECT_REF
REAL_SUPABASE_URL
REAL_SUPABASE_ANON_KEY
FINAL_MINI_APP_URL
TELEGRAM_BOT_TOKEN
ADMIN_TELEGRAM_IDS
TELEGRAM_CHANNEL_URL
TELEGRAM_CS_URL
API_KEY_SMSBOWER
API_KEY_SMSCODE
API_KEY_PAKASIR
SLUG_PAKASIR
SMSBOWER_USD_TO_IDR_RATE
```

Contoh nilai:

```text
REAL_PROJECT_REF=abcdefghijklm
REAL_SUPABASE_URL=https://abcdefghijklm.supabase.co
FINAL_MINI_APP_URL=https://app.domain-kamu.com
TELEGRAM_CHANNEL_URL=https://t.me/channel_kamu
TELEGRAM_CS_URL=https://t.me/username_cs_kamu
SMSBOWER_USD_TO_IDR_RATE=18000
```

`REAL_PROJECT_REF`, URL, dan anon/public key dapat kamu temukan pada Supabase Dashboard:

Lokasi data pada Supabase Dashboard:

```text
Project Settings -> General -> Reference ID
Project Settings -> API -> Project URL
Project Settings -> API -> anon/public key
```

`TELEGRAM_CHANNEL_URL` dan `TELEGRAM_CS_URL` harus berupa URL Telegram lengkap yang diawali `https://t.me/`. Keduanya dipakai oleh tombol `/start`.

`ADMIN_TELEGRAM_IDS` berisi Telegram ID numerik yang diizinkan membuka panel admin. Untuk beberapa admin, pisahkan menggunakan koma:

```text
123456789,987654321
```

Kamu tidak perlu memberikan password database, token provider, atau akses akun Supabase kepada developer. Jalankan sendiri proses login dan pemasangan secrets pada perangkat kamu.

## 2. Clone Repository GitHub

Pilih salah satu lokasi untuk menjalankan proses setup:

```text
Pilihan A: Komputer lokal Windows
Pilihan B: VPS Ubuntu
```

### Pilihan A: Clone dan Setup Awal di Komputer Lokal

Pastikan Git dan Node.js versi 20 atau lebih baru sudah terpasang.

Buka PowerShell, lalu jalankan:

```powershell
git clone URL_REPOSITORY_GITHUB
cd mochi-otp
npm install
```

Contoh:

```powershell
git clone https://github.com/username/mochi-otp.git
cd mochi-otp
npm install
```

Jalankan pengecekan awal:

```powershell
npm run lint
npm run build
```

Untuk menjalankan aplikasi secara lokal:

```powershell
npm run dev
```

Catatan: Telegram Mini App production tetap membutuhkan URL HTTPS. Localhost hanya digunakan untuk pemeriksaan source dan build.

### Pilihan B: Clone dan Setup Awal Langsung di VPS

Contoh berikut menggunakan Ubuntu:

```bash
ssh root@IP_VPS
apt update
apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
git clone URL_REPOSITORY_GITHUB /opt/mochi-otp
cd /opt/mochi-otp
npm install
npm run lint
npm run build
```

Setelah clone selesai, semua perintah Supabase dapat dijalankan dari:

```bash
cd /opt/mochi-otp
```

### Catatan Format Perintah

Sebagian besar contoh utama dalam dokumen ini menggunakan PowerShell untuk Windows.

Jika kamu menjalankan setup langsung di VPS Ubuntu:

```text
Gunakan tanda \ untuk menyambung perintah Bash ke baris berikutnya.
Jangan menggunakan tanda ` milik PowerShell.
Gunakan contoh Bash/VPS yang disediakan pada bagian secrets, deploy functions, dan webhook.
```

## 3. Pastikan Source Tidak Terhubung ke Project Dummy

Repository yang kamu clone tidak boleh membawa file lokal milik developer berikut:

```text
.env
.vercel
dist
node_modules
supabase/.temp
```

Alasannya:

- `.env` masih menunjuk ke Supabase dummy.
- `.vercel` dapat masih terhubung ke project Vercel developer.
- `supabase/.temp` masih terhubung ke project Supabase dummy.
- `dist` dan `node_modules` dapat dibuat kembali.

`supabase/.temp` adalah cache lokal Supabase CLI, bukan bagian source dan bukan struktur database. Folder tersebut akan dibuat kembali secara otomatis setelah kamu menjalankan:

```powershell
npx supabase link --project-ref REAL_PROJECT_REF
```

Pastikan `.gitignore` memuat:

```gitignore
supabase/.temp/
```

Jika folder tersebut ikut terbawa, hapus foldernya. Jangan mengedit isi `supabase/.temp/project-ref` secara manual.

Jangan memakai token bot, API key provider, database password, atau service role key milik developer.

File `supabase/config.toml` tetap disertakan. Nilai:

```toml
project_id = "mochi-otp"
```

hanya nama project lokal, bukan Project Reference ID Supabase kamu.

## 4. Hubungkan Source ke Supabase Kamu

Pastikan terminal sedang berada di folder repository:

```powershell
cd PATH_KE_FOLDER\mochi-otp
```

Logout dari akun Supabase lain jika diperlukan:

```powershell
npx supabase logout
```

Login menggunakan akun Supabase kamu:

```powershell
npx supabase login
```

Periksa apakah project kamu terlihat:

```powershell
npx supabase projects list
```

Hubungkan source ke project Supabase kamu:

```powershell
npx supabase link --project-ref REAL_PROJECT_REF
```

Masukkan database password project kamu jika diminta.

Verifikasi project yang sedang terhubung:

```powershell
Get-Content supabase\.temp\project-ref
```

Output wajib berisi:

```text
REAL_PROJECT_REF
```

Jika output masih menunjukkan project dummy atau project lain, ulangi `supabase link` menggunakan `REAL_PROJECT_REF` yang benar.

## 5. Periksa Struktur Database Kamu Tanpa Mengubah Data

Buka Supabase Dashboard:

```text
Database -> Tables
```

Pastikan tabel berikut tersedia:

```text
users
orders
deposits
vouchers
voucher_claims
promo_settings
checkin
```

Untuk memeriksa melalui SQL Editor tanpa mengubah data:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'users',
    'orders',
    'deposits',
    'vouchers',
    'voucher_claims',
    'promo_settings',
    'checkin'
  )
order by table_name;
```

Pastikan relasi berikut juga tersedia karena panel admin menggunakannya:

```text
orders.user_id -> users.id
deposits.user_id -> users.id
```

Minimum kolom yang digunakan source saat ini:

```text
users: id, username, balance, is_banned, joined_at
orders: id, user_id, service_name, phone_number, activation_id, status, price, sms_code, created_at
deposits: order_id, user_id, amount, status, payment_url, created_at
vouchers: code, amount, batch, max_usage, current_usage, is_active, created_at
voucher_claims: id, user_id, voucher_code, created_at
promo_settings: id, promo_name, percentage, min_deposit, max_bonus, is_active, created_at
checkin: id, user_id, amount, created_at
```

Kolom `deposits.payment_url` wajib bertipe `text`. Source terbaru menggunakan kolom tersebut untuk menyimpan metadata internal transaksi yang mencakup QRIS, biaya, promo, bonus, dan total saldo masuk. Metadata ini membuat QRIS deposit pending dapat dibuka kembali dari riwayat tanpa direct link ke Pakasir.

Tidak perlu menambahkan kolom deposit baru. Jangan membatasi `payment_url` menggunakan `varchar(255)` karena isi QRIS dan metadata dapat lebih panjang.

Perhatian khusus untuk `promo_settings`:

```text
percentage  = persentase bonus deposit
min_deposit = minimal deposit agar promo berlaku
max_bonus   = batas maksimal bonus; nilai 0 berarti tanpa batas
is_active   = status promo aktif/nonaktif
```

Source terbaru tidak lagi menggunakan kolom lama `bonus_percentage`. Database kamu wajib memakai kolom `percentage`.

Periksa seluruh kolom tanpa mengubah database:

```sql
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'users',
    'orders',
    'deposits',
    'vouchers',
    'voucher_claims',
    'promo_settings',
    'checkin'
  )
order by table_name, ordinal_position;
```

Pastikan ada unique constraint pada pasangan `voucher_claims(user_id, voucher_code)` agar voucher yang sama tidak dapat diklaim dua kali oleh user yang sama.

Pastikan policy RLS database kamu sesuai. Frontend saat ini membaca tabel `users` dan `checkin` secara langsung. Jangan menonaktifkan RLS hanya untuk membuat aplikasi berjalan; gunakan policy yang memang sudah dirancang untuk database kamu.

## 6. Tentukan URL Frontend Final

Tentukan URL final sebelum memasang Telegram webhook. Contoh:

```text
https://app.domain-kamu.com
```

URL harus menggunakan HTTPS karena akan dibuka sebagai Telegram Mini App.

Kamu dapat menggunakan domain sendiri, subdomain, atau URL production Vercel. URL final ini nantinya dipakai sebagai `MINI_APP_URL`.

## 7. Deploy Frontend

Pilih salah satu metode berikut:

```text
Pilihan A: Deploy di VPS menggunakan Nginx
Pilihan B: Deploy menggunakan Vercel
```

### Pilihan A: Deploy Frontend di VPS

Bagian ini melanjutkan proses clone VPS pada langkah 2.

Masuk ke VPS:

```bash
ssh root@IP_VPS
```

Instal kebutuhan:

```bash
apt update
apt install -y nginx git curl rsync certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

Jika repository belum di-clone:

```bash
git clone URL_REPOSITORY /opt/mochi-otp
cd /opt/mochi-otp
npm install
```

Buat file koneksi frontend ke Supabase kamu:

```bash
nano /opt/mochi-otp/.env
```

Isi:

```env
VITE_SUPABASE_URL=https://REAL_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=REAL_SUPABASE_ANON_KEY
```

Jangan pernah memasukkan service role key, token bot, atau API key provider ke frontend.

Build aplikasi:

```bash
cd /opt/mochi-otp
npm run lint
npm run build
mkdir -p /var/www/mochi-otp
rsync -a --delete dist/ /var/www/mochi-otp/
chown -R www-data:www-data /var/www/mochi-otp
```

Buat konfigurasi Nginx:

```bash
nano /etc/nginx/sites-available/mochi-otp
```

Isi:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name app.domain-kamu.com;

    root /var/www/mochi-otp;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Aktifkan:

```bash
ln -s /etc/nginx/sites-available/mochi-otp /etc/nginx/sites-enabled/mochi-otp
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
certbot --nginx -d app.domain-kamu.com
```

Verifikasi:

```bash
curl -I https://app.domain-kamu.com
```

### Pilihan B: Deploy Frontend Menggunakan Vercel

Jika kamu menjalankan setup dari komputer lokal, buat file `.env` pada folder repository:

```text
mochi-otp\.env
```

Isi menggunakan koneksi Supabase kamu:

```env
VITE_SUPABASE_URL=https://REAL_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=REAL_SUPABASE_ANON_KEY
```

Periksa source sebelum deploy:

```powershell
npm run lint
npm run build
```

Login dan hubungkan repository ke akun Vercel kamu:

```powershell
npx vercel login
npx vercel link
```

Saat menjalankan `vercel link`, pilih akun/team dan project Vercel kamu. Jangan memilih project milik developer.

Tambahkan environment variable production pada Vercel Dashboard:

```text
Project -> Settings -> Environment Variables
```

Tambahkan:

```env
VITE_SUPABASE_URL=https://REAL_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=REAL_SUPABASE_ANON_KEY
```

Kedua variable tersebut boleh tersedia di frontend karena menggunakan anon/public key. Jangan menambahkan `SUPABASE_SERVICE_ROLE_KEY`, token Telegram, atau API key provider ke Vercel.

Deploy:

```powershell
npm run lint
npm run build
npx vercel --prod
```

Catat URL production final dari Vercel. Gunakan URL yang sama untuk:

```text
MINI_APP_URL pada Supabase secrets
Tombol menu Mini App Telegram
Pengujian /start
```

Jika menggunakan custom domain, pasang custom domain terlebih dahulu lalu gunakan custom domain tersebut sebagai `FINAL_MINI_APP_URL`.

Verifikasi frontend yang sudah terhubung ke Supabase kamu:

```powershell
Invoke-WebRequest -UseBasicParsing "https://FINAL_MINI_APP_URL"
```

Kemudian buka Mini App melalui Telegram dan pastikan data yang tampil berasal dari database kamu.

## 8. Simpan Secrets di Supabase Kamu

Semua secrets harus menggunakan akun provider, akun pembayaran, dan bot Telegram milik kamu.

Daftar secret yang digunakan source terbaru:

| Secret | Wajib | Fungsi |
| --- | --- | --- |
| `API_KEY_SMSBOWER` | Ya | API Server 1 SMSBower |
| `API_KEY_SMSCODE` | Ya | API Server 2 SMSCode |
| `API_KEY_PAKASIR` | Ya | API pembayaran QRIS Pakasir |
| `SLUG_PAKASIR` | Ya | Slug project Pakasir |
| `SMSBOWER_USD_TO_IDR_RATE` | Disarankan | Kurs USD ke Rupiah untuk harga SMSBower |
| `TELEGRAM_BOT_TOKEN` | Ya | Token bot dari BotFather |
| `TELEGRAM_BOT_ID` | Ya | Angka sebelum tanda `:` pada token bot |
| `MINI_APP_URL` | Ya | URL HTTPS frontend final |
| `ADMIN_TELEGRAM_IDS` | Ya | Whitelist ID admin, dipisahkan koma |
| `TELEGRAM_WEBHOOK_SECRET` | Ya | Pengaman webhook Telegram |
| `TELEGRAM_CHANNEL_URL` | Disarankan | Link tombol `CHANNEL MOCHI` |
| `TELEGRAM_CS_URL` | Disarankan | Link tombol `CS MOCHI` |
| `SMSBOWER_API_URL` | Opsional | Override endpoint SMSBower |

Supabase otomatis menyediakan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` untuk Edge Functions. Jangan memasukkan service role key ke `.env` frontend.

Perbedaan konfigurasi:

```text
Vercel Environment Variables:
  Hanya VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY.

Supabase Edge Function Secrets:
  Token Telegram, whitelist admin, URL Channel/CS, serta API key provider.
```

Jika token bot pernah dikirim melalui chat, screenshot, atau tersimpan di source code, buat token baru melalui BotFather sebelum production. Token pada Supabase harus sama dengan token yang digunakan saat menjalankan `setWebhook`; jika berbeda, validasi akun Telegram Mini App akan gagal.

Supabase otomatis menyediakan:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Jangan mengatur atau menyalin kedua nilai tersebut dari project dummy.

Buat Telegram webhook secret:

```powershell
$WebhookSecret = [guid]::NewGuid().ToString('N')
$WebhookSecret
```

Ambil Telegram Bot ID dari token. Bot ID adalah angka sebelum tanda `:` pada token:

```powershell
$BotToken = "TOKEN_BOT_KAMU"
$BotId = $BotToken.Split(':')[0]
$BotId
```

Masukkan secrets ke project Supabase kamu:

```powershell
npx supabase secrets set `
  "API_KEY_SMSBOWER=API_KEY_SMSBOWER_KAMU" `
  "API_KEY_SMSCODE=API_KEY_SMSCODE_KAMU" `
  "API_KEY_PAKASIR=API_KEY_PAKASIR_KAMU" `
  "SLUG_PAKASIR=SLUG_PAKASIR_KAMU" `
  "SMSBOWER_USD_TO_IDR_RATE=18000" `
  "TELEGRAM_BOT_TOKEN=$BotToken" `
  "TELEGRAM_BOT_ID=$BotId" `
  "MINI_APP_URL=https://app.domain-kamu.com" `
  "ADMIN_TELEGRAM_IDS=TELEGRAM_ID_ADMIN" `
  "TELEGRAM_WEBHOOK_SECRET=$WebhookSecret" `
  "TELEGRAM_CHANNEL_URL=https://t.me/channel_kamu" `
  "TELEGRAM_CS_URL=https://t.me/username_cs_kamu" `
  --project-ref REAL_PROJECT_REF
```

Jika setup dijalankan langsung di VPS Ubuntu, gunakan format Bash:

```bash
npx supabase secrets set \
  "API_KEY_SMSBOWER=API_KEY_SMSBOWER_KAMU" \
  "API_KEY_SMSCODE=API_KEY_SMSCODE_KAMU" \
  "API_KEY_PAKASIR=API_KEY_PAKASIR_KAMU" \
  "SLUG_PAKASIR=SLUG_PAKASIR_KAMU" \
  "SMSBOWER_USD_TO_IDR_RATE=18000" \
  "TELEGRAM_BOT_TOKEN=TOKEN_BOT_KAMU" \
  "TELEGRAM_BOT_ID=ID_BOT_KAMU" \
  "MINI_APP_URL=https://app.domain-kamu.com" \
  "ADMIN_TELEGRAM_IDS=TELEGRAM_ID_ADMIN" \
  "TELEGRAM_WEBHOOK_SECRET=SECRET_WEBHOOK_KAMU" \
  "TELEGRAM_CHANNEL_URL=https://t.me/channel_kamu" \
  "TELEGRAM_CS_URL=https://t.me/username_cs_kamu" \
  --project-ref REAL_PROJECT_REF
```

Apabila `TELEGRAM_CHANNEL_URL` atau `TELEGRAM_CS_URL` tidak diisi, source menggunakan fallback berikut:

```text
CHANNEL MOCHI -> https://t.me/mochi_otp
CS MOCHI      -> https://t.me/mochi_otp_support
```

Untuk production, sangat disarankan mengisi kedua secret tersebut menggunakan Channel dan akun CS kamu.

Untuk hanya mengganti link Channel dan CS setelah setup awal:

```powershell
npx supabase secrets set `
  "TELEGRAM_CHANNEL_URL=https://t.me/channel_kamu" `
  "TELEGRAM_CS_URL=https://t.me/username_cs_kamu" `
  --project-ref REAL_PROJECT_REF

npx supabase functions deploy telegram-bot `
  --project-ref REAL_PROJECT_REF `
  --no-verify-jwt
```

Opsional, apabila ingin menentukan endpoint SMSBower secara eksplisit:

```powershell
npx supabase secrets set `
  "SMSBOWER_API_URL=https://smsbower.page/stubs/handler_api.php" `
  --project-ref REAL_PROJECT_REF
```

Periksa nama secrets:

```powershell
npx supabase secrets list --project-ref REAL_PROJECT_REF
```

Nilai secret tidak ditampilkan kembali oleh Supabase. Simpan `$WebhookSecret` dengan aman karena dibutuhkan pada langkah Telegram webhook.

### Mengubah Kurs USD SMSBower

Harga SMSBower diberikan dalam USD dan dikonversi menggunakan secret:

```text
SMSBOWER_USD_TO_IDR_RATE
```

SMSCode tidak menggunakan secret ini karena source membaca harga Rupiah dari `canonical_amount`.

Contoh mengganti kurs menjadi Rp18.500 per USD:

```powershell
npx supabase secrets set `
  "SMSBOWER_USD_TO_IDR_RATE=18500" `
  --project-ref REAL_PROJECT_REF
```

Setelah mengubah kurs, deploy ulang fungsi katalog dan pembelian agar worker memakai konfigurasi terbaru:

```powershell
npx supabase functions deploy sms-catalog `
  --project-ref REAL_PROJECT_REF `
  --no-verify-jwt

npx supabase functions deploy buy-number `
  --project-ref REAL_PROJECT_REF `
  --no-verify-jwt
```

Jika secret belum dipasang atau nilainya tidak valid, source menggunakan fallback:

```text
Rp18.000 per USD
```

Rumus harga SMSBower:

```text
Harga jual = pembulatan ke atas(harga USD x kurs) + keuntungan
```

Keuntungan saat ini:

```text
Telegram dan WhatsApp = Rp1.000
Layanan lainnya       = Rp600
```

Jika secret diubah setelah function sudah deploy, secret baru akan tersedia untuk pemanggilan function berikutnya. Deploy ulang `telegram-bot` tetap disarankan setelah mengganti konfigurasi tombol `/start`.

## 9. Deploy Edge Functions ke Supabase Kamu

Deploy seluruh function dari repository ke project Supabase kamu:

```powershell
$projectRef = "REAL_PROJECT_REF"
$functions = @(
  "admin-api",
  "buy-number",
  "cancel-order",
  "check-qris",
  "check-sms",
  "claim-voucher",
  "create-qris",
  "order-action",
  "pakasir-webhook",
  "sms-catalog",
  "telegram-auth",
  "telegram-bot",
  "user-data"
)

foreach ($function in $functions) {
  npx supabase functions deploy $function `
    --project-ref $projectRef `
    --no-verify-jwt

  if ($LASTEXITCODE -ne 0) {
    throw "Deploy gagal pada function: $function"
  }
}
```

Jika menggunakan VPS Ubuntu, gunakan Bash:

```bash
PROJECT_REF="REAL_PROJECT_REF"
FUNCTIONS=(
  admin-api
  buy-number
  cancel-order
  check-qris
  check-sms
  claim-voucher
  create-qris
  order-action
  pakasir-webhook
  sms-catalog
  telegram-auth
  telegram-bot
  user-data
)

for FUNCTION in "${FUNCTIONS[@]}"; do
  npx supabase functions deploy "$FUNCTION" \
    --project-ref "$PROJECT_REF" \
    --no-verify-jwt || exit 1
done
```

Periksa hasilnya:

```powershell
npx supabase functions list --project-ref REAL_PROJECT_REF
```

Semua function pada daftar wajib berstatus:

```text
ACTIVE
```

Jika satu function gagal deploy, jangan lanjut mengatur webhook sebelum function tersebut berhasil.

Jangan menyalin Edge Functions dari dashboard project dummy. Deploy selalu dari repository agar project kamu memakai kode terbaru.

## 10. Atur Webhook Telegram

Lakukan langkah ini setelah:

- Frontend final sudah online.
- Secrets sudah dipasang.
- Function `telegram-bot` dan `telegram-auth` sudah berhasil di-deploy.

Memanggil `setWebhook` akan langsung mengarahkan bot dari webhook lama ke project Supabase kamu.

PowerShell:

```powershell
$BotToken = "TOKEN_BOT_KAMU"
$ProjectRef = "REAL_PROJECT_REF"
$MiniAppUrl = "https://app.domain-kamu.com"
$WebhookSecret = "SECRET_YANG_SAMA_DENGAN_SUPABASE"

$webhookBody = @{
  url = "https://$ProjectRef.supabase.co/functions/v1/telegram-bot"
  secret_token = $WebhookSecret
  drop_pending_updates = $true
  allowed_updates = @("message")
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$BotToken/setWebhook" `
  -ContentType "application/json" `
  -Body $webhookBody
```

Jika menggunakan VPS Ubuntu, arahkan webhook dengan `curl`:

```bash
BOT_TOKEN="TOKEN_BOT_KAMU"
PROJECT_REF="REAL_PROJECT_REF"
WEBHOOK_SECRET="SECRET_YANG_SAMA_DENGAN_SUPABASE"

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\":\"https://${PROJECT_REF}.supabase.co/functions/v1/telegram-bot\",
    \"secret_token\":\"${WEBHOOK_SECRET}\",
    \"drop_pending_updates\":true,
    \"allowed_updates\":[\"message\"]
  }"
```

Atur tombol menu Mini App:

```powershell
$menuBody = @{
  menu_button = @{
    type = "web_app"
    text = "ORDER OTP"
    web_app = @{
      url = $MiniAppUrl
    }
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$BotToken/setChatMenuButton" `
  -ContentType "application/json" `
  -Body $menuBody
```

Untuk mengatur tombol menu Mini App dari VPS:

```bash
MINI_APP_URL="https://app.domain-kamu.com"

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d "{
    \"menu_button\":{
      \"type\":\"web_app\",
      \"text\":\"ORDER OTP\",
      \"web_app\":{\"url\":\"${MINI_APP_URL}\"}
    }
  }"
```

Periksa webhook:

```powershell
Invoke-RestMethod "https://api.telegram.org/bot$BotToken/getWebhookInfo"
```

Pada VPS:

```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

Nilai `url` wajib menjadi:

```text
https://REAL_PROJECT_REF.supabase.co/functions/v1/telegram-bot
```

Pastikan:

```text
pending_update_count = 0
last_error_message kosong
```

Kemudian uji:

```text
/start
/admin
```

Balasan `/start` wajib menampilkan tiga tombol:

```text
BUKA MOCHI OTP
CHANNEL MOCHI
CS MOCHI
```

Pastikan:

```text
BUKA MOCHI OTP membuka FINAL_MINI_APP_URL sebagai Telegram Mini App.
CHANNEL MOCHI membuka TELEGRAM_CHANNEL_URL.
CS MOCHI membuka TELEGRAM_CS_URL.
```

Jika `/admin` menolak, bot akan menampilkan Telegram ID. Tambahkan ID tersebut:

```powershell
npx supabase secrets set `
  "ADMIN_TELEGRAM_IDS=TELEGRAM_ID_ADMIN" `
  --project-ref REAL_PROJECT_REF
```

Untuk beberapa admin:

```powershell
npx supabase secrets set `
  "ADMIN_TELEGRAM_IDS=123456789,987654321" `
  --project-ref REAL_PROJECT_REF
```

## 11. Atur Webhook Pakasir

Lakukan langkah ini setelah function `pakasir-webhook` berhasil deploy dan secrets Pakasir sudah benar.

Pada dashboard Pakasir kamu, ubah webhook/callback menjadi:

```text
https://REAL_PROJECT_REF.supabase.co/functions/v1/pakasir-webhook
```

Pastikan:

```text
API_KEY_PAKASIR
SLUG_PAKASIR
```

berasal dari akun/project Pakasir yang sama.

SMSBower dan SMSCode tidak membutuhkan webhook untuk alur aplikasi ini.

## 12. Urutan Aktivasi yang Aman

Gunakan urutan berikut agar aplikasi tidak putus di tengah proses:

1. Clone repository GitHub ke komputer lokal atau VPS.
2. Jalankan `npm install`, lint, dan build.
3. Login Supabase menggunakan akun kamu.
4. Link repository ke `REAL_PROJECT_REF`.
5. Periksa tabel database kamu tanpa menjalankan migration.
6. Deploy frontend dengan URL final dan koneksi Supabase kamu.
7. Pasang seluruh secrets di Supabase kamu.
8. Deploy seluruh Edge Functions ke Supabase kamu.
9. Uji endpoint dan frontend.
10. Atur Telegram webhook.
11. Atur Pakasir webhook.
12. Uji transaksi kecil dari awal sampai selesai.
13. Hentikan penggunaan project dummy setelah seluruh pengujian berhasil.

Jangan menghapus atau mematikan project dummy sebelum seluruh order aktif dan deposit pending di project dummy sudah selesai atau dibatalkan.

## 13. Checklist Pengujian Akhir

### Telegram dan Login

- `/start` membalas.
- `/start` menampilkan tombol `BUKA MOCHI OTP`, `CHANNEL MOCHI`, dan `CS MOCHI`.
- Tombol Mini App membuka URL final.
- Tombol Channel dan CS membuka akun kamu.
- Akun Telegram terdeteksi.
- Profile dan foto Telegram tampil.

### User

- Saldo mengambil data dari database kamu.
- Negara dan layanan tampil.
- Order SMSBower berhasil.
- Order SMSCode berhasil.
- Active order masuk history.
- OTP tampil.
- Refund dan selesai bekerja.
- Expiry order bekerja.
- Voucher dapat diklaim.
- Tombol S&K menampilkan ketentuan layanan.

### Deposit

- QRIS berhasil dibuat.
- Deposit masuk ke tabel database kamu.
- Pembayaran sukses mengubah status deposit.
- Saldo bertambah satu kali.
- Bonus promo deposit mengikuti `percentage`, `min_deposit`, dan `max_bonus`.
- Deposit expired dibatalkan.

### Admin

- `/admin` hanya memberi tombol kepada ID whitelist.
- Dashboard admin membaca database kamu.
- Daftar user, order, deposit, voucher, dan promo tampil.
- Ban/unban user bekerja.
- Admin dapat menambah dan mengurangi saldo user.
- Pengurangan saldo tidak dapat membuat saldo user minus.
- Admin dapat mengatur maksimal penggunaan voucher.
- Admin dapat membuat, mengedit, mengaktifkan, dan menonaktifkan promo.
- Batas maksimal bonus promo diterapkan saat deposit sukses.

## 14. Referensi Dummy yang Harus Hilang

Project ref dummy saat pengembangan adalah:

```text
umunjiwelxsdrwgrqeic
```

Setelah setup selesai, cari referensi dummy:

```powershell
rg "umunjiwelxsdrwgrqeic" .
```

Referensi tersebut tidak boleh tersisa di:

```text
.env
supabase/.temp/project-ref
scripts/setup-telegram.ps1
konfigurasi deployment
Telegram webhook
Pakasir webhook
```

File `scripts/setup-telegram.ps1` memiliki project ref dummy sebagai nilai default. Ubah nilai default tersebut menjadi Project Reference ID kamu, atau selalu berikan project kamu ketika menjalankannya:

```powershell
.\scripts\setup-telegram.ps1 `
  -ProjectRef "REAL_PROJECT_REF" `
  -MiniAppUrl "https://app.domain-kamu.com"
```

Catatan: script tersebut belum mengirim `TELEGRAM_WEBHOOK_SECRET` saat memasang webhook. Untuk konfigurasi webhook yang aman, gunakan perintah manual pada langkah 10.

Script tersebut juga belum mengatur `TELEGRAM_CHANNEL_URL`, `TELEGRAM_CS_URL`, dan `ADMIN_TELEGRAM_IDS`. Pasang ketiganya menggunakan perintah `supabase secrets set` pada langkah 8.

## 15. Pemeriksaan Keamanan Sebelum Digunakan User

Source saat ini memiliki beberapa bagian yang perlu diperkeras sebelum menangani saldo dan transaksi production:

```text
Profile check-in menambah saldo langsung dari frontend.
Beberapa Edge Functions menerima userId atau orderId dari request tanpa memvalidasi Telegram initData.
Sebagian Edge Functions menggunakan verify_jwt=false dan harus melakukan validasi Telegram secara internal.
```

Jangan membuat policy RLS yang mengizinkan anon mengubah saldo user secara bebas hanya agar fitur check-in berjalan. Untuk production, pindahkan proses check-in ke Edge Function tervalidasi dan tambahkan validasi Telegram pada seluruh aksi yang mengubah saldo, membuat order, membatalkan order, mengklaim voucher, atau membuat deposit.

Sebelum mengaktifkan webhook production, lakukan audit khusus terhadap:

```text
buy-number
cancel-order
check-sms
order-action
claim-voucher
create-qris
check-qris
Profile check-in
RLS policy seluruh tabel public
```

## 16. Rollback Jika Terjadi Masalah

Jika bot berhenti merespons setelah webhook dipindahkan:

1. Periksa `getWebhookInfo`.
2. Periksa log function `telegram-bot` pada Supabase kamu.
3. Pastikan `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_ID`, `MINI_APP_URL`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_CHANNEL_URL`, dan `TELEGRAM_CS_URL` benar.
4. Pastikan webhook menggunakan Project Reference ID kamu.

Jika perlu mengembalikan Telegram webhook sementara ke project dummy:

```powershell
$DummyWebhookSecret = "SECRET_WEBHOOK_PROJECT_DUMMY_JIKA_ADA"

$rollbackBody = @{
  url = "https://umunjiwelxsdrwgrqeic.supabase.co/functions/v1/telegram-bot"
  secret_token = $DummyWebhookSecret
  drop_pending_updates = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$BotToken/setWebhook" `
  -ContentType "application/json" `
  -Body $rollbackBody
```

Jangan melakukan rollback Pakasir ketika masih ada deposit pending. Selesaikan atau batalkan deposit pending terlebih dahulu agar saldo tidak diproses ke project yang salah.

## 17. Checklist Akhir untuk Kamu

Gunakan daftar ini tepat sebelum aplikasi diumumkan ke user:

```text
[ ] Repository tidak membawa .env, .vercel, atau supabase/.temp milik developer.
[ ] Setelah kamu menjalankan supabase link, supabase/.temp/project-ref menunjuk ke REAL_PROJECT_REF.
[ ] Tabel dan kolom database kamu sesuai langkah 5.
[ ] promo_settings memakai percentage dan max_bonus, bukan bonus_percentage.
[ ] Vercel/VPS memakai VITE_SUPABASE_URL dan anon key project kamu.
[ ] Semua Supabase secrets berasal dari akun kamu.
[ ] TELEGRAM_CHANNEL_URL dan TELEGRAM_CS_URL sudah benar.
[ ] Semua Edge Functions berstatus ACTIVE.
[ ] Telegram webhook menunjuk ke REAL_PROJECT_REF.
[ ] Pakasir webhook menunjuk ke REAL_PROJECT_REF.
[ ] /start menampilkan tiga tombol yang benar.
[ ] /admin hanya dapat dibuka oleh ADMIN_TELEGRAM_IDS.
[ ] Admin dapat tambah/kurangi saldo tanpa membuat saldo minus.
[ ] Order, OTP, refund, voucher, promo, dan deposit telah diuji.
[ ] Tidak ada order aktif atau deposit pending yang tertinggal di project dummy.
```
