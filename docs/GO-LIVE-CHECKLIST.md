# GO-LIVE CHECKLIST — taking a new cafe live

Follow this top to bottom. Every box in §0–§10 must be ticked before the cafe
runs a paying day on this POS. Nothing here is optional-by-default; where a step
is genuinely a judgement call it says so.

**Three roles** (often two people):

| Role | Who | Owns |
|---|---|---|
| **OWNER** | platform operator | accounts, domain, creds, backups (§0, §9) |
| **DEPLOYER** | whoever runs the CLI | deploy + seed + verification (§1, §2, §8) |
| **CAFE ADMIN** | the client | their own data: settings, floor, menu, staff (§3–§6) |

Steps marked 🖐️ **cannot be done remotely** — someone has to stand at the
counter with paper coming out of the printer. §7 is the whole reason this
document exists: automated tests cover the money and the API, they cannot see
a thermal slip.

Authority for anything deploy-shaped is `apps/cafe/DEPLOY.md`; this file gives
the ORDER and the client-facing detail. It never restates a secret, and any
code-owned value it quotes is either pinned in §A or explicitly marked
approximate.

---

## §0 Owner inputs — collect these first

Nothing in §1 can start until all of these exist.

- [ ] **Accounts under the client's own email** — Atlas (one free M0, region
      `AP_SOUTH_1`) and Vercel (Hobby). Both are required.
- [ ] **An image store — OPTIONAL, and fine to defer.** Either a Cloudflare R2
      bucket (public read + a CORS rule allowing `PUT` + content-type from the
      app origin; note R2 asks for card details even on the free tier) or
      `IMAGE_STORE=cloudinary` with a Cloudinary account.
      **Shipping with neither is supported and degrades cleanly** — verified in
      code: `r2Config()` returns null rather than throwing, `POST /api/upload`
      answers a plain "Image uploads are not configured", and
      `productImageUrl()` returns null so every surface just renders no image.
      The whole POS — orders, KOT, dues, receipts, reports, end-of-day — works.
      What the cafe loses until a store is configured: **product photos and the
      Settings logo**. The receipt simply prints without a logo, and never
      invents a brand in its place.
      Adding a store later needs a **redeploy**, because the public base URL is
      a `NEXT_PUBLIC_*` value baked in at build time.
- [ ] **A host, decided.** The app resolves *which cafe it is serving* from the
      request host, so the host and two env vars have to agree. Two supported
      shapes:
      - **(A) Vercel's own free domain** — no purchase needed. Set
        `ROOT_DOMAIN=vercel.app` and `TENANT_ID=` **the first label of the
        production domain Vercel actually assigned**, then deploy. Confirmed live
        on 2026-08-12: `/api/health` answered
        `{"ok":false,"db":"down","tenant":"lucifer007"}` on
        `lucifer007.vercel.app`, and with `ROOT_DOMAIN` unset a bare
        `*.vercel.app` host 404s instead.
        ⚠️ **Do NOT assume that label equals the project name.** If the name is
        already taken Vercel appends a suffix — this platform's own v1 project is
        named `lucifer` but serves `lucifer-liard.vercel.app`. Read the real
        domain from Vercel → Project → **Domains** and copy its first label
        verbatim; a mismatch 404s **every** page, including `/login`, with
        nothing in the logs to explain it.
        Trade-offs to accept: the URL carries Vercel branding, moving the client
        to their own domain later needs a new `ROOT_DOMAIN` + a redeploy, and
        **Vercel's per-deployment preview URLs (`proj-hash-team.vercel.app`) will
        404** because their subdomain does not equal `TENANT_ID` — see §1.
      - **(B) A real domain** — `<client-slug>.<root-domain>` with
        `ROOT_DOMAIN=<root-domain>`, `TENANT_ID=<client-slug>`, and a DNS CNAME.
        Better for handover and for moving the cafe between hosts.
- [ ] **The slug is not a reserved one.** `www`, `app`, `api`, `admin` and `hub`
      never resolve to a cafe — they are platform names, and a deployment on one
      of them answers 404 with nothing in the logs to explain it. On shape (A)
      the slug comes from the assigned **domain label** (above), so check the
      domain Vercel gave you — not just the name you typed.
- [ ] **Client details, in writing**: cafe name; tagline (or an explicit
      "none"); address; contact phone; GST on/off + rate + inclusive/exclusive
      + GSTIN; FSSAI number; logo file; menu (CSV or a price list).
- [ ] **Creds handed to the deployer**: Atlas SRV connection string, Vercel org
      + project id and a token, R2 keys.
- [ ] **A strong one-time admin password** chosen by the owner —
      ≥8 characters, at least one digit, at least one special character. The
      seeder refuses anything weaker and has no built-in default.

---

## §1 Deploy the app (DEPLOYER)

- [ ] Vercel project created with **Root Directory = `apps/cafe`**.
- [ ] Environment variables set in Vercel (Production). **Required four:**
      `MONGODB_URI`, `NEXTAUTH_SECRET`, `TENANT_ID`, `ROOT_DOMAIN`, plus
      `HEALTH_STATS_TOKEN` (any random 32-byte value — unset, `/api/health?stats=1`
      hands cluster gauges to anyone who asks). Exact list and meanings:
      `apps/cafe/DEPLOY.md`. **`NEXTAUTH_URL` / `AUTH_URL` must NOT be set** —
      Auth.js v5 runs with `trustHost`, and setting either rewrites every
      request's origin and breaks login.
- [ ] **`MONGODB_URI` includes the database name.** A path-less SRV silently
      connects to a database called `test` — probe-verified: `mongodb://host`,
      `mongodb://host/` and `mongodb://host/?retryWrites=true` all resolve to
      `test`, while `mongodb://host/pos` resolves to `pos`. So the URI must end
      `…mongodb.net/<dbname>?…`, and the value in Vercel and the one you seed
      with must be **byte-identical** — otherwise you seed one database and the
      app serves another, and the cafe sees an empty menu it just imported.
- [ ] **ANY env var change only affects NEW deployments.** After editing a value
      in the dashboard, re-run `npm run deploy -- --profile <client>` before
      re-testing. This is not limited to `NEXT_PUBLIC_*`; a dashboard edit plus a
      hard refresh changes nothing on its own.
- [ ] **Functions run in Mumbai**, not Vercel's default Virginia. `apps/cafe/vercel.json`
      pins `"regions": ["bom1"]` so every deploy gets it — confirm in the build
      output/Project → Functions. Left at the default, each POS action pays
      several Virginia↔Mumbai round trips to the Atlas cluster.
- [ ] Image store env — **only if §0 chose one**: either the `R2_*` set plus
      `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`, or `IMAGE_STORE=cloudinary` plus the
      `CLOUDINARY_*` set. Deliberately omitting both is a supported shape (see
      §0) — uploads answer "Image uploads are not configured" and no image
      renders; nothing else is affected. Remember `NEXT_PUBLIC_*` is baked in at
      build time, so adding a store later needs another `npm run deploy` — a
      dashboard edit plus a hard refresh changes nothing and photos keep failing.
- [ ] Profile added to `deploy.profiles.json` (`app`, `orgId`, `projectId`,
      `tokenEnv`); `npm run deploy -- --list` shows it.
- [ ] **Root Directory = `apps/cafe`** (Vercel Project → Settings → Build and
      Deployment). Not optional, and the single most likely thing to get wrong:
      this is an npm-workspaces monorepo where `apps/cafe` depends on
      `@pos/shared` as a **workspace sibling** — raw TypeScript, never published
      to a registry — so the deploy uploads the whole repo and lets the install
      resolve it, while this setting selects which app to build. A project left
      pointing at the repo root **fails the build outright**: proven 2026-08-12,
      when a branch push auto-triggered a Vercel build against a root-configured
      project and it failed.
- [ ] **Rehearse with a preview first:**
      `npm run deploy -- --profile <client> --preview` succeeds *and* its build
      log is clean. `npm run deploy` runs the Vercel CLI from the **repo root**
      by design (`scripts/deploy.mjs` — deploying from inside `apps/cafe` cannot
      work, the install would look for `@pos/shared` on the public registry). If
      the build fails complaining about `@pos/shared`, the Root Directory above
      is wrong.
- [ ] `npm run deploy -- --profile <client>` succeeds. (The deploy script never
      touches git — committing and pushing stay manual, by design.)
- [ ] Host wired to match §0's choice:
      - **Shape (A), Vercel's domain:** confirm `ROOT_DOMAIN=vercel.app` and that
        `TENANT_ID` is *byte-for-byte* the first label of the domain under
        Vercel → Project → **Domains** (not the project name — see §0). Verify by
        curling `/api/health`: the response's `tenant` field must equal your
        `TENANT_ID`. A mismatch 404s every page.
      - **Shape (B), real domain:** add it in Vercel, DNS `CNAME <client-slug>` →
        Vercel, and `ROOT_DOMAIN` = the apex actually used.
- [ ] On shape (A), know that **the preview URL from the rehearsal above will
      itself 404** — its host is `proj-hash-team.vercel.app`, whose subdomain is
      not `TENANT_ID`. That is expected and not a failure: judge the rehearsal by
      **the build log**, not by loading the page. Only the production alias
      serves the app.
- [ ] Atlas Network Access allows `0.0.0.0/0` (Vercel has no static egress IPs).
- [ ] R2 bucket CORS allows `PUT` + content-type from
      `https://<client-slug>.<root-domain>`.
- [ ] `GET /api/health` returns HTTP 200 with `ok: true` and `db: "up"`. A 503
      carrying `db: "down"` means the app is running but cannot reach the
      cluster — check the Atlas allowlist and `MONGODB_URI` before continuing.
- [ ] The login page loads over the real domain.

---

## §2 First run, and the admin handover (DEPLOYER → CAFE ADMIN)

The seed scripts read `apps/cafe/.env.local` (they are invoked with
`--env-file=.env.local`), so point that file at the **client's** cluster for the
duration of this step.

- [ ] `cd apps/cafe` → `.env.local` carries the client `MONGODB_URI`.
- [ ] Seed the admin. A variable set in the shell beats the `--env-file` value
      (checked on Node 22), so any of these work — pick the one that matches
      your shell:
      - PowerShell: `$env:SEED_ADMIN_PASSWORD='<one-time password>'; npm run seed:admin`
      - bash/zsh: `SEED_ADMIN_PASSWORD='<one-time password>' npm run seed:admin`
      - or add the line to `.env.local` and just run `npm run seed:admin`

      Creates username `admin` (override with `SEED_ADMIN_USERNAME`).
      Re-running is safe: it skips if an admin already exists.
      ⚠️ **"Admin already exists" on a brand-new cluster means you seeded the
      WRONG database** — most likely a stale `MONGODB_URI` still pointing at
      another cafe. Stop and confirm the URI (including its `/<dbname>` path) is
      the client's before ticking this.
- [ ] `npm run seed:tables` → eight starter tables `T-1 … T-8`, 4 seats each.
      **Empty-floor bootstrap only** — once any table exists it does nothing, so
      it can never resurrect tables the cafe later deleted.
- [ ] **Clear the client's credentials off the dev box afterwards** — restore
      your own `apps/cafe/.env.local`, and clear the seed password from the shell
      (`$env:SEED_ADMIN_PASSWORD=$null`) so it does not sit in shell history or
      a stray env file.
- [ ] Log in as `admin` on the real URL.
- [ ] 🖐️ **The client changes the admin password in front of you** — sidebar
      account menu → Change password (≥8 characters). The one-time password you
      shared is dead from that moment. Do not record what they choose.
- [ ] Hand over: URL, username, and the fact that **you cannot recover their
      password** — an admin can reset any *other* account from the Staff page,
      but the last admin locking themselves out needs a developer.

Note: there is no in-app "create the first admin" screen. Bootstrapping is a CLI
step on purpose.

---

## §3 Settings — the cafe's identity (CAFE ADMIN, `Settings`, admin only)

Everything printed on a bill comes from here. **Nothing is invented**: if a
field is blank, that line simply does not print — the app will never fall back
to a placeholder brand on paper.

| Field (on-screen label) | Limit | Where it shows |
|---|---|---|
| Restaurant name *(required)* | 60 | receipt header, browser tab, sidebar |
| Tagline | 80 | receipt, line under the name |
| Contact mobile | 20 | receipt, as `Ph:` |
| Address | 200 | receipt header block |
| Header note | 200 | receipt, above the items (e.g. `GST included · Dine-in`) |
| Footer message | 120 | receipt, last line |
| Logo | — | receipt header + sidebar |
| Show GST on bills | — | enables the tax block |
| GST number | 20 | receipt, **only on bills that carried GST** |
| GST rate (%) | 0–100 (quick picks 0/5/12/18/28) | tax maths |
| GST mode | inclusive / exclusive | how the total is composed |
| FSSAI number | 20 | receipt, under GSTIN — **independent of the GST toggle** |
| Show prices on KOT | off by default | kitchen ticket |

- [ ] Restaurant name set (this is the only required field).
- [ ] **Tagline and Footer message are intentionally EMPTY until the cafe sets
      them.** Blank is a valid, deliberate choice — the receipt just omits those
      lines. Confirm with the client whether they want text there; do not invent
      a slogan.
- [ ] Address, phone, header note filled or deliberately left blank.
- [ ] GST: toggle, rate, mode and GSTIN match what their accountant expects.
      Get this right before the first real bill — changing it later does not
      rewrite bills already printed (each order keeps its own tax snapshot).
- [ ] FSSAI number entered if they have one (standard on Indian cafe bills).
- [ ] **Logo uploaded.** Pick a wide, high-contrast image; it prints monochrome
      at roughly 120×56 px on an 80 mm roll. The browser downscales to ≤600 px
      and re-encodes before upload; source files above ~20 MB are refused and
      the result must land under ~2 MB. Replacing a logo later leaves the old
      file behind in storage — harmless.
- [ ] Saved, then verified **on paper** in §7 — a logo that looks fine on screen
      can print as a grey smear.

---

## §4 The floor plan (CAFE ADMIN, `Tables`)

The starter `T-1 … T-8` are a placeholder. Replace them with the cafe's real
tables before service.

- [ ] Add each real table: **Add table** → *Table name* + *Seats*.
- [ ] Name rules: 1–24 characters, must **start** with a letter or digit, then
      letters, digits, spaces, hyphens and underscores only. **ASCII only** —
      `Café 1` and Devanagari names are rejected (thermal printers cannot render
      those glyphs either). `Patio 1`, `AC-2`, `T-11` are all fine.
- [ ] Seats 1–99 (4 by default).
- [ ] **Extra charge (optional)** — an amount this table adds to every bill
      (cover / AC / rooftop / service). Leave blank for none; most tables should
      be blank. 0–10000, whole rupees.
- [ ] **Charge name** — required as soon as the amount is above 0, and printed
      on the customer's bill **exactly as typed**. There is no default: an
      amount saved without a name **will not be charged at all**, and the Tables
      page shows "Charge needs a name before it will apply" until it is fixed.
- [ ] Tell them where the charge lands: **after GST, and outside the discount.**
      A percentage discount comes off the food only, and the charge itself is
      not taxed. Bill order on the slip is Subtotal → Discount → GST → *charge*
      → TOTAL.
- [ ] Tell them staff can **waive or change it per bill** from the cart (the row
      with the charge's name; **×** waives it, **Undo** restores it). The bill
      keeps whatever it was rung up with.
- [ ] Tell them: **changing a table's charge never re-prices an open tab or a
      past bill** — a bill keeps the charge, and the name, it was opened with.
- [ ] Delete the starter tables they do not want — **after** adding their own.
      `seed:tables` will not bring them back.
- [ ] Tell them: **a table cannot be renamed or deleted while it is occupied,
      reserved, or holding an open tab** — the app answers "Free the table
      before renaming or removing it". Free it from the Tables page first.
- [ ] Tell them: **renaming a table never rewrites past bills.** Old bills keep
      the old name, permanently and by design.

---

## §5 The menu (CAFE ADMIN, `Categories` then `Menu`)

Two routes: type it in, or import a CSV. For more than ~30 items, import.

- [ ] Categories exist (or let the import create them — it adds any category
      name it has not seen).
- [ ] **Import route:** `Menu` → **Import** → *Import products from CSV* →
      **Download template**, fill it, upload, review the preview, commit.
- [ ] Column order in the template (header row exactly):
      `name,category,price,discount,image,modifiers,isActive`
      - **Required:** `name`, `category`, **and `price`**. A blank price cell
        does *not* become 0 — that row is reported as an error and skipped. Put
        an explicit `0` in the cell for a genuinely free item.
      - Left blank, these do default: `discount` → 0, `isActive` → true,
        `image` → none, `modifiers` → none.
      - **Modifiers go in ONE cell, pipe-separated:**
        `Extra Cheese|Thin Crust`.
      - Headers are forgiving: `product`/`item` → name, `rate`/`mrp`/`amount` →
        price, `addons`/`options` → modifiers, `active`/`enabled` → isActive;
        case and punctuation are ignored.
      - **Products are matched by name** — re-importing updates the existing
        item instead of duplicating it.
      - **A re-import OVERWRITES every optional column, including the ones your
        file leaves out.** A blank or missing `image` clears the photo,
        `discount` resets to 0, `modifiers` empties, and a blank `isActive` sets
        the item **active again** — an archived dish is republished. There is no
        undo, and the preview does not show it. So to change prices, either
        re-upload each item's *full* row (image ref, modifiers, discount,
        isActive) or edit the price in the product form instead.
      - Two rows with the same name in one file: the **last** one wins.
      - **Out-of-stock ("86") state is the one thing a re-import cannot touch** —
        it is not an import column, so a price update never puts a sold-out dish
        back in service. That protection covers out-of-stock state only, *not*
        the columns above.
      - Up to 1000 rows per file.
- [ ] The preview was actually read before committing: every row shows as
      create / update / duplicate / **error**. Invalid rows are skipped and the
      rest still import — so a green "done" does not mean every row landed.
      Fix the errors and re-import (updates are idempotent).
- [ ] Photos: the CSV `image` column takes an existing image reference, **not a
      file path**. Add photos from the product form (`Add product` / edit).
- [ ] Spot-check in the POS: a product with modifiers, a discounted product, and
      an archived one.

---

## §6 Staff accounts (CAFE ADMIN, `Staff`, admin only)

- [ ] One login per person. Attribution on receipts, void slips and the void
      trail uses the account's display name — shared logins destroy the trail.
- [ ] Add staff: *Name*, *Mobile* (≥10 digits), *Username* (≥3 characters,
      stored lowercase), *Role*, *Password* (≥8 characters).
- [ ] Roles understood:
      - **admin** — everything, including Staff, Reports and Settings.
      - **staff** — everything else: POS, orders, tables, customers,
        reservations, events, **and the Menu and Categories screens**. Only
        Staff, Reports and Settings are blocked (they get redirected, not just
        hidden).
- [ ] The client knows what a **staff** account can still do. This list
      surprises owners, so read it to them:
      - **Edit the menu** — change any price, archive or restore an item, and
        run the bulk CSV import (with the overwrite behaviour described in §5).
        If prices must be the owner's decision alone, they cannot hand out staff
        logins.
      - **Permanently delete a customer** (Customers → delete; refused only
        while that customer owes money). Unlike products, staff and tables this
        is a *hard* delete — that person's visit and spend history is gone, and
        only last night's dump brings it back. Treat the customer list as
        records, not housekeeping.
      - **See only a masked mobile number** — everywhere a customer's number
        appears (the customers list, the POS customer picker, the customer edit
        form) staff see just the first few digits, e.g. `9876543210` shows as
        `98765*****`. The full number is admin-only.
      - **Discount a bill by any amount, including to zero** — no cap, no reason
        recorded, no name attached, and no discount line of its own in Reports or
        the closing slip. If the drawer is short, a comped bill is the first
        thing to suspect and the hardest to see.
      - **Delete a category**, which silently re-tags every product in it to
        "Uncategorized" and cannot be undone.
      - **Permanently delete a reservation or an event**, with no record of who
        did it.
      - Void a fired item (reason required, kitchen gets a VOID slip), receive a
        customer's dues payment, and print the end-of-day slip.
      - **Cancelling a whole order is admin-only**, as is resetting someone
        else's password, and **changing an existing customer's mobile
        number**. Staff can still add a NEW customer with a real number, and
        can still edit that customer's name and type — but the mobile field on
        an existing customer shows read-only with the hint "Only an admin can
        see or change the full number."
- [ ] Password resets: admin resets any other account from the Staff row; each
      person can change their own from the sidebar account menu.
- [ ] Leavers get **deactivated**, not deleted, so their history keeps its name.

---

## §7 🖐️ Printer setup and the device leg (DEPLOYER + CAFE ADMIN, at the cafe)

This is the one leg no automated test replaces. Do it on the **client's actual
thermal printer**, from the **actual counter device**, in **both browsers**.

### Setup

- [ ] 80 mm roll loaded. The app prints 80 mm-wide slips with a 4 mm margin and
      a ~300 px monospace body; you do not need to configure width in the app.
- [ ] Browser print dialog, once per browser: paper/roll size **80 mm** (some
      drivers call it "Receipt"), margins **Default**, scale **100%**,
      **Headers and footers OFF**, **Background graphics ON** (harmless either
      way today — every rule on the slip is a CSS border, so it prints
      regardless; leave it on so a future shaded block isn't dropped), thermal
      printer set as **default**.
- [ ] Optional, removes the dialog on every sale: launch Chrome with
      `--kiosk-printing` (silent print to the default printer). If you enable
      it, **re-run the whole matrix below** — kiosk mode changes when the print
      job is considered finished.
- [ ] Logged in on the counter device as a real staff account.

### The matrix — four paper paths × two browsers

Tick a box only after **looking at the paper**.

| # | Paper path | How to fire it | The slip must show | Chrome | Firefox |
|---|---|---|---|---|---|
| 1 | **Customer receipt, with logo, over the network** | `New Order` (the POS screen) → add items → Pay Now (Cash) | logo actually rendered, name/address/phone, GSTIN (if GST on) and FSSAI, items with modifiers, TOTAL, footer only if set | ☐ | ☐ |
| 2 | **KOT** | the same counter sale, and then a table tab: fire round 1, add items, fire round 2 | *two separate slips* from the one Pay Now — receipt **and** a `KITCHEN ORDER` / `Round 1` ticket, neither missing; round 2 prints **only** the new items | ☐ | ☐ |
| 3 | **VOID slip** | open tab with a fired item → void a line, with a reason | `*** VOID ***` / `CANCELLED ITEMS — DO NOT MAKE`, the **voided** qty, that line's modifiers and instructions, and **who voided it and when** (not the tab's opener) | ☐ | ☐ |
| 4 | **End of day, including a past date** | Dashboard → date box → **End of day**; then set the box to yesterday and print again | today: sales, payment split, **Dues collected** (Cash/Online), open tabs. Yesterday: that day's figures, open tabs "not applicable", dues labelled "as of print" | ☐ | ☐ |

- [ ] Sign-off recorded: date, device, Chrome + Firefox versions, printer model,
      who witnessed it.

### Hazards to check for, and what to tell the client

- [ ] **Two slips, not one.** Path 2 is the one that historically failed: the
      receipt and the KOT are deliberately printed one after the other, never in
      the same instant. If only one slip appears, stop and report it — do not
      go live on "the cashier can reprint it".
- [ ] **Tablets and phones are not cleared for the counter.** On a mobile
      browser the print library reports "finished" on a fixed half-second timer
      instead of when the job actually ends, so a receipt-plus-KOT pair can
      overlap and one can be lost. Use a desktop/laptop browser at the counter.
      If the client insists on a tablet, they must print **one slip at a time**
      (fire the KOT, wait for paper, then settle) — and that is a workaround,
      not a supported configuration.
- [ ] **A slow logo stalls the print.** A broken logo URL prints the slip
      without it, but a *hanging* request holds the job. If prints hang, clear
      the logo in Settings and retest to confirm the cause.
- [ ] **Tell the cashier the retry rule, out loud:** if Pay Now shows an error or
      seems stuck, **check the Orders page for that sale before ringing it
      again**. A write that actually landed but lost its reply will become a
      second order if re-rung — there is no duplicate-request protection yet.

---

## §8 Day-1 dry run (DEPLOYER with the CAFE ADMIN watching)

Run a fake service on the real deployment. Use one practice customer so the
cleanup is easy.

- [ ] Counter sale: Pay Now, Cash → KOT + receipt (§7 path 1+2).
- [ ] Dine-in: seat a table, fire round 1, add round 2, settle.
- [ ] Item void with a reason → VOID slip, and the tab's total drops.
- [ ] Partial payment: settle a ₹500 tab with ₹300 collected → ₹200 becomes the
      **customer's due** (a customer must be attached — the app asks).
- [ ] `Customers` → **Receive payment** → collect the ₹200 in Cash → the due
      clears. ⚠️ **This records real money on the real deployment and cannot be
      undone** (§11). The amount stays in that day's "Dues collected" and in
      Reports permanently. Use the smallest practical amount, run the dry run
      before the client's first trading day if you can, and otherwise write the
      practice figure on the handover sheet so their first drawer tally
      reconciles.
- [ ] Dashboard → **End of day** → that ₹200 shows under **Dues collected**.
      *This is the drawer tally* — cash received against an old due is real cash,
      and it has to appear on the closing slip.
- [ ] Cancel an order (admin, reason required) → grey **Cancelled** badge, the
      order disappears from Reports totals, and a reprint is stamped
      `*** CANCELLED ***`.
- [ ] Orders page: date filter, table filter, status filter, phone search, and
      **Load more** past the first 50 rows.
- [ ] `Reports` → **Generate report** → **Download CSV** opens in their
      spreadsheet app.
- [ ] Product photo upload works (this is what proves the R2/Cloudinary CORS
      rule, not just the env var).
- [ ] `apps/cafe/DEPLOY.md` §2 smoke list ticked end to end.
- [ ] **Cleanup: cancel every practice order** (with a reason like "practice").
      Cancelled orders stay in the ledger but count for nothing in Reports, the
      closing slip, or customer spend — there is no delete button, on purpose.
      **But cancelling reverses ORDERS only.** The practice dues receipt above
      is not reversed by it and stays on that day's "Dues collected"; a customer
      balance reading zero is *not* evidence it was undone, because the balance
      is floored at zero either way. Note anything left behind on the handover
      sheet.

---

## §9 Backups and keep-alive (OWNER)

**Say this out loud to the client: the free Atlas tier has no automatic backups
and no point-in-time restore.** What follows is the entire safety net.

- [ ] **The workflows are actually live on GitHub.** They exist in this working
      tree, but Actions only runs what has been committed and pushed — open the
      repository's Actions tab and confirm both jobs are listed and have a run
      history. If they are not there, **nothing is backing anything up**, no
      matter what the files on disk say. Fix that before ticking anything below.
- [ ] **These jobs are SINGLE-TENANT — read this before you touch a secret.**
      `CORE_MONGODB_URI`, `BACKUP_PASSPHRASE` and the `R2_*` values are one set
      per repository, and `TENANT_ID` is a single object-key prefix. Setting them
      for *this* cafe stops the nightly job covering any cafe onboarded
      earlier — silently, with the Actions tab still showing green. Until
      per-tenant coverage is automated, a second cafe needs its **own** copy of
      these workflows (a separate repo, or duplicated workflow files with
      per-cafe secret names). **If another cafe is already live on this repo, do
      not overwrite its secrets — stop and resolve it with the owner.**
- [ ] **Backups go to a SEPARATE, NON-PUBLIC bucket.** The image bucket from §0
      is public-read and its base URL ships inside the client's JavaScript, so
      anything in it is anonymously downloadable at a guessable key. Create a
      second R2 bucket with **no public access** and its own scoped token, and
      use those values below — they are *not* the app's `R2_*` env vars, despite
      the identical names.
- [ ] Repo **secrets** (Settings → Secrets and variables → Actions → *Secrets*):
      `CORE_MONGODB_URI` (the client's SRV), `BACKUP_PASSPHRASE` — generate it
      (`openssl rand -base64 33`) and keep it in the owner's vault, because it is
      the only thing protecting a full copy of the customer database — and
      `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
      for that private bucket.
- [ ] Repo **variables** (the *Variables* tab — a value entered as a *secret*
      here is silently ignored): `TENANT_ID` = the client slug, which becomes
      the object-key prefix for their dumps. Leave it unset and every cafe's
      backups collide under the same default prefix. `BACKUP_RETENTION_DAYS` is
      optional (14 if unset).
- [ ] `.github/workflows/db-backup.yml` run once manually → green, and an
      encrypted object actually landed in R2.
- [ ] `.github/workflows/db-keepalive.yml` run once manually → green. It exists
      to keep a free cluster from being paused for inactivity; its cadence is
      defined in that file and stated nowhere else.
- [ ] **Restore drill done at least once**: decrypt a dump and restore it into a
      scratch database. An untested backup is not a backup. Runbook:
      `scripts/db-hygiene/README.md`.
- [ ] Client told the recovery story in one sentence: worst case they lose up to
      one day of orders, and restoring is a manual operator job.
- [ ] Diary note: GitHub disables scheduled workflows after roughly 60 days
      without repo activity. A missing nightly run is a signal, not a hiccup.
- [ ] **Turn on Vercel usage alerts** (Account/Team → Settings → Notifications →
      Usage) and check the project's **Usage** tab weekly for the first month.
      The dashboard holds several always-on 30-second polls, and a free plan's
      compute allowance can be exhausted mid-month — if that happens the site can
      stop serving until the allowance resets, and upgrading is the only quick
      remedy. Better to see it coming than to hear it from the cafe.

---

## §10 Handover pack

- [ ] URL, admin username, and confirmation the password was changed by them.
- [ ] The five-minute guide: **Settings → Staff → Menu (form or CSV)**.
- [ ] Printer configuration written down (which browser, which paper size,
      whether kiosk printing is on) — a fresh Windows profile loses it.
- [ ] Support boundary agreed, and what to send when something breaks:
      screenshot, order id, and the time.
- [ ] Accepted platform realities stated plainly: hosting is on a free
      non-commercial tier (upgrade path exists), one region (`AP_SOUTH_1`),
      512 MB of database, backups per §9, and no offline mode — **the POS needs
      internet**.

---

## §11 Limits to state out loud (v1 behaviour, by design)

Not bugs. Say them before the client discovers them mid-service.

- **A received dues payment cannot be reversed.** The collection log is
  append-only. Cancelling an order whose due was already collected leaves the
  customer in credit, and every screen reports the due as zero.
- **Deleting a customer is permanent**, and any staff account can do it (it is
  refused only while they owe money). There is no archive and no undo — the
  visit and spend history goes with them.
- **The business day is fixed IST midnight → midnight.** A sale rung at 12:30 AM
  lands on the *next* day's dashboard, closing slip and Reports. A cafe trading
  past midnight should print the closing slip before 12:00 AM, or expect the
  late sales on tomorrow's figures. A configurable cutover hour is a later
  update.
- **Renaming or deleting a table never rewrites history.** Old bills keep the
  old name.
- **Table names are ASCII only.**
- **Declining the "free the table?" prompt** after a counter sale leaves the
  table Occupied — free it from the Tables page.
- **A discount on a tab that is later voided down re-clamps to the smaller
  total**, and later rounds bill that smaller discount.
- **Cancelled orders count for nothing** in Reports, the end-of-day slip, and
  customer spend — that is the point of cancel-instead-of-delete.
- **Only an admin can cancel an order or permanently remove one**; staff void
  individual items instead.
- Orders are stored in the current money format; a future platform update
  migrates them. No action for the client.

---

## §A Pinned facts

These values are asserted against source by
`apps/cafe/lib/go-live-runbook.test.ts`. If a value here and the code disagree,
the test fails — fix the code or this file, never just this file.

| Fact | Value | Source symbol |
|---|---|---|
| CSV header row | `name,category,price,discount,image,modifiers,isActive` | `IMPORT_COLUMNS` |
| Modifier separator | `\|` | `MODIFIER_SEPARATOR` |
| Max import rows | 1000 | `MAX_IMPORT_ROWS` |
| Import columns that are required | name, category, price | `createProductSchema` |
| Table name pattern | `^[A-Za-z0-9][A-Za-z0-9 _-]*$` | `TABLE_NO_PATTERN` |
| Table name max length | 24 | `TABLE_NO_MAX_LEN` |
| Seats range | 1–99 | `TABLE_CAPACITY_MIN` / `TABLE_CAPACITY_MAX` |
| Table extra charge max | 10000 | `TABLE_CHARGE_MAX` |
| Charge name max length | 24 | `TABLE_CHARGE_LABEL_MAX_LEN` |
| Charge is taxed | no — added after GST | `computeOrderTotals` |
| Unnamed charge | not charged at all | `tableChargeOf` |
| Starter tables | `T-1 … T-8` (8) | `TABLE_NUMBERS` |
| Starter table capacity | 4 | `apps/cafe/scripts/seed-tables.ts` |
| Busy-table message | Free the table before renaming or removing it | `TABLE_BUSY_ERROR` |
| Health OK contract | `ok: true` · `db: "up"` | `app/api/health/route.ts` |
| Seed admin password policy | ≥8 chars · ≥1 digit · ≥1 special | `apps/cafe/scripts/seed-admin.ts` |
| Staff password minimum | 8 | `createStaffSchema` |
| Username minimum | 3 | `createStaffSchema` |
| Mobile minimum | 10 | `createStaffSchema` |
| Customer mobile mask (staff, non-admin) | first 5 chars shown, rest `*` — `9876543210` → `98765*****` | `MOBILE_VISIBLE_PREFIX` / `MOBILE_MASK_CHAR` |
| Admin-only screens | `/staff`, `/reports`, `/settings` | `ADMIN_ROUTES` |
| Slugs that never resolve to a cafe | www, app, api, admin, hub | `RESERVED_SUBDOMAINS` |
| Dues receipt modes | Cash, Online | `DUES_RECEIPT_MODES` |
| GST rate quick picks | 0, 5, 12, 18, 28 | `GST_RATES` |
| Settings max lengths | name 60 · tagline 80 · mobile 20 · address 200 · header 200 · footer 120 · GSTIN 20 · FSSAI 20 | `settingsSchema` |
| Image downscale / size cap | 600 px · 2 MB | `IMAGE_MAX_DIMENSION_PX` / `MAX_IMAGE_BYTES` |
| Print page setup | `@page { size: 80mm auto; margin: 4mm; } @media print { body { margin: 0; } }` | `RECEIPT_PAGE_STYLE` |
| Seed commands | `seed:admin`, `seed:tables` | `apps/cafe/package.json` |
