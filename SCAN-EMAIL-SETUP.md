# Scan email setup (Apps Script) — handoff

**Goal:** make `/scan` (1) log each lead to a Google Sheet, (2) email Shane a
notification, and (3) email the visitor their results copy — all sending **from
shane.gring@certainly.coop**.

## How it's wired (already done in code)
- The Cloudflare Pages Function `functions/api/scan.js` runs the scan, then
  POSTs the full result as JSON to a Google Apps Script Web App URL stored in
  the Cloudflare env var **`LEAD_SHEET_URL`**.
- The JSON payload it sends:
  ```json
  { "email": "...", "site": "...", "url": "...", "overall": 0,
    "lenses": [{"title":"...","score":0,"read":"..."}],
    "opportunities": [{"title":"...","detail":"..."}],
    "at": "ISO-timestamp" }
  ```
- The Apps Script must receive that POST and do the logging + two emails.
  The ready-to-paste code is in this repo: **`scan-lead-appsscript.gs`**.

## CRITICAL prerequisite: account ownership
Apps Script sends email **from the Google account that owns the script.** So the
Sheet + script **must be owned by the `shane.gring@certainly.coop` Google
Workspace account** — not the personal gmail account.

- If the lead Sheet currently lives under gmail: either transfer ownership to
  certainly.coop, or create a fresh Sheet under certainly.coop (and update
  `LEAD_SHEET_URL` to the new deployment's URL).
- If it stays on gmail, visitor copies will send *from gmail* (worse
  deliverability, ~100/day cap) no matter what the code says.

## Steps

1. **Sign in to Google as `shane.gring@certainly.coop`.**

2. **Open (or create) the lead Sheet under that account.** A simple one-tab
   sheet is fine; the script adds a header row on first run.

3. **Extensions → Apps Script.**

4. **Paste the code.** Replace any existing `doPost` with the full contents of
   `scan-lead-appsscript.gs`. Confirm `NOTIFY_TO = 'shane.gring@certainly.coop'`.
   Save.

5. **Deploy as a Web app.**
   - Deploy → **New deployment** → type: **Web app**.
   - **Execute as:** Me (shane.gring@certainly.coop)
   - **Who has access:** **Anyone** (required — the Worker calls it with no
     Google login; this must be "Anyone", not "Anyone with a Google account").
   - Deploy. **Authorize** when prompted: approve the Gmail-send + Sheets
     scopes. If you see an "unverified app" warning, click *Advanced → Go to
     project → Allow* (it's your own script).
   - **Copy the Web app URL** (ends in `/exec`).

6. **Point Cloudflare at it.** Cloudflare dashboard → the Pages project →
   **Settings → Environment variables → `LEAD_SHEET_URL`** = the `/exec` URL
   (Production). Save, then **redeploy** the Pages project so the new value
   takes effect.
   - If `LEAD_SHEET_URL` is already set and you only need to change the script,
     redeploy in Apps Script via **Manage deployments → edit (pencil) the
     existing deployment → New version → Deploy** — that keeps the **same**
     `/exec` URL so you don't have to touch Cloudflare.
   - Creating a *new* deployment generates a *new* URL → you must update
     `LEAD_SHEET_URL`.

7. **Test end to end.** Run a real scan at <https://shanegring.com/scan> with a
   test address you control, or from a terminal (note: 3 scans/IP/hour limit):
   ```bash
   curl -s -X POST https://shanegring.com/api/scan \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com","email":"YOUR@certainly.coop","debug":true}'
   ```
   The `debug:true` response includes `lead_sheet_result` — confirm
   `"status": 200, "ok": true`. Then verify:
   - a new row in the Sheet,
   - the notification email arrives at shane.gring@certainly.coop,
   - the visitor copy arrives at the test address (check spam the first time).

## Gotchas
- **From address = owner account** → must be certainly.coop (see prerequisite).
- **Access must be "Anyone"** or the Worker's POST gets a Google login wall.
- **New deployment = new URL.** Edit the existing deployment to keep the URL.
- **Quota:** Workspace ~1,500 recipients/day; each scan sends 2 emails.
- The Cloudflare var is `LEAD_SHEET_URL` (despite the name, it's the Apps Script
  web-app URL, not the spreadsheet URL).
