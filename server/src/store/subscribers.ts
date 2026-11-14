import path from 'node:path'
import { JsonFile } from './fs-utils.js'
import { PRIVATE_FILE_MODE } from './stores.js'

/** Hard cap: a /start flood must not grow the list (and every lead broadcast) without bound. */
export const MAX_SUBSCRIBERS = 100

export type SubscriberType = 'private' | 'group' | 'supergroup'

export type Subscriber = {
  chatId: string
  name: string
  username?: string
  type: SubscriberType
  addedAt: string
  /** `start` — came from Telegram (/start, bot added to a group); `manual` — added in the admin panel. */
  source: 'start' | 'manual'
  active: boolean
  /**
   * Why it is inactive: `admin` (switched off in the panel — sticky, /start does not turn it back on),
   * `user` (/stop or blocked the bot), `telegram` (sending failed: blocked / kicked / chat not found).
   */
  disabledBy?: 'admin' | 'user' | 'telegram'
}

type Data = {
  subscribers: Subscriber[]
  /** getUpdates offset (last handled update_id + 1); also de-duplicates webhook retries. */
  updateOffset?: number
}

export type ChatInfo = { chatId: string; name: string; username?: string; type: SubscriberType }

export type UpsertKind = 'added' | 'reactivated' | 'already' | 'blocked' | 'full'
export type UpsertResult = { kind: UpsertKind; subscriber?: Subscriber }

export class SubscriberError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message)
  }
}

/** Who receives lead notifications in `subscribers` mode: DATA_DIR/telegram-subscribers.json (0600). */
export class SubscribersStore extends JsonFile<Data> {
  constructor(dataDir: string) {
    super(path.join(dataDir, 'telegram-subscribers.json'), () => ({ subscribers: [] }), { indent: 2, mode: PRIVATE_FILE_MODE })
  }

  list(): Subscriber[] {
    return this.get().subscribers
  }

  active(): Subscriber[] {
    return this.list().filter((s) => s.active)
  }

  find(chatId: string): Subscriber | undefined {
    return this.list().find((s) => s.chatId === chatId)
  }

  get offset(): number {
    return this.get().updateOffset ?? 0
  }

  setOffset(offset: number): Promise<void> {
    if (offset <= this.offset) return Promise.resolve()
    return this.update((cur) => ({ value: { ...cur, updateOffset: Math.max(offset, cur.updateOffset ?? 0) }, result: undefined }))
  }

  private change<R>(fn: (list: Subscriber[]) => { list: Subscriber[]; result: R }): Promise<R> {
    return this.update((cur) => {
      const { list, result } = fn(cur.subscribers)
      return { value: list === cur.subscribers ? cur : { ...cur, subscribers: list }, result }
    })
  }

  /** From Telegram (/start, bot added to a group). An admin-disabled entry stays off. */
  fromTelegram(chat: ChatInfo, now = new Date()): Promise<UpsertResult> {
    return this.change<UpsertResult>((list) => {
      const i = list.findIndex((s) => s.chatId === chat.chatId)
      if (i >= 0) {
        const old = list[i]!
        if (!old.active && old.disabledBy === 'admin') return { list, result: { kind: 'blocked', subscriber: old } }
        const s: Subscriber = { ...old, name: chat.name || old.name, type: chat.type, active: true }
        if (chat.username) s.username = chat.username
        delete s.disabledBy
        const next = [...list]
        next[i] = s
        return { list: next, result: { kind: old.active ? 'already' : 'reactivated', subscriber: s } }
      }
      if (list.length >= MAX_SUBSCRIBERS) return { list, result: { kind: 'full' } }
      const s: Subscriber = { ...chat, addedAt: now.toISOString(), source: 'start', active: true }
      if (!chat.username) delete s.username
      return { list: [...list, s], result: { kind: 'added', subscriber: s } }
    })
  }

  addManual(chat: ChatInfo, now = new Date()): Promise<Subscriber> {
    return this.change((list) => {
      if (list.some((s) => s.chatId === chat.chatId)) throw new SubscriberError("Bu chat ID ro'yxatda allaqachon bor", 409)
      if (list.length >= MAX_SUBSCRIBERS) throw new SubscriberError(`Ro'yxat to'la (${MAX_SUBSCRIBERS} ta): keraksizlarini o'chiring`, 409)
      const s: Subscriber = { ...chat, addedAt: now.toISOString(), source: 'manual', active: true }
      if (!chat.username) delete s.username
      return { list: [...list, s], result: s }
    })
  }

  /** Admin edit. Switching off is sticky (`disabledBy: 'admin'`); switching on clears the reason. */
  patch(chatId: string, p: { active?: boolean; name?: string }): Promise<Subscriber> {
    return this.change((list) => {
      const i = list.findIndex((s) => s.chatId === chatId)
      if (i < 0) throw new SubscriberError('Obunachi topilmadi', 404)
      const s: Subscriber = { ...list[i]! }
      if (p.name !== undefined) s.name = p.name
      if (p.active === true) {
        s.active = true
        delete s.disabledBy
      } else if (p.active === false) {
        s.active = false
        s.disabledBy = 'admin'
      }
      const next = [...list]
      next[i] = s
      return { list: next, result: s }
    })
  }

  /** /stop, bot blocked or kicked, sending failed. Never overrides an admin decision. */
  deactivate(chatId: string, by: 'user' | 'telegram'): Promise<boolean> {
    return this.change((list) => {
      const i = list.findIndex((s) => s.chatId === chatId)
      if (i < 0 || !list[i]!.active) return { list, result: false }
      const next = [...list]
      next[i] = { ...list[i]!, active: false, disabledBy: by }
      return { list: next, result: true }
    })
  }

  /** Group upgraded to a supergroup: Telegram gives it a new ID. */
  migrate(from: string, to: string): Promise<boolean> {
    return this.change((list) => {
      const i = list.findIndex((s) => s.chatId === from)
      if (i < 0 || list.some((s) => s.chatId === to)) return { list, result: false }
      const next = [...list]
      next[i] = { ...list[i]!, chatId: to, type: 'supergroup' }
      return { list: next, result: true }
    })
  }

  remove(chatId: string): Promise<void> {
    return this.change((list) => {
      const next = list.filter((s) => s.chatId !== chatId)
      if (next.length === list.length) throw new SubscriberError('Obunachi topilmadi', 404)
      return { list: next, result: undefined }
    })
  }

  /** Replace the whole list (admin PUT). Known chat IDs keep `addedAt`/`source`; new ones are `manual`. */
  replaceAll(items: (ChatInfo & { active: boolean })[], now = new Date()): Promise<Subscriber[]> {
    return this.change((list) => {
      if (items.length > MAX_SUBSCRIBERS) throw new SubscriberError(`Ro'yxat juda katta (maks. ${MAX_SUBSCRIBERS} ta)`, 409)
      const byId = new Map(list.map((s) => [s.chatId, s]))
      const seen = new Set<string>()
      const next: Subscriber[] = []
      for (const it of items) {
        if (seen.has(it.chatId)) continue
        seen.add(it.chatId)
        const old = byId.get(it.chatId)
        const s: Subscriber = {
          chatId: it.chatId,
          name: it.name,
          type: it.type,
          addedAt: old?.addedAt ?? now.toISOString(),
          source: old?.source ?? 'manual',
          active: it.active,
        }
        const username = it.username ?? old?.username
        if (username) s.username = username
        if (!it.active) s.disabledBy = old && !old.active && old.disabledBy ? old.disabledBy : 'admin'
        next.push(s)
      }
      return { list: next, result: next }
    })
  }
}
