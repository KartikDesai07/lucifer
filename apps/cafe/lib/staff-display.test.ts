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
