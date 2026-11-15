import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { GoogleGenAI } from '@google/genai'

import { config } from './config.js'
import { getAudioPath, getCacheKey, type GeminiSpeechOptions } from './core.js'
import { encodePcmToMp3 } from './ffmpeg.js'
import { recordUsage } from './stats.js'

export interface CachedAudio {
	body: Buffer | Readable
	size: number
}

interface MemoryEntry {
	data: Buffer
}

interface PcmFormat {
	sampleRate: number
	bitsPerSample: number
	channels: number
}

const memoryCache = new Map<string, MemoryEntry>()
const inFlight = new Map<string, Promise<void>>()

let memoryCacheSize = 0

export function getDiskPath(hash: string): string {
	return join(config.cacheDir, getAudioPath(hash))
}

function getMemory(hash: string): Buffer | undefined {
	const entry = memoryCache.get(hash)

	if (!entry) return undefined

	// Refresh insertion order to implement LRU.
	memoryCache.delete(hash)
	memoryCache.set(hash, entry)

	return entry.data
}

function setMemory(hash: string, data: Buffer): void {
	if (data.length > config.memoryCacheMaxBytes) return

	const previous = memoryCache.get(hash)

	if (previous) {
		memoryCacheSize -= previous.data.length
		memoryCache.delete(hash)
	}

	while (memoryCacheSize + data.length > config.memoryCacheMaxBytes) {
		const oldest = memoryCache.keys().next().value as string | undefined

		if (oldest === undefined) break

		const entry = memoryCache.get(oldest)!

		memoryCacheSize -= entry.data.length
		memoryCache.delete(oldest)
	}

	memoryCache.set(hash, { data })
	memoryCacheSize += data.length
}

async function getDiskAudio(hash: string): Promise<CachedAudio | undefined> {
	const path = getDiskPath(hash)

	let fileSize: number

	try {
		fileSize = (await stat(path)).size
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined
		}

		throw error
	}

	if (fileSize <= config.memoryCacheMaxBytes) {
		const data = await readFile(path)
		setMemory(hash, data)

		return { body: data, size: data.length }
	}

	return {
		body: createReadStream(path),
		size: fileSize,
	}
}

async function synthesize(
	options: GeminiSpeechOptions,
	hash: string,
	apiKey: string,
): Promise<void> {
	const path = getDiskPath(hash)
	const directory = join(path, '..')
	const tempPath = `${path}.${randomUUID()}.tmp`

	if (!apiKey) {
		throw new Error('No Gemini API key was provided')
	}

	await mkdir(directory, { recursive: true })

	try {
		const ai = new GoogleGenAI({
			apiKey,
			httpOptions: {
				apiVersion: 'v1beta',
			},
		})

		const chunks: Buffer[] = []
		let pcmFormat: PcmFormat | undefined

		function addPcmChunk(
			data: string,
			mimeType: string,
			sampleRate?: number,
			channels?: number,
		): void {
			const match = mimeType.match(/^audio\/L(\d+)(?:;rate=(\d+))?/i)

			if (!match) {
				throw new Error(`Unsupported Gemini audio format: ${mimeType}`)
			}

			const format: PcmFormat = {
				bitsPerSample: Number(match[1]),
				sampleRate: sampleRate ?? Number(match[2] ?? 24000),
				channels: channels ?? 1,
			}

			if (format.bitsPerSample !== 16) {
				throw new Error(`Unsupported PCM bit depth: ${format.bitsPerSample}`)
			}

			if (pcmFormat) {
				if (
					pcmFormat.sampleRate !== format.sampleRate ||
					pcmFormat.bitsPerSample !== format.bitsPerSample ||
					pcmFormat.channels !== format.channels
				) {
					throw new Error('Gemini returned inconsistent audio formats')
				}
			} else {
				pcmFormat = format
			}

			chunks.push(Buffer.from(data, 'base64'))
		}

		if (options.model.startsWith('gemini-3.8-')) {
			const response = await ai.interactions.create({
				model: options.model,
				input: [
					{
						type: 'user_input',
						content: [
							{
								type: 'text',
								text: options.input,
								annotations: options.systemInstruction
									? [
											{
												type: 'speech_metadata',
												style: options.systemInstruction,
											},
										]
									: undefined,
							},
						],
					},
				],
				response_format: {
					type: 'audio',
					mime_type: 'audio/l16',
					sample_rate: 24000,
				},
				generation_config: {
					speech_config: [
						{
							voice: options.voice,
						},
					],
				},
				stream: true,
			})

			for await (const event of response) {
				if (event.event_type !== 'step.delta') continue

				const delta = event.delta

				if (delta.type !== 'audio' || !delta.data) continue

				addPcmChunk(
					delta.data,
					delta.mime_type ?? 'audio/l16',
					delta.sample_rate ?? 24000,
					delta.channels ?? 1,
				)
			}
		} else {
			const response = await ai.models.generateContentStream({
				model: options.model,
				contents: [
					{
						role: 'user',
						parts: [
							{
								text: options.systemInstruction
									? `${options.systemInstruction}\n\n${options.input}`
									: options.input,
							},
						],
					},
				],
				config: {
					responseModalities: ['AUDIO'],
					speechConfig: {
						...(options.languageCode
							? { languageCode: options.languageCode }
							: {}),
						voiceConfig: {
							voice: options.voice,
						},
					},
				},
			})

			for await (const chunk of response) {
				const parts = chunk.candidates?.[0]?.content?.parts ?? []

				for (const part of parts) {
					const inlineData = part.inlineData

					if (!inlineData?.data) continue

					addPcmChunk(inlineData.data, inlineData.mimeType ?? '')
				}
			}
		}

		if (chunks.length === 0 || !pcmFormat) {
			throw new Error('Gemini returned no audio data')
		}

		await encodePcmToMp3(Buffer.concat(chunks), tempPath, pcmFormat)

		await rename(tempPath, path)

		const fileSize = (await stat(path)).size

		if (fileSize <= config.memoryCacheMaxBytes) {
			try {
				setMemory(hash, await readFile(path))
			} catch {
				// The disk cache remains usable if memory caching fails.
			}
		}
	} finally {
		await unlink(tempPath).catch(() => {})
	}
}

export async function getSpeech(
	options: GeminiSpeechOptions,
	apiKey: string,
): Promise<CachedAudio> {
	const hash = await getCacheKey(options)

	let audio = getMemory(hash)

	if (audio) {
		recordUsage(hash)
		return { body: audio, size: audio.length }
	}

	const cached = await getDiskAudio(hash)

	if (cached) {
		recordUsage(hash)
		return cached
	}

	let pending = inFlight.get(hash)

	if (!pending) {
		pending = synthesize(options, hash, apiKey)
		inFlight.set(hash, pending)

		void pending.then(
			() => {
				if (inFlight.get(hash) === pending) {
					inFlight.delete(hash)
				}
			},
			() => {
				if (inFlight.get(hash) === pending) {
					inFlight.delete(hash)
				}
			},
		)
	}

	await pending

	audio = getMemory(hash)

	if (audio) {
		recordUsage(hash)
		return { body: audio, size: audio.length }
	}

	const result = await getDiskAudio(hash)

	if (!result) {
		throw new Error('Audio was generated but is missing from the disk cache')
	}

	recordUsage(hash)
	return result
}

export function getCacheSnapshot() {
	return {
		memory: {
			entries: memoryCache.size,
			sizeBytes: memoryCacheSize,
			maxSizeBytes: config.memoryCacheMaxBytes,
			inFlight: inFlight.size,
		},
	}
}
