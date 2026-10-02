import { atName } from "./names.js";

/**
 * A channel post as Discord shows it: mentions become role pills (in place
 * where the text says @name, otherwise in front), and an agent writing
 * "@user" pings the office-user role. Returns the roles it may ping.
 */
export async function withRolePills(
  text: string,
  mentions: string[],
  fromAgent: boolean,
  role: (agent: string) => Promise<string>,
  userRole: () => Promise<string>,
): Promise<{ content: string; ping: string[] }> {
  const prefix: string[] = [];
  for (const m of mentions) {
    const pill = `<@&${await role(m)}>`;
    if (atName(m).test(text)) text = text.replace(atName(m), pill);
    else prefix.push(pill);
  }
  const ping: string[] = [];
  if (fromAgent && atName("user").test(text)) {
    const r = await userRole();
    text = text.replace(atName("user"), `<@&${r}>`);
    ping.push(r);
  }
  return {
    content: prefix.length ? `${prefix.join(" ")} ${text}` : text,
    ping,
  };
}
