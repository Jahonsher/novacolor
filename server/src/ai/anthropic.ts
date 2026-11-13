import Anthropic from '@anthropic-ai/sdk'
import { errMsg, log, registerSecret } from '../log.js'
import { AI_TIMEOUT_MS, AiError, REFUSAL_REPLY, type AiProvider, type ChatRequest, type ChatResult } from './types.js'

/**
 * Models that support server-side refusal fallbacks (beta `server-side-fallback-2026-07-01`).
 * Others — e.g. claude-haiku-5-5 — have none, and the request would be rejected if we sent the params.
 */
export const FALLBACK_MODELS: ReadonlySet<string> = new Set([
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
])

/** Claude via the official SDK. Server-side refusal fallbacks are enabled where the model supports them. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const
  private client: Anthropic

  constructor(
    apiKey: string,
    readonly model: string,
    client?: Anthropic,
  ) {
    registerSecret(apiKey)
    this.client = client ?? new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 })
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }))
    // Stable catalog prompt first, with its own cache breakpoint; volatile context after it.
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
    ]
    if (req.context) system.push({ type: 'text', text: req.context })

    let response: Anthropic.Beta.BetaMessage
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 1024,
          system,
          messages,
          output_config: { effort: 'low' },
          cache_control: { type: 'ephemeral' },
          ...(FALLBACK_MODELS.has(this.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { timeout: AI_TIMEOUT_MS },
      )
    } catch (e) {
      throw mapError(e)
    }

    if (response.stop_reason === 'refusal') {
      log.warn(`Claude so'rovni rad etdi (kategoriya: ${response.stop_details?.category ?? 'noma’lum'})`)
      return { text: REFUSAL_REPLY[req.lang], refused: true }
    }
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()
    if (response.stop_reason === 'max_tokens') log.warn('Claude javobi max_tokens bilan kesildi')
    if (!text) throw new AiError('unavailable', `Claude bo'sh javob qaytardi (stop_reason: ${response.stop_reason})`)
    return { text }
  }
}

function mapError(e: unknown): AiError {
  // Most specific first.
  if (e instanceof Anthropic.AuthenticationError) return new AiError('auth', 'Claude: API kaliti noto‘g‘ri (401)')
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('auth', 'Claude: ruxsat yo‘q (403)')
  if (e instanceof Anthropic.RateLimitError) return new AiError('rate_limit', 'Claude: so‘rovlar limiti (429)')
  if (e instanceof Anthropic.BadRequestError) return new AiError('bad_request', `Claude: noto‘g‘ri so‘rov (400): ${errMsg(e)}`)
  if (e instanceof Anthropic.NotFoundError) return new AiError('bad_request', `Claude: model topilmadi (404): ${errMsg(e)}`)
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiError('timeout', 'Claude: javob kutish vaqti tugadi')
  if (e instanceof Anthropic.APIConnectionError) return new AiError('unavailable', `Claude: ulanish xatosi: ${errMsg(e)}`)
  if (e instanceof Anthropic.APIError) return new AiError('unavailable', `Claude: API xatosi ${e.status ?? ''}: ${errMsg(e)}`)
  return new AiError('unavailable', `Claude: ${errMsg(e)}`)
}
