Frontend Supabase Auth config:

Edit `supabase-config.js` and set:

- `SUPABASE_URL`: your public Supabase project URL
- `SUPABASE_ANON_KEY`: your public anon key or publishable key

Do not put `SUPABASE_SERVICE_ROLE_KEY` in frontend files.

Architecture:

- Backend testing: Render free
- Database: Supabase free
- Frontend: Render static site, Netlify, Vercel, or same Express backend

Payload example: 4C7141428E1E92C048E10142
