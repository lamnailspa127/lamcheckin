const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bookingId, version } = req.body || {};
    if (!bookingId) {
      return res.status(400).json({ error: "bookingId required" });
    }

    const token = process.env.SQUARE_ACCESS_TOKEN;
    if (!token) {
      return res.status(500).json({ error: "Server misconfigured" });
    }

    // 1. Get booking
    const getRes = await fetch(`${getBaseUrl()}/v2/bookings/${bookingId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const getData = await getRes.json();
    if (!getRes.ok) {
      return res.status(getRes.status).json({ error: getData.errors || getData });
    }

    const booking = getData.booking;
    const segment = booking.appointment_segments?.[0] || {};
    const teamMemberId = segment.team_member_id;
    const serviceVariationId = segment.service_variation_id;
    const customerId = booking.customer_id;

    const timeStr = new Date().toLocaleTimeString("en-US", {
      timeZone: "America/Toronto",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const sellerNote = `Checked in at ${timeStr}`;

    // 2. Update seller note + load tech/customer/service in parallel
    const updatePromise = fetch(`${getBaseUrl()}/v2/bookings/${bookingId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        booking: {
          version: version || booking.version || 0,
          seller_note: sellerNote,
        },
      }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json() }));

    const techPromise = teamMemberId
      ? fetch(`${getBaseUrl()}/v2/team-members/${teamMemberId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Square-Version": SQUARE_VERSION,
          },
        }).then(async (r) => (r.ok ? (await r.json()).team_member : null))
      : Promise.resolve(null);

    const customerPromise = customerId
      ? fetch(`${getBaseUrl()}/v2/customers/${customerId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Square-Version": SQUARE_VERSION,
          },
        }).then(async (r) => (r.ok ? (await r.json()).customer : null))
      : Promise.resolve(null);

    const servicePromise = serviceVariationId
      ? fetch(
          `${getBaseUrl()}/v2/catalog/object/${serviceVariationId}?include_related_objects=true`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Square-Version": SQUARE_VERSION,
            },
          }
        ).then(async (r) => {
          if (!r.ok) return "Service";
          const data = await r.json();
          const variation = data.object?.item_variation_data;
          if (variation?.name) return variation.name;
          const item = (data.related_objects || []).find((o) => o.type === "ITEM");
          return item?.item_data?.name || "Service";
        })
      : Promise.resolve("Service");

    const [updateResult, teamMember, customer, serviceName] = await Promise.all([
      updatePromise,
      techPromise,
      customerPromise,
      servicePromise,
    ]);

    if (!updateResult.ok) {
      return res
        .status(updateResult.status)
        .json({ error: updateResult.data.errors || updateResult.data });
    }

    // 3. Email tech (non-blocking failure)
    let emailSent = false;
    try {
      const techEmail = teamMember?.email_address;
      const techName = teamMember
        ? [teamMember.given_name, teamMember.family_name].filter(Boolean).join(" ") ||
          "Staff"
        : "Staff";
      const customerName = customer
        ? [customer.given_name, customer.family_name].filter(Boolean).join(" ") ||
          "Guest"
        : "Guest";

      if (techEmail && process.env.RESEND_API_KEY) {
        const apptTime = new Date(booking.start_at).toLocaleTimeString("en-US", {
          timeZone: "America/Toronto",
          hour: "numeric",
          minute: "2-digit",
        });

        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "LAM Check-In <checkin@lamnailspa.ca>",
            to: [techEmail],
            subject: `Customer checked in – ${customerName}`,
            text: `Hi ${techName},

Your customer has checked in and is ready.

Customer: ${customerName}
Service: ${serviceName}
Appointment time: ${apptTime}
Checked in at: ${timeStr}

— LAM Check-In`,
          }),
        });
        const emailData = await emailRes.json();
        console.log("Tech notification result:", emailData);
        emailSent = emailRes.ok;
      }
    } catch (emailErr) {
      console.error("Failed to notify tech:", emailErr);
    }

    return res.status(200).json({
      success: true,
      booking: updateResult.data.booking,
      message: sellerNote,
      emailSent,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
