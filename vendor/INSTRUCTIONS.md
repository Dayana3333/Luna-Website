# Fix for Discord Activity CSP errors — vendor/ setup

Discord's Activity CSP only allows scripts from your own domain ('self')
and blob:. It blocks ALL third-party CDNs (jsdelivr, esm.sh, unpkg, etc),
no exceptions. That's why both imports were getting blocked.

config.js and discord.js have already been updated to import from local
files instead:
    ./vendor/supabase.js
    ./vendor/discord-sdk.js

You need to put those 2 real files into the vendor/ folder. Two ways to
do this — pick ONE.

---------------------------------------------------------------
OPTION A — Easiest, no install needed (recommended)
---------------------------------------------------------------

1. Go to this URL in your browser:
   https://esm.sh/@discord/embedded-app-sdk?bundle

2. Press Ctrl+S (Cmd+S on Mac) to save the page.
   Save as type: "Webpage, Text only" or "All files" — NOT "Webpage, complete".
   Save it as: discord-sdk.js

3. Go to this URL in your browser:
   https://esm.sh/@supabase/supabase-js@2?bundle

4. Press Ctrl+S (Cmd+S on Mac) to save the page, same way.
   Save it as: supabase.js

5. Put both saved files into the vendor/ folder of this project,
   replacing nothing (the folder should be empty until you do this).

6. Confirm the folder now looks like:
   azonnal/
     config.js
     discord.js
     index.html
     style.css
     vendor/
       discord-sdk.js
       supabase.js

---------------------------------------------------------------
OPTION B — Using npm + a bundler (only if you're comfortable with this)
---------------------------------------------------------------

1. In a terminal, in a new empty folder:
   npm init -y
   npm install @supabase/supabase-js @discord/embedded-app-sdk esbuild

2. Run:
   npx esbuild --bundle --format=esm --outfile=supabase.js --define:process.env.NODE_ENV='"production"' ./node_modules/@supabase/supabase-js/dist/module/index.js

   npx esbuild --bundle --format=esm --outfile=discord-sdk.js --define:process.env.NODE_ENV='"production"' ./node_modules/@discord/embedded-app-sdk/output/index.mjs

3. Copy the two output files (supabase.js, discord-sdk.js) into vendor/.

---------------------------------------------------------------
After either option
---------------------------------------------------------------

- Commit and push the vendor/ folder (with the 2 files inside) to your
  GitHub repo, same as the rest of the project.
- Reload the Activity inside Discord. The CSP errors for these 2 imports
  should be gone.
- Delete this INSTRUCTIONS.md file once it's working, it's just for setup.
