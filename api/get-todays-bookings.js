const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function getTorontoTodayRange() {
  const now = new Date();
  const torontoNow = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Toronto" })
  );
  const startOfDay = new Date(torontoNow);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(torontoNow);
  endOfDay.setHours(23, 59, 59, 999);

  const offset = now.getTime() - torontoNow.getTime();
  return {
    start_at_min: new Date(startOfDay.getTime() + offset).toISOString(),
    start_at_max: new Date(endOfDay.getTime() + offset).toISOString(),
  };
}

function digitsOnly(phone) {
  return (phone || "").replace(/\D/g, "");
}

function last10(phone) {
  const d = digitsOnly(phone);
  return d.length >= 10 ? d.slice(-10) : d;
}

function phonesMatch(a, b) {
  const da = last10(a);
  const db = last10(b);
  return da && db && da === db;
}

function phoneVariants(phone) {
  const digits = digitsOnly(phone);
  const set = new Set();
  if (!digits) return [];
  set.add(digits);
  if (digits.length === 10) {
    set.add("1" + digits);
    set.add("+1" + digits);
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    set.add(digits.slice(1));
    set.add("+" + digits);
  }
  set.add("+" + digits);
  return Array.from(set);
}

async function searchCustomersByPhone(token, phone) {
  const byId = new Map();
  for (const v of phoneVariants(phone)) {
    try {
      const res = await fetch(`${getBaseUrl()}/v2/customers/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: { filter: { phone_number: { exact: v } } },
          limit: 50,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        for (const c of data.customers || []) {
          if (c.id) byId.set(c.id, c);
        }
      }
    } catch (e) {
      console.error("customer search failed for", v, e);
    }
  }
  return Array.from(byId.values());
}

async function listAllTodaysBookings(token, locationId) {
  const { start_at_min, start_at_max } = getTorontoTodayRange();
  let cursor = null;
  const all = [];

  do {
    const params = new URLSearchParams({
      location_id: locationId,
      start_at_min,
      start_at_max,
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${getBaseUrl()}/v2/bookings?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data.errors || data));

    all.push(...(data.bookings || []));
    cursor = data.cursor || null;
  } while (cursor);

  return all.filter((b) => {
    const status = (b.status || "").toUpperCase();
    return ![
      "CANCELLED",
      "CANCELLED_BY_CUSTOMER",
      "CANCELLED_BY_SELLER",
      "DECLINED",
      "NO_SHOW",
    ].includes(status);
  });
}

async function getCustomer(token, customerId) {
  if (!customerId) return null;
  try {
    const res = await fetch(`${getBaseUrl()}/v2/customers/${customerId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const data = await res.json();
    if (res.ok) return data.customer || null;
  } catch (e) {
    console.error("getCustomer", e);
  }
  return null;
}

async function getTeamMemberName(token, teamMemberId) {
  if (!teamMemberId) return "Staff";
  try {
    const res = await fetch(
      `${getBaseUrl()}/v2/bookings/team-member-booking-profiles/${teamMemberId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Square-Version": SQUARE_VERSION,
        },
      }
    );
    const data = await res.json();
    if (res.ok && data.team_member_booking_profile?.display_name) {
      return data.team_member_booking_profile.display_name;
    }
  } catch (e) {}
  return "Staff";
}

async function getServiceName(token, variationId) {
  if (!variationId) return "Service";
  try {
    const res = await fetch(
      `${getBaseUrl()}/v2/catalog/object/${variationId}?include_related_objects=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Square-Version": SQUARE_VERSION,
        },
      }
    );
    const data = await res.json();
    if (res.ok && data.object) {
      const variation = data.object.item_variation_data;
      if (variation?.name) return variation.name;
      const item = (data.related_objects || []).find((o) => o.type === "ITEM");
      if (item?.item_data?.name) return item.item_data.name;
    }
  } catch (e) {}
  return "Service";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID || "L5NJSKPJF80C0";
    if (!token) return res.status(500).json({ error: "Server misconfigured" });

    const body = req.method === "POST" ? req.body || {} : {};
    const phone =
      body.phone || (req.method === "GET" ? req.query.phone : null) || null;
    const customerId =
      body.customerId ||
      (req.method === "GET" ? req.query.customerId : null) ||
      null;

    // Staff page: no phone filter — return all today's active bookings
    if (!phone && !customerId) {
      const bookings = await listAllTodaysBookings(token, locationId);
      const enriched = await Promise.all(
        bookings.map(async (b) => {
          const segment = b.appointment_segments?.[0] || {};
          const [staffName, serviceName] = await Promise.all([
            getTeamMemberName(token, segment.team_member_id),
            getServiceName(token, segment.service_variation_id),
          ]);
          return {
            ...b,
            checkedIn: !!(
              b.seller_note &&
              b.seller_note.toLowerCase().includes("checked in")
            ),
            staffName,
            serviceName,
          };
        })
      );
      return res.status(200).json({ bookings: enriched });
    }

    // Customer check-in by phone
    if (phone) {
      // Method 1: find all customer profiles with this phone
      const profiles = await searchCustomersByPhone(token, phone);
      const profileIds = new Set(profiles.map((p) => p.id));

      // Method 2: all today's bookings, match by customer_id OR by retrieving customer phone
      const allBookings = await listAllTodaysBookings(token, locationId);
      const customerCache = new Map();
      for (const p of profiles) customerCache.set(p.id, p);

      const matched = [];
      const seen = new Set();

      for (const b of allBookings) {
        if (seen.has(b.id)) continue;
        const cid = b.customer_id;
        if (!cid) continue;

        // Match if booking belongs to any profile we found by phone
        if (profileIds.has(cid)) {
          let customer = customerCache.get(cid);
          if (!customer) {
            customer = await getCustomer(token, cid);
            customerCache.set(cid, customer);
          }
          const name = customer
            ? [customer.given_name, customer.family_name]
                .filter(Boolean)
                .join(" ") || "Guest"
            : "Guest";
          matched.push({ ...b, _guestName: name });
          seen.add(b.id);
          continue;
        }

        // Extra safety: load customer and compare phone digits
        let customer = customerCache.get(cid);
        if (customer === undefined) {
          customer = await getCustomer(token, cid);
          customerCache.set(cid, customer);
        }
        if (customer && phonesMatch(customer.phone_number, phone)) {
          const name =
            [customer.given_name, customer.family_name]
              .filter(Boolean)
              .join(" ") || "Guest";
          matched.push({ ...b, _guestName: name });
          seen.add(b.id);
        }
      }

      const enriched = await Promise.all(
        matched.map(async (b) => {
          const segment = b.appointment_segments?.[0] || {};
          const [staffName, serviceName] = await Promise.all([
            getTeamMemberName(token, segment.team_member_id),
            getServiceName(token, segment.service_variation_id),
          ]);
          return {
            ...b,
            checkedIn: !!(
              b.seller_note &&
              b.seller_note.toLowerCase().includes("checked in")
            ),
            staffName,
            serviceName,
            guestName: b._guestName || "Guest",
          };
        })
      );

      return res.status(200).json({
        bookings: enriched,
        profilesFound: profiles.map((p) => ({
          id: p.id,
          name:
            [p.given_name, p.family_name].filter(Boolean).join(" ") || "Guest",
          phone: p.phone_number || "",
        })),
      });
    }

    // By single customerId
    const params = new URLSearchParams({
      location_id: locationId,
      ...getTorontoTodayRange(),
      limit: "50",
      customer_id: customerId,
    });
    // fix params - getTorontoTodayRange returns object
    const range = getTorontoTodayRange();
    const p2 = new URLSearchParams({
      location_id: locationId,
      start_at_min: range.start_at_min,
      start_at_max: range.start_at_max,
      limit: "50",
      customer_id: customerId,
    });
    const squareRes = await fetch(`${getBaseUrl()}/v2/bookings?${p2}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const data = await squareRes.json();
    if (!squareRes.ok) {
      return res.status(squareRes.status).json({ error: data.errors || data });
    }
    const bookings = (data.bookings || []).filter((b) => {
      const status = (b.status || "").toUpperCase();
      return ![
        "CANCELLED",
        "CANCELLED_BY_CUSTOMER",
        "CANCELLED_BY_SELLER",
        "DECLINED",
        "NO_SHOW",
      ].includes(status);
    });
    const enriched = await Promise.all(
      bookings.map(async (b) => {
        const segment = b.appointment_segments?.[0] || {};
        const [staffName, serviceName] = await Promise.all([
          getTeamMemberName(token, segment.team_member_id),
          getServiceName(token, segment.service_variation_id),
        ]);
        return {
          ...b,
          checkedIn: !!(
            b.seller_note &&
            b.seller_note.toLowerCase().includes("checked in")
          ),
          staffName,
          serviceName,
        };
      })
    );
    return res.status(200).json({ bookings: enriched });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
