import { resolve } from 'node:path'

import 'dotenv/config'

function getPositiveInteger(name: string, fallback: number): number {
	const value = process.env[name]

	if (value === undefined) return fallback

	const parsed = Number(value)

	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`)
	}

	return parsed
}

const mib = 1024 * 1024

export const config = {
	host: process.env.HOST ?? '127.0.0.1',
	port: getPositiveInteger('PORT', 3000),

	apiKey: process.env.GEMINI_API_KEY,

	serviceAccountPath: resolve(
		process.env.FIREBASE_SERVICE_ACCOUNT ?? 'serviceAccountKey.json',
	),

	cacheDir: resolve(process.env.CACHE_DIR ?? 'data/gemini'),

	memoryCacheMaxBytes: getPositiveInteger('MEMORY_CACHE_MAX_BYTES', 100 * mib),

	statsFlushIntervalMs: getPositiveInteger('STATS_FLUSH_INTERVAL_MS', 30_000),

	debugToken: process.env.DEBUG_TOKEN,
} as const
