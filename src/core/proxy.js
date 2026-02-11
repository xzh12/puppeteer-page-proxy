const got = require("got");
const CookieHandler = require("../lib/cookies");
const { setHeaders, setAgent } = require("../lib/options");

const type = require('../util/types');

// New - Maintain own registry of event listeners page.eventsMap replacement
let registeredListeners = new WeakMap();

const requestHandler = async (request, proxy, overrides = {}) => {
    if (!request.url().startsWith("http") && !request.url().startsWith("https")) {
        request.continue();
        return;
    }
    const cookieHandler = new CookieHandler(request);
    const options = {
        cookieJar: await cookieHandler.getCookies(),
        method: overrides.method || request.method(),
        body: overrides.postData || request.postData(),
        headers: overrides.headers || setHeaders(request),
        agent: setAgent(proxy),
        responseType: "buffer",
        maxRedirects: 15,
        throwHttpErrors: false,
        ignoreInvalidCookies: true,
        followRedirect: false
    };
    try {
        const response = await got(overrides.url || request.url(), options);
        const setCookieHeader = response.headers["set-cookie"];
        if (setCookieHeader) {
            await cookieHandler.setCookies(setCookieHeader);
            response.headers["set-cookie"] = undefined;
        }
        await request.respond({
            status: response.statusCode,
            headers: response.headers,
            body: response.body
        });
    } catch (error) {
        await request.abort();
    }
};

const removeRequestListener = (page, listener) => {
    const listeners = registeredListeners.get(page) || [];
    const index = listeners.indexOf(listener);
    if (index > -1) {
        page.removeListener("request", listener);
        listeners.splice(index, 1);
    }
    if (listeners.length === 0) {
        registeredListeners.delete(page);
    } else {
        registeredListeners.set(page, listeners);
    }
};

const addRequestListener = (page, listener) => {
    const listeners = registeredListeners.get(page) || [];
    listeners.push(listener);
    registeredListeners.set(page, listeners);
    page.on("request", listener);
};

const useProxyPer = {
    HTTPRequest: async (request, data) => {
        try{
            let proxy, overrides;
            // Separate proxy and overrides
            if (type(data) === "object") {
                if (Object.keys(data).length !== 0) {
                    proxy = data.proxy;
                    delete data.proxy;
                    overrides = data;
                }
            } else {proxy = data}
            // Skip request if proxy omitted
            if (proxy) {await requestHandler(request, proxy, overrides)}
            else {request.continue(overrides)}
        }catch(error){
            //ignore
        }
    },
    CDPPage: async (page, proxy) => {
        await page.setRequestInterception(true);
        const listenerName = "$ppp_requestListener";
        // Remove existing listener if present
        const existingListener = registeredListeners.get(page)?.find(l => l.name === listenerName);
        if (existingListener) {
            removeRequestListener(page, existingListener);
        }
        // Define a new listener
        const listener = async (request) => {
            await requestHandler(request, proxy);
        };
        listener.name = listenerName; // Assign a name for easy identification
        // Register the new listener
        addRequestListener(page, listener);
    }
};

const useProxy = async (target, data) => {
    if (target.constructor.name === "CdpPage") return useProxyPer.CDPPage(target, data);
    if (target.constructor.name === "CdpHTTPRequest") return useProxyPer.HTTPRequest(target, data);
    if (target.constructor.name === "BidiPage") return useProxyPer.HTTPRequest(target, data);
    useProxyPer[target.constructor.name](target, data);
};

module.exports = useProxy;
