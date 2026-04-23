import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function isMissingPurposeColumn(error: any) {
  const message = String(error?.message || '')
  return message.includes('purpose_code') || message.includes('purpose_group')
}

async function enrichRefStatus(rows: any[]) {
  if (!rows.length) return rows

  const payableIds = Array.from(
    new Set(
      rows
        .filter((row: any) => row?.ref_type === 'subcontract_payable' && row?.ref_id)
        .map((row: any) => row.ref_id)
    )
  )

  const advanceIds = Array.from(
    new Set(
      rows
        .filter((row: any) => row?.ref_type === 'subcontract_advance' && row?.ref_id)
        .map((row: any) => row.ref_id)
    )
  )

  const payableMap = new Map<string, any>()
  const advanceMap = new Map<string, any>()
  const inhouseMap = new Map<string, any>()

  if (payableIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('subcontract_payables')
      .select('id, is_deleted, status')
      .in('id', payableIds)
    if (error) throw error
    for (const row of data || []) payableMap.set(row.id, row)
  }

  if (advanceIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('subcontract_advances')
      .select('id, is_deleted, status')
      .in('id', advanceIds)
    if (error) throw error
    for (const row of data || []) advanceMap.set(row.id, row)
  }

  const inhouseIds = Array.from(
    new Set(
      rows
        .filter((row: any) => row?.ref_type === 'inhouse_payable' && row?.ref_id)
        .map((row: any) => row.ref_id)
    )
  )

  if (inhouseIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('inhouse_payables')
      .select('id, is_deleted, status')
      .in('id', inhouseIds)
    if (error) throw error
    for (const row of data || []) inhouseMap.set(row.id, row)
  }

  return rows.map((row: any) => {
    if (!row?.ref_type || !row?.ref_id) {
      return {
        ...row,
        source_exists: false,
        source_deleted: false,
        source_status: null,
      }
    }

    let linked: any = null
    if (row.ref_type === 'subcontract_payable') linked = payableMap.get(row.ref_id) || null
    if (row.ref_type === 'subcontract_advance') linked = advanceMap.get(row.ref_id) || null
    if (row.ref_type === 'inhouse_payable') linked = inhouseMap.get(row.ref_id) || null

    return {
      ...row,
      source_exists: !!linked,
      source_deleted: !!linked?.is_deleted,
      source_status: linked?.status || null,
    }
  })
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

    let items = data || []
    const ids = items.map((row: any) => row.id).filter(Boolean)

    if (ids.length > 0) {
      const { data: purposeRows, error: purposeError } = await supabaseAdmin
        .from('cash_transactions')
        .select('id, purpose_code, purpose_group, ref_type, ref_id')
        .in('id', ids)

      if (purposeError && !isMissingPurposeColumn(purposeError)) throw purposeError

      if (purposeRows) {
        const purposeMap = new Map(purposeRows.map((row: any) => [row.id, row]))
        items = items.map((row: any) => ({
          ...row,
          purpose_code: purposeMap.get(row.id)?.purpose_code || null,
          purpose_group: purposeMap.get(row.id)?.purpose_group || null,
          ref_type: purposeMap.get(row.id)?.ref_type || null,
          ref_id: purposeMap.get(row.id)?.ref_id || null,
        }))
      }
    }

    items = await enrichRefStatus(items)

    return NextResponse.json({ ok: true, items })
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
      purpose_code: body.purpose_code?.trim() || null,
      purpose_group: body.purpose_group?.trim() || null,
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

    if (error && isMissingPurposeColumn(error)) {
      throw new Error('cash_transactions purpose columns are missing. Run the latest Supabase migration first.')
    }

    if (error) throw error

    return NextResponse.json({ ok: true, item: data })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to create cash transaction' },
      { status: 500 }
    )
  }
}
