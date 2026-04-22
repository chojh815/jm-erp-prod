import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type TransferRow = {
  id: string
  transfer_date: string
  from_account_id: string
  to_account_id: string
  from_amount: number
  to_amount: number
  from_currency: string
  to_currency: string
  fx_rate: number | null
  description: string | null
  memo: string | null
  out_tx_id: string | null
  in_tx_id: string | null
  is_deleted: boolean
  created_at: string
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const q = url.searchParams.get('q')?.trim()

    let query = supabaseAdmin
      .from('cash_transfers')
      .select(`
        id,
        transfer_date,
        from_account_id,
        to_account_id,
        from_amount,
        to_amount,
        from_currency,
        to_currency,
        fx_rate,
        description,
        memo,
        out_tx_id,
        in_tx_id,
        is_deleted,
        created_at,
        from_account:cash_accounts!cash_transfers_from_account_id_fkey(id, account_code, account_name, currency),
        to_account:cash_accounts!cash_transfers_to_account_id_fkey(id, account_code, account_name, currency)
      `)
      .eq('is_deleted', false)
      .order('transfer_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (from) query = query.gte('transfer_date', from)
    if (to) query = query.lte('transfer_date', to)

    const { data, error } = await query
    if (error) throw error

    let rows = (data || []) as any[]

    if (q) {
      const qq = q.toLowerCase()
      rows = rows.filter((row) => {
        const haystack = [
          row.description,
          row.memo,
          row.from_account?.account_code,
          row.from_account?.account_name,
          row.to_account?.account_code,
          row.to_account?.account_name,
          row.from_currency,
          row.to_currency,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(qq)
      })
    }

    return NextResponse.json({ ok: true, items: rows })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Failed to load transfers' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      transfer_date,
      from_account_id,
      to_account_id,
      from_amount,
      to_amount,
      description,
      memo,
      created_by,
      created_by_email,
    } = body || {}

    const { data, error } = await supabaseAdmin.rpc('create_cash_transfer', {
      p_transfer_date: transfer_date,
      p_from_account_id: from_account_id,
      p_to_account_id: to_account_id,
      p_from_amount: from_amount,
      p_to_amount: to_amount,
      p_description: description ?? null,
      p_memo: memo ?? null,
      p_created_by: created_by ?? null,
      p_created_by_email: created_by_email ?? null,
    })

    if (error) throw error

    return NextResponse.json({ ok: true, id: data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Failed to create transfer' }, { status: 500 })
  }
}
