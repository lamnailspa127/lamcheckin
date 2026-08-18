# LAM CHECK IN

Clean check-in system for **LAM Nail Spa**.

## Features

- Customer page with custom numeric keypad (perfect for iPad)
- Logo + title **LAM CHECK IN**
- Looks up today’s appointment by phone number
- One-tap Check In → updates Square seller note
- “Book an Appointment” button when no booking is found
- Staff dashboard that auto-refreshes every 20 seconds
- Daily check-in log (scheduled function)

## Live pages after deploy

- Customer check-in → `/`
- Staff view → `/staff.html`

## Setup on Netlify

1. Push this project to a GitHub repository
2. In Netlify → Add new site → Import from Git
3. Set these **Environment Variables** (Site configuration → Environment variables):

| Key | Example Value | Required |
|-----|---------------|----------|
| `SQUARE_ACCESS_TOKEN` | your Production (or Sandbox) token | Yes |
| `SQUARE_ENVIRONMENT` | `production` or `sandbox` | Yes |
| `SQUARE_LOCATION_ID` | `L5NJSKPJF80C0` | Yes |
| `NOTIFY_EMAIL` | `lamnailspa127@gmail.com` | Optional |
| `RESEND_API_KEY` | (from resend.com) | Optional (needed for real daily email) |

4. Deploy

## Daily Email Log

A scheduled function runs once per day and builds a check-in summary for the previous day.

To actually **send** the email to lamnailspa127@gmail.com:

1. Create a free account at https://resend.com
2. Create an API key
3. Add `RESEND_API_KEY` in Netlify environment variables
4. Open `netlify/functions/daily-log.js` and uncomment the Resend email code

Until then the function still runs and you can view the log at `/api/daily-log`.

## Security

- The Square access token is only used inside Netlify Functions (never in the browser)
- After testing, regenerate any token you previously shared in chat

## Local testing

```bash
npm install -g netlify-cli
netlify dev
```
