import { getSetting,setSetting } from './db.js'
import { publish } from './events.js'

export const LOSS_GUARD_AGENT_ID='loss_guard'

export const getLossGuardState=()=>({
  active:getSetting('rolling_kill_switch_locked','false')==='true',
  armed:getSetting('rolling_kill_switch_locked','false')!=='true',
  triggeredAt:getSetting('rolling_risk_pause_started_at','')||null,
  productId:null,
  lossUsd:0,
  lossPercent:Number(getSetting('rolling_risk_last_state','')
    ?(()=>{
        try{return JSON.parse(getSetting('rolling_risk_last_state','{}')).drawdownPercent||0}catch{return 0}
      })()
    :0),
  resetAt:getSetting('rolling_kill_switch_reset_at','')||null,
  behavior:'The only production equity lockdown is the latched 3% rolling 24-hour kill switch. Manual reset is required.'
})

// Kept only for API/backward compatibility. A single losing SELL no longer
// activates a global stop; production lockdown is controlled by rolling equity.
export const triggerLossGuard=async(input:{
  productId:string
  realizedNetProfitUsd:number
  realizedNetProfitPercent:number|null
  triggeredAt?:string
})=>{
  publish('legacy_single_loss_guard_ignored',{
    ...input,
    timestampIso:new Date().toISOString(),
    message:'Single-loss guard is disabled by the deterministic production profile.'
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
  if(getSetting('emergency_stop_reason','')==='LOSS_GUARD'){
    setSetting('emergency_stop','false')
    setSetting('emergency_stop_reason','')
  }
  publish('legacy_loss_guard_reset',{
    resetAt,
    message:'Legacy single-loss guard state cleared.'
  },LOSS_GUARD_AGENT_ID)
  return getLossGuardState()
}

export const initializeLossGuard=async()=>{
  // Migrate away from the previous "any realized loss" global stop model.
  if(getSetting('loss_guard_active','false')==='true'||getSetting('loss_halt_active','false')==='true'){
    resetLossGuard()
  }
  publish('loss_guard_compatibility_mode',{
    state:'DISABLED',
    message:'Single-loss shutdown is disabled. Production protection uses the 3% rolling 24-hour kill switch.'
  },LOSS_GUARD_AGENT_ID)
  return getLossGuardState()
}

export const stopLossGuard=()=>{}
