import { existsSync, readFileSync } from 'node:fs'

import type { ServiceAccount } from 'firebase-admin/app'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'

import { config } from './config.js'

let auth: Auth | undefined

export function isFirebaseConfigured(): boolean {
	return existsSync(config.serviceAccountPath)
}

function getFirebaseAuth(): Auth {
	if (auth) return auth

	if (!isFirebaseConfigured()) {
		throw new Error('Firebase service account is not configured')
	}

	const serviceAccount = JSON.parse(
		readFileSync(config.serviceAccountPath, 'utf8'),
	) as ServiceAccount

	const app =
		getApps().find((app) => app.name === 'gemini-tts-proxy') ??
		initializeApp(
			{
				credential: cert(serviceAccount),
			},
			'gemini-tts-proxy',
		)

	auth = getAuth(app)

	return auth
}

export async function verifyPremiumUser(token: string): Promise<boolean> {
	const decodedToken = await getFirebaseAuth().verifyIdToken(token, true)
	return decodedToken.premium === true
}
