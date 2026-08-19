# LAM CHECK IN (Vercel)

## Deploy

1. Push this folder to GitHub
2. Import project on vercel.com
3. Add Environment Variables:

| Key | Value |
|-----|-------|
| `SQUARE_ACCESS_TOKEN` | your Production token |
| `SQUARE_ENVIRONMENT` | `production` |
| `SQUARE_LOCATION_ID` | `L5NJSKPJF80C0` |
| `RESEND_API_KEY` | your Resend key |
| `NOTIFY_EMAIL` | `lamnailspa127@gmail.com` |

4. Deploy

## Pages

- Customer: `https://your-app.vercel.app/`
- Staff: `https://your-app.vercel.app/staff.html`

## If staff page shows "Could not load data"

1. In Vercel → Project → Settings → Environment Variables  
   Make sure all variables above are set for **Production**
2. Redeploy after adding variables
3. Check Vercel → Deployments → latest → Functions / Logs  
   for errors from `get-todays-bookings`
