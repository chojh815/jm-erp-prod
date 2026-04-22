'use client'

import { useEffect, useMemo, useState } from 'react'

type AccountOption = {
  account_id: string
  account_code: string
  account_name: string
  currency: string
  is_active?: boolean
}

type TransferItem = {
  id: string
  transfer_date: string
  from_amount: number
  to_amount: number
  from_currency: string
  to_currency: string
  fx_rate: number | null
  description: string | null
  memo: string | null
  from_account?: { account_code?: string; account_name?: string }
  to_account?: { account_code?: string; account_name?: string }
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500'

export default function TransfersPage() {
  const today = new Date().toISOString().slice(0, 10)

  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [items, setItems] = useState<TransferItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [transferDate, setTransferDate] = useState(today)
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [description, setDescription] = useState('')
  const [memo, setMemo] = useState('')

  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterQ, setFilterQ] = useState('')

  const fromAccount = useMemo(
    () => accounts.find((a) => a.account_id === fromAccountId) || null,
    [accounts, fromAccountId]
  )

  const toAccount = useMemo(
    () => accounts.find((a) => a.account_id === toAccountId) || null,
    [accounts, toAccountId]
  )

  const transferType = useMemo(() => {
    if (!fromAccount || !toAccount) return '-'
    return fromAccount.currency === toAccount.currency ? 'TRANSFER' : 'FX'
  }, [fromAccount, toAccount])

  const fxRate = useMemo(() => {
    const from = Number(fromAmount || 0)
    const to = Number(toAmount || 0)
    if (from > 0 && to > 0) return (to / from).toFixed(6)
    return ''
  }, [fromAmount, toAmount])

  async function loadAccounts() {
    const res = await fetch('/api/finance/cash-accounts', { cache: 'no-store' })
    const json = await res.json()
    if (!json?.ok) throw new Error(json?.error || 'Failed to load accounts')
    setAccounts((json.items || []).filter((x: any) => x.is_active !== false))
  }

  async function loadTransfers() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (filterFrom) params.set('from', filterFrom)
      if (filterTo) params.set('to', filterTo)
      if (filterQ.trim()) params.set('q', filterQ.trim())
      const url = `/api/finance/transfers${params.toString() ? `?${params.toString()}` : ''}`
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to load transfers')
      setItems(json.items || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load transfers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        await loadAccounts()
        await loadTransfers()
      } catch (e: any) {
        setError(e?.message || 'Failed to initialize page')
      }
    })()
  }, [])

  async function onSave() {
    setError('')
    if (!fromAccountId || !toAccountId) {
      setError('From / To account is required')
      return
    }
    if (fromAccountId === toAccountId) {
      setError('From and To account must be different')
      return
    }
    if (!(Number(fromAmount) > 0) || !(Number(toAmount) > 0)) {
      setError('From / To amount must be greater than 0')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/finance/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transfer_date: transferDate,
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          from_amount: Number(fromAmount),
          to_amount: Number(toAmount),
          description,
          memo,
        }),
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to save transfer')

      setFromAccountId('')
      setToAccountId('')
      setFromAmount('')
      setToAmount('')
      setDescription('')
      setMemo('')

      await loadTransfers()
    } catch (e: any) {
      setError(e?.message || 'Failed to save transfer')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this transfer?')) return
    setError('')
    try {
      const res = await fetch(`/api/finance/transfers/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to delete transfer')
      await loadTransfers()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete transfer')
    }
  }

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transfers / FX</h1>
          <p className="mt-1 text-xs text-gray-500">Account-to-account transfer and foreign exchange posting.</p>
        </div>
        <button onClick={loadTransfers} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">Transfer Count</div>
          <div className="mt-1 text-2xl font-bold">{items.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">Same Currency</div>
          <div className="mt-1 text-2xl font-bold">{items.filter((x) => x.from_currency === x.to_currency).length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">FX Count</div>
          <div className="mt-1 text-2xl font-bold">{items.filter((x) => x.from_currency !== x.to_currency).length}</div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-bold">New Transfer / FX</h2>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Transfer Date</label>
            <input type="date" className={inputCls} value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">From Account</label>
            <select className={inputCls} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
              <option value="">Select From Account</option>
              {accounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.account_code} / {a.account_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">To Account</label>
            <select className={inputCls} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">Select To Account</option>
              {accounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.account_code} / {a.account_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium">From Amount</label>
            <input className={inputCls} value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">To Amount</label>
            <input className={inputCls} value={toAmount} onChange={(e) => setToAmount(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Type</label>
            <div className={`${inputCls} bg-gray-50`}>{transferType}</div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">FX Rate</label>
            <div className={`${inputCls} bg-gray-50`}>{fxRate || '-'}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Description</label>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Memo</label>
            <input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo" />
          </div>
        </div>

        <div className="grid grid-cols-1 items-end gap-3 text-xs text-gray-600 md:grid-cols-4">
          <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
            From Currency: <span className="font-semibold">{fromAccount?.currency || '-'}</span>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
            To Currency: <span className="font-semibold">{toAccount?.currency || '-'}</span>
          </div>
          <button
            onClick={() => {
              setTransferDate(today)
              setFromAccountId('')
              setToAccountId('')
              setFromAmount('')
              setToAmount('')
              setDescription('')
              setMemo('')
              setError('')
            }}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            Reset
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {error ? <div className="text-xs text-red-600">{error}</div> : null}
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">Transfer History</h2>
          <div className="grid w-full max-w-3xl grid-cols-1 gap-2 md:grid-cols-3">
            <input type="date" className={inputCls} value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            <input type="date" className={inputCls} value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            <input className={inputCls} value={filterQ} onChange={(e) => setFilterQ(e.target.value)} placeholder="Search" />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2.5 py-2 text-left">Date</th>
                <th className="px-2.5 py-2 text-left">Type</th>
                <th className="px-2.5 py-2 text-left">From Account</th>
                <th className="px-2.5 py-2 text-left">To Account</th>
                <th className="px-2.5 py-2 text-right">From Amount</th>
                <th className="px-2.5 py-2 text-right">To Amount</th>
                <th className="px-2.5 py-2 text-right">FX Rate</th>
                <th className="px-2.5 py-2 text-left">Description</th>
                <th className="px-2.5 py-2 text-left">Memo</th>
                <th className="px-2.5 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-2.5 py-4 text-center text-gray-500" colSpan={10}>Loading...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-2.5 py-4 text-center text-gray-500" colSpan={10}>No transfers</td>
                </tr>
              ) : (
                items.map((row) => {
                  const rowType = row.from_currency === row.to_currency ? 'TRANSFER' : 'FX'
                  return (
                    <tr key={row.id} className="border-t border-gray-200">
                      <td className="px-2.5 py-2">{row.transfer_date}</td>
                      <td className="px-2.5 py-2 font-semibold">{rowType}</td>
                      <td className="px-2.5 py-2">{row.from_account?.account_code} / {row.from_account?.account_name}</td>
                      <td className="px-2.5 py-2">{row.to_account?.account_code} / {row.to_account?.account_name}</td>
                      <td className="px-2.5 py-2 text-right">{Number(row.from_amount || 0).toLocaleString()}</td>
                      <td className="px-2.5 py-2 text-right">{Number(row.to_amount || 0).toLocaleString()}</td>
                      <td className="px-2.5 py-2 text-right">{row.fx_rate ? Number(row.fx_rate).toLocaleString() : '-'}</td>
                      <td className="px-2.5 py-2">{row.description || '-'}</td>
                      <td className="px-2.5 py-2">{row.memo || '-'}</td>
                      <td className="px-2.5 py-2 text-center">
                        <button
                          onClick={() => onDelete(row.id)}
                          className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
