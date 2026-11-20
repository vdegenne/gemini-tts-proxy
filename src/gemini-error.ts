import { ApiError } from '@google/genai'

export interface GeminiError {
	status: number
	message: string
	retryAfter?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function getHeader(headers: unknown, name: string): string | undefined {
	if (!headers) return undefined

	if (headers instanceof Headers) {
		return headers.get(name) ?? undefined
	}

	if (isRecord(headers)) {
		const value = headers[name] ?? headers[name.toLowerCase()]
		if (typeof value === 'string') return value
	}

	return undefined
}

function extractMessage(value: unknown): string | undefined {
	if (typeof value === 'string') {
		try {
			return extractMessage(JSON.parse(value))
		} catch {
			return value || undefined
		}
	}

	if (!isRecord(value)) return undefined

	if (isRecord(value.error)) {
		const nested = extractMessage(value.error.message)
		if (nested) return nested
	}

	if (typeof value.message === 'string') {
		const nested = extractMessage(value.message)
		if (nested) return nested
	}

	return undefined
}

function getApiErrorMessage(error: ApiError): string {
	return extractMessage(error.message) ?? error.message
}

export function normalizeGeminiError(error: unknown): GeminiError {
	const record = isRecord(error) ? error : {}

	const rawStatus =
		error instanceof ApiError
			? error.status
			: (record.status ?? record.statusCode)

	const status =
		typeof rawStatus === 'number' &&
		Number.isInteger(rawStatus) &&
		rawStatus >= 400 &&
		rawStatus <= 599
			? rawStatus
			: 502

	const message =
		error instanceof ApiError
			? getApiErrorMessage(error)
			: (extractMessage(record.body) ??
				extractMessage(record.error) ??
				extractMessage(record.message) ??
				'Gemini request failed')

	return {
		status,
		message,
		retryAfter: getHeader(record.headers, 'retry-after'),
	}
}
