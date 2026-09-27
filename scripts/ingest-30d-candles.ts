import { getCandles } from '../server/coinbase.js'
import { historicalCandleCount,insertHistoricalCandles } from '../server/db.js'

const PRODUCTS=['SOL-USD','XRP-USD','BTC-USD'] as const
const GRANULARITY='FIVE_MINUTE'
const DAYS=30
const CANDLES_PER_DAY=24*12
const LIMIT=DAYS*CANDLES_PER_DAY

const main=async()=>{
  console.log('[30D INGEST] Starting Coinbase historical candle ingestion')
  console.log('[30D INGEST] Products:',PRODUCTS.join(', '))
  console.log('[30D INGEST] Requested candles per product:',LIMIT)

  for(const productId of PRODUCTS){
    console.log(`[30D INGEST] Fetching ${productId}...`)
    const candles=await getCandles(productId,GRANULARITY,LIMIT)
    const rows=candles.map(c=>({
      productId,
      granularity:GRANULARITY,
      start:Number(c.start),
      low:Number(c.low),
      high:Number(c.high),
      open:Number(c.open),
      close:Number(c.close),
      volume:Number(c.volume)
    }))
    const result=insertHistoricalCandles(rows)
    const total=historicalCandleCount(productId,GRANULARITY)
    console.log(`[30D INGEST] ${productId}: fetched=${rows.length} inserted=${result.inserted} stored=${total}`)
  }

  console.log('[30D INGEST] Complete. SQLite: data/my-trading-agent.db')
}

main().catch(error=>{
  console.error('[30D INGEST] FAILED:',error instanceof Error?error.message:String(error))
  process.exitCode=1
})
