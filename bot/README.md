# Mochi OTP Telegram Bot Legacy

Folder ini berisi source bot Telegram lama yang berjalan berdampingan dengan Mini App.

Mini App tetap memakai frontend dan Supabase Edge Function. Bot ini berjalan sebagai service Node.js terpisah di VPS dan memakai database Supabase yang sama.

## Setup VPS

1. Install dependency:

```bash
npm install
```

Jika install `canvas` gagal di Ubuntu, install paket sistem ini lalu ulangi `npm install`:

```bash
sudo apt update
sudo apt install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

2. Buat env bot:

```bash
cp bot/.env.example bot/.env
nano bot/.env
```

Isi `SUPABASE_KEY` dengan service role key, bukan anon key, karena bot perlu insert/update order, saldo, deposit, dan voucher.

3. Jalankan test:

```bash
npm run bot
```

4. Karena bot ini memakai polling, hapus webhook Telegram yang sebelumnya diarahkan ke Supabase:

```bash
BOT_TOKEN="isi_token_bot"
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/deleteWebhook" \
  -d "drop_pending_updates=true"
```

5. Set tombol menu Telegram ke Mini App:

```bash
BOT_TOKEN="isi_token_bot"
MINI_APP_URL="https://www.mochixyz.com"
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"BUKA MOCHI OTP\",\"web_app\":{\"url\":\"$MINI_APP_URL\"}}}"
```

6. Jalankan permanen dengan PM2:

```bash
npm install -g pm2
pm2 start npm --name mochi-telegram-bot -- run bot
pm2 save
pm2 startup
```

## Pakasir Webhook Untuk Bot

Bot lama punya endpoint:

```text
POST /webhook/pakasir
```

Kalau deposit lewat bot lama juga dipakai, arahkan webhook Pakasir ke domain VPS yang menuju service bot, contoh:

```text
https://www.mochixyz.com/webhook/pakasir
```

Jika domain utama sudah dipakai frontend, buat reverse proxy path `/webhook/pakasir` ke port `BOT_PORT`.

## Catatan Penting

Telegram hanya bisa punya satu webhook aktif per bot. Untuk mode ini, bot lama memakai polling, jadi jangan set webhook Telegram ke `telegram-bot` Edge Function. Mini App tetap bisa dibuka dari tombol `BUKA MOCHI OTP` dan tetap memakai Supabase untuk auth/data.
