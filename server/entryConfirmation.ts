export type EntryConfirmationInput={
  currentRsi:number
  previousRsi:number
  currentClose:number
  previousClose:number
  previousHigh:number
  currentLowerBand:number
  previousLowerBand:number
  threeCandleReturnPercent:number
  currentVolume:number
  previousVolumes:number[]
  rsiExtremeThreshold:number
  rsiRecoveryThreshold:number
  rsiMax:number
  minimumRsiRecoveryPoints:number
  minimumVolumeRatio:number
  maximumThreeCandleDropPercent:number
}

export type EntryConfirmationResult={
  approved:boolean
  volumeAverage20:number
  volumeRatio:number
  rsiRecoveryPoints:number
  blockers:string[]
}

const average=(values:number[])=>values.length
  ? values.reduce((sum,value)=>sum+value,0)/values.length
  : 0

export const validateMeanReversionEntry=(input:EntryConfirmationInput):EntryConfirmationResult=>{
  const cleanVolumes=input.previousVolumes
    .map(Number)
    .filter(value=>Number.isFinite(value)&&value>0)
    .slice(-20)
  const volumeAverage20=average(cleanVolumes)
  const volumeRatio=volumeAverage20>0?input.currentVolume/volumeAverage20:0
  const rsiRecoveryPoints=input.currentRsi-input.previousRsi

  const previousWasExtreme=input.previousRsi<=input.rsiExtremeThreshold
  const rsiRecovered=
    input.currentRsi>input.rsiRecoveryThreshold &&
    input.currentRsi<=input.rsiMax &&
    rsiRecoveryPoints>=input.minimumRsiRecoveryPoints

  const reclaimedLowerBand=
    input.previousClose<input.previousLowerBand &&
    input.currentClose>=input.currentLowerBand

  const bullishBreak=input.currentClose>input.previousHigh
  const threeCandleMomentumOk=input.threeCandleReturnPercent>-Math.abs(input.maximumThreeCandleDropPercent)
  const volumeConfirmed=volumeRatio>=input.minimumVolumeRatio

  const blockers:string[]=[]
  if(!previousWasExtreme)blockers.push('PREVIOUS_RSI_NOT_EXTREME')
  if(!rsiRecovered)blockers.push('RSI_RECOVERY_NOT_CONFIRMED')
  if(!reclaimedLowerBand)blockers.push('LOWER_BOLLINGER_NOT_RECLAIMED')
  if(!bullishBreak)blockers.push('NO_BULLISH_BREAK_ABOVE_PREVIOUS_HIGH')
  if(!threeCandleMomentumOk)blockers.push('THREE_CANDLE_DROP_TOO_LARGE')
  if(!volumeConfirmed)blockers.push('VMA20_VOLUME_BELOW_REQUIRED_RATIO')

  return {
    approved:blockers.length===0,
    volumeAverage20,
    volumeRatio,
    rsiRecoveryPoints,
    blockers
  }
}
