import { getSetting, setSetting } from './db.js';
import { getProduct, listAccounts } from './coinbase.js';
const DEFAULT_CHALLENGE = {
    enabled: true,
    startingBalanceUsd: 100,
    targetBalanceUsd: 300,
    durationDays: 14,
    startedAt: new Date().toISOString()
};
export const getTradingChallenge = () => {
    const raw = getSetting('trading_challenge', '');
    if (!raw) {
        setSetting('trading_challenge', JSON.stringify(DEFAULT_CHALLENGE));
        return DEFAULT_CHALLENGE;
    }
    try {
        const parsed = JSON.parse(raw);
        return {
            enabled: Boolean(parsed.enabled),
            startingBalanceUsd: Number(parsed.startingBalanceUsd) || 100,
            targetBalanceUsd: Number(parsed.targetBalanceUsd) || 300,
            durationDays: Number(parsed.durationDays) || 14,
            startedAt: String(parsed.startedAt || new Date().toISOString())
        };
    }
    catch {
        setSetting('trading_challenge', JSON.stringify(DEFAULT_CHALLENGE));
        return DEFAULT_CHALLENGE;
    }
};
export const saveTradingChallenge = (input) => {
    const current = getTradingChallenge();
    const next = {
        enabled: input.enabled ?? current.enabled,
        startingBalanceUsd: Math.max(1, Number(input.startingBalanceUsd ?? current.startingBalanceUsd)),
        targetBalanceUsd: Math.max(1, Number(input.targetBalanceUsd ?? current.targetBalanceUsd)),
        durationDays: Math.max(1, Math.floor(Number(input.durationDays ?? current.durationDays))),
        startedAt: input.startedAt || current.startedAt || new Date().toISOString()
    };
    setSetting('trading_challenge', JSON.stringify(next));
    return next;
};
const balanceValue = (balance) => Number(balance?.value ?? balance ?? 0) || 0;
export const getEstimatedPortfolioUsd = async () => {
    const accounts = await listAccounts();
    const nonZero = accounts.filter((account) => balanceValue(account.availableBalance) + balanceValue(account.hold) > 0);
    let total = 0;
    const details = [];
    for (const account of nonZero) {
        const amount = balanceValue(account.availableBalance) + balanceValue(account.hold);
        const currency = String(account.currency || '').toUpperCase();
        if (!amount || !currency)
            continue;
        if (currency === 'USD' || currency === 'USDC') {
            total += amount;
            details.push({ currency, amount, usdValue: amount });
            continue;
        }
        try {
            const product = await getProduct(currency + '-USD');
            const price = Number(product?.price || 0);
            const usdValue = amount * price;
            if (Number.isFinite(usdValue)) {
                total += usdValue;
                details.push({ currency, amount, price, usdValue });
            }
        }
        catch {
            details.push({ currency, amount, usdValue: null });
        }
    }
    return { totalUsd: Number(total.toFixed(2)), details };
};
export const getChallengeSnapshot = async () => {
    const challenge = getTradingChallenge();
    const deadline = new Date(new Date(challenge.startedAt).getTime() + challenge.durationDays * 86400000);
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 86400000));
    let portfolioUsd = null;
    try {
        portfolioUsd = (await getEstimatedPortfolioUsd()).totalUsd;
    }
    catch { }
    const progressPercent = portfolioUsd == null ? null : Math.max(0, Math.min(100, ((portfolioUsd - challenge.startingBalanceUsd) / (challenge.targetBalanceUsd - challenge.startingBalanceUsd)) * 100));
    return {
        ...challenge,
        deadline: deadline.toISOString(),
        daysRemaining,
        currentPortfolioUsd: portfolioUsd,
        progressPercent: progressPercent == null ? null : Number(progressPercent.toFixed(1)),
        requiredGainPercent: Number((((challenge.targetBalanceUsd / challenge.startingBalanceUsd) - 1) * 100).toFixed(1)),
        riskNote: 'This is a goal, not a mandate. Hard risk limits override the target.'
    };
};
