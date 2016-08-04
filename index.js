import Deferred from 'es6-deferred';
import isObject from 'lodash/lang/isObject';
import includes from 'lodash/collection/includes';
import where from 'lodash/collection/where';
import reject from 'lodash/collection/reject';
import get from 'lodash/object/get';
import merge from 'lodash/object/merge';
import once from 'lodash/function/once';
import find from 'lodash/collection/find';
import methodOf from 'lodash/utility/methodOf';
import event from 'event-emitter';

const NETWORK_REQUEST_FAILED = 'NETWORK_REQUEST_FAILED';

export class Http {
  constructor() {
    this.currentRequests = [];
    this.cachedRequests = {};
    this.event = event({});
  }

  on(name, func) {
    this.event.on(name, func);
  }

  off(name, func) {
    this.event.off(name, func);
  }

  isOnline() {
    return fetch(`${window.location.origin}/favicon.ico`, {})
      .catch(() => false)
      .then((response) => !!response);
  }

  saveRequest(url, method, res) {
    // instantiate url object if it doesn't exist yet
    if (this.cachedRequests[url] === undefined) {
      this.cachedRequests[url] = {};
    }

    this.cachedRequests[url][method] = res;
    return res;
  }

  authenticateRequest(settings) {
    // - authenticating stuff
  }

  handleJson(res) {
    return res.json()
    .then((json) => {
      if (res.ok === true) {
        const headerObject = {};
        res.headers.forEach((value, name) => {
          headerObject[name] = value;
        });
        if (isObject(json)) {
          json._headers = headerObject;
        }
        return json;
      }
      const err = new Error(json.error || res.statusText);
      err.response = res;
      throw err;
    });
  }

  handleText(res) {
    return res.text()
    .then((text) => {
      if (res.ok === true) {
        return text;
      }
      const err = new Error(res.statusText);
      err.response = res;
      throw err;
    });
  }

  handleResponse(res) {
    const type = res.headers.get('content-type');
    if (includes(type, 'json')) {
      return this.handleJson(res);
    }
    return this.handleText(res);
  }

  startRequest(url, settings) {
    const { method } = settings;
    const cleanUpDeferreds = () => {
      this.currentRequests = reject(this.currentRequests, { url, method });
    };
    const stopAnimation = () => {
      if (this.currentRequests.length === 0) {
        state.dispatch(stopSpinner());
      }
    };
    const requests = () => where(this.currentRequests, { url, method });

    return fetch(url, settings)
    .catch((error) => {
      const networkError = error;
      networkError.response = { status: NETWORK_REQUEST_FAILED };
      throw networkError;
    })
    .then(this.handleResponse.bind(this))
    .then(this.saveRequest.bind(this, url, method))
    .then((res) => {
      requests().forEach(({ dfd }) => dfd.resolve(res));
      cleanUpDeferreds();
      stopAnimation();
      return res;
    })
    .catch((error) => {
      this.event.emit('error', error);
      requests().forEach(({ dfd }) => dfd.reject(error));
      cleanUpDeferreds();
      stopAnimation();
      throw new Error(error);
    });
  }

  requestAsync(_url, _settings) {
    const settings = this.authenticateRequest(_settings);
    const { method } = settings;
    const url = encodeURI(_url);

    // If method === GET use the ongoing request, otherwise return the request promise itself
    if (method !== 'GET') {
      return this.startRequest(url, settings);
    }
    const deferred = new Deferred();
    if (find(this.currentRequests, { url, method }) === undefined) {
      this.startRequest(url, settings);
    }
    this.currentRequests.push({ url, method, dfd: deferred });
    return deferred;
  }

  resolveFromCache(url, method) {
    return Promise.resolve(this.cachedRequests[url][method]);
  }

  request(url, useCache = false, method = 'GET', data) {
    // if the requester wants a cached request and the cached
    // response is present return that, else fire off a request
    let result;
    if (url === undefined) {
      result = Promise.reject(new Error('url is undefined'));
    } else if (method === 'POST' && data === undefined) {
      result = Promise.reject(new Error('this is a POST request without a body'));
    } else if (method === 'PUT' && data === undefined) {
      result = Promise.reject(new Error('this is a PUT request without a body'));
    } else if (useCache === true &&
       get(this.cachedRequests, [url, method]) !== undefined) {
      result = this.resolveFromCache(url, method);
    } else {
      const settings = {
        method,
        credentials: 'include',
      };

      if (method !== 'GET' && isObject(data)) {
        settings.headers = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };
      }

      if (data !== undefined) {
        settings.body = JSON.stringify(data);
      }
      result = this.requestAsync(url, settings);
    }

    return result;
  }

  get(url, useCache = false) {
    return this.request(url, useCache, 'GET');
  }

  post(url, data, useCache = false) {
    return this.request(url, useCache, 'POST', data);
  }

  delete(url, data) {
    return this.request(url, false, 'DELETE', data);
  }

  put(url, data, useCache = false) {
    return this.request(url, useCache, 'PUT', data);
  }
}
