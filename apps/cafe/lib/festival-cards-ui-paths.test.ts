import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

// CB-7 S6 session 3 (E2): source pins for the owner's Festival cards screen and the diner tile's title. Every pin is a
// predicate over comment-stripped source, run on the real file AND on an in-memory mutated copy that it must reject.
// Negatives carry a positive landmark. Needles that would match this file's own text are built by concatenation.

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8");
const code = (rel: string): string => stripComments(raw(rel));

const F = "components/customers/festival";
const PAGE = "app/(dashboard)/customers/festival-cards/page.tsx";
const CUSTOMERS = "app/(dashboard)/customers/page.tsx";
const HOOK = "hooks/use-reward-campaigns.ts";
const FORM_LIB = "lib/reward-campaign-form.ts";
const WALLET = "components/public/rewards/PublicCardWallet.tsx";
const FESTIVAL_FILES = readdirSync(path.join(CAFE, F)).sort().map((f) => `${F}/${f}`);
const OWN_FILES = [...FESTIVAL_FILES, PAGE, HOOK, FORM_LIB, "lib/festival-cards-view.ts"];
const LINE_CAP = 300;

type Pin = (src: string) => boolean;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pinned(label: string, src: string, pin: Pin, ...mutations: Array<(s: string) => string>): void {
  assert.ok(pin(src), `${label}: holds on the real source`);
  mutations.forEach((mutate, i) => {
    const mutated = mutate(src);
    assert.notEqual(mutated, src, `${label}: mutation ${i} changes the text`);
    assert.ok(!pin(mutated), `${label}: mutation ${i} is caught`);
  });
}

const edgePin = (spec: string, usage: string): Pin => (s) => new RegExp(`from "${esc(spec)}"`).test(s) && s.includes(usage);
function edge(fromRel: string, spec: string, usage: string): void {
  pinned(`${fromRel} -> ${spec}`, code(fromRel), edgePin(spec, usage), (s) => s.replace(`from "${spec}"`, 'from "x"'), (s) => s.split(usage).join("<Gone"));
}

test("PIN: reachability, Customers page -> Festival page (admin-only link) -> List -> Form -> Audience / Box fields -> the settings reward fields", () => {
  const link: Pin = (s) => /\{isAdmin && \(\s*<Button\b[^>]*>\s*<Link href=\{FESTIVAL_CARDS_PAGE\}>/.test(s) && /import \{[^}]*\bFESTIVAL_CARDS_PAGE\b[^}]*\} from "@pos\/shared\/reward-campaigns"/.test(s);
  pinned("customers page link", code(CUSTOMERS), link, (s) => s.replace("{isAdmin && (", "{true && ("), (s) => s.replace("href={FESTIVAL_CARDS_PAGE}", 'href="/customers"'), (s) => s.replace('from "@pos/shared/reward-campaigns"', 'from "x"'));
  assert.match(code(CUSTOMERS), /const \{ isAdmin \} = useAuth\(\);/, "landmark: isAdmin is the session's role check");
  assert.equal(raw("../../packages/shared/src/reward-campaigns.ts").includes('FESTIVAL_CARDS_PAGE = "/customers/festival-cards"'), true, "landmark: the constant is the page's own route");
  edge(PAGE, `@/${F}/FestivalCardsList`, "<FestivalCardsList");
  edge(`${F}/FestivalCardsList.tsx`, `@/${F}/FestivalCardForm`, "<FestivalCardForm");
  edge(`${F}/FestivalCardsList.tsx`, `@/${F}/FestivalCampaignRow`, "<FestivalCampaignRow");
  edge(`${F}/FestivalCardsList.tsx`, "@/hooks/use-reward-campaigns", "useRewardCampaigns()");
  edge(`${F}/FestivalCardsList.tsx`, "@/hooks/use-reward-campaigns", "useEndRewardCampaign()");
  edge(`${F}/FestivalCardForm.tsx`, "@/hooks/use-reward-campaigns", "useCreateRewardCampaign()");
  edge(`${F}/FestivalCardForm.tsx`, `@/${F}/FestivalAudienceField`, "<FestivalAudienceField");
  edge(`${F}/FestivalCardForm.tsx`, `@/${F}/FestivalBoxFields`, "<FestivalBoxFields");
  edge(`${F}/FestivalBoxFields.tsx`, "@/components/settings/rewards/RewardOptionFields", "<RewardOptionFields");
  edge(`${F}/FestivalBoxFields.tsx`, "@/components/settings/rewards/RewardTtlFields", "<RewardTtlFields");
  edge(`${F}/FestivalBoxFields.tsx`, "@/components/settings/rewards/RewardCostPreview", "<RewardCostPreview");
});

test("PIN: the Festival page is admin-only (AdminGuard wraps the whole body) and links back to /customers", () => {
  const pin: Pin = (s) => /<AdminGuard>\s*<MenuPageShell>[\s\S]*<FestivalCardsList \/>\s*<\/MenuPageShell>\s*<\/AdminGuard>/.test(s) && /<Link href="\/customers"/.test(s);
  pinned("page guard", code(PAGE), pin, (s) => s.replace("<AdminGuard>", "<div>").replace("</AdminGuard>", "</div>"), (s) => s.replace('href="/customers"', 'href="/"'));
  assert.match(code("components/shared/AdminGuard.tsx"), /if \(!isAdmin\) return null;/, "landmark: the guard renders nothing for a non-admin");
});

test("PIN: the hook calls the shared endpoint constants, never a hand-typed URL, and invalidates the list", () => {
  const pin: Pin = (s) =>
    /apiGet<RewardCampaignsData>\(REWARD_CAMPAIGNS_ENDPOINT\)/.test(s) &&
    /apiSend<RewardCampaignData>\(REWARD_CAMPAIGNS_ENDPOINT, "POST", body\)/.test(s) &&
    /apiSend<RewardCampaignData>\(rewardCampaignPath\(id\), "PATCH", \{ end: true \}\)/.test(s) &&
    (s.match(/invalidateQueries\(\{ queryKey: REWARD_CAMPAIGN_KEYS\.all \}\)/g) ?? []).length === 2 &&
    /staleTime: STALE_TIMES\.LIVE/.test(s) &&
    !/["'`]\/api\//.test(s);
  pinned("hook", code(HOOK), pin, (s) => s.replace("(REWARD_CAMPAIGNS_ENDPOINT)", '("/api/reward-campaigns")'), (s) => s.replace("rewardCampaignPath(id)", "`/api/x/${id}`"), (s) => s.replace('"PATCH", { end: true }', '"PATCH", {}'), (s) => s.replace("STALE_TIMES.LIVE", "STALE_TIMES.CUSTOMERS"));
});

test("PIN: no native date or select picker in any festival file; the dates use DatePicker and the choices use the shadcn Select", () => {
  assert.ok(FESTIVAL_FILES.length >= 5, `landmark: the festival folder is covered (${FESTIVAL_FILES.length} files)`);
  const native = ["type=" + '"date"', "type=" + '"datetime-local"', "<" + "select", "<" + "datalist", "type=" + '"month"'];
  const ownTsx = [...FESTIVAL_FILES, PAGE];
  for (const rel of ownTsx) pinned(rel, code(rel), (s) => /\bexport\b/.test(s) && native.every((n) => !s.includes(n)), (s) => `${s}\n<input ${native[0]} />`, (s) => `${s}\n${native[2]}>`);
  const form = code(`${F}/FestivalCardForm.tsx`);
  assert.equal((form.match(/<DatePicker\b/g) ?? []).length, 2, "landmark: both dates are the shared DatePicker");
  assert.match(form, /from "@\/components\/shared\/DatePicker"/);
  const audience = code(`${F}/FestivalAudienceField.tsx`);
  assert.match(audience, /<Select value=\{audience\}/, "landmark: the audience is the shadcn Select");
  assert.match(audience, /CAMPAIGN_AUDIENCES\.map\(/);
});

test("PIN: the form validates with rewardCampaignWriteSchema (lib) and the sheet submits only what campaignSubmit passes", () => {
  const lib: Pin = (s) => /from "@pos\/shared\/schemas\/reward-campaign\.schema"/.test(s) && (s.match(/rewardCampaignWriteSchema\.safeParse\(campaignWriteBody\(draft\)\)/g) ?? []).length === 2 && /return \{ ok: true, body: parsed\.data \}/.test(s);
  pinned("form lib", code(FORM_LIB), lib, (s) => s.replace("rewardCampaignWriteSchema.safeParse(campaignWriteBody(draft))", "({ success: true, data: campaignWriteBody(draft) })"), (s) => s.replace("body: parsed.data", "body: campaignWriteBody(draft)"));
  const sheet: Pin = (s) => /const result = campaignSubmit\(draft\);\s*if \(!result\.ok\) return;\s*try \{\s*await create\.mutateAsync\(result\.body\);\s*onClose\(\);/.test(s) && /disabled=\{create\.isPending\}/.test(s) && /problems = attempted \? campaignProblems\(draft\)/.test(s);
  pinned("sheet submit", code(`${F}/FestivalCardForm.tsx`), sheet, (s) => s.replace("if (!result.ok) return;", ""), (s) => s.replace("create.mutateAsync(result.body)", "create.mutateAsync(draft)"), (s) => s.replace("disabled={create.isPending}", ""));
});

test("PIN: the list hides New campaign at the active limit, shows the not-earning notice (off, Tamil Nadu, platform) and the confirm dialog", () => {
  const pin: Pin = (s) =>
    /notEndedCount\(rows, nowMs\) >= CAMPAIGNS_ACTIVE_MAX/.test(s) &&
    /\{atLimit \? <p className=\{HINT_CLASS\}>\{LIMIT_REACHED_NOTE\}<\/p> : addButton\}/.test(s) &&
    // Review lens A LOW-2: the notice covers every reason cards are not given, so it reads the GSTIN and the platform switch.
    /const status = useRewardLevelsStatus\(\);/.test(s) &&
    /festivalNotice\(\{\s*accountsOn: settingsFormDefaults\(settings\.data\)\.dinerAccountsEnabled === true,[^}]*gstNumber: settings\.data\.gstNumber,[^}]*scratchBlocked: status\.scratchBlocked,/.test(s) &&
    /\{notice !== null && <p className=\{REWARD_NOTE_CLASS\}>\{notice\}<\/p>\}/.test(s) &&
    /<ConfirmDialog\b/.test(s) &&
    /<Skeleton\b/.test(s) &&
    /<EmptyState\b/.test(s);
  pinned("list", code(`${F}/FestivalCardsList.tsx`), pin, (s) => s.replace(">= CAMPAIGNS_ACTIVE_MAX", ">= 99"), (s) => s.replace("{atLimit ?", "{false ?"), (s) => s.replace("{notice !== null &&", "{false &&"), (s) => s.replace("scratchBlocked: status.scratchBlocked,", "scratchBlocked: undefined,"), (s) => s.replace("gstNumber: settings.data.gstNumber,", "gstNumber: undefined,"), (s) => s.replace("accountsOn: settingsFormDefaults(settings.data).dinerAccountsEnabled === true,", "accountsOn: true,"), (s) => s.replace("<ConfirmDialog", "<Dialog"));
  const row = code(`${F}/FestivalCampaignRow.tsx`);
  assert.match(row, /\{status !== "ended" && \(\s*<Button\b[^>]*onClick=\{\(\) => onEnd\(campaign\)\}/, "End now only while the campaign is not over");
  assert.ok(!/mobile/i.test(row), "the row never reads a mobile number");
});

test("PIN: the diner wallet tile shows the card's title (ready and revealed tiles), and no diner card view labels a card by level or step", () => {
  const pin: Pin = (s) => (s.match(/\{card\.title && <span\b/g) ?? []).length === 2 && /function ReadyTile\(/.test(s) && /function RevealedTile\(/.test(s);
  pinned("wallet title", code(WALLET), pin, (s) => s.replace("{card.title && <span", "{false && <span"), (s) => s.replace(/\{card\.title && <span/g, "{card.titleX && <span"));
  for (const rel of ["components/public/rewards/PublicScratchSheet.tsx", "components/public/rewards/PublicCardDetailSheet.tsx"]) {
    pinned(rel, code(rel), (s) => s.includes("card.title") || s.includes("card?.title"), (s) => s.replace(/card\??\.title/g, "card.name"));
  }
  const labels = ["components/public/rewards/PublicCardWallet.tsx", "components/public/rewards/PublicScratchSheet.tsx", "components/public/rewards/PublicCardDetailSheet.tsx", "components/public/rewards/card-detail-view.ts"];
  for (const rel of labels) assert.ok(!/Level \$\{|card\.level|card\.step/.test(code(rel)), `${rel} never reads a card's level or step`);
  assert.match(code("components/public/rewards/PublicCardWallet.tsx"), /function ReadyTile\(/, "landmark: the negative scan read the real wallet");
});

test("PIN: every festival file stays under the line cap, keeps LF endings, has no console.* and every Button is type=button or submit", () => {
  const CR = String.fromCharCode(13);
  const lineCount = (src: string): number => src.split("\n").length - (src.endsWith("\n") ? 1 : 0);
  assert.ok(OWN_FILES.length >= 9, `landmark: the whole set is covered (${OWN_FILES.length} files)`);
  for (const rel of OWN_FILES) {
    const src = raw(rel);
    assert.ok(lineCount(src) <= LINE_CAP, `${rel}: ${lineCount(src)} lines (cap ${LINE_CAP})`);
    assert.ok(!src.includes(CR), `${rel}: LF endings`);
    assert.ok(!/console\./.test(code(rel)), `${rel}: no console`);
  }
  for (const rel of FESTIVAL_FILES) {
    const tags = code(rel).match(/<Button\b[^>]*>/g) ?? [];
    for (const tag of tags) assert.ok(/\stype="(button|submit)"/.test(tag) || /\basChild\b/.test(tag), `${rel}: ${tag.slice(0, 60)} has a type`);
  }
  assert.ok((code(`${F}/FestivalCardForm.tsx`).match(/<Button\b/g) ?? []).length >= 2, "landmark: the button scan saw the form's buttons");
});
