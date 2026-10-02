# Weekly backup and restore

Every Sunday at 02:00 (Accra), a GitHub Actions job exports production and uploads it to the restricted Google Drive folder (DECISIONS D-009, A-015, A-046). This is on top of Supabase Pro's own daily backups.

Each week, Drive gets:
- **`database/melins-backup-YYYY-MM-DD.tar.gz.gpg`**, an encrypted archive containing:
  - `data.sql`: all the business data. This is what a restore loads.
  - `auth.sql`: the logins (users, sign-in identities, authenticators), so people keep their access after a restore.
  - `melins.sql`: the full structure and data, for reading in a plain PostgreSQL.
  - `csv/`: one CSV per table, for Excel or the Accountant.
  - `MANIFEST.txt`: the date and the row count of every table.
- **`documents/`**: every uploaded file (receipts, certificates, contracts…). New files are added each week and nothing is ever removed, so records are kept for at least six years.

Nothing is stored in the GitHub repository. The job only runs there.

## Set it up (once)

You need: the production database password, a Google account that owns the backup folder, and about 20 minutes. **Never paste any of these values into chat.**

1. **Backup folder.** In Google Drive, create **"MeLiNS Command Centre – Backups"** and share it only with the Accountant. Open it and copy its id: the part of the URL after `/folders/`.
2. **Drive sign-in token.** On your PC, install rclone (`winget install Rclone.Rclone`) and run `rclone authorize "drive"`. A browser opens; sign in with the Google account that owns the folder and allow access. rclone then prints a token starting `{"access_token":…`. Copy all of it, including the braces.
3. **Database connection string.** Supabase (production) → **Connect** → **Session pooler**. Copy the URI (port **5432**) and put the database password in it. Use the pooler, not the direct connection: GitHub's runners can't reach the direct address.
4. **Passphrase.** Make up a long passphrase (for example, five random words). **Write it down and keep it offline with the Supabase recovery codes** (docs/ACCESS_RECOVERY.md). Without it the backups can't be opened, and nobody can recover it.
5. **GitHub secrets.** GitHub → `akdadzie/melins-command-centre` → **Settings → Secrets and variables → Actions → New repository secret**. Add:

   | Name | Value |
   |---|---|
   | `BACKUP_DB_URL` | the connection string from step 3 |
   | `BACKUP_PASSPHRASE` | the passphrase from step 4 |
   | `RCLONE_DRIVE_TOKEN` | the token from step 2 |
   | `GDRIVE_FOLDER_ID` | the folder id from step 1 |

6. **Documents too (recommended).** Supabase (production) → **Storage → S3 Connection**. Note the endpoint and region, and create an access key. Add these secrets: `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_KEY_ID`, `SUPABASE_S3_SECRET`. Without them, the database is still backed up but uploaded files aren't.
7. **Test it.** GitHub → **Actions → Weekly backup → Run workflow**. After a few minutes the run should be green, and the folder should have `database/melins-backup-<today>.tar.gz.gpg` (and `documents/`).

If a weekly run fails, GitHub emails the repository owner. The run's log says which step failed. A missing secret is named in the error.

## Open a backup

On a PC with GnuPG (Git for Windows includes `gpg` in Git Bash):

```
gpg -d melins-backup-2026-10-04.tar.gz.gpg | tar -xz
```

Type the passphrase when asked. The CSVs open in Excel.

## Restore

Only restore into a **new, empty** Supabase project (or staging). Never restore over production unless the Owner has decided to. Each step needs a few minutes:

1. Create the project, link this folder to it (`npx supabase link --project-ref <ref>`), and apply every migration with `npx supabase db push`. Don't invite anyone yet: the restore brings the logins back.
2. In Git Bash, in `C:\dev\melins-ims`, with the archive downloaded:
   ```
   BACKUP_PASSPHRASE='<passphrase>' bash scripts/backup/restore.sh melins-backup-2026-10-04.tar.gz.gpg '<new project Session pooler URI>'
   ```
   The script:
   1. empties the tables the migrations seeded;
   2. loads the logins and the data with the database's triggers off, so balances, numbers and the audit log come back exactly as they were;
   3. compares every table's row count with the backup's manifest. It ends with "Every table matches the backup's manifest", or lists the differences.
3. Deploy the Edge Functions, and point the Netlify site's `VITE_SUPABASE_URL` and anon key at the new project.
4. Copy the documents back. With rclone set up for Drive and the new project's S3 keys, run `rclone copy gdrive:documents supa:documents`.
5. Sign in as the Owner and check the Money panel against the last bank statement.

The restore was tested on 2 Oct 2026 against the test database. All 68 tables matched their counts, and the account balances, outstanding invoices and logins were identical before and after.
