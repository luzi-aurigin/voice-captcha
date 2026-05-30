# Docker Setup

The quickest way to run the Voice Captcha server in production.

## Prerequisites

- Docker 20+ and Docker Compose v2
- An [Aurigin.ai](https://aurigin.ai) API key
- (Optional) An [OpenAI](https://platform.openai.com) API key for word verification

## Quick start

```bash
# 1. Copy the env template
cp ../server/.env.example .env

# 2. Fill in your API keys
#    AURIGIN_API_KEY=...
#    OPENAI_API_KEY=...   (optional)

# 3. Start
docker compose up -d

# 4. Check it's healthy
curl http://localhost:3000/health
```

The server is now running at `http://localhost:3000` with Redis for challenge persistence.

## Environment variables

All variables from `server/.env.example` are supported. Pass them via a `.env` file in this directory or export them in your shell before running `docker compose up`.

## Stopping

```bash
docker compose down        # stop, keep Redis data
docker compose down -v     # stop and delete Redis data
```

## Without Redis (development only)

Run the server standalone without Redis (challenges are stored in memory):

```bash
docker build -t voice-captcha -f docker/Dockerfile .
docker run -p 3000:3000 \
  -e AURIGIN_API_KEY=your_key \
  -e OPENAI_API_KEY=your_key \
  voice-captcha
```
