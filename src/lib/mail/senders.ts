/**
 * The addresses the app sends from. agenda@ carries the calendar invites
 * (#294) and the e-mails of the founder's plans (#292, #296); its replies
 * reach Luiz through a Cloudflare Email Routing rule. Kept here, apart from
 * the calendar, so a sender that is not the agenda does not import it.
 */
export const AGENDA_ADDRESS = "agenda@chelsea-st.com";
