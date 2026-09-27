from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
import vectorbt as vbt

DB_PATH = Path("data") / "my-trading-agent.db"
PRODUCTS = ["SOL-USD", "XRP-USD", "BTC-USD"]
GRANULARITY = "FIVE_MINUTE"

INITIAL_CASH = 100.0
POSITION_USD = 100.0
MAX_CONCURRENT = 1
FEE_RATE = 0.006
VOLUME_MULTIPLIER = 1.5
HARD_STOP_PERCENT = 1.5
TRAILING_ACTIVATION_NET_PERCENT = 8.0
TRAILING_DISTANCE_PERCENT = 1.5

def load_candles(conn, product_id):
    frame = pd.read_sql_query(
        """SELECT start, open, high, low, close, volume FROM market_candles
           WHERE product_id=? AND granularity=? ORDER BY start ASC""",
        conn, params=(product_id, GRANULARITY))
    if frame.empty:
        return frame
    frame["timestamp"] = pd.to_datetime(frame["start"], unit="s", utc=True)
    frame = frame.set_index("timestamp").sort_index()
    # One candle per asset/timestamp keeps the global event stream deterministic.
    return frame[~frame.index.duplicated(keep="last")]

def prepare_signals(frame):
    close = frame["close"].astype(float)
    volume = frame["volume"].astype(float)

    bb = vbt.BBANDS.run(close, window=20, alpha=2)
    lower = pd.Series(bb.lower, index=frame.index, dtype=float)
    vma20 = volume.rolling(20).mean()

    delta = close.diff()
    gains = delta.clip(lower=0.0).rolling(14).mean()
    losses = (-delta.clip(upper=0.0)).rolling(14).mean()
    rs = gains / losses.replace(0.0, np.nan)
    rsi = (100.0 - (100.0 / (1.0 + rs))).fillna(100.0)

    previous_below = close.shift(1) < lower.shift(1)
    reclaimed_lower = previous_below & (close >= lower)
    volume_confirmed = volume >= (vma20 * VOLUME_MULTIPLIER)

    previous_rsi_extreme = rsi.shift(1) <= 30.0
    rsi_low_bound_rebound = (
        (rsi > 30.0) &
        (rsi <= 36.0) &
        ((rsi - rsi.shift(1)) >= 1.0)
    )

    out = frame.copy()
    out["lower_bb"] = lower
    out["vma20"] = vma20
    out["rsi14"] = rsi
    out["entry"] = (
        reclaimed_lower &
        volume_confirmed &
        previous_rsi_extreme &
        rsi_low_bound_rebound
    ).fillna(False)
    return out

def net_exit_value(price, qty):
    return price * qty * (1.0 - FEE_RATE)

def run_simulation(frames):
    # Build one strictly chronological event stream across every asset.
    # The one global slot rotates to the first valid setup seen after capital is released.
    non_empty_indexes = [pd.Series(df.index) for df in frames.values() if not df.empty]
    if non_empty_indexes:
        merged_timestamps = pd.concat(non_empty_indexes, ignore_index=True)
        timeline = pd.DatetimeIndex(merged_timestamps.drop_duplicates()).sort_values()
    else:
        timeline = pd.DatetimeIndex([])

    cash = INITIAL_CASH
    positions = {}
    closed = []
    equity_curve = []
    first_close_time = None
    scanned_timestamps_after_first_close = 0
    eligible_signals_after_first_close = 0
    trades_opened_after_first_close = 0

    for ts in timeline:
        if first_close_time is not None and ts > first_close_time:
            scanned_timestamps_after_first_close += 1

        closed_this_timestamp = False
        for product_id in list(positions.keys()):
            frame = frames[product_id]
            if ts not in frame.index:
                continue
            row = frame.loc[ts]
            pos = positions[product_id]
            high = float(row["high"])
            low = float(row["low"])
            pos["peak"] = max(float(pos["peak"]), high)
            hard_stop_price = float(pos["fill_price"]) * (1.0 - HARD_STOP_PERCENT / 100.0)
            activation_net_value = float(pos["cost_basis"]) * (1.0 + TRAILING_ACTIVATION_NET_PERCENT / 100.0)
            activation_price = activation_net_value / max(1e-12, float(pos["qty"]) * (1.0 - FEE_RATE))
            if pos["peak"] >= activation_price:
                pos["trailing_active"] = True
            trailing_price = float(pos["peak"]) * (1.0 - TRAILING_DISTANCE_PERCENT / 100.0)
            exit_price = None
            reason = None
            if low <= hard_stop_price:
                exit_price = hard_stop_price
                reason = "HARD_STOP"
            elif pos["trailing_active"] and low <= trailing_price:
                exit_price = trailing_price
                reason = "TRAILING_PROFIT"
            if exit_price is not None:
                proceeds = net_exit_value(exit_price, float(pos["qty"]))
                pnl = proceeds - float(pos["cost_basis"])
                cash += proceeds
                closed.append({
                    "productId": product_id, "entryTime": str(pos["entry_time"]),
                    "exitTime": str(ts), "entryPrice": float(pos["fill_price"]),
                    "exitPrice": float(exit_price), "reason": reason, "pnlUsd": pnl,
                    "returnPercent": (pnl / float(pos["cost_basis"]) * 100.0) if pos["cost_basis"] else 0.0
                })
                del positions[product_id]
                closed_this_timestamp = True
                if first_close_time is None:
                    first_close_time = ts

        # A close releases proceeds immediately, but a new entry waits for the
        # next timestamp/candle. Only one asset can own the global slot.
        if not closed_this_timestamp:
            for product_id in PRODUCTS:
                frame = frames[product_id]
                if len(positions) >= MAX_CONCURRENT or cash <= 0.0:
                    break
                if product_id in positions or ts not in frame.index:
                    continue
                row = frame.loc[ts]
                if not bool(row["entry"]):
                    continue
                if first_close_time is not None and ts > first_close_time:
                    eligible_signals_after_first_close += 1
                close = float(row["close"])
                if not (close > 0):
                    continue

                # POSITION_USD is a target/cap, not a minimum-cash gate.
                # Recycle all available cash after fees/losses instead of
                # permanently blocking future trades below exactly $100.
                gross_deployed = min(POSITION_USD, cash)
                if gross_deployed <= 0.0:
                    continue
                entry_fee = gross_deployed * FEE_RATE
                net_asset_value = gross_deployed - entry_fee
                qty = net_asset_value / close
                cash -= gross_deployed
                positions[product_id] = {
                    "entry_time": ts, "fill_price": close, "qty": qty,
                    "cost_basis": gross_deployed, "peak": close, "trailing_active": False
                }
                if first_close_time is not None and ts > first_close_time:
                    trades_opened_after_first_close += 1

        marked_positions = 0.0
        for product_id, pos in positions.items():
            frame = frames[product_id]
            if ts in frame.index:
                marked_positions += net_exit_value(float(frame.loc[ts]["close"]), float(pos["qty"]))
            else:
                marked_positions += float(pos["cost_basis"])
        equity_curve.append(cash + marked_positions)

    final_open_value = 0.0
    for product_id, pos in positions.items():
        final_price = float(frames[product_id].iloc[-1]["close"])
        final_open_value += net_exit_value(final_price, float(pos["qty"]))
    final_equity = cash + final_open_value

    peak = equity_curve[0] if equity_curve else INITIAL_CASH
    max_drawdown = 0.0
    for value in equity_curve:
        peak = max(peak, value)
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - value) / peak * 100.0)

    wins = [t for t in closed if t["pnlUsd"] > 0]
    losses = [t for t in closed if t["pnlUsd"] < 0]
    total_trades = len(closed)
    win_rate = (len(wins) / total_trades * 100.0) if total_trades else 0.0
    avg_win = float(np.mean([t["pnlUsd"] for t in wins])) if wins else 0.0
    avg_loss_abs = float(np.mean([abs(t["pnlUsd"]) for t in losses])) if losses else 0.0
    win_prob = len(wins) / total_trades if total_trades else 0.0
    loss_prob = len(losses) / total_trades if total_trades else 0.0
    expectancy = (win_prob * avg_win) - (loss_prob * avg_loss_abs)

    if first_close_time is None:
        scan_validation = "NOT_APPLICABLE"
    elif scanned_timestamps_after_first_close <= 0:
        scan_validation = "FAILED"
    elif eligible_signals_after_first_close > 0 and total_trades <= 1:
        scan_validation = "FAILED"
    else:
        scan_validation = "PASSED"

    return {
        "initialCapitalUsd": INITIAL_CASH,
        "positionSizeUsd": POSITION_USD,
        "maxConcurrentPositions": MAX_CONCURRENT,
        "feeRatePerSide": FEE_RATE,
        "roundTripFeePercent": FEE_RATE * 2.0 * 100.0,
        "hardStopPercent": HARD_STOP_PERCENT,
        "trailingActivationNetPercent": TRAILING_ACTIVATION_NET_PERCENT,
        "trailingDistancePercent": TRAILING_DISTANCE_PERCENT,
        "previousRsiAtOrBelow": 30.0,
        "currentRsiAbove": 30.0,
        "currentRsiMax": 36.0,
        "minimumRsiRecoveryPoints": 1.0,
        "volumeMultiplier": VOLUME_MULTIPLIER,
        "finalPortfolioEquityUsd": final_equity,
        "netProfitUsd": final_equity - INITIAL_CASH,
        "maxDrawdownPercent": max_drawdown,
        "closedTrades": total_trades,
        "winningTrades": len(wins),
        "losingTrades": len(losses),
        "winRatePercent": win_rate,
        "averageWinUsd": avg_win,
        "averageLossUsd": avg_loss_abs,
        "expectancyPerTradeUsd": expectancy,
        "openPositionsAtEnd": len(positions),
        "scanValidation": scan_validation,
        "timestampsScannedAfterFirstClose": scanned_timestamps_after_first_close,
        "eligibleSignalsAfterFirstClose": eligible_signals_after_first_close,
        "tradesOpenedAfterFirstClose": trades_opened_after_first_close,
        "sampleAdequacy": "ADEQUATE" if total_trades >= 30 else ("LIMITED" if total_trades >= 10 else "INSUFFICIENT"),
        "trades": closed
    }

def main():
    if not DB_PATH.exists():
        raise SystemExit("SQLite database not found: " + str(DB_PATH))
    with sqlite3.connect(DB_PATH) as conn:
        frames = {}
        for product_id in PRODUCTS:
            frame = load_candles(conn, product_id)
            if len(frame) < 1000:
                raise SystemExit(product_id + " has only " + str(len(frame)) + " candles in SQLite. Run ingestion first.")
            frames[product_id] = prepare_signals(frame)
    result = run_simulation(frames)
    print("=" * 64)
    print(" $100 ACCOUNT GROWTH BACKTEST")
    print("=" * 64)
    print("Products:                 " + ", ".join(PRODUCTS))
    print("Initial equity:           $%.2f" % result["initialCapitalUsd"])
    print("Final equity:             $%.2f" % result["finalPortfolioEquityUsd"])
    print("Net profit:               $%.2f" % result["netProfitUsd"])
    print("Max drawdown:             %.2f%%" % result["maxDrawdownPercent"])
    print("Position size:            $%.2f" % result["positionSizeUsd"])
    print("RSI entry:                prev <=30, current >30 and <=36")
    print("Trailing activation:      %.2f%% net" % result["trailingActivationNetPercent"])
    print("Hard stop:                %.2f%%" % result["hardStopPercent"])
    print("Closed trades:            %d" % result["closedTrades"])
    print("Win rate:                 %.2f%%" % result["winRatePercent"])
    print("Average win:              $%.4f" % result["averageWinUsd"])
    print("Average loss:             $%.4f" % result["averageLossUsd"])
    print("Expectancy E/trade:       $%.4f" % result["expectancyPerTradeUsd"])
    print("Sample adequacy:          " + result["sampleAdequacy"])
    print("Open positions at end:    %d" % result["openPositionsAtEnd"])
    print("Scan validation:          " + result["scanValidation"])
    print("=" * 64)

if __name__ == "__main__":
    main()
