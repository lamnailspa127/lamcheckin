// Scheduled function – runs once per day
// Collects yesterday’s check-ins and prepares a log (and can email it)

const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function getYesterdayRangeToronto() {
  const now = new Date();
  // Get yesterday in Toronto timezone
  const torontoNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" }));
  const yesterday = new Date(torontoNow);
  yesterday.setDate(yesterday.getDate() - 1);

  const start = new Date(yesterday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(yesterday);
  end.setHours(23, 59, 59, 999);

  // Approximate conversion back to UTC
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

    const bookings = data.bookings || [];
    const checkedIn = bookings.filter(
      (b) => b.seller_note && b.seller_note.toLowerCase().includes("checked in")
    );

    let log = `LAM Nail Spa – Daily Check-in Log\n`;
    log += `Date: ${dateLabel}\n`;
    log += `Total appointments: ${bookings.length}\n`;
    log += `Checked in: ${checkedIn.length}\n\n`;

    if (checkedIn.length === 0) {
      log += "No customers checked in via the app yesterday.\n";
    } else {
      log += "Checked-in customers:\n";
      checkedIn.forEach((b) => {
        const time = new Date(b.start_at).toLocaleTimeString("en-US", {
          timeZone: "America/Toronto",
          hour: "numeric",
          minute: "2-digit",
        });
        log += `• ${time}  –  ${b.seller_note}\n`;
      });
    }

    log += `\n---\nGenerated automatically by LAM Check-In app`;

    console.log(log);

    // Send email if Resend API key is present
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

// Scheduled functions must NOT have a custom path
export const config = {
  schedule: "@daily",
};
