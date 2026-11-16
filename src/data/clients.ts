import data from './clients.json'
import type { Localized } from '.'

/**
 * Names and short descriptions for the client logos (content.json `clients` holds only the image paths,
 * so logos added later through the admin panel still show — just without a caption).
 * The data lives in clients.json, keyed by the logo's file name; the server's AI consultant reads the
 * same file, so edit it there.
 */
export type SectorKey = 'dev' | 'bank' | 'food' | 'retail' | 'industry'
export type ClientInfo = { name: string; sector: SectorKey; about: Localized }

export const sectors = data.sectors as Record<SectorKey, { name: Localized; text: Localized }>
const info = data.clients as Record<string, ClientInfo>

export const clientInfo = (path: string): ClientInfo | undefined => info[path.split('/').pop() ?? '']
