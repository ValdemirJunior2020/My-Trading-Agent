export function explainDecision(row){
 const status=row.status,m=row.metrics;
 const dictionary={
 'MOVE ON':['This stock has slowed down. We are looking for better opportunities.','It could recover later.','Price is moving sideways and volume has declined.','Keep checking for a fresh breakout with stronger volume.'],
 'BUY CANDIDATE':['Several technical and risk checks passed. Review the simulated plan.','The backend verified a breakout and risk limits.','The price can still reverse or fill poorly.','Recheck the next completed candle and the planned stop.'],
 'HOLD':['A simulated position is already open.','The current position is being reviewed.','Adding shares could increase risk.','Review the existing exit conditions; do not add shares.'],
 'INSUFFICIENT DATA':['We do not have reliable information to make a decision.','None confirmed.','The data is missing, stale or unverified.','Wait for a verified market-data connection.'],
 'WAIT':['The current evidence does not support an entry.','A recovery may develop, but is not confirmed.','The trend or price relative to the volume-weighted average is weak.','Look for improving momentum and a completed candle confirming strength.'],
 'WATCHING':['We are observing the stock, not proposing a purchase.','The stock may develop a stronger trend.','No sufficiently confirmed entry has been identified.','Wait for a confirmed setup, liquidity and a risk check.'],
 'BREAKOUT DETECTED':['Price closed above recent resistance with stronger volume.','The completed candle and volume suggest buying interest.','A breakout can fail; risk and broader conditions are not yet confirmed.','Check whether the price holds above resistance and verify risk before considering an entry.'],
 'FALSE BREAKOUT':['Price moved above resistance but closed back below it.','A new recovery would need fresh evidence.','Buyers failed to maintain the higher price.','Wait for another completed candle and stronger confirmation.'],
 'AVOID':['The stock failed a price or spread safety filter.','No entry is supported by this check.','A wide spread raises trading costs, or the price falls below our filter.','Wait for the safety filter to pass and reassess.']
 };
 const d=dictionary[status]||dictionary['INSUFFICIENT DATA'];
 return {short:d[0],positive:m?d[1]:'None confirmed.',negative:d[2],next:d[3]};
}
