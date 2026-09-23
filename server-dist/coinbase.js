import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { config, coinbaseConfigured } from './config.js';
import { randomUUID } from 'node:crypto';
const apiUrl = new URL(config.coinbaseApiBaseUrl);
const host = apiUrl.host;
const request = async (method, path, body) => {
    if (!coinbaseConfigured())
        throw new Error('Coinbase credentials are not configured.');
    const requestUrl = new URL(`${config.coinbaseApiBaseUrl}${path}`);
    const signingPath = requestUrl.pathname;
    const token = await generateJwt({ apiKeyId: config.cdpApiKeyId, apiKeySecret: config.cdpApiKeySecret.replace(/\\n/g, '\n'), requestMethod: method, requestHost: host, requestPath: signingPath, expiresIn: 120 });
    const response = await fetch(requestUrl, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        data = { message: text };
    }
    if (!response.ok)
        throw new Error(`Coinbase ${response.status}: ${text.slice(0, 240)}`);
    return data;
};
export const listAccounts = async () => {
    const data = await request('GET', '/api/v3/brokerage/accounts');
    return (data.accounts || []).map(account => ({ uuid: account.uuid, name: account.name, currency: account.currency, availableBalance: account.available_balance, hold: account.hold, default: account.default, active: account.active }));
};
export const getProduct = async (productId) => request('GET', `/api/v3/brokerage/products/${encodeURIComponent(productId)}`);
export const getCandles = async (productId, granularity = 'ONE_HOUR', limit = 120) => {
    const endNow = Math.floor(Date.now() / 1000);
    const secondsByGranularity = {
        ONE_MINUTE: 60,
        FIVE_MINUTE: 300,
        FIFTEEN_MINUTE: 900,
        THIRTY_MINUTE: 1800,
        ONE_HOUR: 3600,
        TWO_HOUR: 7200,
        SIX_HOUR: 21600,
        ONE_DAY: 86400
    };
    const seconds = secondsByGranularity[granularity] || 3600;
    const requested = Math.max(20, Math.min(3000, Math.floor(limit)));
    const rows = [];
    let remaining = requested;
    let windowEnd = endNow;
    while (remaining > 0) {
        const batch = Math.min(300, remaining);
        const windowStart = windowEnd - (seconds * batch);
        const path = `/api/v3/brokerage/products/${encodeURIComponent(productId)}/candles?start=${windowStart}&end=${windowEnd}&granularity=${encodeURIComponent(granularity)}&limit=${batch}`;
        const data = await request('GET', path);
        const parsed = (data.candles || [])
            .map(c => ({ start: Number(c.start), low: Number(c.low), high: Number(c.high), open: Number(c.open), close: Number(c.close), volume: Number(c.volume) }))
            .filter(c => Number.isFinite(c.start) && Number.isFinite(c.close) && c.close > 0);
        rows.push(...parsed);
        if (parsed.length === 0)
            break;
        remaining -= batch;
        windowEnd = windowStart;
    }
    const deduped = new Map();
    for (const row of rows)
        deduped.set(row.start, row);
    return [...deduped.values()].sort((a, b) => a.start - b.start).slice(-requested);
};
export const getProductBook = async (productId, limit = 10) => {
    const bounded = Math.max(1, Math.min(50, Math.floor(limit)));
    const data = await request('GET', `/api/v3/brokerage/product_book?product_id=${encodeURIComponent(productId)}&limit=${bounded}`);
    const book = data.pricebook || {};
    return {
        productId: book.product_id || productId,
        time: book.time || null,
        bids: (book.bids || []).slice(0, bounded).map(x => ({ price: Number(x.price), size: Number(x.size) })).filter(x => Number.isFinite(x.price) && Number.isFinite(x.size)),
        asks: (book.asks || []).slice(0, bounded).map(x => ({ price: Number(x.price), size: Number(x.size) })).filter(x => Number.isFinite(x.price) && Number.isFinite(x.size))
    };
};
export const getMarketTrades = async (productId, limit = 12) => {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    const data = await request('GET', `/api/v3/brokerage/products/${encodeURIComponent(productId)}/ticker?limit=${bounded}`);
    return (data.trades || []).slice(0, bounded).map((x, i) => ({
        id: x.trade_id || String(i),
        productId: x.product_id || productId,
        price: Number(x.price),
        size: Number(x.size),
        time: x.time || null,
        side: String(x.side || '').toUpperCase()
    })).filter(x => Number.isFinite(x.price) && Number.isFinite(x.size));
};
export const createMarketOrder = async (params) => {
    const { productId, side, quoteSizeUsd, baseSize } = params;
    if (side === 'BUY' && !(quoteSizeUsd && quoteSizeUsd > 0)) {
        throw new Error('BUY requires positive quoteSizeUsd');
    }
    if (side === 'SELL' && !(baseSize && baseSize > 0)) {
        throw new Error('SELL requires positive baseSize');
    }
    const order_configuration = side === 'BUY'
        ? { market_market_ioc: { quote_size: String(Number(quoteSizeUsd).toFixed(2)) } }
        : { market_market_ioc: { base_size: String(baseSize) } };
    const body = {
        client_order_id: randomUUID(),
        product_id: productId.toUpperCase(),
        side,
        order_configuration
    };
    return request('POST', '/api/v3/brokerage/orders', body);
};
