ENTSONE — REAL BACKEND BUILD

Frontend: deploy USER_APP as static site.
Backend: deploy BACKEND as Node service.
Database: PostgreSQL via DATABASE_URL.
Admin: set ENTSONE_ADMIN_KEY on API service and use the same key in ADMIN_PANEL.

Important:
- Tournament, registration, team edits, check-in, room authorization, results, verification, leaderboard, stats, support, audit and backup use the backend/database.
- OTP remains DEMO ONLY by product requirement.
- Payment remains DEMO ONLY by product requirement; no real money is charged.
- Automatic tournament status sync runs every 30 seconds.
- CORS accepts configured CORS_ORIGINS; when unset it permits browser origins for initial deployment testing.
- Public tournament links use /?tournament=<share-slug> and resolve through the backend.

Recommended Render services:
1) API service: root directory BACKEND, start command npm start.
2) Static site: USER_APP/index.html.
3) PostgreSQL database and DATABASE_URL on API service.
