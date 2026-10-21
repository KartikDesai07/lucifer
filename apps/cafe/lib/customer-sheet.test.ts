// The customer sheet's words (U1 Task 10; values 8.2-8.3 in docs/superpowers/specs/2026-10-20-pos-html-values.md; owner
// Q1; rulings P34-P37): the HTML's where it has the element, from the rows on screen and the query typed.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_TITLE,
  NEW_CUSTOMER_TITLE,
  NO_MATCH_HINT,
  SKIP_CUSTOMER_LABEL,
  customerListCaption,
  mobileCountText,
  newCustomerLabel,
  noMatchText,
} from "@/lib/customer-sheet";

test("the list caption counts the rows on screen (ruling P34; upper-cased by its style)", () => {
  assert.equal(customerListCaption(0), "No matches", "none: the no-match line's caption");
  assert.equal(customerListCaption(1), "1 match", "one: singular");
  assert.equal(customerListCaption(8), "8 matches", "several");
});

test("the no-match line is the HTML's two lines, the query in curly quotes (ruling P34)", () => {
  assert.equal(noMatchText("zzz"), "No customer found for “zzz”.", "the first line names what was searched");
  assert.equal(NO_MATCH_HINT, "Add them as new, it takes 5 seconds.", "the second line");
});

test("the new-customer button names the query while one is typed (ruling P35)", () => {
  assert.equal(newCustomerLabel(""), "+ New customer", "nothing typed");
  assert.equal(newCustomerLabel("   "), "+ New customer", "only spaces: nothing typed");
  assert.equal(newCustomerLabel("zzz"), "+ New customer “zzz”", "a name query");
  assert.equal(newCustomerLabel(" 98201 "), "+ New customer “98201”", "trimmed, as the form is seeded");
});

test("the titles and the foot link are the HTML's (rulings P36, P37)", () => {
  assert.equal(CUSTOMER_TITLE, "Customer", "the search");
  assert.equal(NEW_CUSTOMER_TITLE, "New customer", "the add form");
  assert.equal(SKIP_CUSTOMER_LABEL, "Continue without customer", "the foot link (was Walk-In)");
});

test("the mobile count shows what today's rule counts, never more than 10", () => {
  assert.equal(mobileCountText(""), "0/10", "empty");
  assert.equal(mobileCountText("98765"), "5/10", "five typed");
  assert.equal(mobileCountText("9876543210"), "10/10", "ten: the rule passes");
  assert.equal(mobileCountText(" 98765 "), "5/10", "the rule trims, so does the count");
  assert.equal(mobileCountText("98765 4321"), "10/10", "the rule counts characters: ten pass, the count agrees");
  assert.equal(mobileCountText("+91 98765 43210"), "10/10", "never 15/10");
});
