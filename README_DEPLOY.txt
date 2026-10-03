ENTSONE REAL-BACKEND UPDATE

USER APP
- USER_APP/index.html
- OTP-only signup/login. Signup is the first screen; Login is available after an account exists. Username is required only for Signup.
- Mobile input is exactly 10 digits (6-9 first digit); no country-code field is shown. Backend sends the Vonage Verify v2 destination as 91xxxxxxxxxx (without +).
- Tournaments, registrations, history, results, leaderboard, notifications, settings and room credentials are server-backed.
- User/session cache may remain in browser storage only for session continuity; tournament/user activity data is not stored there.

ADMIN PANEL
- ADMIN_PANEL/admin.html
- Separate admin site.
- Admin key is entered at login and sent as X-Admin-Key; never hard-code it.
- Tournament CRUD, statuses, results, result publishing, notifications and room credentials use the backend.

BACKEND
- BACKEND/server.js
- PostgreSQL schema initialization is required before the server starts.
- Environment variables: DATABASE_URL, VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_BRAND, ENTSONE_ADMIN_KEY.
- Vonage Verify v2 is used for OTP.

PAYMENT
- Payment/wallet remains demo/disabled by design.
- Real-money tournament entry, payment and payout are not enabled.
