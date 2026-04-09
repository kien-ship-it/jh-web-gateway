import { describe, it, expect } from "vitest";
import { getTokenExpiry } from "./auth-capture.js";

describe("auth-capture", () => {
  it("getTokenExpiry extracts exp from a valid JWT", () => {
    // Create a JWT with exp = 1700000000
    const payload = Buffer.from(JSON.stringify({ exp: 1700000000 })).toString("base64url");
    const token = `eyJhbGciOiJSUzI1NiJ9.${payload}.fakesig`;
    expect(getTokenExpiry(token)).toBe(1700000000);
  });

  it("getTokenExpiry returns 0 for malformed tokens", () => {
    expect(getTokenExpiry("")).toBe(0);
    expect(getTokenExpiry("not-a-jwt")).toBe(0);
    expect(getTokenExpiry("a.b")).toBe(0); // payload is not valid JSON
  });

  it("getTokenExpiry returns 0 when exp is missing", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user" })).toString("base64url");
    const token = `header.${payload}.sig`;
    expect(getTokenExpiry(token)).toBe(0);
  });
});
