#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'

import { type HttpBindings, serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { ApiError } from '@google/genai'
import { AccessError, resolveApiKey } from './access.js'
import { isFirebaseConfigured, isFirebaseInitialized } from './auth.js'
import { getCacheSnapshot, getSpeech } from './cache.js'
import { config } from './config.js'
import {
	GEMINI_TTS_MODELS,
	GEMINI_TTS_VOICES,
	type GeminiTtsModel,
} from './core.js'
import { checkFFmpeg } from './ffmpeg.js'
import { closeStats, getStatsSnapshot } from './stats.js'

let ffmpegInfo: Awaited<ReturnType<typeof checkFFmpeg>>

try {
	ffmpegInfo = await checkFFmpeg()
} catch (error) {
	console.error('\nFFmpeg validation failed.')
	console.error(error instanceof Error ? error.message : error)
	console.error(
		'Please install FFmpeg 4.4 or newer with libmp3lame support and make sure it is available in PATH.',
	)
	process.exit(1)
}

function getApiErrorMessage(error: ApiError): string {
	try {
		const response = JSON.parse(error.message) as {
			error?: { message?: unknown }
		}

		const nestedMessage = response.error?.message

		if (typeof nestedMessage !== 'string') {
			return error.message
		}

		try {
			const googleError = JSON.parse(nestedMessage) as {
				error?: { message?: unknown }
			}

			const message = googleError.error?.message

			return typeof message === 'string' ? message : nestedMessage
		} catch {
			return nestedMessage
		}
	} catch {
		return error.message
	}
}

const app = new Hono<{ Bindings: HttpBindings }>()

const rateLimits = new Map<string, number[]>()

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW = 60_000

function checkRateLimit(ip: string): boolean {
	const now = Date.now()
	const timestamps = rateLimits.get(ip) ?? []

	const recentTimestamps = timestamps.filter(
		(timestamp) => now - timestamp < RATE_LIMIT_WINDOW,
	)

	if (recentTimestamps.length >= RATE_LIMIT_MAX) {
		rateLimits.set(ip, recentTimestamps)
		return false
	}

	recentTimestamps.push(now)
	rateLimits.set(ip, recentTimestamps)

	return true
}

app.use(
	'*',
	cors({
		origin: [
			'http://localhost:35107',
			'https://glaizme.web.app',
			'https://gl-ai-z.win',
		],
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization', 'x-goog-api-key'],
	}),
)

app.get('/health', (c) => {
	return c.json({ status: 'ok' })
})

app.get('/v1/voices', (c) => {
	return c.json({
		voices: GEMINI_TTS_VOICES.map(function (voice) {
			return {
				id: voice,
				name: voice,
			}
		}),
	})
})

app.get('/v1/audio/speech', async (c) => {
	const input = c.req.query('input')
	const model = c.req.query('model')
	const voice = c.req.query('voice')
	const languageCode = c.req.query('languageCode')
	const systemInstruction = c.req.query('systemInstruction')

	if (
		!input?.trim() ||
		!model?.trim() ||
		!voice?.trim() ||
		!languageCode?.trim()
	) {
		return c.json(
			{
				error: 'input, model, voice and languageCode must be non-empty strings',
			},
			400,
		)
	}

	if (!GEMINI_TTS_MODELS.includes(model as GeminiTtsModel)) {
		return c.json(
			{
				error: `Unsupported model. Supported models: ${GEMINI_TTS_MODELS.join(', ')}`,
			},
			400,
		)
	}

	let apiKey: string

	try {
		apiKey = await resolveApiKey(
			c.req.header('x-goog-api-key'),
			c.req.header('Authorization'),
		)
	} catch (error) {
		if (error instanceof AccessError) {
			return c.json({ error: error.message }, error.status as 401 | 403)
		}

		throw error
	}

	const ip =
		c.req.header('CF-Connecting-IP') ??
		c.env.incoming.socket.remoteAddress ??
		'unknown'

	if (!checkRateLimit(ip)) {
		return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429)
	}

	try {
		const audio = await getSpeech({
			input,
			model: model as GeminiTtsModel,
			voice,
			languageCode,
			systemInstruction,
			apiKey,
		})

		const stream =
			audio.body instanceof Readable
				? Readable.toWeb(audio.body)
				: Readable.toWeb(Readable.from([audio.body]))

		return new Response(stream as globalThis.ReadableStream<Uint8Array>, {
			headers: {
				'content-type': 'audio/mpeg',
				'content-length': String(audio.size),
				'cache-control': 'private, max-age=31536000, immutable',
			},
		})
	} catch (error) {
		console.error('Speech synthesis failed:', error)

		if (error instanceof ApiError) {
			const status =
				error.status >= 400 && error.status <= 599 ? error.status : 502

			return c.json({ error: getApiErrorMessage(error) }, status as 400)
		}

		return c.json({ error: 'Internal server error' }, 500)
	}
})

app.post('/v1/audio/speech', async (c) => {
	return c.json({ error: 'POST endpoint temporarily disabled' }, 410)
	// let body: unknown
	//
	// try {
	// 	body = await c.req.json()
	// } catch {
	// 	return c.json({ error: 'Invalid JSON body' }, 400)
	// }
	//
	// if (body === null || typeof body !== 'object' || Array.isArray(body)) {
	// 	return c.json({ error: 'Expected a JSON object' }, 400)
	// }
	//
	// const input = body as Record<string, unknown>
	//
	// if (
	// 	typeof input.input !== 'string' ||
	// 	input.input.trim().length === 0 ||
	// 	typeof input.voice !== 'string' ||
	// 	input.voice.trim().length === 0
	// ) {
	// 	return c.json({ error: 'input and voice must be non-empty strings' }, 400)
	// }
	//
	// const speed = input.speed ?? 1
	// const volumeMultiplier = input.volume_multiplier ?? 1
	//
	// if (
	// 	typeof speed !== 'number' ||
	// 	!Number.isFinite(speed) ||
	// 	speed <= 0 ||
	// 	typeof volumeMultiplier !== 'number' ||
	// 	!Number.isFinite(volumeMultiplier) ||
	// 	volumeMultiplier <= 0
	// ) {
	// 	return c.json(
	// 		{ error: 'speed and volume_multiplier must be positive numbers' },
	// 		400,
	// 	)
	// }
	//
	// if (requiresPremium(input.input, input.voice)) {
	// 	const authorization = c.req.header('Authorization')
	//
	// 	if (!authorization?.startsWith('Bearer ')) {
	// 		return c.json({ error: 'Authentication required' }, 401)
	// 	}
	//
	// 	try {
	// 		const isPremium = await verifyPremiumUser(authorization.slice(7))
	//
	// 		if (!isPremium) {
	// 			return c.json({ error: 'Premium subscription required' }, 403)
	// 		}
	// 	} catch {
	// 		return c.json({ error: 'Invalid authentication token' }, 401)
	// 	}
	// }
	// try {
	// 	const audio = await getSpeech({
	// 		input: input.input,
	// 		voice: input.voice,
	// 		speed,
	// 		volume_multiplier: volumeMultiplier,
	// 	})
	//
	// 	const stream =
	// 		audio.body instanceof Readable
	// 			? Readable.toWeb(audio.body)
	// 			: Readable.toWeb(Readable.from([audio.body]))
	//
	// 	return new Response(stream as globalThis.ReadableStream<Uint8Array>, {
	// 		headers: {
	// 			'content-type': 'audio/mpeg',
	// 			'content-length': String(audio.size),
	// 			'cache-control': 'no-store',
	// 		},
	// 	})
	// } catch (error) {
	// 	console.error('Speech synthesis failed:', error)
	//
	// 	return c.json({ error: 'Speech synthesis failed' }, 502)
	// }
})

app.get('/debug', async (c) => {
	if (!config.debugToken) {
		return c.notFound()
	}

	if (c.req.header('x-debug-token') !== config.debugToken) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const now = Date.now()

	const clients = Array.from(rateLimits.entries())
		.map(function ([ip, timestamps]) {
			const recent = timestamps.filter(
				(timestamp) => now - timestamp < RATE_LIMIT_WINDOW,
			)

			return {
				ip,
				requestCount: recent.length,
				remaining: Math.max(0, RATE_LIMIT_MAX - recent.length),
			}
		})
		.filter(function (client) {
			return client.requestCount > 0
		})

	return c.json({
		server: {
			uptime: process.uptime(),
			nodeVersion: process.version,
			memoryUsage: process.memoryUsage(),
		},
		rateLimits: {
			maxRequests: RATE_LIMIT_MAX,
			windowMs: RATE_LIMIT_WINDOW,
			clients,
		},
		cache: getCacheSnapshot(),
		stats: await getStatsSnapshot(),
		firebase: {
			serviceAccountFound: isFirebaseConfigured(),
			adminInitialized: isFirebaseInitialized(),
		},
	})
})

const server = serve({
	fetch: app.fetch,
	hostname: config.host,
	port: config.port,
})

const serviceAccountFound = isFirebaseConfigured()
const apiKeyLoaded = Boolean(config.apiKey)

const { version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }

console.log(`
##################################################
#               Gemini TTS Proxy                 #
##################################################
# Version:           ${version}
# Server:            http://${config.host}:${config.port}
# Cache:             ${config.cacheDir}
# FFmpeg:            ${ffmpegInfo.version}
#
# Gemini API key:    ${apiKeyLoaded ? 'Loaded' : 'Missing'}
# Service account:   ${
	serviceAccountFound ? 'File found' : '\x1B[31mMissing\x1B[0m'
}
# Firebase Admin:    Lazy initialization
##################################################
`)

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
	if (shuttingDown) return
	shuttingDown = true

	console.log(`\nReceived ${signal}. Shutting down Gemini TTS Proxy...`)

	server.close()

	try {
		await closeStats()
		console.log('Usage stats flushed successfully.')
	} catch (error) {
		console.error('Failed to flush usage stats:', error)
		process.exitCode = 1
	}

	console.log('Gemini TTS Proxy stopped.')
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

export { app }
