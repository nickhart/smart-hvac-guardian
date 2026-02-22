import { useAuth } from "./hooks/useAuth";
import { LoginForm } from "./components/LoginForm";
import { Dashboard } from "./components/Dashboard";

export function App() {
  const { loading, authenticated, login, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginForm onLogin={login} />;
  }

  return <Dashboard onLogout={logout} />;
}
