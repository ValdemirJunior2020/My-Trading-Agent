from __future__ import annotations
import json
import math
import sys
from importlib import import_module, metadata

def package_status(import_name: str, package_name: str) -> dict:
    try:
        import_module(import_name)
        try:
            version = metadata.version(package_name)
        except Exception:
            version = "installed"
        return {"installed": True, "version": version}
    except Exception as exc:
        return {"installed": False, "version": None, "error": str(exc)}

def status() -> dict:
    return {
        "vectorbt": package_status("vectorbt", "vectorbt"),
        "nautilusTrader": package_status("nautilus_trader", "nautilus_trader"),
        "python": sys.version.split()[0],
        "platform": sys.platform,
    }

def _finite(value, default=0.0):
    try:
        if hasattr(value, "item"):
            value = value.item()
        number = float(value)
        return number if math.isfinite(number) else default
    except Exception:
        return default

def _build_series(payload: dict):
    import numpy as np
    import pandas as pd
    prices = payload.get("prices") or []
    timestamps = payload.get("timestamps") or []
    if timestamps and len(timestamps) == len(prices):
        index = pd.to_datetime(np.asarray(timestamps, dtype="int64"), unit="s", utc=True)
    else:
        index = pd.date_range(end=pd.Timestamp.now(tz="UTC"), periods=len(prices), freq="h")
    return pd.Series(np.asarray(prices, dtype=float), index=index)

def _trade_metrics(portfolio, cash: float) -> dict:
    records = portfolio.trades.records_readable
    open_trades = 0
    closed_trades = 0
    realized_pnl = 0.0
    open_pnl = 0.0
    if len(records):
        status_col = next((c for c in records.columns if str(c).lower() == "status"), None)
        pnl_col = next((c for c in records.columns if str(c).lower() == "pnl"), None)
        if status_col is not None:
            statuses = records[status_col].astype(str).str.lower()
            open_mask = statuses == "open"
            closed_mask = statuses == "closed"
            open_trades = int(open_mask.sum())
            closed_trades = int(closed_mask.sum())
            if pnl_col is not None:
                realized_pnl = _finite(records.loc[closed_mask, pnl_col].sum())
                open_pnl = _finite(records.loc[open_mask, pnl_col].sum())
    return {
        "openTrades": open_trades,
        "closedTrades": closed_trades,
        "realizedPnl": realized_pnl,
        "openPnl": open_pnl,
        "realizedReturnPercent": (realized_pnl / cash * 100.0) if cash else 0.0,
        "openPnlPercent": (open_pnl / cash * 100.0) if cash else 0.0,
    }

def _run_sma(series, fast: int, slow: int, cash: float, eval_start: int = 0) -> dict:
    import vectorbt as vbt
    if len(series) < max(slow + 2, 20):
        raise ValueError("Not enough price points for the requested moving averages.")
    fast_ma = vbt.MA.run(series, fast)
    slow_ma = vbt.MA.run(series, slow)
    entries_all = fast_ma.ma_crossed_above(slow_ma)
    exits_all = fast_ma.ma_crossed_below(slow_ma)

    eval_start = max(0, min(int(eval_start), len(series) - 2))
    eval_series = series.iloc[eval_start:]
    entries = entries_all.iloc[eval_start:]
    exits = exits_all.iloc[eval_start:]

    portfolio = vbt.Portfolio.from_signals(
        eval_series,
        entries,
        exits,
        init_cash=cash,
        fees=0.001,
        freq="1h",
    )
    stats = portfolio.stats()
    sharpe_raw = stats.get("Sharpe Ratio", float("nan"))
    sharpe_computable = math.isfinite(_finite(sharpe_raw, float("nan")))
    trades = _trade_metrics(portfolio, cash)
    buy_hold_return = ((float(eval_series.iloc[-1]) / float(eval_series.iloc[0])) - 1.0) * 100.0 if len(eval_series) > 1 else 0.0
    total_return = _finite(stats.get("Total Return [%]", 0.0))
    closed = trades["closedTrades"]
    sample_adequacy = "ADEQUATE" if closed >= 30 else ("LIMITED" if closed >= 10 else "INSUFFICIENT")

    return {
        "engine": "vectorbt",
        "strategy": "SMA_CROSSOVER",
        "fast": fast,
        "slow": slow,
        "initialCash": cash,
        "candleCount": int(len(eval_series)),
        "totalReturnPercent": total_return,
        "buyHoldReturnPercent": buy_hold_return,
        "excessVsBuyHoldPercent": total_return - buy_hold_return,
        "maxDrawdownPercent": _finite(stats.get("Max Drawdown [%]", 0.0)),
        "winRatePercent": _finite(stats.get("Win Rate [%]", 0.0)),
        "totalTrades": int(round(_finite(stats.get("Total Trades", 0.0)))),
        **trades,
        "sharpeRatio": _finite(sharpe_raw, 0.0),
        "sharpeComputable": sharpe_computable,
        "sampleAdequacy": sample_adequacy,
    }

def vectorbt_sma(payload: dict) -> dict:
    prices = payload.get("prices") or []
    fast = int(payload.get("fast", 10))
    slow = int(payload.get("slow", 30))
    cash = float(payload.get("initialCash", 10000))
    if len(prices) < max(slow + 2, 20):
        raise ValueError("Not enough price points for the requested moving averages.")
    if fast <= 0 or slow <= 0 or fast >= slow:
        raise ValueError("Use positive windows with fast < slow.")
    series = _build_series(payload)
    return _run_sma(series, fast, slow, cash)

def vectorbt_validate(payload: dict) -> dict:
    prices = payload.get("prices") or []
    cash = float(payload.get("initialCash", 10000))
    parameter_sets = payload.get("parameterSets") or [
        {"fast": 5, "slow": 20},
        {"fast": 10, "slow": 30},
        {"fast": 20, "slow": 50},
        {"fast": 30, "slow": 100},
    ]
    if len(prices) < 300:
        raise ValueError("At least 300 candles are required for validation.")
    series = _build_series(payload)
    split = max(200, int(len(series) * 0.70))
    split = min(split, len(series) - 100)

    results = []
    for params in parameter_sets:
        fast = int(params["fast"])
        slow = int(params["slow"])
        full = _run_sma(series, fast, slow, cash)
        train = _run_sma(series.iloc[:split], fast, slow, cash)
        out_of_sample = _run_sma(series, fast, slow, cash, eval_start=split)

        walk_forward = []
        fold_starts = [0.40, 0.55, 0.70, 0.85]
        fold_size = max(60, int(len(series) * 0.15))
        for fold_no, ratio in enumerate(fold_starts, start=1):
            start = int(len(series) * ratio)
            end = min(len(series), start + fold_size)
            if end - start < max(slow + 2, 40):
                continue
            warmup_start = max(0, start - slow - 5)
            segment = series.iloc[warmup_start:end]
            eval_start = start - warmup_start
            fold = _run_sma(segment, fast, slow, cash, eval_start=eval_start)
            fold["fold"] = fold_no
            fold["start"] = str(series.index[start])
            fold["end"] = str(series.index[end - 1])
            walk_forward.append(fold)

        positive_oos_folds = sum(1 for f in walk_forward if f["totalReturnPercent"] > 0)
        results.append({
            "fast": fast,
            "slow": slow,
            "full": full,
            "train": train,
            "outOfSample": out_of_sample,
            "walkForward": walk_forward,
            "walkForwardPositiveFolds": positive_oos_folds,
            "walkForwardFoldCount": len(walk_forward),
            "validationFlag": "PASSING_EVIDENCE" if out_of_sample["totalReturnPercent"] > 0 and positive_oos_folds >= max(1, len(walk_forward) // 2 + 1) else "NEEDS_MORE_EVIDENCE",
        })

    return {
        "engine": "vectorbt",
        "validation": "SMA_MULTI_STAGE",
        "candleCount": len(series),
        "trainCandles": split,
        "outOfSampleCandles": len(series) - split,
        "trainPercent": round(split / len(series) * 100.0, 2),
        "outOfSamplePercent": round((len(series) - split) / len(series) * 100.0, 2),
        "feeRate": 0.001,
        "initialCash": cash,
        "results": results,
    }


def _mean_reversion_indicators(closes, bb_period: int, bb_std: float, rsi_period: int):
    import numpy as np
    import pandas as pd
    series = pd.Series(np.asarray(closes, dtype=float))
    middle = series.rolling(bb_period).mean()
    std = series.rolling(bb_period).std(ddof=0)
    lower = middle - (bb_std * std)
    delta = series.diff()
    gains = delta.clip(lower=0.0).rolling(rsi_period).mean()
    losses = (-delta.clip(upper=0.0)).rolling(rsi_period).mean()
    rs = gains / losses.replace(0.0, np.nan)
    rsi_values = 100.0 - (100.0 / (1.0 + rs))
    rsi_values = rsi_values.fillna(100.0)
    return middle, lower, rsi_values

def _run_mean_reversion(payload: dict, start_index: int = 0, end_index: int | None = None) -> dict:
    closes = [float(x) for x in (payload.get("closes") or payload.get("prices") or [])]
    highs = [float(x) for x in (payload.get("highs") or closes)]
    lows = [float(x) for x in (payload.get("lows") or closes)]
    volumes = [float(x) for x in (payload.get("volumes") or [1.0] * len(closes))]
    if not (len(closes) == len(highs) == len(lows) == len(volumes)):
        raise ValueError("closes/highs/lows/volumes must have matching lengths.")

    bb_period = int(payload.get("bbPeriod", 20))
    bb_std = float(payload.get("bbStdDev", 2.0))
    rsi_period = int(payload.get("rsiPeriod", 14))
    rsi_oversold = float(payload.get("rsiOversold", 35.0))
    strong_rsi = float(payload.get("strongRsi", 30.0))
    normal_proximity = float(payload.get("normalProximityPercent", 0.40))
    strong_proximity = float(payload.get("strongProximityPercent", 0.90))
    take_profit_percent = float(payload.get("takeProfitPercent", 1.5))
    stop_loss_percent = float(payload.get("stopLossPercent", 0.8))
    fee_rate = max(0.0, float(payload.get("feeRate", 0.006)))
    cash = float(payload.get("initialCash", 100.0))

    if len(closes) < max(bb_period + 2, rsi_period + 2, 40):
        raise ValueError("Not enough candles for mean-reversion validation.")

    middle, lower, rsi_values = _mean_reversion_indicators(closes, bb_period, bb_std, rsi_period)
    start_index = max(max(bb_period, rsi_period) + 1, int(start_index))
    end_index = len(closes) if end_index is None else min(len(closes), int(end_index))

    realized = 0.0
    wins = 0
    losses_count = 0
    win_pnl_total = 0.0
    loss_pnl_total = 0.0
    trades = 0
    position = None
    equity_curve = [cash]

    for i in range(start_index, end_index):
        close = closes[i]
        high = highs[i]
        low = lows[i]

        if position is not None:
            stop_price = position["entryPrice"] * (1.0 - stop_loss_percent / 100.0)
            # Net-profit target after both entry and exit fees.
            target_price = position["entryPrice"] * (1.0 + fee_rate) * (1.0 + take_profit_percent / 100.0) / max(1e-12, 1.0 - fee_rate)

            hit_stop = low <= stop_price
            hit_target = high >= target_price

            exit_price = None
            exit_reason = None
            if hit_stop and hit_target:
                # Conservative intrabar assumption when order is unknowable.
                exit_price = stop_price
                exit_reason = "STOP_LOSS"
            elif hit_stop:
                exit_price = stop_price
                exit_reason = "STOP_LOSS"
            elif hit_target:
                exit_price = target_price
                exit_reason = "NET_TAKE_PROFIT"

            if exit_price is not None:
                qty = position["qty"]
                proceeds = exit_price * qty * (1.0 - fee_rate)
                pnl = proceeds - position["costBasis"]
                realized += pnl
                trades += 1
                if pnl > 0:
                    wins += 1
                    win_pnl_total += pnl
                elif pnl < 0:
                    losses_count += 1
                    loss_pnl_total += abs(pnl)
                position = None

        if position is None and i > 20:
            lower_now = _finite(lower.iloc[i], float("nan"))
            lower_prev = _finite(lower.iloc[i - 1], float("nan"))
            rsi_now = _finite(rsi_values.iloc[i], 100.0)
            rsi_prev = _finite(rsi_values.iloc[i - 1], 100.0)
            if math.isfinite(lower_now) and math.isfinite(lower_prev) and lower_now > 0:
                close_vs_lower = ((close - lower_now) / lower_now) * 100.0
                previous_was_extreme = rsi_prev <= strong_rsi
                rsi_recovery_points = rsi_now - rsi_prev
                rsi_recovered = rsi_now > rsi_oversold and rsi_now <= 45.0 and rsi_recovery_points >= 5.0
                reclaimed_lower = closes[i - 1] < lower_prev and close >= lower_now
                bullish_break = close > highs[i - 1]
                three_candle_return = ((close - closes[i - 3]) / closes[i - 3]) * 100.0 if closes[i - 3] > 0 else -999.0
                momentum_ok = three_candle_return > -0.5
                prior_volume = volumes[max(0, i - 20):i]
                average_volume = sum(prior_volume) / len(prior_volume) if prior_volume else 0.0
                volume_ratio = (volumes[i] / average_volume) if average_volume > 0 else 0.0
                volume_confirmed = volume_ratio >= 1.5
                safe_reclaim_zone = close_vs_lower >= 0.0 and close_vs_lower <= strong_proximity

                entry_ready = (
                    previous_was_extreme and
                    rsi_recovered and
                    reclaimed_lower and
                    bullish_break and
                    momentum_ok and
                    volume_confirmed and
                    safe_reclaim_zone
                )
                if entry_ready:
                    notional = min(10.0, max(1.0, cash * 0.10))
                    qty = notional / close
                    position = {
                        "entryPrice": close,
                        "qty": qty,
                        "costBasis": (close * qty) * (1.0 + fee_rate),
                        "entryIndex": i,
                    }

        mark = 0.0
        if position is not None:
            mark = (close * position["qty"] * (1.0 - fee_rate)) - position["costBasis"]
        equity_curve.append(cash + realized + mark)

    open_pnl = 0.0
    if position is not None:
        final_price = closes[end_index - 1]
        open_pnl = (final_price * position["qty"] * (1.0 - fee_rate)) - position["costBasis"]

    net_pnl = realized + open_pnl
    peak = equity_curve[0] if equity_curve else cash
    max_drawdown = 0.0
    for value in equity_curve:
        peak = max(peak, value)
        if peak > 0:
            max_drawdown = max(max_drawdown, ((peak - value) / peak) * 100.0)

    return {
        "strategy": "BOLLINGER_RSI_MEAN_REVERSION",
        "candleCount": max(0, end_index - start_index),
        "initialCash": cash,
        "feeRate": fee_rate,
        "bbPeriod": bb_period,
        "bbStdDev": bb_std,
        "rsiPeriod": rsi_period,
        "rsiOversold": rsi_oversold,
        "takeProfitPercentNet": take_profit_percent,
        "stopLossPercentGross": stop_loss_percent,
        "realizedPnl": realized,
        "openPnl": open_pnl,
        "netPnl": net_pnl,
        "totalReturnPercent": (net_pnl / cash * 100.0) if cash else 0.0,
        "maxDrawdownPercent": max_drawdown,
        "totalTrades": trades,
        "winningTrades": wins,
        "losingTrades": losses_count,
        "winRatePercent": (wins / trades * 100.0) if trades else 0.0,
        "averageWinPnl": (win_pnl_total / wins) if wins else 0.0,
        "averageLossPnl": (loss_pnl_total / losses_count) if losses_count else 0.0,
        "expectancyPerTrade": (realized / trades) if trades else 0.0,
        "openPosition": position is not None,
    }

def mean_reversion_validate(payload: dict) -> dict:
    closes = payload.get("closes") or payload.get("prices") or []
    if len(closes) < 300:
        raise ValueError("At least 300 five-minute candles are required for mean-reversion validation.")

    n = len(closes)
    split = max(200, int(n * 0.70))
    split = min(split, n - 100)

    full = _run_mean_reversion(payload, 0, n)
    train = _run_mean_reversion(payload, 0, split)
    out_of_sample = _run_mean_reversion(payload, split, n)

    walk_forward = []
    positive_folds = 0
    for fold_no, ratio in enumerate([0.40, 0.55, 0.70, 0.85], start=1):
        start = int(n * ratio)
        end = min(n, start + max(60, int(n * 0.15)))
        if end - start < 40:
            continue
        fold = _run_mean_reversion(payload, start, end)
        fold["fold"] = fold_no
        walk_forward.append(fold)
        if fold["totalReturnPercent"] > 0:
            positive_folds += 1

    return {
        "engine": "vectorbt-compatible",
        "validation": "BOLLINGER_RSI_LIVE_STRATEGY",
        "granularity": payload.get("granularity", "FIVE_MINUTE"),
        "candleCount": n,
        "trainCandles": split,
        "outOfSampleCandles": n - split,
        "feeRate": float(payload.get("feeRate", 0.006)),
        "full": full,
        "train": train,
        "outOfSample": out_of_sample,
        "walkForward": walk_forward,
        "walkForwardPositiveFolds": positive_folds,
        "walkForwardFoldCount": len(walk_forward),
        "validationFlag": "PASSING_EVIDENCE"
            if out_of_sample["totalReturnPercent"] > 0 and positive_folds >= max(1, len(walk_forward) // 2 + 1)
            else "NEEDS_MORE_EVIDENCE",
    }

def mean_reversion_optimize(payload: dict) -> dict:
    closes = payload.get("closes") or payload.get("prices") or []
    if len(closes) < 10000:
        raise ValueError("At least 10000 five-minute candles are required for stop-loss optimization.")

    stop_grid = payload.get("stopLossPercentGrid") or [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5]
    take_profit_grid = payload.get("takeProfitNetPercentGrid") or [2.5, 3.5, 4.5, 5.5, 6.5, 7.5]

    n = len(closes)
    split = int(n * 0.70)
    results = []

    for stop_loss in stop_grid:
        for take_profit in take_profit_grid:
            candidate = dict(payload)
            candidate["stopLossPercent"] = float(stop_loss)
            candidate["takeProfitPercent"] = float(take_profit)

            train = _run_mean_reversion(candidate, 0, split)
            out_of_sample = _run_mean_reversion(candidate, split, n)

            avg_loss = float(out_of_sample.get("averageLossPnl", 0.0))
            avg_win = float(out_of_sample.get("averageWinPnl", 0.0))
            rr = (avg_win / avg_loss) if avg_loss > 0 else (999.0 if avg_win > 0 else 0.0)
            closed = int(out_of_sample.get("totalTrades", 0))
            expectancy = float(out_of_sample.get("expectancyPerTrade", 0.0))

            results.append({
                "stopLossPercent": float(stop_loss),
                "takeProfitNetPercent": float(take_profit),
                "roundTripFeeRate": float(payload.get("feeRate", 0.006)) * 2.0,
                "trainReturnPercent": float(train.get("totalReturnPercent", 0.0)),
                "outOfSampleReturnPercent": float(out_of_sample.get("totalReturnPercent", 0.0)),
                "outOfSampleMaxDrawdownPercent": float(out_of_sample.get("maxDrawdownPercent", 0.0)),
                "outOfSampleTrades": closed,
                "outOfSampleWinRatePercent": float(out_of_sample.get("winRatePercent", 0.0)),
                "averageWinPnl": avg_win,
                "averageLossPnl": avg_loss,
                "realizedRewardRiskRatio": rr,
                "expectancyPerTrade": expectancy,
                "sampleAdequacy": "ADEQUATE" if closed >= 30 else ("LIMITED" if closed >= 10 else "INSUFFICIENT"),
            })

    ranked = sorted(
        results,
        key=lambda x: (
            x["sampleAdequacy"] == "ADEQUATE",
            x["expectancyPerTrade"] > 0,
            x["outOfSampleReturnPercent"],
            -x["outOfSampleMaxDrawdownPercent"],
        ),
        reverse=True,
    )

    return {
        "engine": "vectorbt-compatible",
        "optimization": "MEAN_REVERSION_STOP_TAKE_PROFIT_GRID",
        "candleCount": n,
        "trainCandles": split,
        "outOfSampleCandles": n - split,
        "feeRatePerSide": float(payload.get("feeRate", 0.006)),
        "roundTripFeeRate": float(payload.get("feeRate", 0.006)) * 2.0,
        "stopLossGrid": [float(x) for x in stop_grid],
        "takeProfitNetGrid": [float(x) for x in take_profit_grid],
        "resultCount": len(ranked),
        "topResults": ranked[:12],
        "allResults": ranked,
        "promotionRule": "Do not promote a parameter set to live trading unless out-of-sample expectancy is positive and sample adequacy is ADEQUATE.",
    }

def nautilus_smoke() -> dict:
    from nautilus_trader.backtest import BacktestEngine
    from nautilus_trader.config import BacktestEngineConfig
    from nautilus_trader.model import TraderId

    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId.from_str("MY-TRADING-AGENT-001"),
        )
    )
    try:
        return {
            "engine": "nautilus_trader",
            "initialized": True,
            "version": metadata.version("nautilus_trader"),
            "message": "BacktestEngine initialized successfully.",
        }
    finally:
        engine.dispose()

def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command == "status":
        result = status()
    elif command == "vectorbt-sma":
        payload = json.loads(sys.stdin.read() or "{}")
        result = vectorbt_sma(payload)
    elif command == "vectorbt-validate":
        payload = json.loads(sys.stdin.read() or "{}")
        result = vectorbt_validate(payload)
    elif command == "mean-reversion-validate":
        payload = json.loads(sys.stdin.read() or "{}")
        result = mean_reversion_validate(payload)
    elif command == "mean-reversion-optimize":
        payload = json.loads(sys.stdin.read() or "{}")
        result = mean_reversion_optimize(payload)
    elif command == "nautilus-smoke":
        result = nautilus_smoke()
    else:
        raise ValueError(f"Unknown command: {command}")
    print(json.dumps({"ok": True, "result": result}, separators=(",", ":"), allow_nan=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, separators=(",", ":"), allow_nan=False))
        sys.exit(1)
