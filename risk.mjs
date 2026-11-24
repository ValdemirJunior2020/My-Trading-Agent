export function calculate({entry,stop,target,capital=100,remainingLoss=5,fees=0}){
 if(![entry,stop,target,capital,remainingLoss,fees].every(Number.isFinite)||entry<5||stop<=0||stop>=entry||target<=entry||capital<=0||remainingLoss<=0||fees<0)return {ok:false,reason:'Invalid inputs or risk limit reached'};
 const budget=Math.min(100,capital), risk=Math.min(2.5,remainingLoss);
 const shares=Math.max(0,Math.min(Math.floor((budget-fees)/entry),Math.floor((risk-fees)/(entry-stop))));
 if(!shares)return {ok:false,reason:'No whole shares fit the risk budget'};
 const loss=shares*(entry-stop)+fees,profit=shares*(target-entry)-fees,ratio=profit/loss;
 return {ok:ratio>=2,shares,cost:shares*entry,loss,profit,ratio,reason:ratio>=2?'Hypothetical risk check passed':'Below 2:1 net reward/risk'};
}
