param(
  [string]$ProjectRef = "umunjiwelxsdrwgrqeic",
  [string]$MiniAppUrl = "https://mochi-otp.vercel.app"
)

$ErrorActionPreference = "Stop"

$secureToken = Read-Host "Masukkan token bot BARU dari BotFather" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
  $botToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)

  if ([string]::IsNullOrWhiteSpace($botToken)) {
    throw "Token bot tidak boleh kosong."
  }

  Write-Host "Mengecek token bot Telegram..." -ForegroundColor Cyan

  $bot = Invoke-RestMethod -Uri "https://api.telegram.org/bot${botToken}/getMe"

  if (!$bot.ok) {
    throw "Token ditolak Telegram."
  }

  $botId = [string]$bot.result.id
  $webhookUrl = "https://$ProjectRef.supabase.co/functions/v1/telegram-bot"

  Write-Host "Menyimpan secret ke Supabase..." -ForegroundColor Cyan

  & supabase secrets set `
    "TELEGRAM_BOT_TOKEN=$botToken" `
    "TELEGRAM_BOT_ID=$botId" `
    "MINI_APP_URL=$MiniAppUrl" `
    --project-ref $ProjectRef

  if ($LASTEXITCODE -ne 0) {
    throw "Gagal menyimpan secret Telegram ke Supabase."
  }

  Write-Host "Deploy function telegram-bot..." -ForegroundColor Cyan

  & supabase functions deploy telegram-bot --no-verify-jwt --project-ref $ProjectRef

  if ($LASTEXITCODE -ne 0) {
    throw "Gagal deploy function telegram-bot."
  }

  Write-Host "Mengatur webhook Telegram..." -ForegroundColor Cyan

  $webhook = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.telegram.org/bot${botToken}/setWebhook" `
    -ContentType "application/json" `
    -Body (@{
      url = $webhookUrl
      drop_pending_updates = $true
    } | ConvertTo-Json -Depth 4)

  Write-Host "Mengatur tombol menu Mini App..." -ForegroundColor Cyan

  $menu = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.telegram.org/bot${botToken}/setChatMenuButton" `
    -ContentType "application/json" `
    -Body (@{
      menu_button = @{
        type = "web_app"
        text = "ORDER OTP"
        web_app = @{
          url = $MiniAppUrl
        }
      }
    } | ConvertTo-Json -Depth 5)

  if (!$webhook.ok -or !$menu.ok) {
    throw "Telegram menolak konfigurasi webhook atau menu Mini App."
  }

  $info = Invoke-RestMethod -Uri "https://api.telegram.org/bot${botToken}/getWebhookInfo"

  Write-Host ""
  Write-Host "Telegram berhasil dikonfigurasi." -ForegroundColor Green
  Write-Host "Bot       : @$($bot.result.username)"
  Write-Host "Bot ID    : $botId"
  Write-Host "Webhook   : $webhookUrl"
  Write-Host "Mini App  : $MiniAppUrl"
  Write-Host "Pending   : $($info.result.pending_update_count)"
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}