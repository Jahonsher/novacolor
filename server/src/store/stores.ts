import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { ChatSession, Lead } from '../schemas.js'
import { JsonFile } from './fs-utils.js'

export const MAX_LEADS = 10000
export const MAX_CHAT_SESSIONS = 2000
export const MAX_MESSAGES_PER_SESSION = 300
/** Same phone again within this window updates the existing lead instead of creating a new one. */
export const LEAD_DEDUPE_MS = 10 * 60_000
const MAX_LEAD_MESSAGE = 4000

/** Private runtime data (session secret, phone numbers, chats): owner read/write only. */
export const PRIVATE_FILE_MODE = 0o600

export const newId = () => `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`

export type Settings = {
  sessionSecret?: string
  telegramChatId?: string
  /** Chosen in the admin panel; TELEGRAM_MODE (env) wins. */
  telegramMode?: 'subscribers' | 'single'
  /** Bumped on logout: every session cookie issued before is invalid (log out everywhere). */
  sessionEpoch?: number
}

export class SettingsStore extends JsonFile<Settings> {
  constructor(dataDir: string) {
    super(path.join(dataDir, 'settings.json'), () => ({}), { indent: 2, mode: PRIVATE_FILE_MODE })
  }
  patch(p: Partial<Settings>) {
    return this.update((cur) => ({ value: { ...cur, ...p }, result: undefined }))
  }
  /** Invalidate all admin sessions. */
  bumpSessionEpoch() {
    return this.update((cur) => {
      const sessionEpoch = (cur.sessionEpoch ?? 0) + 1
      return { value: { ...cur, sessionEpoch }, result: sessionEpoch }
    })
  }
}

export type NewLead = Omit<Lead, 'id' | 'createdAt' | 'status' | 'telegram'>

export type UpsertResult =
  /** created: a new lead; merged: same phone within LEAD_DEDUPE_MS — the existing lead was updated */
  | { kind: 'created' | 'merged'; lead: Lead }
  /** rate: `allowNew` refused (global hourly cap); full: MAX_LEADS reached and no `done` lead to evict */
  | { kind: 'rate' | 'full'; lead?: undefined }

/** Digits only; a 9-digit local Uzbek number counts as +998… (the AI chat normalises it that way). */
const phoneKey = (p: string) => {
  const d = p.replace(/\D/g, '')
  return d.length === 9 ? `998${d}` : d
}

function mergeMessage(old: Lead, data: NewLead): string | undefined {
  const add = data.message
  if (!add || add === old.message) return old.message
  // a lead from the same AI chat: the new summary (recent conversation) already contains the old one
  const sameChat = old.source === 'ai' && data.source === 'ai' && old.chatId === data.chatId
  if (!old.message || sameChat) return add.slice(-MAX_LEAD_MESSAGE)
  return `${old.message}\n\n${add}`.slice(-MAX_LEAD_MESSAGE)
}

export class LeadsStore extends JsonFile<Lead[]> {
  constructor(
    dataDir: string,
    private readonly maxLeads = MAX_LEADS,
  ) {
    super(path.join(dataDir, 'leads.json'), () => [], { indent: 1, mode: PRIVATE_FILE_MODE })
  }

  /** Newest first. */
  list(): Lead[] {
    return [...this.get()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Add a lead, or merge it into a recent lead with the same phone (no new lead, no second notification).
   * `allowNew` is asked (under the lock) only when a NEW lead would be created — the global hourly cap.
   * At MAX_LEADS the oldest `done` leads are evicted; if there are none the lead is refused (`full`):
   * spam must never push out real, unprocessed leads.
   */
  upsert(data: NewLead, allowNew: () => boolean = () => true, now = Date.now()): Promise<UpsertResult> {
    return this.update<UpsertResult>((cur) => {
      const key = phoneKey(data.phone)
      let idx = -1
      for (let i = cur.length - 1; i >= 0; i--) {
        const l = cur[i]!
        if (now - Date.parse(l.createdAt) <= LEAD_DEDUPE_MS && phoneKey(l.phone) === key) {
          idx = i
          break
        }
      }
      if (idx >= 0) {
        const old = cur[idx]!
        const message = mergeMessage(old, data)
        const product = old.product || data.product
        const chatId = old.chatId || data.chatId
        const lead: Lead = {
          ...old,
          name: old.name || data.name,
          ...(product ? { product } : {}),
          ...(message ? { message } : {}),
          ...(chatId ? { chatId } : {}),
        }
        const next = [...cur]
        next[idx] = lead
        return { value: next, result: { kind: 'merged', lead } }
      }

      let next = cur
      if (cur.length >= this.maxLeads) {
        const excess = cur.length - this.maxLeads + 1
        const evict = new Set(
          cur
            .filter((l) => l.status === 'done')
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .slice(0, excess)
            .map((l) => l.id),
        )
        if (evict.size < excess) return { value: cur, result: { kind: 'full' } }
        next = cur.filter((l) => !evict.has(l.id))
      }
      if (!allowNew()) return { value: cur, result: { kind: 'rate' } }
      const lead: Lead = { id: newId(), createdAt: new Date(now).toISOString(), status: 'new', telegram: 'skipped', ...data }
      return { value: [...next, lead], result: { kind: 'created', lead } }
    })
  }

  patch(id: string, p: Partial<Lead>): Promise<Lead | undefined> {
    return this.update((cur) => {
      const i = cur.findIndex((l) => l.id === id)
      if (i < 0) return { value: cur, result: undefined }
      const next = [...cur]
      next[i] = { ...cur[i]!, ...p }
      return { value: next, result: next[i] }
    })
  }

  remove(id: string): Promise<boolean> {
    return this.update((cur) => {
      const next = cur.filter((l) => l.id !== id)
      return { value: next, result: next.length !== cur.length }
    })
  }
}

export class ChatsStore extends JsonFile<ChatSession[]> {
  constructor(
    dataDir: string,
    private readonly maxSessions = MAX_CHAT_SESSIONS,
  ) {
    super(path.join(dataDir, 'chats.json'), () => [], { mode: PRIVATE_FILE_MODE, coalesce: true })
  }

  find(id: string): ChatSession | undefined {
    return this.get().find((s) => s.id === id)
  }

  /** Insert or replace a session; keeps at most `maxSessions` (least recently updated are dropped). */
  save(session: ChatSession): Promise<void> {
    const s = { ...session, messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION) }
    return this.update((cur) => {
      let next = cur.filter((x) => x.id !== s.id)
      next.push(s)
      if (next.length > this.maxSessions) {
        next = next.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(-this.maxSessions)
      }
      return { value: next, result: undefined }
    })
  }
}
