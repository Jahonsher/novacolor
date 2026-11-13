import type { AiProvider, ChatRequest, ChatResult } from './types.js'

/**
 * Deterministic offline provider for end-to-end tests (`AI_PROVIDER=mock`).
 * Refused by loadConfig when NODE_ENV=production. Never calls the network.
 */
export class MockProvider implements AiProvider {
  readonly name = 'mock' as const
  readonly model = 'mock'

  async chat(req: ChatRequest): Promise<ChatResult> {
    const last = req.messages.at(-1)?.content ?? ''
    if (/mock:fail/i.test(last)) throw new Error('mock failure')
    const leadNote = req.context?.includes('phone number') ? true : false
    const text =
      req.lang === 'ru'
        ? `Рекомендую **Teodorico** — декоративная штукатурка с эффектом камня: /products/teodorico${leadNote ? '\nМенеджер скоро свяжется с вами.' : ''}`
        : `Sizga **Teodorico** ni tavsiya qilaman — tosh effektli dekorativ suvoq: /products/teodorico${leadNote ? '\nMenejerimiz tez orada bog‘lanadi.' : ''}`
    return { text }
  }
}
