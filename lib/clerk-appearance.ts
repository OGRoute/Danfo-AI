/**
 * Clerk's components re-skinned in DanfoAI's yellow/ink palette, so hosted
 * sign-in looks like the rest of the app in both themes. Shared by the
 * landing gate and the /sign-in and /sign-up pages.
 */
export function clerkAppearance(dark: boolean) {
  return {
    variables: {
      colorPrimary: "#ffd400",
      colorTextOnPrimaryBackground: "#111111",
      colorBackground: dark ? "#1f1d16" : "#ffffff",
      colorText: dark ? "#f4f1e6" : "#111111",
      colorTextSecondary: dark ? "#b8b09a" : "#5b4a00",
      colorInputBackground: dark ? "#14130d" : "#ffffff",
      colorInputText: dark ? "#f4f1e6" : "#111111",
      colorNeutral: dark ? "#f4f1e6" : "#111111",
      borderRadius: "12px",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    },
    elements: {
      rootBox: { width: "100%" },
      cardBox: { width: "100%", boxShadow: "none", border: "none" },
      card: { boxShadow: "none", border: "none", background: "transparent", padding: "4px 0 8px" },
      footer: { background: "transparent" },
    },
  };
}
