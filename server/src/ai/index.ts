import type { Config } from '../config.js'
import { AnthropicProvider } from './anthropic.js'
import { createFreeProvider } from './free.js'
import { MockProvider } from './mock.js'
import { OpenAiCompatibleProvider } from './openai-compatible.js'
import type { AiProvider } from './types.js'

/** Build the configured provider; `null` = AI disabled (off, or the required key is missing). */
export function createProvider(cfg: Config['ai']): AiProvider | null {
  switch (cfg.provider) {
    case 'anthropic':
      return cfg.anthropicKey ? new AnthropicProvider(cfg.anthropicKey, cfg.model) : null
    case 'openai':
      return cfg.apiKey
        ? new OpenAiCompatibleProvider({
            name: 'openai',
            endpoint: `${cfg.baseUrl}/chat/completions`,
            model: cfg.model,
            apiKey: cfg.apiKey,
          })
        : null
    case 'free':
      return createFreeProvider(cfg.model)
    case 'mock':
      return new MockProvider()
    case 'off':
      return null
  }
}

export * from './types.js'
