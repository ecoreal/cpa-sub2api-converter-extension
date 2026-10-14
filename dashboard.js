(function () {
  var state = {
    fileEntries: [],
    conversion: null,
    uploading: false,
    reverseEntries: [],
    reverseConversion: null
  };

  var preferenceKeys = [
    "typeFilter",
    "filenamePrefix",
    "cliproxyBaseUrl",
    "cliproxyManagementKey",
    "sub2apiBaseUrl",
    "sub2apiApiPrefix",
    "sub2apiAdminKey",
    "sub2apiSkipDefaultGroup",
    "reverseTypeFallback",
    "reverseFilenamePrefix"
  ];
  var transientKeys = new Set(["cliproxyManagementKey", "sub2apiAdminKey"]);
  var volatileStorage = Object.create(null);
  var MAX_IMPORT_FILES = 500;
  var MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;
  var MAX_IMPORT_TOTAL_BYTES = 32 * 1024 * 1024;
  var MAX_REMOTE_RESPONSE_BYTES = 2 * 1024 * 1024;
  var REMOTE_REQUEST_TIMEOUT_MS = 30 * 1000;
  var MAX_ZIP_FILES = 500;
  var MAX_ZIP_TOTAL_BYTES = 32 * 1024 * 1024;

  function isTransientKey(key) {
    return transientKeys.has(key);
  }

  var storage = {
    get: function (keys) {
      var localKeys = keys.filter(function (key) { return !isTransientKey(key); });
      var sessionKeys = keys.filter(isTransientKey);
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        var localPromise = new Promise(function (resolve) {
          chrome.storage.local.get(localKeys, function (result) {
            resolve(result || {});
          });
        });
        var sessionApi = chrome.storage.session;
        var sessionPromise = sessionApi
          ? new Promise(function (resolve) {
              sessionApi.get(sessionKeys, function (result) { resolve(result || {}); });
            })
          : Promise.resolve(volatileStorage);
        return Promise.all([localPromise, sessionPromise]).then(function (results) {
          return Object.assign({}, results[0], results[1]);
        });
      }

      var fallback = {};
      localKeys.forEach(function (key) {
        fallback[key] = localStorage.getItem(key) || "";
      });
      sessionKeys.forEach(function (key) {
        fallback[key] = volatileStorage[key] || "";
      });
      return Promise.resolve(fallback);
    },
    set: function (values) {
      var localValues = {};
      var sessionValues = {};
      Object.keys(values).forEach(function (key) {
        if (isTransientKey(key)) {
          sessionValues[key] = values[key];
        } else {
          localValues[key] = values[key];
        }
      });

      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        if (Object.keys(localValues).length) {
          chrome.storage.local.set(localValues);
        }
        if (Object.keys(sessionValues).length && chrome.storage.session) {
          chrome.storage.session.set(sessionValues);
        }
        return;
      }

      Object.keys(localValues).forEach(function (key) {
        localStorage.setItem(key, localValues[key]);
      });
      Object.keys(sessionValues).forEach(function (key) {
        volatileStorage[key] = sessionValues[key];
      });
    }
  };

  var dom = {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("file-input"),
    directoryInput: document.getElementById("directory-input"),
    pickFiles: document.getElementById("pick-files"),
    pickDirectory: document.getElementById("pick-directory"),
    typeFilter: document.getElementById("type-filter"),
    filenamePrefix: document.getElementById("filename-prefix"),
    clearAll: document.getElementById("clear-all"),
    downloadOutput: document.getElementById("download-output"),
    copyOutput: document.getElementById("copy-output"),
    saveRemoteSettings: document.getElementById("save-remote-settings"),
    cliproxyBaseUrl: document.getElementById("cliproxy-base-url"),
    cliproxyManagementKey: document.getElementById("cliproxy-management-key"),
    sub2apiBaseUrl: document.getElementById("sub2api-base-url"),
    sub2apiApiPrefix: document.getElementById("sub2api-api-prefix"),
    sub2apiAdminKey: document.getElementById("sub2api-admin-key"),
    sub2apiSkipDefaultGroup: document.getElementById("sub2api-skip-default-group"),
    testCliproxy: document.getElementById("test-cliproxy"),
    testSub2api: document.getElementById("test-sub2api"),
    uploadCliproxy: document.getElementById("upload-cliproxy"),
    uploadSub2api: document.getElementById("upload-sub2api"),
    uploadStatus: document.getElementById("upload-status"),
    summaryText: document.getElementById("summary-text"),
    validTableBody: document.getElementById("valid-table-body"),
    issueList: document.getElementById("issue-list"),
    outputPreview: document.getElementById("output-preview"),
    heroValidCount: document.getElementById("hero-valid-count"),
    heroInvalidCount: document.getElementById("hero-invalid-count"),
    heroTypeCount: document.getElementById("hero-type-count"),
    // 反向转换
    reverseDropzone: document.getElementById("reverse-dropzone"),
    reverseFileInput: document.getElementById("reverse-file-input"),
    reverseDirectoryInput: document.getElementById("reverse-directory-input"),
    reversePickFiles: document.getElementById("reverse-pick-files"),
    reversePickDirectory: document.getElementById("reverse-pick-directory"),
    reverseConvert: document.getElementById("reverse-convert"),
    reverseTypeFallback: document.getElementById("reverse-type-fallback"),
    reverseFilenamePrefix: document.getElementById("reverse-filename-prefix"),
    downloadIndividual: document.getElementById("download-individual"),
    downloadZip: document.getElementById("download-zip"),
    reverseClear: document.getElementById("reverse-clear"),
    reverseTableBody: document.getElementById("reverse-table-body"),
    reverseIssueList: document.getElementById("reverse-issue-list"),
    reverseSummaryText: document.getElementById("reverse-summary-text"),
    reverseUploadCliproxy: document.getElementById("reverse-upload-cliproxy"),
    reverseUploadStatus: document.getElementById("reverse-upload-status")
  };

  function setDragState(isActive) {
    dom.dropzone.classList.toggle("drag-active", isActive);
  }

  function formatTimestamp(date) {
    var year = String(date.getUTCFullYear());
    var month = String(date.getUTCMonth() + 1).padStart(2, "0");
    var day = String(date.getUTCDate()).padStart(2, "0");
    var hours = String(date.getUTCHours()).padStart(2, "0");
    var minutes = String(date.getUTCMinutes()).padStart(2, "0");
    var seconds = String(date.getUTCSeconds()).padStart(2, "0");
    return year + month + day + hours + minutes + seconds;
  }

  function getSafeFileNamePart(value, fallback) {
    return window.CPAConverter.sanitizeFileNamePart(value, fallback);
  }

  function getUniqueUploadFileName(value, usedNames) {
    return window.CPAConverter.uniqueUploadFileName(value, usedNames);
  }

  function getOutputFileName() {
    var prefix = getSafeFileNamePart(dom.filenamePrefix.value, "sub2api-account");
    return prefix + "-" + formatTimestamp(new Date()) + ".json";
  }

  function normalizeBaseUrl(value) {
    var raw = String(value || "").trim().replace(/\/+$/, "");
    if (!raw) {
      return "";
    }

    try {
      var parsed = new URL(raw);
      var isLocalHttp =
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].indexOf(parsed.hostname.toLowerCase()) >= 0;
      if (parsed.protocol !== "https:" && !isLocalHttp) {
        return "";
      }
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        return "";
      }
      return parsed.toString().replace(/\/+$/, "");
    } catch (error) {
      return "";
    }
  }

  function joinUrl(baseUrl, path) {
    return normalizeBaseUrl(baseUrl) + "/" + String(path || "").replace(/^\/+/, "");
  }

  function normalizePathPrefix(value) {
    var prefix = String(value || "").trim();
    if (!prefix) {
      return "";
    }
    return "/" + prefix.replace(/^\/+|\/+$/g, "");
  }

  function buildSub2apiUrl(baseUrl, path) {
    return joinUrl(baseUrl, normalizePathPrefix(dom.sub2apiApiPrefix.value || "/api/v1") + path);
  }

  function nowStatusTime() {
    return new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function setUploadStatus(message, kind) {
    dom.uploadStatus.textContent = "[" + nowStatusTime() + "] " + message;
    dom.uploadStatus.classList.toggle("status-success", kind === "success");
    dom.uploadStatus.classList.toggle("status-error", kind === "error");
    dom.uploadStatus.classList.toggle("status-working", kind === "working");
  }

  function setUploading(isUploading) {
    state.uploading = isUploading;
    updateRemoteButtons();
  }

  function getUploadableEntries() {
    var typeFilter = String(dom.typeFilter.value || "").trim();
    return getValidEntries(state.fileEntries).filter(function (entry) {
      return !typeFilter || entry.data.type === typeFilter;
    });
  }

  function updateRemoteButtons() {
    var hasSourceFiles = getUploadableEntries().length > 0;
    var hasAccounts =
      state.conversion && state.conversion.output.accounts && state.conversion.output.accounts.length > 0;

    dom.uploadCliproxy.disabled =
      state.uploading || !hasSourceFiles || !normalizeBaseUrl(dom.cliproxyBaseUrl.value);
    dom.uploadSub2api.disabled =
      state.uploading || !hasAccounts || !normalizeBaseUrl(dom.sub2apiBaseUrl.value);
    dom.testCliproxy.disabled = state.uploading || !normalizeBaseUrl(dom.cliproxyBaseUrl.value);
    dom.testSub2api.disabled = state.uploading || !normalizeBaseUrl(dom.sub2apiBaseUrl.value);
  }

  function uniqueEntries(entries) {
    var map = new Map();
    entries.forEach(function (entry) {
      map.set(entry.name, entry);
    });
    return Array.from(map.values());
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("文件读取失败"));
      };
      reader.readAsText(file, "utf-8");
    });
  }

  async function buildEntries(fileList) {
    var files = Array.from(fileList || []).filter(function (file) {
      return file && file.name && file.name.toLowerCase().endsWith(".json");
    });
    var results = [];
    var accepted = [];

    if (files.length > MAX_IMPORT_FILES) {
      files.slice(MAX_IMPORT_FILES).forEach(function (file) {
        results.push({
          name: file.webkitRelativePath || file.name,
          error: "文件数量超过上限 " + MAX_IMPORT_FILES
        });
      });
      files = files.slice(0, MAX_IMPORT_FILES);
    }

    var totalBytes = 0;
    files.forEach(function (file) {
      var name = file.webkitRelativePath || file.name;
      var size = Number(file.size || 0);
      if (size > MAX_IMPORT_FILE_BYTES) {
        results.push({ name: name, error: "文件超过大小上限 8 MiB" });
        return;
      }
      if (totalBytes + size > MAX_IMPORT_TOTAL_BYTES) {
        results.push({ name: name, error: "导入文件总大小超过上限 32 MiB" });
        return;
      }
      totalBytes += size;
      accepted.push(file);
    });

    var parsed = await Promise.all(
      accepted.map(async function (file) {
        try {
          var rawText = await readFileAsText(file);
          return {
            name: file.webkitRelativePath || file.name,
            data: JSON.parse(rawText)
          };
        } catch (error) {
          return {
            name: file.webkitRelativePath || file.name,
            error: error instanceof Error ? error.message : "JSON 解析失败"
          };
        }
      })
    );

    return results.concat(parsed);
  }

  function renderValidFiles(validFiles) {
    if (!validFiles.length) {
      dom.validTableBody.innerHTML =
        '<tr class="empty-row"><td colspan="4">暂无有效账号</td></tr>';
      return;
    }

    dom.validTableBody.innerHTML = validFiles
      .map(function (item) {
        return (
          "<tr>" +
          "<td>" + escapeHtml(item.fileName) + "</td>" +
          "<td>" + escapeHtml(item.sourceType) + "</td>" +
          "<td>" + escapeHtml(item.email || "-") + "</td>" +
          "<td><code>" + escapeHtml(item.accountName) + "</code></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderIssues(conversion, parseErrors) {
    var mergedIssues = parseErrors.concat(conversion ? conversion.issues : []);

    if (!mergedIssues.length) {
      dom.issueList.innerHTML = '<li class="empty-issue">暂无问题</li>';
      return;
    }

    dom.issueList.innerHTML = mergedIssues
      .map(function (issue) {
        return "<li>" + escapeHtml(issue) + "</li>";
      })
      .join("");
  }

  function renderSummary(conversion, parseErrors) {
    if (!conversion) {
      dom.summaryText.textContent = "尚未导入文件。";
      dom.heroValidCount.textContent = "0";
      dom.heroInvalidCount.textContent = "0";
      dom.heroTypeCount.textContent = "-";
      return;
    }

    var totalIssues = conversion.issues.length + parseErrors.length;
    dom.summaryText.textContent =
      "共读取 " +
      conversion.stats.total +
      " 个文件，成功转换 " +
      conversion.stats.valid +
      " 个账号，跳过 " +
      totalIssues +
      " 个文件。";
    dom.heroValidCount.textContent = String(conversion.stats.valid);
    dom.heroInvalidCount.textContent = String(totalIssues);
    dom.heroTypeCount.textContent = conversion.stats.typeFilter || "全部";
  }

  function renderOutput(output) {
    dom.outputPreview.textContent = JSON.stringify(output, null, 2);
    var hasAccounts = output.accounts && output.accounts.length > 0;
    dom.downloadOutput.disabled = !hasAccounts;
    dom.copyOutput.disabled = !hasAccounts;
    updateRemoteButtons();
  }

  function getParseErrors(entries) {
    return entries
      .filter(function (entry) {
        return Boolean(entry.error);
      })
      .map(function (entry) {
        return entry.name + ": " + entry.error;
      });
  }

  function getValidEntries(entries) {
    return entries.filter(function (entry) {
      return !entry.error;
    });
  }

  function refreshConversion() {
    var parseErrors = getParseErrors(state.fileEntries);
    var validEntries = getValidEntries(state.fileEntries);
    state.conversion = window.CPAConverter.convertBatch(validEntries, {
      typeFilter: dom.typeFilter.value
    });

    renderSummary(state.conversion, parseErrors);
    renderValidFiles(state.conversion.validFiles);
    renderIssues(state.conversion, parseErrors);
    renderOutput(state.conversion.output);
  }

  async function ingestFiles(fileList) {
    var newEntries = await buildEntries(fileList);
    state.fileEntries = uniqueEntries(state.fileEntries.concat(newEntries));
    refreshConversion();
  }

  async function handleDrop(event) {
    event.preventDefault();
    setDragState(false);
    await ingestFiles(event.dataTransfer.files);
  }

  async function handleFilePick(event) {
    await ingestFiles(event.target.files);
  }

  async function copyOutput() {
    if (!state.conversion || !state.conversion.output.accounts.length) {
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(state.conversion.output, null, 2));
  }

  function toJsonBlob(data) {
    return new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8"
    });
  }

  function downloadOutput() {
    if (!state.conversion || !state.conversion.output.accounts.length) {
      return;
    }

    var blob = toJsonBlob(state.conversion.output);
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getOutputFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function resetState() {
    state.fileEntries = [];
    state.conversion = null;
    dom.fileInput.value = "";
    dom.directoryInput.value = "";
    renderSummary(null, []);
    renderValidFiles([]);
    renderIssues(null, []);
    renderOutput({
      type: "sub2api-data",
      version: 1,
      exported_at: "",
      proxies: [],
      accounts: []
    });
    setUploadStatus("尚未上传。");
  }

  function persistPreferences() {
    storage.set({
      typeFilter: dom.typeFilter.value,
      filenamePrefix: dom.filenamePrefix.value,
      cliproxyBaseUrl: dom.cliproxyBaseUrl.value,
      cliproxyManagementKey: dom.cliproxyManagementKey.value,
      sub2apiBaseUrl: dom.sub2apiBaseUrl.value,
      sub2apiApiPrefix: dom.sub2apiApiPrefix.value,
      sub2apiAdminKey: dom.sub2apiAdminKey.value,
      sub2apiSkipDefaultGroup: dom.sub2apiSkipDefaultGroup.checked ? "true" : "false"
    });
  }

  async function loadPreferences() {
    var values = await storage.get(preferenceKeys);
    dom.typeFilter.value = values.typeFilter || "";
    dom.filenamePrefix.value = values.filenamePrefix || "sub2api-account";
    dom.cliproxyBaseUrl.value = values.cliproxyBaseUrl || "";
    dom.cliproxyManagementKey.value = values.cliproxyManagementKey || "";
    dom.sub2apiBaseUrl.value = values.sub2apiBaseUrl || "";
    dom.sub2apiApiPrefix.value = values.sub2apiApiPrefix || "/api/v1";
    dom.sub2apiAdminKey.value = values.sub2apiAdminKey || "";
    dom.sub2apiSkipDefaultGroup.checked = values.sub2apiSkipDefaultGroup !== "false";
  }

  async function fetchRemote(url, options) {
    return window.CPARequest.requestWithTimeout(
      url,
      options,
      async function (response) {
        return {
          response: response,
          payload: await parseResponse(response)
        };
      },
      REMOTE_REQUEST_TIMEOUT_MS
    );
  }

  async function parseResponse(response) {
    var contentLength = Number(response.headers && response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_RESPONSE_BYTES) {
      throw new Error("远程响应超过 2 MiB 大小上限");
    }

    var text;
    if (response.body && typeof response.body.getReader === "function") {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var chunks = [];
      var totalBytes = 0;
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        totalBytes += part.value.byteLength;
        if (totalBytes > MAX_REMOTE_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error("远程响应超过 2 MiB 大小上限");
        }
        chunks.push(decoder.decode(part.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      text = chunks.join("");
    } else {
      text = await response.text();
      if (new TextEncoder().encode(text).length > MAX_REMOTE_RESPONSE_BYTES) {
        throw new Error("远程响应超过 2 MiB 大小上限");
      }
    }
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch (error) {
      return { raw: text };
    }
  }

  function getResponseMessage(payload) {
    if (!payload || typeof payload !== "object") {
      return "";
    }

    return (
      payload.error ||
      payload.message ||
      payload.reason ||
      payload.raw ||
      JSON.stringify(payload)
    );
  }

  function compactJson(value, maxLength) {
    var text;
    try {
      text = JSON.stringify(value);
    } catch (error) {
      text = String(value);
    }

    if (!text) {
      return "";
    }

    var limit = maxLength || 500;
    return text.length > limit ? text.slice(0, limit) + "..." : text;
  }

  function assertHttpSuccess(response, payload, label) {
    if (response.ok) {
      return;
    }

    var message = getResponseMessage(payload) || response.statusText || "请求失败";
    throw new Error(label + " 失败（HTTP " + response.status + "）： " + message);
  }

  function getCliproxyHeaders() {
    var managementKey = String(dom.cliproxyManagementKey.value || "").trim();
    var headers = {};
    if (managementKey) {
      headers.Authorization = "Bearer " + managementKey;
      headers["X-Management-Key"] = managementKey;
    }
    return headers;
  }

  function hasCliproxyManagementKey() {
    return String(dom.cliproxyManagementKey.value || "").trim().length > 0;
  }

  function getSub2apiHeaders(includeJson) {
    var adminKey = String(dom.sub2apiAdminKey.value || "").trim();
    var headers = {};
    if (includeJson) {
      headers["Content-Type"] = "application/json";
    }
    if (adminKey) {
      headers["x-api-key"] = adminKey;
    }
    return headers;
  }

  async function testCliproxyConnection() {
    var baseUrl = normalizeBaseUrl(dom.cliproxyBaseUrl.value);

    if (!baseUrl) {
      setUploadStatus("请先填写 CLIProxyAPI Base URL。", "error");
      return;
    }

    persistPreferences();
    setUploading(true);
    setUploadStatus(
      "正在测试 CLIProxyAPI 连接，Management Key " +
        (hasCliproxyManagementKey() ? "已填写并随请求发送。" : "未填写。"),
      "working"
    );

    try {
      var remoteResult = await fetchRemote(joinUrl(baseUrl, "/v0/management/auth-files"), {
        method: "GET",
        headers: getCliproxyHeaders()
      });
      var response = remoteResult.response;
      var payload = remoteResult.payload;
      assertHttpSuccess(response, payload, "CLIProxyAPI 连接测试");

      var fileCount = Array.isArray(payload.files) ? payload.files.length : null;
      setUploadStatus(
        "CLIProxyAPI 连接成功" + (fileCount === null ? "。" : "，当前认证文件 " + fileCount + " 个。"),
        "success"
      );
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "CLIProxyAPI 连接测试失败。", "error");
    } finally {
      setUploading(false);
    }
  }

  async function testSub2apiConnection() {
    var baseUrl = normalizeBaseUrl(dom.sub2apiBaseUrl.value);

    if (!baseUrl) {
      setUploadStatus("请先填写 sub2api Base URL。", "error");
      return;
    }

    persistPreferences();
    setUploading(true);
    setUploadStatus("正在测试 sub2api 连接...", "working");

    try {
      var remoteResult = await fetchRemote(buildSub2apiUrl(baseUrl, "/admin/accounts?page=1&page_size=1"), {
        method: "GET",
        headers: getSub2apiHeaders(false)
      });
      var response = remoteResult.response;
      var payload = remoteResult.payload;
      assertHttpSuccess(response, payload, "sub2api 连接测试");

      var data = unwrapSub2apiData(payload) || {};
      var total = typeof data.total === "number" ? data.total : null;
      setUploadStatus(
        "sub2api 连接成功" + (total === null ? "。" : "，当前账号总数 " + total + " 个。"),
        "success"
      );
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "sub2api 连接测试失败。", "error");
    } finally {
      setUploading(false);
    }
  }

  async function uploadToCliproxy() {
    var entries = getUploadableEntries();
    var baseUrl = normalizeBaseUrl(dom.cliproxyBaseUrl.value);

    if (!baseUrl) {
      setUploadStatus("请先填写 CLIProxyAPI Base URL。", "error");
      return;
    }

    if (!entries.length) {
      setUploadStatus("没有可上传到 CLIProxyAPI 的原始 JSON。", "error");
      return;
    }

    persistPreferences();
    setUploading(true);
    setUploadStatus(
      "正在上传 " +
        entries.length +
        " 个原始 JSON 到 CLIProxyAPI，Management Key " +
        (hasCliproxyManagementKey() ? "已填写并随请求发送。" : "未填写。"),
      "working"
    );

    try {
      var formData = new FormData();
      var usedNames = new Set();
      entries.forEach(function (entry) {
        formData.append(
          "file",
          toJsonBlob(entry.data),
          getUniqueUploadFileName(entry.name, usedNames)
        );
      });

      var remoteResult = await fetchRemote(joinUrl(baseUrl, "/v0/management/auth-files"), {
        method: "POST",
        headers: getCliproxyHeaders(),
        body: formData
      });
      var response = remoteResult.response;
      var payload = remoteResult.payload;
      assertHttpSuccess(response, payload, "CLIProxyAPI 上传");

      var uploaded = payload.uploaded || entries.length;
      var failed = Array.isArray(payload.failed) ? payload.failed.length : 0;
      setUploadStatus(
        "CLIProxyAPI 上传完成：成功 " + uploaded + " 个，失败 " + failed + " 个。",
        failed ? "error" : "success"
      );
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "CLIProxyAPI 上传失败。", "error");
    } finally {
      setUploading(false);
    }
  }

  function unwrapSub2apiData(payload) {
    if (payload && typeof payload === "object" && payload.code === 0 && payload.data) {
      return payload.data;
    }
    return payload;
  }

  function formatSub2apiImportErrors(errors) {
    if (!Array.isArray(errors) || !errors.length) {
      return "";
    }

    return errors
      .slice(0, 5)
      .map(function (item) {
        if (!item || typeof item !== "object") {
          return String(item);
        }

        var target = item.name || item.proxy_key || item.kind || "-";
        return target + ": " + (item.message || JSON.stringify(item));
      })
      .join("；");
  }

  function hasSub2apiImportResultFields(result) {
    if (!result || typeof result !== "object") {
      return false;
    }

    return [
      "proxy_created",
      "proxy_reused",
      "proxy_failed",
      "account_created",
      "account_failed"
    ].some(function (key) {
      return Object.prototype.hasOwnProperty.call(result, key);
    });
  }

  async function uploadToSub2api() {
    var baseUrl = normalizeBaseUrl(dom.sub2apiBaseUrl.value);

    if (!baseUrl) {
      setUploadStatus("请先填写 sub2api Base URL。", "error");
      return;
    }

    if (!state.conversion || !state.conversion.output.accounts.length) {
      setUploadStatus("没有可导入 sub2api 的转换结果。", "error");
      return;
    }

    var payloadAccountCount = Array.isArray(state.conversion.output.accounts)
      ? state.conversion.output.accounts.length
      : 0;
    if (payloadAccountCount <= 0) {
      setUploadStatus("转换结果 accounts 为空，已取消 sub2api 导入。", "error");
      return;
    }

    persistPreferences();
    setUploading(true);
    var importUrl = buildSub2apiUrl(baseUrl, "/admin/accounts/data");
    setUploadStatus(
      "正在导入 " +
        payloadAccountCount +
        " 个账号到 sub2api：" +
        importUrl,
      "working"
    );

    try {
      var remoteResult = await fetchRemote(importUrl, {
        method: "POST",
        headers: getSub2apiHeaders(true),
        body: JSON.stringify({
          data: state.conversion.output,
          skip_default_group_bind: dom.sub2apiSkipDefaultGroup.checked
        })
      });
      var response = remoteResult.response;
      var payload = remoteResult.payload;
      assertHttpSuccess(response, payload, "sub2api 导入");

      var result = unwrapSub2apiData(payload) || {};
      if (!hasSub2apiImportResultFields(result)) {
        setUploadStatus(
          "sub2api 返回 HTTP 200，但响应不是账号导入结果。请检查 Base URL 是否指向 sub2api 后端，以及路径是否被反代改写。响应摘要：" +
            compactJson(payload, 600),
          "error"
        );
        return;
      }

      var accountCreated = Number(result.account_created || 0);
      var accountFailed = Number(result.account_failed || 0);
      var proxyCreated = Number(result.proxy_created || 0);
      var proxyReused = Number(result.proxy_reused || 0);
      var proxyFailed = Number(result.proxy_failed || 0);
      var errorsText = formatSub2apiImportErrors(result.errors);
      var hasImportFailures = accountFailed > 0 || proxyFailed > 0;
      var createdNothing = accountCreated === 0 && state.conversion.output.accounts.length > 0;
      var statusMessage =
        "sub2api 导入完成：账号成功 " +
        accountCreated +
        " 个，账号失败 " +
        accountFailed +
        " 个；代理新增 " +
        proxyCreated +
        " 个，复用 " +
        proxyReused +
        " 个，失败 " +
        proxyFailed +
        " 个。";

      if (errorsText) {
        statusMessage += " 错误详情：" + errorsText;
      } else if (createdNothing) {
        statusMessage += " HTTP 200 但没有创建账号，请到 sub2api 账号列表确认是否被判定为重复或被服务端规则跳过。";
      }

      setUploadStatus(
        statusMessage,
        hasImportFailures || createdNothing ? "error" : "success"
      );
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "sub2api 导入失败。", "error");
    } finally {
      setUploading(false);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // --- 反向转换：sub2api → CPA 单文件 ---

  function setReverseDragState(isActive) {
    dom.reverseDropzone.classList.toggle("drag-active", isActive);
  }

  async function reverseIngestFiles(fileList) {
    var newEntries = await buildEntries(fileList);
    state.reverseEntries = uniqueEntries(state.reverseEntries.concat(newEntries));
    dom.reverseConvert.disabled = getValidEntries(state.reverseEntries).length === 0;
    renderReverseSummary();
  }

  async function handleReverseDrop(event) {
    event.preventDefault();
    setReverseDragState(false);
    await reverseIngestFiles(event.dataTransfer.files);
  }

  async function handleReverseFilePick(event) {
    await reverseIngestFiles(event.target.files);
  }

  function renderReverseSummary() {
    var count = getValidEntries(state.reverseEntries).length;
    if (state.reverseConversion) {
      var stats = state.reverseConversion.stats;
      dom.reverseSummaryText.textContent =
        "共解析 " +
        stats.total +
        " 个账号，成功导出 " +
        stats.valid +
        " 个 CPA 文件，跳过 " +
        stats.invalid +
        " 个。";
    } else if (count > 0) {
      dom.reverseSummaryText.textContent = "已导入 " + count + " 个 sub2api 文件，点击「反向转换」开始。";
    } else {
      dom.reverseSummaryText.textContent = "尚未导入文件。";
    }
  }

  function renderReverseResults(cpaFiles) {
    if (!cpaFiles || cpaFiles.length === 0) {
      dom.reverseTableBody.innerHTML =
        '<tr class="empty-row"><td colspan="4">尚未转换</td></tr>';
      dom.downloadIndividual.disabled = true;
      dom.downloadZip.disabled = true;
      return;
    }

    dom.reverseTableBody.innerHTML = cpaFiles
      .map(function (item, index) {
        var email = item.data.email || "-";
        var type = item.data.type || "free";
        return (
          "<tr>" +
          '<td><code>' + escapeHtml(item.fileName) + "</code></td>" +
          "<td>" + escapeHtml(email) + "</td>" +
          "<td>" + escapeHtml(type) + "</td>" +
          '<td><button type="button" class="button button-ghost button-sm" data-download-index="' +
          index +
          '">下载</button></td>' +
          "</tr>"
        );
      })
      .join("");

    dom.downloadIndividual.disabled = false;
    dom.downloadZip.disabled = false;

    // 绑定逐个下载按钮
    dom.reverseTableBody.querySelectorAll("[data-download-index]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-download-index"));
        downloadSingleCpa(cpaFiles[idx]);
      });
    });
  }

  function renderReverseIssues(issues) {
    if (!issues || issues.length === 0) {
      dom.reverseIssueList.innerHTML = '<li class="empty-issue">暂无问题</li>';
      return;
    }
    dom.reverseIssueList.innerHTML = issues
      .map(function (issue) {
        return "<li>" + escapeHtml(issue) + "</li>";
      })
      .join("");
  }

  function doReverseConvert() {
    var validEntries = getValidEntries(state.reverseEntries);
    var typeFallback = String(dom.reverseTypeFallback.value || "").trim() || "codex";

    var allCpaFiles = [];
    var allIssues = [];

    validEntries.forEach(function (entry) {
      var result = window.CPAConverter.reverseConvertBatch(entry.data, typeFallback, entry.name);
      allCpaFiles = allCpaFiles.concat(result.cpaFiles);
      allIssues = allIssues.concat(result.issues);
    });

    // 应用文件名前缀
    var prefix = getSafeFileNamePart(dom.reverseFilenamePrefix.value, "cpa");
    allCpaFiles.forEach(function (item) {
      if (!item.fileName.startsWith(prefix + "-")) {
        // 替换开头的 cpa- 或 sub2api- 前缀
        item.fileName = item.fileName.replace(/^(cpa|sub2api)-/, prefix + "-");
      }
    });

    state.reverseConversion = {
      cpaFiles: allCpaFiles,
      issues: allIssues,
      stats: {
        total: allCpaFiles.length + allIssues.length,
        valid: allCpaFiles.length,
        invalid: allIssues.length
      }
    };

    dom.reverseUploadCliproxy.disabled =
      allCpaFiles.length === 0 || !normalizeBaseUrl(dom.cliproxyBaseUrl.value);

    renderReverseSummary();
    renderReverseResults(allCpaFiles);
    renderReverseIssues(allIssues);
  }

  function downloadSingleCpa(cpaFile) {
    var blob = new Blob([JSON.stringify(cpaFile.data, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getSafeFileNamePart(cpaFile.fileName, "cpa-account.json");
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function downloadAllIndividual() {
    if (!state.reverseConversion || !state.reverseConversion.cpaFiles.length) {
      return;
    }
    state.reverseConversion.cpaFiles.forEach(function (cpaFile) {
      downloadSingleCpa(cpaFile);
    });
  }

  // --- 最小 ZIP 打包（无外部依赖） ---

  function strToUtf8Bytes(str) {
    var encoder = new TextEncoder();
    return encoder.encode(str);
  }

  function crc32(bytes) {
    var table = crc32.table || (crc32.table = (function () {
      var t = new Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[i] = c >>> 0;
      }
      return t;
    })());
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function writeUint32Le(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function writeUint16Le(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function buildZip(files) {
    // files: [{name: "file.json", data: Uint8Array}]
    if (!Array.isArray(files) || files.length > MAX_ZIP_FILES) {
      throw new Error("ZIP 条目数量超过上限 " + MAX_ZIP_FILES);
    }
    var localHeaders = [];
    var centralDirs = [];
    var offset = 0;
    var estimatedTotal = 0;

    files.forEach(function (file) {
      var nameBytes = strToUtf8Bytes(file.name);
      var crc = crc32(file.data);
      var size = file.data.length;
      if (nameBytes.length > 0xffff || size > 0xffffffff) {
        throw new Error("ZIP 文件名或单文件大小超过格式上限");
      }
      estimatedTotal += 30 + nameBytes.length + size + 46 + nameBytes.length;
      if (estimatedTotal > MAX_ZIP_TOTAL_BYTES || estimatedTotal > 0xffffffff) {
        throw new Error("ZIP 总大小超过上限 32 MiB");
      }

      // Local file header
      var localSize = 30 + nameBytes.length + size;
      var localBuf = new ArrayBuffer(localSize);
      var localView = new DataView(localBuf);
      localView.setUint32(0, 0x04034b50, true); // signature
      writeUint16Le(localView, 4, 20); // version needed
      writeUint16Le(localView, 6, 0); // flags
      writeUint16Le(localView, 8, 0); // compression (store)
      writeUint16Le(localView, 10, 0); // mod time
      writeUint16Le(localView, 12, 0); // mod date
      writeUint32Le(localView, 14, crc);
      writeUint32Le(localView, 18, size);
      writeUint32Le(localView, 22, size);
      writeUint16Le(localView, 26, nameBytes.length);
      writeUint16Le(localView, 28, 0); // extra length
      new Uint8Array(localBuf).set(nameBytes, 30);
      new Uint8Array(localBuf).set(file.data, 30 + nameBytes.length);

      localHeaders.push({ buf: localBuf, offset: offset });

      // Central directory header
      var centralSize = 46 + nameBytes.length;
      var centralBuf = new ArrayBuffer(centralSize);
      var centralView = new DataView(centralBuf);
      centralView.setUint32(0, 0x02014b50, true);
      writeUint16Le(centralView, 4, 20); // version made by
      writeUint16Le(centralView, 6, 20); // version needed
      writeUint16Le(centralView, 8, 0); // flags
      writeUint16Le(centralView, 10, 0); // compression
      writeUint16Le(centralView, 12, 0); // mod time
      writeUint16Le(centralView, 14, 0); // mod date
      writeUint32Le(centralView, 16, crc);
      writeUint32Le(centralView, 20, size);
      writeUint32Le(centralView, 24, size);
      writeUint16Le(centralView, 28, nameBytes.length);
      writeUint16Le(centralView, 30, 0); // extra length
      writeUint16Le(centralView, 32, 0); // comment length
      writeUint16Le(centralView, 34, 0); // disk number
      writeUint16Le(centralView, 36, 0); // internal attrs
      writeUint32Le(centralView, 38, 0); // external attrs
      writeUint32Le(centralView, 42, offset); // local header offset
      new Uint8Array(centralBuf).set(nameBytes, 46);

      centralDirs.push(centralBuf);
      offset += localSize;
    });

    // End of central directory
    var centralOffset = offset;
    var centralTotalSize = centralDirs.reduce(function (sum, buf) { return sum + buf.byteLength; }, 0);
    var endSize = 22;
    var endBuf = new ArrayBuffer(endSize);
    var endView = new DataView(endBuf);
    endView.setUint32(0, 0x06054b50, true);
    writeUint16Le(endView, 4, 0); // disk number
    writeUint16Le(endView, 6, 0); // central dir disk
    writeUint16Le(endView, 8, files.length); // entries on disk
    writeUint16Le(endView, 10, files.length); // total entries
    writeUint32Le(endView, 12, centralTotalSize);
    writeUint32Le(endView, 16, centralOffset);
    writeUint16Le(endView, 20, 0); // comment length

    // Concatenate
    var totalSize = offset + centralTotalSize + endSize;
    var result = new Uint8Array(totalSize);
    var pos = 0;

    localHeaders.forEach(function (h) {
      result.set(new Uint8Array(h.buf), pos);
      pos += h.buf.byteLength;
    });
    centralDirs.forEach(function (buf) {
      result.set(new Uint8Array(buf), pos);
      pos += buf.byteLength;
    });
    result.set(new Uint8Array(endBuf), pos);

    return result;
  }

  function downloadZipCpa() {
    if (!state.reverseConversion || !state.reverseConversion.cpaFiles.length) {
      return;
    }

    var zipFiles = state.reverseConversion.cpaFiles.map(function (cpaFile) {
      return {
        name: getSafeFileNamePart(cpaFile.fileName, "cpa-account.json"),
        data: strToUtf8Bytes(JSON.stringify(cpaFile.data, null, 2))
      };
    });

    var zipBytes;
    try {
      zipBytes = buildZip(zipFiles);
    } catch (error) {
      setReverseUploadStatus(error instanceof Error ? error.message : "ZIP 导出失败。", "error");
      return;
    }
    var blob = new Blob([zipBytes], { type: "application/zip" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cpa-accounts-" + formatTimestamp(new Date()) + ".zip";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function uploadReverseToCliproxy() {
    if (!state.reverseConversion || !state.reverseConversion.cpaFiles.length) {
      setReverseUploadStatus("没有可上传的 CPA 文件。", "error");
      return;
    }

    var baseUrl = normalizeBaseUrl(dom.cliproxyBaseUrl.value);
    if (!baseUrl) {
      setReverseUploadStatus("请先在远程上传区域填写 CLIProxyAPI Base URL。", "error");
      return;
    }

    persistPreferences();
    setUploading(true);
    setReverseUploadStatus(
      "正在上传 " +
        state.reverseConversion.cpaFiles.length +
        " 个 CPA 文件到 CLIProxyAPI，Management Key " +
        (hasCliproxyManagementKey() ? "已填写并随请求发送。" : "未填写。"),
      "working"
    );

    try {
      var formData = new FormData();
      var usedNames = new Set();
      state.reverseConversion.cpaFiles.forEach(function (cpaFile) {
        formData.append(
          "file",
          new Blob([JSON.stringify(cpaFile.data, null, 2)], { type: "application/json;charset=utf-8" }),
          getUniqueUploadFileName(cpaFile.fileName, usedNames)
        );
      });

      var remoteResult = await fetchRemote(joinUrl(baseUrl, "/v0/management/auth-files"), {
        method: "POST",
        headers: getCliproxyHeaders(),
        body: formData
      });
      var response = remoteResult.response;
      var payload = remoteResult.payload;
      assertHttpSuccess(response, payload, "CLIProxyAPI 上传");

      var uploaded = payload.uploaded || state.reverseConversion.cpaFiles.length;
      var failed = Array.isArray(payload.failed) ? payload.failed.length : 0;
      setReverseUploadStatus(
        "CLIProxyAPI 上传完成：成功 " + uploaded + " 个，失败 " + failed + " 个。",
        failed ? "error" : "success"
      );
    } catch (error) {
      setReverseUploadStatus(error instanceof Error ? error.message : "CLIProxyAPI 上传失败。", "error");
    } finally {
      setUploading(false);
    }
  }

  function setReverseUploadStatus(message, kind) {
    dom.reverseUploadStatus.textContent = "[" + nowStatusTime() + "] " + message;
    dom.reverseUploadStatus.classList.toggle("status-success", kind === "success");
    dom.reverseUploadStatus.classList.toggle("status-error", kind === "error");
    dom.reverseUploadStatus.classList.toggle("status-working", kind === "working");
  }

  function resetReverseState() {
    state.reverseEntries = [];
    state.reverseConversion = null;
    dom.reverseFileInput.value = "";
    dom.reverseDirectoryInput.value = "";
    dom.reverseConvert.disabled = true;
    dom.reverseUploadCliproxy.disabled = true;
    renderReverseSummary();
    renderReverseResults([]);
    renderReverseIssues([]);
    dom.reverseUploadStatus.textContent = "尚未上传。";
    dom.reverseUploadStatus.classList.remove("status-success", "status-error", "status-working");
  }

  function registerEvents() {
    dom.pickFiles.addEventListener("click", function () {
      dom.fileInput.click();
    });

    dom.pickDirectory.addEventListener("click", function () {
      dom.directoryInput.click();
    });

    dom.fileInput.addEventListener("change", handleFilePick);
    dom.directoryInput.addEventListener("change", handleFilePick);
    dom.typeFilter.addEventListener("input", function () {
      persistPreferences();
      refreshConversion();
    });
    dom.filenamePrefix.addEventListener("input", persistPreferences);
    dom.clearAll.addEventListener("click", resetState);
    dom.downloadOutput.addEventListener("click", downloadOutput);
    dom.copyOutput.addEventListener("click", copyOutput);
    dom.saveRemoteSettings.addEventListener("click", function () {
      persistPreferences();
      updateRemoteButtons();
      setUploadStatus("远程上传配置已保存。", "success");
    });
    dom.testCliproxy.addEventListener("click", testCliproxyConnection);
    dom.testSub2api.addEventListener("click", testSub2apiConnection);
    dom.uploadCliproxy.addEventListener("click", uploadToCliproxy);
    dom.uploadSub2api.addEventListener("click", uploadToSub2api);

    [
      dom.cliproxyBaseUrl,
      dom.cliproxyManagementKey,
      dom.sub2apiBaseUrl,
      dom.sub2apiApiPrefix,
      dom.sub2apiAdminKey
    ].forEach(function (input) {
      input.addEventListener("input", function () {
        persistPreferences();
        updateRemoteButtons();
      });
    });
    dom.sub2apiSkipDefaultGroup.addEventListener("change", persistPreferences);

    ["dragenter", "dragover"].forEach(function (eventName) {
      dom.dropzone.addEventListener(eventName, function (event) {
        event.preventDefault();
        setDragState(true);
      });
    });

    ["dragleave", "dragend"].forEach(function (eventName) {
      dom.dropzone.addEventListener(eventName, function () {
        setDragState(false);
      });
    });

    dom.dropzone.addEventListener("drop", handleDrop);

    // 反向转换事件
    dom.reversePickFiles.addEventListener("click", function () {
      dom.reverseFileInput.click();
    });
    dom.reversePickDirectory.addEventListener("click", function () {
      dom.reverseDirectoryInput.click();
    });
    dom.reverseFileInput.addEventListener("change", handleReverseFilePick);
    dom.reverseDirectoryInput.addEventListener("change", handleReverseFilePick);
    dom.reverseConvert.addEventListener("click", doReverseConvert);

    ["dragenter", "dragover"].forEach(function (eventName) {
      dom.reverseDropzone.addEventListener(eventName, function (event) {
        event.preventDefault();
        setReverseDragState(true);
      });
    });
    ["dragleave", "dragend"].forEach(function (eventName) {
      dom.reverseDropzone.addEventListener(eventName, function () {
        setReverseDragState(false);
      });
    });
    dom.reverseDropzone.addEventListener("drop", handleReverseDrop);

    dom.downloadIndividual.addEventListener("click", downloadAllIndividual);
    dom.downloadZip.addEventListener("click", downloadZipCpa);
    dom.reverseClear.addEventListener("click", resetReverseState);
    dom.reverseUploadCliproxy.addEventListener("click", uploadReverseToCliproxy);

    dom.cliproxyBaseUrl.addEventListener("input", function () {
      persistPreferences();
      updateRemoteButtons();
      if (state.reverseConversion && state.reverseConversion.cpaFiles.length > 0) {
        dom.reverseUploadCliproxy.disabled = !normalizeBaseUrl(dom.cliproxyBaseUrl.value);
      }
    });

    // Tab 切换
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
        document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      });
    });
  }

  async function init() {
    await loadPreferences();
    registerEvents();
    resetState();
    refreshConversion();
    resetReverseState();
  }

  init();
})();
