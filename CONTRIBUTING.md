# Contributing

Thank you for helping improve Voice Captcha! This document covers how to contribute code, tests, documentation, or new backend adapters.

## Getting started

```bash
git clone https://github.com/luzi-aurigin/voice-captcha.git
cd voice-captcha

# Install server dependencies
cd server && npm install && cd ..
```

Copy the env template and fill in at minimum `AURIGIN_API_KEY` and `OPENAI_API_KEY`:

```bash
cp server/.env.example server/.env
```

Start the dev server:

```bash
cd server && npm run dev
```

Open `demo/index.html` in a browser to test the widget (server must be running).

## Running tests

```bash
cd server
npm test
```

The test suite mocks all external services — no real API keys are needed to run tests.

## Project structure

```
src/              Frontend widget (plain JS + CSS)
server/           Express backend
  backends/       Pluggable transcription and deepfake detection
  store/          Challenge persistence (memory + Redis)
  tests/          Jest test suite
adapters/         Framework wrappers (React, Vue)
docker/           Dockerfile and docker-compose
demo/             Working demo page
```

## Commit style

Use the conventional commits format:

```
feat: add Groq transcription backend
fix: handle empty audio buffer in OpenAI backend
docs: update README with Docker instructions
test: add edge cases for wordsMatch
```

## Pull request checklist

- [ ] Tests pass (`cd server && npm test`)
- [ ] New behaviour is covered by tests
- [ ] No API keys, credentials, or `.env` files committed
- [ ] `server/.env.example` updated if new env vars were added

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) instead.
