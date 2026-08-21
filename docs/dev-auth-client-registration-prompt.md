# Prompt for DevFlare dev-auth client registration

Use this in the `Andersseen/devflare` repo to register Ally as a `dev-auth`
consumer.

```text
Act as a senior TypeScript/Cloudflare engineer in the Andersseen/devflare repo.

Goal: register Ally as a dev-auth OAuth2.1/OIDC confidential client so the Ally
repo can sign users in through https://auth-devflare.andersseen.dev.

Please inspect apps/dev-auth/README.md and the current dev-auth Worker config
before editing. Follow the existing OAUTH_CLIENTS/OAUTH_CLIENT_SECRETS pattern.

Client to add:
- clientId: ally-dev
- name: Ally
- type: web
- redirectURIs:
  - http://127.0.0.1:8787/api/auth/callback
  - https://ally.andersseen.dev/api/auth/callback

If the production Ally domain is different, replace
https://ally.andersseen.dev/api/auth/callback with the exact deployed callback.
Redirect URIs must match byte-for-byte; no wildcard and no trailing slash unless
the Ally Worker uses it.

Tasks:
1. Add the Ally client to dev-auth OAUTH_CLIENTS in the Worker config.
2. Generate a 32+ byte client secret and update the dev-auth secret
   OAUTH_CLIENT_SECRETS with an "ally-dev" entry. Do not commit the secret.
3. Tell me the matching values to set in the Ally repo:
   - DEV_AUTH_URL=https://auth-devflare.andersseen.dev
   - DEV_AUTH_CLIENT_ID=ally-dev
   - DEV_AUTH_CLIENT_SECRET=<generated secret>
   - DEV_AUTH_REDIRECT_URI=<exact Ally callback URI>
   - ALLY_SESSION_SECRET=<separate random secret, or reuse only for local dev>
4. Run dev-auth tests or the narrow auth/client-registry checks.
5. Commit only dev-auth config/code changes. Do not include co-author trailers.
```

For local development, do not run dev-auth on the same `:8787` port as Ally's
local audit API. Use the deployed provider or run dev-auth on another port and
set `DEV_AUTH_URL` in Ally accordingly.
