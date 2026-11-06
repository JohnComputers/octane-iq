"use strict";

import { AUTH_CONFIG } from "./auth-config.js";

const SESSION_KEY = "octane-iq:supabase-session:v1";
const PKCE_KEY = "octane-iq:supabase-pkce:v1";
const $ = (selector) => document.querySelector(selector);
let session = null;
let refreshTimer = null;

applySavedTheme();
bindEvents();
initialize();

function applySavedTheme() {
  try {
    const local = JSON.parse(localStorage.getItem("octane-iq:v1"));
    if (local?.preferences?.theme === "dark") document.documentElement.dataset.theme = "dark";
  } catch {}
}

function configured() {
  const url = String(AUTH_CONFIG.supabaseUrl || "").trim().replace(/\/$/, "");
  const key = String(AUTH_CONFIG.publishableKey || "").trim();
  if (!/^https:\/\//i.test(url) || !key) return false;
  if (/^(?:sb_secret_|service_role)/i.test(key)) return false;
  const payload = decodeJwtPayload(key);
  return payload?.role !== "service_role";
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(base64));
  } catch { return null; }
}

function projectUrl() { return String(AUTH_CONFIG.supabaseUrl).trim().replace(/\/$/, ""); }
function publicKey() { return String(AUTH_CONFIG.publishableKey).trim(); }

async function initialize() {
  if (!configured()) {
    $("#auth-loading").hidden = true;
    $("#auth-unconfigured").hidden = false;
    $("#signed-out").hidden = false;
    disableAuthControls(true);
    setStatus("Accounts are not configured. Guest play is available.");
    return;
  }

  $("#auth-unconfigured").hidden = true;
  const callbackHandled = await handleCallback();
  if (!callbackHandled) {
    session = loadSession();
    if (session) {
      try {
        session = await ensureFreshSession(session);
        const user = await getUser(session.access_token);
        session.user = user;
        saveSession(session);
      } catch {
        clearSession();
      }
    }
  }
  $("#auth-loading").hidden = true;
  render();
}

function bindEvents() {
  $("#show-signin").addEventListener("click", () => showEmailView("signin"));
  $("#show-signup").addEventListener("click", () => showEmailView("signup"));
  $("#show-recovery").addEventListener("click", () => showEmailView("recovery"));
  $("#back-to-signin").addEventListener("click", () => showEmailView("signin"));
  $("#signin-form").addEventListener("submit", signInWithPassword);
  $("#signup-form").addEventListener("submit", signUpWithPassword);
  $("#recovery-form").addEventListener("submit", sendRecovery);
  $("#password-update-form").addEventListener("submit", updatePassword);
  $("#google-signin").addEventListener("click", signInWithGoogle);
  $("#signout").addEventListener("click", signOut);
  window.addEventListener("storage", (event) => {
    if (event.key !== SESSION_KEY) return;
    session = loadSession();
    render();
  });
}

function showEmailView(view) {
  $("#signin-form").hidden = view !== "signin";
  $("#signup-form").hidden = view !== "signup";
  $("#recovery-form").hidden = view !== "recovery";
  $("#show-signin").setAttribute("aria-pressed", String(view === "signin"));
  $("#show-signup").setAttribute("aria-pressed", String(view === "signup"));
  $(".auth-tabs").hidden = view === "recovery";
  setStatus("");
  const focusTarget = view === "signup" ? "#signup-email" : view === "recovery" ? "#recovery-email" : "#signin-email";
  $(focusTarget).focus();
}

function render() {
  const recovery = new URL(location.href).searchParams.get("flow") === "recovery" && session;
  $("#signed-out").hidden = Boolean(session) || Boolean(recovery);
  $("#signed-in").hidden = !session || Boolean(recovery);
  $("#password-update").hidden = !recovery;
  if (!session || recovery) return;
  const user = session.user || {};
  const email = user.email || "Signed-in user";
  $("#account-email").textContent = email;
  $("#account-avatar").textContent = email.slice(0, 1).toUpperCase();
  $("#account-provider").textContent = user.app_metadata?.provider || user.identities?.[0]?.provider || "email";
  scheduleRefresh();
}

function disableAuthControls(disabled) {
  ["#google-signin", "#signin-form button[type=submit]", "#signup-form button[type=submit]", "#recovery-form button[type=submit]"]
    .forEach((selector) => { const element = $(selector); if (element) element.disabled = disabled; });
}

async function signInWithPassword(event) {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const form = new FormData(event.currentTarget);
    const result = await authRequest("/token?grant_type=password", { body: { email: form.get("email"), password: form.get("password") } });
    acceptSession(result);
    setStatus("Signed in successfully.", "success");
  });
}

async function signUpWithPassword(event) {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const form = new FormData(event.currentTarget);
    const pkce = await createPkce("signup");
    const path = `/signup?redirect_to=${encodeURIComponent(callbackUrl("signup"))}`;
    const result = await authRequest(path, { body: { email: form.get("email"), password: form.get("password"), code_challenge: pkce.challenge, code_challenge_method: "s256" } });
    if (result.access_token) {
      acceptSession(result);
      setStatus("Account created and signed in.", "success");
    } else {
      setStatus("Check your email to confirm the account. Return in this browser to finish securely.", "success");
    }
  });
}

async function sendRecovery(event) {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const form = new FormData(event.currentTarget);
    const pkce = await createPkce("recovery");
    const path = `/recover?redirect_to=${encodeURIComponent(callbackUrl("recovery"))}`;
    await authRequest(path, { body: { email: form.get("email"), code_challenge: pkce.challenge, code_challenge_method: "s256" } });
    setStatus("If that account exists, Supabase has sent a recovery email.", "success");
  });
}

async function signInWithGoogle() {
  await withBusy($("#google-signin"), async () => {
    const pkce = await createPkce("oauth");
    const url = new URL(`${projectUrl()}/auth/v1/authorize`);
    url.searchParams.set("provider", "google");
    url.searchParams.set("redirect_to", callbackUrl("oauth"));
    url.searchParams.set("scopes", "openid email profile");
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", "s256");
    location.assign(url.href);
  }, false);
}

async function handleCallback() {
  const url = new URL(location.href);
  const callbackError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (callbackError) {
    setStatus(callbackError, "error");
    cleanCallbackUrl(url);
    return false;
  }
  const code = url.searchParams.get("code");
  if (!code) return false;
  const pkce = loadPkce();
  if (!pkce?.verifier || Date.now() - pkce.createdAt > 60 * 60 * 1000) {
    setStatus("This sign-in link can’t be completed in this browser. Start the flow again.", "error");
    return false;
  }
  try {
    const result = await authRequest("/token?grant_type=pkce", { body: { auth_code: code, code_verifier: pkce.verifier } });
    localStorage.removeItem(PKCE_KEY);
    acceptSession(result, false);
    const requestedFlow = url.searchParams.get("flow") || pkce.flow;
    cleanCallbackUrl(url, requestedFlow === "recovery" ? "recovery" : null);
    if (requestedFlow === "recovery") setStatus("Recovery verified. Choose a new password.", "success");
    else setStatus("Signed in successfully.", "success");
    return true;
  } catch (error) {
    setStatus(error.message, "error");
    return false;
  }
}

async function updatePassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (form.get("password") !== form.get("confirmPassword")) {
    setStatus("The two passwords don’t match.", "error");
    return;
  }
  await withBusy(event.submitter, async () => {
    const result = await authRequest("/user", { method: "PUT", token: session?.access_token, body: { password: form.get("password") } });
    if (result?.email) session.user = result;
    saveSession(session);
    history.replaceState(null, "", new URL("./account.html", location.href));
    render();
    setStatus("Password updated successfully.", "success");
  });
}

async function signOut() {
  await withBusy($("#signout"), async () => {
    let remoteError = null;
    try { await authRequest("/logout?scope=local", { method: "POST", token: session?.access_token, noContent: true }); }
    catch (error) { remoteError = error; }
    clearSession();
    render();
    setStatus(remoteError ? "Signed out on this device, but the server could not be reached." : "Signed out. Guest play is still available.", remoteError ? "error" : "success");
  });
}

async function getUser(accessToken) {
  return authRequest("/user", { method: "GET", token: accessToken });
}

async function ensureFreshSession(current) {
  if (!current.refresh_token) throw new Error("No refresh token");
  if ((current.expires_at || 0) > Date.now() + 60_000) return current;
  const refreshed = await authRequest("/token?grant_type=refresh_token", { body: { refresh_token: current.refresh_token } });
  return normalizeSession(refreshed);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!session?.refresh_token || !session.expires_at) return;
  const delay = Math.max(5_000, session.expires_at - Date.now() - 60_000);
  refreshTimer = setTimeout(async () => {
    try {
      session = await ensureFreshSession({ ...session, expires_at: 0 });
      saveSession(session);
      scheduleRefresh();
    } catch {
      clearSession();
      render();
      setStatus("Your session expired. Sign in again when you’re ready.", "error");
    }
  }, delay);
}

async function authRequest(path, { method = "POST", body, token, noContent = false } = {}) {
  const response = await fetch(`${projectUrl()}/auth/v1${path}`, {
    method,
    headers: {
      apikey: publicKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (noContent && response.ok) return null;
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `Authentication failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function acceptSession(result, rerender = true) {
  session = normalizeSession(result);
  saveSession(session);
  if (rerender) render();
}

function normalizeSession(value) {
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    token_type: value.token_type || "bearer",
    expires_at: Date.now() + Number(value.expires_in || 3600) * 1000,
    user: value.user || decodeJwtPayload(value.access_token)?.user_metadata || null
  };
}

function saveSession(value) {
  if (!value?.access_token || !value?.refresh_token) throw new Error("Supabase did not return a complete session");
  localStorage.setItem(SESSION_KEY, JSON.stringify(value));
}

function loadSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY));
    return value?.access_token && value?.refresh_token ? value : null;
  } catch { return null; }
}

function clearSession() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

async function createPkce(flow) {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  localStorage.setItem(PKCE_KEY, JSON.stringify({ flow, verifier, createdAt: Date.now() }));
  return { verifier, challenge };
}

function loadPkce() {
  try { return JSON.parse(localStorage.getItem(PKCE_KEY)); }
  catch { return null; }
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function callbackUrl(flow) {
  const url = new URL("./account.html", location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("flow", flow);
  return url.href;
}

function cleanCallbackUrl(url, retainedFlow = null) {
  url.search = "";
  url.hash = "";
  if (retainedFlow) url.searchParams.set("flow", retainedFlow);
  history.replaceState(null, "", url);
}

async function withBusy(button, action, restore = true) {
  if (!configured()) {
    setStatus("Accounts are not configured on this site yet.", "error");
    return;
  }
  const original = button?.textContent;
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  setStatus("");
  try { await action(); }
  catch (error) { setStatus(error.message || "Authentication failed. Try again.", "error"); }
  finally {
    if (button && restore) { button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = original; }
  }
}

function setStatus(message, type = "") {
  const status = $("#auth-status");
  status.textContent = message;
  status.className = `auth-status${type ? ` is-${type}` : ""}`;
}
