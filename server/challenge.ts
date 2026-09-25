import { getSetting,setSetting } from './db.js'
import { listAccounts,listSpotUsdProducts } from './coinbase.js'

export interface TradingChallenge {
  enabled:boolean
  startingBalanceUsd:number
  targetBalanceUsd:number
  durationDays:number
  startedAt:string
}

const DEFAULT_CHALLENGE:TradingChallenge={
  enabled:true,
  startingBalanceUsd:100,
  targetBalanceUsd:300,
  durationDays:14,
  startedAt:new Date().toISOString()
}

export const getTradingChallenge=():TradingChallenge=>{
  const raw=getSetting('trading_challenge','')
  if(!raw){
    setSetting('trading_challenge',JSON.stringify(DEFAULT_CHALLENGE))
    return DEFAULT_CHALLENGE
  }
  try{
    const parsed=JSON.parse(raw)
    return {
      enabled:Boolean(parsed.enabled),
      startingBalanceUsd:Number(parsed.startingBalanceUsd)||100,
      targetBalanceUsd:Number(parsed.targetBalanceUsd)||300,
      durationDays:Number(parsed.durationDays)||14,
      startedAt:String(parsed.startedAt||new Date().toISOString())
    }
  }catch{
    setSetting('trading_challenge',JSON.stringify(DEFAULT_CHALLENGE))
    return DEFAULT_CHALLENGE
  }
}

export const saveTradingChallenge=(input:Partial<TradingChallenge>)=>{
  const current=getTradingChallenge()
  const next:TradingChallenge={
    enabled:input.enabled??current.enabled,
    startingBalanceUsd:Math.max(1,Number(input.startingBalanceUsd??current.startingBalanceUsd)),
    targetBalanceUsd:Math.max(1,Number(input.targetBalanceUsd??current.targetBalanceUsd)),
    durationDays:Math.max(1,Math.floor(Number(input.durationDays??current.durationDays))),
    startedAt:input.startedAt||current.startedAt||new Date().toISOString()
  }
  setSetting('trading_challenge',JSON.stringify(next))
  return next
}

const balanceValue=(balance:any)=>Number(balance?.value??balance??0)||0

let portfolioCache:{value:any;expiresAt:number}|null=null
let portfolioInFlight:Promise<any>|null=null

export const getEstimatedPortfolioUsd=async(forceFresh=false)=>{
  if(!forceFresh&&portfolioCache&&portfolioCache.expiresAt>Date.now())return portfolioCache.value
  if(!forceFresh&&portfolioInFlight)return portfolioInFlight

  const work=(async()=>{
  const [accounts,products]=await Promise.all([
    listAccounts(100),
    listSpotUsdProducts(500,100)
  ])

  const priceByProduct=new Map(
    products.map((product:any)=>[String(product.productId||'').toUpperCase(),Number(product.price||0)])
  )
  const nonZero=accounts.filter((account:any)=>balanceValue(account.availableBalance)+balanceValue(account.hold)>0)
  let total=0
  const details:any[]=[]

  for(const account of nonZero){
    const amount=balanceValue(account.availableBalance)+balanceValue(account.hold)
    const currency=String(account.currency||'').toUpperCase()
    if(!amount||!currency)continue

    if(currency==='USD'||currency==='USDC'){
      total+=amount
      details.push({currency,amount,usdValue:amount})
      continue
    }

    const productId=currency+'-USD'
    const price=Number(priceByProduct.get(productId)||0)
    if(price>0){
      const usdValue=amount*price
      total+=usdValue
      details.push({currency,amount,price,usdValue})
    }else{
      details.push({currency,amount,usdValue:null})
    }
  }

  const result={
    totalUsd:Number(total.toFixed(2)),
    details,
    accountCount:accounts.length
  }
  portfolioCache={value:result,expiresAt:Date.now()+15000}
  return result
  })()

  if(!forceFresh)portfolioInFlight=work
  try{
    return await work
  }finally{
    if(portfolioInFlight===work)portfolioInFlight=null
  }
}

export const getChallengeSnapshot=async()=>{
  const challenge=getTradingChallenge()
  const deadline=new Date(new Date(challenge.startedAt).getTime()+challenge.durationDays*86400000)
  const now=new Date()
  const daysRemaining=Math.max(0,Math.ceil((deadline.getTime()-now.getTime())/86400000))
  let portfolioUsd:number|null=null
  let accountCount=0
  try{
    const estimated=await getEstimatedPortfolioUsd()
    portfolioUsd=estimated.totalUsd
    accountCount=estimated.accountCount
  }catch{}
  const progressPercent=portfolioUsd==null?null:Math.max(0,Math.min(100,((portfolioUsd-challenge.startingBalanceUsd)/(challenge.targetBalanceUsd-challenge.startingBalanceUsd))*100))
  return {
    ...challenge,
    deadline:deadline.toISOString(),
    daysRemaining,
    currentPortfolioUsd:portfolioUsd,
    accountCount,
    progressPercent:progressPercent==null?null:Number(progressPercent.toFixed(1)),
    requiredGainPercent:Number((((challenge.targetBalanceUsd/challenge.startingBalanceUsd)-1)*100).toFixed(1)),
    riskNote:'This is a goal, not a mandate. Hard risk limits override the target.'
  }
}
