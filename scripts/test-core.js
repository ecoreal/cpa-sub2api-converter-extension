#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const converter = require("../converter-core.js");

const result = converter.reverseConvertBatch(
  {
    accounts: [
      {
        credentials: {
          // Synthetic fixture value; no account or token file is read.
          access_token: "synthetic-fixture",
          email: "../../outside\\name"
        }
      }
    ]
  },
  "../evil\\type",
  "input.json"
);

assert.equal(result.cpaFiles.length, 1);
const fileName = result.cpaFiles[0].fileName;
assert.equal(fileName.includes("/"), false);
assert.equal(fileName.includes("\\"), false);
assert.equal(/(^|[\\/])\\.{1,2}([\\/]|$)/.test(fileName), false);
assert.equal(fileName.endsWith(".json"), true);
assert.equal(converter.sanitizeFileNamePart("", "fallback"), "fallback");
assert.ok(converter.sanitizeFileNamePart("a".repeat(200), "fallback").length <= 120);

const malformedReverseResult = converter.reverseConvertBatch(
  { accounts: [null, [], { credentials: [] }] },
  "codex",
  "input.json"
);
assert.equal(malformedReverseResult.cpaFiles.length, 0);
assert.equal(malformedReverseResult.issues.length, 3);

const malformedForwardResult = converter.convertBatch([
  { name: "numeric-token.json", data: { access_token: 123, account_id: "acct" } },
  { name: "object-account.json", data: { access_token: "token", account_id: {} } }
]);
assert.equal(malformedForwardResult.output.accounts.length, 0);
assert.equal(malformedForwardResult.issues.length, 2);

const duplicateResult = converter.reverseConvertBatch(
  {
    accounts: [
      { credentials: { access_token: "synthetic-one", email: "same@example.com" } },
      { credentials: { access_token: "synthetic-two", email: "same@example.com" } }
    ]
  },
  "codex",
  "input.json"
);
assert.equal(duplicateResult.cpaFiles.length, 2);
assert.notEqual(duplicateResult.cpaFiles[0].fileName, duplicateResult.cpaFiles[1].fileName);
assert.equal(duplicateResult.cpaFiles[1].fileName, "cpa-same@example.com-codex-2.json");


const uploadNames = new Set();
const unicodeUploadName = "用户账号".repeat(100) + ".json";
const safeUploadName = converter.uniqueUploadFileName("../../" + unicodeUploadName, uploadNames);
const repeatedUploadName = converter.uniqueUploadFileName(unicodeUploadName, uploadNames);
assert.ok(safeUploadName.endsWith(".json"));
assert.notEqual(safeUploadName, repeatedUploadName);
assert.ok(new TextEncoder().encode(safeUploadName).length <= 240);
assert.ok(new TextEncoder().encode(repeatedUploadName).length <= 240);

console.log("converter-core filename safety test passed");
