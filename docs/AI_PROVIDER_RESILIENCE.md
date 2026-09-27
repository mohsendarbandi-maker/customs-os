# Customs OS — AI Provider Resilience

## Provider order

1. Gemini API pool: GEMINI_API_KEY, GEMINI_API_KEY_1 ... GEMINI_API_KEY_10
2. Groq pool: GROQ_API_KEY, GROQ_API_KEY_1 ... GROQ_API_KEY_5
3. OpenRouter: OPENROUTER_API_KEY using openrouter/free
4. Cloudflare Workers AI: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN
5. OpenAI: OPENAI_API_KEY as final paid fallback

The router must fail over on timeout, 429, 5xx, provider outage, invalid response, or model unavailability. A provider failure must never become a Customs OS data failure.

## Free-first policy

- Gemini/Groq/OpenRouter/Cloudflare are attempted before paid OpenAI.
- Never silently switch from a free provider to a paid provider unless OPENAI_API_KEY is intentionally configured.
- Keep provider/model/latency/error metadata in AI interaction logs.
- Never expose provider keys to the browser.

## Multiple Gemini accounts/projects

Do not create fake Gmail accounts or automate account creation to bypass quotas.

Google currently applies Gemini API rate limits per project, not per API key. Legitimate separate Google Cloud projects can therefore be isolated, but this is not an unlimited-quota mechanism and each project remains subject to Google's policies and limits.

Use numbered keys only when they belong to legitimate projects/environments that you control.

## Recommended free infrastructure

- Cloudflare Workers: routing, health checks, lightweight gateway, caching and failover.
- Cloudflare Workers AI: local/serverless fallback for text tasks.
- Supabase Edge Functions: authenticated AI orchestration and data access.
- OpenRouter free models: emergency text fallback.
- Hugging Face Inference Providers: optional experimental fallback; free accounts have a small monthly credit allocation, so it should not be treated as a primary production quota.
- Mistral Free mode: optional provider key for another independent provider path.

## Never put these in Vercel client code

GEMINI_API_KEY*, GROQ_API_KEY*, OPENROUTER_API_KEY, CLOUDFLARE_AI_TOKEN, OPENAI_API_KEY, MISTRAL_API_KEY, HF_TOKEN.

Store them only as Supabase Edge Function secrets or equivalent server-side secrets.

## Failure behavior

If every external provider is down, Customs OS should still:
- preserve uploaded documents;
- preserve existing extracted values;
- preserve workflow state;
- preserve audit records;
- show a temporary AI-unavailable status;
- retry later;
- never overwrite valid fields with blank/xxxx values.

## Important

Free quotas, model availability and provider policies change. The router is intentionally capability-based and should treat every provider as disposable.
