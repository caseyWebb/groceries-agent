import { describe, it, expect } from "vitest";
import { validateFile } from "../src/validate.js";

describe("validateFile", () => {
  it("accepts a well-formed recipe", () => {
    expect(() => validateFile("recipes/x.md", "---\nstatus: active\n---\nbody\n")).not.toThrow();
  });

  it("rejects an out-of-enum recipe status", () => {
    expect(() => validateFile("recipes/x.md", "---\nstatus: bogus\n---\nbody\n")).toThrowError(
      /not one of/,
    );
  });

  it("rejects a recipe with no frontmatter fence", () => {
    expect(() => validateFile("recipes/x.md", "no frontmatter here")).toThrowError(/fence/);
  });

  it("accepts legal pantry categories and rejects illegal ones", () => {
    expect(() =>
      validateFile("pantry.toml", '[[items]]\nname = "milk"\ncategory = "fridge"\n'),
    ).not.toThrow();
    expect(() =>
      validateFile("pantry.toml", '[[items]]\nname = "milk"\ncategory = "garage"\n'),
    ).toThrowError(/category/);
  });

  it("requires grocery name and status, validates enums", () => {
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nname = "oil"\nstatus = "active"\nkind = "grocery"\n'),
    ).not.toThrow();
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nstatus = "active"\n'),
    ).toThrowError(/name/);
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nname = "oil"\nstatus = "queued"\n'),
    ).toThrowError(/status/);
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nname = "oil"\nstatus = "active"\nkind = "snacks"\n'),
    ).toThrowError(/kind/);
  });

  it("parse-only validates other config TOML", () => {
    expect(() => validateFile("preferences.toml", "default_cooking_nights = 3\n")).not.toThrow();
    expect(() => validateFile("preferences.toml", "= = broken")).toThrowError(/does not parse/);
  });

  it("does not constrain freeform markdown", () => {
    expect(() => validateFile("taste.md", "anything goes here")).not.toThrow();
  });
});
