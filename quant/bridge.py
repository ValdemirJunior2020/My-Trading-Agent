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

def vectorbt_sma(payload: dict) -> dict:
    import numpy as np
    import pandas as pd
    import vectorbt as vbt

    prices = payload.get("prices") or []
    fast = int(payload.get("fast", 10))
    slow = int(payload.get("slow", 30))
    cash = float(payload.get("initialCash", 10000))

    if len(prices) < max(slow + 2, 20):
        raise ValueError("Not enough price points for the requested moving averages.")
    if fast <= 0 or slow <= 0 or fast >= slow:
        raise ValueError("Use positive windows with fast < slow.")

    index = pd.date_range(end=pd.Timestamp.now(tz="UTC"), periods=len(prices), freq="h")
    series = pd.Series(np.asarray(prices, dtype=float), index=index)
    fast_ma = vbt.MA.run(series, fast)
    slow_ma = vbt.MA.run(series, slow)
    entries = fast_ma.ma_crossed_above(slow_ma)
    exits = fast_ma.ma_crossed_below(slow_ma)
    portfolio = vbt.Portfolio.from_signals(series, entries, exits, init_cash=cash, fees=0.001, freq="1h")

    stats = portfolio.stats()
    trade_records = portfolio.trades.records_readable
    open_trades = 0
    closed_trades = 0
    if "Status" in trade_records.columns:
        statuses = trade_records["Status"].astype(str).str.lower()
        open_trades = int((statuses == "open").sum())
        closed_trades = int((statuses == "closed").sum())
    def scalar(name: str, default=0.0):
        try:
            value = stats.get(name, default)
            if hasattr(value, "item"):
                value = value.item()
            number = float(value)
            return number if math.isfinite(number) else default
        except Exception:
            return default

    return {
        "engine": "vectorbt",
        "strategy": "SMA_CROSSOVER",
        "fast": fast,
        "slow": slow,
        "initialCash": cash,
        "totalReturnPercent": scalar("Total Return [%]"),
        "maxDrawdownPercent": scalar("Max Drawdown [%]"),
        "winRatePercent": scalar("Win Rate [%]"),
        "totalTrades": int(round(scalar("Total Trades"))),
        "openTrades": open_trades,
        "closedTrades": closed_trades,
        "sharpeRatio": scalar("Sharpe Ratio"),
        "sharpeComputable": math.isfinite(float(stats.get("Sharpe Ratio", float("nan")))) if stats.get("Sharpe Ratio", None) is not None else False,
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
