/** GET /api/health — the chat widget asks whether the AI consultant is on (see api/ai/chat.ts). */
import { aiAvailable } from './ai/chat.js'
import { json } from './_shared.js'

export function GET() {
  return json({ ok: true, ai: aiAvailable() })
}
