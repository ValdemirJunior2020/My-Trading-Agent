// Dollar-denominated trailing profit based on observed modeled exit marks.
export function trailingProfit(p,pnl,{activation=1,giveback=.35,minGiveback=.25}={}){
 if(!Number.isFinite(pnl)||!Number.isFinite(activation)||activation<=0)return false;
 p.peakProfit=Math.max(Number.isFinite(p.peakProfit)?p.peakProfit:0,pnl);
 if(p.peakProfit<activation)return false;
 p.profitFloor=Math.max(0,p.peakProfit-Math.max(minGiveback,p.peakProfit*giveback));
 return pnl<=p.profitFloor;
}
