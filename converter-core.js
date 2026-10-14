(function (globalScope) {
  function decodeJwtPayload(token) {
    try {
      var parts = String(token || "").split(".");
      if (parts.length !== 3) {
        return {};
      }

      var payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      var padding = payload.length % 4;
      if (padding) {
        payload += "=".repeat(4 - padding);
      }

      var jsonText = decodeURIComponent(
        atob(payload)
          .split("")
          .map(function (char) {
            return "%" + char.charCodeAt(0).toString(16).padStart(2, "0");
          })
          .join("")
      );

      return JSON.parse(jsonText);
    } catch (error) {
      return {};
    }
  }

  function parseExpiredTime(expiredString) {
    try {
      if (!expiredString) {
        return 0;
      }

      var date = expiredString.includes("+")
        ? new Date(expiredString)
        : new Date(String(expiredString).replace("Z", "+00:00"));
      var timestamp = Math.floor(date.getTime() / 1000);
      return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
    } catch (error) {
      return 0;
    }
  }

  // Keep user-controlled values safe when they become downloaded files or ZIP entries.
  // In particular, do not allow path separators, control characters, or Windows
  // reserved filename characters to survive into an output filename.
  function sanitizeFileNamePart(value, fallback) {
    var safe = String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, "_")
      .replace(/[\/\\:*?"<>|]/g, "_")
      .replace(/[\u2028\u2029]/g, "_")
      .trim()
      .replace(/^\.+/, "_")
      .replace(/[. ]+$/g, "_")
      .slice(0, 120);

    return safe || fallback;
  }

  function uniqueUploadFileName(value, usedNames) {
    var basename = String(value || "").split(/[\\/]/).pop() || "auth.json";
    var safeName = sanitizeFileNamePart(basename, "auth.json");
    var stem = /\.json$/i.test(safeName) ? safeName.slice(0, -5) : safeName;
    var extension = ".json";
    var characters = Array.from(stem || "auth");
    var encoder = new TextEncoder();
    var duplicateNumber = 1;
    var candidate;

    do {
      var suffix = duplicateNumber === 1 ? "" : "-" + duplicateNumber;
      var candidateCharacters = characters.slice();
      while (candidateCharacters.length &&
        encoder.encode(candidateCharacters.join("") + suffix + extension).length > 240) {
        candidateCharacters.pop();
      }
      candidate = candidateCharacters.join("") + suffix + extension;
      duplicateNumber += 1;
    } while (usedNames.has(candidate));

    usedNames.add(candidate);
    return candidate;
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function stringOrEmpty(value) {
    return typeof value === "string" ? value : "";
  }

  function buildAccount(sourceData, index) {
    var accessPayload = decodeJwtPayload(sourceData.access_token || "");
    var authInfo = accessPayload["https://api.openai.com/auth"] || {};

    var idTokenPayload = decodeJwtPayload(sourceData.id_token || "");
    var idTokenAuth = idTokenPayload["https://api.openai.com/auth"] || {};
    var organizations = Array.isArray(idTokenAuth.organizations)
      ? idTokenAuth.organizations
      : [];
    var firstOrganization =
      organizations.length &&
      organizations[0] &&
      typeof organizations[0] === "object"
        ? organizations[0]
        : null;

    var expiresAt = parseExpiredTime(sourceData.expired || "");
    if (!expiresAt) {
      expiresAt = Number(accessPayload.exp || 0);
    }

    var accountType = isNonEmptyString(sourceData.type)
      ? sourceData.type.trim()
      : "unknown";

    return {
      name: accountType + "-普号-" + String(index).padStart(4, "0"),
      platform: "openai",
      type: "oauth",
      credentials: {
        access_token: stringOrEmpty(sourceData.access_token),
        id_token: stringOrEmpty(sourceData.id_token),
        email: stringOrEmpty(sourceData.email),
        chatgpt_account_id: stringOrEmpty(sourceData.account_id),
        chatgpt_user_id: stringOrEmpty(authInfo.chatgpt_user_id),
        expires_at: expiresAt,
        expires_in: 864000,
        organization_id:
          firstOrganization && isNonEmptyString(firstOrganization.id)
            ? firstOrganization.id
            : "",
        refresh_token: stringOrEmpty(sourceData.refresh_token)
      },
      extra: {
        email: stringOrEmpty(sourceData.email)
      },
      concurrency: 10,
      priority: 1,
      rate_multiplier: 1,
      auto_pause_on_expired: true
    };
  }

  function normalizeFileEntries(fileEntries) {
    return fileEntries
      .slice()
      .sort(function (left, right) {
        return left.name.localeCompare(right.name, "zh-CN", {
          numeric: true,
          sensitivity: "base"
        });
      });
  }

  function convertBatch(fileEntries, options) {
    var normalizedEntries = normalizeFileEntries(fileEntries || []);
    var typeFilter = String((options && options.typeFilter) || "").trim();
    var accounts = [];
    var validFiles = [];
    var issues = [];

    normalizedEntries.forEach(function (entry) {
      var fileName = entry.name || "unknown.json";
      var sourceData = entry.data;

      if (!sourceData || typeof sourceData !== "object" || Array.isArray(sourceData)) {
        issues.push(fileName + ": JSON 根节点不是对象");
        return;
      }

      if (
        !isNonEmptyString(sourceData.access_token) ||
        !isNonEmptyString(sourceData.account_id)
      ) {
        issues.push(fileName + ": 缺少有效的 access_token 或 account_id");
        return;
      }

      if (typeFilter && sourceData.type !== typeFilter) {
        issues.push(fileName + ": type=" + (sourceData.type || "unknown") + "，已按过滤条件跳过");
        return;
      }

      var account = buildAccount(sourceData, accounts.length + 1);
      accounts.push(account);
      validFiles.push({
        fileName: fileName,
        sourceType: sourceData.type || "unknown",
        email: sourceData.email || "",
        accountName: account.name
      });
    });

    var now = new Date();
    var exportedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    var output = {
      type: "sub2api-data",
      version: 1,
      exported_at: exportedAt,
      proxies: [],
      accounts: accounts
    };

    return {
      output: output,
      validFiles: validFiles,
      issues: issues,
      stats: {
        total: normalizedEntries.length,
        valid: accounts.length,
        invalid: issues.length,
        typeFilter: typeFilter || null
      }
    };
  }

  // --- 反向转换：sub2api → CPA 单文件 ---

  function timestampToIso(unixTimestamp) {
    if (!unixTimestamp || typeof unixTimestamp !== "number" || unixTimestamp <= 0) {
      return "";
    }
    return new Date(unixTimestamp * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function extractTypeFromFileName(fileName) {
    var base = (fileName || "").replace(/\.json$/i, "");
    var parts = base.split("-");
    // 文件名格式如 cpa-email-type 或 sub2api-email-type，取最后一段
    if (parts.length >= 3) {
      var last = parts[parts.length - 1].toLowerCase();
      if (last && last !== "cpa" && last !== "sub2api") {
        return last;
      }
    }
    return null;
  }

  function buildCpaSingle(account, fallbackType, sourceFileName) {
    var creds = account.credentials || {};
    var chatgptAccountId = creds.chatgpt_account_id || "";
    var chatgptUserId = creds.chatgpt_user_id || "";
    var accountId = chatgptAccountId || chatgptUserId;

    var expiresAt = Number(creds.expires_at || 0);
    var expired = timestampToIso(expiresAt);

    // type 优先级：用户指定 > JWT plan_type > 文件名提取 > 默认 codex
    var type = "";
    if (fallbackType) {
      type = fallbackType;
    }
    if (!type) {
      var atPayload = decodeJwtPayload(creds.access_token || "");
      var authInfo = atPayload["https://api.openai.com/auth"] || {};
      if (authInfo.chatgpt_plan_type) {
        type = authInfo.chatgpt_plan_type.toLowerCase();
      }
    }
    if (!type) {
      type = extractTypeFromFileName(sourceFileName) || "codex";
    }

    var email = creds.email || (account.extra && account.extra.email) || "";

    // 生成文件名。email/type 可能来自导入文件或用户输入，不能直接作为
    // 文件系统/ZIP 路径的一部分，否则 ../ 或反斜杠会产生 Zip Slip 风险。
    var safeEmail = sanitizeFileNamePart(email, "unknown-email");
    var safeType = sanitizeFileNamePart(type, "codex");
    var fileName = "cpa-" + safeEmail + "-" + safeType + ".json";

    return {
      fileName: fileName,
      data: {
        access_token: creds.access_token || "",
        id_token: creds.id_token || "",
        email: email,
        account_id: accountId,
        expired: expired,
        type: type,
        refresh_token: creds.refresh_token || "",
        disabled: false,
        last_refresh: new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z")
      }
    };
  }

  function reverseConvertBatch(sub2apiData, typeFallback, sourceFileName) {
    var cpaFiles = [];
    var issues = [];
    var typeFallbackStr = String(typeFallback || "").trim();
    var sourceFileNameStr = String(sourceFileName || "").trim();

    if (!sub2apiData || typeof sub2apiData !== "object" || Array.isArray(sub2apiData)) {
      issues.push("根节点不是对象");
      return { cpaFiles: cpaFiles, issues: issues };
    }

    var accounts = sub2apiData.accounts || sub2apiData.data || [];
    if (!Array.isArray(accounts)) {
      issues.push("缺少 accounts 数组");
      return { cpaFiles: cpaFiles, issues: issues };
    }

    var usedFileNames = Object.create(null);
    accounts.forEach(function (account) {
      if (!account || typeof account !== "object" || Array.isArray(account)) {
        issues.push("unknown: account 必须是对象");
        return;
      }
      var accountLabel = isNonEmptyString(account.name) ? account.name : "unknown";
      if (
        !account.credentials ||
        typeof account.credentials !== "object" ||
        Array.isArray(account.credentials)
      ) {
        issues.push(accountLabel + ": 缺少 credentials");
        return;
      }
      if (!isNonEmptyString(account.credentials.access_token)) {
        issues.push(accountLabel + ": 缺少有效的 access_token");
        return;
      }

      var cpaFile = buildCpaSingle(account, typeFallbackStr, sourceFileNameStr);
      var originalFileName = cpaFile.fileName;
      var extensionIndex = originalFileName.toLowerCase().endsWith(".json")
        ? originalFileName.length - 5
        : originalFileName.length;
      var baseName = originalFileName.slice(0, extensionIndex);
      var extension = originalFileName.slice(extensionIndex);
      var duplicateNumber = 2;
      while (usedFileNames[cpaFile.fileName]) {
        cpaFile.fileName = baseName + "-" + duplicateNumber + extension;
        duplicateNumber += 1;
      }
      usedFileNames[cpaFile.fileName] = true;
      cpaFiles.push(cpaFile);
    });

    return {
      cpaFiles: cpaFiles,
      issues: issues,
      stats: {
        total: accounts.length,
        valid: cpaFiles.length,
        invalid: issues.length
      }
    };
  }

  var api = {
    decodeJwtPayload: decodeJwtPayload,
    parseExpiredTime: parseExpiredTime,
    buildAccount: buildAccount,
    sanitizeFileNamePart: sanitizeFileNamePart,
    uniqueUploadFileName: uniqueUploadFileName,
    convertBatch: convertBatch,
    buildCpaSingle: buildCpaSingle,
    reverseConvertBatch: reverseConvertBatch
  };

  globalScope.CPAConverter = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
