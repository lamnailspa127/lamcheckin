const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function normalizePhone(phone) {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) {
    return "+" + digits;
  }
  return phone.startsWith("+") ? phone : "+" + digits;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { phone } = req.body || {};
    if (!phone) {
      return res.status(400).json({ error: "Phone number required" });
    }

    const token = process.env.SQUARE_ACCESS_TOKEN;
    if (!token) {
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const e164 = normalizePhone(phone);

    const body = {
      query: {
        filter: {
          phone_number: {
            exact: e164,
          },
        },
      },
      limit: 20,
    };

    const squareRes = await fetch(`${getBaseUrl()}/v2/customers/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await squareRes.json();

    if (!squareRes.ok) {
      return res.status(squareRes.status).json({ error: data.errors || data });
    }

    return res.status(200).json({ customers: data.customers || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
