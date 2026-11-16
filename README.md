# @vdegenne/gemini-tts-proxy

A lightweight self-hosted HTTP proxy for Google's Gemini Text-to-Speech API.

It provides a simple HTTP endpoint to generate speech using Gemini voices and models, with built-in audio caching, optional Firebase authentication and a browser client.

## Features

- Gemini Text-to-Speech support.
- MP3 audio output (128 kbps).
- Multiple Gemini models and voices.
- Optional language selection (BCP-47).
- Disk and in-memory audio caching.
- LRU memory cache.
- In-flight request deduplication.
- Optional Firebase authentication and premium access control.
- Rate limiting.
- Browser client included.

## Requirements

- Node.js
- FFmpeg 4.4 or newer, with `libmp3lame` support.
- A Google Gemini API key.

## Installation

```bash
npm install @vdegenne/gemini-tts-proxy
```

## Running the server

The package provides a CLI executable:

```bash
npx gemini-tts-proxy
```

## Configuration

Configuration is provided through environment variables (a `.env` file is supported).

| Variable                   | Default                  | Description                             |
| -------------------------- | ------------------------ | --------------------------------------- |
| `HOST`                     | `127.0.0.1`              | Server host                             |
| `PORT`                     | `3000`                   | Server port                             |
| `GEMINI_API_KEY`           | —                        | Server-side Gemini API key              |
| `FIREBASE_SERVICE_ACCOUNT` | `serviceAccountKey.json` | Firebase service account JSON file      |
| `CACHE_DIR`                | `data/gemini`            | Cache directory                         |
| `MEMORY_CACHE_MAX_BYTES`   | `104857600`              | Maximum in-memory cache size (100 MiB)  |
| `STATS_FLUSH_INTERVAL_MS`  | `30000`                  | Usage statistics flush interval         |
| `DEBUG_TOKEN`              | —                        | Enables the protected debug endpoint    |
| `CORS_ORIGINS`             | —                        | Comma-separated list of allowed origins |

A Gemini API key can also be supplied directly by the client.

## API

### `GET /v1/audio/speech`

Generates speech and returns an MP3 audio response.

**Query parameters**

| Parameter           | Required | Description                    |
| ------------------- | -------- | ------------------------------ |
| `input`             | Yes      | Text to synthesize             |
| `model`             | Yes      | Gemini TTS model               |
| `voice`             | Yes      | Gemini voice name              |
| `languageCode`      | No       | BCP-47 language tag            |
| `systemInstruction` | No       | Additional speech instructions |

**Supported models**

- `gemini-2.5-flash-preview-tts`
- `gemini-2.5-pro-preview-tts`
- `gemini-3.1-flash-tts-preview`
- `gemini-3.8-flash-tts`
- `gemini-3.8-flash-lite-tts`

**Supported voices**

Achernar, Achird, Algenib, Algieba, Alnilam, Aoede, Autonoe, Callirrhoe, Charon, Despina, Enceladus, Erinome, Fenrir, Gacrux, Iapetus, Kore, Laomedeia, Leda, Orus, Puck, Pulcherrima, Rasalgethi, Sadachbia, Sadaltager, Schedar, Sulafat, Umbriel, Vindemiatrix, Zephyr and Zubenelgenubi.

**Example**

```bash
curl -G "http://localhost:3000/v1/audio/speech" \
  -H "x-goog-api-key: YOUR_API_KEY" \
  --data-urlencode "input=Hello, world!" \
  --data-urlencode "model=gemini-3.8-flash-lite-tts" \
  --data-urlencode "voice=Kore" \
  --output speech.mp3
```

### `GET /v1/voices`

Returns the list of supported voices in JSON format.

### `GET /health`

Returns the server health status.

### `GET /debug`

Returns server diagnostics, cache information, usage statistics, rate limits and Firebase status.

Requires the `x-debug-token` header matching `DEBUG_TOKEN`. Returns 404 when debugging is disabled.

## Authentication

The proxy supports two ways of providing a Gemini API key.

**Client-provided API key**

Pass the key using the `x-goog-api-key` header.

```http
x-goog-api-key: YOUR_API_KEY
```

This takes precedence over the server-side key and bypasses Firebase authentication.

**Server-side API key**

Set `GEMINI_API_KEY` in the server environment.

If no Firebase service account is configured, the server key is sufficient.

If a Firebase service account is present, clients must provide a valid Firebase ID token with the `premium` claim set to `true`.

```http
Authorization: Bearer FIREBASE_ID_TOKEN
```

The server then uses its own Gemini API key to generate speech.

## Rate limiting

The speech endpoint is limited to 10 requests per minute per client IP address.

Requests exceeding this limit receive HTTP 429.

## Caching

Generated audio is cached on disk and in memory.

- Disk caching persists generated audio between server restarts.
- Memory caching uses an LRU strategy with a configurable size limit.
- Concurrent identical requests share the same synthesis operation.
- Cache keys are based on normalized speech parameters, including the model, voice, language and system instruction.

Audio responses include a one-year immutable HTTP cache policy.

## Browser client

The package also exports `GeminiTtsProxyClient`, which can be used in browser applications.

```ts
import { GeminiTtsProxyClient } from '@vdegenne/gemini-tts-proxy'

const client = new GeminiTtsProxyClient({
	endpoint: 'http://localhost:3000',
})

const audio = await client.getAudio({
	input: 'Hello, world!',
	model: 'gemini-3.8-flash-lite-tts',
	voice: 'Kore',
})

const url = URL.createObjectURL(audio)
```

The client includes an in-memory cache and deduplicates concurrent identical requests.

Authentication headers can be supplied through the second argument of `getAudio()` or `createAudioRequest()`.

## License

No license has been specified yet.
