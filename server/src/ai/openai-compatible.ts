import { errMsg, registerSecret } from '../log.js'
import type { FetchLike } from '../telegram.js'
import { AI_TIMEOUT_MS, AiError, REFUSAL_REPLY, type AiProvider, type ChatRequest, type ChatResult } from './types.js'

type Options = {
  name: 'openai' | 'free'
  /** Full chat-completions URL, e.g. https://api.openai.com/v1/chat/completions */
  endpoint: string
  model: string
  apiKey?: string
  fetchImpl?: FetchLike
}

type CompletionResponse = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]
  error?: { message?: string } | string
}

/** Any OpenAI-compatible /chat/completions endpoint (OpenAI, Groq, OpenRouter, Gemini, Pollinations …). */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: 'openai' | 'free'
  readonly model: string
  private readonly fetchImpl: FetchLike

  constructor(private readonly opts: Options) {
    this.name = opts.name
    this.model = opts.model
    this.fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i))
    registerSecret(opts.apiKey)
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const system = req.context ? `${req.system}\n\n${req.context}` : req.system
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`
    let res: Response
    try {
      res = await this.fetchImpl(this.opts.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          max_tokens: 700,
          messages: [{ role: 'system', content: system }, ...req.messages],
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      })
    } catch (e) {
      const name = (e as Error)?.name
      if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout', `${this.name}: javob kutish vaqti tugadi`)
      throw new AiError('unavailable', `${this.name}: ulanish xatosi: ${errMsg(e)}`)
    }

    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 || res.status === 402 ? 'rate_limit' : res.status === 400 ? 'bad_request' : 'unavailable'
      throw new AiError(kind, `${this.name}: HTTP ${res.status} ${errMsg(body)}`)
    }
    let data: CompletionResponse
    try {
      data = (await res.json()) as CompletionResponse
    } catch {
      throw new AiError('unavailable', `${this.name}: javob JSON emas`)
    }
    const choice = data.choices?.[0]
    if (choice?.message?.refusal) return { text: REFUSAL_REPLY[req.lang], refused: true }
    const text = choice?.message?.content?.trim()
    if (!text) throw new AiError('unavailable', `${this.name}: bo'sh javob`)
    return { text }
  }
}
