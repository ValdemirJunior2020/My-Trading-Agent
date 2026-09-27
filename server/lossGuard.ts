import { getSetting,livePlacedOrders,setSetting } from './db.js'
import { cancelOrders,listOpenOrders } from './coinbase.js'
import { publish } from './events.js'

export const LOSS_GUARD_AGENT_ID='loss_guard'

const isoMs=(value:string)=>{
  const ms=new Date(value).getTime()
  return Number.isFinite(ms)?ms:0
}

export const getLossGuardState=()=>({
  active:getSetting('loss_guard_active','false')==='true',
  armed:getSetting('loss_guard_active','false')!=='true',
  triggeredAt:getSetting('loss_guard_triggered_at','')||null,
  productId:getSetting('loss_guard_product','')||null,
  lossUsd:Number(getSetting('loss_guard_amount_usd','0'))||0,
  lossPercent:Number(getSetting('loss_guard_percent','0'))||0,
  resetAt:getSetting('loss_guard_reset_at','')||null,
  behavior:'ANY realized losing SELL activates the global emergency stop. No BUY or SELL execution is allowed until manually reset.'
})

export const triggerLossGuard=async(input:{
  productId:string
  realizedNetProfitUsd:number
  realizedNetProfitPercent:number|null
  triggeredAt?:string
})=>{
  const triggeredAt=input.triggeredAt||new Date().toISOString()

  setSetting('loss_guard_active','true')
  setSetting('loss_guard_triggered_at',triggeredAt)
  setSetting('loss_guard_product',input.productId)
  setSetting('loss_guard_amount_usd',String(input.realizedNetProfitUsd))
  setSetting('loss_guard_percent',String(input.realizedNetProfitPercent??0))

  // Keep the older loss-halt fields populated for backwards-compatible UI/history,
  // but LOSS_GUARD owns the stronger behavior: the entire live execution gate stops.
  setSetting('loss_halt_active','true')
  setSetting('loss_halt_triggered_at',triggeredAt)
  setSetting('loss_halt_product',input.productId)
  setSetting('loss_halt_amount_usd',String(input.realizedNetProfitUsd))

  setSetting('emergency_stop','true')
  setSetting('emergency_stop_reason','LOSS_GUARD')

  let canceledOrderIds:string[]=[]
  try{
    const openOrders=await listOpenOrders()
    const ids=openOrders.map((o:any)=>String(o.order_id||'')).filter(Boolean)
    if(ids.length){
      await cancelOrders(ids)
      canceledOrderIds=ids
    }
  }catch(error){
    publish('loss_guard_cancel_failed',{
      productId:input.productId,
      error:error instanceof Error?error.message:String(error)
    },LOSS_GUARD_AGENT_ID)
  }

  publish('loss_guard_triggered',{
    productId:input.productId,
    realizedNetProfitUsd:input.realizedNetProfitUsd,
    realizedNetProfitPercent:input.realizedNetProfitPercent,
    triggeredAt,
    canceledOrderIds,
    message:'REALIZED LOSS DETECTED — GLOBAL EMERGENCY STOP ACTIVATED. ALL LIVE BUY AND SELL EXECUTION IS BLOCKED UNTIL MANUALLY RESET.'
  },LOSS_GUARD_AGENT_ID)

  return getLossGuardState()
}

export const resetLossGuard=()=>{
  const resetAt=new Date().toISOString()
  setSetting('loss_guard_active','false')
  setSetting('loss_guard_reset_at',resetAt)
  setSetting('loss_guard_triggered_at','')
  setSetting('loss_guard_product','')
  setSetting('loss_guard_amount_usd','0')
  setSetting('loss_guard_percent','0')
  setSetting('loss_halt_active','false')
  setSetting('loss_halt_triggered_at','')
  setSetting('loss_halt_product','')
  setSetting('loss_halt_amount_usd','')
  publish('loss_guard_reset',{
    resetAt,
    message:'Loss Guard reset manually. It is armed and waiting for the next realized loss.'
  },LOSS_GUARD_AGENT_ID)
  return getLossGuardState()
}

export const initializeLossGuard=async()=>{
  if(getSetting('loss_guard_active','false')==='true'){
    setSetting('emergency_stop','true')
    setSetting('emergency_stop_reason','LOSS_GUARD')
    publish('loss_guard_waiting',{
      state:'STOPPED',
      message:'Loss Guard remains latched from a realized loss. Global emergency stop is active.'
    },LOSS_GUARD_AGENT_ID)
    return getLossGuardState()
  }

  const resetAtMs=isoMs(getSetting('loss_guard_reset_at',''))
  const latestLoss=livePlacedOrders(5000).find((event:any)=>{
    const p:any=event.payload||{}
    if(String(p.side||'').toUpperCase()!=='SELL')return false
    const pnl=Number(p.realizedNetProfitUsd)
    if(!Number.isFinite(pnl)||pnl>=0)return false
    const eventMs=isoMs(String(event.createdAt||p.placedAt||''))
    return eventMs>resetAtMs
  })

  if(latestLoss){
    const p:any=latestLoss.payload||{}
    return triggerLossGuard({
      productId:String(p.productId||'UNKNOWN'),
      realizedNetProfitUsd:Number(p.realizedNetProfitUsd),
      realizedNetProfitPercent:Number.isFinite(Number(p.realizedNetProfitPercent))
        ?Number(p.realizedNetProfitPercent)
        :null,
      triggeredAt:String(latestLoss.createdAt||p.placedAt||new Date().toISOString())
    })
  }

  publish('loss_guard_waiting',{
    state:'ARMED',
    message:'Loss Guard is armed and waiting. Any realized loss will stop all live execution.'
  },LOSS_GUARD_AGENT_ID)
  return getLossGuardState()
}
