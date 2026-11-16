# @vdegenne/gemini-tts-proxy

A lightweight HTTP proxy for Google's Gemini API.

It exposes a simple HTTP endpoint to generate speech using Gemini voices and models, with built-in audio caching and optional authentication.

## Features

- Gemini Text-to-Speech support.
- MP3 audio output.
- Multiple Gemini models and voices.
- Optional language selection (BCP-47).
- HTTP audio caching (disk and memory).
- In-flight request deduplication.
- Optional Firebase authentication and premium access control.
- Rate limiting.

## Requirements

- Node.js
- FFmpeg
- A Google Gemini API key.

## Installation

```bash
npm install
```

## Configuration

The following environment variables are available:

| Variable                   | Description                          |
| -------------------------- | ------------------------------------ |
| `HOST`                     | Server host                          |
| `PORT`                     | Server port                          |
| `GEMINI_API_KEY`           | Google Gemini API key                |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account credentials |
| `CACHE_DIR`                | Audio cache directory                |
| `MEMORY_CACHE_MAX_BYTES`   | Maximum in-memory cache size         |
| `DEBUG_TOKEN`              | Optional debug token                 |

## API

### `GET /v1/audio/speech`

Generates speech and returns an MP3 audio response.

**Query parameters**

| Parameter           | Required | Description                    |
| ------------------- | -------- | ------------------------------ |
| `input`             | Yes      | Text to synthesize             |
| `model`             | Yes      | Gemini TTS model               |
| `voice`             | Yes      | Gemini voice name              |
| `languageCode`      | Yes      | BCP-47 language tag            |
| `systemInstruction` | No       | Additional speech instructions |

**Authentication**

Pass your Gemini API key using the `x-goog-api-key` header.

If Firebase authentication is configured, a valid Firebase ID token can also be supplied using the `Authorization: Bearer` header. Premium access is enforced when applicable.

**Example**

```bash
curl -G "http://localhost:3000/v1/audio/speech" \
  -H "x-goog-api-key: YOUR_API_KEY" \
  --data-urlencode "input=Hello, world!" \
  --data-urlencode "model=gemini-3.8-flash-lite-tts" \
  --data-urlencode "voice=Kore" \
  --data-urlencode "languageCode=en-US" \
  --output speech.mp3
```

## Caching

Generated audio is cached to avoid unnecessary Gemini API requests.

Repeated requests with identical parameters reuse the cached audio. Concurrent identical requests are also deduplicated.

## License

MIT
