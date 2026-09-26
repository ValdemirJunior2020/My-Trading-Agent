export type ExposureAssessmentInput={
  side:'BUY'|'SELL'
  notionalUsd:number
  currentAssetUsd:number
  totalBotExposureUsd:number
  openBotPositions:number
  productAlreadyOpen:boolean
  maxPositionUsd:number
  maxTotalExposureUsd:number
  maxOpenBotPositions:number
}

export const assessExposureLimits=(input:ExposureAssessmentInput)=>{
  const projectedAssetExposureUsd=input.side==='BUY'
    ? input.currentAssetUsd+input.notionalUsd
    : Math.max(0,input.currentAssetUsd-input.notionalUsd)

  const projectedTotalBotExposureUsd=input.side==='BUY'
    ? input.totalBotExposureUsd+input.notionalUsd
    : Math.max(0,input.totalBotExposureUsd-input.notionalUsd)

  const projectedOpenBotPositions=input.side==='BUY'&&!input.productAlreadyOpen
    ? input.openBotPositions+1
    : input.openBotPositions

  const reasons:string[]=[]

  if(input.side==='BUY'&&projectedAssetExposureUsd>input.maxPositionUsd+1e-8){
    reasons.push('Projected asset exposure exceeds the live position cap.')
  }
  if(input.side==='BUY'&&projectedTotalBotExposureUsd>input.maxTotalExposureUsd+1e-8){
    reasons.push('Projected total bot exposure exceeds the live portfolio exposure cap.')
  }
  if(
    input.side==='BUY' &&
    !input.productAlreadyOpen &&
    projectedOpenBotPositions>input.maxOpenBotPositions
  ){
    reasons.push('Maximum number of open bot positions has been reached.')
  }

  return {
    approved:reasons.length===0,
    reasons,
    projectedAssetExposureUsd,
    projectedTotalBotExposureUsd,
    projectedOpenBotPositions
  }
}
