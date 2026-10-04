ENTSONE FINAL - RENDER READY

Structure
- USER_APP/index.html = user website
- ADMIN_PANEL/admin.html = separate admin panel
- BACKEND/server.js = PostgreSQL + Vonage Verify V2 + auth/tournament APIs

Render deployment
1. USER APP: Render Static Site, publish directory USER_APP.
2. ADMIN PANEL: Render Static Site, publish directory ADMIN_PANEL.
3. BACKEND: Render Web Service, Root Directory BACKEND, Build Command `npm install`, Start Command `node server.js`.

Backend environment variables
DATABASE_URL=your PostgreSQL connection string
VONAGE_API_KEY=your Vonage API key
VONAGE_API_SECRET=your Vonage API secret
VONAGE_BRAND=ENTSONE
ENTSONE_ADMIN_KEY=your admin key

OTP
- Vonage Verify V2 endpoint: POST /v2/verify
- Sends Indian numbers as 91XXXXXXXXXX.
- OTP input is clickable/typeable immediately after Send OTP is pressed and is focused automatically.
- OTP input remains usable after the SMS arrives.
- Resend is protected by a 60-second cooldown.

Payment
- Real-money entry, deposits, withdrawals and payouts remain disabled.

Security
- Never put Vonage credentials or ENTSONE_ADMIN_KEY in frontend source.
- If the backend URL changes, update API_BASE in USER_APP/index.html and ADMIN_PANEL/admin.html.
