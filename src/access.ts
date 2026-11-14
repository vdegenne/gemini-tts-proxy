import {isFirebaseConfigured, verifyPremiumUser} from './auth.js'
import {config} from './config.js'

export class AccessError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message)
	}
}

export async function resolveApiKey(
	clientApiKey?: string,
	authorization?: string,
): Promise<string> {
	const providedKey = clientApiKey?.trim()

	// A client-provided key takes precedence and bypasses Firebase.
	if (providedKey) return providedKey

	const serverApiKey = config.apiKey?.trim()

	if (!serverApiKey) {
		throw new AccessError('Gemini API key required', 401)
	}

	// Without Firebase credentials, the server key is sufficient.
	if (!isFirebaseConfigured()) return serverApiKey

	if (!authorization?.startsWith('Bearer ')) {
		throw new AccessError('Authentication required', 401)
	}

	try {
		const isPremium = await verifyPremiumUser(authorization.slice(7))

		if (!isPremium) {
			throw new AccessError('Premium subscription required', 403)
		}
	} catch (error) {
		if (error instanceof AccessError) throw error

		throw new AccessError('Invalid authentication token', 401)
	}

	return serverApiKey
}
