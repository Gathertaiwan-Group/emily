"use client";
import type { ReactNode } from "react";

/** Submit button that asks for confirmation first. */
export function ConfirmButton({ children, message, className = "adm-link-danger", name, value, formAction }: { children: ReactNode; message: string; className?: string; name?: string; value?: string; formAction?: (f: FormData) => void }) {
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      formAction={formAction}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
