export const GEMINI_TTS_MODELS = [
	'gemini-2.5-flash-preview-tts',
	'gemini-2.5-pro-preview-tts',
	'gemini-3.1-flash-tts-preview',
	'gemini-3.8-flash-tts',
	'gemini-3.8-flash-lite-tts',
] as const

export type GeminiTtsModel = (typeof GEMINI_TTS_MODELS)[number]

export const GEMINI_TTS_VOICES = [
	'Achernar',
	'Achird',
	'Algenib',
	'Algieba',
	'Alnilam',
	'Aoede',
	'Autonoe',
	'Callirrhoe',
	'Charon',
	'Despina',
	'Enceladus',
	'Erinome',
	'Fenrir',
	'Gacrux',
	'Iapetus',
	'Kore',
	'Laomedeia',
	'Leda',
	'Orus',
	'Puck',
	'Pulcherrima',
	'Rasalgethi',
	'Sadachbia',
	'Sadaltager',
	'Schedar',
	'Sulafat',
	'Umbriel',
	'Vindemiatrix',
	'Zephyr',
	'Zubenelgenubi',
] as const

export type GeminiTtsVoice = (typeof GEMINI_TTS_VOICES)[number]

export interface GeminiSpeechOptions {
	input: string
	model: GeminiTtsModel
	voice: GeminiTtsVoice
	languageCode?: string
	systemInstruction?: string
}

export function normalizeSpeechOptions(
	options: GeminiSpeechOptions,
): GeminiSpeechOptions {
	function normalize(value: string): string {
		return value.replace(/[^\S\r\n]+/g, ' ').trim()
	}

	return {
		...options,
		input: normalize(options.input),
		languageCode: normalize(options.languageCode ?? ''),
		systemInstruction: normalize(options.systemInstruction ?? ''),
	}
}

export async function getCacheKey(
	options: GeminiSpeechOptions,
): Promise<string> {
	const payload = JSON.stringify(Object.values(normalizeSpeechOptions(options)))

	const data = new TextEncoder().encode(payload)
	const hash = await crypto.subtle.digest('SHA-256', data)

	return Array.from(new Uint8Array(hash))
		.map(function (byte) {
			return byte.toString(16).padStart(2, '0')
		})
		.join('')
}

export function getAudioPath(hash: string): string {
	return `audio/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.mp3`
}
