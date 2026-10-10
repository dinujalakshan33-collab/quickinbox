# QuickInbox

QuickInbox is an original temporary-inbox web app starter. It includes a responsive frontend, an Express API, SQLite storage, per-inbox bearer tokens, expiry cleanup, and a signed Mailgun inbound webhook.

## Important limitations

- This is a deployable starter, not a hosted service. It will **not receive real email until you configure a domain and an inbound email provider**.
- The app stores inbox messages in SQLite. Use a persistent disk/volume in production or data can be lost on redeploy/restart depending on your host.
- Temporary email is not appropriate for banking, password recovery, confidential messages, or accounts you need to keep.
- Mailgun may require a verified domain and may have plan/region restrictions. Check provider rules and local laws before launch.
- Before a public launch, add abuse controls, monitoring, backups/retention policy, and test webhook signature handling with real provider payloads.

## Run locally

Requires Node.js 20 or later.

1. Copy `.env.example` to `.env`.
2. Set `MAIL_DOMAIN` to your actual verified inbound domain.
3. Set `MAILGUN_WEBHOOK_SIGNING_KEY` to the signing key from your Mailgun account.
4. Install and run:

   ```bash
   npm install
   npm start
   ```

5. Open `http://localhost:3000`.

Without a real domain, the create-inbox endpoint intentionally returns a setup error.

## Deploy from an Android phone (GitHub + Render)

1. Extract this ZIP on your phone.
2. In GitHub, open your `quickinbox` repository.
3. Use **Add file → Upload files** and upload the files/folders from this project. Ensure `server.js`, `package.json`, `.env.example`, `.gitignore`, `README.md`, and the `public` folder are at the repository root.
4. Create a Web Service on a Node.js hosting provider such as Render and connect the GitHub repository.
5. Build command: `npm install`
6. Start command: `npm start`
7. Add environment variables in the hosting dashboard:
   - `MAIL_DOMAIN` = your verified receiving domain (or a dedicated subdomain such as `inbox.example.com`)
   - `MAILGUN_WEBHOOK_SIGNING_KEY` = the Mailgun webhook signing key
   - `INBOX_TTL_MINUTES` = `60`
   - `TRUST_PROXY` = `true` only when behind the host's trusted proxy
8. Attach a persistent disk/volume and mount it at the app's `data` directory if your host supports it. If not, SQLite data may be lost when the service restarts or redeploys.
9. Configure your receiving email provider's DNS records (MX and any required verification records) for your chosen receiving domain. Do not change existing email MX records unless you intend to route all mail for that domain to this service.
10. In Mailgun, create an inbound route that matches recipients on your receiving domain and forwards parsed messages by HTTP POST to `https://YOUR-DEPLOYED-HOST/mailgun/inbound`. Configure/verify the webhook signing key according to Mailgun's current documentation.
11. Send a test email from an unrelated mailbox and confirm it appears in QuickInbox.

## API overview

- `GET /api/health` — health check.
- `POST /api/inboxes` — creates an inbox and returns its address and one-time access token.
- `GET /api/inboxes/:address/messages` — lists up to 100 messages; requires `Authorization: Bearer <token>`.
- `GET /api/inboxes/:address/messages/:id` — reads one message; requires token.
- `DELETE /api/inboxes/:address` — deletes inbox and messages; requires token.
- `POST /mailgun/inbound` — signed inbound webhook endpoint.

## Security notes

- Do not commit `.env` or secrets to GitHub.
- Use HTTPS in production.
- Mailgun's webhook signature uses HMAC-SHA256 over `timestamp + token`. Test against the exact provider payload before launch.
- The frontend uses `textContent` for email content rather than rendering received HTML, reducing script injection risk.
- Keep inbox tokens private. Anyone who obtains the token can read that inbox until it expires.
- Set short expirations and impose provider-level message-size limits.
