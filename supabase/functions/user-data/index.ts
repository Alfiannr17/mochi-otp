import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { validateTelegramInitData } from "../_shared/telegram.ts"
import { syncDepositStatus } from "../_shared/deposit-lifecycle.ts"
import { syncOrderProviderStatus } from "../_shared/order-sync.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { initData, action, id } = await req.json()
    if (!initData || typeof initData !== 'string') {
      return jsonResponse({ error: 'Data autentikasi Telegram tidak tersedia' }, 400)
    }

    if (!['orders', 'order', 'deposits', 'deposit'].includes(action)) {
      return jsonResponse({ error: 'Aksi data tidak valid' }, 400)
    }

    if (['order', 'deposit'].includes(action) && !id) {
      return jsonResponse({ error: 'ID data tidak tersedia' }, 400)
    }

    const telegramUser = await validateTelegramInitData(initData)
    const userId = Number(telegramUser.id)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    if (action === 'orders') {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      const orders = await Promise.all(
        (data ?? []).map(async (order) => {
          if (order.status !== 'active') return order
          return (await syncOrderProviderStatus(supabase, order)).order
        }),
      )
      return jsonResponse({ success: true, orders })
    }

    if (action === 'order') {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle()

      if (error) throw error
      if (!data) return jsonResponse({ error: 'Order tidak ditemukan' }, 404)
      return jsonResponse({
        success: true,
        order: data.status === 'active'
          ? (await syncOrderProviderStatus(supabase, data)).order
          : data,
      })
    }

    if (action === 'deposits') {
      const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      const deposits = []
      for (const deposit of data ?? []) {
        deposits.push(await syncDepositStatus(supabase, deposit))
      }
      return jsonResponse({ success: true, deposits })
    }

    const { data, error } = await supabase
      .from('deposits')
      .select('*')
      .eq('order_id', id)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) throw error
    if (!data) return jsonResponse({ error: 'Deposit tidak ditemukan' }, 404)
    return jsonResponse({ success: true, deposit: await syncDepositStatus(supabase, data) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengambil data user'
    const isAuthError = message.includes('Telegram') || message.includes('autentikasi')
    return jsonResponse({ error: message }, isAuthError ? 401 : 500)
  }
})
