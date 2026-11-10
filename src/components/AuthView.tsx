/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { User } from "../types";

interface AuthViewProps {
  onLoginSuccess: (user: User, token: string) => void;
}

export default function AuthView({ onLoginSuccess }: AuthViewProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMsg("Escribe tu usuario y tu contraseña.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (res.ok) {
        const data = await res.json();
        onLoginSuccess(data.user, data.token);
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || "Usuario o contraseña incorrectos.");
      }
    } catch (err) {
      setErrorMsg("No hay conexión con el servidor. Revisa la red e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row lg:items-center justify-center gap-10 lg:gap-20 px-5 py-10 lg:px-16 font-sans" id="auth_view_box">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-xl"
      >
        <p className="cv-eyebrow mb-5">Sala · Cocina · Barra · Caja</p>
        <h1 className="auth-wordmark">Gastro<em>OS</em></h1>
        <p className="mt-6 max-w-sm text-lg leading-snug text-slate-700">
          El servicio entero en una pantalla: del QR de la mesa al ticket cobrado.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm glass-panel rounded-2xl p-7"
      >
        <h2 className="text-3xl text-slate-900">Acceso del personal</h2>
        <p className="text-sm text-slate-600 mt-1 mb-6">Entra con tu usuario para abrir tu puesto.</p>

        <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="p-3 bg-red-50 border border-red-200 rounded-xl mb-4 flex items-start gap-2 text-xs text-red-700"
            role="alert"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="flex-1 leading-relaxed">{errorMsg}</p>
          </motion.div>
        )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} aria-label="Formulario de inicio de sesión" className="space-y-4 text-sm">
          <div>
            <label htmlFor="auth_input_user" className="block text-xs font-bold text-slate-700 mb-1.5">Usuario</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="p. ej. camarero1"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full bg-white border-2 border-slate-900 p-3.5 text-slate-900"
              id="auth_input_user"
            />
          </div>

          <div>
            <label htmlFor="auth_input_pass" className="block text-xs font-bold text-slate-700 mb-1.5">Contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tu contraseña"
                required
                autoComplete="current-password"
                className="w-full bg-white border-2 border-slate-900 p-3.5 pr-12 text-slate-900"
                id="auth_input_pass"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 cursor-pointer"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 bg-slate-900 text-white disabled:opacity-60 font-extrabold text-base rounded-full flex justify-center items-center gap-2 cursor-pointer hover:bg-indigo-600"
            id="auth_btn_submit"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Entrando…</span>
              </>
            ) : (
              <span>Entrar</span>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
