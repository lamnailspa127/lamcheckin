const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function phoneVariants(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  const variants = new Set();

  if (!digits) return [];

  // Raw digits
  variants.add(digits);

  // 10-digit North American
  if (digits.length === 10) {
    variants.add("1" + digits);
    variants.add("+1" + digits);
  }

  // 11-digit starting with 1
  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(digits.slice(1));
    variants.add("+" + digits);
    variants.add(digits);
  }

  // Already has country style
  if (digits.length >= 10) {
    variants.add("+" + digits);
  }

  return Array.from(variants);
}

async function searchByPhone(token, phoneExact) {
  const body = {
    query: {
      filter: {
        phone_number: {
          exact: phoneExact,
        },
      },
    },
    limit: 20,
  };

  const res = await fetch(`${getBaseUrl()}/v2/customers/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) return [];
  return data.customers || [];
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

    const variants = phoneVariants(phone);
    const byId = new Map();

    // Search every common phone format so duplicate profiles are found
    for (const v of variants) {
      const found = await searchByPhone(token, v);
      for (const c of found) {
        if (c.id) byId.set(c.id, c);
      }
    }

    const customers = Array.from(byId.values());

    return res.status(200).json({
      customers,
      searchedFormats: variants,
      count: customers.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
