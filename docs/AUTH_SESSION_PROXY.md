# Supabase Auth rate limiting behind the Cloudflare Worker

Customs OS proxies browser API requests through the `customs` Cloudflare Worker. Supabase applies the `/auth/v1/token` rate limit by source IP. Without client-IP forwarding, browsers in different locations can be counted against the Worker's shared egress IP and receive HTTP 429 during refresh bursts.

## One-time production secret

1. In the Supabase Dashboard for project `bjngfgiecvihofemptub`, open **Project Settings → API Keys** and create/copy a **Secret API key** whose value starts with `sb_secret_`. Do not use the publishable key or legacy `service_role` JWT.
2. In Cloudflare, open **Workers & Pages → customs → Settings → Variables and Secrets**.
3. Add a **Secret** named `SUPABASE_SECRET_KEY` and paste the `sb_secret_` value. Do not add it as a plain-text variable, put it in GitHub, or send it in chat.
4. Save/deploy the Worker.

## What the Worker does

For `/auth/v1/token` only, the Worker changes the upstream `apikey` to this server-side secret and adds `Sb-Forwarded-For: <CF-Connecting-IP>`. The user's `Authorization` bearer token and request body remain unchanged. The secret is never returned to the browser and is not used for PostgREST, Storage, or Realtime, so normal user JWT/RLS behavior is retained for data requests.

If the Worker secret is not configured, the Worker deliberately keeps the old proxy behavior. The code does not silently expose or substitute another key; the shared-IP rate-limit issue can therefore continue until this one-time secret is installed.
