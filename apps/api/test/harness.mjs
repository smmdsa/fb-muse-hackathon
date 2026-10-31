// In-memory HTTP harness. Drives the real router with no socket.

export function makeCaller(handler) {
  return (method, path, body = null, token = null, extraHeaders = {}) =>
    new Promise((resolve, reject) => {
      const listeners = {};
      const req = {
        method,
        url: path,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...extraHeaders,
        },
        on: (event, cb) => {
          listeners[event] = cb;
          return req;
        },
      };
      const res = {
        writeHead: (code, headers) => {
          res.status = code;
          res.headers = headers;
        },
        end: (text) => {
          try {
            resolve({ status: res.status, json: JSON.parse(text), headers: res.headers ?? {} });
          } catch (err) {
            reject(err);
          }
        },
      };
      try {
        handler(req, res);
      } catch (err) {
        reject(err);
        return;
      }
      const text = body ? JSON.stringify(body) : "";
      if (text) listeners.data(Buffer.from(text));
      listeners.end();
    });
}
