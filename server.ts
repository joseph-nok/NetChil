/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import http from "http";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { createServer as createViteServer } from "vite";
import Docker from "dockerode";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import { RoomState, ChatMessage, User } from "./src/types.js";

// Register stealth plugin to strip headless fingerprints
puppeteerExtra.use(StealthPlugin());

// Active Puppeteer browser sessions mapped by roomId
const activePuppeteerBrowsers: Record<string, { browser: any; page: any }> = {};

// Initialize Express, HTTP Server, and Socket.io
const app = express();
app.set("trust proxy", true);
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = 3000;

// Initialize Dockerode safely
let docker: Docker | null = null;
try {
  docker = new Docker({ socketPath: "/var/run/docker.sock" });
  console.log("Docker client initialized successfully.");
} catch (err) {
  console.warn("Could not initialize Docker client. Using simulated fallback mode.", err);
}

// In-memory state for rooms
const rooms: Record<string, RoomState> = {};
const roomChats: Record<string, ChatMessage[]> = {};
const dockerContainers: Record<string, string> = {}; // room -> container ID
const activeSockets: Record<string, { roomId: string; userId: string }> = {};

// Port pool for Neko containers (range 3100 - 3200)
let nextNekoPort = 3100;
const NEKO_IMAGE = "m1k1o/neko:chromium";

// Pre-create a default lobby/sandbox room so it always exists
const defaultRoomId = "lobby";
rooms[defaultRoomId] = {
  id: defaultRoomId,
  name: "WatchNexus Public Lobby",
  type: "simulated",
  currentUrl: "https://net11.cc/home?utm_source=home_page",
  isPlaying: false,
  currentTime: 0,
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
  users: {},
};
roomChats[defaultRoomId] = [];

/**
 * Safely stops and deletes a Docker container for a room
 */
async function cleanupDockerContainer(roomId: string) {
  if (!docker || !dockerContainers[roomId]) return;

  const containerId = dockerContainers[roomId];
  try {
    const container = docker.getContainer(containerId);
    console.log(`Stopping Docker container for room ${roomId}...`);
    await container.stop().catch(() => {});
    console.log(`Removing Docker container for room ${roomId}...`);
    await container.remove().catch(() => {});
    delete dockerContainers[roomId];
    console.log(`Successfully cleaned up room ${roomId} Docker resources.`);
  } catch (error) {
    console.error(`Error cleaning up Docker container for room ${roomId}:`, error);
  }
}

/**
 * Creates or retrieves a watch party room
 */
async function getOrCreateRoom(roomId: string, name: string = "Watch Party"): Promise<RoomState> {
  if (rooms[roomId]) {
    rooms[roomId].lastActiveAt = Date.now();
    return rooms[roomId];
  }

  // Attempt to spawn Neko Docker container if docker is available and not "lobby"
  if (docker && roomId !== "lobby") {
    try {
      console.log(`Attempting to spawn Neko container for room ${roomId}...`);
      
      // Pull image first if needed
      await new Promise<void>((resolve, reject) => {
        docker!.pull(NEKO_IMAGE, {}, (err, stream) => {
          if (err) return reject(err);
          docker!.modem.followProgress(stream, onFinished, onProgress);
          function onFinished(err: any, output: any) {
            if (err) return reject(err);
            resolve();
          }
          function onProgress(event: any) {}
        });
      });

      const assignedPort = nextNekoPort++;
      const containerName = `watchnexus-${roomId}-${Date.now()}`;

      const container = await docker.createContainer({
        Image: NEKO_IMAGE,
        name: containerName,
        Env: [
          "NEKO_SCREEN=1280x720@30",
          "NEKO_PASSWORD=neko",
          "NEKO_PASSWORD_ADMIN=adminneko",
          "NEKO_EPR=50000-50100",
          "NEKO_NAT1TO1=127.0.0.1", // standard localhost setup
        ],
        HostConfig: {
          PortBindings: {
            "8080/tcp": [{ HostPort: String(assignedPort) }],
          },
          ShmSize: 2 * 1024 * 1024 * 1024, // 2GB shm size required for Chromium
        },
      });

      await container.start();
      dockerContainers[roomId] = container.id;

      rooms[roomId] = {
        id: roomId,
        name,
        type: "docker",
        nekoPort: assignedPort,
        nekoHost: "127.0.0.1",
        currentUrl: "https://net11.cc/home?utm_source=home_page",
        isPlaying: false,
        currentTime: 0,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        users: {},
      };
      roomChats[roomId] = [];
      console.log(`Neko container started on port ${assignedPort} for room ${roomId}.`);
      return rooms[roomId];
    } catch (error) {
      console.error(`Failed to create Neko container for room ${roomId}. Falling back to Simulated.`, error);
    }
  }

  // Fallback / Simulated Mode Room Creation
  rooms[roomId] = {
    id: roomId,
    name: name || `Room ${roomId}`,
    type: "simulated",
    currentUrl: "https://net11.cc/home?utm_source=home_page",
    isPlaying: false,
    currentTime: 0,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    users: {},
  };
  roomChats[roomId] = [];
  console.log(`Simulated room ${roomId} created.`);
  return rooms[roomId];
}

/**
 * Loop that captures screenshots of the Puppeteer page and emits them to clients in the room via WebSocket
 */
async function captureLoop(roomId: string, page: any) {
  while (activePuppeteerBrowsers[roomId]?.page === page) {
    try {
      const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
      const base64 = buffer.toString("base64");
      io.to(roomId).emit("browser-frame", `data:image/jpeg;base64,${base64}`);
    } catch (e) {
      break;
    }
    // Screenshot capture interval (~400ms keeps it smooth yet lightweight)
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/**
 * Scans standard paths to find local Chromium binary
 */
function findChromiumPath(): string | undefined {
  const paths = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/chrome",
    "/usr/lib/chromium/chromium",
    "/usr/lib/chromium-browser/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      console.log(`[Puppeteer] Found Chromium at: ${p}`);
      return p;
    }
  }
  return undefined;
}

async function emulateHumanBehavior(page: any, room: any) {
  try {
    console.log(`[Puppeteer] Emulating human behavior: scrolling, mouse movement, and waiting random delay...`);
    
    // 1. Wait a random delay (1-3 seconds)
    const delayMs = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // 2. Scroll down slightly
    await page.evaluate(() => {
      window.scrollBy({
        top: Math.floor(Math.random() * 200) + 100,
        behavior: 'smooth'
      });
    });

    // 3. Move the mouse cursor across random coordinates
    const width = room?.clientResolution?.width || 1280;
    const height = room?.clientResolution?.height || 720;
    
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(Math.random() * (width - 150)) + 75;
      const y = Math.floor(Math.random() * (height - 150)) + 75;
      await page.mouse.move(x, y, { steps: 10 });
      await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 300) + 150));
    }
  } catch (err) {
    console.warn("[Puppeteer] Human behavior emulation warning:", err);
  }
}

/**
 * Spawns or gets the existing headless browser for a given room, sets headers/cookies and navigates
 */
async function getOrCreateBrowserForRoom(roomId: string, targetUrl: string) {
  if (activePuppeteerBrowsers[roomId]) {
    const session = activePuppeteerBrowsers[roomId];
    try {
      const page = session.page;
      const room = rooms[roomId];
      if (room && room.clientUserAgent) {
        await page.setUserAgent(room.clientUserAgent);
      }
      
      if (room && room.clientCookies) {
        const rawCookies = room.clientCookies.split(";").map(c => c.trim()).filter(Boolean);
        const cookiesToSet = rawCookies.map(cookieStr => {
          const parts = cookieStr.split("=");
          const name = parts[0];
          const value = parts.slice(1).join("=");
          let domain = "net11.cc";
          try {
            domain = new URL(targetUrl).hostname;
          } catch (_) {}
          return {
            name,
            value,
            domain,
          };
        }).filter(c => c.name && c.value);
        try {
          await page.setCookie(...cookiesToSet);
        } catch (ce) {
          console.error("Error setting cookies on existing page:", ce);
        }
      }

      console.log(`[Puppeteer] Navigating page for room ${roomId} to ${targetUrl}`);
      
      // Determine client IP for extra headers
      const clientIp = room && Object.values(room.users).length > 0 
        ? "127.0.0.1"
        : "127.0.0.1";

      await page.setExtraHTTPHeaders({
        "X-Forwarded-Proto": "https",
        "X-Forwarded-For": clientIp
      });

      const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await emulateHumanBehavior(page, room);

      if (response && response.status() === 403) {
        console.error(`[Puppeteer] Page navigation returned 403 status for ${targetUrl}`);
        io.to(roomId).emit("captcha-required", { url: targetUrl, status: 403 });
        io.to(roomId).emit("room-error", {
          message: "Streaming host blocked our connection. Please try a different mirror link or enable your proxy configuration."
        });
      }

      return session;
    } catch (e) {
      console.warn(`[Puppeteer] Existing browser/page failed for room ${roomId}, recreating...`, e);
      try {
        await session.browser.close();
      } catch (closeErr) {}
      delete activePuppeteerBrowsers[roomId];
    }
  }

  const room = rooms[roomId];
  const executablePath = findChromiumPath();
  
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--ignore-certificate-errors",
    "--disable-gpu",
    "--disable-dev-shm-usage"
  ];

  const proxyUrl = room?.proxyServer || process.env.PROXY_SERVER;
  if (proxyUrl) {
    args.push(`--proxy-server=${proxyUrl}`);
    console.log(`[Puppeteer] Using proxy server option: ${proxyUrl}`);
  }

  console.log(`[Puppeteer] Launching browser for room ${roomId} with args:`, args);

  try {
    const browser = await puppeteerExtra.launch({
      executablePath,
      headless: true,
      args,
      defaultViewport: {
        width: room?.clientResolution?.width || 1280,
        height: room?.clientResolution?.height || 720
      }
    });

    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    const userAgent = room?.clientUserAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    await page.setUserAgent(userAgent);

    // Override navigator variables before navigating to emulate a realistic user laptop perfectly
    await page.evaluateOnNewDocument(() => {
      // 1. Explicitly delete the 'navigator.webdriver' property and return undefined
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true,
        });
      } catch (e) {}
      try {
        const proto = Object.getPrototypeOf(navigator);
        delete proto.webdriver;
      } catch (e) {}

      // 2. Set navigator.languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });

      // 3. Set navigator.plugins (fake plugins array)
      const fakePlugins = [1, 2, 3, 4, 5];
      Object.defineProperty(navigator, 'plugins', {
        get: () => fakePlugins,
        configurable: true,
      });

      // 4. Emulate hardware features: hardwareConcurrency (8 cores), deviceMemory (8GB)
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
      });
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
        configurable: true,
      });

      // 5. Fake screen architecture: standard 1920x1080 monitor and devicePixelRatio = 1
      Object.defineProperty(window, 'devicePixelRatio', {
        get: () => 1,
        configurable: true,
      });
      Object.defineProperty(window.screen, 'width', {
        get: () => 1920,
        configurable: true,
      });
      Object.defineProperty(window.screen, 'height', {
        get: () => 1080,
        configurable: true,
      });
      Object.defineProperty(window.screen, 'availWidth', {
        get: () => 1920,
        configurable: true,
      });
      Object.defineProperty(window.screen, 'availHeight', {
        get: () => 1040,
        configurable: true,
      });
      Object.defineProperty(window, 'innerWidth', {
        get: () => 1920,
        configurable: true,
      });
      Object.defineProperty(window, 'innerHeight', {
        get: () => 1080,
        configurable: true,
      });

      // 6. Ensure WebGLRenderingContext.prototype.getParameter does not return default headless Linux values
      const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) {
          return 'Google Inc. (NVIDIA)';
        }
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) {
          return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        }
        // VENDOR
        if (parameter === 7936) {
          return 'WebKit';
        }
        // RENDERER
        if (parameter === 7937) {
          return 'WebKit WebGL';
        }
        return originalGetParameter.apply(this, arguments);
      };
    });

    const proxyUser = room?.proxyUsername || process.env.PROXY_USERNAME;
    const proxyPass = room?.proxyPassword || process.env.PROXY_PASSWORD;
    if (proxyUrl && proxyUser && proxyPass) {
      console.log(`[Puppeteer] Authenticating proxy with user: ${proxyUser}`);
      await page.authenticate({ username: proxyUser, password: proxyPass });
    }

    if (room && room.clientCookies) {
      const rawCookies = room.clientCookies.split(";").map(c => c.trim()).filter(Boolean);
      const cookiesToSet = rawCookies.map(cookieStr => {
        const parts = cookieStr.split("=");
        const name = parts[0];
        const value = parts.slice(1).join("=");
        let domain = "net11.cc";
        try {
          domain = new URL(targetUrl).hostname;
        } catch (_) {}
        return {
          name,
          value,
          domain,
        };
      }).filter(c => c.name && c.value);
      try {
        await page.setCookie(...cookiesToSet);
      } catch (ce) {
        console.error("Error setting cookies on page:", ce);
      }
    }

    await page.setExtraHTTPHeaders({
      "X-Forwarded-Proto": "https",
      "X-Forwarded-For": "127.0.0.1"
    });

    console.log(`[Puppeteer] Created page and navigating to ${targetUrl}`);
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await emulateHumanBehavior(page, room);
    
    if (response && response.status() === 403) {
      console.error(`[Puppeteer] Page navigation returned 403 status for ${targetUrl}`);
      io.to(roomId).emit("captcha-required", { url: targetUrl, status: 403 });
      io.to(roomId).emit("room-error", {
        message: "Streaming host blocked our connection. Please try a different mirror link or enable your proxy configuration."
      });
    }

    const sessionObj = { browser, page };
    activePuppeteerBrowsers[roomId] = sessionObj;

    captureLoop(roomId, page);

    return sessionObj;
  } catch (err: any) {
    console.error(`[Puppeteer] Robust error caught launching browser or loading page for room ${roomId}:`, err);
    
    // Emit the clean user-requested payload as well as a user-friendly error message via WebSockets
    io.to(roomId).emit("browser-error", { 
      success: false, 
      error: "Browser allocation failed", 
      message: "Browser allocation failed: " + (err.message || String(err))
    });
    
    // Ensure process.exit() is NEVER called. Just return null to allow the server to continue running.
    return null;
  }
}

// Health-check endpoint for Cloud Run ingress/load-balancer probe routing
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// REST endpoints for Room management
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Collaborative Virtual Browser Proxy
app.all("/api/browser/proxy", async (req, res) => {
  let targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send("No URL provided");
  }

  let trimmed = targetUrl.trim();
  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const isUrlLike = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})/i.test(trimmed) || trimmed.includes("localhost") || trimmed.includes("netmirror.gg") || trimmed.includes("net11.cc");

  if (!hasProtocol && isUrlLike) {
    trimmed = "https://" + trimmed;
  } else if (!hasProtocol) {
    // If it's a search term, proxy DuckDuckGo's lightweight html-only engine
    trimmed = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
  }

  targetUrl = trimmed;

  // Auto-redirect or rewrite dead domains to the new active mirror
  const deadDomains = ["netmirror.gg", "netmirror.org", "netmirror.cc", "netmirror.co", "netmirror.app"];
  for (const domain of deadDomains) {
    if (targetUrl.includes(domain)) {
      targetUrl = targetUrl.replace(new RegExp(domain, "gi"), "net11.cc");
    }
  }

  // Retrieve Room ID to support user context (cookies, user-agent) syncing
  const roomId = req.query.roomId as string;
  const room = roomId ? rooms[roomId] : null;

  try {
    const userAgent = room?.clientUserAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36";
    
    // Explicitly forward trust proxies and client IP
    const clientIp = (req.ip || (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1").split(",")[0].trim();
    
    const headers: any = {
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-For": clientIp
    };

    // Sync user cookies and merge with proxy-specific ones
    let mergedCookie = "";
    if (room && room.clientCookies) {
      mergedCookie = room.clientCookies;
    }
    if (req.headers.cookie) {
      mergedCookie = mergedCookie ? `${mergedCookie}; ${req.headers.cookie}` : req.headers.cookie;
    }
    if (mergedCookie) {
      headers["Cookie"] = mergedCookie;
    }

    const fetchOptions: any = {
      method: req.method,
      headers
    };

    // Apply Proxy Server option dynamically from Room setup or Environment variable
    const proxyUrl = room?.proxyServer || process.env.PROXY_SERVER;
    if (proxyUrl) {
      try {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
        console.log(`[Proxy] Routing fetch for ${targetUrl} through proxy ${proxyUrl}`);
      } catch (proxyErr) {
        console.error("[Proxy] Failed to load HttpsProxyAgent:", proxyErr);
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      const contentType = req.headers["content-type"];
      if (contentType) {
        headers["Content-Type"] = contentType;
      }
      
      if (req.body && Object.keys(req.body).length > 0) {
        if (contentType?.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(req.body)) {
            params.append(key, String(value));
          }
          fetchOptions.body = params.toString();
        } else if (contentType?.includes("application/json")) {
          fetchOptions.body = JSON.stringify(req.body);
        }
      }
    }

    const response = await fetch(targetUrl, fetchOptions);

    if (!response.ok) {
      // If we are trying to access an old netmirror domain and it fails, let's gracefully fallback/redirect to the new mirror.
      // Do not redirect if we are already trying to access net11.cc to prevent infinite redirect loops.
      if (targetUrl.includes("netmirror") && !targetUrl.includes("net11.cc")) {
        console.log(`Fallback redirect: Netmirror domain ${targetUrl} failed with status ${response.status}. Redirecting to https://net11.cc/home?utm_source=home_page`);
        return res.redirect(`/api/browser/proxy?url=${encodeURIComponent("https://net11.cc/home?utm_source=home_page")}`);
      }
    }

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      res.setHeader("Set-Cookie", setCookie);
    }

    const contentType = response.headers.get("content-type") || "";
    
    // Pipe assets directly if they are requested
    if (!contentType.includes("text/html")) {
      const arrayBuffer = await response.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      return res.send(Buffer.from(arrayBuffer));
    }

    let html = await response.text();

    // Use response.url (which resolves all redirects) as the final URL
    const finalUrl = response.url || targetUrl;
    const parsedUrl = new URL(finalUrl);
    const origin = parsedUrl.origin;

    const host = req.headers.host || "localhost:3000";
    const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const roomIdParam = roomId ? `&roomId=${encodeURIComponent(roomId)}` : "";
    const proxyBase = `${protocol}://${host}/api/browser/proxy`;

    const resolveUrl = (base: string, rel: string) => {
      try {
        return new URL(rel, base).href;
      } catch (e) {
        return rel;
      }
    };

    // Rewrite all <a> hrefs to go through the proxy with absolute host URLs
    html = html.replace(/(<a\s+[^>]*href=["'])([^"']*)(["'])/gi, (match, before, url, after) => {
      if (!url || url.startsWith("#") || url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("tel:")) {
        return match;
      }
      const absoluteUrl = resolveUrl(finalUrl, url);
      return `${before}${proxyBase}?url=${encodeURIComponent(absoluteUrl)}${roomIdParam}${after}`;
    });

    // Rewrite all <form> actions to go through the proxy with absolute host URLs
    html = html.replace(/(<form\s+[^>]*action=["'])([^"']*)(["'])/gi, (match, before, url, after) => {
      const absoluteUrl = resolveUrl(finalUrl, url || "");
      return `${before}${proxyBase}?url=${encodeURIComponent(absoluteUrl)}${roomIdParam}${after}`;
    });

    // Enforce target="_self" on all existing target attributes
    html = html.replace(/target=(["'])(.*?)\1/gi, 'target="_self"');

    // Client-side interceptor to communicate link clicks & form submissions back to WatchNexus
    const interceptorScript = `
      <script>
        (function() {
          function getUnproxiedUrl(urlStr) {
            try {
              const url = new URL(urlStr, window.location.href);
              if (url.pathname === '/api/browser/proxy') {
                const realUrl = url.searchParams.get('url');
                if (realUrl) {
                  return realUrl;
                }
              }
              return url.href;
            } catch (e) {
              return urlStr;
            }
          }

          // Override window.open
          const originalOpen = window.open;
          window.open = function(url, target, features) {
            if (url && !url.startsWith('#') && !url.startsWith('javascript:')) {
              const absoluteUrl = getUnproxiedUrl(new URL(url, window.location.href).href);
              window.parent.postMessage({ type: 'PROXY_NAVIGATE', url: absoluteUrl }, '*');
              return null;
            }
            if (originalOpen) {
              return originalOpen.apply(this, arguments);
            }
            return null;
          };

          // Override Location methods
          try {
            const originalAssign = Location.prototype.assign;
            Location.prototype.assign = function(url) {
              const absoluteUrl = getUnproxiedUrl(new URL(url, window.location.href).href);
              window.parent.postMessage({ type: 'PROXY_NAVIGATE', url: absoluteUrl }, '*');
            };
          } catch(e) {}

          try {
            const originalReplace = Location.prototype.replace;
            Location.prototype.replace = function(url) {
              const absoluteUrl = getUnproxiedUrl(new URL(url, window.location.href).href);
              window.parent.postMessage({ type: 'PROXY_NAVIGATE', url: absoluteUrl }, '*');
            };
          } catch(e) {}

          // Intercept clicks on links
          document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link) {
              const href = link.getAttribute('href');
              if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
              
              e.preventDefault();
              const absoluteUrl = getUnproxiedUrl(link.href);
              window.parent.postMessage({ type: 'PROXY_NAVIGATE', url: absoluteUrl }, '*');
            }
          }, true);

          // Intercept search/navigation form submissions
          document.addEventListener('submit', function(e) {
            const form = e.target;
            const action = form.action || window.location.href;
            const method = (form.method || 'GET').toUpperCase();
            
            if (method === 'GET') {
              e.preventDefault();
              const formData = new FormData(form);
              const params = new URLSearchParams();
              for (const [key, value] of formData.entries()) {
                params.append(key, value);
              }
              const separator = action.includes('?') ? '&' : '?';
              const absoluteUrl = getUnproxiedUrl(action + separator + params.toString());
              window.parent.postMessage({ type: 'PROXY_NAVIGATE', url: absoluteUrl }, '*');
            }
          }, true);
        })();
      </script>
    `;

    // Inject base href tag with default target="_self" so the browser resolves all relative assets correctly but keeps navigation inline
    const baseTag = `<base href="${origin}/" target="_self">`;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>\n${baseTag}\n${interceptorScript}`);
    } else if (html.includes("<HEAD>")) {
      html = html.replace("<HEAD>", `<HEAD>\n${baseTag}\n${interceptorScript}`);
    } else {
      html = baseTag + "\n" + interceptorScript + "\n" + html;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval'; frame-ancestors *");
    res.send(html);
  } catch (err: any) {
    console.error(`Proxy load error for ${targetUrl}:`, err);
    
    // Broadcast to matching rooms
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.currentUrl && (targetUrl.includes(room.currentUrl) || room.currentUrl.includes(targetUrl))) {
        io.to(roomId).emit("browser-error", { 
          message: `Failed to load domain: ${targetUrl}. ${err.message}`,
          url: targetUrl
        });
      }
    }

    if (targetUrl.includes("netmirror") && !targetUrl.includes("net11.cc")) {
      console.log(`Fallback redirect on catch: Netmirror domain ${targetUrl} failed. Redirecting to https://net11.cc/home?utm_source=home_page`);
      return res.redirect(`/api/browser/proxy?url=${encodeURIComponent("https://net11.cc/home?utm_source=home_page")}`);
    }

    res.status(500).send(`Proxy navigation failed to load page: ${err.message}`);
  }
});

// List active rooms
app.get("/api/rooms", (req, res) => {
  res.json(Object.values(rooms));
});

// Create a room
app.post("/api/rooms", async (req, res) => {
  const { id, name } = req.body;
  if (!id) {
    return res.status(400).json({ error: "Room ID is required" });
  }
  const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!cleanId) {
    return res.status(400).json({ error: "Invalid Room ID" });
  }

  try {
    const room = await getOrCreateRoom(cleanId, name);
    res.json(room);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single room details
app.get("/api/rooms/:id", (req, res) => {
  const room = rooms[req.params.id];
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }
  res.json(room);
});

// Clean up unused rooms periodically (every 2 minutes)
setInterval(async () => {
  const now = Date.now();
  for (const roomId of Object.keys(rooms)) {
    if (roomId === defaultRoomId) continue; // Keep lobby always alive
    const room = rooms[roomId];
    const userCount = Object.keys(room.users).length;
    
    // Cleanup if empty for more than 10 minutes
    if (userCount === 0 && now - room.lastActiveAt > 10 * 60 * 1000) {
      console.log(`Inactivity cleanup: Removing room ${roomId}`);
      if (room.type === "docker") {
        await cleanupDockerContainer(roomId);
      }
      delete rooms[roomId];
      delete roomChats[roomId];
    }
  }
}, 2 * 60 * 1000);

// Colors for user avatars
const AVATAR_COLORS = [
  "text-red-500 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800/50",
  "text-green-500 bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800/50",
  "text-blue-500 bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800/50",
  "text-yellow-500 bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800/50",
  "text-purple-500 bg-purple-50 border-purple-200 dark:bg-purple-950/20 dark:border-purple-800/50",
  "text-pink-500 bg-pink-50 border-pink-200 dark:bg-pink-950/20 dark:border-pink-800/50",
  "text-indigo-500 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-800/50",
  "text-cyan-500 bg-cyan-50 border-cyan-200 dark:bg-cyan-950/20 dark:border-cyan-800/50",
];

// Socket.io Web Watch Party Controller
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Join a specific watch party room
  socket.on("join-room", async ({ roomId, userName, photoURL, clientUserAgent, clientResolution, clientCookies, proxyServer, proxyUsername, proxyPassword }) => {
    const cleanRoomId = roomId.trim().toLowerCase();
    const room = await getOrCreateRoom(cleanRoomId);

    // Sync client's active user agent, cookies, and resolution context details
    if (clientUserAgent) {
      room.clientUserAgent = clientUserAgent;
    }
    if (clientCookies) {
      room.clientCookies = clientCookies;
    }
    if (clientResolution) {
      room.clientResolution = clientResolution;
    }
    if (proxyServer) {
      room.proxyServer = proxyServer;
    }
    if (proxyUsername) {
      room.proxyUsername = proxyUsername;
    }
    if (proxyPassword) {
      room.proxyPassword = proxyPassword;
    }

    const userId = socket.id;
    const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const newUser: User = {
      id: userId,
      name: userName || `User ${userId.slice(0, 4)}`,
      cameraActive: false,
      micActive: false,
      color: randomColor,
      cursor: { x: 0.5, y: 0.5 },
      photoURL: photoURL || undefined,
    };

    room.users[userId] = newUser;
    room.lastActiveAt = Date.now();
    activeSockets[socket.id] = { roomId: cleanRoomId, userId };

    socket.join(cleanRoomId);

    // Send current state and chat history to the newly joined client
    socket.emit("room-init", {
      room,
      chatHistory: roomChats[cleanRoomId] || [],
      myUserId: userId,
    });

    // Notify other peers in the room
    socket.to(cleanRoomId).emit("user-joined", newUser);
    console.log(`${newUser.name} joined room ${cleanRoomId}`);

    // Spawn / get backend Puppeteer session for co-browsing and warm up the browser
    if (room.type === "simulated") {
      getOrCreateBrowserForRoom(cleanRoomId, room.currentUrl).catch((err) => {
        console.error("Failed to start/warmup Puppeteer browser on join:", err);
      });
    }
  });

  // Handle live cursor tracking
  socket.on("cursor-move", ({ x, y }) => {
    const session = activeSockets[socket.id];
    if (!session) return;

    const { roomId, userId } = session;
    const room = rooms[roomId];
    if (room && room.users[userId]) {
      room.users[userId].cursor = { x, y };
      socket.to(roomId).emit("cursor-update", { userId, x, y });
    }
  });

  // Handle chat messaging
  socket.on("send-message", (text) => {
    const session = activeSockets[socket.id];
    if (!session) return;

    const { roomId, userId } = session;
    const room = rooms[roomId];
    if (room && room.users[userId]) {
      const user = room.users[userId];
      const message: ChatMessage = {
        id: Math.random().toString(36).substring(2, 9),
        userId,
        userName: user.name,
        userColor: user.color,
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      if (!roomChats[roomId]) roomChats[roomId] = [];
      roomChats[roomId].push(message);
      
      // Limit chat log to last 100 messages
      if (roomChats[roomId].length > 100) {
        roomChats[roomId].shift();
      }

      io.to(roomId).emit("receive-message", message);
    }
  });

  // Handle Simulated Browser Control Events (sync video source, play/pause, scrub)
  socket.on("browser-update-url", (url) => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { roomId } = session;
    const room = rooms[roomId];
    if (room) {
      room.currentUrl = url;
      io.to(roomId).emit("browser-sync-url", url);
    }
  });

  // Step 2 WebSocket Handler: navigate-browser
  socket.on("navigate-browser", async (url) => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { roomId } = session;
    const room = rooms[roomId];
    if (room) {
      let targetUrl = url.trim();
      
      // Basic scheme validation
      const isUrlLike = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})/i.test(targetUrl) || targetUrl.includes("localhost") || targetUrl.includes("netmirror.gg") || targetUrl.includes("net11.cc");
      if (!/^https?:\/\//i.test(targetUrl) && isUrlLike) {
        targetUrl = "https://" + targetUrl;
      } else if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(targetUrl)}`;
      }

      // Check for known old/dead domains and auto-rewrite them to net11.cc
      const deadDomains = ["netmirror.gg", "netmirror.org", "netmirror.cc", "netmirror.co", "netmirror.app"];
      for (const domain of deadDomains) {
        if (targetUrl.includes(domain)) {
          targetUrl = targetUrl.replace(new RegExp(domain, "gi"), "net11.cc");
        }
      }

      // Update room state and broadcast to everyone in the room
      room.currentUrl = targetUrl;
      io.to(roomId).emit("browser-sync-url", targetUrl);

      // Trigger actual Puppeteer navigation on the backend
      if (room.type === "simulated") {
        getOrCreateBrowserForRoom(roomId, targetUrl).catch((err: any) => {
          console.error(`[Puppeteer] Failed to navigate headless browser for room ${roomId}:`, err);
          socket.emit("browser-error", {
            message: `Failed to load domain: ${targetUrl} was unreachable or Puppeteer encountered an error.`,
            url: targetUrl
          });
        });
      }
    }
  });

  // Handle Simulated Browser Reload
  socket.on("browser-reload", async () => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { roomId } = session;
    const room = rooms[roomId];
    if (room && room.type === "simulated") {
      const browserSession = activePuppeteerBrowsers[roomId];
      if (browserSession?.page) {
        try {
          console.log(`[Puppeteer] Reloading page in room ${roomId}`);
          await browserSession.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
        } catch (err) {
          console.error("[Puppeteer] Reload handler error, attempting getOrCreateBrowser:", err);
          getOrCreateBrowserForRoom(roomId, room.currentUrl).catch((e) => {
            console.error("[Puppeteer] Recreate failed on reload:", e);
          });
        }
      } else {
        getOrCreateBrowserForRoom(roomId, room.currentUrl).catch((e) => {
          console.error("[Puppeteer] Spawn failed on reload:", e);
        });
      }
    }
  });

  // Handle Simulated Browser Click
  socket.on("browser-click", async ({ x, y }) => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { roomId } = session;
    const browserSession = activePuppeteerBrowsers[roomId];
    if (browserSession?.page) {
      try {
        const viewport = await browserSession.page.viewport();
        const width = viewport ? viewport.width : 1280;
        const height = viewport ? viewport.height : 720;
        const clickX = Math.round(x * width);
        const clickY = Math.round(y * height);
        
        console.log(`[Puppeteer] Clicking at (${clickX}, ${clickY}) in room ${roomId}`);
        await browserSession.page.mouse.click(clickX, clickY);

        // Capture an immediate screenshot to show progress quickly
        const buffer = await browserSession.page.screenshot({ type: "jpeg", quality: 60 });
        const base64 = buffer.toString("base64");
        io.to(roomId).emit("browser-frame", `data:image/jpeg;base64,${base64}`);
      } catch (err) {
        console.error("[Puppeteer] Click handler error:", err);
      }
    }
  });

  // Handle Simulated Browser Key typing
  socket.on("browser-key", async ({ key }) => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { roomId } = session;
    const browserSession = activePuppeteerBrowsers[roomId];
    if (browserSession?.page) {
      try {
        console.log(`[Puppeteer] Typing key ${key} in room ${roomId}`);
        if (key === "Backspace") {
          await browserSession.page.keyboard.press("Backspace");
        } else if (key === "Enter") {
          await browserSession.page.keyboard.press("Enter");
        } else if (key.length === 1) {
          await browserSession.page.keyboard.type(key);
        }

        // Capture an immediate screenshot to show typed content quickly
        const buffer = await browserSession.page.screenshot({ type: "jpeg", quality: 60 });
        const base64 = buffer.toString("base64");
        io.to(roomId).emit("browser-frame", `data:image/jpeg;base64,${base64}`);
      } catch (err) {
        console.error("[Puppeteer] Key handler error:", err);
      }
    }
  });

  // Handle Simulated Browser Scroll
  socket.on("browser-scroll", async ({ deltaY }) => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { roomId } = session;
    const browserSession = activePuppeteerBrowsers[roomId];
    if (browserSession?.page) {
      try {
        await browserSession.page.evaluate((dy: number) => {
          window.scrollBy(0, dy);
        }, deltaY);

        // Capture immediate screenshot
        const buffer = await browserSession.page.screenshot({ type: "jpeg", quality: 60 });
        const base64 = buffer.toString("base64");
        io.to(roomId).emit("browser-frame", `data:image/jpeg;base64,${base64}`);
      } catch (err) {
        console.error("[Puppeteer] Scroll handler error:", err);
      }
    }
  });

  socket.on("browser-video-state", ({ isPlaying, currentTime }) => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { roomId } = session;
    const room = rooms[roomId];
    if (room) {
      room.isPlaying = isPlaying;
      room.currentTime = currentTime;
      socket.to(roomId).emit("browser-sync-video-state", { isPlaying, currentTime });
    }
  });

  // WebRTC Camera/Voice Peer signaling proxy
  socket.on("signal", ({ to, signal }) => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { userId } = session;
    // Route signal exactly to target peer
    io.to(to).emit("signal", { from: userId, signal });
  });

  // Toggle user camera or mic statuses
  socket.on("toggle-media", ({ cameraActive, micActive }) => {
    const session = activeSockets[socket.id];
    if (!session) return;
    const { roomId, userId } = session;
    const room = rooms[roomId];
    if (room && room.users[userId]) {
      room.users[userId].cameraActive = cameraActive;
      room.users[userId].micActive = micActive;
      socket.to(roomId).emit("user-media-toggled", { userId, cameraActive, micActive });
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    const session = activeSockets[socket.id];
    if (!session) return;

    const { roomId, userId } = session;
    const room = rooms[roomId];
    if (room) {
      const leavingUser = room.users[userId];
      delete room.users[userId];
      room.lastActiveAt = Date.now();

      socket.to(roomId).emit("user-left", userId);
      console.log(`Socket disconnected: ${userId} left room ${roomId}`);

      // If room is empty, close the active Puppeteer browser to free memory
      if (Object.keys(room.users).length === 0) {
        const browserSession = activePuppeteerBrowsers[roomId];
        if (browserSession) {
          console.log(`[Puppeteer] Room ${roomId} is empty. Closing headless browser...`);
          browserSession.browser.close().catch(() => {});
          delete activePuppeteerBrowsers[roomId];
        }
      }
    }
    delete activeSockets[socket.id];
  });
});

// Configure Vite middleware or Static files build
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

startServer();
