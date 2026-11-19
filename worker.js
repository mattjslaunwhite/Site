const CATALOG = {
  frame: {
    "sleek-bat": { label: "Sleek Bat Sub-250g Delta (ASA + Carbon Spars)", bom: 34, price: 115, weight: 135 },
    "quad-425": { label: "425mm Carbon Quad + Printed Sensor Mounts", bom: 68, price: 185, weight: 390 },
    "f450-dev": { label: "F450 Modular Dev Frame + 920KV Motors", bom: 62, price: 165, weight: 440 },
    "custom-cad": { label: "Custom OpenSCAD / Fusion 360 Print Run", bom: 28, price: 140, weight: 250 }
  },
  fc: {
    "none": { label: "None (Airframe & Hardware Only)", bom: 0, price: 0, weight: 0 },
    "wing-fc": { label: "F405 Wing FC + 40A Brushless ESC", bom: 48, price: 85, weight: 28 },
    "h743-stack": { label: "H743 FC + 60A 4-in-1 ESC (Pre-Flashed)", bom: 108, price: 175, weight: 42 },
    "h743-nav": { label: "H743 Stack + BE-880 GPS + MTF-01 Optical Flow", bom: 148, price: 235, weight: 64 }
  },
  rx: {
    "none": { label: "None (Supply Your Own RX)", bom: 0, price: 0, weight: 0 },
    "elrs": { label: "ExpressLRS 2.4GHz Diversity Receiver (CRSF)", bom: 16, price: 32, weight: 5 },
    "ibus": { label: "FlySky i-BUS Telemetry Receiver", bom: 11, price: 24, weight: 8 },
    "espnow": { label: "Paired ESP32-32E ESP-NOW Telemetry Modules", bom: 14, price: 38, weight: 14 }
  },
  vtx: {
    "none": { label: "None (Line-of-Sight / Autonomous)", bom: 0, price: 0, weight: 0 },
    "vtx-200": { label: "200mW 5.8GHz Micro VTX + 700TVL Camera", bom: 22, price: 45, weight: 12 },
    "vtx-800": { label: "800mW SmartAudio VTX + Low-Light CMOS Cam", bom: 42, price: 78, weight: 22 }
  },
  mat: {
    "petg": { label: "Carbon-Black PETG + High-Vis Orange TPU", bom: 0, price: 0, weight: 0 },
    "asa": { label: "UV-Resistant ASA + Black TPU", bom: 5, price: 15, weight: 0 },
    "cf-petg": { label: "Carbon-Fiber Reinforced PETG", bom: 10, price: 25, weight: 0 }
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

// In-memory fallback if KV is temporarily unavailable
const MEMORY_MESSAGES = [];
const MEMORY_PEERS = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ================= ENCRYPTED LIVE COMMS API =================
    if (url.pathname === "/api/comms") {
      // GET: Poll encrypted packets + active online peers
      if (request.method === "GET") {
        const room = (url.searchParams.get("room") || "public").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "public";
        const peerId = (url.searchParams.get("peerId") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
        const alias = String(url.searchParams.get("alias") || "").trim().slice(0, 24);
        const now = Date.now();

        if (env.ORDERS_KV) {
          // Heartbeat presence (expires automatically after 60s)
          if (peerId && alias) {
            await env.ORDERS_KV.put(
              `chat:peer:${room}:${peerId}`,
              JSON.stringify({ peerId, alias, seen: now }),
              { expirationTtl: 60 }
            );
          }

          // List active peers
          const peerList = await env.ORDERS_KV.list({ prefix: `chat:peer:${room}:` });
          const peers = [];
          for (const key of peerList.keys) {
            const raw = await env.ORDERS_KV.get(key.name);
            if (raw) {
              try {
                const p = JSON.parse(raw);
                if (now - p.seen < 35000) peers.push({ peerId: p.peerId, alias: p.alias });
              } catch {}
            }
          }

          // List recent encrypted packets (last 45 messages)
          const msgList = await env.ORDERS_KV.list({ prefix: `chat:msg:${room}:` });
          const recentKeys = msgList.keys.slice(-45);
          const messages = [];
          for (const key of recentKeys) {
            const raw = await env.ORDERS_KV.get(key.name);
            if (raw) {
              try {
                messages.push(JSON.parse(raw));
              } catch {}
            }
          }

          return jsonResponse({ ok: true, peers, messages });
        }

        // Fallback if KV not bound
        if (peerId && alias) {
          MEMORY_PEERS.set(`${room}:${peerId}`, { room, peerId, alias, seen: now });
        }
        const peers = [];
        for (const [k, v] of MEMORY_PEERS.entries()) {
          if (v.room === room && now - v.seen < 35000) peers.push({ peerId: v.peerId, alias: v.alias });
        }
        const messages = MEMORY_MESSAGES.filter(m => m.room === room).slice(-45);
        return jsonResponse({ ok: true, peers, messages });
      }

      // POST: Store an opaque AES-GCM encrypted message packet
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const room = String(body.room || "public").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "public";
          const peerId = String(body.peerId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
          const iv = String(body.iv || "").slice(0, 64);
          const ciphertext = String(body.ciphertext || "").slice(0, 4096);

          if (!iv || !ciphertext) {
            return jsonResponse({ ok: false, error: "Empty encrypted payload." }, 400);
          }

          const ts = Date.now();
          const id = `${String(ts).padStart(15, "0")}-${Math.random().toString(36).slice(2, 7)}`;
          const packet = { id, room, peerId, ts, iv, ciphertext };

          if (env.ORDERS_KV) {
            // Auto-expire chat history after 24 hours
            await env.ORDERS_KV.put(`chat:msg:${room}:${id}`, JSON.stringify(packet), {
              expirationTtl: 86400
            });
          } else {
            MEMORY_MESSAGES.push(packet);
            if (MEMORY_MESSAGES.length > 100) MEMORY_MESSAGES.shift();
          }

          return jsonResponse({ ok: true, id, ts });
        } catch (err) {
          return jsonResponse({ ok: false, error: err.message }, 500);
        }
      }
    }

    // ================= DRONE KIT ORDER ENDPOINT =================
    if (url.pathname === "/api/order" && request.method === "POST") {
      try {
        const body = await request.json();
        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim();
        const shipping = String(body.shipping || "Canada Post Tracked Shipping").trim();
        const notes = String(body.notes || "None").trim();

        if (!name || !email || !email.includes("@")) {
          return jsonResponse({ ok: false, error: "Please enter a valid name and reply email." }, 400);
        }

        const frame = CATALOG.frame[body.frame];
        const fc = CATALOG.fc[body.fc];
        const rx = CATALOG.rx[body.rx];
        const vtx = CATALOG.vtx[body.vtx];
        const mat = CATALOG.mat[body.mat];

        if (!frame || !fc || !rx || !vtx || !mat) {
          return jsonResponse({ ok: false, error: "Invalid hardware configuration selected." }, 400);
        }

        const totalBom = frame.bom + fc.bom + rx.bom + vtx.bom + mat.bom;
        const totalRetail = frame.price + fc.price + rx.price + vtx.price + mat.price;
        const grossMargin = totalRetail - totalBom;
        const totalWeight = frame.weight + fc.weight + rx.weight + vtx.weight + mat.weight;

        const randCode = Math.floor(1000 + Math.random() * 9000);
        const orderId = `MGS-${new Date().getFullYear()}-${randCode}`;
        const timestamp = new Date().toISOString();

        const orderRecord = {
          orderId,
          timestamp,
          status: "PENDING_CONFIRMATION",
          customer: { name, email, shipping, notes },
          build: {
            frame: { label: frame.label, bom: frame.bom, retail: frame.price },
            fc: { label: fc.label, bom: fc.bom, retail: fc.price },
            rx: { label: rx.label, bom: rx.bom, retail: rx.price },
            vtx: { label: vtx.label, bom: vtx.bom, retail: vtx.price },
            mat: { label: mat.label, bom: mat.bom, retail: mat.price }
          },
          totalWeight,
          totalBomCad: totalBom,
          totalRetailCad: totalRetail,
          grossMarginCad: grossMargin
        };

        if (env.ORDERS_KV) {
          await env.ORDERS_KV.put(`order:${orderId}`, JSON.stringify(orderRecord));
        }

        return jsonResponse({
          ok: true,
          orderId,
          totalCad: totalRetail,
          totalBomCad: totalBom,
          totalWeight
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: "Server error processing order: " + err.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};