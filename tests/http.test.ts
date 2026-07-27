import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { readJsonBody, parseJsonBody, readFormBody } from "../src/lib/http.ts";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/test", { method: "POST", body, headers });

const json = (body: string) =>
  post(body, { "content-type": "application/json" });

describe("request bodies", () => {
  const schema = z.object({ name: z.string(), count: z.number() });

  test("a well-formed body comes back parsed", async () => {
    const read = await readJsonBody(json('{"a":1}'));
    assert.equal(read.ok, true);
    assert.deepEqual(read.ok && read.data, { a: 1 });
  });

  /**
   * The regression: req.json() throws on a malformed body, and an unhandled
   * throw in a route handler becomes a 500 — telling the caller the server
   * broke when in fact their request did.
   */
  test("malformed JSON is a 400, not a 500", async () => {
    for (const bad of ['{"unclosed":', "not json at all", "{,}", ""]) {
      const read = await readJsonBody(json(bad));
      assert.equal(read.ok, false, `accepted ${JSON.stringify(bad)}`);
      if (!read.ok) assert.equal(read.response.status, 400);
    }
  });

  test("an empty body is a 400 rather than a crash", async () => {
    const read = await readJsonBody(post(null));
    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.response.status, 400);
      assert.match((await read.response.json()).error, /JSON/);
    }
  });

  test("valid JSON that matches the schema is returned typed", async () => {
    const parsed = await parseJsonBody(json('{"name":"a","count":2}'), schema);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.data.count, 2);
  });

  test("valid JSON of the wrong shape is a 400 carrying the issues", async () => {
    const parsed = await parseJsonBody(json('{"name":"a"}'), schema, "Invalid thing");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.response.status, 400);
      const payload = await parsed.response.json();
      assert.equal(payload.error, "Invalid thing");
      assert.ok(Array.isArray(payload.issues) && payload.issues.length > 0);
    }
  });

  test("malformed JSON reports the parse failure, not schema issues", async () => {
    const parsed = await parseJsonBody(json("{oops"), schema);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      const payload = await parsed.response.json();
      assert.match(payload.error, /JSON/);
      assert.equal(payload.issues, undefined);
    }
  });

  test("JSON primitives are handled without throwing on property access", async () => {
    // `null` is valid JSON, and the garment PATCH route used to read
    // `body.__patch` straight off it.
    for (const primitive of ["null", "true", "3", '"text"']) {
      const read = await readJsonBody(json(primitive));
      assert.equal(read.ok, true, `rejected ${primitive}`);
    }
  });

  test("a form body comes back as FormData", async () => {
    const form = new FormData();
    form.set("kind", "garment");
    const read = await readFormBody(post(form));
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.data.get("kind"), "garment");
  });

  test("a body that isn't multipart at all is a 400", async () => {
    const read = await readFormBody(
      post("just text", { "content-type": "multipart/form-data; boundary=nope" }),
    );
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.response.status, 400);
  });
});
