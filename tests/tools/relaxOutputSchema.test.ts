import { describe, expect, it } from "vitest";
import { z } from "zod";
import { relaxOutputSchema } from "../../src/tools/relaxOutputSchema";
import { userInfoOutputSchema, userPermissionsOutputSchema } from "../../src/tools/definitions/platform/schema";

describe("relaxOutputSchema", () => {
  it("tolerates missing, null and extra fields at any depth", () => {
    const relaxed = relaxOutputSchema(userInfoOutputSchema);
    const result = relaxed.safeParse({
      caller: "T1",
      info: { contacts: [{ type: "EMAIL", username: null }], brandNew: true },
      internalAccount: null,
      extra: 1,
    });
    expect(result.success).toBe(true);
  });

  it("still rejects real type changes", () => {
    expect(relaxOutputSchema(userInfoOutputSchema).safeParse({ caller: 42 }).success).toBe(false);
  });

  it("keeps field descriptions in the advertised JSON schema", () => {
    const json = JSON.stringify(z.toJSONSchema(relaxOutputSchema(userInfoOutputSchema)));
    expect(json).toContain("TRON base58 address of the caller");
  });

  it("unwraps defaults", () => {
    expect(relaxOutputSchema(userPermissionsOutputSchema).safeParse({}).success).toBe(true);
  });
});
