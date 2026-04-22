import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function hasMissingBankDetailColumn(error: any) {
  return String(error?.message || '').includes('does not exist')
}

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { data, error } = await supabaseAdmin
      .from('v_cash_account_balances')
      .select('*')
      .eq('account_id', id)
      .single()

    if (error) throw error

    let detailResult: any = await supabaseAdmin
      .from('cash_accounts')
      .select('id, account_no, account_holder_name, swift_code, bank_address, beneficiary_address, bank_detail_note')
      .eq('id', id)
      .single()

    if (detailResult.error && hasMissingBankDetailColumn(detailResult.error)) {
      detailResult = await supabaseAdmin
        .from('cash_accounts')
        .select('id, account_no')
        .eq('id', id)
        .single()
    }

    const { data: detail, error: detailError } = detailResult
    if (detailError) throw detailError
    return NextResponse.json({ ok: true, item: { ...data, ...detail, id: data.id } })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load cash account' },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const body = await req.json()

    const payload = {
      account_code: body.account_code?.trim()?.toUpperCase(),
      account_name: body.account_name?.trim(),
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
      updated_by: body.updated_by || null,
      updated_by_email: body.updated_by_email || null,
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
      updated_by: payload.updated_by,
      updated_by_email: payload.updated_by_email,
    }

    let result = await supabaseAdmin
      .from('cash_accounts')
      .update(payload)
      .eq('id', id)
      .eq('is_deleted', false)
      .select('*')
      .single()

    if (result.error && hasMissingBankDetailColumn(result.error)) {
      result = await supabaseAdmin
        .from('cash_accounts')
        .update(legacyPayload)
        .eq('id', id)
        .eq('is_deleted', false)
        .select('*')
        .single()
    }

    const { data, error } = result
    if (error) throw error
    return NextResponse.json({ ok: true, item: data })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to update cash account' },
      { status: 500 }
    )
  }
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params

    const { error } = await supabaseAdmin
      .from('cash_accounts')
      .update({ is_deleted: true, is_active: false })
      .eq('id', id)
      .eq('is_deleted', false)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to delete cash account' },
      { status: 500 }
    )
  }
}
