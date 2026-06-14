import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import {
  completeDeposit,
  getPakasirProject,
  getPakasirTransaction,
} from "../_shared/pakasir.ts"

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method Not Allowed' }, 405)

  try {
    const payload = await req.json()
    const { order_id: orderId, status, amount, project } = payload

    if (!orderId || !amount || project !== getPakasirProject()) {
      return jsonResponse({ error: 'Payload webhook tidak valid' }, 400)
    }

    if (status !== 'completed') return jsonResponse({ message: 'Status diabaikan' })

    const transaction = await getPakasirTransaction(orderId, Number(amount))
    if (
      !transaction ||
      transaction.status !== 'completed' ||
      transaction.order_id !== orderId ||
      Number(transaction.amount) !== Number(amount)
    ) {
      return jsonResponse({ error: 'Verifikasi transaksi Pakasir gagal' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const result = await completeDeposit(supabase, orderId, Number(amount))

    return jsonResponse({
      message: result.alreadyProcessed ? 'Deposit sudah diproses' : 'Saldo berhasil ditambahkan',
    })
  } catch (error) {
    return jsonResponse({ error: error.message }, 500)
  }
})
