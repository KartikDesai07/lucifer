import { test } from "node:test";
import assert from "node:assert/strict";

import { shortStaffName, staffInitials } from "@/lib/staff-display";

test("shortStaffName: first name plus the surname initial", () => {
  assert.equal(shortStaffName("Priya Sharma"), "Priya S.", "two words");
  assert.equal(shortStaffName("Priya"), "Priya", "one word stays");
  assert.equal(shortStaffName("  rohan   kapoor "), "rohan K.", "trim, collapse, keep first name as given");
  assert.equal(shortStaffName(""), "", "empty stays empty");
});

test("staffInitials: two letters, or ? for nothing", () => {
  assert.equal(staffInitials("Priya Sharma"), "PS", "first and last initials");
  assert.equal(staffInitials("Priya"), "PR", "one word gives its first two letters");
  assert.equal(staffInitials(""), "?", "empty gives a question mark");
  assert.equal(staffInitials("  rohan   kapoor "), "RK", "upper-cased and collapsed");
});

// U0 match Task 10, ruling R29: a sign-in tile shows the short name ("Priya S."); two tiles on screen that would read
// the same show their full names instead, so nobody picks the wrong person.
test("tileNames: the short name, or the full name when another visible tile shares it", async () => {
  const { tileNames } = await import("@/lib/staff-display");
  const people = [
    { id: "a", name: "Priya Sharma", shortName: "Priya S." },
    { id: "b", name: "Priya Singh", shortName: "Priya S." },
    { id: "c", name: "Rohan Kapoor", shortName: "Rohan K." },
  ];
  const names = tileNames(people);
  assert.equal(names.get("a"), "Priya Sharma", "the first Priya S. reads in full");
  assert.equal(names.get("b"), "Priya Singh", "the second too");
  assert.equal(names.get("c"), "Rohan K.", "a unique short name stays short");
  assert.equal(tileNames([people[0], people[2]]).get("a"), "Priya S.", "alone on screen (a filter hides her twin), short again");
  assert.equal(tileNames([]).size, 0, "nobody, no names");
});
