/** The pinned Midnames Ledger 9 reader requires a paired Indexer API v4 endpoint. */
export function requireMidnamesV4IndexerPair(indexerUrl: string, indexerWsUrl: string): void {
  const http = new URL(indexerUrl);
  const ws = new URL(indexerWsUrl);
  if (
    http.pathname !== '/api/v4/graphql' ||
    ws.pathname !== '/api/v4/graphql/ws' ||
    http.host !== ws.host ||
    !(
      (http.protocol === 'http:' && ws.protocol === 'ws:') ||
      (http.protocol === 'https:' && ws.protocol === 'wss:')
    ) ||
    http.username ||
    http.password ||
    ws.username ||
    ws.password ||
    http.search ||
    ws.search ||
    http.hash ||
    ws.hash
  )
    throw new Error('Midnames requires a paired Indexer API v4 HTTP/WebSocket endpoint.');
}
