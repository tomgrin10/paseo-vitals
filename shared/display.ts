import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** New fields carry defaults, so version-1 documents saved before them still parse. */
export const displayPreferences = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    showSidebar: z.boolean().default(true),
    /** CPU, RAM and disk meters in the sidebar footer. */
    showFooter: z.boolean().default(true),
    /** A composer pill while RAM or disk is nearly full. */
    showPressurePill: z.boolean().default(true),
  }),
});

export const displayRpc = settingsRpc(displayPreferences.id);
