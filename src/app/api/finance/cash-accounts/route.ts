import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type CashAccountInsert = {
  account_code: string
  account_name: string
  account_type: 'CASH' | 'BANK'
  currency: 'USD' | 'KRW' | 'CNY' | 'VND'
  bank_name?: string | null
  account_no?: string | null
  account_holder_name?: string | null
  swift_code?: string | null
  bank_address?: string | null
  beneficiary_address?: string | null
  bank_detail_note?: string | null
  opening_balance?: number
  opening_balance_date?: string | null
  remarks?: string | null
  is_active?: boolean
  created_by?: string | null
  created_by_email?: string | null
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function hasMissingBankDetailColumn(error: any) {
  return String(error?.message || '').includes('does not exist')
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') || '').trim()
    const accountType = (searchParams.get('account_type') || '').trim()
    const currency = (searchParams.get('currency') || '').trim()
    const activeOnly = (searchParams.get('active_only') || 'false') === 'true'

    let query = supabaseAdmin
      .from('v_cash_account_balances')
      .select('*')
      .order('account_code', { ascending: true })

    if (accountType) query = query.eq('account_type', accountType)
    if (currency) query = query.eq('currency', currency)
    if (activeOnly) query = query.eq('is_active', true)
    if (q) {
      query = query.or(
        `account_code.ilike.%${q}%,account_name.ilike.%${q}%,bank_name.ilike.%${q}%`
      )
    }

    const { data, error } = await query
    if (error) throw error

    const rows = data || []
    const ids = rows.map((row: any) => row.account_id || row.id).filter(Boolean)

    if (ids.length > 0) {
      let detailResult: any = await supabaseAdmin
        .from('cash_accounts')
        .select('id, account_no, account_holder_name, swift_code, bank_address, beneficiary_address, bank_detail_note')
        .in('id', ids)

      if (detailResult.error && hasMissingBankDetailColumn(detailResult.error)) {
        detailResult = await supabaseAdmin
          .from('cash_accounts')
          .select('id, account_no')
          .in('id', ids)
      }

      const { data: details, error: detailError } = detailResult
      if (detailError) throw detailError

      const detailMap = new Map((details || []).map((row: any) => [row.id, row]))
      const merged = rows.map((row: any) => {
        const detail = detailMap.get(row.account_id || row.id)
        return detail ? { ...row, ...detail, id: row.id } : row
      })
      return NextResponse.json({ ok: true, items: merged })
    }

    return NextResponse.json({ ok: true, items: rows })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load cash accounts' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CashAccountInsert

    if (!body.account_code?.trim()) {
      return NextResponse.json({ ok: false, error: 'account_code is required' }, { status: 400 })
    }
    if (!body.account_name?.trim()) {
      return NextResponse.json({ ok: false, error: 'account_name is required' }, { status: 400 })
    }
    if (!['CASH', 'BANK'].includes(body.account_type)) {
      return NextResponse.json({ ok: false, error: 'Invalid account_type' }, { status: 400 })
    }
    if (!['USD', 'KRW', 'CNY', 'VND'].includes(body.currency)) {
      return NextResponse.json({ ok: false, error: 'Invalid currency' }, { status: 400 })
    }

    const payload = {
      account_code: body.account_code.trim().toUpperCase(),
      account_name: body.account_name.trim(),
      account_type: body.account_type,
      currency: body.currency,
      bank_name: body.bank_name?.trim() || null,
      account_no: body.account_no?.trim() || null,
      account_holder_name: body.account_holder_name?.trim() || null,
      swift_code: body.swift_code?.trim()?.toUpperCase() || null,
      bank_address: body.bank_address?.trim() || null,
      beneficiary_address: body.beneficiary_address?.trim() || null,
      bank_detail_note: body.bank_detail_note?.trim() || null,
      opening_balance: toNumber(body.opening_balance, 0),
      opening_balance_date: body.opening_balance_date || null,
      remarks: body.remarks?.trim() || null,
      is_active: body.is_active ?? true,
      created_by: body.created_by || null,
      created_by_email: body.created_by_email || null,
      updated_by: body.created_by || null,
      updated_by_email: body.created_by_email || null,
    }

    const legacyPayload = {
      account_code: payload.account_code,
      account_name: payload.account_name,
      account_type: payload.account_type,
      currency: payload.currency,
      bank_name: payload.bank_name,
      account_no: payload.account_no,
      opening_balance: payload.opening_balance,
      opening_balance_date: payload.opening_balance_date,
      remarks: payload.remarks,
      is_active: payload.is_active,
      created_by: payload.created_by,
      created_by_email: payload.created_by_email,
      updated_by: payload.updated_by,
      updated_by_email: payload.updated_by_email,
    }

    let result = await supabaseAdmin
      .from('cash_accounts')
      .insert(payload)
      .select('*')
      .single()

    if (result.error && hasMissingBankDetailColumn(result.error)) {
      result = await supabaseAdmin
        .from('cash_accounts')
        .insert(legacyPayload)
        .select('*')
        .single()
    }

    const { data, error } = result
    if (error) throw error

    return NextResponse.json({ ok: true, item: data })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to create cash account' },
      { status: 500 }
    )
  }
}
