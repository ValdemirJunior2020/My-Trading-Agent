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
