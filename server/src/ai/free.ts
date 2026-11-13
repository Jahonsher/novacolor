import type { FetchLike } from '../telegram.js'
import { OpenAiCompatibleProvider } from './openai-compatible.js'

/** Keyless test provider (Pollinations). Low quality; data goes to a third party — for testing only. */
export const FREE_ENDPOINT = 'https://text.pollinations.ai/openai'

export const createFreeProvider = (model: string, fetchImpl?: FetchLike) =>
  new OpenAiCompatibleProvider({ name: 'free', endpoint: FREE_ENDPOINT, model, fetchImpl })
