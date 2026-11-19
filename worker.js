const CATALOG = {
  frame: {
    "sleek-bat": { label: "Sleek Bat Sub-250g Delta (ASA + Carbon Spars)", price: 115, weight: 135 },
    "quad-425": { label: "425mm Carbon Quad + Printed Sensor Mounts", price: 185, weight: 390 },
    "f450-dev": { label: "F450 Modular Dev Frame + 920KV Motors", price: 165, weight: 440 },
    "custom-cad": { label: "Custom OpenSCAD / Fusion 360 Print Run", price: 140, weight: 250 }
  },
  fc: {
    "none": { label: "None (Airframe & Hardware Only)", price: 0, weight: 0 },
    "wing-fc": { label: "F405 Wing FC + 40A Brushless ESC", price: 85, weight: 28 },
    "h743-stack": { label: "H743 FC + 60A 4-in-1 ESC (Pre-Flashed)", price: 175, weight: 42 },
    "h743-nav": { label: "H743 Stack + BE-880 GPS + MTF-01 Optical Flow", price: 235, weight: 64 }
  },
  rx: {
    "none": { label: "None (Supply Your Own RX)", price: 0, weight: 0 },
    "elrs": { label: "ExpressLRS 2.4GHz Diversity Receiver (CRSF)", price: 32, weight: 5 },
    "ibus": { label: "FlySky i-BUS Telemetry Receiver", price: 24, weight: 8 },
    "espnow": { label: "Paired ESP32-32E ESP-NOW Telemetry Modules", price: 38, weight: 14 }
  },
  vtx: {
    "none": { label: "None (Line-of-Sight / Autonomous)", price: 0, weight: 0 },
    "vtx-200": { label: "200mW 5.8GHz Micro VTX + 700TVL Camera", price: 45, weight: 12 },
    "vtx-800": { label: "800mW SmartAudio VTX + Low-Light CMOS Cam", price: 78, weight: 22 }
  },
  mat: {
    "petg": { label: "Carbon-Black PETG + High-Vis Orange TPU", price: 0, weight: 0 },
    "asa": { label: "UV-Resistant ASA + Black TPU", price: 15, weight: 0 },
    "cf-petg": { label: "Carbon-Fiber Reinforced PETG", price: 25, weight: 0 }
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle live drone kit orders
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

        const totalCad = frame.price + fc.price + rx.price + vtx.price + mat.price;
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
            frame: frame.label,
            fc: fc.label,
            rx: rx.label,
            vtx: vtx.label,
            mat: mat.label
          },
          totalWeight,
          totalCad
        };

        // 1. Save order to Cloudflare KV if bound
        if (env.ORDERS_KV) {
          await env.ORDERS_KV.put(`order:${orderId}`, JSON.stringify(orderRecord));
        }

        const summaryText = [
          `ORDER ID: ${orderId}`,
          `DATE:     ${timestamp}`,
          `CUSTOMER: ${name} <${email}>`,
          `DELIVERY: ${shipping}`,
          ``,
          `CONFIGURATION:`,
          `- Airframe:  ${frame.label} ($${frame.price})`,
          `- FC/ESC:    ${fc.label} ($${fc.price})`,
          `- Radio RX:  ${rx.label} ($${rx.price})`,
          `- Video/VTX: ${vtx.label} ($${vtx.price})`,
          `- Material:  ${mat.label} ($${mat.price})`,
          ``,
          `EST. DRY WEIGHT: ${totalWeight} g`,
          `ESTIMATED TOTAL: $${totalCad.toFixed(2)} CAD (plus shipping if applicable)`,
          ``,
          `NOTES: ${notes}`
        ].join("\n");

        // 2. Dispatch notification email to matt@magicgoat.studio & confirmation to customer via Resend
        if (env.RESEND_API_KEY) {
          // Email to Studio Admin
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: "Magic Goat Studio <orders@magicgoat.studio>",
              to: ["matt@magicgoat.studio"],
              reply_to: email,
              subject: `[New Drone Kit Order] ${orderId} — ${name} ($${totalCad.toFixed(2)} CAD)`,
              text: summaryText
            })
          });

          // Receipt to Buyer
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: "Magic Goat Studio <orders@magicgoat.studio>",
              to: [email],
              reply_to: "matt@magicgoat.studio",
              subject: `Order Request Received (${orderId}) — Magic Goat Studio`,
              text: [
                `Hi ${name},`,
                ``,
                `Thanks for submitting a custom drone kit order request with Magic Goat Studio!`,
                `We will verify component stock, confirm Canada Post shipping (if selected), and reply within 24 hours with your Interac e-Transfer or invoice payment details.`,
                ``,
                summaryText,
                ``,
                `— Matt-Réal @ Magic Goat Studio (Woodstock, NB)`
              ].join("\n")
            })
          });
        }

        return jsonResponse({
          ok: true,
          orderId,
          totalCad,
          totalWeight
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: "Server error processing order: " + err.message }, 500);
      }
    }

    // Serve all static HTML pages (index.html, kits.html, drones.html, win95.html, win311.html)
    return env.ASSETS.fetch(request);
  }
};