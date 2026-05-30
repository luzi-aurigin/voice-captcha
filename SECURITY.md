# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) for this repository if enabled, or email the maintainers at the address listed in the repository settings.

Include in your report:

- A description of the vulnerability
- Steps to reproduce
- The potential impact
- Any suggested fix (optional)

## Scope

In scope:
- Authentication bypass or challenge replay attacks
- Server-side injection (command injection via filenames/form fields, etc.)
- CORS misconfiguration leading to credential theft
- Rate limiting bypass
- Sensitive data leakage in API responses

Out of scope:
- Attacks requiring physical access to the server
- Social engineering
- Issues in third-party services (Aurigin, OpenAI)

## Security best practices for deployers

**API keys**
- Never commit `.env` to source control
- Rotate keys if they are ever exposed
- Use environment-specific keys (dev vs. prod)

**CORS**
- Set `ALLOWED_ORIGIN` to your production domain(s) — do not use `*` in production

**HTTPS**
- Always serve the backend over HTTPS in production
- Audio recordings contain biometric data; protect them in transit

**Rate limiting**
- The default limits (100 challenge / 20 verify per 15 minutes per IP) are conservative starting points — tune `RATE_LIMIT_MAX` and `RATE_LIMIT_VERIFY_MAX` for your traffic pattern

**Redis**
- Use Redis (via `REDIS_URL`) in production — in-memory storage does not scale and loses challenges on restart
- Secure Redis with a password and bind it to localhost or a private network

**Verification tokens**
- Successful `/api/verify` responses include a single-use `verificationToken`
- Your backend must redeem tokens via `POST /api/siteverify` before accepting protected actions
- Set a strong `CAPTCHA_SECRET` and never expose it to browsers
- Do not gate forms with client-side flags alone (`disabled = false` is not security)
