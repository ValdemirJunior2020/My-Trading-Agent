import { rankResearchCandidates } from './ollama.js'

type ResearchSource={
  name:string
  url:string
  kind:'rss'|'html'
}

type ResearchItem={
  source:string
  title:string
  published?:string
}

export type MarketResearchResult={
  status:'ok'|'fallback'
  rankedProductIds:string[]
  marketSentiment:string
  sourceCount:number
  sources:string[]
  itemCount:number
  model?:string
  reason?:string
}

const SOURCES:ResearchSource[]=[
  {name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/',kind:'rss'},
  {name:'Cointelegraph',url:'https://cointelegraph.com/rss',kind:'rss'},
  {name:'Decrypt',url:'https://decrypt.co/feed',kind:'rss'},
  {name:'Yahoo Finance Crypto',url:'https://finance.yahoo.com/topic/crypto/',kind:'html'}
]

let cached:{key:string;at:number;value:MarketResearchResult}|null=null
const CACHE_MS=10*60*1000

const decodeEntities=(value:string)=>value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;|&apos;/g,"'")
  .replace(/&lt;/g,'<')
  .replace(/&gt;/g,'>')
  .replace(/<[^>]+>/g,' ')
  .replace(/\s+/g,' ')
  .trim()

const extractTag=(block:string,tag:string)=>{
  const match=block.match(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)<\\/'+tag+'>','i'))
  return match?decodeEntities(match[1]):''
}

const parseRss=(source:string,xml:string):ResearchItem[]=>{
  const blocks=xml.match(/<item\b[\s\S]*?<\/item>/gi)||xml.match(/<entry\b[\s\S]*?<\/entry>/gi)||[]
  return blocks.slice(0,35).map(block=>({
    source,
    title:extractTag(block,'title'),
    published:extractTag(block,'pubDate')||extractTag(block,'updated')||extractTag(block,'published')||undefined
  })).filter(item=>item.title.length>4)
}

const parseHtmlHeadlines=(source:string,html:string):ResearchItem[]=>{
  const matches=[...html.matchAll(/<(?:h1|h2|h3)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3)>/gi)]
  const titles:string[]=[]
  for(const match of matches){
    const title=decodeEntities(match[1]||'')
    if(title.length<12||title.length>220)continue
    if(!titles.includes(title))titles.push(title)
    if(titles.length>=35)break
  }
  return titles.map(title=>({source,title}))
}

const fetchSource=async(source:ResearchSource):Promise<ResearchItem[]>=>{
  const response=await fetch(source.url,{
    headers:{
      'User-Agent':'My-Trading-Agent/1.0 (+local research; public headlines only)',
      'Accept':source.kind==='rss'
        ?'application/rss+xml, application/xml, text/xml, text/plain;q=0.8'
        :'text/html,application/xhtml+xml'
    },
    signal:AbortSignal.timeout(7000)
  })
  if(!response.ok)throw new Error(source.name+' HTTP '+response.status)
  const body=await response.text()
  return source.kind==='rss'?parseRss(source.name,body):parseHtmlHeadlines(source.name,body)
}

export const researchCryptoCandidates=async(candidateProductIds:string[]):Promise<MarketResearchResult>=>{
  const allow=[...new Set(candidateProductIds.map(x=>String(x).toUpperCase()).filter(x=>/^[A-Z0-9]+-USD$/.test(x)))]
  const key=allow.join('|')
  if(cached&&cached.key===key&&Date.now()-cached.at<CACHE_MS)return cached.value
  if(!allow.length)return {
    status:'fallback',
    rankedProductIds:[],
    marketSentiment:'UNKNOWN',
    sourceCount:0,
    sources:[],
    itemCount:0,
    reason:'No Coinbase USD candidates were supplied.'
  }

  const settled=await Promise.allSettled(SOURCES.map(fetchSource))
  const items:ResearchItem[]=[]
  const sources:string[]=[]
  for(let i=0;i<settled.length;i++){
    const result=settled[i]
    if(result.status!=='fulfilled'||!result.value.length)continue
    sources.push(SOURCES[i].name)
    items.push(...result.value)
  }

  if(sources.length<2||items.length<8){
    const value:MarketResearchResult={
      status:'fallback',
      rankedProductIds:allow,
      marketSentiment:'UNKNOWN',
      sourceCount:sources.length,
      sources,
      itemCount:items.length,
      reason:'Fewer than two usable public research sources were available.'
    }
    cached={key,at:Date.now(),value}
    return value
  }

  try{
    const evidence=items.slice(0,100).map((item,index)=>
      (index+1)+'. ['+item.source+'] '+item.title+(item.published?' | '+item.published:'')
    ).join('\n')

    const ranked=await rankResearchCandidates(allow,evidence,sources)
    const validRanked=[...new Set(
      ranked.rankedProductIds
        .map(x=>String(x).toUpperCase())
        .filter(x=>allow.includes(x))
    )]
    const rankedProductIds=[...validRanked,...allow.filter(x=>!validRanked.includes(x))]

    const value:MarketResearchResult={
      status:'ok',
      rankedProductIds,
      marketSentiment:String(ranked.marketSentiment||'MIXED').toUpperCase(),
      sourceCount:sources.length,
      sources,
      itemCount:items.length,
      model:ranked.model
    }
    cached={key,at:Date.now(),value}
    return value
  }catch(error){
    const value:MarketResearchResult={
      status:'fallback',
      rankedProductIds:allow,
      marketSentiment:'UNKNOWN',
      sourceCount:sources.length,
      sources,
      itemCount:items.length,
      reason:error instanceof Error?error.message:String(error)
    }
    cached={key,at:Date.now(),value}
    return value
  }
}
