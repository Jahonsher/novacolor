export type Lang = 'uz' | 'ru'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export type ChatRequest = {
  /** Stable, cacheable part of the system prompt (catalog + rules). */
  system: string
  /** Small per-request additions (current page, lead captured …), placed after the stable part. */
  context?: string
  messages: ChatTurn[]
  lang: Lang
}

export type ChatResult = { text: string; refused?: boolean }

export interface AiProvider {
  readonly name: 'anthropic' | 'openai' | 'free' | 'mock'
  readonly model: string
  chat(req: ChatRequest): Promise<ChatResult>
}

export type AiErrorKind = 'auth' | 'rate_limit' | 'timeout' | 'bad_request' | 'unavailable'

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message)
  }
}

export const AI_TIMEOUT_MS = 25_000

export const REFUSAL_REPLY: Record<Lang, string> = {
  uz: "Kechirasiz, bu savolga javob bera olmayman. Novacolor dekorativ qoplamalari bo'yicha savollaringiz bo'lsa, mamnuniyat bilan yordam beraman.",
  ru: 'Извините, на этот вопрос я ответить не могу. С радостью помогу с вопросами о декоративных покрытиях Novacolor.',
}
