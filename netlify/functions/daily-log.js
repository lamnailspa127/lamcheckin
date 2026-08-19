// Scheduled function – runs once per day
// Sends a detailed check-in summary email

const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function getYesterdayRangeToronto() {
  const now = new Date();
  const torontoNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" }));
  const yesterday = new Date(torontoNow);
  yesterday.setDate(yesterday.getDate() - 1);

  const start = new Date(yesterday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(yesterday);
  end.setHours(23, 59, 59, 999);

  const offset = now.getTime() - torontoNow.getTime();
  const startISO = new Date(start.getTime() + offset).toISOString();
  const endISO = new Date(end.getTime() + offset).toISOString();

  const dateLabel = yesterday.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Toronto",
  });

  return { start_at_min: startISO, start_at_max: endISO, dateLabel };
}

async function getCustomerInfo(token, customerId) {
  if (!customerId) return { name: "Guest", phone: "" };
  try {
    const res = await fetch(`${getBaseUrl()}/v2/customers/${customerId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const data = await res.json();
    if (res.ok && data.customer) {
      const c = data.customer;
      const name = [c.given_name, c.family_name].filter(Boolean).join(" ") || "Guest";
      const phone = c.phone_number || "";
      return { name, phone };
    }
  } catch (e) {
    console.error("Customer lookup failed", e);
  }
  return { name: "Guest", phone: "" };
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

export default async () => {
  try {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID || "L5NJSKPJF80C0";
    const notifyEmail = process.env.NOTIFY_EMAIL || "lamnailspa127@gmail.com";

    if (!token) {
      console.error("Missing SQUARE_ACCESS_TOKEN");
      return;
    }

    const { start_at_min, start_at_max, dateLabel } = getYesterdayRangeToronto();

    const params = new URLSearchParams({
      location_id: locationId,
      start_at_min,
      start_at_max,
      limit: "100",
    });

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
      console.error("Square API error", data);
      return;
    }

    const bookings = (data.bookings || []).filter((b) => {
      const status = (b.status || "").toUpperCase();
      return status !== "CANCELLED" && status !== "NO_SHOW";
    });
    const checkedIn = bookings.filter(
      (b) => b.seller_note && b.seller_note.toLowerCase().includes("checked in")
    );

    // Enrich each checked-in booking
    const details = await Promise.all(
      checkedIn.map(async (b) => {
        const segment = b.appointment_segments?.[0] || {};
        const [customer, staffName, serviceName] = await Promise.all([
          getCustomerInfo(token, b.customer_id),
          getTeamMemberName(token, segment.team_member_id),
          getServiceName(token, segment.service_variation_id),
        ]);

        const apptTime = new Date(b.start_at).toLocaleTimeString("en-US", {
          timeZone: "America/Toronto",
          hour: "numeric",
          minute: "2-digit",
        });

        return {
          apptTime,
          name: customer.name,
          phone: customer.phone,
          service: serviceName,
          staff: staffName,
          note: b.seller_note || "",
        };
      })
    );

    // Sort by appointment time
    details.sort((a, b) => a.apptTime.localeCompare(b.apptTime));

    let log = `LAM Nail Spa – Daily Check-in Log\n`;
    log += `Date: ${dateLabel}\n`;
    log += `Total appointments: ${bookings.length}\n`;
    log += `Checked in: ${checkedIn.length}\n\n`;

    if (details.length === 0) {
      log += "No customers checked in via the app yesterday.\n";
    } else {
      log += "Checked-in customers:\n\n";
      details.forEach((d, i) => {
        log += `${i + 1}. ${d.apptTime}\n`;
        log += `   Name: ${d.name}\n`;
        if (d.phone) log += `   Phone: ${d.phone}\n`;
        log += `   Service: ${d.service}\n`;
        log += `   Nail Tech: ${d.staff}\n`;
        log += `   ${d.note}\n\n`;
      });
    }

    log += `---\nGenerated automatically by LAM Check-In app`;

    console.log(log);

    // Send email if Resend is configured
    if (process.env.RESEND_API_KEY) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "LAM Check-In <onboarding@resend.dev>",
            to: [notifyEmail],
            subject: `LAM Check-In Log – ${dateLabel}`,
            text: log,
          }),
        });
        const emailData = await emailRes.json();
        console.log("Email result:", emailData);
      } catch (emailErr) {
        console.error("Failed to send email:", emailErr);
      }
    } else {
      console.log("RESEND_API_KEY not set – email not sent");
    }
  } catch (err) {
    console.error("daily-log error:", err);
  }
};

export const config = {
  schedule: "@daily",
};
