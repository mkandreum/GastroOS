/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { 
  Lock, UserCheck, ShieldClose, Loader2, AlertCircle, HelpCircle, Utensils, Eye, EyeOff
} from "lucide-react";
import { User, UserRole } from "../types";
import { useToast } from "./ToastProvider";

interface AuthViewProps {
  onLoginSuccess: (user: User, token: string) => void;
}

export default function AuthView({ onLoginSuccess }: AuthViewProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showHelper, setShowHelper] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMsg("Rellena todos los campos.");
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
        const data = await res.json();
        setErrorMsg(data.error || "Fallo de autenticación debido a credenciales no válidas.");
      }
    } catch (err) {
      setErrorMsg("Error de red tratando de conectar al servidor de seguridad.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-4 bg-transparent font-sans" id="auth_view_box">
      
      {/* CARD ACCESO */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm bg-white rounded-xl border border-slate-200/80 p-6 shadow-sm gastro-card"
      >
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">Acceso de Personal Autorizado</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-widest bg-slate-50 inline-block px-2.5 py-1 rounded">
            Introduce tus credenciales
          </p>
        </div>

        <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="p-3 bg-red-50 border border-red-100 rounded-xl mb-4.5 flex items-start space-x-1.5 text-xs text-red-600"
            role="alert"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="flex-1 leading-relaxed">{errorMsg}</p>
          </motion.div>
        )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} aria-label="Formulario de inicio de sesión" className="space-y-4 text-xs">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">Identificador / Usuario</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nombre de usuario del personal"
              required
              autoComplete="username"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-700 focus:outline-2 focus:outline-indigo-400 focus:border-indigo-400 focus:bg-white"
              id="auth_input_user"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">Contraseña de Seguridad</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña numérica o alfanumérica"
                required
                autoComplete="current-password"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 pr-10 text-slate-700 focus:border-indigo-400 focus:bg-white focus:outline-2 focus:outline-indigo-400"
                id="auth_input_pass"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 cursor-pointer"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-indigo-600 disabled:bg-slate-300 text-white font-extrabold py-3.5 px-4 rounded-xl flex justify-center items-center space-x-1.5 cursor-pointer shadow-md transition active:scale-98"
            id="auth_btn_submit"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Validando huella / firma...</span>
              </>
            ) : (
              <span>Iniciar Sesión Segura</span>
            )}
          </button>
        </form>



      </motion.div>
    </div>
  );
}
