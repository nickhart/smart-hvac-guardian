import { useAuth } from "./hooks/useAuth";
import { LoginForm } from "./components/LoginForm";
import { Dashboard } from "./components/Dashboard";

export function App() {
  const { loading, authenticated, logout, siteName } = useAuth();

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

  return <Dashboard onLogout={logout} siteName={siteName} />;
}
