import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = (searchParams.get('account_id') || '').trim()
    const currency = (searchParams.get('currency') || '').trim()
    const category = (searchParams.get('category') || '').trim()
    const q = (searchParams.get('q') || '').trim()
    const dateFrom = (searchParams.get('date_from') || '').trim()
    const dateTo = (searchParams.get('date_to') || '').trim()
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || '300'), 1), 2000)

    let query = supabaseAdmin
      .from('v_cash_ledger')
      .select('*')
      .order('tx_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (accountId) query = query.eq('account_id', accountId)
    if (currency) query = query.eq('currency', currency)
    if (category) query = query.eq('category', category)
    if (dateFrom) query = query.gte('tx_date', dateFrom)
    if (dateTo) query = query.lte('tx_date', dateTo)
    if (q) {
      query = query.or(
        `description.ilike.%${q}%,memo.ilike.%${q}%,counterparty_name.ilike.%${q}%,account_name.ilike.%${q}%`
      )
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ ok: true, items: data || [] })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load cash ledger' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.account_id) {
      return NextResponse.json({ ok: false, error: 'account_id is required' }, { status: 400 })
    }
    if (!body.tx_date) {
      return NextResponse.json({ ok: false, error: 'tx_date is required' }, { status: 400 })
    }
    if (!['IN', 'OUT'].includes(body.in_out)) {
      return NextResponse.json({ ok: false, error: 'in_out must be IN or OUT' }, { status: 400 })
    }
    if (!['RECEIPT', 'EXPENSE', 'MANUAL', 'TRANSFER', 'FX'].includes(body.category)) {
      return NextResponse.json({ ok: false, error: 'Invalid category' }, { status: 400 })
    }
    if (!body.description?.trim()) {
      return NextResponse.json({ ok: false, error: 'description is required' }, { status: 400 })
    }
    if (toNumber(body.amount, -1) < 0) {
      return NextResponse.json({ ok: false, error: 'amount must be >= 0' }, { status: 400 })
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from('cash_accounts')
      .select('id, currency, is_deleted')
      .eq('id', body.account_id)
      .eq('is_deleted', false)
      .single()

    if (accountError || !account) {
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 })
    }

    const payload = {
      account_id: body.account_id,
      tx_date: body.tx_date,
      in_out: body.in_out,
      category: body.category,
      ref_type: body.ref_type || 'manual',
      ref_id: body.ref_id || null,
      description: body.description.trim(),
      memo: body.memo?.trim() || null,
      counterparty_type: body.counterparty_type || null,
      counterparty_id: body.counterparty_id || null,
      counterparty_name: body.counterparty_name?.trim() || null,
      amount: toNumber(body.amount, 0),
      currency: account.currency,
      fx_rate_to_usd: body.fx_rate_to_usd ? toNumber(body.fx_rate_to_usd, 0) : null,
      transfer_group_id: body.transfer_group_id || null,
      created_by: body.created_by || null,
      created_by_email: body.created_by_email || null,
      updated_by: body.created_by || null,
      updated_by_email: body.created_by_email || null,
    }

    const { data, error } = await supabaseAdmin
      .from('cash_transactions')
      .insert(payload)
      .select('*')
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, item: data })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to create cash transaction' },
      { status: 500 }
    )
  }
}
