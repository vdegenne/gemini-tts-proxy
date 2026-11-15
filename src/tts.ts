import {
	getCacheKey,
	type GeminiSpeechOptions,
	type GeminiTtsVoice,
} from './core.js'

export interface GeminiRequestOptions extends GeminiSpeechOptions {}

export interface GeminiAuthHeaders {
	Authorization?: `Bearer ${string}`
	'x-goog-api-key'?: string
}

export interface GeminiFetchOptions {
	headers?: HeadersInit & GeminiAuthHeaders
}

export interface GeminiTtsVoiceInfo {
	id: GeminiTtsVoice
	name: string
}

type CachedAudio = Blob | Promise<Blob>

export interface AudioRequest {
	key: string
	audio: Promise<Blob>
}

export class GeminiTtsProxyClient {
	endpoint: string

	voices: GeminiTtsVoiceInfo[] = []

	// private voicesPromise: Promise<void> | undefined
	private cache = new Map<string, CachedAudio>()

	constructor({
		endpoint = 'http://127.0.0.1:3000',
	}: {
		endpoint?: string
	} = {}) {
		this.endpoint = endpoint.replace(/\/+$/, '')
	}

	async getAudio(
		options: GeminiRequestOptions,
		fetchOptions: GeminiFetchOptions = {},
	): Promise<AudioRequest> {
		const key = await getCacheKey(options)
		const cached = this.cache.get(key)

		if (cached) {
			return {
				key,
				audio: Promise.resolve(cached),
			}
		}

		const audio = this.fetchAudio(options, fetchOptions)
		this.cache.set(key, audio)

		try {
			const blob = await audio
			this.cache.set(key, blob)

			return {
				key,
				audio: Promise.resolve(blob),
			}
		} catch (error) {
			this.cache.delete(key)
			throw error
		}
	}

	protected async fetchAudio(
		options: GeminiRequestOptions,
		fetchOptions: GeminiFetchOptions,
	): Promise<Blob> {
		const params = new URLSearchParams({
			input: options.input,
			model: options.model,
			voice: options.voice,
		})

		if (options.languageCode) {
			params.set('languageCode', options.languageCode)
		}

		if (options.systemInstruction) {
			params.set('systemInstruction', options.systemInstruction)
		}

		const response = await fetch(`${this.endpoint}/v1/audio/speech?${params}`, {
			headers: new Headers(fetchOptions.headers),
		})

		if (!response.ok) {
			throw new Error(`Gemini TTS synthesis failed: HTTP ${response.status}`)
		}

		return response.blob()
	}

	// private async fetchVoices(): Promise<void> {
	// 	const response = await fetch(`${this.endpoint}/v1/voices`)
	//
	// 	if (!response.ok) {
	// 		throw new Error(
	// 			`Gemini TTS voices request failed: HTTP ${response.status}`,
	// 		)
	// 	}
	//
	// 	const data: { voices: GeminiTtsVoiceInfo[] } = await response.json()
	// 	this.voices = data.voices
	// }

	// private async ensureVoices(): Promise<void> {
	// 	if (this.voices.length > 0) return
	//
	// 	if (!this.voicesPromise) {
	// 		this.voicesPromise = this.fetchVoices().catch((error) => {
	// 			this.voicesPromise = undefined
	// 			throw error
	// 		})
	// 	}
	//
	// 	await this.voicesPromise
	// }

	// async getVoiceTitleFromId(
	// 	voiceId: GeminiTtsVoice,
	// ): Promise<string | undefined> {
	// 	await this.ensureVoices()
	//
	// 	const voice = this.voices.find((voice) => voice.id === voiceId)
	//
	// 	if (voice) {
	// 		return voice.name
	// 	}
	// }
}
