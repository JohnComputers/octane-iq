# Octane IQ authentication setup

The account page uses Supabase Auth directly from the browser. It supports email/password sign-up and sign-in, password recovery, Google OAuth with PKCE, refresh-token rotation, sign-out, and a fully functional guest path.

Until the two public values in `dist/auth-config.js` are set, the page shows “Sign-in is coming soon” and keeps guest play available. It never simulates a successful login.

## 1. Create the Supabase project

1. Create or select a Supabase project.
2. Open **Project Settings → API**.
3. Copy the project URL and the browser-safe **publishable key**. A legacy `anon` key also works.
4. Never use an `sb_secret_…` key or a JWT whose role is `service_role`. Those credentials bypass Row Level Security and must never be shipped to GitHub Pages.

Set the public values:

```js
export const AUTH_CONFIG = Object.freeze({
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "YOUR_PUBLIC_PUBLISHABLE_KEY"
});
```

The URL and publishable key are intended to be visible in browser source. Security must come from Supabase Auth plus Row Level Security, not from hiding the public key.

## 2. Configure allowed URLs

In **Authentication → URL Configuration**, use:

- Site URL: `https://johncomputers.github.io/octane-iq/`
- Additional Redirect URLs:
  - `https://johncomputers.github.io/octane-iq/account.html?flow=oauth`
  - `https://johncomputers.github.io/octane-iq/account.html?flow=signup`
  - `https://johncomputers.github.io/octane-iq/account.html?flow=recovery`

Add equivalent localhost URLs while developing, for example `http://localhost:4173/account.html?flow=oauth` and the signup/recovery variants. Do not use a broad production wildcard when exact URLs are practical.

## 3. Email and password

In **Authentication → Providers → Email**:

1. Enable email/password sign-in.
2. Decide whether email confirmation is required. Confirmation is recommended for production.
3. Configure custom SMTP before inviting real users; the default mail service is rate-limited and intended for initial testing.
4. Review password-strength and rate-limit settings.

The browser initiates PKCE for sign-up and password recovery. Confirmation and recovery links must be opened in the same browser profile that started the flow because the one-time PKCE verifier is stored locally.

## 4. Google OAuth

1. Create a Web OAuth client in Google Cloud.
2. Add the Supabase callback URL as an authorized redirect URI:

   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`

3. Put the Google client ID and secret in **Supabase → Authentication → Providers → Google**. The Google secret belongs in Supabase, never in this repository.
4. Enable the provider and save it.

The account page sends the browser to Supabase `/auth/v1/authorize` with an S256 PKCE challenge. Supabase handles Google’s callback, then returns a short-lived auth code to `account.html`; the page exchanges that code and verifier for a session.

## 5. Data security

- The page stores the Supabase access/refresh session in browser `localStorage`, consistent with a client-only static application. A user can sign out to remove it.
- Keep third-party scripts off authenticated pages unless they are trusted and necessary. Any JavaScript running on the same origin can potentially access browser storage.
- Enable Row Level Security on every user-data table. A safe starting policy scopes rows to `auth.uid()`.
- The current account page provides identity only. It does not claim to sync quiz stats until a separate, RLS-protected data model is implemented.
- Never add administrative Auth endpoints or service-role credentials to client code.

## 6. Deployment checklist

1. Fill `auth-config.js` with the public project URL/key.
2. Add the exact GitHub Pages redirect URLs in Supabase.
3. Confirm Google’s redirect URI points to Supabase, not directly to GitHub Pages.
4. Deploy, then test sign-up confirmation, password sign-in, logout, recovery, Google sign-in, a refresh after the access token expires, and guest navigation.
5. Test failures too: invalid password, expired recovery link, OAuth cancellation, offline fetch, and an unconfigured copy of the site.

The implementation uses the public Supabase Auth REST endpoints documented in Supabase’s Auth OpenAPI specification. No CDN or secret server credential is required.
