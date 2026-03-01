import { useEffect } from "react";
import { useAuth } from "./hooks/useAuth";
import { LoginForm } from "./components/LoginForm";
import { Dashboard } from "./components/Dashboard";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";

/** Darken a hex color by a percentage (0–100). */
function darkenHex(hex: string, percent: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) - Math.round(2.55 * percent));
  const g = Math.max(0, ((n >> 8) & 0xff) - Math.round(2.55 * percent));
  const b = Math.max(0, (n & 0xff) - Math.round(2.55 * percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function App() {
  const {
    loading,
    authenticated,
    logout,
    siteName,
    logoUrl,
    primaryColor,
    tenantStatus,
    refreshAuth,
  } = useAuth();

  useEffect(() => {
    if (primaryColor) {
      document.documentElement.style.setProperty("--color-primary-600", primaryColor);
      document.documentElement.style.setProperty(
        "--color-primary-700",
        darkenHex(primaryColor, 15),
      );
    }
  }, [primaryColor]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginForm siteName={siteName} logoUrl={logoUrl} />;
  }

  if (tenantStatus === "onboarding") {
    return <OnboardingWizard siteName={siteName} onComplete={refreshAuth} onLogout={logout} />;
  }

  return <Dashboard onLogout={logout} siteName={siteName} logoUrl={logoUrl} />;
}
