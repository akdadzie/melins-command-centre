# Access recovery: lost phone or authenticator

Owner, Directors and the Accountant need a code from an authenticator app at every sign-in (DECISIONS A-005). Supabase doesn't issue recovery codes for app sign-in, so recovery relies on the three things below.

## Do this now (prevention)

1. **Add a backup authenticator.** Go to **My profile → Two-factor sign-in → Add an authenticator** and scan the code with a *second* device: another phone, a tablet, or a password manager that stores authenticator codes (for example 1Password or Bitwarden). Either device then works at sign-in. The app warns you if you have only one.
2. **Protect the Supabase dashboard account.** The Supabase account that owns the MeLiNS projects is the last line of recovery, and it can see all data.
   - Give it its own two-factor sign-in (supabase.com → Account → Security).
   - Print or write down its **recovery codes** and keep them somewhere physically safe, for example the office safe. Don't keep them on the same phone.
   - Don't share this login.
3. **Keep the Supabase account email reachable.** Account recovery goes to it.

## If it happens

| Situation | What to do |
|---|---|
| **Staff member, Director or Accountant** lost their authenticator | First confirm it's really them, in person or by a phone call to a number you already know. Then **Settings → Users → Reset 2FA** and give a reason. Their authenticators are removed and they're signed out everywhere. At their next sign-in (password still needed) they set up a new authenticator. The reset is in the audit log. |
| **Owner** lost the phone but has a backup authenticator | Sign in using a code from the backup device. Then go to **My profile**, remove the lost authenticator, and add a new one. |
| **Owner** lost the only authenticator | 1. Sign in to **supabase.com** (dashboard) with your Supabase account.<br>2. Open the project (production or staging) → **SQL Editor**.<br>3. Run `select app.reset_mfa('<your email>', '<reason, e.g. phone lost 29 Sep>');`<br>4. Sign in to the app with your password; it asks you to set up a new authenticator.<br>5. Add a backup authenticator straight away.<br>The reset is written to the audit log. |
| **Owner** also can't get into the Supabase dashboard | Use the Supabase account's **recovery codes** (see prevention step 2). Without them, contact Supabase support from the account email; this can take days, and the app stays inaccessible to the Owner meanwhile (Directors and the Accountant can still sign in). |
| Anyone forgot their **password** | Use "Forgot your password?" on the sign-in page. The two-factor step still applies afterwards. |
| A phone or laptop was **stolen** while signed in | Reset that person's 2FA (above), which also signs them out everywhere. Also change their password via "Forgot your password?", or deactivate them in Settings → Users until it's sorted. |

## Why this is safe

- A reset removes only the second factor. The password is still needed, and the person immediately sets up a new authenticator.
- Only the Owner, signed in with 2FA, can reset someone else. The Owner's own reset needs the Supabase dashboard, which has its own two-factor sign-in.
- Every reset is recorded in the audit log with who did it, when, and why.
