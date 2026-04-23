import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../src/lib/app-version";

describe("app metadata", () => {
  it("exposes a semver-looking version string", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
