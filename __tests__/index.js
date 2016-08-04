/* eslint-disable func-names */
jest.dontMock('../');

const { http } = require('../http');
const Deferred = require('es6-deferred');
const merge = require('lodash/object/merge');

const url = 'google.com';
const method = 'GET';
const data = { hello: 'world' };
import state from 'app/state';

let deferreds;

const noOpProm = () => Promise.resolve({});

const headers = new Headers({
  foo: 'bar',
  'content-type': 'application/json',
});

const textHeaders = new Headers({
  foo: 'bar',
  'content-type': 'text/html',
});

const headerObject = {};
headers.forEach((value, name) => {
  headerObject[name] = value;
});

const settings = {
  method,
  credentials: 'include',
  headers: headers,
};

const fetchResponse = {
  ok: true,
  status: 200,
  message: 'Boom',
  headers: headers,
  json: () => Promise.resolve({ foo: 'bar' }),
};

const fetchTextResponse = Object.assign(
  {},
  fetchResponse,
  {
    text: () => Promise.resolve({ foo: 'bar' }),
    headers: textHeaders,
  });

const jsonError = {
  error: 'Shaka there\'s a problem',
};

const failedTextResponse = Object.assign(
  {},
  fetchTextResponse,
  {
    statusText: jsonError.error,
    ok: false,
  }
);

let failedResponse, failedResponseWithErrorMessage;

describe('Http Service', () => {
  beforeEach(() => {
    failedResponse = {
      ok: false,
      status: 400,
      statusText: 'There\'s been an error',
      headers,
      json: noOpProm,
    };

    failedResponseWithErrorMessage = {
      ok: false,
      status: 400,
      statusText: 'There\'s been an error',
      headers,
      json: () => Promise.resolve(jsonError),
    };

    http.currentRequests = [];
    http.cachedRequests = {};
    spyOn(state, 'dispatch');
  });

  describe('::constructor', () => {
    it('sets state and currentRequests', () => {
      expect(http.currentRequests).toEqual([]);
      expect(http.cachedRequests).toEqual({});
    });
  });

  describe('::handleResponse', () => {
    it('throws an error inside the promise chain', () => {
      let err;
      http.handleResponse(failedResponseWithErrorMessage).catch((_err) => err = _err);
      jest.runAllTimers();
      expect(err.message).toEqual(jsonError.error);
    });

    it('returns the response if the status is between 199 and 300', () => {
      const resp = { ok: true, status: 200, headers: headers, json: noOpProm };
      let res;
      http.handleResponse(resp).then((_res) => res = _res);
      jest.runAllTimers();
      expect(res).toEqual({ _headers: headerObject });
    });

    it('returns the right payload', () => {
      let outputRes;
      http.handleResponse(fetchResponse).then((_outputRes) => outputRes = _outputRes);
      jest.runAllTimers();
      expect(outputRes).toEqual({ foo: 'bar', _headers: headerObject });
    });

    it('uses handleText if content-type wasn\'t json', () => {
      spyOn(http, 'handleText');
      http.handleResponse(fetchTextResponse);
      jest.runAllTimers();
      expect(http.handleText).toHaveBeenCalled();
    });

    it('throws an error if content-type wasn\'t json but ok is false', () => {
      let err;
      http.handleResponse(failedTextResponse).catch((_err) => err = _err);
      jest.runAllTimers();
      expect(err.message).toEqual(jsonError.error);
    });
  });

  describe('::startRequest', () => {
    beforeEach(() => {
      spyOn(headerActions, 'startSpinner');
      spyOn(headerActions, 'stopSpinner');
      spyOn(window, 'fetch').and.returnValue(Promise.resolve(fetchResponse));
    });

    it('calls window.fetch', () => {
      http.startRequest(url, settings);
      jest.runAllTimers();
      expect(window.fetch).toHaveBeenCalledWith(url, settings);
    });

    it('dispatches startSpinner', () => {
      http.startRequest(url, settings);
      jest.runAllTimers();
      expect(headerActions.startSpinner).toHaveBeenCalled();
    });

    it('dispatches stopSpinner', () => {
      http.startRequest(url, settings);
      jest.runAllTimers();
      expect(headerActions.stopSpinner).toHaveBeenCalled();
    });

    it('calls then with the response object', () => {
      const spy = jasmine.createSpy();
      http.startRequest(url, settings).then(spy);
      jest.runAllTimers();
      const actualResponse = spy.calls.mostRecent().args[0];
      expect(actualResponse.foo).toEqual('bar');
    });

    it('calls handleResponse', () => {
      spyOn(http, 'handleResponse');
      http.startRequest(url, settings);
      jest.runAllTimers();
      expect(http.handleResponse).toHaveBeenCalled();
    });

    it('calls saveRequest', () => {
      spyOn(http, 'saveRequest');
      http.startRequest(url, settings);
      jest.runAllTimers();
      expect(http.saveRequest).toHaveBeenCalledWith(url, method, { foo: 'bar', _headers: headerObject });
    });

    it('calls notification.displayError if a request gets a 400', () => {
      window.fetch.and.returnValue(Promise.resolve(failedResponse));
      spyOn(notification, 'displayError');
      http.startRequest(url, settings);
      jest.runAllTimers();
      expect(notification.displayError).toHaveBeenCalledWith({
        title: 'Error:',
        message: error.errorMessageFromResponse(error.message),
        timeout: 20000,
      });
    });

    [408, 444, 500, 503, 504].forEach((statusCode) => {
      it('calls notification.displayError to display an ' +
         `application error if the status is ${statusCode}`, () => {

        failedResponse.status = statusCode;
        window.fetch.and.returnValue(Promise.resolve(failedResponse));
        spyOn(notification, 'displayError');
        http.startRequest(url, settings);
        jest.runAllTimers();

        expect(notification.displayError).toHaveBeenCalledWith({
          title: 'Error:',
          message: "We're currently experiencing " +
            'problems with our application. Please wait a moment ' +
            'and refresh, if the problems persist please contact support.',
          id: 'application-errors',
          timeout: 40000,
        });
      });
    });

    // I'm grouping this into a describe because there's
    // a bunch of setup code I want reuse for these tests:
    describe('-', () => {
      beforeEach(() => {
        deferreds = [new Deferred(), new Deferred()];
        http.currentRequests.push({ url, method, dfd: deferreds[0] });
        http.currentRequests.push({ url, method, dfd: deferreds[1] });
      });

      it('returns the right response for all deferred if fetch is successfull', () => {
        let returnValues;
        Promise.all([deferreds[0], deferreds[1]]).then((_values) => returnValues = _values);

        http.startRequest(url, settings);
        jest.runAllTimers();

        expect(returnValues[0]).toEqual(returnValues[1]);
      });

      it('resolves all relevant deferreds on the stack if fetch is successfull', () => {
        spyOn(deferreds[0], 'resolve').and.callThrough();
        spyOn(deferreds[1], 'resolve').and.callThrough();

        http.startRequest(url, settings);
        jest.runAllTimers();

        expect(deferreds[0].resolve).toHaveBeenCalled();
        expect(deferreds[1].resolve).toHaveBeenCalled();
      });

      it('rejects all relevant deferreds on the stack if the fetch has failed', () => {
        window.fetch.and.returnValue(Promise.resolve(failedResponse));

        spyOn(deferreds[0], 'reject').and.callThrough();
        spyOn(deferreds[1], 'reject').and.callThrough();

        http.startRequest(url, settings);
        jest.runAllTimers();

        expect(deferreds[0].reject).toHaveBeenCalled();
        expect(deferreds[1].reject).toHaveBeenCalled();
      });

      describe('should remove all relevant request objects (including deferreds) from the stack', () => {
        it('when a fetch is successfull', () => {
          expect(http.currentRequests.length).toBe(2);
          http.startRequest(url, settings);
          jest.runAllTimers();
          expect(http.currentRequests.length).toBe(0);
        });

        it('when a fetch fails', () => {
          expect(http.currentRequests.length).toBe(2);
          http.startRequest(url, settings);
          jest.runAllTimers();
          expect(http.currentRequests.length).toBe(0);
        });
      });
    });
  });

  describe('::saveRequest', () => {
    it('save the response into this.state', () => {
      http.saveRequest(settings.url, settings.method, data);
      expect(http.cachedRequests[settings.url][settings.method]).toEqual(data);
    });
  });

  describe('::requestAsync', () => {
    it('call startRequest with authenticated headers and return a deferred', () => {
      spyOn(http, 'startRequest');
      const result = http.requestAsync(url, settings);
      expect(http.startRequest).toHaveBeenCalledWith(url, merge({}, settings, { headers: { 'X-CSRF-Token': 'csrf-token-secret' } }));
      expect(result instanceof Deferred).toBe(true);
    });

    it('shouldn\'t call startRequest twice if there is an ongoing request', () => {
      const spy = spyOn(http, 'startRequest');
      http.requestAsync(url, settings);
      expect(spy.calls.count()).toBe(1);
      http.requestAsync(url, settings);
      expect(spy.calls.count()).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('displays error notification when there was an error', () => {
      const errorResp = {
        response: { status: 400 },
        message: { error: 'There has been an error yo' },
      };
      spyOn(notification, 'displayError');
      spyOn(error, 'errorMessageFromResponse').and.returnValue(errorResp.error);
      http.event.emit('error', errorResp);
      expect(error.errorMessageFromResponse).toHaveBeenCalled();
      expect(notification.displayError)
      .toHaveBeenCalledWith({ title: 'Error:', message: errorResp.error, timeout: 20000 });
    });

    it('fires an alert and redirects to /logout if the response contained a 401', () => {
      spyOn(window, 'alert').and.returnValue(true);
      spyOn(window.location, 'replace');
      http.event.emit('error', { response: { status: 401 } });
      expect(window.alert)
      .toHaveBeenCalledWith('Your user is not currently authenticated, please log in again.');
      expect(window.location.replace)
      .toHaveBeenCalledWith(`${window.location.origin}/logout`);
    });

    it('does not crash on unhandled status codes', () => {
      expect(() => http.event.emit('error', { response: { status: 404 } })).not.toThrow();
    });
  });

  describe('::request', () => {
    it('throw an error if you submit a POST request without body', () => {
      let err;
      http.request(url, false, 'POST').catch((_err) => err = _err);
      jest.runAllTimers();
      expect(err instanceof Error).toBe(true);
      expect(err.message).toBe('this is a POST request without a body');
    });

    it('adds json when there is a data object', () => {
      const _settings = {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(data),
      };

      spyOn(http, 'requestAsync');
      http.request(url, false, 'POST', data);
      expect(http.requestAsync).toHaveBeenCalledWith(url, _settings);
    });

    it('doesn\'t add application/json headers if there is no data object', () => {
      const _data = 'boom';
      const _settings = {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: _data,
      };

      spyOn(http, 'requestAsync');
      http.request(url, false, 'POST', _data);
      expect(http.requestAsync).not.toHaveBeenCalledWith(url, _settings);
    });

    it('throw an error if you submit a PUT request without body', () => {
      let err;
      http.request(url, false, 'PUT').catch((_err) => err = _err);
      jest.runAllTimers();
      expect(err instanceof Error).toBe(true);
      expect(err.message).toBe('this is a PUT request without a body');
    });

    it('throw if no url is defined', () => {
      let err;
      http.request().catch((_err) => err = _err);
      jest.runAllTimers();
      expect(err instanceof Error).toBe(true);
      expect(err.message).toBe('url is undefined');
    });

    it('return a deferred', () => {
      expect(http.request(url) instanceof Deferred).toBe(true);
      jest.runAllTimers();
    });

    it('fire resolveFromCache with the right params if useCache is true and we have cache for this url', () => {
      spyOn(http, 'resolveFromCache');
      http.cachedRequests[url] = {};
      http.cachedRequests[url].GET = data;
      http.request(url, true);
      expect(http.resolveFromCache).toHaveBeenCalledWith(url, 'GET');
    });

    it('doesn\'t fire resolveFromCache with the right params if useCache is true and we haven\'t cache for this url', () => {
      spyOn(http, 'resolveFromCache');
      http.request(url, true);
      jest.runAllTimers();
      expect(http.resolveFromCache).not.toHaveBeenCalled();
    });

    it('adds json content type if method is POST PUT or PATCH', () => {
      spyOn(http, 'requestAsync');
      http.request(url, false, 'POST', data);

      const _settings = {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(data),
      };

      expect(http.requestAsync).toHaveBeenCalledWith(url, _settings);
    });

    it('call requestAsync with the right arguments', () => {
      spyOn(http, 'requestAsync');
      http.request(url);

      const _settings = {
        method: 'GET',
        credentials: 'include',
      };

      expect(http.requestAsync).toHaveBeenCalledWith(url, _settings);
    });

    describe('returns a deferred which', () => {
      beforeEach(() => {
        spyOn(window, 'fetch');
      });

      it('resolves when the fetch succeeds', () => {
        window.fetch.and.returnValue(Promise.resolve(fetchResponse));
        const dfd = http.request(url, method);
        spyOn(dfd, 'resolve');
        jest.runAllTimers();
        expect(dfd instanceof Deferred).toBe(true);
        expect(dfd.resolve).toHaveBeenCalledWith({ foo: 'bar', _headers: headerObject });
      });

      it('resolves when the fetch fails', () => {
        window.fetch.and.returnValue(Promise.resolve(failedResponse));
        const dfd = http.request(url, method);
        spyOn(dfd, 'reject');
        jest.runAllTimers();
        jest.runAllTicks();
        expect(dfd instanceof Deferred).toBe(true);
        const err = new Error(failedResponse.statusText);
        err.response = failedResponse;
        expect(dfd.reject).toHaveBeenCalled();
        expect(dfd.reject.calls.mostRecent().args[0]).toEqual(err);
      });
    });
  });

  describe('::get', () => {
    it('return a promise', () => {
      expect(http.get(url) instanceof Deferred).toBe(true);
    });

    it('proxy this.request with right arguments', () => {
      spyOn(http, 'request');
      http.get(url);
      expect(http.request).toHaveBeenCalledWith(url, false, 'GET');
    });
  });

  describe('::post', () => {
    it('return a promise', () => {
      expect(http.post(url, data) instanceof Promise).toBe(true);
    });

    it('proxy this.request with right arguments', () => {
      spyOn(http, 'request');
      http.post(url, data);
      expect(http.request).toHaveBeenCalledWith(url, false, 'POST', data);
    });
  });

  describe('::delete', () => {
    it('return a promise', () => {
      expect(http.delete(url) instanceof Promise).toBe(true);
    });

    it('proxy this.request with right arguments', () => {
      spyOn(http, 'request');
      http.delete(url, data);
      expect(http.request).toHaveBeenCalledWith(url, false, 'DELETE', data);
    });
  });

  describe('::put', () => {
    it('return a promise', () => {
      expect(http.put(url, data) instanceof Promise).toBe(true);
    });

    it('proxy this.request with right arguments', () => {
      spyOn(http, 'request');
      http.put(url, data);
      expect(http.request).toHaveBeenCalledWith(url, false, 'PUT', data);
    });
  });

  describe('::isOnline', () => {
    it('returns a promise', () => {
      expect(http.isOnline() instanceof Promise).toBe(true);
    });

    it('calls fetch with window.location.origin + favicon.ico URL', () => {
      spyOn(window, 'fetch').and.returnValue(Promise.resolve(fetchResponse));
      http.isOnline();
      expect(window.fetch).toHaveBeenCalledWith(`${window.location.origin}/favicon.ico`, {});
    });
  });
});
