# WePay.ai

A responsive family expense ledger with conversational expense parsing and PayPal sandbox checkout.

## Project layout

- `frontend/` — Vite, React, Tailwind CSS, Framer Motion, and PayPal's React SDK.
- `backend/` — FastAPI parsing and PayPal order gateway.

## Run locally

1. Create a PayPal REST app in the PayPal Developer Dashboard and use its **sandbox** client ID and secret. Keep the secret on the server; it must never be added to a `VITE_` variable.
2. In `backend/`, create a virtual environment, install `requirements.txt`, and copy `.env.example` to `.env`. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `backend/.env`; the API loads this file at startup. Keep the real `.env` private and out of source control.
3. Start the API from the repository root with `uvicorn backend.main:app --reload --port 8000`.
4. In `frontend/`, install dependencies, copy `.env.example` to `.env.local`, set `VITE_PAYPAL_CLIENT_ID` to the same sandbox client ID, then run `npm run dev`.
5. Open `http://localhost:5173`. PayPal orders are created and captured in sandbox mode.

## API

- `GET /api/health` — service health.
- `POST /api/parse-voice` — JSON body: `{ "text": "Dadi paid ₹3000 for groceries shared with Amit and Rahul" }`.
- `POST /api/create-paypal-order` — expense JSON returned by the parse endpoint. Returns the PayPal order ID, approval URL, idempotency request ID, total, currency, and cent-exact participant liabilities.

The parser is deterministic and supports conversational English expense descriptions with common currency symbols and currency codes. Browser voice input uses the browser's Web Speech API when available; text entry works independently. Splits use integer cents and distribute remainder cents in participant order so liabilities always add up exactly to the total.

Dashboard totals are converted to USD using the latest working-day reference rates returned by Frankfurter. The API caches each base-currency response for one hour, and the UI labels these values as estimates; reference rates are not a live payment quote and never change the amount submitted to PayPal.

## Deployment configuration

Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `VITE_PAYPAL_CLIENT_ID`, and `VITE_API_URL` through the deployment platform's environment configuration. Update the backend CORS allowlist in `backend/main.py` to the deployed frontend origin before hosting the client on another domain. Serve the API behind HTTPS and use PayPal live credentials only for a separately configured production deployment.
