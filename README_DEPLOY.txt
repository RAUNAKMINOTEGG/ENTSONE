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

REAL OTP (OPTIONAL -> ENABLE FOR PRODUCTION)
==============================================
ENTSONE now supports real SMS OTP through Vonage Verify v2.
Keep provider secrets ONLY in Render backend environment variables; never put them in the frontend.

Render API service environment variables:
  OTP_MODE=vonage
  VONAGE_API_KEY=<your Vonage API key>
  VONAGE_API_SECRET=<your Vonage API secret>
  VONAGE_BRAND=ENTSONE

After saving the variables, redeploy the BACKEND service and test Signup/Login with a real phone number.
The backend starts the Verify v2 request and stores only the provider request ID; the OTP itself is checked by Vonage.
If OTP_MODE is left as demo, the existing demo OTP behavior remains active.

Vonage Verify v2 uses POST /v2/verify to send the verification and POST /v2/verify/{request_id} to check the code.


AUTH UPDATE (V6):
- Username is required for both Login and Sign Up.
- Login requires the username to match the mobile account.
- Sign Up requires a unique username.
- OTP flow is a two-step professional UI: identity -> OTP verification.
- Real OTP remains controlled by OTP_MODE=vonage and VONAGE_API_KEY/VONAGE_API_SECRET on Render.


V7 PRO UI update:
- Username is required and Instagram-style: @handle UI, 3-30 lowercase letters/numbers/dot/underscore, case-insensitive unique backend validation.
- Login/signup switching has animated page/auth transitions.
- Added logo PNG fallback if SVG cannot load.
- Main page sections animate smoothly when switching.
