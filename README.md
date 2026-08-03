# Our Household Hub

A mobile-friendly shared website for Oscar and Kate. It tracks Food, Gas, and Utilities purchases, stores a recipe list, and randomly creates a five-day Monday–Friday dinner plan.

Receipt photos are **not** included. Only text and numbers are stored.

## Included features

- Separate email/password accounts for Oscar and Kate
- One shared household connected by a private invite code
- Add, edit, delete, and filter purchases
- Monthly totals and per-category averages
- Add recipes manually
- Bulk-import meals using `(K)` and `(O)` tags
- Randomly select five different meals
- Balance cooking assignments between Kate and Oscar when possible
- Reroll one day without changing the other four
- Save a different meal plan for each week
- Responsive phone and desktop layout

---

# Part 1 — Create the Supabase database

GitHub Pages hosts the website files, but Supabase stores the shared data so both phones see the same information.

1. Go to **supabase.com** and create a free account.
2. Click **New project**.
3. Give the project a name such as `household-hub`.
4. Create a strong database password and save it somewhere private.
5. After the project opens, click **SQL Editor** in the left menu.
6. Click **New query**.
7. Open the included file named `supabase-setup.sql`.
8. Copy the entire file, paste it into the Supabase SQL Editor, and click **Run**.
9. The result should say the query completed successfully.

## Make account creation simple

In Supabase:

1. Open **Authentication**.
2. Open **Providers** and make sure **Email** is enabled.
3. For the easiest first setup, turn off **Confirm email**. The household invite code still prevents strangers from entering your shared household.

You can keep email confirmation enabled instead. When it is enabled, each person must click the confirmation email before signing in.

---

# Part 2 — Connect the website to Supabase

1. In Supabase, open **Project Settings**.
2. Open **Data API** or **API Keys**.
3. Copy the **Project URL**.
4. Copy the **Publishable key**. A legacy project may call this the **anon public key**.
5. Open `config.js` in this folder.
6. Replace the two placeholder values:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "YOUR_PROJECT_URL",
  SUPABASE_ANON_KEY: "YOUR_PUBLISHABLE_OR_ANON_KEY"
};
```

## Important security warning

The publishable/anon key is meant for browser apps and is protected by the Row Level Security rules in `supabase-setup.sql`.

**Never put the `service_role` key in `config.js`, GitHub, or any public website.**

---

# Part 3 — Put the site on GitHub Pages

## Create the repository

1. Sign in to GitHub.
2. Click the **+** menu near the top-right.
3. Choose **New repository**.
4. Name it something such as `household-hub`.
5. Choose **Public** for the simplest free GitHub Pages setup.
6. Click **Create repository**.

The website code may be public, but your purchases, recipes, account passwords, and meal plans are stored in Supabase—not in the GitHub repository.

## Upload the website files

1. Extract this ZIP on your computer.
2. Open the extracted `household-hub` folder.
3. In your new GitHub repository, click **Add file**.
4. Click **Upload files**.
5. Drag these files into GitHub:
   - `.nojekyll`
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
   - `supabase-setup.sql`
   - `README.md`
6. Click **Commit changes**.

Do not upload the ZIP itself as the website. GitHub needs the extracted files.

## Turn on GitHub Pages

1. Open the repository's **Settings** tab.
2. Open **Pages** under **Code and automation**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select the `main` branch.
5. Select the `/ (root)` folder.
6. Click **Save**.
7. Your address will use this format:

```text
https://YOUR-GITHUB-USERNAME.github.io/household-hub/
```

---

# Part 4 — Create both accounts

## First person

1. Open the live GitHub Pages website.
2. Select **Create account**.
3. Enter a name, email, and password.
4. Select **Create household**.
5. Enter the household name and display name.
6. Open **Settings** in the website.
7. Copy the ten-character invite code.

## Second person

1. Open the same website on the other person's phone or computer.
2. Select **Create account** and use a different email address.
3. Select **Join household**.
4. Enter the invite code from the first account.
5. Enter the second person's display name.

Both accounts will now see the same purchases, recipes, and meal plans.

---

# Adding the recipe list

Open **Recipes** and expand **Paste your full meal list**.

Use one meal per line:

```text
Tacos (O)
Chicken Alfredo (K)(O)
Baked Salmon (K)
```

- `(K)` means Kate can cook it.
- `(O)` means Oscar can cook it.
- Put both tags when either person can cook it.
- `(K/O)` and `(B)` also count as both.
- Duplicate recipe names are skipped.

The planner requires at least five saved recipes.

---

# Updating the website later

1. Edit the file on your computer.
2. Open the GitHub repository.
3. Upload the replacement file using **Add file > Upload files**.
4. Choose **Replace** when GitHub recognizes the existing filename.
5. Commit the changes.

For code updates, replace the entire old file with the newly provided file instead of mixing sections together.

---

# Troubleshooting

## The website says “Connect your database”

`config.js` still contains placeholder text, or the Project URL/key was pasted incorrectly.

## The website says “Database setup error”

Run the complete `supabase-setup.sql` file in the Supabase SQL Editor.

## Account created but it will not sign in

Email confirmation is enabled. Open the confirmation email first, or disable **Confirm email** in Supabase Authentication settings.

## The second account cannot join

- Confirm the invite code is exactly ten characters.
- Use the same Supabase project and the same live website address.
- Each email account can belong to only one household.

## Purchases or recipes do not appear

Confirm both people joined the same invite code. Signing up alone does not connect the accounts.

## GitHub Pages shows a 404

Confirm Pages is set to `main` and `/ (root)`, and confirm `index.html` is in the top level of the repository rather than inside another folder.

---

# Files

- `index.html` — all website screens and forms
- `styles.css` — phone and desktop design
- `app.js` — login, purchases, recipes, totals, and meal-planning logic
- `config.js` — your Supabase Project URL and publishable/anon key
- `supabase-setup.sql` — database tables and private household security rules
- `.nojekyll` — tells GitHub Pages to serve the files directly
