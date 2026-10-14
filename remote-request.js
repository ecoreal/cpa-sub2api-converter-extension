(function (globalScope) {
  function requestWithTimeout(url, options, consumeResponse, timeoutMs, runtime) {
    var environment = runtime || {};
    var fetchImpl = environment.fetch || globalScope.fetch;
    var AbortControllerImpl = environment.AbortController || globalScope.AbortController;
    var setTimeoutImpl = environment.setTimeout || globalScope.setTimeout;
    var clearTimeoutImpl = environment.clearTimeout || globalScope.clearTimeout;

    if (typeof fetchImpl !== "function" || typeof AbortControllerImpl !== "function") {
      return Promise.reject(new Error("当前环境不支持远程请求"));
    }

    var controller = new AbortControllerImpl();
    var timer = setTimeoutImpl(function () {
      controller.abort();
    }, timeoutMs);

    return Promise.resolve()
      .then(function () {
        return fetchImpl(
          url,
          Object.assign({}, options || {}, { signal: controller.signal })
        );
      })
      .then(function (response) {
        return typeof consumeResponse === "function"
          ? consumeResponse(response, controller.signal)
          : response;
      })
      .finally(function () {
        clearTimeoutImpl(timer);
      });
  }

  var api = {
    requestWithTimeout: requestWithTimeout
  };

  globalScope.CPARequest = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
