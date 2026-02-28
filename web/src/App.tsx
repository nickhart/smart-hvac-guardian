import { useAuth } from "./hooks/useAuth";
import { LoginForm } from "./components/LoginForm";
import { Dashboard } from "./components/Dashboard";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";

export function App() {
  const { loading, authenticated, logout, siteName, tenantStatus, refreshAuth } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginForm siteName={siteName} />;
  }

  if (tenantStatus === "onboarding") {
    return <OnboardingWizard siteName={siteName} onComplete={refreshAuth} onLogout={logout} />;
  }

  return <Dashboard onLogout={logout} siteName={siteName} />;
}
