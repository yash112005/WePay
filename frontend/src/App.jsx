import { useEffect, useMemo, useRef, useState } from 'react'
import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from '@paypal/react-paypal-js'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, ArrowDownLeft, ArrowUpRight, Bell, Check, ChevronDown, CircleHelp, Globe2, Mic, Plus, Radio, Send, Settings2, ShieldCheck, Sparkles, Webhook, WalletCards, X } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || 'sb'
const fallbackCurrencyCodes = ['AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWL']
const zeroDecimalCurrencies = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF', 'HUF', 'TWD'])
const threeDecimalCurrencies = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])
const fourDecimalCurrencies = new Set(['CLF', 'UYW'])
const browserCurrencyCodes = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : fallbackCurrencyCodes
const currencyDisplayNames = new Intl.DisplayNames(['en'], { type: 'currency' })
const initialCurrencyOptions = [...new Set([...browserCurrencyCodes, ...fallbackCurrencyCodes])].sort().map(code => ({ code, name: currencyDisplayNames.of(code) || code, symbol: '' }))

const seedLedger = [
  { id: 'seed-1', description: 'Weekend groceries', payer: 'Dadi', amount: 3000, currency: 'INR', sharedWith: ['Amit', 'Rahul'], status: 'Pending', date: 'Today', initials: 'DA', color: 'mint' },
  { id: 'seed-2', description: 'Dinner at Olive', payer: 'You', amount: 86.4, currency: 'USD', sharedWith: ['Mom', 'John'], status: 'Settled', date: 'Yesterday', initials: 'YO', color: 'violet' },
  { id: 'seed-3', description: 'Electricity bill', payer: 'Amit', amount: 1840, currency: 'INR', sharedWith: ['You', 'Dadi', 'Rahul'], status: 'Pending', date: 'Oct 4', initials: 'AM', color: 'amber' },
  { id: 'seed-4', description: 'Cab to the airport', payer: 'Mom', amount: 32.5, currency: 'USD', sharedWith: ['You', 'John'], status: 'Settled', date: 'Oct 2', initials: 'MO', color: 'rose' },
]

const seedNotifications = [
  { id: 'fx-1', category: 'Forex rate', message: 'Forex Engine locked a 4.2% optimal transaction rate for INR/USD swap.', time: 'Just now', unread: true, tone: 'mint' },
  { id: 'payment-1', category: 'Settlement', message: 'Amit successfully authorized a $33.33 transfer via PayPal sandbox gateways.', time: '3 min ago', unread: true, tone: 'violet' },
  { id: 'voice-1', category: 'Voice parsing', message: 'AI parsed new ambient speech transaction request from Dadi.', time: '8 min ago', unread: true, tone: 'blue' },
]

const defaultWorkspaceSettings = {
  biometricVoiceMatch: true,
  hedgingFrequency: 'high',
  defaultCurrency: 'USD',
  channels: { inApp: true, audio: false, webhook: false },
  webhookTarget: '',
}

const money = (amount, currency) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currencyDigits(currency) }).format(Number(amount)) }
  catch { return `${currency} ${Number(amount).toFixed(2)}` }
}

function splitMinorUnits(amount, participantCount, currency) {
  const digits = currencyDigits(currency)
  const factor = 10 ** digits
  const totalCents = Math.round(Number(amount) * factor)
  const base = Math.floor(totalCents / participantCount)
  const remainder = totalCents % participantCount
  return Array.from({ length: participantCount }, (_, index) => base + (index < remainder ? 1 : 0))
}

function currencyDigits(currency) {
  if (zeroDecimalCurrencies.has(currency)) return 0
  if (threeDecimalCurrencies.has(currency)) return 3
  if (fourDecimalCurrencies.has(currency)) return 4
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
}

function recordSettlement(rows, expense, captureId) {
  if (expense.collectionTarget) {
    return rows.map(row => {
      if (row.id !== expense.collectionTarget.ledgerId) return row
      const settledMembers = [...new Set([...(row.settledMembers || []), expense.collectionTarget.member])]
      return { ...row, settledMembers, status: row.sharedWith.every(member => settledMembers.includes(member)) ? 'Settled' : 'Pending' }
    })
  }
  return [{ id: captureId || crypto.randomUUID(), description: expense.description, payer: expense.payer, amount: Number(expense.amount), currency: expense.currency, sharedWith: expense.shared_with, status: 'Settled', date: 'Just now', initials: expense.payer.slice(0, 2).toUpperCase(), color: 'mint' }, ...rows]
}

function settleOrderRow(rows, expense, orderId) {
  if (orderId && rows.some(row => row.id === orderId)) {
    return rows.map(row => row.id === orderId ? { ...row, status: 'Settled' } : row)
  }
  return recordSettlement(rows, expense, orderId || crypto.randomUUID())
}

function CurrencyPicker({ id, value, onChange, options }) {
  return <select id={id} value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
    {options.map(currency => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}{currency.symbol ? ` (${currency.symbol})` : ''}</option>)}
  </select>
}

function AppContent() {
  const [{}, dispatchPayPal] = usePayPalScriptReducer()
  const [currentScreen, setCurrentScreen] = useState(() => new URLSearchParams(window.location.search).has('paypal') ? 'dashboard' : 'home')
  const [activeTab, setActiveTab] = useState('assistant')
  const [elderMode, setElderMode] = useState(false)
  const [ledger, setLedger] = useState(seedLedger)
  const [reminderDrafts, setReminderDrafts] = useState({})
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [audioChunks, setAudioChunks] = useState([])
  const [processingStage, setProcessingStage] = useState('')
  const [error, setError] = useState('')
  const [activeExpense, setActiveExpense] = useState(null)
  const [voiceMatchConfirmed, setVoiceMatchConfirmed] = useState(false)
  const [highRiskAcknowledged, setHighRiskAcknowledged] = useState(false)
  const [hedgingOverride, setHedgingOverride] = useState(false)
  const [activeOrder, setActiveOrder] = useState(null)
  const [splitLinkBusy, setSplitLinkBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [notice, setNotice] = useState('')
  const [fx, setFx] = useState(null)
  const [fxError, setFxError] = useState(false)
  const [currencyOptions, setCurrencyOptions] = useState(initialCurrencyOptions)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [notifications, setNotifications] = useState(seedNotifications)
  const [settings, setSettings] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('wepay.workspace.settings') || 'null')
      return stored ? { ...defaultWorkspaceSettings, ...stored, channels: { ...defaultWorkspaceSettings.channels, ...stored.channels } } : defaultWorkspaceSettings
    } catch { return defaultWorkspaceSettings }
  })
  const [paypalClientId, setPaypalClientId] = useState(PAYPAL_CLIENT_ID)
  const [paypalCheckoutCurrency, setPaypalCheckoutCurrency] = useState('USD')
  const [paypalConfigured, setPaypalConfigured] = useState(false)
  const [apiStatus, setApiStatus] = useState('checking')
  const [voiceAiConfigured, setVoiceAiConfigured] = useState(false)
  const [socketStatus, setSocketStatus] = useState('connecting')
  const [copilotMessages, setCopilotMessages] = useState([{ id: 'welcome', role: 'assistant', text: 'Hi! Describe a shared expense in any language. I’ll check the split and keep everyone’s ledger in sync.' }])
  const audioChunksRef = useRef([])
  const mediaStreamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const ledgerSocketRef = useRef(null)
  const parseResolversRef = useRef(new Map())
  const copilotEndRef = useRef(null)

  useEffect(() => {
    let stopped = false
    let reconnectTimer
    let socket
    const socketUrl = `${API_URL.replace(/^http/, 'ws')}/ws/ledger`
    const connect = () => {
      if (stopped) return
      setSocketStatus('connecting')
      socket = new WebSocket(socketUrl)
      ledgerSocketRef.current = socket
      let keepAliveTimer
      socket.onopen = () => {
        setSocketStatus('connected')
        keepAliveTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping', requestId: 'keepalive' }))
        }, 25000)
      }
      socket.onmessage = event => {
        let payload
        try { payload = JSON.parse(event.data) } catch { return }
        if (payload.type === 'ledger.snapshot' && Array.isArray(payload.ledger)) {
          setLedger(current => {
            const byId = new Map(current.map(row => [row.id, row]))
            payload.ledger.forEach(row => byId.set(row.id, { ...row, sharedWith: row.sharedWith || [] }))
            return [...byId.values()]
          })
        }
        if (payload.type === 'forex.rates' && payload.rates) {
          setFx(payload.rates)
          setFxError(false)
        }
        if (payload.type === 'forex.error') setFxError(true)
        if (['expense.parsed', 'expense.error', 'voice.processed', 'voice.error'].includes(payload.type)) {
          const resolver = parseResolversRef.current.get(payload.requestId)
          if (resolver) {
            parseResolversRef.current.delete(payload.requestId)
            window.clearTimeout(resolver.timeout)
            if (payload.type === 'expense.parsed') resolver.resolve(payload.expense)
            else if (payload.type === 'voice.processed') resolver.resolve(payload.result)
            else resolver.reject(new Error(payload.message || 'Could not parse that expense.'))
          }
        }
        if (payload.type === 'ledger.expense' && payload.expense) {
          const row = { ...payload.expense, sharedWith: payload.expense.sharedWith || [] }
          setLedger(current => [row, ...current.filter(item => item.id !== row.id)])
          setCopilotMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text: `${row.payer}’s ${row.description} split is now live for the household. I’ve prepared reminders for ${row.sharedWith.join(', ') || 'the family'}.` }])
        }
        if (payload.type === 'ledger.settled') {
          setLedger(current => current.map(row => row.id === payload.orderId ? { ...row, status: 'Settled' } : row))
        }
        if (payload.type === 'collection.pinger') {
          setCopilotMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text: payload.message }])
          if (payload.message) pushSocketNotice(payload.message)
        }
      }
      socket.onerror = () => setSocketStatus('offline')
      socket.onclose = () => {
        window.clearInterval(keepAliveTimer)
        if (ledgerSocketRef.current === socket) ledgerSocketRef.current = null
        setSocketStatus('offline')
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1500)
      }
    }
    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Dashboard closed')
      ledgerSocketRef.current = null
      for (const resolver of parseResolversRef.current.values()) {
        window.clearTimeout(resolver.timeout)
        resolver.reject(new Error('Live connection closed. Reconnect and retry.'))
      }
      parseResolversRef.current.clear()
    }
  }, [])

  function pushSocketNotice(message) {
    setNotifications(current => [{ id: crypto.randomUUID(), category: 'Live ledger update', message, time: 'Just now', unread: true, tone: 'blue' }, ...current])
  }

  function sendSocketRequest(type, data, timeoutMs = 20000) {
    const socket = ledgerSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Live ledger is reconnecting. Wait for the connection badge to turn green, then retry.'))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        parseResolversRef.current.delete(requestId)
        reject(new Error(type === 'voice.process' ? 'Audio processing timed out. Try a shorter recording or enter the expense as text.' : 'Expense parsing took too long. Please retry.'))
      }, timeoutMs)
      parseResolversRef.current.set(requestId, { resolve, reject, timeout })
      socket.send(JSON.stringify({ type, requestId, ...data }))
    })
  }

  function parseExpenseOverSocket(text, currency) {
    return sendSocketRequest('expense.parse', { text, currency })
  }

  useEffect(() => { copilotEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [copilotMessages])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const paypalResult = query.get('paypal')
    if (!paypalResult) return
    setCurrentScreen('dashboard')
    const pendingRaw = window.sessionStorage.getItem('wepay.pending.paypal.expense')
    const cleanUrl = () => window.history.replaceState({}, document.title, window.location.pathname)
    if (paypalResult === 'cancel') {
      window.sessionStorage.removeItem('wepay.pending.paypal.expense')
      cleanUrl()
      setNotice('Checkout cancelled. Your expense is still available in the ledger.')
      return
    }
    if (paypalResult !== 'return') {
      cleanUrl()
      return
    }
    const orderId = query.get('token')
    let pendingExpense
    try { pendingExpense = pendingRaw ? JSON.parse(pendingRaw) : null } catch { pendingExpense = null }
    if (!orderId || !pendingExpense || typeof pendingExpense.payer !== 'string' || !Array.isArray(pendingExpense.shared_with)) {
      cleanUrl()
      setError('PayPal returned to WePay, but the pending expense could not be restored. Please review the ledger and retry checkout.')
      return
    }
    let current = true
    setBusy(true)
    setProcessingStage('Confirming your PayPal payment…')
    fetch(`${API_URL}/api/paypal/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: orderId }) })
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'PayPal could not confirm the payment.')
        if (result.status !== 'COMPLETED') throw new Error('PayPal has not completed this payment yet.')
        if (!current) return
        setLedger(items => settleOrderRow(items, pendingExpense, orderId))
        setSuccess(true)
        setNotice('PayPal payment completed · family ledger updated')
        setNotifications(items => [{ id: `settled-${orderId}`, category: 'Settlement', message: `${pendingExpense.payer} settled ${money(pendingExpense.amount, pendingExpense.currency)} for ${pendingExpense.description}.`, time: 'Just now', unread: true, tone: 'mint' }, ...items])
        setCopilotMessages(items => [...items, { id: crypto.randomUUID(), role: 'assistant', text: `${pendingExpense.description} is settled. The shared ledger is now updated across connected devices.` }])
        window.sessionStorage.removeItem('wepay.pending.paypal.expense')
        window.setTimeout(() => setSuccess(false), 4200)
      })
      .catch(caught => { if (current) setError(caught.message || 'PayPal payment confirmation failed. Retry from the dashboard.') })
      .finally(() => { if (current) { setBusy(false); setProcessingStage(''); cleanUrl() } })
    return () => { current = false }
  }, [])

  useEffect(() => {
    let current = true
    fetch(`${API_URL}/api/paypal/config-status`)
      .then(response => { if (!response.ok) throw new Error('Could not read PayPal setup status'); return response.json() })
      .then(data => {
        if (!current) return
        setPaypalConfigured(Boolean(data.configured))
        if (data.client_id) setPaypalClientId(data.client_id)
        if (data.checkout_currency) setPaypalCheckoutCurrency(data.checkout_currency)
      })
      .catch(() => { if (current) setPaypalConfigured(false) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    let current = true
    fetch(`${API_URL}/api/health`)
      .then(response => {
        if (!response.ok) throw new Error('WePay backend is unavailable')
        return response.json()
      })
      .then(data => { if (current) { setApiStatus('ready'); setVoiceAiConfigured(Boolean(data.live_voice_configured)) } })
      .catch(() => { if (current) setApiStatus('unavailable') })
    return () => { current = false }
  }, [])

  const unreadCount = notifications.filter(item => item.unread).length

  useEffect(() => {
    window.localStorage.setItem('wepay.workspace.settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    mediaStreamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  useEffect(() => {
    if (activeExpense?.currency) {
      const scriptCurrency = activeOrder?.currency || paypalCheckoutCurrency
      dispatchPayPal({ type: 'resetOptions', value: { 'client-id': paypalClientId, currency: scriptCurrency, intent: 'capture', components: 'buttons', 'disable-funding': 'credit,card' } })
    }
  }, [activeExpense?.currency, activeOrder?.currency, dispatchPayPal, paypalClientId, paypalCheckoutCurrency])

  useEffect(() => {
    let current = true
    fetch(`${API_URL}/api/currencies`)
      .then(response => { if (!response.ok) throw new Error('Currency catalogue unavailable'); return response.json() })
      .then(data => { if (current && Array.isArray(data) && data.length) setCurrencyOptions(data) })
      .catch(() => {})
    return () => { current = false }
  }, [])

  useEffect(() => {
    let current = true
    fetch(`${API_URL}/api/exchange-rates?base=USD`)
      .then(response => {
        if (!response.ok) throw new Error('Reference rates are unavailable')
        return response.json()
      })
      .then(data => {
        if (current) {
          setFx(data)
          setFxError(false)
        }
      })
      .catch(() => { if (current) setFxError(true) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    const socket = ledgerSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'forex.refresh', requestId: crypto.randomUUID(), base: 'USD', frequency: settings.hedgingFrequency }))
  }, [socketStatus, settings.hedgingFrequency])

  useEffect(() => {
    if (!showNotifications && !showAllActivity && !showSettings) return undefined
    const closeOnEscape = event => { if (event.key === 'Escape') { setShowNotifications(false); setShowAllActivity(false); setShowSettings(false) } }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showNotifications, showAllActivity, showSettings])

  function playNotificationPing() {
    if (!settings.channels.audio) return
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(740, context.currentTime)
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(); oscillator.stop(context.currentTime + 0.17)
      oscillator.onended = () => context.close()
    } catch { /* Audio is an optional notification channel and may be blocked by the browser. */ }
  }

  function pushNotification(category, message, tone = 'mint') {
    if (!settings.channels.inApp) return
    setNotifications(current => [{ id: crypto.randomUUID(), category, message, tone, time: 'Just now', unread: true }, ...current])
    playNotificationPing()
  }

  function shareAmountFor(item, member) {
    const people = [item.payer, ...item.sharedWith]
    const index = people.findIndex(person => person.toLocaleLowerCase() === member.toLocaleLowerCase())
    if (index < 0) return 0
    const digits = currencyDigits(item.currency)
    return splitMinorUnits(item.amount, people.length, item.currency)[index] / (10 ** digits)
  }

  async function prepareCollectionReminder(item, member) {
    const shareAmount = shareAmountFor(item, member)
    if (!shareAmount) return
    const key = `${item.id}:${member}`
    const reminder = `AI Pinger: @${member}, your share for ${item.description} paid by ${item.payer} is ${money(shareAmount, item.currency)}. Open WePay to review and settle securely.`
    try {
      await navigator.clipboard.writeText(reminder)
      setReminderDrafts(current => ({ ...current, [key]: reminder }))
      pushNotification('Collection reminder', `Reminder copied for ${member}: ${item.description} · ${money(shareAmount, item.currency)}.`, 'blue')
      setNotice(`Reminder for ${member} copied and ready to share`)
    } catch {
      setReminderDrafts(current => ({ ...current, [key]: reminder }))
      setError('Clipboard access is blocked. The reminder text is ready below; select and copy it manually.')
    }
  }

  function openCollectionCheckout(item, member) {
    const amount = shareAmountFor(item, member)
    if (!amount) return
    const amountText = amount.toFixed(currencyDigits(item.currency))
    const liabilities = [{ person: member, amount: amountText, currency: item.currency }]
    setActiveExpense({ payer: member, amount: amountText, currency: item.currency, shared_with: [], description: `${item.description} · ${member}'s share`, liabilities, collectionTarget: { ledgerId: item.id, member } })
    setActiveOrder(null)
    setVoiceMatchConfirmed(false)
    setError('')
    setActiveTab('assistant')
    setNotice(`Review ${member}'s ${money(amount, item.currency)} share in the PayPal checkout panel`)
    document.getElementById('expense-input')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const convertedTotal = items => {
    if (!fx) return null
    let total = 0
    for (const item of items) {
      const rate = item.currency === fx.base ? 1 : fx.rates[item.currency]
      if (!Number.isFinite(rate) || rate <= 0) return null
      total += Number(item.amount) / rate
    }
    return money(total, fx.base)
  }

  const totals = useMemo(() => {
    const pending = ledger.filter(item => item.status === 'Pending').length
    const settled = ledger.filter(item => item.status === 'Settled').length
    return { pending, settled }
  }, [ledger])

  async function submitExpense(event) {
    event?.preventDefault()
    if (!input.trim() || busy) return
    const prompt = input.trim()
    setCopilotMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', text: prompt }])
    setHighRiskAcknowledged(false)
    setHedgingOverride(false)
    setBusy(true); setProcessingStage('Checking typed expense'); setError(''); setSuccess(false); setActiveOrder(null)
    try {
      const payload = await parseExpenseOverSocket(prompt, settings.defaultCurrency)
      setVoiceMatchConfirmed(false)
      setActiveExpense({ ...payload, fraud_risk: payload.fraud_risk || 'LOW', hedging_hold_recommended: Boolean(payload.hedging_hold_recommended), high_risk_acknowledged: false, hedging_override_acknowledged: false })
      setHighRiskAcknowledged(false)
      setHedgingOverride(false)
      setNotice('Split checked and ready for checkout')
      setCopilotMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text: `${payload.payer} paid ${money(payload.amount, payload.currency)} for ${payload.description}. I split it across ${[payload.payer, ...payload.shared_with].join(', ')}. Review the shares before checkout.` }])
      pushNotification('Voice parsing', `AI parsed a new shared expense from ${payload.payer}: ${payload.description}.`, 'blue')
    } catch (caught) {
      setError(caught.message || 'The service could not be reached. Check that the WePay API is running.')
      setCopilotMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text: `I couldn’t verify that split: ${caught.message || 'the live connection is unavailable'}` }])
      setActiveExpense(null)
    } finally { setBusy(false); setProcessingStage('') }
  }

  async function processLiveVoice(audioBlob) {
    setBusy(true); setProcessingStage('Transcribing audio and parsing the expense'); setError(''); setSuccess(false); setActiveOrder(null)
    try {
      const currency = settings.defaultCurrency
      const audioBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('The recording could not be prepared for secure upload.'))
        reader.onload = () => {
          const dataUrl = String(reader.result || '')
          const commaIndex = dataUrl.indexOf(',')
          if (commaIndex < 0) reject(new Error('The recording encoding was invalid.'))
          else resolve(dataUrl.slice(commaIndex + 1))
        }
        reader.readAsDataURL(audioBlob)
      })
      const result = await sendSocketRequest('voice.process', { audioBase64, mimeType: audioBlob.type.split(';', 1)[0] || 'audio/webm', currency }, 120000)
      const expense = {
        payer: result.payer,
        amount: Number(result.amount),
        currency: result.currency,
        shared_with: result.shared_with,
        description: result.description,
        liabilities: result.liabilities,
        parserFallback: Boolean(result.parserFallback),
        original_amount: result.original_amount,
        original_currency: result.original_currency,
        exchange_rate: result.exchange_rate,
        exchange_rate_date: result.exchange_rate_date,
        fraud_risk: result.fraud_risk || 'LOW',
        volatility_index: result.volatility_index,
        hedging_advice: result.hedging_advice,
        hedging_hold_recommended: Boolean(result.hedging_hold_recommended),
        high_risk_acknowledged: false,
        hedging_override_acknowledged: false,
      }
      setInput(result.transcript)
      setActiveExpense(expense)
      setHighRiskAcknowledged(false)
      setHedgingOverride(false)
      setCopilotMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', text: result.transcript }, { id: crypto.randomUUID(), role: 'assistant', text: result.parserFallback ? 'I could not verify every detail in that recording. Please correct the transcript before checkout.' : `${result.payer}’s voice request is parsed. The ${money(result.amount, result.currency)} expense is split across ${[result.payer, ...result.shared_with].join(', ')}. Review each share below.` }])
      setActiveOrder(null)
      setVoiceMatchConfirmed(false)
      setNotice(result.parserFallback ? 'AI could not verify the expense · review and correct the transcript before checkout' : 'Voice parsed and split checked · review the people and amount before PayPal approval')
      pushNotification('Voice parsing', `AI parsed a new shared expense from ${result.payer}: ${result.description}.`, 'blue')
    } catch (caught) {
      setError(caught.message || 'The live voice service could not be reached. Check the API and Gemini configuration.')
      setActiveExpense(null)
      setActiveOrder(null)
    } finally {
      setBusy(false)
      setProcessingStage('')
    }
  }

  async function startListening() {
    setError('')
    if (busy) return
    if (mediaRecorder?.state === 'recording') {
      setProcessingStage('Uploading microphone recording')
      mediaRecorder.stop()
      return
    }
    if (apiStatus !== 'ready') {
      setError('The WePay backend is not connected. Start the API and retry.')
      return
    }
    if (!voiceAiConfigured) {
      setError('Live voice AI is not configured. Add GEMINI_API_KEY to backend/.env and restart the API.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Live microphone capture is not supported here. Open WePay on HTTPS or localhost, or enter the expense below.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mediaStreamRef.current = stream
      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      const mimeType = mimeCandidates.find(candidate => MediaRecorder.isTypeSupported(candidate))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 }) : new MediaRecorder(stream)
      audioChunksRef.current = []
      setAudioChunks([])
      recorder.ondataavailable = event => {
        if (event.data.size === 0) return
        audioChunksRef.current = [...audioChunksRef.current, event.data]
        setAudioChunks(audioChunksRef.current)
      }
      recorder.onerror = () => {
        setListening(false)
        setError('Microphone capture failed. Check microphone permission and try again.')
        stream.getTracks().forEach(track => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        setMediaRecorder(null)
      }
      recorder.onstop = () => {
        const audioType = recorder.mimeType || 'audio/webm'
        const audioBlob = new Blob(audioChunksRef.current, { type: audioType })
        audioChunksRef.current = []
        setAudioChunks([])
        setListening(false)
        mediaRecorderRef.current = null
        setMediaRecorder(null)
        stream.getTracks().forEach(track => track.stop())
        mediaStreamRef.current = null
        if (audioBlob.size > 0) void processLiveVoice(audioBlob)
        else setError('The microphone recording was empty. Speak for a moment and try again.')
      }
      recorder.start(250)
      mediaRecorderRef.current = recorder
      setMediaRecorder(recorder)
      setListening(true)
      setProcessingStage('Listening · tap the microphone again to finish')
    } catch (caught) {
      setListening(false)
      setProcessingStage('')
      const message = caught?.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow microphone permission in your browser and retry.'
        : 'We could not open your microphone. Connect or enable an audio input and retry.'
      setError(message)
    }
  }

  async function createOrder() {
    if (!activeExpense) throw new Error('Confirm an expense split before opening checkout.')
    if (activeExpense.parserFallback) throw new Error('Review and correct the expense text before opening checkout.')
    if (activeExpense.fraud_risk === 'HIGH' && !highRiskAcknowledged) throw new Error('Review and acknowledge the high-value security alert before checkout.')
    if (activeExpense.hedging_hold_recommended && !hedgingOverride) throw new Error('Review the FX volatility hold recommendation or explicitly proceed now.')
    if (activeOrder?.orderId) return activeOrder.orderId
    const response = await fetch(`${API_URL}/api/create-paypal-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(activeExpense) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.detail || 'PayPal could not start checkout.')
    setActiveOrder(result)
    return result.orderId
  }

  async function generateSplitLink() {
    if (splitLinkBusy) return
    setSplitLinkBusy(true)
    setError('')
    try {
      await createOrder()
      window.sessionStorage.setItem('wepay.pending.paypal.expense', JSON.stringify(activeExpense))
      setNotice('Separate PayPal payment link generated')
    } catch (caught) {
      setError(caught?.message || 'We could not generate the payment link. Check the PayPal sandbox connection and try again.')
    } finally {
      setSplitLinkBusy(false)
    }
  }

  async function copySplitLink() {
    const checkoutUrl = activeOrder?.approvalUrl
    if (!checkoutUrl) return
    try {
      await navigator.clipboard.writeText(checkoutUrl)
      setNotice('PayPal payment link copied')
    } catch {
      setError('Copy was blocked by the browser. Use Open payment link, then copy the URL from the address bar.')
    }
  }

  async function approveOrder(data, actions) {
    setError('')
    try {
      const orderId = data?.orderID || activeOrder?.orderId
      if (!orderId) throw new Error('PayPal did not return a valid order reference.')
      const response = await fetch(`${API_URL}/api/paypal/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: orderId }) })
      const capture = await response.json()
      if (!response.ok) throw new Error(capture.detail || 'PayPal could not confirm the payment.')
      if (capture?.status !== 'COMPLETED') throw new Error(`Payment is ${capture?.status || 'not completed'}.`)
      const expense = activeExpense
      setLedger(current => settleOrderRow(current, expense, orderId))
      setSuccess(true); setNotice('Payment settled · your family ledger is up to date')
      pushNotification('Settlement', `${expense.payer} settled ${money(expense.amount, expense.currency)} for ${expense.description}.`, 'mint')
      setCopilotMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text: `Payment confirmed. ${expense.description} is settled, and every connected household dashboard has been updated.` }])
      setActiveExpense(null); setActiveOrder(null); setInput('')
      window.setTimeout(() => setSuccess(false), 4200)
    } catch (caught) { setError(caught.message || 'Payment could not be completed. Your split is still here to retry.') }
  }

  return currentScreen === 'home' ? <LandingHome onLaunch={() => setCurrentScreen('dashboard')}/> : <div className={`min-h-screen bg-white text-slate-900 selection:bg-blue-100 ${elderMode ? 'elder-mode' : ''}`}>
    <div className="relative mx-auto max-w-[1440px] px-4 pb-10 sm:px-6 lg:px-10">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-3">
        <button onClick={() => setCurrentScreen('home')} className="flex items-center gap-3 text-left"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/15"><WalletCards size={21} strokeWidth={2.3}/></div><div><div className="text-[17px] font-black tracking-[-.04em]">WePay<span className="text-blue-600">.ai</span></div><div className="mt-[-2px] text-[13px] font-medium tracking-[.19em] text-slate-500">FAMILY FINANCE, SIMPLIFIED</div></div></button>
        <div className="flex flex-wrap items-center gap-2"><button onClick={() => setElderMode(value => !value)} aria-pressed={elderMode} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${elderMode ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>👵 Elder Mode {elderMode ? 'On' : 'Off'}</button><div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"/>🛡️ Forex Guard Active</div><div title={`Live ledger ${socketStatus}`} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${socketStatus === 'connected' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><span className={`h-1.5 w-1.5 rounded-full ${socketStatus === 'connected' ? 'animate-pulse bg-blue-500' : 'bg-amber-500'}`}/>{socketStatus === 'connected' ? 'Live sync' : 'Reconnecting'}</div><NotificationBell unreadCount={unreadCount} isOpen={showNotifications} onClick={() => { setShowNotifications(value => !value); setShowSettings(false) }}/><button onClick={() => { setShowSettings(true); setShowNotifications(false) }} aria-label="Open workspace settings" className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"><Settings2 size={17}/></button></div>
      </header>

      <main className="pt-9 lg:pt-12">
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-700"><Sparkles size={14}/> YOUR SHARED MONEY, IN SYNC</div><h1 className="text-3xl font-black tracking-[-.055em] text-slate-900 sm:text-[40px]">Good morning, Jordan<span className="text-emerald-500">.</span></h1><p className="mt-2 text-sm font-medium text-slate-500 sm:text-[15px]">A clearer view of the money you share with your people.</p></div><button onClick={() => { document.getElementById('expense-input')?.focus(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) }} className="inline-flex w-fit items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700"><Plus size={16}/> Add an expense</button></div>

        <section className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Metric icon={<WalletCards size={17}/>} label="Tracked expenses" value={convertedTotal(ledger) || (fxError ? 'Rates unavailable' : 'Loading rates…')} detail={fx ? `USD estimate · reference rates ${fx.date}` : 'Converted to USD when rates load'} accent="mint"/>
          <Metric icon={<ArrowDownLeft size={17}/>} label="Open shared expenses" value={convertedTotal(ledger.filter(item => item.status === 'Pending')) || (fxError ? 'Rates unavailable' : 'Loading rates…')} detail={`${totals.pending} pending entries · USD estimate`} accent="violet"/>
          <Metric icon={<ArrowUpRight size={17}/>} label="Settled expenses" value={convertedTotal(ledger.filter(item => item.status === 'Settled')) || (fxError ? 'Rates unavailable' : 'Loading rates…')} detail={`${totals.settled} completed · USD estimate`} accent="blue"/>
        </section>

        <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] transition-all duration-300 hover:shadow-[0_10px_30px_-4px_rgba(0,0,0,0.06)] sm:p-5 lg:col-span-2">
            <div className="mb-5 flex items-center justify-between"><div><div className="flex items-center gap-2"><h2 className="text-base font-semibold tracking-[-.025em]">Family ledger</h2><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[13px] text-slate-500">{ledger.length} entries</span></div><p className="mt-1 text-xs text-slate-500">Every shared moment, accounted for.</p></div><button className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-slate-50 hover:text-slate-900">This month <ChevronDown size={13} className="ml-1 inline"/></button></div>
            <BudgetAnalytics ledger={ledger} fx={fx}/>
            <div className="space-y-2.5">
              {ledger.map((item, index) => <div key={item.id} className="animate-fadeIn" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}><LedgerCard item={item}/></div>)}
            </div>
            <button type="button" onClick={() => setShowAllActivity(true)} className="mt-4 w-full rounded-xl border border-dashed border-slate-200 py-3 text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50">View all activity <span aria-hidden="true">→</span></button>
          </div>

          <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)]">
            <div className="grid grid-cols-3 gap-1 border-b border-slate-200 bg-slate-100 p-1.5">
              {[['assistant', '💬 AI Assistant'], ['alerts', '🔔 Alerts Center'], ['settings', '⚙️ Settings']].map(([key, label]) => <button key={key} onClick={() => { setActiveTab(key); if (key === 'settings') setShowSettings(true) }} className={`relative rounded-xl px-2 py-2.5 text-[13px] font-semibold transition sm:text-xs ${activeTab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{label}{key === 'alerts' && unreadCount > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500"/>}</button>)}
            </div>
            <div className="border-b border-slate-200 px-5 py-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Sparkles size={14}/></div><h2 className="text-sm font-semibold">WePay assistant</h2></div><span className="rounded-full bg-emerald-50 px-2 py-1 text-[13px] font-semibold tracking-wide text-emerald-600">READY</span></div><p className="mt-2 text-xs leading-relaxed text-slate-500">Say it naturally. I’ll figure out the split for everyone.</p></div>
            {activeTab === 'assistant' ? <div className="space-y-4 p-5">
              <div aria-live="polite" aria-label="AI Copilot conversation" className="max-h-64 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                {copilotMessages.map(message => <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}><div className={`flex max-w-[92%] items-start gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}><div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-emerald-50 text-emerald-600'}`}>{message.role === 'user' ? <span className="text-[13px] font-bold">Y</span> : <Sparkles size={13}/>}</div><div className={`rounded-2xl px-3.5 py-3 text-xs leading-relaxed ${message.role === 'user' ? 'rounded-tr-sm bg-blue-600 text-white' : 'rounded-tl-sm border border-slate-200 bg-white text-slate-600'}`}>{message.text}</div></div></div>)}
                <div ref={copilotEndRef}/>
              </div>
              <form onSubmit={submitExpense} className="rounded-2xl border border-slate-200 bg-white/70 p-3 focus-within:border-blue-500">
                <label htmlFor="expense-input" className="sr-only">Describe a shared expense</label><textarea id="expense-input" value={input} onChange={event => setInput(event.target.value)} rows={3} maxLength={1000} placeholder="Tell me about a shared expense…" className="w-full resize-none bg-transparent text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-500"/>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2.5"><button type="button" onClick={startListening} disabled={busy} aria-label={listening ? 'Stop voice capture and process recording' : 'Start voice capture'} className={`relative grid h-10 w-10 place-items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${listening ? 'scale-105 border-4 border-amber-400/30 bg-rose-500 text-white shadow-lg shadow-rose-400/30 animate-pulse' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}><Mic size={17}/></button><button type="submit" disabled={!input.trim() || busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"/> Checking</> : <>Check split <Send size={13}/></>}</button></div>
              </form>
              {(listening || busy) && <div role="status" aria-live="polite" className={`rounded-xl border p-3 ${listening ? 'border-rose-400/15 bg-rose-50' : 'border-blue-200 bg-blue-50'}`}><div className="flex items-center gap-2 text-xs font-medium text-slate-600"><span className={`relative grid h-6 w-6 place-items-center rounded-lg ${listening ? 'bg-rose-400/10 text-rose-300' : 'bg-cyan-300/10 text-blue-700'}`}>{busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-200/30 border-t-cyan-200"/> : <Activity size={13}/>}</span>{busy ? processingStage : 'Microphone is recording'}</div><div className="mt-2 grid grid-cols-3 gap-1.5 text-[13px]"><span className={`rounded-md px-2 py-1.5 ${audioChunks.length > 0 || busy ? 'bg-cyan-300/10 text-blue-700' : 'bg-slate-50 text-slate-500'}`}>1 · Audio captured</span><span className={`rounded-md px-2 py-1.5 ${busy ? 'bg-cyan-300/10 text-blue-700' : 'bg-slate-50 text-slate-500'}`}>2 · Speech parsed</span><span className={`rounded-md px-2 py-1.5 ${activeExpense ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-500'}`}>3 · Split checked</span></div>{listening && <p className="mt-2 text-[13px] text-rose-700/70">{audioChunks.length} audio segments captured · tap the microphone to finish</p>}</div>}
              <AnimatePresence>{error && <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700"><X size={14} className="mt-0.5 shrink-0"/>{error}</motion.div>}</AnimatePresence>
              <AnimatePresence>{success && <motion.div initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-600"><span className="grid h-5 w-5 place-items-center rounded-full bg-mint text-white"><Check size={13}/></span>Payment settled successfully. Ledger updated.</motion.div>}</AnimatePresence>
              <AnimatePresence>{activeExpense && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
                <div className="mb-3 flex items-start justify-between"><div><div className="text-[13px] font-semibold uppercase tracking-[.13em] text-emerald-600">Split confirmed</div><div className="mt-1 text-sm font-medium text-slate-900">{activeExpense.description}</div><div className="mt-1 text-[13px] text-slate-500">Paid by {activeExpense.payer} · {activeExpense.shared_with.length + 1} people</div></div><button onClick={() => { setActiveExpense(null); setActiveOrder(null); setError('') }} aria-label="Cancel checkout" className="rounded-md p-1 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><X size={14}/></button></div>
                <div className="mb-3 space-y-1.5 border-y border-slate-200 py-2.5">{activeExpense.liabilities.map((share, index) => <div key={`${share.person}-${index}`} className="flex justify-between text-xs"><span className="text-slate-500">{share.person}{index === 0 ? ' · payer' : ''}</span><span className="font-medium text-slate-600">{money(share.amount, share.currency)}</span></div>)}</div>
                {activeExpense.fraud_risk === 'HIGH' && <div role="alert" className="mb-3 animate-fadeIn rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-900 shadow-md"><p><strong>⚠️ Security Shield Active:</strong> Anomalous spending pattern detected. Review the payer, amount, and participants before checkout. PayPal may apply additional verification under its own risk controls; WePay cannot guarantee a biometric prompt or force a particular 3D Secure flow.</p><button type="button" onClick={() => { setHighRiskAcknowledged(true); setActiveExpense(current => current ? { ...current, high_risk_acknowledged: true } : current) }} aria-pressed={highRiskAcknowledged} className={`mt-3 w-full rounded-lg border px-3 py-2 text-left font-semibold transition ${highRiskAcknowledged ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-white text-red-800 hover:bg-red-100'}`}>{highRiskAcknowledged ? '✓ High-value split reviewed' : 'I reviewed this high-value split'}</button></div>}
                {activeExpense.hedging_hold_recommended && <div role="status" className="mb-3 animate-fadeIn rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900"><p className="font-semibold">🤖 AI Optimizer: Recent 45-day FX volatility is {Number.isFinite(Number(activeExpense.volatility_index)) ? `${Number(activeExpense.volatility_index).toFixed(2)}% annualized` : 'elevated'}. An optional 4-hour review hold is recommended.</p><p className="mt-1 text-amber-800">Rates can move either way; savings are not guaranteed. PayPal checkout remains paused until you choose to proceed.</p><button type="button" onClick={() => { setHedgingOverride(true); setActiveExpense(current => current ? { ...current, hedging_override_acknowledged: true } : current) }} aria-pressed={hedgingOverride} className={`mt-3 w-full rounded-lg border px-3 py-2 text-left font-semibold transition ${hedgingOverride ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-white text-amber-900 hover:bg-amber-100'}`}>{hedgingOverride ? '✓ Proceeding now via PayPal secure rails' : 'Proceed Anyway via PayPal Secure Rails Now'}</button></div>}
                {settings.biometricVoiceMatch && <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 p-3"><div className="flex items-start gap-2.5"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-violet-700"/><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-violet-800">Voice identity checkpoint</div><p className="mt-1 text-[13px] leading-relaxed text-slate-500">Confirm you recognize {activeExpense.payer}’s household voice request before checkout.</p></div></div><button onClick={() => setVoiceMatchConfirmed(value => !value)} aria-pressed={voiceMatchConfirmed} className={`mt-2.5 w-full rounded-lg border px-3 py-2 text-[13px] font-semibold transition ${voiceMatchConfirmed ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-violet-200 bg-violet-300/[0.07] text-violet-800 hover:bg-violet-300/[0.12]'}`}>{voiceMatchConfirmed ? '✓ Household voice confirmed' : 'Confirm household voice'}</button></div>}
                <div className="flex items-center justify-between text-[13px] text-slate-500"><span>Checkout total</span><span className="font-semibold text-slate-900">{activeOrder ? money(activeOrder.amount, activeOrder.currency) : money(activeExpense.amount, activeExpense.currency)}</span></div>
                {activeOrder?.currency && activeOrder.currency !== activeExpense.currency && <div className="mt-1 rounded-lg bg-blue-50 px-2.5 py-2 text-[11px] leading-relaxed text-blue-800">PayPal checkout is in {activeOrder.currency}: {money(activeOrder.amount, activeOrder.currency)}. Ledger split remains in {activeExpense.currency}. Reference rate {activeOrder.exchangeRate ? Number(activeOrder.exchangeRate).toPrecision(6) : 'shown by PayPal'}{activeOrder.exchangeRateDate ? ` · ${activeOrder.exchangeRateDate}` : ''}.</div>}
                {activeExpense.original_amount != null && activeExpense.original_currency && activeExpense.exchange_rate && <div className="mt-1 text-right text-[13px] text-slate-500">Converted from {money(activeExpense.original_amount, activeExpense.original_currency)} at {Number(activeExpense.exchange_rate).toPrecision(6)} · rate date {activeExpense.exchange_rate_date}</div>}
                {!activeExpense.parserFallback && (!settings.biometricVoiceMatch || voiceMatchConfirmed) && (activeExpense.fraud_risk !== 'HIGH' || highRiskAcknowledged) && (!activeExpense.hedging_hold_recommended || hedgingOverride) && apiStatus === 'ready' && paypalConfigured && <div className="mt-3">{activeOrder?.approvalUrl ? <div className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="text-[13px] font-semibold text-blue-700">Separate payment link ready</div><div className="mt-1 truncate text-[13px] text-slate-500">{activeOrder.approvalUrl}</div></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => { window.sessionStorage.setItem('wepay.pending.paypal.expense', JSON.stringify(activeExpense)); window.location.assign(activeOrder.approvalUrl) }} className="rounded-lg border border-blue-200 px-3 py-2 text-[13px] font-semibold text-blue-700 hover:bg-blue-100">Open PayPal checkout</button><button type="button" onClick={copySplitLink} className="rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-blue-700">Copy link</button></div></div> : <button type="button" onClick={() => void generateSplitLink()} disabled={splitLinkBusy} className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-[13px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60">{splitLinkBusy ? 'Generating separate link…' : 'Generate separate PayPal link'}</button>}</div>}
                {activeExpense.parserFallback ? <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-center text-[13px] leading-relaxed text-amber-800"><p>Gemini could not verify the result. Review or correct the expense text above; payment stays disabled until the split is verified.</p><button type="button" onClick={() => void submitExpense()} disabled={!input.trim() || busy} className="mt-2.5 rounded-lg border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-[13px] font-semibold text-amber-800 transition hover:bg-amber-200/15 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Checking split…' : 'Check split and enable link'}</button></div> : activeExpense.fraud_risk === 'HIGH' && !highRiskAcknowledged ? <div role="status" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-center text-[13px] text-red-900">Review the high-value security alert above to enable checkout.</div> : activeExpense.hedging_hold_recommended && !hedgingOverride ? <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-center text-[13px] text-amber-900">Choose the optional FX hold recommendation or explicitly proceed to enable checkout.</div> : settings.biometricVoiceMatch && !voiceMatchConfirmed ? <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-[13px] text-slate-500">Confirm the household voice above to unlock secure checkout.</div> : apiStatus !== 'ready' ? <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-center text-[13px] leading-relaxed text-amber-800">{apiStatus === 'checking' ? 'Connecting securely to the WePay checkout service…' : 'WePay checkout service is offline. Start the backend at http://127.0.0.1:8000, then refresh this page.'}</div> : !paypalConfigured ? <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-center text-[13px] leading-relaxed text-amber-800">PayPal sandbox is not configured on the backend. Configure its sandbox credentials in the backend environment to enable checkout.</div> : <div className="mt-3 rounded-xl bg-white p-2"><PayPalButtons style={{ layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal', height: 38 }} createOrder={createOrder} onApprove={approveOrder} onCancel={() => { setActiveOrder(null); setNotice('Checkout cancelled. Your split is ready whenever you are.') }} onError={caught => { setError(caught?.message || 'PayPal checkout failed. Check the server configuration and selected currency.'); setActiveOrder(null) }}/></div>}
                <div className="mt-2 flex items-center justify-center gap-1 text-[13px] text-slate-500"><ShieldCheck size={11}/> Secure sandbox checkout · {activeOrder ? 'Order ready' : 'PayPal protected'}</div>
              </motion.div>}</AnimatePresence>
              {!activeExpense && <div className="flex items-center justify-center gap-1.5 pt-0.5 text-[13px] text-slate-500"><ShieldCheck size={12}/> Private by design <span className="mx-1">·</span> <Globe2 size={11}/> Multi-currency</div>}
            </div> : activeTab === 'alerts' ? <div className="space-y-3 p-5"><CollectionPinger ledger={ledger} reminderDrafts={reminderDrafts} onReminder={prepareCollectionReminder} onPayShare={openCollectionCheckout}/><div className="space-y-2">{notifications.map(item => <NotificationCard key={item.id} item={item} onRead={() => setNotifications(current => current.map(row => row.id === item.id ? { ...row, unread: false } : row))}/>)}</div><button onClick={() => setNotifications(current => current.map(item => ({ ...item, unread: false })))} className="w-full rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">Mark all as read</button></div> : <div className="space-y-4 p-5"><div><h3 className="font-bold text-slate-900">Workspace configuration</h3><p className="mt-1 text-xs text-slate-500">Your voice, currency and activity preferences.</p></div><SettingToggle checked={settings.biometricVoiceMatch} onChange={value => setSettings(current => ({ ...current, biometricVoiceMatch: value }))} title="Voice match confirmation" description="Require a household confirmation before checkout."/><label className="block text-xs font-semibold text-slate-600">Forex monitoring<select value={settings.hedgingFrequency} onChange={event => setSettings(current => ({ ...current, hedgingFrequency: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="high">High performance monitoring</option><option value="balanced">Balanced interval scans</option></select></label><div><label htmlFor="quick-default-currency" className="mb-2 block text-xs font-semibold text-slate-600">Default currency</label><CurrencyPicker id="quick-default-currency" value={settings.defaultCurrency} onChange={currency => setSettings(current => ({ ...current, defaultCurrency: currency }))} options={currencyOptions}/><p className="mt-1.5 text-[13px] text-slate-500">Choose from the active currencies with reference-rate coverage.</p></div><button onClick={() => setShowSettings(true)} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-xs font-bold text-white">Open all settings</button></div>}
          </div>
        </section>

        <footer className="mt-7 flex flex-col gap-2 border-t border-slate-200 pt-4 text-[13px] text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>Made for the people who make life easier.</span><div className="flex items-center gap-4"><span className="flex items-center gap-1"><ShieldCheck size={11}/> Encrypted & secure</span><span>Sandbox mode</span><button onClick={() => setNotice('WePay.ai sandbox preview')} className="hover:text-slate-500">About WePay</button></div></footer>
      </main>
    </div>
    <AnimatePresence>
      {showNotifications && <NotificationTray notifications={notifications} onClose={() => setShowNotifications(false)} onMarkAllRead={() => setNotifications(current => current.map(item => ({ ...item, unread: false })))} onRead={id => setNotifications(current => current.map(item => item.id === id ? { ...item, unread: false } : item))}/>}
    </AnimatePresence>
    <AnimatePresence>
      {showAllActivity && <ActivityCenter ledger={ledger} notifications={notifications} onClose={() => setShowAllActivity(false)} onReadNotification={id => setNotifications(current => current.map(item => item.id === id ? { ...item, unread: false } : item))} onMarkAllRead={() => setNotifications(current => current.map(item => ({ ...item, unread: false })))}/>}
    </AnimatePresence>
    <AnimatePresence>
      {showSettings && <SettingsModal settings={settings} currencyOptions={currencyOptions} onChange={setSettings} onClose={() => setShowSettings(false)} onSave={() => { setShowSettings(false); setNotice('Workspace settings saved on this device') }}/>}
    </AnimatePresence>
    <AnimatePresence>{notice && <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-xs text-slate-600 shadow-xl">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')} className="ml-3 text-slate-500 hover:text-slate-900">×</button></motion.div>}</AnimatePresence>
  </div>
}

function LandingHome({ onLaunch }) {
  const features = [
    { icon: <Mic size={20}/>, title: 'Voice Intelligence', copy: 'Turn natural speech in your language into a clear, reviewable shared expense.' },
    { icon: <Globe2 size={20}/>, title: 'Live Forex Optimization', copy: 'Track family spending across currencies with transparent reference-rate conversions.' },
    { icon: <ShieldCheck size={20}/>, title: 'Zero-Click Escrow Security', copy: 'Verify every split before secure sandbox checkout and keep the ledger in sync.' },
  ]
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-white text-slate-900">
    <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
      <header className="flex h-[76px] items-center justify-between border-b border-slate-200"><div className="flex items-center gap-2 text-lg font-black tracking-tight">WePay<span className="text-blue-600">.ai</span></div><button onClick={onLaunch} className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:text-blue-700">Enter Platform <span aria-hidden="true">→</span></button></header>
      <main className="pb-20 pt-16 sm:pt-24 lg:pt-28">
        <section className="mx-auto max-w-5xl text-center"><div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"/> Shared finances, made human</div><h1 className="text-5xl font-black leading-[1.04] tracking-[-.065em] text-slate-900 sm:text-6xl lg:text-7xl"><span className="bg-gradient-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent">Global Payments.</span><br/><span>Natural Human Conversations.</span></h1><p className="mx-auto mt-7 max-w-2xl text-base font-medium leading-7 text-slate-500 sm:text-lg">The voice-driven family ledger that helps friends and multi-generational households understand, split, and settle shared expenses together.</p><button onClick={onLaunch} className="mt-9 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-7 py-4 text-sm font-bold text-white shadow-xl shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700">Launch WePay Core Engine <span aria-hidden="true">🚀</span></button><div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-slate-400"><span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-600"/> Secure sandbox checkout</span><span className="inline-flex items-center gap-1.5"><Globe2 size={14} className="text-blue-600"/> Multi-currency ledger</span><span>Built for every generation</span></div></section>
        <section className="mx-auto mt-20 grid max-w-6xl grid-cols-1 gap-5 md:grid-cols-3 lg:mt-28">{features.map((feature, index) => <motion.article key={feature.title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 * index }} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-4px_rgba(0,0,0,0.06)]"><div className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600">{feature.icon}</div><h2 className="text-lg font-black tracking-tight text-slate-900">{feature.title}</h2><p className="mt-2 text-sm font-medium leading-6 text-slate-500">{feature.copy}</p></motion.article>)}</section>
      </main><footer className="border-t border-slate-200 py-5 text-center text-xs font-medium text-slate-400">WePay.ai · Together, every transaction makes sense.</footer>
    </div>
  </motion.div>
}

function NotificationBell({ unreadCount, isOpen, onClick }) {
  return <button onClick={onClick} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={isOpen} className={`relative grid h-10 w-10 place-items-center rounded-xl border backdrop-blur-xl transition ${isOpen ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200/80 bg-white text-slate-500 hover:border-blue-300 hover:text-slate-900'}`}><Bell size={17}/>{unreadCount > 0 && <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-gradient-to-br from-rose-400 to-pink-600 px-1 text-[13px] font-bold leading-none text-white shadow-[0_0_14px_rgba(244,63,94,.28)]">{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
}

function NotificationTray({ notifications, onClose, onMarkAllRead, onRead }) {
  return <motion.div className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <motion.aside role="dialog" aria-modal="true" aria-label="Notifications" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-slate-200 bg-white/95 shadow-2xl shadow-cyan-900/10 backdrop-blur-2xl sm:w-80">
      <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-5"><div><div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-slate-900">Live activity</h2><span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[13px] font-semibold tracking-wide text-blue-700">STREAM</span></div><p className="mt-1 text-[13px] text-slate-500">Financial updates across your workspace</p></div><button onClick={onClose} aria-label="Close notifications" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><X size={16}/></button></div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3"><span className="text-[13px] font-medium uppercase tracking-[.15em] text-slate-500">Recent notifications</span><button onClick={onMarkAllRead} className="text-[13px] font-medium text-blue-700 transition hover:text-slate-900">Mark all read</button></div>
      <div className="scrollbar-hidden flex-1 space-y-2 overflow-y-auto p-3">{notifications.map(item => <NotificationCard key={item.id} item={item} onRead={() => onRead(item.id)}/>)}</div>
      <div className="border-t border-slate-200 px-5 py-3 text-center text-[13px] text-slate-500"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_8px_#8ee8c4]"/>Connected to the family activity stream</div>
    </motion.aside>
  </motion.div>
}

function CollectionPinger({ ledger, reminderDrafts, onReminder, onPayShare }) {
  const pendingShares = ledger.filter(item => item.status === 'Pending').flatMap(item => item.sharedWith.filter(member => !(item.settledMembers || []).includes(member)).map(member => {
    const people = [item.payer, ...item.sharedWith]
    const index = people.findIndex(person => person.toLocaleLowerCase() === member.toLocaleLowerCase())
    const digits = currencyDigits(item.currency)
    const minorUnits = splitMinorUnits(item.amount, people.length, item.currency)[index]
    return { item, member, key: `${item.id}:${member}`, amount: minorUnits / (10 ** digits) }
  }))
  return <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
    <div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-sm"><Send size={16}/></div><div><h3 className="text-sm font-bold text-slate-900">AI Autonomous Collection Pinger</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">Cent-accurate share reminders for pending household expenses.</p></div></div>
    <div className="mt-4 space-y-2.5">{pendingShares.map(({ item, member, key, amount }) => <article key={key} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-xs font-bold text-slate-900">@{member} <span className="font-medium text-slate-500">· {item.description}</span></div><div className="mt-1 text-[13px] text-slate-500">Paid by {item.payer} · individual share <span className="font-bold text-emerald-600">{money(amount, item.currency)}</span></div></div><span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[13px] font-semibold text-amber-700">Pending</span></div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => onReminder(item, member)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50">Copy reminder</button><button type="button" onClick={() => onPayShare(item, member)} className="rounded-lg bg-blue-600 px-2.5 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700">Pay share</button></div>{reminderDrafts[key] && <p className="mt-2 break-words rounded-lg bg-slate-50 p-2 text-[13px] leading-relaxed text-slate-500">{reminderDrafts[key]}</p>}</article>)}{pendingShares.length === 0 && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">All family shares are settled. No reminders are due.</p>}</div>
    <p className="mt-3 text-[13px] leading-relaxed text-slate-500">Reminders are prepared locally and are not sent automatically. Each person can review their share and continue through the configured PayPal sandbox.</p>
  </section>
}

function NotificationCard({ item, onRead }) {
  const tones = { mint: 'bg-emerald-50 text-emerald-600', violet: 'bg-violet-300/10 text-violet-700', blue: 'bg-sky-300/10 text-sky-700' }
  const Icon = item.category === 'Forex rate' ? Activity : item.category === 'Settlement' ? WalletCards : Mic
  return <button onClick={onRead} className={`w-full rounded-2xl border p-3.5 text-left transition ${item.unread ? 'border-blue-200 bg-blue-50 hover:bg-blue-50' : 'border-slate-200 bg-white/[0.015] hover:bg-slate-50'}`}><div className="flex gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tones[item.tone] || tones.mint}`}><Icon size={15}/></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold tracking-wide text-slate-500">{item.category}</span><span className="shrink-0 text-[13px] text-slate-500">{item.time}</span></span><span className="mt-1.5 block text-[13px] leading-[1.65] text-slate-500">{item.message}</span></span>{item.unread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_9px_rgba(103,232,249,.7)]"/>}</div></button>
}

function ActivityCenter({ ledger, notifications, onClose, onReadNotification, onMarkAllRead }) {
  const unreadCount = notifications.filter(item => item.unread).length
  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const participants = selectedTransaction ? [selectedTransaction.payer, ...(selectedTransaction.sharedWith || [])] : []
  const splitUnits = selectedTransaction ? splitMinorUnits(selectedTransaction.amount, participants.length, selectedTransaction.currency) : []
  const unitFactor = selectedTransaction ? 10 ** currencyDigits(selectedTransaction.currency) : 1
  return <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-sm sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <motion.section role="dialog" aria-modal="true" aria-labelledby="activity-center-title" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .98 }} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7"><div><div className="flex items-center gap-2"><h2 id="activity-center-title" className="text-lg font-black tracking-tight text-slate-900">{selectedTransaction ? 'Expense bill' : 'All activity'}</h2>{!selectedTransaction && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[13px] font-semibold text-slate-600">{ledger.length + notifications.length} items</span>}</div><p className="mt-1 text-sm font-medium text-slate-500">{selectedTransaction ? selectedTransaction.description : 'Shared expenses and workspace notifications.'}</p></div><div className="flex shrink-0 items-center gap-2">{selectedTransaction && <button type="button" onClick={() => setSelectedTransaction(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">← All activity</button>}<button type="button" onClick={onClose} aria-label="Close all activity" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"><X size={17}/></button></div></header>
      {selectedTransaction ? <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[13px] font-semibold uppercase tracking-[.14em] text-blue-700">Total expense</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{money(selectedTransaction.amount, selectedTransaction.currency)}</p></div><span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${selectedTransaction.status === 'Settled' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{selectedTransaction.status}</span></div><div className="mt-5 grid grid-cols-1 gap-3 border-t border-blue-100 pt-4 sm:grid-cols-3"><div><p className="text-[13px] text-slate-500">Paid by</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedTransaction.payer}</p></div><div><p className="text-[13px] text-slate-500">Date</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedTransaction.date || 'Date unavailable'}</p></div><div><p className="text-[13px] text-slate-500">People sharing</p><p className="mt-1 text-sm font-semibold text-slate-900">{participants.length}</p></div></div></div>
        <section className="mt-6"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900">Split breakdown</h3><p className="mt-1 text-[13px] text-slate-500">Exact amounts allocated to each person.</p></div><span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">{selectedTransaction.currency}</span></div><div className="overflow-hidden rounded-2xl border border-slate-200"><div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-slate-50 px-4 py-3 text-[13px] font-semibold text-slate-500"><span>Person</span><span>Share</span><span>Status</span></div>{participants.map((person, index) => { const paid = person.toLocaleLowerCase() === selectedTransaction.payer.toLocaleLowerCase(); const settled = selectedTransaction.status === 'Settled' || paid || (selectedTransaction.settledMembers || []).some(member => member.toLocaleLowerCase() === person.toLocaleLowerCase()); return <div key={`${selectedTransaction.id}-${person}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-slate-100 px-4 py-3.5"><div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-[13px] font-bold text-blue-700">{person.slice(0, 2).toUpperCase()}</span><span className="truncate text-sm font-semibold text-slate-800">{person}{paid && <span className="ml-1 text-[13px] font-medium text-slate-500">· payer</span>}</span></div><span className="text-sm font-bold text-slate-900">{money(splitUnits[index] / unitFactor, selectedTransaction.currency)}</span><span className={`rounded-full px-2 py-1 text-[13px] font-semibold ${settled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{settled ? 'Paid' : 'Due'}</span></div>})}</div><p className="mt-3 text-[13px] leading-relaxed text-slate-500">Split rounding is allocated in minor currency units so the listed shares add up to the transaction total.</p></section>
      </div> : <div className="scrollbar-hidden grid min-h-0 flex-1 gap-6 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
        <section aria-labelledby="activity-expenses-title"><div className="mb-3 flex items-center justify-between"><h3 id="activity-expenses-title" className="text-sm font-bold text-slate-900">Shared expenses</h3><span className="text-[13px] font-medium text-slate-500">{ledger.length} records</span></div><div className="space-y-2.5">{ledger.map(item => <button type="button" key={`activity-ledger-${item.id}`} onClick={() => setSelectedTransaction(item)} aria-label={`Open bill for ${item.description}, ${money(item.amount, item.currency)}`} className="group w-full animate-fadeIn rounded-2xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><LedgerCard item={item}/><span className="mt-1 block pr-2 text-right text-[13px] font-semibold text-blue-700 opacity-70 transition group-hover:opacity-100">Open bill →</span></button>)}{ledger.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No shared expenses yet.</p>}</div></section>
        <section aria-labelledby="activity-alerts-title"><div className="mb-3 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><h3 id="activity-alerts-title" className="text-sm font-bold text-slate-900">Notifications</h3><span className="text-[13px] font-medium text-slate-500">{notifications.length} events</span></div>{unreadCount > 0 && <button type="button" onClick={onMarkAllRead} className="shrink-0 text-[13px] font-semibold text-blue-700 hover:text-blue-800">Mark all read</button>}</div><div className="space-y-2.5">{notifications.map(item => <div key={`activity-notification-${item.id}`} className="animate-fadeIn"><NotificationCard item={item} onRead={() => onReadNotification(item.id)}/></div>)}{notifications.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No notifications yet.</p>}</div></section>
      </div>}
      <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-[13px] text-slate-500 sm:px-7"><span>Live updates appear as they arrive.</span><button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-3.5 py-2 font-semibold text-white transition hover:bg-blue-700">Done</button></footer>
    </motion.section>
  </motion.div>
}

function SettingsModal({ settings, onChange, onClose, onSave, currencyOptions }) {
  const [openSection, setOpenSection] = useState('identity')
  const updateSetting = (key, value) => onChange(current => ({ ...current, [key]: value }))
  const updateChannel = key => onChange(current => ({ ...current, channels: { ...current.channels, [key]: !current.channels[key] } }))
  const accordion = (id, title, subtitle, icon, content) => <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white"><button onClick={() => setOpenSection(current => current === id ? '' : id)} aria-expanded={openSection === id} className="flex w-full items-center gap-3 p-4 text-left"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-blue-700">{icon}</span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-900">{title}</span><span className="mt-1 block text-[13px] text-slate-500">{subtitle}</span></span><ChevronDown size={15} className={`text-slate-500 transition-transform ${openSection === id ? 'rotate-180' : ''}`}/></button><AnimatePresence initial={false}>{openSection === id && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="border-t border-slate-200 px-4 pb-4 pt-3">{content}</div></motion.div>}</AnimatePresence></section>

  return <motion.div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/75 p-3 backdrop-blur-md sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <motion.div role="dialog" aria-modal="true" aria-labelledby="settings-title" initial={{ opacity: 0, scale: .96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .97, y: 8 }} transition={{ duration: .18 }} className="my-auto w-full max-w-[580px] overflow-hidden rounded-[26px] border border-slate-200/80 bg-white/95 shadow-2xl shadow-cyan-900/10 backdrop-blur-2xl">
      <div className="flex items-start justify-between border-b border-slate-200/80 px-5 py-5 sm:px-6"><div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl border border-blue-200 bg-blue-50 text-blue-700"><Settings2 size={18}/></span><div><div className="flex items-center gap-2"><h2 id="settings-title" className="text-base font-semibold tracking-[-.025em] text-slate-900">Workspace settings</h2><span className="rounded-full border border-slate-200 px-2 py-0.5 text-[13px] text-slate-500">LOCAL</span></div><p className="mt-1 text-xs text-slate-500">Tune voice security, currency and activity streams.</p></div></div><button onClick={onClose} aria-label="Close workspace settings" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><X size={16}/></button></div>
      <div className="scrollbar-hidden max-h-[min(68vh,560px)] space-y-2.5 overflow-y-auto p-4 sm:p-5">
        {accordion('identity', 'Identity & voice security', 'Anti-fraud validation controls', <ShieldCheck size={16}/>, <SettingToggle checked={settings.biometricVoiceMatch} onChange={value => updateSetting('biometricVoiceMatch', value)} title="Enable Biometric Voice Match Validation" description="Require an explicit household voice confirmation before checkout. No voiceprint is stored."/>) }
        {accordion('forex', 'Forex & settlement mode', 'Rate monitoring and checkout currency', <Globe2 size={16}/>, <div className="space-y-4"><div><label htmlFor="hedging-frequency" className="mb-2 block text-[13px] font-medium text-slate-500">Dynamic Forex Hedging Frequency</label><select id="hedging-frequency" value={settings.hedgingFrequency} onChange={event => updateSetting('hedgingFrequency', event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none transition focus:border-cyan-300/40"><option value="high">High Performance Active Monitoring</option><option value="balanced">Balanced Interval Scans</option></select><p className="mt-1.5 text-[13px] text-slate-500">Refreshes reference rates every {settings.hedgingFrequency === 'high' ? '15 minutes' : '60 minutes'} while this workspace is open.</p></div><div><label htmlFor="default-currency-select" className="mb-2 block text-[13px] font-medium text-slate-500">Default currency for parsing, conversion and ledger display</label><CurrencyPicker id="default-currency-select" value={settings.defaultCurrency} onChange={value => updateSetting("defaultCurrency", value)} options={currencyOptions}/><p className="mt-1.5 text-[13px] text-slate-500">Options are sourced from active reference-rate currencies.</p></div></div>) }
        {accordion('channels', 'System Notification Channels', 'Choose how activity reaches you', <Radio size={16}/>, <div className="space-y-1"> <SettingToggle checked={settings.channels.inApp} onChange={() => updateChannel('inApp')} title="In-app alert feed" description="Show new activity in the notification tray."/><SettingToggle checked={settings.channels.audio} onChange={() => updateChannel('audio')} title="Audio pings" description="Play a short, optional tone for new in-app alerts."/><SettingToggle checked={settings.channels.webhook} onChange={() => updateChannel('webhook')} title="Automated webhook tracking" description="Save a destination for workspace event tracking."/><label htmlFor="webhook-target" className="mb-1 mt-3 block text-[13px] font-medium text-slate-500">Webhook tracking target</label><div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3"><Webhook size={14} className="shrink-0 text-slate-500"/><input id="webhook-target" type="url" value={settings.webhookTarget} onChange={event => updateSetting('webhookTarget', event.target.value)} disabled={!settings.channels.webhook} className="min-w-0 flex-1 bg-transparent py-2.5 text-[13px] text-slate-500 outline-none placeholder:text-slate-600 disabled:opacity-40" placeholder="Paste a tracking endpoint URL"/></div></div>) }
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-slate-200/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><span className="flex items-center gap-1.5 text-[13px] text-slate-500"><ShieldCheck size={12}/> Preferences save on this device</span><button onClick={onSave} className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-300 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-[0_0_24px_rgba(34,211,238,.16)] transition hover:brightness-110"><Check size={14}/> Save workspace settings</button></div>
    </motion.div>
  </motion.div>
}

function SettingToggle({ checked, onChange, title, description }) {
  return <div className="flex items-center justify-between gap-4 py-2.5"><div className="min-w-0"><div className="text-[13px] font-medium text-slate-600">{title}</div><div className="mt-1 text-[13px] leading-relaxed text-slate-500">{description}</div></div><button role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)} className={`relative h-[22px] w-10 shrink-0 rounded-full border transition ${checked ? 'border-cyan-300/30 bg-cyan-300/20' : 'border-slate-700 bg-slate-100'}`}><span className={`absolute top-[3px] h-3.5 w-3.5 rounded-full transition-all ${checked ? 'left-[21px] bg-cyan-200 shadow-[0_0_9px_rgba(103,232,249,.65)]' : 'left-[3px] bg-slate-500'}`}/></button></div>
}

function Metric({ icon, label, value, detail, accent }) {
  const colors = { mint: 'text-emerald-600 bg-emerald-50', violet: 'text-violet-700 bg-violet-300/10', blue: 'text-sky-700 bg-sky-300/10' }
  return <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 sm:p-5"><div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-500">{label}</span><span className={`grid h-8 w-8 place-items-center rounded-xl ${colors[accent]}`}>{icon}</span></div><div className="mt-3 text-[26px] font-semibold tracking-[-.05em] text-slate-900">{value}</div><div className="mt-1 text-[13px] text-slate-500">{detail}</div></div>
}

function BudgetAnalytics({ ledger, fx }) {
  const categories = [
    { key: 'groceries', label: 'Household Groceries', color: 'bg-emerald-500', dot: 'bg-emerald-500', total: 0 },
    { key: 'dining', label: 'Reunion Dining', color: 'bg-blue-600', dot: 'bg-blue-600', total: 0 },
    { key: 'travel', label: 'Travel / Leisure', color: 'bg-amber-500', dot: 'bg-amber-500', total: 0 },
  ]
  const matchCategory = description => {
    const text = String(description || '').toLocaleLowerCase()
    if (/grocer|grocery|market|kirana|ration|राशन|किराना/.test(text)) return 'groceries'
    if (/dinner|dining|restaurant|lunch|reunion|भोज|खाना|food/.test(text)) return 'dining'
    if (/travel|flight|hotel|vacation|holiday|cab|taxi|uber|leisure|trip|यात्रा|ट्रैवल/.test(text)) return 'travel'
    return null
  }
  let categorizedCount = 0
  for (const item of ledger) {
    const key = matchCategory(item.description)
    if (!key || !fx) continue
    const rate = item.currency === fx.base ? 1 : fx.rates?.[item.currency]
    if (!Number.isFinite(rate) || rate <= 0) continue
    const category = categories.find(candidate => candidate.key === key)
    category.total += Number(item.amount) / rate
    categorizedCount += 1
  }
  const grandTotal = categories.reduce((sum, category) => sum + category.total, 0)
  return <section aria-label="Family spending distribution" className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold tracking-tight text-slate-900">Parivar budget analytics</h3><p className="mt-1 text-[13px] text-slate-500">Categorized family spend, converted to USD.</p></div><div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-600">{fx ? money(grandTotal, 'USD') : 'Rates loading'}</div></div>
    <div role="img" aria-label={categories.map(category => `${category.label}: ${grandTotal ? Math.round(category.total / grandTotal * 100) : 0} percent`).join('; ')} className="mt-4 flex h-4 w-full overflow-hidden rounded-xl bg-slate-200">{fx && grandTotal > 0 && categories.map(category => <div key={category.key} title={`${category.label}: ${money(category.total, 'USD')}`} className={`${category.color} h-full transition-[width] duration-500`} style={{ width: `${category.total / grandTotal * 100}%` }}/>)}</div>
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">{categories.map(category => { const share = grandTotal > 0 ? category.total / grandTotal * 100 : 0; return <div key={category.key} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5"><div className="flex min-w-0 items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${category.dot}`}/><span className="truncate text-[13px] font-medium text-slate-600">{category.label}</span></div><span className="shrink-0 text-right text-[13px] font-bold text-slate-900">{fx ? `${Math.round(share)}%` : '—'}</span></div>})}</div>
    <p className="mt-3 text-[13px] leading-relaxed text-slate-500">{fx ? `${categorizedCount} categorized ledger ${categorizedCount === 1 ? 'entry' : 'entries'} included. Other descriptions are excluded from this distribution.` : 'Waiting for live reference rates to compare multiple currencies consistently.'}</p>
  </section>
}

function LedgerCard({ item }) {
  const settled = item.status === 'Settled'
  const participantCount = item.sharedWith.length + 1
  const digits = currencyDigits(item.currency)
  const unitFactor = 10 ** digits
  const shares = splitMinorUnits(item.amount, participantCount, item.currency).map(value => value / unitFactor)
  const smallestShare = Math.min(...shares)
  const largestShare = Math.max(...shares)
  const shareLabel = smallestShare === largestShare ? money(smallestShare, item.currency) : `${money(smallestShare, item.currency)}–${money(largestShare, item.currency)}`
  const iconColors = { mint: 'bg-emerald-50 text-emerald-600', violet: 'bg-violet-300/10 text-violet-700', amber: 'bg-amber-300/10 text-amber-800', rose: 'bg-rose-300/10 text-rose-700' }
  return <article className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-3 py-3 transition hover:border-white/[0.11] hover:bg-slate-50 sm:px-3.5"><div className="flex min-w-0 items-center gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] text-[13px] font-semibold ${iconColors[item.color] || iconColors.mint}`}>{item.initials}</div><div className="min-w-0"><div className="truncate text-[13px] font-medium text-slate-900">{item.description}</div><div className="mt-1 truncate text-[13px] text-slate-500">{item.payer} paid <span className="mx-0.5">·</span> shared with {item.sharedWith.length ? item.sharedWith.join(', ') : 'you'} <span className="mx-0.5">·</span> {item.date}</div></div></div><div className="shrink-0 text-right"><div className="text-[13px] font-semibold text-slate-900">{shareLabel}<span className="ml-1 text-[13px] font-normal text-slate-500">each</span></div><div className="mt-1.5 flex justify-end"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-medium ${settled ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-300/10 text-amber-800'}`}><span className={`h-1 w-1 rounded-full ${settled ? 'bg-mint' : 'bg-amber-300'}`}/>{item.status}</span></div></div></article>
}

export default function App() {
  return <PayPalScriptProvider options={{ 'client-id': PAYPAL_CLIENT_ID, currency: 'USD', intent: 'capture', components: 'buttons', 'disable-funding': 'credit,card' }}><AppContent/></PayPalScriptProvider>
}
