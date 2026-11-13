/** Minimal logger. Never pass secrets here; `redact()` masks known secret values just in case. */
const secrets = new Set<string>()
let silent = process.env.LOG_LEVEL === 'silent'

export function registerSecret(value: string | undefined) {
  if (value && value.length >= 6) secrets.add(value)
}

export function setSilent(v: boolean) {
  silent = v
}

export function redact(s: string): string {
  let out = s
  for (const v of secrets) out = out.split(v).join('***')
  return out
}

function write(level: 'info' | 'warn' | 'error', msg: string) {
  if (silent) return
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redact(msg)}`
  if (level === 'info') console.log(line)
  else console.error(line)
}

export const log = {
  info: (msg: string) => write('info', msg),
  warn: (msg: string) => write('warn', msg),
  error: (msg: string) => write('error', msg),
}

export const errMsg = (e: unknown) => redact(e instanceof Error ? e.message : String(e))
