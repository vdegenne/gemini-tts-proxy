import { ReactiveController, state } from '@snar/lit'

import {
	getCacheKey,
	type GeminiSpeechOptions,
	type GeminiTtsVoice,
} from './core.js'

export type ConnectionState =
	'disconnected' | 'connecting' | 'connection_error' | 'connected'

export interface GeminiTtsVoiceInfo {
	id: GeminiTtsVoice
	name: string
}

type CachedAudio = Blob | Promise<Blob>

export interface AudioRequest {
	key: string
	audio: () => Promise<Blob | AudioBuffer>
}

export class GeminiTtsProxyClient extends ReactiveController {
	@state() state: ConnectionState = 'disconnected'
	@state() voices: GeminiTtsVoiceInfo[] = []
	@state() endpoint: string

	private voicesPromise: Promise<void> | undefined
	private cache = new Map<string, CachedAudio>()

	constructor({
		endpoint = 'http://127.0.0.1:3000',
	}: {
		endpoint?: string
	} = {}) {
		super()
		this.endpoint = endpoint.replace(/\/+$/, '')
	}

	async connect({ reconnect = false }: { reconnect?: boolean } = {}) {
		if (this.state === 'connected' && !reconnect) {
			return
		}

		this.state = 'connecting'

		try {
			const response = await fetch(`${this.endpoint}/health`)

			if (!response.ok) {
				throw new Error(
					`Gemini TTS health check failed: HTTP ${response.status}`,
				)
			}

			this.state = 'connected'
		} catch (error) {
			this.state = 'connection_error'
			throw error
		}
	}

	disconnect() {
		this.voices = []
		this.voicesPromise = undefined
		this.state = 'disconnected'
	}

	async getAudio(options: GeminiSpeechOptions): Promise<AudioRequest> {
		if (this.state !== 'connected') {
			throw new Error('Gemini TTS is not connected')
		}

		const key = await getCacheKey(options)
		const cached = this.cache.get(key)

		if (cached) {
			return {
				key,
				audio: function () {
					return Promise.resolve(cached)
				},
			}
		}

		const audio = this.fetchAudio(options)
		this.cache.set(key, audio)

		try {
			const blob = await audio
			this.cache.set(key, blob)

			return {
				key,
				audio: async function () {
					return blob
				},
			}
		} catch (error) {
			this.cache.delete(key)
			throw error
		}
	}

	protected async fetchAudio(options: GeminiSpeechOptions): Promise<Blob> {
		const params = new URLSearchParams({
			input: options.input,
			model: options.model,
			voice: options.voice,
			languageCode: options.languageCode,
		})

		if (options.systemInstruction) {
			params.set('systemInstruction', options.systemInstruction)
		}

		const headers = new Headers()

		if (options.apiKey) {
			headers.set('x-goog-api-key', options.apiKey)
		}

		const response = await fetch(`${this.endpoint}/v1/audio/speech?${params}`, {
			headers,
		})

		if (!response.ok) {
			throw new Error(`Gemini TTS synthesis failed: HTTP ${response.status}`)
		}

		return response.blob()
	}

	private async fetchVoices(): Promise<void> {
		if (this.state !== 'connected') {
			throw new Error('Gemini TTS is not connected')
		}

		const response = await fetch(`${this.endpoint}/v1/voices`)

		if (!response.ok) {
			throw new Error(
				`Gemini TTS voices request failed: HTTP ${response.status}`,
			)
		}

		const data: { voices: GeminiTtsVoiceInfo[] } = await response.json()
		this.voices = data.voices
	}

	private async ensureVoices(): Promise<void> {
		if (this.voices.length > 0) return

		if (!this.voicesPromise) {
			this.voicesPromise = this.fetchVoices().catch((error) => {
				this.voicesPromise = undefined
				throw error
			})
		}

		await this.voicesPromise
	}

	async getVoiceTitleFromId(
		voiceId: GeminiTtsVoice,
	): Promise<string | undefined> {
		if (this.state !== 'connected') {
			throw new Error('Gemini TTS is not connected')
		}

		await this.ensureVoices()

		const voice = this.voices.find((voice) => voice.id === voiceId)

		if (voice) {
			return voice.name
		}
	}
}
