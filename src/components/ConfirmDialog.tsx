import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { useFocusTrap } from "./useFocusTrap";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "default";
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = "Confirmar", cancelLabel = "Cancelar",
  onConfirm, onCancel, variant = "default",
}: ConfirmDialogProps) {
  const trapRef = useFocusTrap(open);
  const confirmId = React.useId();

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-[9998] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={confirmId}
        >
          <div className="absolute inset-0" onClick={onCancel} />
          <motion.div
            ref={trapRef}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl relative z-10"
          >
            <h3 id={confirmId} className="font-extrabold text-slate-900 text-sm mb-2">{title}</h3>
            <p className="text-xs text-slate-500 mb-5">{message}</p>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2.5 rounded-lg cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 text-white font-bold text-xs py-2.5 rounded-lg cursor-pointer ${
                  variant === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-indigo-600"
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
