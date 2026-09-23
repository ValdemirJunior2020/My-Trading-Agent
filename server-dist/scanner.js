import { getCandles, getProduct } from './coinbase.js';
export const SCAN_PRODUCTS = [
    'BTC-USD', 'ETH-USD', 'XRP-USD', 'SOL-USD', 'ADA-USD', 'DOGE-USD',
    'AVAX-USD', 'LINK-USD', 'LTC-USD', 'BCH-USD', 'DOT-USD', 'UNI-USD'
];
const avg = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const pct = (a, b) => b === 0 ? 0 : ((a - b) / b) * 100;
export const scanCryptoMarket = async (products = SCAN_PRODUCTS) => {
    const rows = [];
    for (const productId of products) {
        try {
            const [candles, product] = await Promise.all([
                getCandles(productId, 'ONE_HOUR', 60),
                getProduct(productId)
            ]);
            if (candles.length < 50)
                continue;
            const closes = candles.map(c => c.close);
            const latest = candles[candles.length - 1];
            const previous = candles[candles.length - 2];
            const dayAgo = candles[Math.max(0, candles.length - 25)];
            const sma20 = avg(closes.slice(-20));
            const sma50 = avg(closes.slice(-50));
            const returns = candles.slice(-24).map((c, i, a) => i === 0 ? 0 : pct(c.close, a[i - 1].close));
            const meanReturn = avg(returns);
            const variance = avg(returns.map(x => (x - meanReturn) ** 2));
            const volatility24hPercent = Math.sqrt(variance);
            const recentVolume = avg(candles.slice(-6).map(c => c.volume));
            const baselineVolume = avg(candles.slice(-24).map(c => c.volume));
            const volumeRatio = baselineVolume > 0 ? recentVolume / baselineVolume : 1;
            const change1hPercent = pct(latest.close, previous.close);
            const change24hPercent = pct(latest.close, dayAgo.close);
            let score = 50;
            const reasons = [];
            if (latest.close > sma20) {
                score += 10;
                reasons.push('price above SMA20');
            }
            else
                score -= 10;
            if (sma20 > sma50) {
                score += 15;
                reasons.push('SMA20 above SMA50');
            }
            else
                score -= 15;
            if (change1hPercent > 0) {
                score += 5;
                reasons.push('positive 1h momentum');
            }
            else
                score -= 5;
            if (change24hPercent > 0) {
                score += 10;
                reasons.push('positive 24h momentum');
            }
            else
                score -= 10;
            if (volumeRatio >= 1.05) {
                score += 8;
                reasons.push('volume confirmation');
            }
            if (volatility24hPercent > 3)
                score -= 8;
            if (volatility24hPercent > 5)
                score -= 10;
            score = Math.max(0, Math.min(100, score));
            const buyCandidate = score >= 78 && latest.close > sma20 && sma20 > sma50 && change24hPercent > 0;
            const sellCandidate = score <= 28 && latest.close < sma20 && sma20 < sma50 && change24hPercent < 0;
            rows.push({
                productId,
                price: Number(product?.price || latest.close),
                change1hPercent,
                change24hPercent,
                sma20,
                sma50,
                volatility24hPercent,
                volumeRatio,
                score,
                buyCandidate,
                sellCandidate,
                reasons
            });
        }
        catch { }
    }
    rows.sort((a, b) => b.score - a.score);
    const bestBuy = rows.find(x => x.buyCandidate) || null;
    const bestSell = [...rows].reverse().find(x => x.sellCandidate) || null;
    return {
        generatedAt: new Date().toISOString(),
        scanned: rows.length,
        universe: products,
        best: bestBuy,
        bestBuy,
        bestSell,
        results: rows
    };
};
