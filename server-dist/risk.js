import { config } from './config.js';
import { getSetting, openPaperNotional, setSetting } from './db.js';
import { createMarketOrder, listAccounts, getProduct } from './coinbase.js';
import { getChallengeSnapshot } from './challenge.js';
import { publish } from './events.js';
const storedNumber = (key, fallback) => {
    const value = Number(getSetting(key, String(fallback)));
    return Number.isFinite(value) ? value : fallback;
};
export const getRuntimeRiskLimits = () => ({
    maxPositionPercent: storedNumber('risk_max_position_percent', config.maxPositionPercent),
    maxTotalExposurePercent: storedNumber('risk_max_total_exposure_percent', config.maxTotalExposurePercent),
    maxDailyLossPercent: storedNumber('risk_max_daily_loss_percent', config.maxDailyLossPercent)
});
export const saveRuntimeRiskLimits = (input) => {
    const current = getRuntimeRiskLimits();
    const next = {
        maxPositionPercent: Math.max(0.1, Math.min(20, Number(input.maxPositionPercent ?? current.maxPositionPercent))),
        maxTotalExposurePercent: Math.max(1, Math.min(50, Number(input.maxTotalExposurePercent ?? current.maxTotalExposurePercent))),
        maxDailyLossPercent: Math.max(0.1, Math.min(10, Number(input.maxDailyLossPercent ?? current.maxDailyLossPercent)))
    };
    if (next.maxPositionPercent > next.maxTotalExposurePercent)
        next.maxPositionPercent = next.maxTotalExposurePercent;
    setSetting('risk_max_position_percent', String(next.maxPositionPercent));
    setSetting('risk_max_total_exposure_percent', String(next.maxTotalExposurePercent));
    setSetting('risk_max_daily_loss_percent', String(next.maxDailyLossPercent));
    return next;
};
export const emergencyStopActive = () => getSetting('emergency_stop', 'false') === 'true';
export const evaluatePaperOrder = (order) => {
    const reasons = [];
    const limits = getRuntimeRiskLimits();
    const notional = order.size * order.price;
    const maxPositionUsd = config.paperStartingBalanceUsd * (limits.maxPositionPercent / 100);
    const maxExposureUsd = config.paperStartingBalanceUsd * (limits.maxTotalExposurePercent / 100);
    const currentExposure = openPaperNotional();
    if (emergencyStopActive())
        reasons.push('Emergency stop is active.');
    if (!order.productId || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(order.productId))
        reasons.push('Invalid product ID.');
    if (!['BUY', 'SELL'].includes(order.side))
        reasons.push('Invalid side.');
    if (!(order.size > 0) || !(order.price > 0))
        reasons.push('Size and price must be positive.');
    if (notional > maxPositionUsd)
        reasons.push('Position notional exceeds the hard ' + limits.maxPositionPercent + '% paper-capital limit.');
    if (currentExposure + notional > maxExposureUsd)
        reasons.push('Total paper exposure would exceed ' + limits.maxTotalExposurePercent + '%.');
    return { approved: reasons.length === 0, reasons, notional, currentExposure, maxPositionUsd, maxExposureUsd, limits };
};
export const getDailyEquityGuard = (currentPortfolioUsd) => {
    const limits = getRuntimeRiskLimits();
    const today = new Date().toISOString().slice(0, 10);
    const storedDate = getSetting('live_daily_equity_date', '');
    let startEquity = Number(getSetting('live_daily_equity_start_usd', '0'));
    if (storedDate !== today || !(startEquity > 0)) {
        startEquity = currentPortfolioUsd;
        setSetting('live_daily_equity_date', today);
        setSetting('live_daily_equity_start_usd', String(currentPortfolioUsd));
    }
    const lossPercent = startEquity > 0 ? Math.max(0, ((startEquity - currentPortfolioUsd) / startEquity) * 100) : 0;
    return {
        date: today,
        startEquityUsd: Number(startEquity.toFixed(2)),
        currentEquityUsd: Number(currentPortfolioUsd.toFixed(2)),
        lossPercent: Number(lossPercent.toFixed(4)),
        limitPercent: limits.maxDailyLossPercent,
        blocked: lossPercent >= limits.maxDailyLossPercent
    };
};
export const evaluateLiveOrder = (input) => {
    const reasons = [];
    const limits = getRuntimeRiskLimits();
    const { productId, side, notionalUsd, totalPortfolioUsd, availableUsd, currentAssetUsd } = input;
    const maxPositionUsd = totalPortfolioUsd * (limits.maxPositionPercent / 100);
    const maxExposureUsd = totalPortfolioUsd * (limits.maxTotalExposurePercent / 100);
    const daily = getDailyEquityGuard(totalPortfolioUsd);
    if (emergencyStopActive())
        reasons.push('Emergency stop is active.');
    if (!config.liveTradingEnabled)
        reasons.push('Live trading is disabled in .env.');
    if (config.autoTradingEnabled) {
        // For limited auto we allow autoTradingEnabled=true
        // Only block if you want pure manual mode
    }
    if (!productId || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(productId))
        reasons.push('Invalid product ID.');
    if (!['BUY', 'SELL'].includes(side))
        reasons.push('Invalid side.');
    if (!(notionalUsd > 0))
        reasons.push('Order notional must be positive.');
    if (!(totalPortfolioUsd > 0))
        reasons.push('Live portfolio value is unavailable.');
    if (notionalUsd > maxPositionUsd)
        reasons.push('Order exceeds the hard ' + limits.maxPositionPercent + '% live position cap.');
    if (side === 'BUY' && notionalUsd > availableUsd)
        reasons.push('Insufficient available USD for this buy.');
    if (side === 'SELL' && notionalUsd > currentAssetUsd)
        reasons.push('Insufficient asset value for this sell.');
    const projectedExposure = side === 'BUY' ? currentAssetUsd + notionalUsd : Math.max(0, currentAssetUsd - notionalUsd);
    if (projectedExposure > maxExposureUsd)
        reasons.push('Projected asset exposure exceeds ' + limits.maxTotalExposurePercent + '% of the live portfolio.');
    if (daily.blocked)
        reasons.push('Daily loss guard is active at ' + daily.lossPercent.toFixed(2) + '% loss.');
    return {
        approved: reasons.length === 0,
        reasons,
        productId,
        side,
        notionalUsd,
        totalPortfolioUsd,
        availableUsd,
        currentAssetUsd,
        projectedExposureUsd: projectedExposure,
        maxPositionUsd,
        maxExposureUsd,
        daily,
        limits,
        manualApprovalRequired: config.manualApprovalRequired,
        automaticTradingEnabled: config.autoTradingEnabled,
        liveTradingEnabled: config.liveTradingEnabled
    };
};
export const tryLimitedLiveExecution = async (opts) => {
    if (!config.liveTradingEnabled || !config.autoTradingEnabled) {
        return { executed: false, reason: 'Live or auto trading is disabled in .env' };
    }
    if (emergencyStopActive()) {
        return { executed: false, reason: 'Emergency stop is active' };
    }
    if (!['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(opts.decision)) {
        return { executed: false, reason: 'Decision is not BUY_CANDIDATE or SELL_CANDIDATE' };
    }
    const side = opts.decision === 'BUY_CANDIDATE' ? 'BUY' : 'SELL';
    const productId = opts.productId.toUpperCase();
    const [accounts, portfolio, product] = await Promise.all([
        listAccounts(),
        getChallengeSnapshot(),
        getProduct(productId)
    ]);
    const totalPortfolioUsd = Number(portfolio.currentPortfolioUsd || 0);
    const price = Number(product?.price || 0);
    if (!(totalPortfolioUsd > 0) || !(price > 0)) {
        return { executed: false, reason: 'Missing portfolio value or product price' };
    }
    const balanceValue = (b) => Number(b?.value ?? b ?? 0) || 0;
    const baseCurrency = productId.split('-')[0];
    const usdAccount = accounts.find((a) => String(a.currency).toUpperCase() === 'USD');
    const baseAccount = accounts.find((a) => String(a.currency).toUpperCase() === baseCurrency);
    const availableUsd = balanceValue(usdAccount?.availableBalance);
    const baseAmount = balanceValue(baseAccount?.availableBalance) + balanceValue(baseAccount?.hold);
    const currentAssetUsd = baseAmount * price;
    // Size calculation – hard dollar cap + % limit
    const limits = getRuntimeRiskLimits();
    const maxFromPercent = totalPortfolioUsd * (limits.maxPositionPercent / 100);
    const hardCap = config.maxLiveOrderUsd;
    const minOrder = config.minLiveOrderUsd;
    let notionalUsd = Math.min(maxFromPercent, hardCap);
    if (notionalUsd < minOrder) {
        return { executed: false, reason: `Notional $${notionalUsd.toFixed(2)} is below minimum $${minOrder}` };
    }
    // Final risk gate
    const preflight = evaluateLiveOrder({
        productId,
        side,
        notionalUsd,
        totalPortfolioUsd,
        availableUsd,
        currentAssetUsd
    });
    if (!preflight.approved) {
        publish('live_order_rejected', { productId, side, notionalUsd, reasons: preflight.reasons }, 'risk');
        return { executed: false, reason: preflight.reasons.join('; '), preflight };
    }
    // Place the real order
    try {
        let orderResult;
        if (side === 'BUY') {
            orderResult = await createMarketOrder({
                productId,
                side: 'BUY',
                quoteSizeUsd: notionalUsd
            });
        }
        else {
            const baseSize = notionalUsd / price;
            orderResult = await createMarketOrder({
                productId,
                side: 'SELL',
                baseSize
            });
        }
        publish('live_order_placed', {
            productId,
            side,
            notionalUsd,
            orderResult
        }, 'execution');
        return {
            executed: true,
            productId,
            side,
            notionalUsd,
            orderResult,
            preflight
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publish('live_order_failed', { productId, side, notionalUsd, error: message }, 'execution');
        return { executed: false, reason: message };
    }
};
