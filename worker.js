// Kyro Solis Materials - site Worker
// Serves the static site (via the ASSETS binding) and handles enquiry-form
// submissions: every submission is stored in D1 and a notification email is
// sent to contact@ksmaterials.co via the Resend API (RESEND_API_KEY secret).

const NOTIFY_TO = "contact@ksmaterials.co";
// Must be an address on a domain verified in your Resend account.
const NOTIFY_FROM = "Kyro Solis Website <website@ksmaterials.co>";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/enquiry") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed" }, 405);
      }
      return handleEnquiry(request, env, ctx);
    }

    // Everything else: serve the static site.
    return env.ASSETS.fetch(request);
  },
};

async function handleEnquiry(request, env, ctx) {
  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid request body" }, 400);
  }

  const clean = (v, max) => (v == null ? "" : String(v)).trim().slice(0, max);
  const d = {
    name: clean(data.name, 200),
    company: clean(data.company, 200),
    email: clean(data.email, 200),
    country: clean(data.country, 100),
    interests: clean(data.interests, 500),
    usecase: clean(data.usecase, 4000),
    source: clean(data.source, 200),
  };

  // Server-side validation (do not trust the client).
  if (!d.name || !d.company || !d.email || !d.country || !d.usecase) {
    return json({ ok: false, error: "Missing required fields" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
    return json({ ok: false, error: "Invalid email address" }, 400);
  }

  const createdAt = new Date().toISOString();

  // 1) Store in D1 first so the lead is captured even if email later fails.
  let stored = false;
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS enquiries (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, name TEXT, " +
        "company TEXT, email TEXT, country TEXT, interests TEXT, usecase TEXT, source TEXT)"
    ).run();

    await env.DB.prepare(
      "INSERT INTO enquiries (created_at, name, company, email, country, interests, usecase, source) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(createdAt, d.name, d.company, d.email, d.country, d.interests, d.usecase, d.source)
      .run();

    stored = true;
  } catch (e) {
    // If storage fails we still attempt the email below.
  }

  // 2) Send a notification email (best effort).
  try {
    await sendNotification(env, d);
  } catch (e) {
    // If we already stored the lead, report success anyway.
    if (!stored) {
      return json({ ok: false, error: "Could not process enquiry" }, 502);
    }
  }

  return json({ ok: true });
}

async function sendNotification(env, d) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const subject = "Website enquiry from " + d.name + ", " + d.company;
  const bodyText =
    "New enquiry submitted via ksmaterials.co\n\n" +
    "Name: " + d.name + "\n" +
    "Company: " + d.company + "\n" +
    "Email: " + d.email + "\n" +
    "Country: " + d.country + "\n" +
    "Product interest: " + (d.interests || "None selected") + "\n" +
    "Application / use case: " + d.usecase + "\n" +
    "How they heard about us: " + (d.source || "Not specified") + "\n";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [NOTIFY_TO],
      reply_to: d.email,
      subject: subject,
      text: bodyText,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error("Resend API error " + res.status + ": " + detail);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
