import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { validateTelegramInitData } from "../_shared/telegram.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

const getTelegramPhotoDataUrl = async (userId: number) => {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
  if (!botToken) return null

  try {
    const photosResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${userId}&limit=1`,
    )
    const photosPayload = await photosResponse.json()
    const sizes = photosPayload?.result?.photos?.[0] ?? []
    const photo = sizes.at(-1)
    if (!photo?.file_id) return null

    const fileResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(photo.file_id)}`,
    )
    const filePayload = await fileResponse.json()
    const filePath = filePayload?.result?.file_path
    if (!filePath) return null

    const imageResponse = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
    if (!imageResponse.ok) return null

    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg'
    const imageBytes = new Uint8Array(await imageResponse.arrayBuffer())
    return `data:${mimeType};base64,${bytesToBase64(imageBytes)}`
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { initData } = await req.json()
    if (!initData || typeof initData !== 'string') {
      return jsonResponse({ error: 'Data autentikasi Telegram tidak tersedia' }, 400)
    }

    const telegramUser = await validateTelegramInitData(initData)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const username =
      String(telegramUser.username ?? '').slice(0, 64) ||
      [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ').slice(0, 64) ||
      null

    const { data: dbUser, error } = await supabase
      .from('users')
      .upsert({
        id: Number(telegramUser.id),
        username,
      }, { onConflict: 'id' })
      .select()
      .single()

    if (error) throw error
    const photoDataUrl = telegramUser.photo_url || await getTelegramPhotoDataUrl(Number(telegramUser.id))

    return jsonResponse({
      success: true,
      telegramUser: {
        ...telegramUser,
        photo_url: photoDataUrl,
      },
      dbUser,
    })
  } catch (error) {
    return jsonResponse({ error: error.message }, 401)
  }
})
