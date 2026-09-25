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
      What the cafe loses until a store is configured: **product photos only**.
      Both logos — the restaurant's mark (bills, kitchen tickets, sidebar) and
      the product's mark (browser tab, login screen) — are stored in the
      cafe's **own database** and need no R2/Cloudinary account at all; a cafe
      with no image store configured still prints a logo on every receipt.
      Adding a store later needs a **redeploy**, because the public base URL is
      a `NEXT_PUBLIC_*` value baked in at build time — this does **not** apply
      to the logos, since the branding route is same-origin and needs no
      `NEXT_PUBLIC_*` value.
- [ ] **A host, decided.** The app resolves *which cafe it is serving* from the
      request host, so the host and two env vars have to agree. Two supported
      shapes:
      The owner console now defaults every new cafe to shape (B), on the ONE
      apex domain recorded in `clients/_platform.json` (console: ⚙ Platform) —
      shape (A) still works and is what an existing cafe keeps until its web
      address is set.
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

> **The one-command path.** `npm run go-live -- <client>` (or double-click
> `go-live.cmd`) does every box below except the WAF rules and the R2 CORS rule,
> and also runs the §2 seed — from a single `clients/<client>.json` you fill in
> once (`scripts/go-live/client.example.json` is the template, `demo.example.json`
> a ready demo café). It reads the assigned domain so `TENANT_ID` can never
> disagree with the host, and ends with the `/api/health` check. Details:
> `apps/cafe/DEPLOY.md` §1. Tick the boxes below by reading its summary.

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
- [ ] **The 3 free Vercel WAF custom rules for the public QR-ordering surface**
      created — Project → **Security** → **WAF** → Custom rules — blocking
      obvious abuse patterns against `/m` and `/api/public/*` (the public menu
      and diner order endpoints). Hobby gets 3 custom rules + 3 IP blocks;
      native rate limiting is Pro.
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
| Restaurant logo | — | bills, kitchen tickets, sidebar |
| Product logo | — | browser tab, login screen |
| Show GST on bills | — | enables the tax block |
| GST number | 20 | receipt, **only on bills that carried GST** |
| GST rate (%) | 0–100 (quick picks 0/5/12/18/28) | tax maths |
| GST mode | inclusive / exclusive | how the total is composed |
| FSSAI number | 20 | receipt, under GSTIN — **independent of the GST toggle** |
| Show prices on KOT | off by default | kitchen ticket |
| Appearance preset | 6 choices | sets the public (QR) menu's colors, both light and dark |
| Font pair | 6 choices | sets the public menu's typography |
| Hero image | 1200 px longest edge · 1 MB | banner shown at the top of the public menu |
| Self-order mode | approve / auto / menu | how a diner's QR order reaches the kitchen ("menu" = browsing only, ordering off) |
| Let diners pick a table | on / off | whether the shared menu link lets a diner pick or change their table |
| Show past orders to diners | reserved — no diner screen exists yet | — |
| Promo codes | ≤20 codes, uppercase, percent or flat, whole rupees | discount a diner can type in at checkout |
| Announcements on the QR menu | up to 3 banners, title 40 chars + one line 90 chars | shown on the diner Home tab of the QR menu (Settings > QR ordering) |

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
- [ ] **Restaurant logo uploaded.** This is the mark printed on bills and
      kitchen tickets, and shown in the sidebar. Pick a wide, high-contrast
      image — it prints monochrome at roughly 120×56 px on an 80 mm roll.
- [ ] **Product logo uploaded — or deliberately left blank.** This is the mark
      shown in the browser tab and on the login screen, not on any receipt.
      Leaving it empty is fine: the app then serves its own built-in mark, so
      the tab never shows a framework default.
- [ ] **Both logos**, whichever is uploaded: PNG, JPEG and WebP only. The
      browser downscales to `IMAGE_MAX_DIMENSION_PX` (600 px, longest edge) and
      re-encodes before upload; a logo must land under `MAX_BRANDING_BYTES`
      (512 KB) after that resize.
- [ ] Both logos are stored in the cafe's **own database** — no Cloudflare R2 or
      Cloudinary account is needed for either one. Menu-item photos still need
      one of those configured (§0).
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

### Arranging the floor plan (admin only)

- [ ] **Arrange** (top right of `Tables`) turns the tile grid into a list with
      up/down arrows — the same interaction as the `Categories` screen. **Done**
      switches back.
- [ ] Tell them what it is FOR: this order is also the order tables appear in
      **the POS table picker**, so the tables they run busiest belong at the top
      and staff stop hunting for them mid-rush.
- [ ] Each arrow tap saves immediately (no Save button). If a save fails the row
      snaps back and a toast says so — nothing is left half-arranged.
- [ ] A table added later lands at the **end** of the arrangement, never at the
      top. Un-arranged floor plans stay in plain name order, so this is safe to
      never touch. Note that plain name order is alphabetical, so `T-10` sorts
      before `T-2` — arranging is how a cafe fixes that.
- [ ] Arranging is admin-only, and it never touches occupancy: a table's status,
      its open tab, and its charge are all untouched by moving it up or down.

### Moving a live tab to another table (ANY staff)

- [ ] Tell them where it is: `POS` → resume the tab → the table button in the
      header becomes **Move table**. Also on `Orders` → open the order →
      **Move table**. Only for a tab that is still open and already has a table.
- [ ] Only **free** tables can be picked. A table already running a bill, or
      reserved, is refused with the reason — the app never silently moves one
      tab onto another's table.
- [ ] The kitchen gets a **TABLE MOVED** slip naming the old → new table. It
      deliberately lists **no items**, so nobody cooks the order twice. Tell them
      to hand it over rather than shout across the pass.
- [ ] **A move never changes the bill.** If the tab was opened with a table
      charge it keeps that charge and that name; if the new table has a charge,
      moving does **not** add it. Changing what a bill is charged is still only
      the cart's charge row (§4 above).
- [ ] A walk-in tab (no table) cannot be moved — the button is greyed. Seating a
      walk-in tab is not supported in v1.

### QR codes for the tables (admin only, `Tables` → `QR codes`)

- [ ] `Tables` → **QR codes** → **Print** — one A4 sheet, rendered in an
      isolated print iframe so no admin sidebar or header ever reaches the
      paper. A table with no QR minted yet shows **Generate QR** instead of a
      code; tap it once, then print.
- [ ] Cut along the grid: **one sticker per table**, stuck on that table only.
- [ ] Tell them: any extra or unrecognised code stuck on a table is
      suspicious — a fraudulent sticker pasted over the real one is a
      documented real-world attack, and software cannot catch it.
- [ ] **Regenerating a table's token instantly kills the printed sticker.**
      The old code stops resolving the moment a new one is minted — print and
      stick the replacement before removing the old one, or that table goes
      unscannable in between.

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

### Items sold in sizes (variations)

- [ ] Where: the product form's **Has variations** switch. Each row is a *name*
      the operator picks at order time plus that size's **own price** (Small 109
      / Large 149). Up to 20 rows; two rows cannot share a name.
- [ ] Tell them the base **Price** field stops being what a guest pays once
      variations are on — the picked size's price is what bills. Keep it as the
      reference/default figure.
- [ ] Tell them what the POS then does: the menu tile shows a **price range**,
      and tapping it **forces** a size choice — there is no default, so nobody
      can accidentally sell a Large at the Small price. **Add** stays disabled
      until a size is tapped.
- [ ] Two sizes of one dish are **separate cart lines** at their own prices.
- [ ] The size prints on the **KOT**, the **customer bill**, the **VOID slip**,
      and shows in the cart, the order sheet and the void trail — everywhere the
      dish name appears.
- [ ] Reports: **Top Products** lists each size as its own row, so they can see
      which size actually sells.
- [ ] Turning **Has variations** OFF removes the sizes and puts the item back on
      its single base price. Say it out loud: this does **not** rewrite any past
      bill or any open tab — those keep the size and the price they were rung up
      with.
- [ ] The **CSV import cannot express variations** (there is no column for it).
      A re-import of an item that has sizes leaves its sizes untouched — it will
      not wipe them, and it cannot add them either. Sizes are set in the form
      only.
- [ ] If an admin renames or removes a size while a till is open, that till may
      still show the old one for up to 5 minutes. The order is then **rejected
      with a clear message** rather than billed wrong, and the menu refreshes
      immediately so the retry works. Tell them that message is expected, not a
      fault.

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
      - **Permanently delete a reservation or an event**, with no record of who
        did it.
      - Void a fired item (reason required, kitchen gets a VOID slip), receive a
        customer's dues payment, and print the end-of-day slip.
      - **Cancelling a whole order is admin-only**, as is resetting someone
        else's password, **deleting a category**, and **changing an existing
        customer's mobile number**. Staff can still add a NEW customer with a
        real number, and can still edit that customer's name and type — but
        the mobile field on an existing customer shows read-only with the
        hint "Only an admin can see or change the full number."
      - **A category can only be deleted once it has no products** — move its
        products to another category first. There is no cascade any more: a
        category with products still linked to it is refused with a count,
        never silently re-tagged.
- [ ] Password resets: admin resets any other account from the Staff row; each
      person can change their own from the sidebar account menu.
- [ ] Leavers get **deactivated**, not deleted, so their history keeps its name.
- [ ] Staff stay signed in for 30 days of use on a device; on a shared device
      use Log out when handing it over.
- [ ] A password reset does not sign out devices that are already signed in.
      To cut off a lost or stolen device, deactivate that staff account (it
      is signed out within about a minute), then reactivate it after the
      reset.

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
- [ ] Logged in on the counter device as a real staff account.

### Desktop app on the counter PC (preferred)

The counter PC can run the POS as a Windows app instead of a browser tab. It
prints slips silently — no dialog on every sale — and keeps printing while
another program is in front.

- [ ] Copy `POS-Software-Setup-<version>.exe` to the counter PC by hand (USB or
      the local network). It is never downloaded from anywhere.
- [ ] Run it. Windows SmartScreen says the publisher is unknown: **More info →
      Run anyway**, once. Installs for this Windows user only, no admin rights.
- [ ] First run asks for the **Server address** — type the app's address (for
      example `https://your-pos.example.com`) and choose **Use this address**.
- [ ] Log in once as a real staff account. The sign-in lasts 30 days and renews
      with use, so the PC stays signed in.
- [ ] **Settings → Printer setup** → **Use this PC** (this PC becomes the print
      host), then pick the thermal printer under **Printer for this PC**, then
      **Test print**. The card must confirm silent printing is on. If nothing
      comes out, no printer was picked, or a file-saving device (Microsoft
      Print to PDF, XPS, OneNote, Fax) was — those cannot be chosen; pick the
      real printer and test again. The Windows **default** printer no longer
      matters: the app prints only to the printer chosen here.
- [ ] **Print method — leave it on "Direct to printer" (the default).** From
      installer **1.10.0** each slip goes to the printer as an image over
      ESC/POS, straight into the Windows print queue, so the paper is exactly
      as long as the slip and the driver's paper size no longer matters — no
      Printing-preferences change is needed on a new PC. Every job is logged
      with `mode=direct` and its raster size, e.g. `page=576x1321 dots (~165mm)`.
      Why this replaced the driver: a POS80 shipped set to **Letter** on
      2026-09-19 and the driver ignored the size the app asked for — a 32-item
      bill printed only 23 items and silently lost the rest, and with a custom
      80 x 297mm form a 4 cm slip still came out on a 297 mm page. No app or
      driver setting makes that lane follow the content.
- [ ] Switch to **"Through the Windows driver"** only if a printer prints
      blank or garbled paper in direct mode (it does not understand ESC/POS).
      On that lane the driver's own paper size decides the paper length, so
      then set it in Windows → Printers → the thermal printer → **Printing
      preferences**: roll size **80 mm** (or 58 mm for narrow paper), margins
      none, and never a `3276mm`-long form — a 3.27 m page can feed metres of
      blank per slip. The browser print-dialog settings above do not apply to
      the desktop app.
- [ ] If a slip cannot be printed (printer off, paper out, wrong printer), a
      Windows **notification** from the app says why even while its window is
      hidden, and the slip stays on the Orders page to print again. For
      support, the app's log is `%APPDATA%\POS Software by sandbee\pos-desktop.log`.
- [ ] A slip is never sent to the printer blank. From installer **1.0.1** the
      app checks that the slip has actually drawn text before printing; if it
      has not, the notification says **"That slip had nothing to print."** or
      **"The slip did not finish drawing. Print it again."** — reprint it from
      Orders. Each successful print is logged with its text length and the
      printer it went to, so a blank sheet can be traced in the log.
- [ ] Closing the window keeps the app running in the tray, still printing.
      The tray icon has **Open POS** and **Quit**.
- [ ] After the first successful load the app starts hidden with Windows.
      **Help → Start with Windows** turns that off and on.
- [ ] **Help → Change server address…** if the address ever changes.
- [ ] Uninstall from Windows **Settings → Apps → POS Software by sandbee** (this
      also removes the app's start-with-Windows entry).
- [ ] Set the PC's power plan to never sleep, as below.

**If the desktop app cannot be installed** (an older Windows, a locked-down PC),
that counter has no silent printing: every slip opens the browser's own print
dialog and someone has to confirm it. The self-service Chrome kiosk-shortcut
wizard that used to be offered here was removed on 2026-09-19 — it predated the
desktop app, it could not choose a printer, and it was the main source of
confusion on the setup page.

### Installing the POS on the counter device

- [ ] Log in on the counter device, open `/pos` (the New Order screen) —
      install FROM this screen; the installed app opens on `/pos` every time.
- [ ] Chrome / Edge (Android and desktop): browser menu (⋮) → "Install app"
      (older builds: "Add to Home screen") → confirm. No service worker is
      required (Chrome 108+ on Android, 112+ on desktop). Result: the POS
      opens in its own window with no address bar; the icon is the generic
      product mark; the app's name is the cafe's name from Settings.
- [ ] Samsung Internet: menu → "Add page to" → "Home screen" (reported
      behaviour, not verified here).
- [ ] iOS Safari: Share → "Add to Home Screen". Keep-awake may not work in an
      installed app before iOS 18.4 — keep the screen timeout long on that
      device.
- [ ] Screen stays awake only while the POS window is visible and in the
      foreground; switching apps releases it and it re-acquires when you come
      back. It prevents display sleep only — the power button still locks the
      device.
- [ ] Renaming the cafe in Settings changes the name shown on the NEXT
      install; an already-installed icon may keep the old label until it is
      reinstalled.
- [ ] Sign-off: installed from /pos, opens without an address bar, screen
      still on after a quiet 5 minutes.

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

### Self-order alerts and auto-print (CR2.3 + print host, per device)

Diners can self-order from the QR menu; the counter is alerted to a new
request, and an accepted self-order's kitchen ticket can print without a
tap. How it prints depends on whether a print host is set
(**Settings → Printer setup** → the **Print host** card).

- [ ] **With a print host set**: the host PC prints every slip — KOTs,
      bills, void/moved slips, end of day — from ANY dashboard screen it has
      open, and every other device routes its prints to it (its band reads
      `Slips print at <label>.` with the host's label filled in). Non-host devices
      never auto-print; the **Auto-print self-orders** switch is disabled
      on the host itself because the host prints self-orders anyway.
      Designate and run the test print from inside the POS Printer window —
      it has its own browser profile, and the profile you designate is the
      one that prints.
- [ ] **Without a print host**: on the printer/counter device, keep the
      **POS** screen or the **Order requests** screen open. `Alerts and
      auto-print only work while this panel is open on this device — keep
      this screen open at the counter.`
- [ ] Without a host, on `Order requests` → **Device settings** (the button
      beside Refresh): switch **Auto-print self-orders** ON for this
      device — it defaults to **OFF**, so a device must be opted in before
      it starts firing tickets on its own.
- [ ] After opening the screen, tap it once anywhere — that click is the
      gesture that unlocks the alert sound (the browser blocks audio until a
      real click/keypress); without it the ping stays silent even with
      **Alert sound** ON.
- [ ] The counter PC checks for new print jobs every 3 seconds for an hour
      after the last print activity and every 15 seconds when idle (at most
      14,400 quick checks a day), so a bill sent from a phone prints within a
      few seconds while the counter is busy; if the counter is a browser tab
      and that tab is hidden it falls back to the 20-second refresh. The
      desktop app keeps the 3-second cadence in the tray.

### QR self-ordering — the diner device leg

Run this on the **live deployed site**, with a **cheap Android phone on the
cafe WiFi**, and the **counter device logged in**. Folds in the §20 a–f
counter-device checks, §21 Telegram acceptance, and the §22.6 browser legs —
one list, run once.

- [ ] **Print the QR sheet** (`Tables` → **QR codes** → **Print**) — one
      sheet, no admin sidebar on the paper, each cell whole across page
      breaks; stick **one** code per table.
- [ ] **Scan a table sticker with the phone** → the menu opens with that
      table's name and its charge line, no login.
- [ ] **Search** "cha" → results narrow; clear → full menu returns; a
      category tab and search work together.
- [ ] **Sold-out mid-session**: mark an item out of stock from admin → within
      ≤90s the tile stays visible, greyed, badged, and untappable; a line
      already in the cart drops with a notice; a *pending* order holding it
      now shows the "remove that item to save the rest of your order" copy on
      Save.
- [ ] **Order end-to-end**: ≤4 taps to submit → a short code → the status
      timeline Sent ✓ → Confirming… → Being prepared, advancing when staff
      accept.
- [ ] **Edit** the pending order (qty down, a note, a promo code), then Save;
      then try to edit it again after staff have opened it → the locked
      copy, not a stuck spinner.
- [ ] **On the printer/counter device** (§7's alerts/auto-print, above): (a)
      a diner submit pings within ≤20s; (b) badge, bar and tab title change
      with the tab hidden; (c) auto mode with the device toggle ON prints the
      KOT **once**, even with a second tab open; (d) cancelling the print
      dialog still allows a reprint; (e) toggle OFF still lets the bar's
      Print button work; (f) with the toggle off and no request pending, the
      bar stays invisible.
- [ ] **With a print host set** (PH-5..PH-9): the self-order KOT prints at
      the host from whichever dashboard screen the host has open; on a
      non-host device the Print button greys out on the tap and a status
      chip beside it in the alert band reads `Waiting for <label>` then
      `Sent to <label> ✓` — nothing prints locally.
- [ ] **Telegram acceptance** (needs a real bot): BotFather → `/newbot` →
      paste the token into **Settings → Notifications** on the **live site,
      never a preview** → connect a phone via the invite link → place a QR
      order → the connected phone pings.
- [ ] **Browser/theme legs**: dark-mode emulation AND a real dark-mode phone —
      the cart Drawer and a variation Sheet both paint the preset's **dark**
      tokens and the chosen font pair, matching the **light** rendering seen
      earlier; only the selected pair's `.woff2` downloads; saving Appearance
      reflects on `/m` within ≤45s or one reload; picking a hero image
      **without** Save leaves `/m` unchanged; dragging the accent picker
      shows no jank.
- [ ] **Staleness / edge re-check**: after a Settings save, time how long
      `/m` keeps serving the old GST/table-change setting — confirm ≤90s, and
      that a submitted order's **server** quote is always live regardless.
      Note whether Vercel's CDN caches `/api/public/menu` at all — this rests
      on `max-age` with no `s-maxage`, and is not proven either way.
- [ ] Record: date, phone model, Android/Chrome version, WiFi network, who
      witnessed it.

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
- [ ] Once a month glance at Vercel → Usage → Function Invocations; if it
      trends above 80% of the free 1,000,000, tell the developer (the counter
      PC's quick-check cap can be lowered in one constant).

### DL rehearsal: master-data bootstrap + link migration dry run

DL-1 shipped one `GET /api/bootstrap` call that feeds every screen's master
data (settings, categories, products, tables; staff too, but only for an
admin) at login and on a page refresh, keeping a copy on the device (the
browser's local storage) for up to 24 hours so the next launch paints at
once. The staff list is never stored on the device — it stays in memory for
that tab only. The stored copy is cleared on sign-out and whenever the sign-in
page opens, so the next person on a shared device starts fresh; a launch with
a copy older than a day simply fetches again. No database shape changed in
DL-1.

A separate, owner-run script looks at how every collection links to another
one:

```
npm run migrate:links -- --dry-run --uri "<mongodb uri>"
```

This is read-only and safe to run against the live database. It prints a
one-screen summary and writes a report file named
`migrate-links-report-<db>-<timestamp>.json` in the folder you ran it from.
The database URI itself is never printed, on screen or in the report.

The report tells you: which links in each collection are still plain text
versus already a proper database id; orphans (a link pointing at a parent
that no longer exists); product category names that have no matching
Category record; category names that differ only by case or spacing (for
example "Coffee" and "coffee" counted as two); receiver names on old orders
matched against today's staff list — one clear match, several possible
matches, or no match at all; and tables whose current order points at a bill
that is closed or missing.

**`--apply` runs the real pipeline** — it writes to the database. It needs
two gates: `--backup <archive>` must name a mongodump archive file under 60
minutes old (or `--backup auto`, which runs mongodump for you when it is
installed), and `--confirm <dbName>` must repeat the database name from the
URI. Three more flags control what it does:

- `--create-missing-categories` — a product category name with no matching
  Category record gets one created for it (added after the existing
  categories in display order) instead of being skipped and listed.
- `--reset default|<comma list>` — empties the named transactional
  collections after the category back-fill. The DEFAULT list is `orders,
  duepayments, orderrequests, promoredemptions, printjobs, counters,
  customers`. **The owner confirms this exact list before DL-3** — resetting
  `customers` also removes their dues history, and resetting `orders` also
  frees every table (clears its current order and marks it Available).
  Without `--reset`, no transactional collection is touched.
- `--drop-legacy-category` — removes the old `category` text field and its
  index, but only once every product carries a proper category id; otherwise
  it refuses and changes nothing.

`--backup auto` writes its archive to the **OS temp directory (outside the
repo)**, never the folder you ran the command from, and prints the full path
it chose. That archive is a **FULL copy of the live database** — customer
names, mobile numbers, order and dues history — so treat it exactly like the
nightly backup it resembles: **move it to secure storage off this dev box
before the deploy step**, and never leave it sitting in temp past the
rehearsal or live run it was taken for.

MongoDB Database Tools (mongodump and mongorestore) must be installed on the
machine that runs the rehearsal; this repo's dev machine has only mongod. To
satisfy that: download the portable Database Tools build for your OS and put
its `bin` folder on `PATH` — `--backup auto` resolves a bare `mongodump` from
`PATH`, and refuses with a clear message if it cannot find one.

Before any rehearsal, take a fresh backup with the same command this repo's
nightly job uses:

```
mongodump --uri="$URI" --gzip --archive="$FILE" --readPreference=secondaryPreferred --quiet
```

**Rehearsal (safe, scratch-only):** restore the owner's live dump into a
local `pos_scratch_` database —

```
mongorestore --gzip --archive=<file> --nsFrom="pos.*" --nsTo="pos_scratch_migrate.*"
```

— then run the same pipeline the live runbook uses, against that scratch
database only:

```
npm run migrate:links -- --uri "mongodb://127.0.0.1:27017/pos_scratch_migrate" --apply --backup <file> --confirm pos_scratch_migrate --reset default --create-missing-categories
```

Expect exit code 0 and `categoryIdMissing 0` in the report. `npm run
verify:migrate:live` rehearses the same pipeline end-to-end against a
synthetic (not the owner's) fixture, and stands in a plain file for
`--backup` — that stand-in is rehearsal-only; on the live database
`--backup` must always be a real `mongodump --gzip --archive` file.

**Live runbook (DL-3, closed-shop window):** step 2 is flag-identical to the
rehearsal command above (same `--create-missing-categories`) — a rehearsal
that exits 0 predicts the live run only when the two commands actually match.

1. Close the shop to new orders, then take a fresh mongodump (the exact
   command above).
2. `npm run migrate:links -- --uri "<live uri>" --apply --backup <file> --confirm pos --reset default --create-missing-categories`
   - **If this exits non-zero: STOP — do not deploy.** Read the report,
     resolve the category names it names (create them by hand or fix the
     spelling on the product), then re-run the same command. See the exit-code
     notes below for what may already have changed before you retry.
3. Deploy the DL-2 build within minutes of step 2 — the new build is the one
   that reads `categoryId` instead of `category`.
4. Post-deploy, run `--dry-run` again and confirm the report shows 0
   `categoryIdMissing` and 0 remaining string-shaped refs.
5. Once the new build is confirmed live, run
   `npm run migrate:links -- --uri "<live uri>" --apply --backup <fresh file> --confirm pos --drop-legacy-category`
   to remove the old `category` field for good.
6. **Live rollback:** if the run cannot be recovered by re-running (see the
   exit-1 note below), restore the step-1 mongodump back into the LIVE
   database — `mongorestore --uri="<live uri>" --gzip --archive=<step-1 file>
   --drop` — before doing anything else. Every other mongorestore in this
   document targets a scratch database; this is the one that goes back into
   production.

**Every step here is idempotent.** If a run is interrupted for any reason —
a dropped connection, a killed terminal, a crashed machine — take a fresh
mongodump and re-run the identical command. Products that already carry an
ObjectId `categoryId` are skipped, not re-processed, and an already-empty
reset collection deletes nothing extra. Re-running is always the first thing
to try.

**Exit codes:** `0` = clean (dry run finished, or apply ran and the post-apply
census is clean). `1` = refused-or-failed: most `1`s are refused BEFORE
anything changed (a bad flag, a stale or missing backup, a `--confirm`
mismatch, a connection failure), each read-only. A **`--reset` refusal** is
also safe: the screen says "`--reset` was refused … nothing was deleted" and
a report IS written — **do NOT restore**; fix the named category names (or
add `--create-missing-categories`) and run step 2 again. The unsafe exit `1`
is a run that **failed part-way through** after `--apply` started: the
back-fill and/or `--reset` may already have run and NO report is written.
**If exit 1 shows no report and no "refused" line, restore the mongodump
from step 1 before re-running or deploying** — re-running on a partly reset
database reports clean without restoring what `--reset` deleted. `3` =
apply ran but the result is not fully clean — this covers every case the
post-apply census can flag: some category names were still skipped (no
matching Category doc, or a name collision), an orphaned or otherwise
unresolved link remains, a requested `--drop-legacy-category` was refused
because a product still lacks an ObjectId `categoryId`, a `--reset`
collection still holds documents afterwards (the signal that a write landed
during the closed-shop window), a collection still carries String-shaped
link values, or `orders.sourceRequestIds` still holds entries that are not
ObjectIds (the double-accept fence cannot match those, so the same request
could be accepted twice) — the report names exactly what is left;
re-run with `--create-missing-categories` or resolve the named collisions by
hand, then apply again.

`scripts/verify-migrate-links-live.ts` (`npm run verify:migrate:live`) is the
rehearsal leg above, automated end-to-end.

These facts are pinned by their own heading-scoped test and are
intentionally not duplicated into the §A table below.

---

## §10 Handover pack

- [ ] URL, admin username, and confirmation the password was changed by them.
- [ ] The five-minute guide: **Settings → Staff → Menu (form or CSV)**.
- [ ] Printer configuration written down: **which PC is the print host, and which printer is chosen on it** (Settings → Printer setup), plus the paper size. A fresh Windows profile loses the printer choice.
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
- **A QR order is a request, not a placed order, until staff accept it.**
  Nothing reaches the kitchen or the ledger before that tap. Separately: the
  counter POS can still sell an item marked out of stock — that is a
  deliberate staff override, not a bug.
- **Clearing the phone's browser loses that device's order history.** There
  is no diner login on the public menu — a diner's own device is the only
  record of what they ordered.
- **Printing follows the print host.** With a print host set, the host PC
  prints from ANY dashboard screen it has open and no other device
  auto-prints or prints locally. Without a host, self-order alerts and
  auto-print only work on a device with a POS or Order requests tab open —
  nothing pings or prints on a device with neither screen open.

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
| Branding (logo) size cap | 512 KB | `MAX_BRANDING_BYTES` |
| Print page setup | `@page { size: 80mm auto; margin: 4mm; } @media print { body { margin: 0; } }` | `RECEIPT_PAGE_STYLE` |
| Seed commands | `seed:admin`, `seed:tables` | `apps/cafe/package.json` |
| Auto-print self-orders default | OFF | `readDevicePrefs()` (`lib/pos-device-prefs.ts`) |
| Self-order alert limitation | `Alerts and auto-print only work while this panel is open on this device — keep this screen open at the counter.` | `SELF_ORDER_ALERT_LIMITATION` |
| Telegram webhook secret header | `X-Telegram-Bot-Api-Secret-Token` | `TELEGRAM_SECRET_HEADER` |
| Telegram allowed updates | `message` | `TELEGRAM_ALLOWED_UPDATES` |
| Telegram invite link TTL | 24 hours | `TELEGRAM_INVITE_TTL_MS` |
| Telegram webhook path | `/api/telegram/webhook` | `app/api/telegram/webhook/route.ts` |
| Hero image longest edge | 1200 | `HERO_MAX_DIMENSION_PX` |
| Appearance presets | 6 | `PRESET_IDS` |
| Hero image byte cap | 1MB | `BRANDING_SLOT_MAX_BYTES.heroImage` |
| Public menu URLs | `/m` · `/m/<token>` | `PUBLIC_MENU_PATH` |
| Table QR token length | 14 | `PUBLIC_TOKEN_LENGTH` |
| Diner order code length | 10 | `PUBLIC_CODE_LENGTH` |
| Diner order caps | 30 lines · qty 20 | `PUBLIC_ORDER_MAX_ITEMS` / `PUBLIC_ORDER_MAX_QTY` |
| Diner submit rate limit | 8 per table · 20 parcel · per 10 min | `PUBLIC_ORDER_RATE_MAX` / `PUBLIC_ORDER_RATE_MAX_PARCEL` / `PUBLIC_ORDER_RATE_WINDOW_MS` |
| Pending request expiry | 12 hours | `PUBLIC_REQUEST_PENDING_TTL_MS` |
| Sold-out message | `"<item>" is sold out` | `SOLD_OUT_ERROR` |
| Diner status poll | manual refresh, 30s cooldown · 20 reads per 600s window, server-enforced | `PUBLIC_STATUS_REFRESH_COOLDOWN_MS` / `PUBLIC_STATUS_READ_MAX` |
| POS install manifest | `/api/manifest` | `MANIFEST_PATH` |
| Installed app opens at | `/pos` | `MANIFEST_START_URL` |
| Installed display mode | `standalone` | `MANIFEST_DISPLAY` |
| Print host job max age | 30 minutes | `PRINT_HOST_MAX_AGE_MS` |
| Print host offline threshold | 180 seconds (3 missed ~60 s throttled beats) | `PRINT_HOST_OFFLINE_MS` |
| Print-job drain feed cap (per pulse) | 10 | `PRINT_JOB_PULSE_LIMIT` |
| Print-job stale-band feed cap | 20 | `PRINT_JOB_STALE_LIMIT` |
| Queued print job retention | 12 hours | `PRINT_JOB_QUEUED_RETENTION_MS` |
| Desktop app installer | `POS-Software-Setup-${version}.exe` | `apps/desktop/package.json` (`build.nsis.artifactName`) |
| Print host silent-off warning | `Print host shows a dialog for every slip.` | `PRINT_HOST_SILENT_OFF_WARNING` |
| Print host active note | `Slips print at <label>.` | `PRINT_HOST_ACTIVE_NOTE` |
| Staff session lifetime | 30 days, rolling with use | `SESSION_MAX_AGE_SECONDS` |
| Print-job wake poll (counter PC) | every 3 seconds while busy, every 15 seconds when idle | `PRINT_WAKE_FAST_MS` / `PRINT_WAKE_SLOW_MS` |
| Print-job wake poll daily cap (per counter PC) | 14,400 quick checks per cafe-day, then every 15 seconds until the next day | `PRINT_WAKE_DAILY_CAP` |

---

## Telegram procedures (CR2.3b)

Settings → Notifications → Telegram alerts. Optional; the in-panel tray and
bell alerts work regardless of whether this is ever set up.

- **Rotating the bot token.** In Telegram, message **@BotFather** →
  `/token` → pick the bot → copy the new token it hands back. In the panel,
  paste that new token into the same "Connect a bot" field and save again —
  this re-validates it, mints a fresh webhook secret, and re-registers the
  webhook. The OLD token stops working the moment BotFather issues the new
  one, so do this back-to-back, not "at some point later."
- **`AUTH_SECRET` / `NEXTAUTH_SECRET` rotation.** The stored bot token and
  webhook secret are encrypted at rest under a key derived from that env var.
  Rotating it (a redeploy with a new secret) makes the stored credentials
  unreadable — the card shows **"Re-paste your bot token"** instead of the
  connected state. Nothing is lost: paste the same BotFather token back in
  and save. Every chat that was already connected (staff who tapped the
  invite link) stays connected — reconnecting the bot does not clear the chat
  list.
- **Always run Telegram setup from the LIVE deployed site, never a preview
  URL.** The webhook URL is derived from the request that clicked "Connect,"
  so setting it up from a Vercel preview deployment (`proj-hash-team.vercel.app`)
  registers a webhook that stops working the moment that preview is torn
  down. Connect, Repair, and Disconnect must all be run from the production
  domain.
