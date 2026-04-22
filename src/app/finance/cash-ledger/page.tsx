'use client'

import { useEffect, useMemo, useState } from 'react'

type AccountOption = {
  account_id?: string
  id?: string
  account_code: string
  account_name: string
  currency: 'USD' | 'KRW' | 'CNY' | 'VND'
}

type LedgerRow = {
  id: string
  tx_date: string
  account_id: string
  account_code: string
  account_name: string
  in_out: 'IN' | 'OUT'
  category: 'RECEIPT' | 'EXPENSE' | 'MANUAL' | 'TRANSFER' | 'FX'
  description: string
  counterparty_name?: string | null
  amount: number
  currency: 'USD' | 'KRW' | 'CNY' | 'VND'
}

function fmtMoney(value: number | null | undefined) {
  const num = Number(value || 0)
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500'

export default function CashLedgerPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [accountId, setAccountId] = useState('')
  const [currency, setCurrency] = useState('')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10))
  const [inOut, setInOut] = useState<'IN' | 'OUT'>('IN')
  const [formCategory, setFormCategory] = useState<'MANUAL' | 'RECEIPT' | 'EXPENSE' | 'TRANSFER' | 'FX'>('MANUAL')
  const [description, setDescription] = useState('')
  const [counterpartyName, setCounterpartyName] = useState('')
  const [amount, setAmount] = useState('0')
  const [memo, setMemo] = useState('')

  async function loadAccounts() {
    const res = await fetch('/api/finance/cash-accounts?active_only=true', { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load accounts')
    setAccounts(json.items || [])
  }

  async function loadLedger() {
    setLoading(true)
    setMessage('')
    try {
      const params = new URLSearchParams()
      if (accountId) params.set('account_id', accountId)
      if (currency) params.set('currency', currency)
      if (category) params.set('category', category)
      if (q.trim()) params.set('q', q.trim())
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      params.set('limit', '500')

      const res = await fetch(`/api/finance/cash-ledger?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load ledger')
      setRows(json.items || [])
    } catch (e: any) {
      setMessage(e?.message || 'Failed to load ledger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        await loadAccounts()
        await loadLedger()
      } catch (e: any) {
        setMessage(e?.message || 'Failed to initialize')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedAccount = useMemo(() => accounts.find((a) => (a.account_id || a.id) === accountId), [accounts, accountId])

  const totals = useMemo(() => {
    let totalIn = 0
    let totalOut = 0
    for (const row of rows) {
      if (row.in_out === 'IN') totalIn += Number(row.amount || 0)
      else totalOut += Number(row.amount || 0)
    }
    return { totalIn, totalOut, balance: totalIn - totalOut }
  }, [rows])

  async function onSave() {
    if (!accountId) {
      setMessage('Please select account')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/finance/cash-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          tx_date: txDate,
          in_out: inOut,
          category: formCategory,
          description,
          counterparty_name: counterpartyName,
          amount: Number(amount || 0),
          memo,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save')
      setDescription('')
      setCounterpartyName('')
      setAmount('0')
      setMemo('')
      setMessage('Saved')
      await loadLedger()
    } catch (e: any) {
      setMessage(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 p-4 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Cash Ledger</h1>
            <p className="mt-1 text-xs text-gray-500">Manual cash / bank in-out ledger by account.</p>
          </div>
          <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700" onClick={loadLedger}>Refresh</button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="text-xs text-gray-500">Total In</div>
            <div className="mt-1 text-xl font-bold">{fmtMoney(totals.totalIn)}</div>
          </div>
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="text-xs text-gray-500">Total Out</div>
            <div className="mt-1 text-xl font-bold">{fmtMoney(totals.totalOut)}</div>
          </div>
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="text-xs text-gray-500">Net Movement</div>
            <div className="mt-1 text-xl font-bold">{fmtMoney(totals.balance)}</div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
          <div className="text-lg font-semibold">Manual Entry</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Select Account</option>
              {accounts.map((a) => {
                const id = a.account_id || a.id || ''
                return <option key={id} value={id}>{a.account_code} / {a.account_name}</option>
              })}
            </select>
            <input className={inputCls} type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
            <select className={inputCls} value={inOut} onChange={(e) => setInOut(e.target.value as 'IN' | 'OUT')}>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>
            <select className={inputCls} value={formCategory} onChange={(e) => setFormCategory(e.target.value as 'MANUAL' | 'RECEIPT' | 'EXPENSE' | 'TRANSFER' | 'FX')}>
              <option value="MANUAL">MANUAL</option>
              <option value="RECEIPT">RECEIPT</option>
              <option value="EXPENSE">EXPENSE</option>
              <option value="TRANSFER">TRANSFER</option>
              <option value="FX">FX</option>
            </select>
            <input className={`${inputCls} md:col-span-2`} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <input className={inputCls} placeholder="Counterparty" value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} />
            <input className={inputCls} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
            <textarea className={`${inputCls} md:col-span-2`} rows={2} placeholder="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
              Selected currency: <span className="font-semibold">{selectedAccount?.currency || '-'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-md border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50" onClick={() => { setDescription(''); setCounterpartyName(''); setAmount('0'); setMemo('') }}>Reset</button>
              <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50" disabled={saving} onClick={onSave}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
          {message && <div className="text-xs text-red-600">{message}</div>}
        </div>

        <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
            <select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All Accounts</option>
              {accounts.map((a) => {
                const id = a.account_id || a.id || ''
                return <option key={id} value={id}>{a.account_code}</option>
              })}
            </select>
            <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="">All Currencies</option>
              <option value="USD">USD</option>
              <option value="KRW">KRW</option>
              <option value="CNY">CNY</option>
              <option value="VND">VND</option>
            </select>
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All Categories</option>
              <option value="RECEIPT">RECEIPT</option>
              <option value="EXPENSE">EXPENSE</option>
              <option value="MANUAL">MANUAL</option>
              <option value="TRANSFER">TRANSFER</option>
              <option value="FX">FX</option>
            </select>
            <input className={inputCls} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <input className={inputCls} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <input className={inputCls} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="rounded-md border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50" onClick={() => { setAccountId(''); setCurrency(''); setCategory(''); setDateFrom(''); setDateTo(''); setQ('') }}>Reset</button>
            <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700" onClick={loadLedger}>Apply</button>
          </div>

          <div className="overflow-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-2.5 py-2">Date</th>
                  <th className="px-2.5 py-2">Account</th>
                  <th className="px-2.5 py-2">Type</th>
                  <th className="px-2.5 py-2">Category</th>
                  <th className="px-2.5 py-2">Description</th>
                  <th className="px-2.5 py-2">Counterparty</th>
                  <th className="px-2.5 py-2 text-right">Amount</th>
                  <th className="px-2.5 py-2">Currency</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-2.5 py-4 text-center text-gray-500" colSpan={8}>Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td className="px-2.5 py-4 text-center text-gray-500" colSpan={8}>No data</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="px-2.5 py-2">{row.tx_date}</td>
                    <td className="px-2.5 py-2">{row.account_code}<div className="text-[11px] text-gray-500">{row.account_name}</div></td>
                    <td className={`px-2.5 py-2 font-semibold ${row.in_out === 'IN' ? 'text-blue-600' : 'text-red-600'}`}>{row.in_out}</td>
                    <td className="px-2.5 py-2">{row.category}</td>
                    <td className="px-2.5 py-2">{row.description}</td>
                    <td className="px-2.5 py-2">{row.counterparty_name || '-'}</td>
                    <td className="px-2.5 py-2 text-right">{fmtMoney(row.amount)}</td>
                    <td className="px-2.5 py-2">{row.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
  )
}
