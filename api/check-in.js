const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

async function getTeamMemberEmail(token, teamMemberId) {
  if (!teamMemberId) return null;
  try {
    const res = await fetch(`${getBaseUrl()}/v2/team-members/${teamMemberId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const data = await res.json();
    if (res.ok && data.team_member?.email_address) {
      return {
        email: data.team_member.email_address,
        name: [data.team_member.given_name, data.team_member.family_name]
          .filter(Boolean)
          .join(" ") || "Staff",
      };
    }
  } catch (e) {
    console.error("Failed to get team member email", e);
  }
  return null;
}

async function getCustomerName(token, customerId) {
  if (!customerId) return "Guest";
  try {
    const res = await fetch(`${getBaseUrl()}/v2/customers/${customerId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const data = await res.json();
    if (res.ok && data.customer) {
      return [data.customer.given_name, data.customer.family_name]
        .filter(Boolean)
        .join(" ") || "Guest";
    }
  } catch (e) {
    console.error("Failed to get customer name", e);
  }
  return "Guest";
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

    const updateBody = {
      booking: {
        version: version || booking.version || 0,
        seller_note: sellerNote,
      },
    };

    const updateRes = await fetch(`${getBaseUrl()}/v2/bookings/${bookingId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateBody),
    });

    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      return res.status(updateRes.status).json({ error: updateData.errors || updateData });
    }

    let emailSent = false;
    try {
      const [tech, customerName, serviceName] = await Promise.all([
        getTeamMemberEmail(token, teamMemberId),
        getCustomerName(token, customerId),
        getServiceName(token, serviceVariationId),
      ]);

      if (tech?.email && process.env.RESEND_API_KEY) {
        const apptTime = new Date(booking.start_at).toLocaleTimeString("en-US", {
          timeZone: "America/Toronto",
          hour: "numeric",
          minute: "2-digit",
        });

        const emailText = `Hi ${tech.name},

Your customer has checked in and is ready.

Customer: ${customerName}
Service: ${serviceName}
Appointment time: ${apptTime}
Checked in at: ${timeStr}

— LAM Check-In`;

        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "LAM Check-In <checkin@lamnailspa.ca>",
            to: [tech.email],
            subject: `Customer checked in – ${customerName}`,
            text: emailText,
          }),
        });

        const emailData = await emailRes.json();
        console.log("Tech notification result:", emailData);
        emailSent = emailRes.ok;
      } else {
        console.log("No tech email found or RESEND_API_KEY missing");
      }
    } catch (emailErr) {
      console.error("Failed to notify tech:", emailErr);
    }

    return res.status(200).json({
      success: true,
      booking: updateData.booking,
      message: sellerNote,
      emailSent,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
