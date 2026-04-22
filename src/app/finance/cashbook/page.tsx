'use client'

import { useEffect, useMemo, useState } from 'react'

type Currency = 'USD' | 'KRW' | 'CNY' | 'VND'
type EntryMode = 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER' | 'FX' | 'ADJUST'
type InOut = 'IN' | 'OUT'
type OutputLang = 'en' | 'zh'
type PurposeGroup = 'Revenue' | 'Direct Cost' | 'Overhead' | 'Financial Cost' | 'Tax' | 'Owner / Equity' | 'Other'

type CashAccount = {
  account_id?: string
  id?: string
  account_code: string
  account_name: string
  account_type: 'CASH' | 'BANK'
  currency: Currency
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
  current_balance?: number
  is_active?: boolean
}

type AccountForm = {
  account_code: string
  account_name: string
  account_type: 'CASH' | 'BANK'
  currency: Currency
  bank_name: string
  account_no: string
  account_holder_name: string
  swift_code: string
  bank_address: string
  beneficiary_address: string
  bank_detail_note: string
  opening_balance: string
  opening_balance_date: string
  remarks: string
  is_active: boolean
}

type LedgerRow = {
  id: string
  tx_date: string
  account_code: string
  account_name: string
  in_out: InOut
  category: 'RECEIPT' | 'EXPENSE' | 'MANUAL' | 'TRANSFER' | 'FX'
  purpose_code?: string | null
  purpose_group?: string | null
  description: string
  counterparty_name?: string | null
  amount: number
  currency: Currency
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500'

const compactBtn =
  'rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50'

const emptyAccountForm: AccountForm = {
  account_code: '',
  account_name: '',
  account_type: 'BANK',
  currency: 'USD',
  bank_name: '',
  account_no: '',
  account_holder_name: '',
  swift_code: '',
  bank_address: '',
  beneficiary_address: '',
  bank_detail_note: '',
  opening_balance: '0',
  opening_balance_date: '',
  remarks: '',
  is_active: true,
}

const purposeOptions: { code: string; label: string; group: PurposeGroup }[] = [
  { code: 'SALES_RECEIPT', label: 'Sales Receipt', group: 'Revenue' },
  { code: 'PURCHASE_PAYMENT', label: 'Purchase Payment', group: 'Direct Cost' },
  { code: 'FREIGHT', label: 'Freight', group: 'Direct Cost' },
  { code: 'SAMPLE_COST', label: 'Sample Cost', group: 'Direct Cost' },
  { code: 'PAYROLL', label: 'Payroll', group: 'Overhead' },
  { code: 'RENT', label: 'Rent', group: 'Overhead' },
  { code: 'UTILITIES', label: 'Utilities', group: 'Overhead' },
  { code: 'OFFICE_SUPPLIES', label: 'Office Supplies', group: 'Overhead' },
  { code: 'MEALS', label: 'Meals', group: 'Overhead' },
  { code: 'TRAVEL', label: 'Travel', group: 'Overhead' },
  { code: 'VEHICLE_MAINTENANCE', label: 'Vehicle Maintenance', group: 'Overhead' },
  { code: 'TRANSPORTATION', label: 'Transportation', group: 'Overhead' },
  { code: 'EMPLOYEE_BENEFITS', label: 'Employee Benefits', group: 'Overhead' },
  { code: 'MISC_EXPENSE', label: 'Misc Expense', group: 'Overhead' },
  { code: 'BANK_FEE', label: 'Bank Fee', group: 'Financial Cost' },
  { code: 'TAX_PAYMENT', label: 'Tax Payment', group: 'Tax' },
  { code: 'OWNER_DRAW', label: 'Owner Draw', group: 'Owner / Equity' },
  { code: 'CAPITAL_INJECTION', label: 'Capital Injection', group: 'Owner / Equity' },
  { code: 'ADJUSTMENT', label: 'Adjustment', group: 'Other' },
  { code: 'OTHER', label: 'Other', group: 'Other' },
]

const excelLabels = {
  en: {
    exportDate: 'Export Date',
    cashbookSummary: 'Cashbook Summary',
    cashBankAccounts: 'Cash / Bank Accounts',
    cashbookLines: 'Cashbook Lines',
    bankDetails: 'Bank Details',
    buyerBankDetails: 'Buyer Remittance Bank Details',
    currency: 'Currency',
    balance: 'Balance',
    accountCount: 'Account Count',
    bankCount: 'Bank Count',
    cashCount: 'Cash Count',
    code: 'Code',
    name: 'Name',
    type: 'Type',
    bank: 'Bank',
    accountNo: 'Account No',
    opening: 'Opening',
    current: 'Current',
    date: 'Date',
    account: 'Account',
    accountName: 'Account Name',
    inOut: 'In/Out',
    category: 'Category',
    purposeGroup: 'Purpose Group',
    purpose: 'Purpose',
    description: 'Description',
    counterparty: 'Counterparty',
    amount: 'Amount',
    holderName: 'Holder Name',
    swift: 'SWIFT',
    bankAddress: 'Bank Address',
    beneficiaryAddress: 'Beneficiary Address',
    note: 'Note',
  },
  zh: {
    exportDate: '导出日期',
    cashbookSummary: '现金出纳账汇总',
    cashBankAccounts: '现金/银行账户',
    cashbookLines: '出纳明细',
    bankDetails: '银行信息',
    buyerBankDetails: '买方汇款银行信息',
    currency: '币种',
    balance: '余额',
    accountCount: '账户数量',
    bankCount: '银行账户数',
    cashCount: '现金账户数',
    code: '代码',
    name: '名称',
    type: '类型',
    bank: '银行',
    accountNo: '账号',
    opening: '期初余额',
    current: '当前余额',
    date: '日期',
    account: '账户',
    accountName: '账户名称',
    inOut: '收入/支出',
    category: '类别',
    purposeGroup: '用途组',
    purpose: '用途',
    description: '摘要',
    counterparty: '往来单位',
    amount: '金额',
    holderName: '账户持有人',
    swift: 'SWIFT',
    bankAddress: '银行地址',
    beneficiaryAddress: '收款人地址',
    note: '备注',
  },
}

function accountId(account: CashAccount) {
  return account.account_id || account.id || ''
}

function fmtMoney(value: number | null | undefined) {
  const num = Number(value || 0)
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function reportDate() {
  return new Date().toISOString().slice(0, 10)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function purposeLabel(code?: string | null) {
  if (!code) return ''
  return purposeOptions.find((item) => item.code === code)?.label || code
}

export default function CashbookPage() {
  const today = new Date().toISOString().slice(0, 10)

  const [accounts, setAccounts] = useState<CashAccount[]>([])
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAccount, setSavingAccount] = useState(false)
  const [message, setMessage] = useState('')
  const [accountMessage, setAccountMessage] = useState('')

  const [mode, setMode] = useState<EntryMode>('WITHDRAW')
  const [txDate, setTxDate] = useState(today)
  const [account, setAccount] = useState('')
  const [fromAccount, setFromAccount] = useState('')
  const [toAccount, setToAccount] = useState('')
  const [amount, setAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [fxRate, setFxRate] = useState('')
  const [adjustDirection, setAdjustDirection] = useState<InOut>('IN')
  const [purposeCode, setPurposeCode] = useState('')
  const [description, setDescription] = useState('')
  const [counterpartyName, setCounterpartyName] = useState('')
  const [memo, setMemo] = useState('')

  const [filterAccount, setFilterAccount] = useState('')
  const [filterCurrency, setFilterCurrency] = useState('')
  const [filterPurpose, setFilterPurpose] = useState('')
  const [filterQ, setFilterQ] = useState('')
  const [editingAccountId, setEditingAccountId] = useState('')
  const [showBankDetail, setShowBankDetail] = useState(false)
  const [showAccountSetup, setShowAccountSetup] = useState(false)
  const [excelLang, setExcelLang] = useState<OutputLang>('en')
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm)

  const activeAccounts = useMemo(() => accounts.filter((x) => x.is_active !== false), [accounts])
  const selectedAccount = useMemo(() => activeAccounts.find((x) => accountId(x) === account), [activeAccounts, account])
  const selectedFrom = useMemo(() => activeAccounts.find((x) => accountId(x) === fromAccount), [activeAccounts, fromAccount])
  const selectedTo = useMemo(() => activeAccounts.find((x) => accountId(x) === toAccount), [activeAccounts, toAccount])
  const selectedPurpose = useMemo(() => purposeOptions.find((x) => x.code === purposeCode), [purposeCode])

  const totalsByCurrency = useMemo(() => {
    const map = new Map<Currency, number>()
    for (const row of accounts) {
      map.set(row.currency, (map.get(row.currency) || 0) + Number(row.current_balance || 0))
    }
    return (['USD', 'KRW', 'CNY', 'VND'] as Currency[]).map((currency) => ({
      currency,
      total: map.get(currency) || 0,
    }))
  }, [accounts])

  const visibleRows = useMemo(() => {
    if (!filterPurpose) return rows
    return rows.filter((row) => row.purpose_code === filterPurpose)
  }, [filterPurpose, rows])

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
      if (filterAccount) params.set('account_id', filterAccount)
      if (filterCurrency) params.set('currency', filterCurrency)
      if (filterQ.trim()) params.set('q', filterQ.trim())
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

  async function refreshAll() {
    await Promise.all([loadAccounts(), loadLedger()])
  }

  useEffect(() => {
    ;(async () => {
      try {
        await refreshAll()
      } catch (e: any) {
        setMessage(e?.message || 'Failed to initialize cashbook')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetForm() {
    setTxDate(today)
    setAccount('')
    setFromAccount('')
    setToAccount('')
    setAmount('')
    setToAmount('')
    setFxRate('')
    setAdjustDirection('IN')
    setPurposeCode('')
    setDescription('')
    setCounterpartyName('')
    setMemo('')
    setMessage('')
  }

  function resetAccountForm() {
    setEditingAccountId('')
    setShowBankDetail(false)
    setAccountForm(emptyAccountForm)
    setAccountMessage('')
  }

  function editAccount(row: CashAccount) {
    setEditingAccountId(accountId(row))
    setAccountForm({
      account_code: row.account_code || '',
      account_name: row.account_name || '',
      account_type: row.account_type || 'BANK',
      currency: row.currency || 'USD',
      bank_name: row.bank_name || '',
      account_no: row.account_no || '',
      account_holder_name: row.account_holder_name || '',
      swift_code: row.swift_code || '',
      bank_address: row.bank_address || '',
      beneficiary_address: row.beneficiary_address || '',
      bank_detail_note: row.bank_detail_note || '',
      opening_balance: String(row.opening_balance || 0),
      opening_balance_date: row.opening_balance_date || '',
      remarks: row.remarks || '',
      is_active: row.is_active ?? true,
    })
    setShowBankDetail(false)
    setAccountMessage('')
  }

  async function saveAccount() {
    setAccountMessage('')
    if (!accountForm.account_code.trim()) {
      setAccountMessage('Account code is required')
      return
    }
    if (!accountForm.account_name.trim()) {
      setAccountMessage('Account name is required')
      return
    }

    setSavingAccount(true)
    try {
      const url = editingAccountId ? `/api/finance/cash-accounts/${editingAccountId}` : '/api/finance/cash-accounts'
      const method = editingAccountId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...accountForm,
          opening_balance: Number(accountForm.opening_balance || 0),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save account')

      resetAccountForm()
      setAccountMessage('Account saved')
      await refreshAll()
    } catch (e: any) {
      setAccountMessage(e?.message || 'Failed to save account')
    } finally {
      setSavingAccount(false)
    }
  }

  async function deleteAccount(id: string) {
    if (!window.confirm('Delete this account? Existing ledger history remains, but the account will no longer be active.')) return
    setAccountMessage('')
    try {
      const res = await fetch(`/api/finance/cash-accounts/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to delete account')

      if (account === id) setAccount('')
      if (fromAccount === id) setFromAccount('')
      if (toAccount === id) setToAccount('')
      if (filterAccount === id) setFilterAccount('')
      resetAccountForm()
      setAccountMessage('Account deleted')
      await refreshAll()
    } catch (e: any) {
      setAccountMessage(e?.message || 'Failed to delete account')
    }
  }

  async function exportCashbookExcel() {
    const ExcelJS = await import('exceljs')
    const t = excelLabels[excelLang]
    const wb = new ExcelJS.Workbook()
    wb.creator = 'JM ERP'
    wb.created = new Date()

    const titleFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F4E78' } }
    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF374151' } }
    const thinBorder = {
      top: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
    }

    function setupSheet(ws: any, title: string, columnWidths: number[]) {
      ws.mergeCells(1, 1, 1, columnWidths.length)
      const titleCell = ws.getCell(1, 1)
      titleCell.value = title
      titleCell.fill = titleFill
      titleCell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 14 }
      titleCell.alignment = { vertical: 'middle' }
      ws.getRow(1).height = 24

      ws.mergeCells(2, 1, 2, columnWidths.length)
      ws.getCell(2, 1).value = `${t.exportDate}: ${reportDate()}`
      ws.getCell(2, 1).font = { color: { argb: 'FF6B7280' }, size: 9 }
      ws.getRow(2).height = 18

      columnWidths.forEach((width, index) => {
        ws.getColumn(index + 1).width = width
      })
      ws.views = [{ state: 'frozen', ySplit: 3 }]
    }

    function styleTable(ws: any, headerRowNumber = 4) {
      const headerRow = ws.getRow(headerRowNumber)
      headerRow.eachCell((cell: any) => {
        cell.fill = headerFill
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 9 }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        cell.border = thinBorder
      })
      ws.autoFilter = {
        from: { row: headerRowNumber, column: 1 },
        to: { row: headerRowNumber, column: ws.columnCount },
      }
      for (let rowNumber = headerRowNumber + 1; rowNumber <= ws.rowCount; rowNumber += 1) {
        const row = ws.getRow(rowNumber)
        row.height = 18
        row.eachCell((cell: any) => {
          cell.border = thinBorder
          cell.font = { size: 9 }
          cell.alignment = { vertical: 'middle', wrapText: false }
        })
      }
    }

    const summary = wb.addWorksheet(excelLang === 'zh' ? '汇总' : 'Summary')
    setupSheet(summary, t.cashbookSummary, [14, 18, 14, 18, 18, 18])
    summary.getRow(4).values = [t.currency, t.balance, '', t.accountCount, t.bankCount, t.cashCount]
    totalsByCurrency.forEach((item, index) => {
      const accountRows = activeAccounts.filter((row) => row.currency === item.currency)
      summary.addRow([
        item.currency,
        Number(item.total || 0),
        '',
        accountRows.length,
        accountRows.filter((row) => row.account_type === 'BANK').length,
        accountRows.filter((row) => row.account_type === 'CASH').length,
      ])
    })
    summary.getColumn(2).numFmt = '#,##0.00'
    styleTable(summary)

    const accountsSheet = wb.addWorksheet(excelLang === 'zh' ? '账户' : 'Accounts')
    setupSheet(accountsSheet, t.cashBankAccounts, [16, 24, 10, 10, 22, 20, 16, 16])
    accountsSheet.getRow(4).values = [t.code, t.name, t.type, t.currency, t.bank, t.accountNo, t.opening, t.current]
    activeAccounts.forEach((row) => {
      accountsSheet.addRow([
        row.account_code,
        row.account_name,
        row.account_type,
        row.currency,
        row.bank_name || '',
        row.account_no || '',
        Number(row.opening_balance || 0),
        Number(row.current_balance || 0),
      ])
    })
    accountsSheet.getColumn(7).numFmt = '#,##0.00'
    accountsSheet.getColumn(8).numFmt = '#,##0.00'
    styleTable(accountsSheet)

    const ledgerSheet = wb.addWorksheet(excelLang === 'zh' ? '出纳明细' : 'Cashbook Lines')
    setupSheet(ledgerSheet, t.cashbookLines, [12, 16, 24, 10, 14, 18, 22, 32, 18, 16, 10])
    ledgerSheet.getRow(4).values = [t.date, t.account, t.accountName, t.inOut, t.category, t.purposeGroup, t.purpose, t.description, t.counterparty, t.amount, t.currency]
    visibleRows.forEach((row) => {
      ledgerSheet.addRow([
        row.tx_date,
        row.account_code,
        row.account_name,
        row.in_out,
        row.category,
        row.purpose_group || '',
        purposeLabel(row.purpose_code),
        row.description,
        row.counterparty_name || '',
        Number(row.amount || 0),
        row.currency,
      ])
    })
    ledgerSheet.getColumn(10).numFmt = '#,##0.00'
    styleTable(ledgerSheet)

    const bankSheet = wb.addWorksheet(excelLang === 'zh' ? '银行信息' : 'Bank Details')
    setupSheet(bankSheet, t.buyerBankDetails, [16, 24, 22, 22, 20, 22, 36, 36, 30])
    bankSheet.getRow(4).values = [t.code, t.name, t.bank, t.accountNo, t.holderName, t.swift, t.bankAddress, t.beneficiaryAddress, t.note]
    activeAccounts.forEach((row) => {
      bankSheet.addRow([
        row.account_code,
        row.account_name,
        row.bank_name || '',
        row.account_no || '',
        row.account_holder_name || '',
        row.swift_code || '',
        row.bank_address || '',
        row.beneficiary_address || '',
        row.bank_detail_note || '',
      ])
    })
    styleTable(bankSheet)

    const buffer = await wb.xlsx.writeBuffer()
    downloadBlob(
      new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `cashbook_${excelLang}_${reportDate()}.xlsx`
    )
  }

  async function exportCashbookPdf() {
    const [{ default: jsPDF }, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const autoTable = (autoTableModule as any).default || (autoTableModule as any).autoTable
    const doc = new jsPDF({ orientation: 'landscape' })

    doc.setFontSize(14)
    doc.text('Cashbook Report', 14, 14)
    doc.setFontSize(9)
    doc.text(`Date: ${reportDate()}`, 14, 21)

    autoTable(doc, {
      startY: 26,
      head: [['Currency', 'Balance']],
      body: totalsByCurrency.map((item) => [item.currency, fmtMoney(item.total)]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235] },
      margin: { left: 14, right: 14 },
    })

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 8,
      head: [['Code', 'Name', 'Type', 'Currency', 'Bank', 'Account No', 'Current']],
      body: activeAccounts.map((row) => [
        row.account_code,
        row.account_name,
        row.account_type,
        row.currency,
        row.bank_name || '-',
        row.account_no || '-',
        fmtMoney(row.current_balance),
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [55, 65, 81] },
      margin: { left: 14, right: 14 },
    })

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 8,
      head: [['Date', 'Account', 'In/Out', 'Category', 'Purpose', 'Description', 'Counterparty', 'Amount', 'Currency']],
      body: visibleRows.map((row) => [
        row.tx_date,
        `${row.account_code} ${row.account_name}`,
        row.in_out,
        row.category,
        purposeLabel(row.purpose_code) || '-',
        row.description,
        row.counterparty_name || '-',
        fmtMoney(row.amount),
        row.currency,
      ]),
      styles: { fontSize: 6.5, cellPadding: 1.8 },
      headStyles: { fillColor: [55, 65, 81] },
      margin: { left: 14, right: 14 },
    })

    doc.save(`cashbook_${reportDate()}.pdf`)
  }

  async function exportSelectedBankDetailPdf() {
    if (!editingAccountId) {
      setAccountMessage('Select an account with Edit first')
      return
    }

    const [{ default: jsPDF }, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const autoTable = (autoTableModule as any).default || (autoTableModule as any).autoTable
    const doc = new jsPDF()

    doc.setFontSize(14)
    doc.text('Bank Detail', 14, 16)
    doc.setFontSize(9)
    doc.text(`Date: ${reportDate()}`, 14, 23)

    autoTable(doc, {
      startY: 30,
      body: [
        ['Bank Name', accountForm.bank_name || '-'],
        ['Account No', accountForm.account_no || '-'],
        ['Account Holder Name', accountForm.account_holder_name || '-'],
        ['Currency', accountForm.currency],
        ['SWIFT Code', accountForm.swift_code || '-'],
        ['Bank Address', accountForm.bank_address || '-'],
        ['Beneficiary Address', accountForm.beneficiary_address || '-'],
        ['Note', accountForm.bank_detail_note || '-'],
      ],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 55 },
        1: { cellWidth: 120 },
      },
      margin: { left: 14, right: 14 },
    })

    doc.save(`bank_detail_${accountForm.account_code || 'account'}_${reportDate()}.pdf`)
  }

  async function saveLedgerEntry(inOut: InOut, category: 'RECEIPT' | 'EXPENSE' | 'MANUAL') {
    const res = await fetch('/api/finance/cash-ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: account,
        tx_date: txDate,
        in_out: inOut,
        category,
        description,
        counterparty_name: counterpartyName,
        amount: Number(amount || 0),
        purpose_code: selectedPurpose?.code || null,
        purpose_group: selectedPurpose?.group || null,
        memo,
      }),
    })
    const json = await res.json()
    if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save entry')
  }

  async function saveTransferEntry() {
    const from = Number(amount || 0)
    const rate = Number(fxRate || 0)
    const calculatedToAmount = mode === 'FX' && from > 0 && rate > 0 ? from * rate : Number(toAmount || amount || 0)

    const res = await fetch('/api/finance/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transfer_date: txDate,
        from_account_id: fromAccount,
        to_account_id: toAccount,
        from_amount: from,
        to_amount: calculatedToAmount,
        description,
        memo,
      }),
    })
    const json = await res.json()
    if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save transfer')
  }

  async function onSave() {
    setMessage('')

    if (!description.trim()) {
      setMessage('Description is required')
      return
    }
    if (!(Number(amount) > 0)) {
      setMessage('Amount must be greater than 0')
      return
    }

    if (mode === 'DEPOSIT' || mode === 'WITHDRAW' || mode === 'ADJUST') {
      if (!account) {
        setMessage('Account is required')
        return
      }
      if (!purposeCode) {
        setMessage('Purpose is required')
        return
      }
    } else {
      if (!fromAccount || !toAccount) {
        setMessage('From / To account is required')
        return
      }
      if (fromAccount === toAccount) {
        setMessage('From and To account must be different')
        return
      }
      const fxToAmount = mode === 'FX' && Number(amount) > 0 && Number(fxRate) > 0 ? Number(amount) * Number(fxRate) : Number(toAmount || amount)
      if (!(fxToAmount > 0)) {
        setMessage('To amount must be greater than 0')
        return
      }
      if (mode === 'TRANSFER' && selectedFrom && selectedTo && selectedFrom.currency !== selectedTo.currency) {
        setMessage('Transfer requires same currency accounts. Use FX for different currencies.')
        return
      }
      if (mode === 'FX' && selectedFrom && selectedTo && selectedFrom.currency === selectedTo.currency) {
        setMessage('FX requires different currencies. Use Transfer for same currency accounts.')
        return
      }
    }

    setSaving(true)
    try {
      if (mode === 'DEPOSIT') await saveLedgerEntry('IN', 'RECEIPT')
      if (mode === 'WITHDRAW') await saveLedgerEntry('OUT', 'EXPENSE')
      if (mode === 'ADJUST') await saveLedgerEntry(adjustDirection, 'MANUAL')
      if (mode === 'TRANSFER' || mode === 'FX') await saveTransferEntry()

      resetForm()
      setMessage('Saved')
      await refreshAll()
    } catch (e: any) {
      setMessage(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const isSingleAccountMode = mode === 'DEPOSIT' || mode === 'WITHDRAW' || mode === 'ADJUST'
  const actionLabel = {
    DEPOSIT: 'Deposit',
    WITHDRAW: 'Withdraw',
    TRANSFER: 'Transfer',
    FX: 'FX',
    ADJUST: 'Adjustment',
  }[mode]

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cashbook</h1>
          <p className="mt-1 text-xs text-gray-500">One screen for deposits, withdrawals, transfers, FX, and adjustments.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500" value={excelLang} onChange={(e) => setExcelLang(e.target.value as OutputLang)}>
            <option value="en">Excel English</option>
            <option value="zh">Excel 中文简体</option>
          </select>
          <button onClick={exportCashbookExcel} className={compactBtn}>
            Excel
          </button>
          <button onClick={exportCashbookPdf} className={compactBtn}>
            PDF
          </button>
          <button onClick={refreshAll} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {totalsByCurrency.map((item) => (
          <div key={item.currency} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-xs text-gray-500">{item.currency} Balance</div>
            <div className="mt-1 text-xl font-bold">{fmtMoney(item.total)}</div>
          </div>
        ))}
      </div>

      <div className="order-4 space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Account Setup</h2>
            <p className="mt-0.5 text-xs text-gray-500">Occasional setup for account names, account numbers, and buyer-facing bank details.</p>
          </div>
          <div className="flex gap-2">
            {showAccountSetup ? (
              <button onClick={resetAccountForm} className={compactBtn}>
                New Account
              </button>
            ) : null}
            <button onClick={() => setShowAccountSetup((value) => !value)} className={compactBtn}>
              {showAccountSetup ? 'Hide Account Setup' : 'Show Account Setup'}
            </button>
          </div>
        </div>

        {showAccountSetup ? (
          <>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium">Code</label>
            <input className={inputCls} value={accountForm.account_code} onChange={(e) => setAccountForm({ ...accountForm, account_code: e.target.value })} placeholder="KRW-BANK" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium">Account Name</label>
            <input className={inputCls} value={accountForm.account_name} onChange={(e) => setAccountForm({ ...accountForm, account_name: e.target.value })} placeholder="Main KRW Bank" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Type</label>
            <select className={inputCls} value={accountForm.account_type} onChange={(e) => setAccountForm({ ...accountForm, account_type: e.target.value as 'CASH' | 'BANK' })}>
              <option value="BANK">BANK</option>
              <option value="CASH">CASH</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Currency</label>
            <select className={inputCls} value={accountForm.currency} onChange={(e) => setAccountForm({ ...accountForm, currency: e.target.value as Currency })}>
              <option value="USD">USD</option>
              <option value="KRW">KRW</option>
              <option value="CNY">CNY</option>
              <option value="VND">VND</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Active</label>
            <select className={inputCls} value={accountForm.is_active ? 'Y' : 'N'} onChange={(e) => setAccountForm({ ...accountForm, is_active: e.target.value === 'Y' })}>
              <option value="Y">Active</option>
              <option value="N">Inactive</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium">Bank Name</label>
            <input className={inputCls} value={accountForm.bank_name} onChange={(e) => setAccountForm({ ...accountForm, bank_name: e.target.value })} placeholder="Bank" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Account No</label>
            <input className={inputCls} value={accountForm.account_no} onChange={(e) => setAccountForm({ ...accountForm, account_no: e.target.value })} placeholder="Optional" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Opening</label>
            <input className={inputCls} value={accountForm.opening_balance} onChange={(e) => setAccountForm({ ...accountForm, opening_balance: e.target.value })} placeholder="0" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium">Opening Date</label>
            <input type="date" className={inputCls} value={accountForm.opening_balance_date} onChange={(e) => setAccountForm({ ...accountForm, opening_balance_date: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1 block text-xs font-medium">Remarks</label>
            <input className={inputCls} value={accountForm.remarks} onChange={(e) => setAccountForm({ ...accountForm, remarks: e.target.value })} placeholder="Optional" />
          </div>
          <div className="flex items-end">
          <button type="button" onClick={() => setShowBankDetail((value) => !value)} className={compactBtn}>
              {showBankDetail ? 'Hide Bank Detail' : 'Bank Detail'}
            </button>
          </div>
        </div>

        {showBankDetail ? (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Buyer Remittance Detail</div>
                <div className="text-xs text-gray-500">Fill this only when the detail is needed for buyers or payment instructions.</div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium">Holder Name</label>
                <input className={inputCls} value={accountForm.account_holder_name} onChange={(e) => setAccountForm({ ...accountForm, account_holder_name: e.target.value })} placeholder="Beneficiary" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">SWIFT Code</label>
                <input className={inputCls} value={accountForm.swift_code} onChange={(e) => setAccountForm({ ...accountForm, swift_code: e.target.value })} placeholder="SWIFT/BIC" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Bank Address</label>
                <input className={inputCls} value={accountForm.bank_address} onChange={(e) => setAccountForm({ ...accountForm, bank_address: e.target.value })} placeholder="Bank address for remittance" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Beneficiary Address</label>
                <input className={inputCls} value={accountForm.beneficiary_address} onChange={(e) => setAccountForm({ ...accountForm, beneficiary_address: e.target.value })} placeholder="Beneficiary address" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Bank Detail Note</label>
                <input className={inputCls} value={accountForm.bank_detail_note} onChange={(e) => setAccountForm({ ...accountForm, bank_detail_note: e.target.value })} placeholder="Extra remittance instructions" />
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-7">
          <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 md:col-span-4">
            {editingAccountId ? 'Editing selected account. Changes affect future account labels and selections.' : 'Create a new cash or bank account, then use it immediately in Quick Entry.'}
          </div>
          <button onClick={resetAccountForm} className={compactBtn}>
            Reset
          </button>
          <button onClick={exportSelectedBankDetailPdf} className={compactBtn}>
            Bank PDF
          </button>
          <button onClick={saveAccount} disabled={savingAccount} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
            {savingAccount ? 'Saving...' : editingAccountId ? 'Update Account' : 'Save Account'}
          </button>
        </div>

        {accountMessage ? <div className="text-xs text-red-600">{accountMessage}</div> : null}

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr className="border-b text-left">
                <th className="px-2.5 py-2">Code</th>
                <th className="px-2.5 py-2">Name</th>
                <th className="px-2.5 py-2">Type</th>
                <th className="px-2.5 py-2">Currency</th>
                <th className="px-2.5 py-2">Bank / Account No</th>
                <th className="px-2.5 py-2 text-right">Current</th>
                <th className="px-2.5 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {activeAccounts.length === 0 ? (
                <tr><td className="px-2.5 py-4 text-center text-gray-500" colSpan={7}>No active accounts</td></tr>
              ) : activeAccounts.map((row) => {
                const id = accountId(row)
                return (
                  <tr key={id} className="border-b">
                    <td className="px-2.5 py-2 font-semibold">{row.account_code}</td>
                    <td className="px-2.5 py-2">{row.account_name}</td>
                    <td className="px-2.5 py-2">{row.account_type}</td>
                    <td className="px-2.5 py-2">{row.currency}</td>
                    <td className="px-2.5 py-2">
                      <div>{row.bank_name || '-'}</div>
                      <div className="text-[11px] text-gray-500">{row.account_no || '-'}</div>
                    </td>
                    <td className="px-2.5 py-2 text-right">{fmtMoney(row.current_balance)}</td>
                    <td className="px-2.5 py-2 text-center">
                      <div className="inline-flex gap-2">
                        <button className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50" onClick={() => editAccount(row)}>
                          Edit
                        </button>
                        <button className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => deleteAccount(id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
          </>
        ) : null}
      </div>

      <div className="order-2 space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Quick Entry</h2>
          <div className="grid grid-cols-5 gap-1 rounded-md bg-gray-100 p-1 text-xs">
            {(['WITHDRAW', 'DEPOSIT', 'TRANSFER', 'FX', 'ADJUST'] as EntryMode[]).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={`rounded px-2 py-1 ${mode === item ? 'bg-white font-semibold text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-white/70'}`}
              >
                {item === 'DEPOSIT' ? 'Deposit' : item === 'WITHDRAW' ? 'Withdraw' : item === 'ADJUST' ? 'Adjust' : item}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Date</label>
            <input type="date" className={inputCls} value={txDate} onChange={(e) => setTxDate(e.target.value)} />
          </div>

          {isSingleAccountMode ? (
            <>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Account</label>
                <select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="">Select Account</option>
                  {activeAccounts.map((item) => (
                    <option key={accountId(item)} value={accountId(item)}>
                      {item.account_code} / {item.account_name} / {item.currency}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Type</label>
                {mode === 'ADJUST' ? (
                  <select className={inputCls} value={adjustDirection} onChange={(e) => setAdjustDirection(e.target.value as InOut)}>
                    <option value="IN">Increase</option>
                    <option value="OUT">Decrease</option>
                  </select>
                ) : (
                  <div className={`${inputCls} bg-gray-50`}>{actionLabel}</div>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">From Account</label>
                <select className={inputCls} value={fromAccount} onChange={(e) => setFromAccount(e.target.value)}>
                  <option value="">Select From</option>
                  {activeAccounts.map((item) => (
                    <option key={accountId(item)} value={accountId(item)}>
                      {item.account_code} / {item.currency}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">To Account</label>
                <select className={inputCls} value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
                  <option value="">Select To</option>
                  {activeAccounts.map((item) => (
                    <option key={accountId(item)} value={accountId(item)}>
                      {item.account_code} / {item.currency}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Type</label>
                <div className={`${inputCls} bg-gray-50`}>{actionLabel}</div>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium">{mode === 'FX' ? 'From Amount' : 'Amount'}</label>
            <input
              className={inputCls}
              value={amount}
              onChange={(e) => {
                const nextAmount = e.target.value
                setAmount(nextAmount)
                if (mode === 'FX' && Number(nextAmount) > 0 && Number(fxRate) > 0) {
                  setToAmount(String(Number(nextAmount) * Number(fxRate)))
                }
              }}
              placeholder="0"
            />
          </div>
          {isSingleAccountMode ? (
            <div>
              <label className="mb-1 block text-xs font-medium">Purpose</label>
              <select className={inputCls} value={purposeCode} onChange={(e) => setPurposeCode(e.target.value)}>
                <option value="">Select Purpose</option>
                {purposeOptions.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label} / {item.group}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium">{mode === 'FX' ? 'To Amount' : 'To Amount'}</label>
              <input
                className={inputCls}
                value={toAmount}
                onChange={(e) => setToAmount(e.target.value)}
                placeholder={mode === 'FX' ? '0' : 'same as amount'}
                disabled={mode !== 'FX'}
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium">From Currency</label>
            <div className={`${inputCls} bg-gray-50`}>{isSingleAccountMode ? selectedAccount?.currency || '-' : selectedFrom?.currency || '-'}</div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">{mode === 'FX' ? 'FX Rate' : 'To Currency'}</label>
            {mode === 'FX' ? (
              <input
                className={inputCls}
                value={fxRate}
                onChange={(e) => {
                  const nextRate = e.target.value
                  setFxRate(nextRate)
                  if (Number(amount) > 0 && Number(nextRate) > 0) {
                    setToAmount(String(Number(amount) * Number(nextRate)))
                  }
                }}
                placeholder="0.000000"
              />
            ) : (
              <div className={`${inputCls} bg-gray-50`}>{isSingleAccountMode ? selectedAccount?.currency || '-' : selectedTo?.currency || '-'}</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium">Description</label>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Business reason or transaction name" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Counterparty</label>
            <input className={inputCls} value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} placeholder="Optional" disabled={!isSingleAccountMode} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Memo</label>
            <input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-4">
          <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 md:col-span-2">
            {mode === 'DEPOSIT' && 'Use for money received into one cash or bank account.'}
            {mode === 'WITHDRAW' && 'Use for expenses or cash leaving one cash or bank account.'}
            {mode === 'TRANSFER' && 'Use for movement between accounts with the same currency.'}
            {mode === 'FX' && 'Use for currency exchange between different currency accounts.'}
            {mode === 'ADJUST' && 'Use for opening corrections or manual balance adjustments.'}
          </div>
          <button onClick={resetForm} className={compactBtn}>
            Reset
          </button>
          <button onClick={onSave} disabled={saving} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {message ? <div className="text-xs text-red-600">{message}</div> : null}
      </div>

      <div className="order-3 space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">Recent Cashbook Lines</h2>
          <div className="grid w-full max-w-4xl grid-cols-1 gap-2 md:grid-cols-4">
            <select className={inputCls} value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
              <option value="">All Accounts</option>
              {activeAccounts.map((item) => (
                <option key={accountId(item)} value={accountId(item)}>
                  {item.account_code}
                </option>
              ))}
            </select>
            <select className={inputCls} value={filterCurrency} onChange={(e) => setFilterCurrency(e.target.value)}>
              <option value="">All Currencies</option>
              <option value="USD">USD</option>
              <option value="KRW">KRW</option>
              <option value="CNY">CNY</option>
              <option value="VND">VND</option>
            </select>
            <select className={inputCls} value={filterPurpose} onChange={(e) => setFilterPurpose(e.target.value)}>
              <option value="">All Purposes</option>
              {purposeOptions.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            <input className={inputCls} value={filterQ} onChange={(e) => setFilterQ(e.target.value)} placeholder="Search" />
          </div>
        </div>
        <div className="flex gap-2">
          <button className={compactBtn} onClick={() => { setFilterAccount(''); setFilterCurrency(''); setFilterPurpose(''); setFilterQ('') }}>
            Reset
          </button>
          <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700" onClick={loadLedger}>
            Apply
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr className="border-b text-left">
                <th className="px-2.5 py-2">Date</th>
                <th className="px-2.5 py-2">Account</th>
                <th className="px-2.5 py-2">In/Out</th>
                <th className="px-2.5 py-2">Category</th>
                <th className="px-2.5 py-2">Purpose</th>
                <th className="px-2.5 py-2">Description</th>
                <th className="px-2.5 py-2">Counterparty</th>
                <th className="px-2.5 py-2 text-right">Amount</th>
                <th className="px-2.5 py-2">Currency</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-2.5 py-4 text-center text-gray-500" colSpan={9}>Loading...</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td className="px-2.5 py-4 text-center text-gray-500" colSpan={9}>No data</td></tr>
              ) : visibleRows.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-2.5 py-2">{row.tx_date}</td>
                  <td className="px-2.5 py-2">{row.account_code}<div className="text-[11px] text-gray-500">{row.account_name}</div></td>
                  <td className={`px-2.5 py-2 font-semibold ${row.in_out === 'IN' ? 'text-blue-600' : 'text-red-600'}`}>{row.in_out}</td>
                  <td className="px-2.5 py-2">{row.category}</td>
                  <td className="px-2.5 py-2">
                    {purposeLabel(row.purpose_code) || '-'}
                    {row.purpose_group ? <div className="text-[11px] text-gray-500">{row.purpose_group}</div> : null}
                  </td>
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
