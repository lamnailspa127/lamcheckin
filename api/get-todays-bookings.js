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
  return !!(da && db && da === db);
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
  const variants = phoneVariants(phone);

  // Run variant searches in parallel (much faster)
  await Promise.all(
    variants.map(async (v) => {
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
        console.error("customer search", v, e.message);
      }
    })
  );

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
  } catch (e) {}
  return null;
}

// Simple in-request caches
function makeCaches() {
  return {
    staff: new Map(),
    service: new Map(),
    customer: new Map(),
  };
}

async function getTeamMemberName(token, teamMemberId, cache) {
  if (!teamMemberId) return "Staff";
  if (cache.staff.has(teamMemberId)) return cache.staff.get(teamMemberId);

  let name = "Staff";
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
      name = data.team_member_booking_profile.display_name;
    }
  } catch (e) {}
  cache.staff.set(teamMemberId, name);
  return name;
}

async function getServiceName(token, variationId, cache) {
  if (!variationId) return "Service";
  if (cache.service.has(variationId)) return cache.service.get(variationId);

  let name = "Service";
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
      if (variation?.name) name = variation.name;
      else {
        const item = (data.related_objects || []).find((o) => o.type === "ITEM");
        if (item?.item_data?.name) name = item.item_data.name;
      }
    }
  } catch (e) {}
  cache.service.set(variationId, name);
  return name;
}

async function enrichBookings(token, bookings, cache) {
  return Promise.all(
    bookings.map(async (b) => {
      const segment = b.appointment_segments?.[0] || {};
      const [staffName, serviceName] = await Promise.all([
        getTeamMemberName(token, segment.team_member_id, cache),
        getServiceName(token, segment.service_variation_id, cache),
      ]);
      return {
        ...b,
        checkedIn: !!(
          b.seller_note && b.seller_note.toLowerCase().includes("checked in")
        ),
        staffName,
        serviceName,
        guestName: b._guestName || null,
      };
    })
  );
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

    const cache = makeCaches();

    // Staff page – all today's bookings
    if (!phone && !customerId) {
      const bookings = await listAllTodaysBookings(token, locationId);
      const enriched = await enrichBookings(token, bookings, cache);
      return res.status(200).json({ bookings: enriched });
    }

    // Customer check-in by phone (optimized)
    if (phone) {
      // 1) Find all profiles with this phone + 2) load today's bookings — in parallel
      const [profiles, allBookings] = await Promise.all([
        searchCustomersByPhone(token, phone),
        listAllTodaysBookings(token, locationId),
      ]);

      const profileIds = new Set(profiles.map((p) => p.id));
      const profileName = new Map(
        profiles.map((p) => [
          p.id,
          [p.given_name, p.family_name].filter(Boolean).join(" ") || "Guest",
        ])
      );

      // Fast path: match by customer_id only (no extra customer API calls)
      let matched = allBookings
        .filter((b) => b.customer_id && profileIds.has(b.customer_id))
        .map((b) => ({
          ...b,
          _guestName: profileName.get(b.customer_id) || "Guest",
        }));

      // Slow fallback only if nothing matched (rare)
      if (matched.length === 0 && allBookings.length > 0) {
        const uniqueIds = [
          ...new Set(allBookings.map((b) => b.customer_id).filter(Boolean)),
        ];
        await Promise.all(
          uniqueIds.map(async (cid) => {
            if (cache.customer.has(cid)) return;
            cache.customer.set(cid, await getCustomer(token, cid));
          })
        );

        matched = allBookings
          .filter((b) => {
            const c = cache.customer.get(b.customer_id);
            return c && phonesMatch(c.phone_number, phone);
          })
          .map((b) => {
            const c = cache.customer.get(b.customer_id);
            const name = c
              ? [c.given_name, c.family_name].filter(Boolean).join(" ") ||
                "Guest"
              : "Guest";
            return { ...b, _guestName: name };
          });
      }

      const enriched = await enrichBookings(token, matched, cache);

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
    const range = getTorontoTodayRange();
    const params = new URLSearchParams({
      location_id: locationId,
      start_at_min: range.start_at_min,
      start_at_max: range.start_at_max,
      limit: "50",
      customer_id: customerId,
    });
    const squareRes = await fetch(`${getBaseUrl()}/v2/bookings?${params}`, {
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
    const enriched = await enrichBookings(token, bookings, cache);
    return res.status(200).json({ bookings: enriched });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
