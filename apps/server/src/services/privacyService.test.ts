import assert from "node:assert/strict";
import test from "node:test";
import { scrubPayload } from "./privacyService.js";

test("scrubs sensitive nested fields and bounds arrays", () => {
  const payload = scrubPayload({
    email: "person@example.com",
    nested: { authorization: "Bearer secret", safe: "visible" },
    values: Array.from({ length: 60 }, (_, index) => index)
  }) as Record<string, unknown>;
  assert.equal(payload.email, "[REDACTED]");
  assert.deepEqual(payload.nested, { authorization: "[REDACTED]", safe: "visible" });
  assert.equal((payload.values as unknown[]).length, 50);
});
