// The legacy position field remains the first position for old read-only clients.
export function positions(s){return Array.isArray(s.positions)?s.positions:s.position?[s.position]:[]}
export function setPositions(s,list){s.positions=list;s.position=list[0]||null}
export function invested(s){return positions(s).reduce((n,p)=>n+p.entry*p.shares,0)}
export function reservedRisk(s){return positions(s).reduce((n,p)=>n+Math.max(0,(p.entry-p.stop)*p.shares+(p.fees||0)),0)}
export function addVirtualCapital(s,amount){if(positions(s).length)throw Error('Close all positions before adding virtual capital');if(!Number.isFinite(amount)||amount<0||amount>500)throw Error('Invalid virtual capital');if(amount>s.balance){const delta=amount-s.balance;s.balance=amount;s.events.push({time:new Date().toISOString(),type:'virtual-capital-adjustment',amount:delta,balance:s.balance});return delta}return 0}
