import { getCandles } from '../server/coinbase.js'
import { historicalCandleCount,insertHistoricalCandles } from '../server/db.js'

const PRODUCTS=['SOL-USD','XRP-USD','BTC-USD','ETH-USD','LINK-USD','ADA-USD','DOGE-USD','AVAX-USD','DOT-USD','POL-USD','ATOM-USD','NEAR-USD','LTC-USD','UNI-USD','SHIB-USD'] as const
const GRANULARITY='FIVE_MINUTE'
const DAYS=90
const CANDLES_PER_DAY=24*12
const LIMIT=DAYS*CANDLES_PER_DAY
const DB_CHUNK_SIZE=2000

const main=async()=>{
  console.log('[90D INGEST] Starting Coinbase historical candle ingestion')
  console.log('[90D INGEST] Products:',PRODUCTS.join(', '))
  console.log('[90D INGEST] Requested candles per product:',LIMIT)

  for(const productId of PRODUCTS){
    console.log(`[90D INGEST] Fetching ${productId}...`)
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
    const result=insertHistoricalCandles(rows,DB_CHUNK_SIZE)
    const total=historicalCandleCount(productId,GRANULARITY)
    console.log(`[90D INGEST] ${productId}: fetched=${rows.length} inserted=${result.inserted} chunks=${result.chunks} stored=${total}`)
  }

  console.log('[90D INGEST] Complete. SQLite: data/my-trading-agent.db')
}

main().catch(error=>{
  console.error('[90D INGEST] FAILED:',error instanceof Error?error.message:String(error))
  process.exitCode=1
})
