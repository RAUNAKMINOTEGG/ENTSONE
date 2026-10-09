ENTSONE — REAL BACKEND BUILD

Frontend: deploy USER_APP as static site.
Backend: deploy BACKEND as Node service.
Database: PostgreSQL via DATABASE_URL.
Admin: set ENTSONE_ADMIN_KEY on API service and use the same key in ADMIN_PANEL.

Important:
- Tournament, registration, team edits, check-in, room authorization, results, verification, leaderboard, stats, support, audit and backup use the backend/database.
- OTP supports real Vonage SMS; set OTP_MODE=vonage in Render for production. Payment remains DEMO ONLY.
- Payment remains DEMO ONLY by product requirement; no real money is charged.
- Automatic tournament status sync runs every 30 seconds.
- CORS should be restricted in production with CORS_ORIGINS set to the exact frontend origin (for example https://entsone.onrender.com).
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


PRODUCTION VALIDATION
======================
- Tournament status is server-controlled; admin cannot manually override lifecycle status.
- Mode is locked to the tournament's Solo/Duo/Squad setting.
- Team member limits are enforced server-side: Solo 1, Duo 2, Squad 4.
- Registration deadline must not be after match start.
- Prize order must be 1st >= 2nd >= 3rd and total podium prizes cannot exceed prize pool.
- My Tournaments returns slots and live joined_count from PostgreSQL.
- Set CORS_ORIGINS to the production frontend URL before launch.


FINAL V11 launch checks:
- OTP_MODE=vonage is the production default; keep VONAGE_API_KEY, VONAGE_API_SECRET and VONAGE_BRAND configured in Render.
- Usernames are protected by application validation plus a PostgreSQL case-insensitive unique index.
- Tournament status is server-controlled only; admin cannot manually override lifecycle status.
- Admin tournament create/edit sends fee, prize, deadline, check-in, custom game/mode/map and rules fields to the backend.
- Solo/Duo/Squad member limits are enforced by the backend.
- Team editing closes at tournament start or registration deadline.
- Payment remains DEMO-only; no real payment gateway is enabled.


V12 PROFILE UPDATE:
- My Tournaments in the player profile now has All, Upcoming, Open, Ongoing and Results filters.
- The Results tab shows completed tournaments with available verified result placement, points and kills.
- Team members are displayed in the tournament card when available.


V13 OTP ERROR HANDLING + BRAND ASSETS
=====================================
- Vonage `Quota Exceeded` is a provider account/billing/Verify quota rejection, not a frontend logo or app-code issue. The API now returns a clear actionable message and does not silently switch to demo OTP.
- To resume real SMS, check Vonage Billing/account status and Verify/SMS quota; restore a positive balance if required, then test again. A code deployment alone cannot add provider credit or override account restrictions.
- Updated ENTSONE Esports Arena wordmark is bundled locally as entsone-final-logo.png; square icon is entsone-icon.png. Logo references are cache-busted to reduce stale/broken asset issues.
- Mobile bottom navigation uses a compact `Tourneys` label and extra bottom safe-area padding.


V15 UI FIXES (2026-10-09)
- Restored expanded game filters (including ScarFall, Ludo, Chess, 8 Ball Pool, Clash of Clans, Clash Royale, Asphalt and custom tournament game names).
- Removed duplicate Ongoing/Live filter; the single Live tab represents the backend ONGOING status.
- Tournament cards display ONGOING as LIVE while the backend status remains unchanged.
- Standardized branding to the horizontal ENTSONE logo and square app icon only; removed duplicate logo files.
- Payment remains DEMO-only.


V16 REAL-DATA CLEANUP + API HARDENING
====================================
- Frontend no longer displays bundled sample tournaments when the backend returns an empty tournament list. Tournament cards are driven by the server response.
- Removed seeded demo notifications from new browser sessions; user notifications load from the database after sign-in.
- Updated history/settings copy so it no longer claims live records are demo matches.
- Added baseline API security response headers and disabled the Express powered-by header.
- Payment and wallet remain DEMO ONLY; no real payment gateway, wallet credit, withdrawal or payout was enabled.
- Tournament entry/prize figures are informational configuration only; they do not collect or transfer money.

IMPORTANT DEPLOY CHECKS
=======================
- Set CORS_ORIGINS to the exact production frontend origin on Render.
- Keep ENTSONE_ADMIN_KEY, VONAGE_API_KEY and VONAGE_API_SECRET only in backend environment variables.
- Configure PostgreSQL DATABASE_URL and verify /api/db-test in deployment.
- This ZIP has not been deployed to Render by this build process; redeploy frontend and backend separately, then test using a non-production test account.


V19 FINAL FEATURE PASS
- Match result entry now checks whether the current round is complete and creates the next round automatically from winners. A single remaining winner is reported as tournament champion in the API response.
- Odd participant counts receive an automatic BYE advancement. Do not regenerate a bracket after results have been recorded because bracket generation replaces that tournament’s existing match rows.
- User-side notifications now auto-refresh about every 20 seconds while signed in, alongside tournament refresh. This is in-app polling, not browser push notifications.
- Admin Panel includes controls to generate brackets, view matches, record scores, and review/update disputes.
- Added Tournament Rules page and clickable Terms/Privacy/Rules footer navigation.
- Payment remains demo-only; no real deposits or withdrawals are processed.
- Syntax checks passed for backend and frontend scripts and the ZIP archive was validated. This does not replace live Render end-to-end testing.
- Deploy USER_APP as a static site and BACKEND as a Node service. Keep the existing Render DATABASE_URL and secrets unchanged.
- After deployment, test admin login, tournament creation, at least two registrations, bracket generation, result entry through a final, dispute submission/review, notifications, and mobile navigation.

V20 FINAL UI + BRACKET EXPERIENCE (2026-10-09)
- Updated player-facing branding to a text-only gradient ENTSONE wordmark with ESPORTS ARENA label.
- Added accessible slide-in navigation drawer with account, compete, wallet, notification, settings, support and legal navigation.
- Standardized the mobile bottom bar to Home, Games, Tournament, Wallet and Profile; Matches & Brackets remain available in the drawer.
- Refined tournament/featured cards with layered neon esports-style visual treatments, improved depth and hover states without third-party image dependencies.
- Added a tournament picker and round-grouped bracket view for actual API match data, including scores, winners, scheduled time and report-issue actions.
- Updated admin panel typography/wordmark and focus/interaction polish while preserving the existing backend, database schema and admin API.
- Payment remains DEMO-only. No real deposits, withdrawals or payouts are enabled.
- Validation performed for frontend/admin/backend JavaScript syntax and ZIP integrity. This is not a live deployment or end-to-end test against the production database.


GAME ART UPDATE (6 TITLES)
--------------------------
USER_APP now includes separate art files for BGMI, Free Fire, Valorant, COD Mobile, ScarFall, and Ludo. Tournament card styles select the matching artwork by game name. These are generated concept artworks for the ENTSONE UI, not official publisher assets.
