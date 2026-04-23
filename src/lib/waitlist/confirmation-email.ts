import { Resend } from "resend";

const FROM = "FdF <fdf@gargency.com>";

export async function sendWaitlistConfirmation(email: string): Promise<
  | { sent: true; id: string }
  | { sent: false; reason: "no_api_key" | "send_error"; error?: string }
> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "no_api_key" };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject: "FdF — ci sei, ti scriviamo all'apertura",
      text: plainText(),
      html: html(),
    });

    if (error) {
      return { sent: false, reason: "send_error", error: error.message };
    }
    return { sent: true, id: data?.id ?? "" };
  } catch (err) {
    return {
      sent: false,
      reason: "send_error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function plainText(): string {
  return [
    "Grazie per esserti iscritta/o alla waitlist di FdF.",
    "",
    "Ti scriviamo SOLO quando la beta privata apre (coorte 10-20 famiglie, €10-15/mese).",
    "Niente newsletter, niente spam — promesso.",
    "",
    "Se hai domande nel frattempo: fdf@gargency.com",
    "",
    "— Antonio, fondatore di Gargency LLC (FdF è una company del gruppo)",
  ].join("\n");
}

function html(): string {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#18181b;max-width:560px;">
    <p>Grazie per esserti iscritta/o alla waitlist di <strong>FdF — Finanza di Famiglia</strong>.</p>
    <p>Ti scriviamo <strong>solo</strong> quando la beta privata apre (coorte 10-20 famiglie, €10-15/mese).<br/>Niente newsletter, niente spam — promesso.</p>
    <p>Se hai domande nel frattempo: <a href="mailto:fdf@gargency.com">fdf@gargency.com</a></p>
    <p style="color:#52525b;font-size:13px;margin-top:24px;">— Antonio, fondatore di Gargency LLC (FdF è una company del gruppo)</p>
  </div>`;
}
