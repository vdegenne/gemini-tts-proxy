import {
	getCacheKey,
	type GeminiSpeechOptions,
	type GeminiTtsVoice,
} from './core.js'

export interface GeminiAuthHeaders {
	Authorization?: `Bearer ${string}`
	'x-goog-api-key'?: string
}

export interface GeminiFetchOptions {
	headers?: Record<string, string> & GeminiAuthHeaders
}

export interface GeminiTtsVoiceInfo {
	id: GeminiTtsVoice
	name: string
}

export interface AudioRequest {
	key: string
	audio: () => Promise<Blob>
}

type CachedAudio = Blob | Promise<Blob>

export class GeminiTtsProxyClient {
	endpoint: string

	voices: GeminiTtsVoiceInfo[] = []

	private cache = new Map<string, CachedAudio>()

	constructor({
		endpoint = 'http://127.0.0.1:3000',
	}: {
		endpoint?: string
	} = {}) {
		this.endpoint = endpoint.replace(/\/+$/, '')
	}

	async getAudio(
		options: GeminiSpeechOptions,
		fetchOptions: GeminiFetchOptions = {},
	): Promise<Blob> {
		const key = await getCacheKey(options)

		return this.getCachedAudio(key, options, fetchOptions)
	}

	async createAudioRequest(
		options: GeminiSpeechOptions,
		fetchOptions: GeminiFetchOptions = {},
	): Promise<AudioRequest> {
		const key = await getCacheKey(options)

		return {
			key,
			audio: () => this.getCachedAudio(key, options, fetchOptions),
		}
	}

	private async getCachedAudio(
		key: string,
		options: GeminiSpeechOptions,
		fetchOptions: GeminiFetchOptions,
	): Promise<Blob> {
		const cached = this.cache.get(key)

		if (cached) {
			return cached
		}

		const promise = this.fetchAudio(options, fetchOptions)
		this.cache.set(key, promise)

		try {
			const blob = await promise
			this.cache.set(key, blob)
			return blob
		} catch (error) {
			this.cache.delete(key)
			throw error
		}
	}

	protected async fetchAudio(
		options: GeminiSpeechOptions,
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
}
