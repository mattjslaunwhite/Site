const CATALOG = {
  frame: {
    "sleek-bat": {
      label: "Sleek Bat Sub-250g Delta (ASA + Carbon Spars)",
      bom: 34,
      price: 115,
      weight: 135
    },
    "quad-425": {
      label: "425mm Carbon Quad + Printed Sensor Mounts",
      bom: 68,
      price: 185,
      weight: 390
    },
    "f450-dev": {
      label: "F450 Modular Dev Frame + 920KV Motors",
      bom: 62,
      price: 165,
      weight: 440
    },
    "custom-cad": {
      label: "Custom OpenSCAD / Fusion 360 Print Run",
      bom: 28,
      price: 140,
      weight: 250
    }
  },
  fc: {
    "none": {
      label: "None (Airframe & Hardware Only)",
      bom: 0,
      price: 0,
      weight: 0
    },
    "wing-fc": {
      label: "F405 Wing FC + 40A Brushless ESC",
      bom: 48,
      price: 85,
      weight: 28
    },
    "h743-stack": {
      label: "H743 FC + 60A 4-in-1 ESC (Pre-Flashed)",
      bom: 108,
      price: 175,
      weight: 42
    },
    "h743-nav": {
      label: "H743 Stack + BE-880 GPS + MTF-01 Optical Flow",
      bom: 148,
      price: 235,
      weight: 64
    }
  },
  rx: {
    "none": {
      label: "None (Supply Your Own RX)",
      bom: 0,
      price: 0,
      weight: 0
    },
    "elrs": {
      label: "ExpressLRS 2.4GHz Diversity Receiver (CRSF)",
      bom: 16,
      price: 32,
      weight: 5
    },
    "ibus": {
      label: "FlySky i-BUS Telemetry Receiver",
      bom: 11,
      price: 24,
      weight: 8
    },
    "espnow": {
      label: "Paired ESP32-32E ESP-NOW Telemetry Modules",
      bom: 14,
      price: 38,
      weight: 14
    }
  },
  vtx: {
    "none": {
      label: "None (Line-of-Sight / Autonomous)",
      bom: 0,
      price: 0,
      weight: 0
    },
    "vtx-200": {
      label: "200mW 5.8GHz Micro VTX + 700TVL Camera",
      bom: 22,
      price: 45,
      weight: 12
    },
    "vtx-800": {
      label: "800mW SmartAudio VTX + Low-Light CMOS Cam",
      bom: 42,
      price: 78,
      weight: 22
    }
  },
  mat: {
    "petg": {
      label: "Carbon-Black PETG + High-Vis Orange TPU",
      bom: 0,
      price: 0,
      weight: 0
    },
    "asa": {
      label: "UV-Resistant ASA + Black TPU",
      bom: 5,
      price: 15,
      weight: 0
    },
    "cf-petg": {
      label: "Carbon-Fiber Reinforced PETG",
      bom: 10,
      price: 25,
      weight: 0
    }
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
        const marginPct = totalRetail > 0 ? ((grossMargin / totalRetail) * 100).toFixed(1) : "0.0";
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

        // Internal Studio Email (includes BOM vs Retail breakdown)
        const internalEmailText = [
          `NEW DRONE KIT ORDER — ${orderId}`,
          `==================================================`,
          `DATE:     ${timestamp}`,
          `CUSTOMER: ${name} <${email}>`,
          `DELIVERY: ${shipping}`,
          ``,
          `BOM VS. RETAIL BREAKDOWN (CAD):`,
          `- Airframe:  ${frame.label}`,
          `             BOM: $${frame.bom.toFixed(2)}  |  Retail: $${frame.price.toFixed(2)}`,
          `- FC/ESC:    ${fc.label}`,
          `             BOM: $${fc.bom.toFixed(2)}  |  Retail: $${fc.price.toFixed(2)}`,
          `- Radio RX:  ${rx.label}`,
          `             BOM: $${rx.bom.toFixed(2)}  |  Retail: $${rx.price.toFixed(2)}`,
          `- Video/VTX: ${vtx.label}`,
          `             BOM: $${vtx.bom.toFixed(2)}  |  Retail: $${vtx.price.toFixed(2)}`,
          `- Material:  ${mat.label}`,
          `             BOM: $${mat.bom.toFixed(2)}  |  Retail: $${mat.price.toFixed(2)}`,
          ``,
          `--------------------------------------------------`,
          `TOTAL BOM COST:    $${totalBom.toFixed(2)} CAD`,
          `TOTAL RETAIL:      $${totalRetail.toFixed(2)} CAD`,
          `EST. GROSS MARGIN: $${grossMargin.toFixed(2)} CAD (${marginPct}%)`,
          `EST. DRY WEIGHT:   ${totalWeight} g`,
          `--------------------------------------------------`,
          ``,
          `BUILDER NOTES: ${notes}`
        ].join("\n");

        // Customer Receipt Email (Retail pricing only)
        const customerEmailText = [
          `Hi ${name},`,
          ``,
          `Thanks for submitting a custom drone kit order request with Magic Goat Studio!`,
          `We will verify component stock, confirm Canada Post shipping (if selected), and reply within 24 hours with your Interac e-Transfer or invoice payment details.`,
          ``,
          `ORDER SUMMARY (${orderId})`,
          `==================================================`,
          `Delivery: ${shipping}`,
          `- Airframe:  ${frame.label} ($${frame.price.toFixed(2)})`,
          `- FC/ESC:    ${fc.label} ($${fc.price.toFixed(2)})`,
          `- Radio RX:  ${rx.label} ($${rx.price.toFixed(2)})`,
          `- Video/VTX: ${vtx.label} ($${vtx.price.toFixed(2)})`,
          `- Material:  ${mat.label} ($${mat.price.toFixed(2)})`,
          ``,
          `Est. Dry Weight: ${totalWeight} g`,
          `Estimated Total: $${totalRetail.toFixed(2)} CAD (plus shipping if applicable)`,
          `Notes: ${notes}`,
          ``,
          `Questions? Reply directly to orders@magicgoat.studio.`,
          `— Magic Goat Studio (Woodstock, NB)`
        ].join("\n");

        if (env.RESEND_API_KEY) {
          // Send to orders@magicgoat.studio
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: "Magic Goat Orders <orders@magicgoat.studio>",
              to: ["orders@magicgoat.studio"],
              reply_to: email,
              subject: `[Order ${orderId}] ${name} — Retail $${totalRetail.toFixed(2)} / BOM $${totalBom.toFixed(2)} CAD`,
              text: internalEmailText
            })
          });

          // Send confirmation to buyer
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: "Magic Goat Studio <orders@magicgoat.studio>",
              to: [email],
              reply_to: "orders@magicgoat.studio",
              subject: `Order Request Received (${orderId}) — Magic Goat Studio`,
              text: customerEmailText
            })
          });
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
