const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function getTorontoTodayRange() {
  // Get current time in Toronto
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;

  // Start and end of day in Toronto, converted to UTC ISO
  const startLocal = `${year}-${month}-${day}T00:00:00`;
  const endLocal = `${year}-${month}-${day}T23:59:59`;

  // Create dates assuming Toronto offset (handle DST roughly)
  const start = new Date(new Date(startLocal + "-05:00").toLocaleString("en-US", { timeZone: "America/Toronto" }));
  // Simpler reliable way:
  const startUTC = new Date(`${year}-${month}-${day}T00:00:00-05:00`); // EST approximation
  const endUTC = new Date(`${year}-${month}-${day}T23:59:59-05:00`);

  // Better: use toLocaleString trick is messy. Use fixed range with proper offset detection.
  // For reliability we use a wide enough window and filter client-side if needed.
  const now = new Date();
  const torontoNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" }));
  const startOfDay = new Date(torontoNow);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(torontoNow);
  endOfDay.setHours(23, 59, 59, 999);

  // Convert back to real UTC timestamps
  const offset = now.getTime() - torontoNow.getTime();
  const startISO = new Date(startOfDay.getTime() + offset).toISOString();
  const endISO = new Date(endOfDay.getTime() + offset).toISOString();

  return {
    start_at_min: startISO,
    start_at_max: endISO,
  };
}

async function getTeamMemberName(token, teamMemberId) {
  if (!teamMemberId) return "Staff";
  try {
    // Prefer booking profile (has display_name)
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

    // Fallback to Team API
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
      // Variation name or parent item name
      const variation = data.object.item_variation_data;
      if (variation?.name) return variation.name;

      // Try related objects for the parent item
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

export default async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID || "L5NJSKPJF80C0";

    if (!token) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    let customerId = null;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      customerId = body.customerId || null;
    } else {
      const url = new URL(req.url);
      customerId = url.searchParams.get("customerId");
    }

    const { start_at_min, start_at_max } = getTorontoTodayRange();

    const params = new URLSearchParams({
      location_id: locationId,
      start_at_min,
      start_at_max,
      limit: "50",
    });
    if (customerId) params.set("customer_id", customerId);

    const res = await fetch(`${getBaseUrl()}/v2/bookings?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.errors || data }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const bookings = data.bookings || [];

    // Enrich each booking with service name and staff name
    const enriched = await Promise.all(
      bookings.map(async (b) => {
        const segment = b.appointment_segments?.[0] || {};
        const teamMemberId = segment.team_member_id;
        const serviceVariationId = segment.service_variation_id;

        const [staffName, serviceName] = await Promise.all([
          getTeamMemberName(token, teamMemberId),
          getServiceName(token, serviceVariationId),
        ]);

        return {
          ...b,
          checkedIn: !!(b.seller_note && b.seller_note.toLowerCase().includes("checked in")),
          staffName,
          serviceName,
          teamMemberId,
        };
      })
    );

    return new Response(JSON.stringify({ bookings: enriched }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/get-todays-bookings",
};
