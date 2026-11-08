/* 本棚(Web版)のサービスワーカー。一度開けばネットが無くても開けるように、ファイルを全部しまっておく。 */
const VERSION = "ceef19920c2f"
const ASSETS = ["./","./assets/index-2KZaogRG.css","./assets/index-ghCNtX9z.js","./help.html","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./manifest.webmanifest"]
const CACHE = 'hondana-app-' + VERSION
const SHARE_DB = 'hondana-share'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('hondana-app-') && k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
  if (event.data === 'version' && event.source) event.source.postMessage({ type: 'version', version: VERSION })
})

function openShareDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(SHARE_DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('files', { autoIncrement: true })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

/** Android の「共有」から送られた画像・ZIP を預かって、本棚の取り込み画面を開く */
async function receiveShare(request) {
  try {
    const form = await request.formData()
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && 'size' in f)
    const db = await openShareDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      const st = tx.objectStore('files')
      for (const f of files) st.add({ name: f.name || 'image', type: f.type || '', blob: f, at: Date.now() })
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (e) {
    // 受け取れなかった時も本棚は開く
  }
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303)
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (!url.href.startsWith(self.registration.scope)) return
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req))
    return
  }
  if (req.method !== 'GET') return
  // version.json はいつもネットから(新しい版があるか見るため)
  if (url.pathname.endsWith('/version.json')) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      // 画面(HTML):使い方のページなどはそのページ、それ以外は本棚(index.html)を返す
      if (req.mode === 'navigate') {
        const page = /\.html$/.test(url.pathname) && !/\/index\.html$/.test(url.pathname)
        if (page) {
          const exact = await cache.match(req, { ignoreSearch: true })
          if (exact) return exact
          try {
            return await fetch(req)
          } catch (e) {
            return new Response('オフラインです', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
          }
        }
        const hit = await cache.match('./', { ignoreSearch: true })
        if (hit) return hit
      }
      const hit = await cache.match(req, { ignoreSearch: true })
      if (hit) return hit
      try {
        return await fetch(req)
      } catch (e) {
        return new Response('オフラインです', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      }
    })(),
  )
})
