/**
 * Phone / name detection in chat messages.
 * Accepts Uzbek numbers (+998 XX XXX XX XX, 998XXXXXXXXX, 9-digit local "90 1234567")
 * and generic international numbers of 7–15 digits.
 */
const CANDIDATE = /(?:\+\s?)?\(?\d[\d\s().-]{5,24}\d/g

const formatUz = (nine: string) =>
  `+998 ${nine.slice(0, 2)} ${nine.slice(2, 5)} ${nine.slice(5, 7)} ${nine.slice(7, 9)}`

export function detectPhone(text: string): string | null {
  for (const m of text.matchAll(CANDIDATE)) {
    const raw = m[0].trim()
    // Skip things that look like dates, decimals or year ranges: 12.05.2024, 2016-2020
    if (/\d\.\d/.test(raw) || /^\d{4}\s*[-–]\s*\d{4}$/.test(raw)) continue
    const digits = raw.replace(/\D/g, '')
    const plus = raw.startsWith('+')
    if (digits.length === 12 && digits.startsWith('998')) return formatUz(digits.slice(3))
    if (digits.length === 9 && !plus) return formatUz(digits)
    if (digits.length >= 7 && digits.length <= 15) return plus ? `+${digits}` : raw.replace(/\s+/g, ' ')
  }
  return null
}

const NAME_WORD = "[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳʻʼ'`-]{2,30}"
const NAME_PATTERNS = [
  new RegExp(`(?:mening\\s+ismim|ismim|исмим|меня\\s+зовут|мое\\s+имя|моё\\s+имя|my\\s+name\\s+is)\\s*[:\\-–]?\\s*(${NAME_WORD})`, 'iu'),
  new RegExp(`(?:^|[\\s,.!])(?:men|я)\\s+(${NAME_WORD})(?:\\s+(?:bo['ʻ‘’]?laman|man)\\b|\\s*,?\\s*\\+?\\(?\\d)`, 'iu'),
  new RegExp(`(?:ism|имя)\\s*[:\\-–]\\s*(${NAME_WORD})`, 'iu'),
  // "Alisher, +998 90 123 45 67" / "Alisher 901234567"
  new RegExp(`^\\s*(${NAME_WORD})\\s*[,:;\\-–]?\\s*\\+?\\(?\\d`, 'u'),
]
const NOT_NAMES = new Set(['telefon', 'tel', 'raqam', 'raqamim', 'nomer', 'номер', 'телефон', 'тел', 'mening', 'menga', 'salom', 'привет', 'здравствуйте', 'assalomu'])

export function detectName(text: string): string | null {
  for (const re of NAME_PATTERNS) {
    const m = text.match(re)
    const name = m?.[1]
    if (name && !NOT_NAMES.has(name.toLowerCase())) return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return null
}
