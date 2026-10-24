import http from "node:http";
import { deflateSync } from "node:zlib";
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([t, data])), out.length - 4);
  return out;
}
function png(w = 640, h = 480) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + x * 4 + 1;
      raw[i] = 40;
      raw[i + 1] = 160;
      raw[i + 2] = 110;
      raw[i + 3] = x < w / 2 ? 0 : 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const image = png();
export async function server() {
  const attempts = new Map();
  const requests = new Map();
  // Live per-host concurrency probe for the queue-serialization invariant.
  // GETs and HEADs are tracked separately: the download queue serializes
  // GETs per host, while the (deliberately global, 2-slot) verification
  // queue may probe several HEADs concurrently.
  const serial = { current: 0, max: 0, total: 0, headCurrent: 0, headMax: 0, log: [] };
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/serial.png") {
      serial.total++;
      const kind = req.method === "HEAD" ? "HEAD" : "GET";
      const entry = {
        kind,
        i: url.searchParams.get("i"),
        start: Date.now(),
      };
      serial.log.push(entry);
      if (req.method === "HEAD") {
        serial.headCurrent++;
        serial.headMax = Math.max(serial.headMax, serial.headCurrent);
      } else {
        serial.current++;
        serial.max = Math.max(serial.max, serial.current);
      }
      return setTimeout(() => {
        entry.end = Date.now();
        if (req.method === "HEAD") serial.headCurrent--;
        else serial.current--;
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": image.length,
        });
        res.end(req.method === "HEAD" ? undefined : image);
      }, 350);
    }
    if (req.headers.range)
      requests.set(
        "RANGE " + url.pathname,
        (requests.get("RANGE " + url.pathname) || 0) + 1,
      );
    requests.set(
      `${req.method} ${url.pathname}`,
      (requests.get(`${req.method} ${url.pathname}`) || 0) + 1,
    );
    if (url.pathname === "/opaque" || url.pathname === "/opaque-bytes") {
      res.writeHead(200, {
        "Content-Type":
          url.pathname === "/opaque" ? "image/png" : "application/octet-stream",
      });
      return res.end(image);
    }
    if (url.pathname === "/power-probe") {
      return setTimeout(() => {
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": image.length,
        });
        res.end(req.method === "HEAD" ? undefined : image);
      }, 900);
    }
    if (url.pathname === "/misleading.jpg") {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      return res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="pink"/></svg>',
      );
    }
    if (url.pathname === "/noisy") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(
        `<!doctype html><style>body{background:#eceee9;color:#22312b;font:16px system-ui;padding:40px}img{object-fit:contain}.content{display:flex;flex-wrap:wrap;gap:20px}.content img{width:240px;height:180px}header img{width:120px}</style><header><img class="brand-logo" alt="Brand logo" src="/noise-logo.png"></header><h1>A quieter image library</h1><p>Content, utility assets and extensionless sources.</p><div class="content"><img alt="Useful landscape" src="/noise-photo.png"><img alt="Small decoration" src="/noise-small.png"><img alt="Signed content" src="/opaque?sig=keep%2Bme&width=640"><img alt="Byte-verified content" src="/opaque-bytes"><img alt="Vector artwork" src="/asset.svg"><img alt="Mislabeled vector" src="/misleading.jpg"></div><img src="/noise-tracker.png"><button><svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>Menu</button><div style="height:3000px"></div>`,
      );
    }
    if (url.pathname === "/delayed-failure.png") {
      return setTimeout(() => {
        res.writeHead(503);
        res.end("delayed fixture failure");
      }, 650);
    }
    if (url.pathname === "/fail.png") {
      res.writeHead(403);
      return res.end("forbidden");
    }
    if (url.pathname === "/retry-probe") {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(req.method === "HEAD" ? undefined : image);
    }
    if (url.pathname === "/head-rejected") {
      if (req.method === "HEAD") {
        res.writeHead(405);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(image);
    }
    if (url.pathname === "/rate.png") {
      const n = (attempts.get(req.url) || 0) + 1;
      attempts.set(req.url, n);
      // Probe + extension fetch + owning-page fallback all see a rate limit first.
      if (n <= 3) {
        res.writeHead(429, { "Retry-After": "1" });
        return res.end("rate limited");
      }
    }
    if (/\.(png|jpg|webp)$/.test(url.pathname)) {
      const output = /placeholder|noise-tracker/.test(url.pathname)
        ? png(1, 1)
        : url.pathname === "/noise-small.png"
          ? png(24, 24)
          : image;
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": output.length,
      });
      return res.end(output);
    }
    if (url.pathname === "/asset.svg") {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      return res.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${url.searchParams.get("w") || 640}" height="480"><rect width="100%" height="100%" fill="#77ba94"/></svg>`,
      );
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    if (url.pathname === "/frame")
      return res.end('<h2>Frame</h2><img width="180" src="/frame.png">');
    if (url.pathname === "/perf")
      return res.end(
        `<style>img{width:50px;height:40px}</style><script>window.longs=[];window.longDetails=[];new PerformanceObserver(list=>{window.longs.push(...list.getEntries().map(e=>e.duration));window.longDetails.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration,name:e.name})))}).observe({type:'longtask',buffered:true});</script><div id="images"></div><script>images.innerHTML=Array.from({length:5000},(_,i)=>'<img src="/perf.png?id='+i+'" loading="lazy">').join('');</script>`,
      );
    if (url.pathname === "/empty") return res.end("<h1>No images</h1>");
    res.end(
      `<!doctype html><html><head><title>Zephyer fixture</title><meta property="og:image" content="/meta.png"><style>body{font-family:system-ui;margin:32px;background:#f4f3eb;color:#183529}img{object-fit:cover;max-width:100%}.samples{display:grid;grid-template-columns:repeat(3,220px);gap:24px}.background{width:220px;height:160px;background-image:url('/background.png')}.pseudo{width:220px;height:160px}.pseudo::before{content:'';display:block;width:100%;height:100%;background-image:url('/pseudo.png')}.nested{height:200px;overflow:auto}button{padding:12px}</style></head><body><h1>Image discovery laboratory</h1><p>Static, responsive, shadow, frame, lazy & dynamic content.</p><div class="samples"><img id="static" alt="Forest original" width="220" height="160" src="/static.png"><img id="responsive" alt="Responsive forest" width="220" height="160" src="/thumb.png" srcset="/small.png 320w, /large.png 1280w" sizes="220px"><a href="/original.png"><img id="linked" alt="Linked original" width="220" src="/linked.png"></a><div class="background"></div><div class="pseudo"></div><img id="lazy" width="220" height="160" data-src="/lazy.png" alt="Lazy candidate"><svg width="220" height="160" viewBox="0 0 220 160"><rect width="220" height="160" fill="#c87954"/></svg><canvas id="canvas" width="220" height="160"></canvas><div id="shadow"></div><img id="fallback" width="220" alt="Fallback image" src="/fallback-thumb.png" srcset="/fail.png 2400w"><img id="rate" width="220" src="/rate.png"><img id="recycled" width="220" src="/before.png"><iframe title="Frame" src="/frame"></iframe><div class="nested"><div style="height:600px">Nested scroll</div><img src="/nested.png" width="180" loading="lazy"></div></div><button id="add">Add dynamic image</button><div style="height:1200px"></div><img id="bottom" width="220" height="160" data-lazy-src="/bottom.png"><div id="feed"></div><script>canvas.getContext('2d').fillRect(0,0,220,160);shadow.attachShadow({mode:'open'}).innerHTML='<img src="/shadow.png" width="220">';add.onclick=()=>{const im=new Image();im.src='/dynamic.png';im.width=220;document.body.prepend(im);};let loaded=false;addEventListener('scroll',()=>{if(!loaded&&scrollY>600){loaded=true;bottom.src=bottom.dataset.lazySrc;const im=new Image();im.src='/scroll-added.png';im.width=220;feed.append(im);}});fetch('/blob.png').then(r=>r.blob()).then(b=>{const im=new Image();im.src=URL.createObjectURL(b);im.id='blob';im.width=220;document.querySelector('.samples').append(im);});</script></body></html>`,
    );
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return {
    server: s,
    requests,
    serial,
    origin: `http://127.0.0.1:${s.address().port}`,
  };
}
