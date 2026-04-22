import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id

    const { data: transfer, error: transferError } = await supabaseAdmin
      .from('cash_transfers')
      .select('id, out_tx_id, in_tx_id')
      .eq('id', id)
      .eq('is_deleted', false)
      .single()

    if (transferError) throw transferError
    if (!transfer) {
      return NextResponse.json({ ok: false, error: 'Transfer not found' }, { status: 404 })
    }

    const txIds = [transfer.out_tx_id, transfer.in_tx_id].filter(Boolean)

    if (txIds.length > 0) {
      const { error: txError } = await supabaseAdmin
        .from('cash_transactions')
        .update({ is_deleted: true })
        .in('id', txIds)

      if (txError) throw txError
    }

    const { error: deleteError } = await supabaseAdmin
      .from('cash_transfers')
      .update({ is_deleted: true })
      .eq('id', id)

    if (deleteError) throw deleteError

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Failed to delete transfer' }, { status: 500 })
  }
}
