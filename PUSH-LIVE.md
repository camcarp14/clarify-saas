# Push Clarify Search live (PowerShell)

From a PowerShell window, after downloading `clarify-saas-live.zip` to Downloads:

```powershell
# 1) Back up the current folder, drop in the new one
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
Rename-Item "$env:USERPROFILE\Desktop\clarify-saas" "$env:USERPROFILE\Desktop\clarify-saas-backup-$stamp"
Expand-Archive "$env:USERPROFILE\Downloads\clarify-saas-live.zip" -DestinationPath "$env:USERPROFILE\Desktop"

# 2) Sanity-build locally
Set-Location "$env:USERPROFILE\Desktop\clarify-saas\deploy"
npm install
npm run build
npm run smoke   # engine self-test — should end "SMOKE: ALL GREEN"

# 3) Ship it (the deploy folder keeps its git history)
git add -A
git commit -m "Release: Clarify Search + Organic Playbook"
git push
```

If Netlify is connected to the repo, the push deploys automatically. If you deploy directly instead:
```powershell
npx netlify-cli deploy --prod
```

**Don't skip — one-time platform steps:**
1. Supabase → SQL editor → run `supabase/migrations/005_search.sql`, then `006_playbook.sql`.
2. Google Cloud Console → enable **Search Console API** + add scope `https://www.googleapis.com/auth/webmasters.readonly` to the existing OAuth client (Release 1 step — skip if done).
3. In the app, **Re-crawl & audit** each property once so the Playbook has the full link graph.
