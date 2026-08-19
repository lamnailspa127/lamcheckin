const SQUARE_VERSION = "2025-01-23";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

export default async () => {
  try {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    if (!token) {
      return new Response(JSON.stringify({ error: "No SQUARE_ACCESS_TOKEN" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Search all team members
    const res = await fetch(`${getBaseUrl()}/v2/team-members/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          filter: {
            status: "ACTIVE",
          },
        },
        limit: 100,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const staff = (data.team_members || []).map((tm) => ({
      id: tm.id,
      name: [tm.given_name, tm.family_name].filter(Boolean).join(" ") || "(no name)",
      email: tm.email_address || "(no email in Square)",
      phone: tm.phone_number || "",
      status: tm.status,
    }));

    // Also return a simple readable text version
    let text = "LAM Nail Spa – Staff list from Square\n\n";
    staff.forEach((s, i) => {
      text += `${i + 1}. ${s.name}\n`;
      text += `   Email: ${s.email}\n`;
      if (s.phone) text += `   Phone: ${s.phone}\n`;
      text += `   ID: ${s.id}\n\n`;
    });

    return new Response(
      JSON.stringify({ count: staff.length, staff, text }, null, 2),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/list-staff",
};
