import { getSetting,setSetting } from './db.js'
import { publish } from './events.js'

export const LOSS_GUARD_AGENT_ID='loss_guard'

export const getLossGuardState=()=>{
  const singleLossLocked=getSetting('single_loss_kill_switch_locked','false')==='true'
  const rollingLocked=getSetting('rolling_kill_switch_locked','false')==='true'
  const singleLossUsd=Number(getSetting('single_loss_kill_switch_loss_usd','0')||0)
  const singleLossPercent=Number(getSetting('single_loss_kill_switch_loss_percent','0')||0)

  return {
    active:singleLossLocked||rollingLocked,
    armed:!singleLossLocked&&!rollingLocked,
    singleLossLocked,
    rollingLocked,
    triggeredAt:singleLossLocked
      ?getSetting('single_loss_kill_switch_triggered_at','')||null
      :getSetting('rolling_risk_pause_started_at','')||null,
    productId:singleLossLocked
      ?getSetting('single_loss_kill_switch_product','')||null
      :null,
    lossUsd:singleLossLocked?singleLossUsd:0,
    lossPercent:singleLossLocked
      ?singleLossPercent
      :Number(getSetting('rolling_risk_last_state','')
        ?(()=>{
            try{return JSON.parse(getSetting('rolling_risk_last_state','{}')).drawdownPercent||0}catch{return 0}
          })()
        :0),
    resetAt:getSetting('loss_guard_reset_at','')||getSetting('rolling_kill_switch_reset_at','')||null,
    behavior:'First realized losing SELL pauses new BUYs, keeps existing-position exits active, does not liquidate other positions, and requires manual reset. The 3% rolling 24-hour equity guard pauses new BUYs without forced loss liquidation; profitable exits remain allowed.'
  }
}

// Backward-compatible entry point. The production trigger now lives in the
// execution layer so every realized bot SELL is checked at the fill boundary.
export const triggerLossGuard=async(input:{
  productId:string
  realizedNetProfitUsd:number
  realizedNetProfitPercent:number|null
  triggeredAt?:string
})=>{
  publish('loss_guard_observed_realized_sell',{
    ...input,
    timestampIso:new Date().toISOString()
  },LOSS_GUARD_AGENT_ID)
  return getLossGuardState()
}

export const resetLossGuard=()=>{
  const resetAt=new Date().toISOString()

  setSetting('single_loss_kill_switch_locked','false')
  setSetting('single_loss_kill_switch_triggered_at','')
  setSetting('single_loss_kill_switch_product','')
  setSetting('single_loss_kill_switch_loss_usd','0')
  setSetting('single_loss_kill_switch_loss_percent','0')

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
  setSetting('loss_halt_reason','')

  if(['LOSS_GUARD','SINGLE_REALIZED_LOSS'].includes(getSetting('emergency_stop_reason',''))){
    setSetting('emergency_stop','false')
    setSetting('emergency_stop_reason','')
  }

  publish('single_loss_kill_switch_manual_reset',{
    resetAt,
    message:'Single-loss entry pause manually reset.'
  },LOSS_GUARD_AGENT_ID)

  return getLossGuardState()
}

export const initializeLossGuard=async()=>{
  const state=getLossGuardState()

  // A latched first-loss state pauses new BUYs only. Existing-position exits
  // remain active. The rolling guard remains a separate portfolio-level BUY pause without forced loss liquidation.
  if(state.singleLossLocked){
    setSetting('loss_guard_active','true')
    setSetting('loss_halt_active','true')
    if(getSetting('emergency_stop_reason','').toUpperCase()==='SINGLE_REALIZED_LOSS'){
      setSetting('emergency_stop','false')
      setSetting('emergency_stop_reason','')
    }
  }

  publish('loss_guard_ready',{
    state:state.active?'LOCKED':'ARMED',
    singleLossLocked:state.singleLossLocked,
    rollingLocked:state.rollingLocked,
    behavior:state.behavior
  },LOSS_GUARD_AGENT_ID)

  return getLossGuardState()
}

export const stopLossGuard=()=>{}
