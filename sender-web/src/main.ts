import { createClient } from '@supabase/supabase-js'
import './styles.css'

const PAIR_CODE_STORAGE_KEY = 'desktop-pet-pair-code'
const DAILY_COUNT_STORAGE_KEY = 'desktop-pet-daily-send-count'
const MIN_PAIR_CODE_LENGTH = 4
const MAX_MESSAGE_LENGTH = 200
const FIXED_SENDER_NAME = 'TA'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

const form = document.querySelector<HTMLFormElement>('#message-form')
const pairCodeInput = document.querySelector<HTMLInputElement>('#pair-code')
const contentInput = document.querySelector<HTMLTextAreaElement>('#message-content')
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')
const statusMessage = document.querySelector<HTMLParagraphElement>('#status-message')
const messageCount = document.querySelector<HTMLSpanElement>('#message-count')
const dailyCount = document.querySelector<HTMLSpanElement>('#daily-count')
let isSending = false

function setStatus(message: string, tone: 'idle' | 'success' | 'error' = 'idle'): void {
  if (!statusMessage) {
    return
  }

  statusMessage.textContent = message
  statusMessage.dataset.tone = tone
}

function setSending(isSending: boolean): void {
  if (sendButton) {
    sendButton.disabled = isSending
    sendButton.textContent = isSending ? '发送中...' : '发送给桌宠'
  }
}

function updateMessageCount(): void {
  if (!contentInput || !messageCount) {
    return
  }

  messageCount.textContent = `${contentInput.value.trim().length} / ${MAX_MESSAGE_LENGTH}`
}

function getLocalDateKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function readDailyCount(): number {
  try {
    const rawValue = localStorage.getItem(DAILY_COUNT_STORAGE_KEY)

    if (!rawValue) {
      return 0
    }

    const parsedValue = JSON.parse(rawValue) as { date?: string; count?: number }

    if (parsedValue.date !== getLocalDateKey()) {
      return 0
    }

    return typeof parsedValue.count === 'number' && Number.isFinite(parsedValue.count)
      ? Math.max(0, Math.round(parsedValue.count))
      : 0
  } catch {
    return 0
  }
}

function writeDailyCount(count: number): void {
  localStorage.setItem(
    DAILY_COUNT_STORAGE_KEY,
    JSON.stringify({
      date: getLocalDateKey(),
      count
    })
  )
}

function updateDailyCount(): void {
  if (!dailyCount) {
    return
  }

  dailyCount.textContent = `今日已发送 ${readDailyCount()} 条`
}

function restoreSavedFields(): void {
  if (!pairCodeInput) {
    return
  }

  pairCodeInput.value = localStorage.getItem(PAIR_CODE_STORAGE_KEY) ?? ''
}

function validateConfig(): boolean {
  if (!supabaseUrl || !supabaseAnonKey) {
    setStatus('发送失败，请稍后再试。', 'error')
    return false
  }

  if (looksLikeForbiddenSecretKey(supabaseAnonKey)) {
    setStatus('发送失败，请稍后再试。', 'error')
    return false
  }

  return true
}

function looksLikeForbiddenSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) {
    return true
  }

  const [, payload] = key.split('.')

  if (!payload) {
    return false
  }

  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      '='
    )
    const decodedPayload = JSON.parse(window.atob(paddedPayload)) as { role?: string }

    return decodedPayload.role === 'service_role'
  } catch {
    return false
  }
}

async function sendMessage(pairCode: string, content: string): Promise<void> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('missing_config')
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  })

  const { error } = await supabase.rpc('send_pet_message', {
    pair_code: pairCode,
    content,
    sender_name: FIXED_SENDER_NAME
  })

  if (error) {
    throw error
  }
}

restoreSavedFields()
updateMessageCount()
updateDailyCount()
validateConfig()

contentInput?.addEventListener('input', updateMessageCount)

form?.addEventListener('submit', async (event) => {
  event.preventDefault()

  if (isSending || !validateConfig() || !pairCodeInput || !contentInput) {
    return
  }

  const pairCode = pairCodeInput.value.trim()
  const content = contentInput.value.trim()

  if (!pairCode) {
    setStatus('请先输入配对码。', 'error')
    return
  }

  if (pairCode.length < MIN_PAIR_CODE_LENGTH) {
    setStatus('配对码至少需要 4 位。', 'error')
    return
  }

  if (!content) {
    setStatus('不能发送空消息。', 'error')
    return
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    setStatus(`消息不能超过 ${MAX_MESSAGE_LENGTH} 字。`, 'error')
    return
  }

  isSending = true
  setSending(true)
  setStatus('正在把小纸条送过去...', 'idle')

  try {
    await sendMessage(pairCode, content)
    localStorage.setItem(PAIR_CODE_STORAGE_KEY, pairCode)
    writeDailyCount(readDailyCount() + 1)
    contentInput.value = ''
    updateMessageCount()
    updateDailyCount()
    setStatus('已经发送到桌宠啦', 'success')
  } catch {
    setStatus('发送失败，请稍后再试', 'error')
  } finally {
    isSending = false
    setSending(false)
  }
})
