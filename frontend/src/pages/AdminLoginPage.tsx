import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../api";

const ADMIN_TOKEN_KEY = "equinav_admin_token";

export const AdminLoginPage = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await adminApi.login(username, password);
      localStorage.setItem(ADMIN_TOKEN_KEY, result.token);
      navigate("/admin");
    } catch (loginError: unknown) {
      setError(loginError instanceof Error ? loginError.message : "Login fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-shell admin-layout">
      <section className="card">
        <h1 className="page-title">Admin Login</h1>
        <p className="muted">Nur für berechtigte Benutzer.</p>

        <form onSubmit={onSubmit}>
          <label htmlFor="username">Benutzername</label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <div className="inline-row" style={{ marginTop: "14px" }}>
            <button type="submit" className="button" disabled={loading}>
              {loading ? "Prüfe..." : "Anmelden"}
            </button>
          </div>
        </form>

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
};
