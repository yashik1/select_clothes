import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  dayFrom,
  dayOf,
  mergeWorn,
  monthGrid,
  relativeDay,
  wornByDay,
  ymd,
} from "../src/lib/calendar.ts";

/*
 * The calendar's arithmetic.
 *
 * None of this needs a database or a browser, which is the reason it was pulled
 * out of the component: the two things most likely to be wrong here — what
 * counts as a day, and what counts as having been worn on one — are pure
 * functions, and they were both wrong at some point.
 */

describe("what day is it", () => {
  test("a plain date is taken at face value", () => {
    /*
     * The tempting implementation is `new Date(stored)` followed by a format.
     * That is wrong for a plain date: `new Date("2026-09-20")` is parsed as UTC
     * midnight, so anywhere west of Greenwich it is the 19th, and every plan
     * would shift back a day for half the world.
     */
    assert.equal(dayOf("2026-09-20"), "2026-09-20");
    assert.equal(dayOf("2026-01-01"), "2026-01-01");
  });

  test("an instant is converted to the local day it fell on", () => {
    // Whatever the runner's zone is, the answer has to agree with what a person
    // in that zone would have called that moment.
    const instant = "2026-09-20T23:30:00.000Z";
    assert.equal(dayOf(instant), ymd(new Date(instant)));
  });

  test("9pm in Los Angeles is that Tuesday, not Wednesday", () => {
    /*
     * The bug this exists for, stated concretely. 21:00 on 2026-09-22 in
     * Los Angeles is 04:00 on the 23rd in UTC, so slicing the first ten
     * characters off the stored string files the outfit under the wrong day.
     */
    const stored = "2026-09-23T04:00:00.000Z";
    assert.equal(stored.slice(0, 10), "2026-09-23", "premise: UTC has already rolled over");

    const inLA = new Date(stored).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    assert.equal(inLA, "2026-09-22", "premise: it is still Tuesday there");

    // And `dayOf` agrees with whatever zone it is actually running in, rather
    // than with UTC.
    assert.equal(dayOf(stored), ymd(new Date(stored)));
  });

  test("a date that cannot be parsed degrades instead of throwing", () => {
    assert.equal(dayOf("wednesday-ish"), "wednesday-");
  });

  test("offsets cross a month end correctly", () => {
    const from = new Date(2026, 0, 31); // 31 January
    assert.equal(dayFrom(1, from), "2026-02-01");
    assert.equal(dayFrom(-31, from), "2025-12-31");
    assert.equal(dayFrom(0, from), "2026-01-31");
  });

  test("a leap day exists in 2028 and not in 2027", () => {
    assert.equal(dayFrom(1, new Date(2028, 1, 28)), "2028-02-29");
    assert.equal(dayFrom(1, new Date(2027, 1, 28)), "2027-03-01");
  });
});

describe("the month grid", () => {
  test("is always whole weeks", () => {
    for (let month = 0; month < 12; month++) {
      const cells = monthGrid(2026, month);
      assert.equal(cells.length % 7, 0, `${month + 1}/2026 produced ${cells.length} cells`);
    }
  });

  test("starts on a Monday and ends on a Sunday", () => {
    for (let month = 0; month < 12; month++) {
      const cells = monthGrid(2026, month);
      assert.equal(new Date(`${cells[0].date}T12:00:00`).getDay(), 1, "first cell is not a Monday");
      assert.equal(
        new Date(`${cells[cells.length - 1].date}T12:00:00`).getDay(),
        0,
        "last cell is not a Sunday",
      );
    }
  });

  test("a month beginning on a Sunday gets a six-day lead-in", () => {
    // The off-by-one that `(getDay() + 6) % 7` exists to prevent: with a
    // Sunday-first index, a month starting on Sunday would get no lead at all
    // and the 1st would land in Monday's column.
    const november = monthGrid(2026, 10); // November 2026 begins on a Sunday
    assert.equal(new Date("2026-11-01T12:00:00").getDay(), 0, "premise: the 1st is a Sunday");

    const lead = november.findIndex((c) => c.inMonth);
    assert.equal(lead, 6, `the 1st landed in column ${lead}`);
    assert.equal(november[6].date, "2026-11-01");
  });

  test("holds every day of the month exactly once", () => {
    const february = monthGrid(2028, 1); // a leap February
    const inMonth = february.filter((c) => c.inMonth).map((c) => c.dayNumber);
    assert.deepEqual(inMonth, Array.from({ length: 29 }, (_, i) => i + 1));
  });

  test("the days either side are marked as not belonging to it", () => {
    const cells = monthGrid(2026, 8); // September 2026 begins on a Tuesday
    assert.equal(cells[0].inMonth, false);
    assert.equal(cells[0].date, "2026-08-31");
  });

  test("survives a daylight-saving boundary", () => {
    /*
     * March in the northern hemisphere contains a 23-hour day. Built by adding
     * milliseconds, the grid would drift an hour per row and eventually skip or
     * repeat a date; built from Y/M/D components it cannot.
     */
    const march = monthGrid(2026, 2);
    const inMonth = march.filter((c) => c.inMonth).map((c) => c.dayNumber);
    assert.deepEqual(inMonth, Array.from({ length: 31 }, (_, i) => i + 1));
    assert.equal(new Set(march.map((c) => c.date)).size, march.length, "a date repeated");
  });
});

describe("what was worn on a day", () => {
  test("the server's record and a local confirmation do not double up", () => {
    /*
     * The bug, exactly.
     *
     * Confirming a plan writes the wear optimistically into a local override
     * and then calls `router.refresh()`. The refresh re-fetches the server
     * component, so the wear legitimately comes back in the props — but the
     * override is component state and survives it. A plain concatenation then
     * held the same ids twice, and every piece of that day's outfit rendered
     * twice, on the grid and in the panel, for the rest of the session.
     */
    const fromServer = { "2026-09-20": ["shirt", "trousers"] };
    const overrides = { "2026-09-20": ["shirt", "trousers"] };

    assert.deepEqual(mergeWorn(fromServer, overrides, "2026-09-20"), ["shirt", "trousers"]);
  });

  test("the override alone carries the day before the refresh lands", () => {
    // The moment between confirming and the server answering. Without this the
    // day would appear to go empty and then fill in again.
    assert.deepEqual(mergeWorn({}, { "2026-09-20": ["shirt"] }, "2026-09-20"), ["shirt"]);
  });

  test("the override does not hide what the server already knew", () => {
    // Two different outfits on one day: confirming the second must not erase
    // the first, which a straight override rather than a union would do.
    const merged = mergeWorn(
      { "2026-09-20": ["morning-shirt"] },
      { "2026-09-20": ["evening-dress"] },
      "2026-09-20",
    );
    assert.deepEqual(merged, ["morning-shirt", "evening-dress"]);
  });

  test("one garment in two wear logs on one day is listed once", () => {
    // The list is headed "Worn" and answers what you wore, not how many times
    // each piece was entered.
    //
    // The two instants are built from *local* clock times rather than written
    // as fixed UTC strings, because "9am and 7pm on the same day" is only one
    // day in some zones: 19:00Z on the 20th is already half past midnight on
    // the 21st in Kolkata, so a hardcoded pair would make this test assert the
    // opposite of what it means east of about UTC+5.
    const morning = new Date(2026, 8, 20, 9, 0).toISOString();
    const evening = new Date(2026, 8, 20, 19, 0).toISOString();
    const byDay = wornByDay([
      { date: morning, garmentIds: ["shirt", "jeans"] },
      { date: evening, garmentIds: ["shirt", "coat"] },
    ]);
    assert.deepEqual(mergeWorn(byDay, {}, dayOf(morning)), ["shirt", "jeans", "coat"]);
  });

  test("a day with nothing on it is empty rather than undefined", () => {
    assert.deepEqual(mergeWorn({}, {}, "2026-09-20"), []);
  });

  test("wear logs are binned by local day, not by the front of the string", () => {
    const logs = [{ date: "2026-09-23T04:00:00.000Z", garmentIds: ["shirt"] }];
    const byDay = wornByDay(logs);
    assert.deepEqual(Object.keys(byDay), [ymd(new Date("2026-09-23T04:00:00.000Z"))]);
  });
});

describe("how a day reads", () => {
  test("names the days around today", () => {
    assert.equal(relativeDay("2026-09-20", "2026-09-20"), "Today");
    assert.equal(relativeDay("2026-09-21", "2026-09-20"), "Tomorrow");
    assert.equal(relativeDay("2026-09-19", "2026-09-20"), "Yesterday");
    assert.equal(relativeDay("2026-09-24", "2026-09-20"), "In 4 days");
    assert.equal(relativeDay("2026-09-16", "2026-09-20"), "4 days ago");
  });

  test("a daylight-saving change does not make a day count as two", () => {
    /*
     * Anchoring both ends to local noon is what makes this hold: a 23-hour day
     * divided by 86,400,000 is 0.958, which `Math.round` brings back to one.
     * Anchored to midnight, the same subtraction can land on the wrong side of
     * the boundary entirely.
     */
    assert.equal(relativeDay("2026-03-29", "2026-03-28"), "Tomorrow");
    assert.equal(relativeDay("2026-10-25", "2026-10-24"), "Tomorrow");
    assert.equal(relativeDay("2026-03-30", "2026-03-28"), "In 2 days");
  });

  test("counts across a month and a year boundary", () => {
    assert.equal(relativeDay("2027-01-01", "2026-12-31"), "Tomorrow");
    assert.equal(relativeDay("2026-10-01", "2026-09-28"), "In 3 days");
  });
});
