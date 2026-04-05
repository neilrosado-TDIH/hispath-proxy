# His Path API

Backend proxy server for the His Path iOS app. Sits between the app and the Anthropic API so API keys are never exposed to the client.

## Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/devotional` | Generate a personalized devotional via Claude |
| POST | `/api/hischoice` | "His Choice" devotional with exclusion lists |
| POST | `/api/branch` | Deeper follow-up based on a chosen pathway |
| POST | `/api/tts` | Text-to-speech via ElevenLabs |

All `/api` routes require the `x-bundle-id` header.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `ELEVENLABS_DEFAULT_VOICE_ID` | Default ElevenLabs voice ID |
| `BUNDLE_ID` | iOS app bundle identifier |
| `PORT` | Server port (default 3000) |

## Run Locally

```bash
npm install
npm start
```
