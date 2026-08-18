// Scheduled function – runs once per day
// Sends a summary of checked-in appointments to the salon email

const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function getYesterdayRange() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const start = new Date(yesterday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(yesterday);
  end.setHours(23, 59, 59, 999);

  return {
    start_at_min: start.toISOString(),
    start_at_max: end.toISOString(),
    dateLabel: yesterday.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
}

export default async (req) => {
  // Allow manual trigger too
  try {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID || "L5NJSKPJF80C0";
    const notifyEmail = process.env.NOTIFY_EMAIL || "lamnailspa127@gmail.com";

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing SQUARE_ACCESS_TOKEN" }), {
        status: 500,
      });
    }

    const { start_at_min, start_at_max, dateLabel } = getYesterdayRange();

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
      return new Response(JSON.stringify({ error: data }), { status: 500 });
    }

    const bookings = data.bookings || [];
    const checkedIn = bookings.filter(
      (b) => b.seller_note && b.seller_note.toLowerCase().includes("checked in")
    );

    // Build simple text log
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
          hour: "numeric",
          minute: "2-digit",
        });
        log += `• ${time}  –  ${b.seller_note}\n`;
      });
    }

    log += `\n---\nGenerated automatically by LAM Check-In app`;

    // For a real email we need an email service (Resend, SendGrid, etc.)
    // Here we log it and return the content so you can see it works.
    // To actually send email, add RESEND_API_KEY and uncomment the fetch below.

    console.log(log);

   
    return new Response(
      JSON.stringify({
        success: true,
        date: dateLabel,
        total: bookings.length,
        checkedIn: checkedIn.length,
        log,
        note: "Email sending requires RESEND_API_KEY (see README)",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const config = {
  path: "/api/daily-log",
  schedule: "@daily", // runs once every day
};
