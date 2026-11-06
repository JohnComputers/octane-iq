import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";

const dist = resolve(import.meta.dirname, "../dist");
const html = await readFile(resolve(dist, "account.html"), "utf8");
const source = (await readFile(resolve(dist, "account.js"), "utf8"))
  .replace('import { AUTH_CONFIG } from "./auth-config.js";', "const AUTH_CONFIG = globalThis.__AUTH_CONFIG;");
const base = "https://johncomputers.github.io/octane-iq/account.html";
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const delay = (milliseconds = 0) => new Promise((resolveDelay) => nativeSetTimeout(resolveDelay, milliseconds));

async function waitFor(predicate, label, timeout = 1200) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await delay(5);
  }
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    values
  };
}

class TestFormData {
  constructor(form) {
    this.values = new Map([...form.querySelectorAll("[name]")].map((field) => [field.name, field.value]));
  }
  get(name) { return this.values.get(name) ?? null; }
}

async function createAccount(config, responder = async () => response({})) {
  const { window, document } = parseHTML(html);
  const localStorage = storage();
  const requests = [];
  const assignments = [];
  let currentUrl = new URL(base);
  const location = {
    get href() { return currentUrl.href; },
    get protocol() { return currentUrl.protocol; },
    assign(value) { assignments.push(value); currentUrl = new URL(value, currentUrl); }
  };
  const history = { replaceState(_state, _title, value) { currentUrl = new URL(String(value), currentUrl); } };
  const fetch = async (url, options = {}) => {
    const request = { url: String(url), options };
    requests.push(request);
    return responder(request, requests.length - 1);
  };
  const shortTimeout = (callback, milliseconds, ...args) => milliseconds > 5000 ? -1 : nativeSetTimeout(callback, milliseconds, ...args);
  window.setTimeout = shortTimeout;
  window.clearTimeout = nativeClearTimeout;
  window.Element.prototype.focus = function focus() { document.__focused = this; };

  const context = vm.createContext({
    __AUTH_CONFIG: config,
    window, document, location, history, localStorage, fetch,
    crypto: webcrypto, TextEncoder, FormData: TestFormData,
    URL, Date, JSON, atob, btoa, console,
    setTimeout: shortTimeout, clearTimeout: nativeClearTimeout
  });
  vm.runInContext(source, context, { filename: "dist/account.js" });
  await waitFor(() => document.querySelector("#auth-loading").hidden, "account initialization");
  return { window, document, localStorage, requests, assignments, location };
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => payload === null ? "" : JSON.stringify(payload) };
}

function submit(window, form) {
  const event = new window.Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
}

function session(email = "driver@example.com") {
  return {
    access_token: "header.payload.signature",
    refresh_token: "refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "user-1", email, app_metadata: { provider: "email" } }
  };
}

const publicConfig = { supabaseUrl: "https://octane-test.supabase.co", publishableKey: "sb_publishable_browser_test" };

test("unconfigured and secret-key configurations disable auth while guest navigation remains", async () => {
  for (const config of [
    { supabaseUrl: "", publishableKey: "" },
    { supabaseUrl: "https://octane-test.supabase.co", publishableKey: "sb_secret_never_ship_this" },
    { supabaseUrl: "https://octane-test.supabase.co", publishableKey: `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x` }
  ]) {
    const account = await createAccount(config);
    assert.equal(account.document.querySelector("#auth-unconfigured").hidden, false);
    assert.equal(account.document.querySelector("#google-signin").disabled, true);
    assert.equal(account.document.querySelector("#signin-form button[type=submit]").disabled, true);
    assert.equal(account.document.querySelector('.account-intro a[href="./"]').getAttribute("href"), "./");
    assert.equal(account.requests.length, 0);
  }
});

test("email sign-in sends a password grant and stores the real returned session", async () => {
  const account = await createAccount(publicConfig, async () => response(session()));
  account.document.querySelector("#signin-email").value = "driver@example.com";
  account.document.querySelector("#signin-password").value = "correct-horse-battery-staple";
  submit(account.window, account.document.querySelector("#signin-form"));
  await waitFor(() => !account.document.querySelector("#signed-in").hidden, "password sign-in");

  assert.equal(account.requests.length, 1);
  const request = account.requests[0];
  assert.equal(request.url, "https://octane-test.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(request.options.headers.apikey, publicConfig.publishableKey);
  assert.equal(request.options.headers.Authorization, undefined, "A publishable key must not be sent as a Bearer token");
  assert.deepEqual(JSON.parse(request.options.body), { email: "driver@example.com", password: "correct-horse-battery-staple" });
  const stored = JSON.parse(account.localStorage.getItem("octane-iq:supabase-session:v1"));
  assert.equal(stored.user.email, "driver@example.com");

  account.document.querySelector("#signout").click();
  await waitFor(() => account.requests.length === 2, "authenticated sign-out");
  assert.equal(account.requests[1].options.headers.apikey, publicConfig.publishableKey);
  assert.equal(account.requests[1].options.headers.Authorization, "Bearer header.payload.signature", "Protected Auth endpoints need the user access token");
});

test("email sign-up uses PKCE and an exact GitHub Pages confirmation redirect", async () => {
  const account = await createAccount(publicConfig, async () => response({ user: { id: "pending" } }));
  account.document.querySelector("#show-signup").click();
  account.document.querySelector("#signup-email").value = "new@example.com";
  account.document.querySelector("#signup-password").value = "a-long-password";
  submit(account.window, account.document.querySelector("#signup-form"));
  await waitFor(() => account.requests.length === 1, "signup request");
  await waitFor(() => /Check your email/.test(account.document.querySelector("#auth-status").textContent), "signup confirmation status");

  const requestUrl = new URL(account.requests[0].url);
  assert.equal(requestUrl.pathname, "/auth/v1/signup");
  assert.equal(requestUrl.searchParams.get("redirect_to"), `${base}?flow=signup`);
  const body = JSON.parse(account.requests[0].options.body);
  assert.equal(account.requests[0].options.headers.Authorization, undefined, "Signup must use only the apikey header");
  assert.equal(body.email, "new@example.com");
  assert.equal(body.code_challenge_method, "s256");
  assert.match(body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(account.localStorage.getItem("octane-iq:supabase-pkce:v1"));
});

test("Google sign-in builds a project-scoped PKCE authorize URL", async () => {
  const account = await createAccount(publicConfig);
  account.document.querySelector("#google-signin").click();
  await waitFor(() => account.assignments.length === 1, "Google redirect");
  const authorize = new URL(account.assignments[0]);
  assert.equal(authorize.origin, "https://octane-test.supabase.co");
  assert.equal(authorize.pathname, "/auth/v1/authorize");
  assert.equal(authorize.searchParams.get("provider"), "google");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "s256");
  assert.equal(authorize.searchParams.get("redirect_to"), `${base}?flow=oauth`);
  assert.match(authorize.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(account.requests.length, 0, "OAuth should navigate rather than expose provider credentials to fetch");
});

test("password recovery sends PKCE and a recovery-only redirect", async () => {
  const account = await createAccount(publicConfig, async () => response({}));
  account.document.querySelector("#show-recovery").click();
  account.document.querySelector("#recovery-email").value = "driver@example.com";
  submit(account.window, account.document.querySelector("#recovery-form"));
  await waitFor(() => account.requests.length === 1, "recovery request");
  await waitFor(() => /If that account exists/.test(account.document.querySelector("#auth-status").textContent), "recovery status");

  const requestUrl = new URL(account.requests[0].url);
  assert.equal(requestUrl.pathname, "/auth/v1/recover");
  assert.equal(requestUrl.searchParams.get("redirect_to"), `${base}?flow=recovery`);
  const body = JSON.parse(account.requests[0].options.body);
  assert.equal(account.requests[0].options.headers.Authorization, undefined, "Recovery must use only the apikey header");
  assert.equal(body.email, "driver@example.com");
  assert.equal(body.code_challenge_method, "s256");
  assert.match(body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
});
