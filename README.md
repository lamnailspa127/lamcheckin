# LAM CHECK IN (Vercel version)

## Deploy on Vercel

1. Go to https://vercel.com and sign in with GitHub
2. Click **Add New Project** → Import your repository
3. Settings:
   - Framework Preset: **Other**
   - Root Directory: leave default
   - Build Command: leave empty
   - Output Directory: leave empty (vercel.json handles it)
4. Add Environment Variables:

| Key | Value |
|-----|-------|
| `SQUARE_ACCESS_TOKEN` | your Production token |
| `SQUARE_ENVIRONMENT` | `production` |
| `SQUARE_LOCATION_ID` | `L5NJSKPJF80C0` |
| `RESEND_API_KEY` | your Resend API key |
| `NOTIFY_EMAIL` | `lamnailspa127@gmail.com` |

5. Click **Deploy**

## Pages

- Customer check-in: `https://your-project.vercel.app/`
- Staff page: `https://your-project.vercel.app/staff.html`

## Notes

- Emails are sent from `checkin@lamnailspa.ca`
- Daily log runs automatically via Vercel Cron (around 12:00 UTC)
- Canceled appointments are hidden
