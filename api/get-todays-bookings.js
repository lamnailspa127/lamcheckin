const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function getTorontoTodayRange() {
  const now = new Date();
  const torontoNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" }));
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

    const res2 = await fetch(`${getBaseUrl()}/v2/team-members/${teamMemberId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const data2 = await res2.json();
    if (res2.ok && data2.team_member) {
      const tm = data2.team_member;
      return [tm.given_name, tm.family_name].filter(Boolean).join(" ") || "Staff";
    }
  } catch (e) {
    console.error("Team member lookup failed", e);
  }
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
      if (data.related_objects) {
        const item = data.related_objects.find((o) => o.type === "ITEM");
        if (item?.item_data?.name) return item.item_data.name;
      }
    }
  } catch (e) {
    console.error("Service lookup failed", e);
  }
  return "Service";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID || "L5NJSKPJF80C0";

    if (!token) {
      return res.status(500).json({ error: "Server misconfigured" });
    }

    let customerId = null;
    if (req.method === "POST") {
      customerId = (req.body || {}).customerId || null;
    } else {
      customerId = req.query.customerId || null;
    }

    const { start_at_min, start_at_max } = getTorontoTodayRange();

    const params = new URLSearchParams({
      location_id: locationId,
      start_at_min,
      start_at_max,
      limit: "50",
    });
    if (customerId) params.set("customer_id", customerId);

    const squareRes = await fetch(`${getBaseUrl()}/v2/bookings?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
    });

    const data = await squareRes.json();
    if (!squareRes.ok) {
      return res.status(squareRes.status).json({ error: data.errors || data });
    }

    const bookings = (data.bookings || []).filter((b) => {
      const status = (b.status || "").toUpperCase();
      const hidden = [
        "CANCELLED",
        "CANCELLED_BY_CUSTOMER",
        "CANCELLED_BY_SELLER",
        "DECLINED",
        "NO_SHOW",
      ];
      return !hidden.includes(status);
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
          checkedIn: !!(b.seller_note && b.seller_note.toLowerCase().includes("checked in")),
          staffName,
          serviceName,
          teamMemberId: segment.team_member_id,
        };
      })
    );

    return res.status(200).json({ bookings: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
