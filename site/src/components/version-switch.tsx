import { useEffect, useState } from "react";

import { counterpart } from "@/lib/v2-links";

/** Visible, manual version switch.
 *
 *  Nothing on the site redirects between v1 and v2 on its own — a visitor lands where their link pointed and
 *  changes version only by clicking this. The label always names the destination, and the link carries the
 *  current page, query and hash across, so you keep your filters when you switch.
 */
export function VersionSwitch({ compact }: { compact?: boolean }) {
  const [alt, setAlt] = useState<{ href: string; to: "v1" | "v2" } | null>(null);
  useEffect(() => { setAlt(counterpart()); }, []);
  if (!alt) return null;
  const onV2 = alt.to === "v1";
  return (
    <a
      className={"arc-vswitch" + (compact ? " arc-vswitch--compact" : "") + (onV2 ? " is-v2" : "")}
      href={alt.href}
      title={onV2 ? "Back to the current site" : "Open this page in the preview interface"}
    >
      <b>{onV2 ? "v2 preview" : "v1"}</b>
      <span>{onV2 ? "switch to v1" : "try v2"}</span>
    </a>
  );
}
